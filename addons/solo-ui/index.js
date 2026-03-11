import { Feature } from '../../src/lib/feature.js';
import { KubernetesHelper, CommandRunner } from '../../src/lib/common.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_DIR = join(__dirname, 'config');

// Solo Enterprise Management (Solo UI) Helm chart defaults
// Ref: https://docs.solo.io/agentgateway/2.1.x/install/ui/setup/#install-the-ui
const DEFAULT_SOLO_UI_MANAGEMENT_CHART_VERSION = '0.3.3';
const DEFAULT_SOLO_UI_MANAGEMENT_CHART_OCI =
  'oci://us-docker.pkg.dev/solo-public/solo-enterprise-helm/charts/management';
const RELEASE_NAME = 'solo-ui';

/**
 * Solo UI Feature (Gloo UI / Solo Enterprise for agentgateway UI)
 *
 * Installs the Solo Enterprise management UI for agentgateway to gain insight into
 * AI backends, routes, policies, tracing, and more.
 *
 * Reference: https://docs.solo.io/agentgateway/2.1.x/install/ui/setup/#install-the-ui
 *
 * This service installs:
 * - Solo Enterprise UI (solo-enterprise-ui)
 * - ClickHouse (for observability data, with configurable persistent storage)
 * - Management components
 *
 * Configuration:
 * {
 *   namespace: string,               // Default: 'agentgateway-system'
 *   managementChartVersion: string,  // Default: '0.3.3'
 *   managementChartOci: string,      // Default: OCI chart URL
 *   serviceType: string,             // Optional: e.g. 'LoadBalancer'; omit for port-forward
 *   nodeSelector: object,            // Default: {} (e.g., { nodeclass: 'worker' })
 *   tracingBackend: {                // Optional: custom tracing backend (for fan-out to Grafana)
 *     name: string,                  // Service name (default: 'solo-enterprise-telemetry-collector')
 *     namespace: string,             // Service namespace (default: same as solo-ui namespace)
 *     port: number                   // Service port (default: 4317)
 *   }
 * }
 */
export class SoloUIFeature extends Feature {
  constructor(name, config) {
    super(name, config);
    this.namespace = config.namespace || this.namespace;
    this.chartVersion = config.managementChartVersion || DEFAULT_SOLO_UI_MANAGEMENT_CHART_VERSION;
    this.chartOci = config.managementChartOci || DEFAULT_SOLO_UI_MANAGEMENT_CHART_OCI;
    this.serviceType = config.serviceType || null;
    this.nodeSelector = config.nodeSelector || {};
    this.tracingBackend = config.tracingBackend || null;
  }

  getFeaturePath() {
    return '../addons/solo-ui';
  }

  validate() {
    return true;
  }

