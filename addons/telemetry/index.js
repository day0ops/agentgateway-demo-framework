import { Feature } from '../../src/lib/feature.js';
import { KubernetesHelper, CommandRunner } from '../../src/lib/common.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile, readdir } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_DIR = join(__dirname, 'config');
const DASHBOARDS_DIR = join(__dirname, 'dashboards');

// Helm chart versions
const PROMETHEUS_STACK_VERSION = '80.4.2';
const LOKI_VERSION = '6.6.2';
const TEMPO_DISTRIBUTED_VERSION = '1.29.0';
const ALLOY_VERSION = '0.12.0';

/**
 * Telemetry Feature
 *
 * Installs a complete observability stack for agentgateway.
 *
 * Reference: https://github.com/solo-io/fe-enterprise-agentgateway-workshop/blob/main/002-set-up-monitoring-tools.md
 *
 * This feature installs:
 * - Prometheus and Grafana (kube-prometheus-stack)
 * - Grafana Tempo Distributed (trace aggregation with OTLP receiver)
 * - Grafana Loki (log aggregation)
 * - Grafana Alloy (log scraping from pods)
 * - PodMonitor for agentgateway metrics scraping
 * - EnterpriseAgentgatewayPolicy resources for trace collection
 * - Grafana dashboards (Overview, Budget, Performance, Control Plane)
 *
 * Configuration:
 * {
 *   telemetryNamespace: string,  // Default: 'telemetry'
 *   gatewayNamespace: string,    // Namespace where gateway policies are applied (default: 'agentgateway-system')
 *   enableLogs: boolean,          // Default: true
 *   enableTraces: boolean,        // Default: true
 *   enableMetrics: boolean,       // Default: true
 *   retention: string,            // Default: '120h' (5 days) - retention period for metrics, logs, traces
 *   grafanaServiceType: string,   // Default: 'LoadBalancer' - Grafana service type (ClusterIP, LoadBalancer, NodePort)
 *   nodeSelector: object          // Default: {} (e.g., { nodeclass: 'worker' })
 * }
 */
export class TelemetryFeature extends Feature {
  constructor(name, config) {
    super(name, config);
    this.telemetryNamespace = config.telemetryNamespace || 'telemetry';
    this.gatewayNamespace = config.gatewayNamespace || this.namespace;
    this.enableLogs = config.enableLogs !== false;
    this.enableTraces = config.enableTraces !== false;
    this.enableMetrics = config.enableMetrics !== false;
    this.retention = config.retention || '120h'; // 5 days default
    this.grafanaServiceType = config.grafanaServiceType || 'LoadBalancer';
    this.nodeSelector = config.nodeSelector || {};
    // External-dns hostnames for DNS record creation
    this.grafanaHostname = config.grafanaHostname || '';
    this.prometheusHostname = config.prometheusHostname || '';
    this.tempoHostname = config.tempoHostname || '';
    this.lokiHostname = config.lokiHostname || '';
  }

  validate() {
    return true;
  }

  /**
   * Override applyYamlFile to use addon's config directory instead of features/
   */
  async applyYamlFile(filename, overrides = {}) {
    const yaml = (await import('js-yaml')).default;
    const configPath = join(CONFIG_DIR, filename);

    try {
      const content = await readFile(configPath, 'utf8');
      let resource = yaml.load(content);

      if (resource.metadata && resource.metadata.namespace !== this.namespace) {
        resource.metadata.namespace = this.namespace;
      }

      if (Object.keys(overrides).length > 0) {
        resource = this.deepMerge(resource, overrides);
      }

      await this.applyResource(resource);
    } catch (error) {
      throw new Error(`Failed to apply YAML file ${filename}: ${error.message}`);
    }
  }

  /**
   * Build Helm --set args for nodeSelector
   */
  buildNodeSelectorArgs(prefix) {
    const args = [];
    const pathPrefix = prefix ? `${prefix}.` : '';
    for (const [key, value] of Object.entries(this.nodeSelector)) {
      args.push('--set', `${pathPrefix}nodeSelector.${key}=${value}`);
    }
    return args;
  }

