import { Feature } from '../../src/lib/feature.js';
import { Logger, KubernetesHelper, CommandRunner } from '../../src/lib/common.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_DIR = join(__dirname, 'config');

// Helm chart versions
const PROMETHEUS_STACK_VERSION = '65.1.0';
const LOKI_VERSION = '6.6.2';
const TEMPO_VERSION = '1.7.1';
const OTEL_COLLECTOR_VERSION = '0.97.1';

/**
 * Telemetry Feature
 * 
 * Installs a complete observability stack for kgateway based on OpenTelemetry.
 * 
 * Reference: https://kgateway.dev/docs/latest/observability/otel-stack/
 * 
 * This feature installs:
 * - Prometheus and Grafana (kube-prometheus-stack)
 * - OpenTelemetry collectors (metrics, logs, traces)
 * - Grafana Loki (log aggregation)
 * - Grafana Tempo (trace aggregation)
 * - HTTPListenerPolicy resources for log and trace collection
 * - Required ReferenceGrants
 * 
 * Configuration:
 * {
 *   telemetryNamespace: string,  // Default: 'telemetry'
 *   enableLogs: boolean,          // Default: true
 *   enableTraces: boolean,        // Default: true
 *   enableMetrics: boolean        // Default: true
 * }
 */
export class TelemetryFeature extends Feature {
  constructor(name, config) {
    super(name, config);
    this.telemetryNamespace = config.telemetryNamespace || 'telemetry';
    this.enableLogs = config.enableLogs !== false;
    this.enableTraces = config.enableTraces !== false;
    this.enableMetrics = config.enableMetrics !== false;
  }

  validate() {
    // All configuration is optional
    return true;
  }

  async deploy() {
    this.log('Installing OpenTelemetry observability stack...', 'info');

    // Step 1: Create telemetry namespace (must exist before Helm installations)
    await KubernetesHelper.ensureNamespace(this.telemetryNamespace, this.spinner);
    this.log(`Namespace '${this.telemetryNamespace}' ready`, 'info');

    // Step 2: Install Prometheus and Grafana
    await this.installPrometheusStack();

    // Step 3: Install OpenTelemetry collectors
    if (this.enableMetrics) {
      await this.installOTelCollector('metrics');
    }
    if (this.enableLogs) {
      await this.installLoki();
      await this.installOTelCollector('logs');
    }
    if (this.enableTraces) {
      await this.installTempo();
      await this.installOTelCollector('traces');
    }

    // Step 4: Create HTTPListenerPolicy resources
    if (this.enableLogs) {
      await this.applyYamlFile('logging-policy.yaml');
      await this.applyYamlFile('reference-grant-logs.yaml');
    }
    if (this.enableTraces) {
      await this.applyYamlFile('tracing-policy.yaml');
      await this.applyYamlFile('reference-grant-traces.yaml');
    }

    this.log('OpenTelemetry stack installed successfully', 'success');
  }

  async cleanup() {
    this.log('Cleaning up OpenTelemetry stack...', 'info');

    // Delete EnterpriseAgentgatewayPolicies (logging and tracing)
    await this.deleteResource('EnterpriseAgentgatewayPolicy', 'logging', this.namespace);
    await this.deleteResource('EnterpriseAgentgatewayPolicy', 'tracing', this.namespace);

    // Delete ReferenceGrants
    await this.deleteResource('ReferenceGrant', 'allow-otel-collector-logs-access', this.telemetryNamespace);
    await this.deleteResource('ReferenceGrant', 'allow-otel-collector-traces-access', this.telemetryNamespace);

    // Uninstall Helm charts (idempotent - won't fail if not found)
    const releases = [
      'opentelemetry-collector-metrics',
      'opentelemetry-collector-logs',
      'opentelemetry-collector-traces',
      'loki',
      'tempo',
      'kube-prometheus-stack'
    ];

    for (const release of releases) {
      try {
        await CommandRunner.run('helm', [
          'uninstall', release,
          '-n', this.telemetryNamespace
        ], { ignoreError: true });
      } catch (error) {
        // Ignore errors - release may not exist
      }
    }

    this.log('OpenTelemetry stack cleaned up', 'success');
  }

  /**
   * Install Prometheus and Grafana stack
   */
  async installPrometheusStack() {
    this.log('Installing Prometheus and Grafana...', 'info');

    // Add Prometheus community Helm repo
    try {
      await CommandRunner.run('helm', ['repo', 'add', 'prometheus-community', 
        'https://prometheus-community.github.io/helm-charts'], { ignoreError: true });
      await CommandRunner.run('helm', ['repo', 'update'], { ignoreError: true });
    } catch (error) {
      // Repo might already exist
    }

    // Install/upgrade kube-prometheus-stack
    await KubernetesHelper.helm([
      'upgrade', '-i', 'kube-prometheus-stack',
      'prometheus-community/kube-prometheus-stack',
      '-n', this.telemetryNamespace,
      '--version', PROMETHEUS_STACK_VERSION,
      '-f', join(CONFIG_DIR, 'prometheus-values.yaml'),
      '--create-namespace',
      '--wait'
    ]);

    // Wait for key deployments to be ready
    await this.waitForDeployment('kube-prometheus-stack-operator', 120);
    await this.waitForDeployment('kube-prometheus-stack-grafana', 120);
    
    // Wait for StatefulSets
    await this.waitForStatefulSet('prometheus-kube-prometheus-stack-prometheus', 120);
  }

