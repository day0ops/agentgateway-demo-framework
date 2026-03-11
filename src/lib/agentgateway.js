import { Logger, KubernetesHelper, SpinnerLogger } from './common.js';
import { readFile, writeFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');
const DEFAULT_GATEWAY_YAML = join(PROJECT_ROOT, 'config', 'gateway', 'default-gateway.yaml');

const AGENTGATEWAY_NAMESPACE = process.env.AGENTGATEWAY_NAMESPACE || 'agentgateway-system';
const AGENTGATEWAY_RELEASE = process.env.AGENTGATEWAY_RELEASE || 'enterprise-agentgateway';
const AGENTGATEWAY_VERSION = process.env.AGENTGATEWAY_VERSION || '2.1.1';
const GATEWAY_API_VERSION = process.env.GATEWAY_API_VERSION || 'v1.4.0';
const AGENTGATEWAY_OCI_REGISTRY =
  'oci://us-docker.pkg.dev/solo-public/enterprise-agentgateway/charts';
const ENTERPRISE_AGW_LICENSE_KEY = process.env.ENTERPRISE_AGW_LICENSE_KEY;

export class AgentGatewayManager {
  /**
   * Check if license key is available
   * @throws {Error} If license key is not provided
   */
  static checkLicenseKey() {
    if (!ENTERPRISE_AGW_LICENSE_KEY) {
      throw new Error(
        'ENTERPRISE_AGW_LICENSE_KEY environment variable is required for enterprise-agentgateway installation.\n' +
          'Please set it before running the installation:\n' +
          '  export ENTERPRISE_AGW_LICENSE_KEY="your-license-key"'
      );
    }
  }

  /**
   * Add license key to Helm arguments
   * @param {Array} helmArgs - Array of Helm arguments to modify
   */
  static addLicenseKeyToHelmArgs(helmArgs) {
    if (ENTERPRISE_AGW_LICENSE_KEY) {
      helmArgs.push('--set', `licensing.licenseKey=${ENTERPRISE_AGW_LICENSE_KEY}`);
    }
  }
  static async installGatewayAPICRDs(
    gatewayApiVersion = GATEWAY_API_VERSION,
    channel = 'standard'
  ) {
    const spinner = new SpinnerLogger();
    const resolvedChannel = channel === 'experimental' ? 'experimental' : 'standard';
    spinner.start(`Installing Gateway API CRDs ${gatewayApiVersion} (${resolvedChannel})...`);

    try {
      await KubernetesHelper.kubectl([
        'apply',
        '--server-side',
        '-f',
        `https://github.com/kubernetes-sigs/gateway-api/releases/download/${gatewayApiVersion}/${resolvedChannel}-install.yaml`,
      ]);
      spinner.succeed(`Gateway API CRDs ${gatewayApiVersion} (${resolvedChannel}) installed`);
    } catch (error) {
      spinner.fail('Failed to install Gateway API CRDs');
      throw error;
    }
  }

  static resolveVersionAndRegistry(profile) {
    const version = profile?.agentgateway?.version ?? AGENTGATEWAY_VERSION;
    const ociRegistry = profile?.agentgateway?.ociRegistry ?? AGENTGATEWAY_OCI_REGISTRY;
    const gatewayApiVersion = profile?.gatewayApi?.version ?? GATEWAY_API_VERSION;
    const gatewayApiChannel = profile?.gatewayApi?.channel ?? 'standard';
    const crdsVersion = profile?.['agentgateway-crds']?.version ?? version;
    const crdsOciRegistry = profile?.['agentgateway-crds']?.ociRegistry ?? ociRegistry;
    return {
      version,
      ociRegistry,
      gatewayApiVersion,
      gatewayApiChannel,
      crdsVersion,
      crdsOciRegistry,
    };
  }

  static async installAgentGatewayCRDs(
    version = AGENTGATEWAY_VERSION,
    ociRegistry = AGENTGATEWAY_OCI_REGISTRY
  ) {
    const spinner = new SpinnerLogger();
    spinner.start(`Installing agentgateway CRDs ${version}...`);

    try {
      await KubernetesHelper.ensureNamespace(AGENTGATEWAY_NAMESPACE, spinner);

      try {
        await KubernetesHelper.helm([
          'upgrade',
          '-i',
          '--create-namespace',
          '--namespace',
          AGENTGATEWAY_NAMESPACE,
          '--version',
          version,
          'enterprise-agentgateway-crds',
          `${ociRegistry}/enterprise-agentgateway-crds`,
        ]);
        spinner.succeed(`agentgateway CRDs ${version} installed`);
      } catch (error) {
        spinner.fail('Failed to install agentgateway CRDs');
        // Log the actual error for debugging
        if (error.stdout) {
          Logger.error(`Helm output: ${error.stdout}`);
        }
        if (error.stderr) {
          Logger.error(`Helm error: ${error.stderr}`);
        }
        if (error.message) {
          Logger.error(`Error: ${error.message}`);
        }
        throw error;
      }
    } catch (error) {
      spinner.fail('Failed to install agentgateway CRDs');
      throw error;
    }
  }

  static async install(profileFile = null) {
    const spinner = new SpinnerLogger();
    let tempValuesFile = null;
    let profile = null;

    if (profileFile) {
      const profileContent = await readFile(profileFile, 'utf8');
      profile = yaml.load(profileContent);
    }
    const {
      version,
      ociRegistry,
      gatewayApiVersion,
      gatewayApiChannel,
      crdsVersion,
      crdsOciRegistry,
    } = this.resolveVersionAndRegistry(profile);

    try {
      this.checkLicenseKey();

      await this.installGatewayAPICRDs(gatewayApiVersion, gatewayApiChannel);
      await this.installAgentGatewayCRDs(crdsVersion, crdsOciRegistry);

      const profileMsg = profileFile ? ' with profile' : '';
      spinner.start(`Installing agentgateway ${version}${profileMsg}...`);

      const helmArgs = [
        'upgrade',
        '-i',
        '-n',
        AGENTGATEWAY_NAMESPACE,
        AGENTGATEWAY_RELEASE,
        `${ociRegistry}/enterprise-agentgateway`,
        '--version',
        version,
      ];

      this.addLicenseKeyToHelmArgs(helmArgs);

      if (profileFile && profile) {
        if (profile.helmValues) {
          tempValuesFile = join(tmpdir(), `agentgateway-values-${Date.now()}.yaml`);
          const helmValuesYaml = yaml.dump(profile.helmValues);
          await writeFile(tempValuesFile, helmValuesYaml, 'utf8');
          helmArgs.push('-f', tempValuesFile);
        } else {
          helmArgs.push('-f', profileFile);
        }
      }

      helmArgs.push('--wait', '--timeout', '5m');

      try {
        await KubernetesHelper.helm(helmArgs);
        spinner.succeed('agentgateway installed successfully');
      } catch (error) {
        spinner.fail('Failed to install agentgateway Helm chart');
        // Log the actual error for debugging
        if (error.stdout) {
          Logger.error(`Helm output: ${error.stdout}`);
        }
        if (error.stderr) {
          Logger.error(`Helm error: ${error.stderr}`);
        }
        if (error.message) {
          Logger.error(`Error: ${error.message}`);
        }
        throw error;
      }

      // Wait for deployments - enterprise-agentgateway creates a controller deployment
      spinner.start('Waiting for agentgateway components to be ready...');
      try {
        // The deployment name for enterprise-agentgateway is typically the release name
        await KubernetesHelper.waitForDeployment(
          AGENTGATEWAY_NAMESPACE,
          AGENTGATEWAY_RELEASE,
          300,
          spinner
        );
        spinner.succeed('All components are ready');
      } catch (error) {
        // Deployment might have a different name, try to find it
        Logger.warn(
          `Deployment ${AGENTGATEWAY_RELEASE} not found, checking for other deployments...`
        );
        const deployments = await KubernetesHelper.kubectl(
          ['get', 'deployments', '-n', AGENTGATEWAY_NAMESPACE, '-o', 'name'],
          { ignoreError: true }
        );

        if (deployments.stdout && deployments.stdout.trim()) {
          Logger.info(`Found deployments: ${deployments.stdout.trim()}`);
          spinner.succeed('Components are ready (deployment check skipped)');
        } else {
          spinner.fail('No deployments found');
          throw new Error('No agentgateway deployments found in namespace');
        }
      }

      // Step 4: Apply additional resources from profile if any
      if (profile && profile.resources && profile.resources.length > 0) {
        spinner.start(
          `Applying ${profile.resources.length} additional resource(s) from profile...`
        );
        const profileDir = profileFile ? dirname(profileFile) : null;
        await this.applyProfileResources(profile.resources, profileDir, spinner);
        spinner.succeed('Profile resources applied successfully');
      }

      // Step 5: Process feature gates
      if (profile?.featureGates) {
        await this.processFeatureGates(profile.featureGates, spinner);
      }
    } catch (error) {
      spinner.fail('Failed to install agentgateway');
      // Clear spinner before logging detailed errors
      spinner.clear();

      // Log error details for debugging
      if (error.message) {
        Logger.error(`Installation error: ${error.message}`);
      }

      // Log Helm-specific errors if present
      if (error.stdout) {
        Logger.error(`Helm output: ${error.stdout}`);
      }
      if (error.stderr) {
        Logger.error(`Helm error: ${error.stderr}`);
      }

      // If no specific error details, show the error message
      if (!error.stdout && !error.stderr && error.message) {
        Logger.error(`Error: ${error.message}`);
      }

      // Show stack trace in debug mode
      if (error.stack && process.env.DEBUG) {
        Logger.debug(`Stack trace: ${error.stack}`);
      }

      throw error;
    } finally {
      // Clean up temporary values file
      if (tempValuesFile) {
        try {
          await unlink(tempValuesFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Apply additional Kubernetes resources from a profile
   * @param {Array} resources - Array of resource file paths (strings) or resource objects
   * @param {string} profileDir - Directory path where the profile file is located
   * @param {SpinnerLogger} spinner - Spinner logger
   */
  static async applyProfileResources(resources, profileDir, spinner) {
    if (!resources || resources.length === 0) {
      return;
    }

    for (const resource of resources) {
      try {
        let resourceYaml;
        let resourceName = 'unknown';

        if (typeof resource === 'string') {
          const resourcePath = profileDir ? join(profileDir, resource) : resource;
          resourceName = resource;
          resourceYaml = await readFile(resourcePath, 'utf8');

          const docs = yaml.loadAll(resourceYaml).filter(Boolean);
          resourceName = docs
            .map(d => `${d.kind || 'Resource'} ${d.metadata?.name || resource}`)
            .join(', ');
        } else {
          resourceYaml = yaml.dump(resource);
          resourceName = `${resource.kind || 'Resource'} ${resource.metadata?.name || 'unknown'}`;
        }

        await KubernetesHelper.kubectl(['apply', '-f', '-'], { input: resourceYaml });
        Logger.debug(`Applied ${resourceName}`);
      } catch (error) {
        const resourceName =
          typeof resource === 'string'
            ? resource
            : `${resource.kind || 'Resource'} ${resource.metadata?.name || 'unknown'}`;
        throw new Error(`Failed to apply ${resourceName}: ${error.message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Feature gates
  // ---------------------------------------------------------------------------

  static async processFeatureGates(featureGates, spinner) {
    if (featureGates.injectExtAuthCustomCaCert) {
      await this.processInjectCaCert(featureGates.injectExtAuthCustomCaCert, spinner);
    }
  }

  static async processInjectCaCert(config, spinner) {
    if (!config.enabled) return;

    const sourceSecret = config.sourceSecret || 'keycloak-tls';
    const sourceNamespace = config.sourceNamespace || 'keycloak';
    const caSecretName = config.caSecretName || 'keycloak-ca';

    spinner.start('Copying CA certificate to agentgateway namespace...');

    const caCrt = await this.extractCaCertFromSecret(sourceSecret, sourceNamespace);
    if (!caCrt) {
      spinner.warn(
        `Could not extract CA certificate from ${sourceNamespace}/${sourceSecret} — skipping`
      );
      return;
    }

    await this.createCaSecret(caSecretName, caCrt);

    spinner.succeed(`CA secret '${caSecretName}' created in ${AGENTGATEWAY_NAMESPACE}`);
  }

  static async extractCaCertFromSecret(secretName, namespace) {
    try {
      const result = await KubernetesHelper.kubectl([
        'get',
        'secret',
        secretName,
        '-n',
        namespace,
        '-o',
        'jsonpath={.data.ca\\.crt}',
      ]);
      let b64 = (result.stdout || '').trim();

      if (!b64) {
        const fallback = await KubernetesHelper.kubectl([
          'get',
          'secret',
          secretName,
          '-n',
          namespace,
          '-o',
          'jsonpath={.data.tls\\.crt}',
        ]);
        b64 = (fallback.stdout || '').trim();
      }

      if (!b64) return null;
      return Buffer.from(b64, 'base64').toString('utf8');
    } catch (error) {
      Logger.warn(`Failed to read TLS secret ${namespace}/${secretName}: ${error.message}`);
      return null;
    }
  }

  static async createCaSecret(name, caCrt) {
    const secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name,
        namespace: AGENTGATEWAY_NAMESPACE,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature-gate': 'injectExtAuthCustomCaCert',
        },
      },
      type: 'Opaque',
      stringData: { 'ca.crt': caCrt },
    };

    const yamlContent = yaml.dump(secret, { lineWidth: -1, indent: 2 });
    await KubernetesHelper.applyYaml(yamlContent);
  }

  static async upgrade(version = AGENTGATEWAY_VERSION) {
    Logger.info(`Upgrading agentgateway to version ${version}...`);

    const spinner = new SpinnerLogger();
    spinner.start('Upgrading agentgateway...');

    try {
      // Pre-check: Verify license key is provided
      this.checkLicenseKey();

      // Upgrade CRDs first
      await KubernetesHelper.helm([
        'upgrade',
        '-i',
        '--namespace',
        AGENTGATEWAY_NAMESPACE,
        '--version',
        version,
        'enterprise-agentgateway-crds',
        `${AGENTGATEWAY_OCI_REGISTRY}/enterprise-agentgateway-crds`,
      ]);

      // Upgrade agentgateway
      const helmArgs = [
        'upgrade',
        AGENTGATEWAY_RELEASE,
        `${AGENTGATEWAY_OCI_REGISTRY}/enterprise-agentgateway`,
        '--namespace',
        AGENTGATEWAY_NAMESPACE,
        '--version',
        version,
        '--reuse-values',
        '--wait',
        '--timeout',
        '5m',
      ];

      // Add license key to Helm arguments
      this.addLicenseKeyToHelmArgs(helmArgs);

      await KubernetesHelper.helm(helmArgs);

      spinner.succeed(`agentgateway upgraded to version ${version}`);
    } catch (error) {
      spinner.fail('Failed to upgrade agentgateway');
      throw error;
    }
  }

  static async verify() {
    Logger.info('Verifying agentgateway installation...');

    try {
      // Check if Helm release exists
      const result = await KubernetesHelper.helm(
        ['list', '-n', AGENTGATEWAY_NAMESPACE, '--filter', AGENTGATEWAY_RELEASE, '-o', 'json'],
        { ignoreError: true }
      );

      if (result.stdout) {
        const releases = JSON.parse(result.stdout);
        if (releases && releases.length > 0) {
          Logger.success('agentgateway is installed');
          return true;
        }
      }

      Logger.error('agentgateway is not installed');
      return false;
    } catch (error) {
      Logger.error('Failed to verify agentgateway');
      Logger.debug(`Verification error: ${error.message}`);
      return false;
    }
  }

  static async enable() {
    Logger.info('Enabling agentgateway integration...');

    const spinner = new SpinnerLogger();
    spinner.start('Enabling agentgateway...');

    try {
      // Pre-check: Verify license key is provided
      this.checkLicenseKey();

      const helmArgs = [
        'upgrade',
        AGENTGATEWAY_RELEASE,
        `${AGENTGATEWAY_OCI_REGISTRY}/enterprise-agentgateway`,
        '--namespace',
        AGENTGATEWAY_NAMESPACE,
        '--reuse-values',
        '--wait',
        '--timeout',
        '5m',
      ];

      // Add license key to Helm arguments
      this.addLicenseKeyToHelmArgs(helmArgs);

      await KubernetesHelper.helm(helmArgs);

      spinner.succeed('agentgateway integration enabled');
    } catch (error) {
      spinner.fail('Failed to enable agentgateway');
      throw error;
    }
  }

  static async findProfileGatewayClass(profile, profileDir) {
    if (!profile?.resources?.length) return null;
    for (const resource of profile.resources) {
      try {
        let docs;
        if (typeof resource === 'string') {
          const resourcePath = profileDir ? join(profileDir, resource) : resource;
          docs = yaml.loadAll(await readFile(resourcePath, 'utf8'));
        } else {
          docs = [resource];
        }
        for (const parsed of docs) {
          if (parsed?.kind === 'GatewayClass') return parsed;
        }
      } catch {
        // skip unreadable resources
      }
    }
    return null;
  }

  static async findEnterpriseParameters(profile, profileDir) {
    if (!profile?.resources?.length) return null;
    for (const resource of profile.resources) {
      try {
        let docs;
        if (typeof resource === 'string') {
          const resourcePath = profileDir ? join(profileDir, resource) : resource;
          const content = await readFile(resourcePath, 'utf8');
          docs = yaml.loadAll(content);
        } else {
          docs = [resource];
        }
        for (const parsed of docs) {
          if (
            parsed?.kind === 'EnterpriseAgentgatewayParameters' &&
            !parsed?.spec?.sharedExtensions
          ) {
            return parsed;
          }
        }
      } catch {
        // skip unreadable resources
      }
    }
    return null;
  }

  static async installProxy(profileFile = null) {
    const spinner = new SpinnerLogger();

    const isInstalled = await this.verify();
    if (!isInstalled) {
      Logger.error('agentgateway is not installed. Run: agw base install first');
      throw new Error('agentgateway not installed');
    }

    spinner.start('Creating agentgateway Gateway...');

    let gatewayYaml = await readFile(DEFAULT_GATEWAY_YAML, 'utf8');
    const gateway = yaml.load(gatewayYaml);

    // Ensure namespace matches AGENTGATEWAY_NAMESPACE
    if (gateway.metadata.namespace !== AGENTGATEWAY_NAMESPACE) {
      gateway.metadata.namespace = AGENTGATEWAY_NAMESPACE;
    }

    // Wire parametersRef if profile has an EnterpriseAgentgatewayParameters resource
    let profile = null;
    let profileDir = null;
    if (profileFile) {
      profile = yaml.load(await readFile(profileFile, 'utf8'));
      profileDir = dirname(profileFile);
    }
    // Use custom GatewayClass from profile if defined
    const profileGatewayClass = await this.findProfileGatewayClass(profile, profileDir);
    if (profileGatewayClass) {
      gateway.spec.gatewayClassName = profileGatewayClass.metadata.name;
      spinner.info(`Using GatewayClass '${profileGatewayClass.metadata.name}' from profile`);
    }

    // Wire Gateway-level parameters (logging, etc.)
    const enterpriseParams = await this.findEnterpriseParameters(profile, profileDir);
    if (enterpriseParams) {
      const paramsName = enterpriseParams.metadata?.name;
      gateway.spec = gateway.spec || {};
      gateway.spec.infrastructure = {
        parametersRef: {
          name: paramsName,
          group: 'enterpriseagentgateway.solo.io',
          kind: 'EnterpriseAgentgatewayParameters',
        },
      };
      spinner.info(`Attaching EnterpriseAgentgatewayParameters '${paramsName}' to Gateway`);
    }

    gatewayYaml = yaml.dump(gateway, { lineWidth: -1, indent: 2 });
    await KubernetesHelper.applyYaml(gatewayYaml, spinner);
    spinner.succeed('agentgateway Gateway created');

    // Wait for deployment
    spinner.start('Waiting for agentgateway proxy to be ready...');
    await KubernetesHelper.waitForDeployment(AGENTGATEWAY_NAMESPACE, 'agentgateway', 300, spinner);
    spinner.succeed('agentgateway proxy is ready');

    // Get gateway address
    try {
      const address = await KubernetesHelper.getLoadBalancerAddress(
        AGENTGATEWAY_NAMESPACE,
        'agentgateway',
        60
      );
      Logger.success(`Gateway address: ${address}`);
      console.log(`export AGENTGATEWAY_ADDRESS=${address}`);
    } catch {
      Logger.warn('LoadBalancer address not yet assigned');
      Logger.info('For local testing, use port-forwarding:');
      Logger.info(
        `  kubectl port-forward -n ${AGENTGATEWAY_NAMESPACE} deployment/agentgateway 8080:8080`
      );
    }
  }

  static async status() {
    Logger.info('Checking agentgateway status...');

    try {
      const result = await KubernetesHelper.helm(['list', '-n', AGENTGATEWAY_NAMESPACE], {
        ignoreError: true,
      });

      if (!result.stdout.includes(AGENTGATEWAY_RELEASE)) {
        Logger.error('agentgateway is not installed');
        return;
      }

      console.log('\nHelm release:');
      const releaseResult = await KubernetesHelper.helm(['list', '-n', AGENTGATEWAY_NAMESPACE]);
      console.log(releaseResult.stdout);

      console.log('\nDeployments:');
      const deploymentsResult = await KubernetesHelper.kubectl([
        'get',
        'deployments',
        '-n',
        AGENTGATEWAY_NAMESPACE,
      ]);
      console.log(deploymentsResult.stdout);

      console.log('\nServices:');
      const servicesResult = await KubernetesHelper.kubectl([
        'get',
        'services',
        '-n',
        AGENTGATEWAY_NAMESPACE,
      ]);
      console.log(servicesResult.stdout);

      console.log('\nGateways:');
      const gatewaysResult = await KubernetesHelper.kubectl(
        ['get', 'gateways', '-n', AGENTGATEWAY_NAMESPACE],
        { ignoreError: true }
      );
      console.log(gatewaysResult.stdout || 'No gateways found');
    } catch (error) {
      Logger.error('Failed to get status');
      throw error;
    }
  }

  static async uninstall() {
    Logger.info('Uninstalling agentgateway...');

    try {
      const result = await KubernetesHelper.helm(['list', '-n', AGENTGATEWAY_NAMESPACE], {
        ignoreError: true,
      });

      if (result.stdout.includes(AGENTGATEWAY_RELEASE)) {
        await KubernetesHelper.helm([
          'uninstall',
          AGENTGATEWAY_RELEASE,
          '-n',
          AGENTGATEWAY_NAMESPACE,
          '--wait',
        ]);
        Logger.success('agentgateway uninstalled');
      } else {
        Logger.warn('agentgateway is not installed');
      }

      // Clean up namespace
      try {
        await KubernetesHelper.kubectl(['get', 'namespace', AGENTGATEWAY_NAMESPACE], {
          ignoreError: true,
        });
        Logger.info(`Deleting namespace ${AGENTGATEWAY_NAMESPACE}...`);
        await KubernetesHelper.kubectl([
          'delete',
          'namespace',
          AGENTGATEWAY_NAMESPACE,
          '--wait=false',
        ]);
        Logger.success('Namespace deletion initiated');
      } catch {
        // Namespace doesn't exist
      }
    } catch (error) {
      Logger.error('Failed to uninstall agentgateway');
      throw error;
    }
  }
}