  async deploy() {
    this.log('Installing observability stack...', 'info');

    // Step 1: Create telemetry namespace
    await KubernetesHelper.ensureNamespace(this.telemetryNamespace, this.spinner);
    this.log(`Namespace '${this.telemetryNamespace}' ready`, 'info');

    // Step 2: Install Tempo first (needed for Grafana datasource)
    if (this.enableTraces) {
      await this.installTempo();
    }

    // Step 3: Install Loki (needed for Grafana datasource)
    if (this.enableLogs) {
      await this.installLoki();
      await this.installAlloy();
    }

    // Step 4: Install Prometheus and Grafana with datasources configured
    await this.installPrometheusStack();

    // Step 5: Install Grafana dashboards
    await this.installDashboards();

    // Step 6: Create PodMonitors for agentgateway metrics
    if (this.enableMetrics) {
      await this.applyYamlFile('pod-monitor.yaml');
      await this.applyYamlFile('pod-monitor-control-plane.yaml');
      // ServiceMonitor for kubelet/cAdvisor (container CPU/memory metrics on Talos)
      await this.applyYamlFile('service-monitor-kubelet.yaml');
    }

    // Step 7: Create EnterpriseAgentgatewayPolicy resources
    if (this.enableLogs) {
      await this.applyYamlFile('logging-policy.yaml', {
        metadata: { namespace: this.gatewayNamespace },
      });
      await this.applyYamlFile('reference-grant-logs.yaml');
    }
    if (this.enableTraces) {
      // Deploy fan-out collector to route traces to both Solo UI (ClickHouse) and Tempo (Grafana)
      await this.installFanOutCollector();
      // Apply gateway tracing policy (routes traces from agentgateway to fan-out-collector)
      await this.applyYamlFile('tracing-policy.yaml', {
        metadata: { namespace: this.gatewayNamespace },
      });
      await this.applyYamlFile('reference-grant-traces.yaml');
    }

    this.log('Observability stack installed successfully', 'success');
  }

  /**
   * Install fan-out OTEL collector for routing traces to multiple backends
   * Routes to both solo-enterprise-telemetry-collector (ClickHouse) and tempo-distributor (Grafana)
   *
   * To enable fan-out, configure solo-ui addon with:
   *   tracingBackend: { name: 'fan-out-collector', namespace: 'telemetry', port: 4317 }
   */
  async installFanOutCollector() {
    this.log('Installing fan-out collector for trace routing...', 'info');

    await this.applyMultiDocYamlFile('fan-out-collector.yaml');
    await this.waitForDeployment('fan-out-collector', 120);

    this.log('Fan-out collector installed', 'info');
    this.log(
      'Configure solo-ui with tracingBackend: { name: "fan-out-collector", namespace: "telemetry" }',
      'info'
    );
  }

  /**
   * Apply a YAML file containing multiple documents (separated by ---)
   */
  async applyMultiDocYamlFile(filename) {
    const yaml = (await import('js-yaml')).default;
    const configPath = join(CONFIG_DIR, filename);

    try {
      const content = await readFile(configPath, 'utf8');
      const documents = yaml.loadAll(content);

      for (const doc of documents) {
        if (doc) {
          await this.applyResource(doc);
        }
      }
    } catch (error) {
      throw new Error(`Failed to apply multi-doc YAML file ${filename}: ${error.message}`);
    }
  }

  async cleanup() {
    this.log('Cleaning up observability stack...', 'info');

    // Delete EnterpriseAgentgatewayPolicies
    await this.deleteResource(
      'EnterpriseAgentgatewayPolicy',
      'logging-policy',
      this.gatewayNamespace
    );
    await this.deleteResource(
      'EnterpriseAgentgatewayPolicy',
      'tracing-policy',
      this.gatewayNamespace
    );

    // Delete PodMonitors and ServiceMonitors
    await this.deleteResource('PodMonitor', 'agentgateway-metrics', this.telemetryNamespace);
    await this.deleteResource(
      'PodMonitor',
      'agentgateway-control-plane-metrics',
      this.telemetryNamespace
    );
    await this.deleteResource('ServiceMonitor', 'kubelet', this.telemetryNamespace);

    // Delete ReferenceGrants
    await this.deleteResource(
      'ReferenceGrant',
      'allow-fan-out-collector-access',
      this.telemetryNamespace
    );
    await this.deleteResource('ReferenceGrant', 'allow-loki-access', this.telemetryNamespace);
    await this.deleteResource(
      'ReferenceGrant',
      'allow-fan-out-collector-access',
      this.telemetryNamespace
    );

    // Delete fan-out collector resources
    await this.deleteResource('Deployment', 'fan-out-collector', this.telemetryNamespace);
    await this.deleteResource('Service', 'fan-out-collector', this.telemetryNamespace);
    await this.deleteResource('ConfigMap', 'fan-out-collector-config', this.telemetryNamespace);

    // Delete dashboard ConfigMaps
    const dashboardNames = [
      'agentgateway-overview',
      'agentgateway-cost',
      'agentgateway-budget-enforcement',
      'agentgateway-performance',
      'agentgateway-control-plane',
    ];
    for (const name of dashboardNames) {
      await this.deleteResource('ConfigMap', `dashboard-${name}`, this.telemetryNamespace);
    }

    // Uninstall Helm charts
    const releases = ['alloy', 'loki', 'tempo', 'kube-prometheus-stack'];

    for (const release of releases) {
      try {
        await CommandRunner.run('helm', ['uninstall', release, '-n', this.telemetryNamespace], {
          ignoreError: true,
        });
      } catch (_error) {
        // Ignore errors - release may not exist
      }
    }

    this.log('Observability stack cleaned up', 'success');
  }