  /**
   * Build Helm --set args for nodeSelector
   * @param {string} prefix - Helm values path prefix (e.g., 'clickhouse')
   * @returns {string[]} Array of --set arguments
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
    this.log('Installing Solo UI (Solo Enterprise for agentgateway management)...', 'info');

    await KubernetesHelper.ensureNamespace(this.namespace, this.spinner);
    this.log(`Namespace '${this.namespace}' ready`, 'info');

    await this.installManagementChart();
    await this.waitForPods();

    // Apply tracing policy with optional custom backend (e.g., fan-out-collector for Grafana)
    if (this.tracingBackend) {
      await this.applyYamlFile('tracing-policy.yaml', {
        spec: {
          frontend: {
            tracing: {
              backendRef: {
                name: this.tracingBackend.name,
                namespace: this.tracingBackend.namespace || this.namespace,
                port: this.tracingBackend.port || 4317,
              },
            },
          },
        },
      });
      this.log(
        `Tracing configured to use ${this.tracingBackend.name}.${this.tracingBackend.namespace || this.namespace}`,
        'info'
      );
    } else {
      await this.applyYamlFile('tracing-policy.yaml');
    }
    await this.applyYamlFile('reference-grant-traces.yaml');

    let accessHint;
    if (this.serviceType) {
      const address = await this.getServiceAddress('solo-enterprise-ui');
      accessHint = address
        ? `Access at http://${address}`
        : `Access via the '${this.serviceType}' service in namespace '${this.namespace}' (address pending)`;
    } else {
      accessHint = `Port-forward with: kubectl port-forward service/solo-enterprise-ui -n ${this.namespace} 4000:80`;
    }
    this.log(`Solo UI installed successfully. ${accessHint}`, 'success');
  }

  /**
   * Install the Solo Enterprise management Helm chart (Solo UI + ClickHouse)
   */
  async installManagementChart() {
    this.log('Installing management Helm chart (Solo UI)...', 'info');

    const valuesFile = join(CONFIG_DIR, 'values.yaml');

    const helmArgs = [
      'upgrade',
      '-i',
      RELEASE_NAME,
      this.chartOci,
      '-n',
      this.namespace,
      '--version',
      this.chartVersion,
      '-f',
      valuesFile,
      '--create-namespace',
      '--wait',
      '--timeout',
      '10m',
      ...(this.serviceType ? ['--set', `service.type=${this.serviceType}`] : []),
      ...this.buildNodeSelectorArgs('ui'),
      ...this.buildNodeSelectorArgs('clickhouse'),
    ];

    await KubernetesHelper.helm(helmArgs, { spinner: this.spinner });

    this.log('Management Helm chart installed', 'info');
  }

  /**
   * Wait for management and UI pods to be ready
   */
  async waitForPods() {
    this.log('Waiting for management and UI pods...', 'info');

    // Wait for solo-enterprise-ui deployment
    try {
      await KubernetesHelper.waitForDeployment(
        this.namespace,
        'solo-enterprise-ui',
        300,
        this.spinner
      );
    } catch (error) {
      this.log(`solo-enterprise-ui may still be starting: ${error.message}`, 'warn');
    }

    // ClickHouse may be a StatefulSet (e.g. management-clickhouse-shard0-0)
    try {
      await KubernetesHelper.kubectl(
        [
          'wait',
          '--for=condition=ready',
          'pod',
          '-l',
          'app.kubernetes.io/name=clickhouse',
          '-n',
          this.namespace,
          '--timeout=300s',
        ],
        { ignoreError: true, spinner: this.spinner }
      );
    } catch (error) {
      this.log('ClickHouse pods may use different labels; continuing', 'warn');
    }

    this.log('Solo UI and management components are ready', 'info');
  }

  async getServiceAddress(serviceName) {
    const jsonpathArgs = field => [
      'get',
      'svc',
      serviceName,
      '-n',
      this.namespace,
      '-o',
      `jsonpath={.status.loadBalancer.ingress[0].${field}}`,
    ];
    const ipResult = await KubernetesHelper.kubectl(jsonpathArgs('ip'), { ignoreError: true });
    const address = (ipResult.stdout || '').trim();
    if (address) return address;

    const hostResult = await KubernetesHelper.kubectl(jsonpathArgs('hostname'), {
      ignoreError: true,
    });
    return (hostResult.stdout || '').trim() || null;
  }

  async cleanup() {
    this.log('Cleaning up Solo UI (management release)...', 'info');

    // Delete EnterpriseAgentgatewayPolicies and ReferenceGrants
    await this.deleteResource('EnterpriseAgentgatewayPolicy', 'tracing-solo-ui', this.namespace);
    await this.deleteResource(
      'ReferenceGrant',
      'allow-otel-collector-traces-access-solo-ui',
      this.namespace
    );

    try {
      await CommandRunner.run('helm', ['uninstall', RELEASE_NAME, '-n', this.namespace, '--wait'], {
        ignoreError: true,
      });
      this.log('Management Helm release uninstalled', 'info');
    } catch (error) {
      // Ignore
    }

    this.log('Solo UI cleaned up', 'success');
  }
}

export function createSoloUIFeature(config) {
  return new SoloUIFeature('solo-ui', config);
}