  /**
   * Install Grafana Loki
   */
  async installLoki() {
    this.log('Installing Grafana Loki...', 'info');

    // Add Grafana Helm repo
    try {
      await CommandRunner.run('helm', ['repo', 'add', 'grafana', 
        'https://grafana.github.io/helm-charts'], { ignoreError: true });
      await CommandRunner.run('helm', ['repo', 'update'], { ignoreError: true });
    } catch (error) {
      // Repo might already exist
    }

    // Install/upgrade Loki
    await KubernetesHelper.helm([
      'upgrade', '-i', 'loki',
      'grafana/loki',
      '-n', this.telemetryNamespace,
      '--version', LOKI_VERSION,
      '-f', join(CONFIG_DIR, 'loki-values.yaml'),
      '--create-namespace',
      '--wait'
    ]);

    // Wait for Loki StatefulSet to be ready
    await this.waitForStatefulSet('loki', 120);
  }

  /**
   * Install Grafana Tempo
   */
  async installTempo() {
    this.log('Installing Grafana Tempo...', 'info');

    // Install/upgrade Tempo
    await KubernetesHelper.helm([
      'upgrade', '-i', 'tempo',
      'grafana/tempo',
      '-n', this.telemetryNamespace,
      '--version', TEMPO_VERSION,
      '-f', join(CONFIG_DIR, 'tempo-values.yaml'),
      '--create-namespace',
      '--wait'
    ]);

    // Wait for Tempo deployment to be ready
    await this.waitForDeployment('tempo', 120);
  }

  /**
   * Install OpenTelemetry collector
   */
  async installOTelCollector(type) {
    const releaseName = `opentelemetry-collector-${type}`;

    this.log(`Installing OpenTelemetry collector (${type})...`, 'info');

    // Add OpenTelemetry Helm repo
    try {
      await CommandRunner.run('helm', ['repo', 'add', 'open-telemetry', 
        'https://open-telemetry.github.io/opentelemetry-helm-charts'], { ignoreError: true });
      await CommandRunner.run('helm', ['repo', 'update'], { ignoreError: true });
    } catch (error) {
      // Repo might already exist
    }

    // Install/upgrade with type-specific values file
    await KubernetesHelper.helm([
      'upgrade', '-i', releaseName,
      'open-telemetry/opentelemetry-collector',
      '-n', this.telemetryNamespace,
      '--version', OTEL_COLLECTOR_VERSION,
      '-f', join(CONFIG_DIR, `otel-collector-${type}-values.yaml`),
      '--create-namespace',
      '--wait'
    ]);

    // Wait for collector to be ready
    // Logs collector runs as DaemonSet, others as Deployment
    if (type === 'logs') {
      await this.waitForDaemonSet(releaseName, 120);
    } else {
      await this.waitForDeployment(releaseName, 120);
    }
  }

  /**
   * Wait for a deployment to be ready
   */
  async waitForDeployment(name, timeout = 120) {
    this.log(`Waiting for deployment ${name} to be ready...`, 'info');
    
    try {
      await KubernetesHelper.waitForDeployment(
        this.telemetryNamespace, 
        name, 
        timeout,
        this.spinner
      );
    } catch (error) {
      this.log(`Deployment ${name} may take longer to be ready`, 'warn');
    }
  }

  /**
   * Wait for a StatefulSet to be ready
   */
  async waitForStatefulSet(name, timeout = 120) {
    this.log(`Waiting for statefulset ${name} to be ready...`, 'info');
    
    try {
      await KubernetesHelper.kubectl([
        'wait',
        '--for=condition=ready',
        `statefulset/${name}`,
        '-n', this.telemetryNamespace,
        `--timeout=${timeout}s`
      ], { spinner: this.spinner });
    } catch (error) {
      this.log(`StatefulSet ${name} may take longer to be ready`, 'warn');
    }
  }

  /**
   * Wait for a DaemonSet to be ready
   */
  async waitForDaemonSet(name, timeout = 120) {
    this.log(`Waiting for daemonset ${name} to be ready...`, 'info');
    
    try {
      // Wait for DaemonSet to have at least one pod running
      const startTime = Date.now();
      const timeoutMs = timeout * 1000;
      
      while (Date.now() - startTime < timeoutMs) {
        try {
          const result = await KubernetesHelper.kubectl([
            'get', 'daemonset', name,
            '-n', this.telemetryNamespace,
            '-o', 'jsonpath={.status.numberReady}'
          ], { ignoreError: true, spinner: this.spinner });
          
          const numberReady = parseInt(result.stdout.trim(), 10);
          if (numberReady > 0) {
            this.log(`DaemonSet ${name} has ${numberReady} pod(s) ready`, 'info');
            return;
          }
        } catch (error) {
          // Continue waiting
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      this.log(`DaemonSet ${name} may take longer to be ready`, 'warn');
    } catch (error) {
      this.log(`DaemonSet ${name} may take longer to be ready`, 'warn');
    }
  }
}

export function createTelemetryFeature(config) {
  return new TelemetryFeature('telemetry', config);
}