  /**
   * Install Grafana Tempo Distributed
   */
  async installTempo() {
    this.log('Installing Grafana Tempo...', 'info');

    try {
      await CommandRunner.run(
        'helm',
        ['repo', 'add', 'grafana', 'https://grafana.github.io/helm-charts'],
        { ignoreError: true }
      );
      await CommandRunner.run('helm', ['repo', 'update', 'grafana'], { ignoreError: true });
    } catch (_error) {
      // Repo might already exist
    }

    const helmArgs = [
      'upgrade',
      '-i',
      'tempo',
      'grafana/tempo-distributed',
      '-n',
      this.telemetryNamespace,
      '--version',
      TEMPO_DISTRIBUTED_VERSION,
      '-f',
      join(CONFIG_DIR, 'tempo-values.yaml'),
      '--create-namespace',
      '--wait',
    ];
    await KubernetesHelper.helm(helmArgs);

    // Wait for key components
    await this.waitForDeployment('tempo-distributor', 120);
    await this.waitForDeployment('tempo-query-frontend', 120);
  }

  /**
   * Install Grafana Loki
   */
  async installLoki() {
    this.log('Installing Grafana Loki...', 'info');

    try {
      await CommandRunner.run(
        'helm',
        ['repo', 'add', 'grafana', 'https://grafana.github.io/helm-charts'],
        { ignoreError: true }
      );
      await CommandRunner.run('helm', ['repo', 'update', 'grafana'], { ignoreError: true });
    } catch (_error) {
      // Repo might already exist
    }

    const helmArgs = [
      'upgrade',
      '-i',
      'loki',
      'grafana/loki',
      '-n',
      this.telemetryNamespace,
      '--version',
      LOKI_VERSION,
      '-f',
      join(CONFIG_DIR, 'loki-values.yaml'),
      '--create-namespace',
      '--wait',
      '--set',
      `loki.limits_config.retention_period=${this.retention}`,
      '--set',
      `loki.limits_config.reject_old_samples_max_age=${this.retention}`,
      ...this.buildNodeSelectorArgs('singleBinary'),
    ];
    await KubernetesHelper.helm(helmArgs);

    await this.waitForStatefulSet('loki', 120);
  }

  /**
   * Install Grafana Alloy for log scraping
   */
  async installAlloy() {
    this.log('Installing Grafana Alloy for log collection...', 'info');

    const helmArgs = [
      'upgrade',
      '-i',
      'alloy',
      'grafana/alloy',
      '-n',
      this.telemetryNamespace,
      '--version',
      ALLOY_VERSION,
      '-f',
      join(CONFIG_DIR, 'alloy-values.yaml'),
      '--create-namespace',
      '--wait',
    ];
    await KubernetesHelper.helm(helmArgs);

    await this.waitForDaemonSet('alloy', 120);
  }

  /**
   * Install Prometheus and Grafana stack
   */
  async installPrometheusStack() {
    this.log('Installing Prometheus and Grafana...', 'info');

    try {
      await CommandRunner.run(
        'helm',
        [
          'repo',
          'add',
          'prometheus-community',
          'https://prometheus-community.github.io/helm-charts',
        ],
        { ignoreError: true }
      );
      await CommandRunner.run('helm', ['repo', 'update', 'prometheus-community'], {
        ignoreError: true,
      });
    } catch (_error) {
      // Repo might already exist
    }

    const helmArgs = [
      'upgrade',
      '-i',
      'kube-prometheus-stack',
      'prometheus-community/kube-prometheus-stack',
      '-n',
      this.telemetryNamespace,
      '--version',
      PROMETHEUS_STACK_VERSION,
      '-f',
      join(CONFIG_DIR, 'prometheus-values.yaml'),
      '--create-namespace',
      '--wait',
      '--set',
      `prometheus.prometheusSpec.retention=${this.retention}`,
      '--set',
      `grafana.service.type=${this.grafanaServiceType}`,
      ...this.buildNodeSelectorArgs('prometheus.prometheusSpec'),
      ...this.buildNodeSelectorArgs('grafana'),
    ];

    // Add external-dns annotations for DNS record creation
    if (this.grafanaHostname) {
      helmArgs.push(
        '--set',
        `grafana.service.annotations.external-dns\\.alpha\\.kubernetes\\.io/hostname=${this.grafanaHostname}`
      );
    }
    if (this.prometheusHostname) {
      helmArgs.push(
        '--set',
        `prometheus.service.annotations.external-dns\\.alpha\\.kubernetes\\.io/hostname=${this.prometheusHostname}`
      );
    }

    await KubernetesHelper.helm(helmArgs);

    await this.waitForDeployment('kube-prometheus-stack-operator', 120);
    await this.waitForDeployment('kube-prometheus-stack-grafana', 120);
    await this.waitForStatefulSet('prometheus-kube-prometheus-stack-prometheus', 120);
  }

  /**
   * Install Grafana dashboards as ConfigMaps
   */
  async installDashboards() {
    this.log('Installing Grafana dashboards...', 'info');

    try {
      const files = await readdir(DASHBOARDS_DIR);
      const dashboardFiles = files.filter(f => f.endsWith('.json'));

      for (const file of dashboardFiles) {
        const dashboardPath = join(DASHBOARDS_DIR, file);
        const content = await readFile(dashboardPath, 'utf8');
        const name = file.replace('.json', '');

        const configMap = {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: {
            name: `dashboard-${name}`,
            namespace: this.telemetryNamespace,
            labels: {
              grafana_dashboard: '1',
              'app.kubernetes.io/managed-by': 'agentgateway-demo',
            },
          },
          data: {
            [`${name}.json`]: content,
          },
        };

        await this.applyResource(configMap);
        this.log(`Dashboard '${name}' installed`, 'info');
      }
    } catch (error) {
      this.log(`Warning: Failed to install dashboards: ${error.message}`, 'warn');
    }
  }

  async waitForDeployment(name, timeout = 120) {
    this.log(`Waiting for deployment ${name} to be ready...`, 'info');

    try {
      await KubernetesHelper.waitForDeployment(
        this.telemetryNamespace,
        name,
        timeout,
        this.spinner
      );
    } catch (_error) {
      this.log(`Deployment ${name} may take longer to be ready`, 'warn');
    }
  }

  async waitForStatefulSet(name, timeout = 120) {
    this.log(`Waiting for statefulset ${name} to be ready...`, 'info');

    try {
      await KubernetesHelper.kubectl(
        [
          'wait',
          '--for=condition=ready',
          `statefulset/${name}`,
          '-n',
          this.telemetryNamespace,
          `--timeout=${timeout}s`,
        ],
        { spinner: this.spinner }
      );
    } catch (_error) {
      this.log(`StatefulSet ${name} may take longer to be ready`, 'warn');
    }
  }

  async waitForDaemonSet(name, timeout = 120) {
    this.log(`Waiting for daemonset ${name} to be ready...`, 'info');

    try {
      await KubernetesHelper.kubectl(
        [
          'rollout',
          'status',
          `daemonset/${name}`,
          '-n',
          this.telemetryNamespace,
          `--timeout=${timeout}s`,
        ],
        { spinner: this.spinner }
      );
    } catch (_error) {
      this.log(`DaemonSet ${name} may take longer to be ready`, 'warn');
    }
  }
}

export function createTelemetryFeature(config) {
  return new TelemetryFeature('telemetry', config);
}
