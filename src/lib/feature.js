import { Logger, KubernetesHelper, SpinnerLogger } from './common.js';
import yaml from 'js-yaml';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');
const DEFAULT_NAMESPACE = process.env.AGENTGATEWAY_NAMESPACE || 'agentgateway-system';

/**
 * Base class for all features
 * Features are modular components that configure specific agentgateway capabilities
 */
export class Feature {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    // Allow namespace to be configured per feature, with fallback to default
    this.namespace = config.namespace || DEFAULT_NAMESPACE;
    // Spinner for coordinated logging
    this.spinner = null;
    // Dry run: collect YAML instead of applying (set by FeatureManager when options.dryRun)
    this.dryRun = !!config.dryRun;
    this._dryRunYaml = this.dryRun ? [] : undefined;
  }

  /**
   * Set the spinner for this feature (used by FeatureManager)
   */
  setSpinner(spinner) {
    this.spinner = spinner;
  }

  /**
   * Log a message (uses spinner if available)
   * Note: info-level messages are suppressed when spinner is active; all logging suppressed when dryRun
   */
  log(message, level = 'info') {
    if (this.dryRun) return;
    if (this.spinner && this.spinner.isSpinning) {
      // Suppress info messages during spinner operation to avoid clutter
      if (level !== 'info') {
        this.spinner.logWhileSpinning(message, level);
      }
    } else {
      Logger[level](message);
    }
  }

  /**
   * Deploy the feature
   * Must be implemented by subclasses
   */
  async deploy() {
    throw new Error(`deploy() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Clean up the feature
   * Must be implemented by subclasses
   */
  async cleanup() {
    throw new Error(`cleanup() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Validate feature configuration
   * Can be overridden by subclasses
   */
  validate() {
    return true;
  }

  /**
   * Helper: Apply Kubernetes resource (or collect YAML when dryRun)
   */
  async applyResource(resource) {
    const yamlContent = yaml.dump(resource, { lineWidth: -1, indent: 2 });
    if (this.dryRun && this._dryRunYaml) {
      this._dryRunYaml.push(yamlContent);
      return;
    }
    await KubernetesHelper.applyYaml(yamlContent, this.spinner);
  }

  /**
   * Helper: Delete Kubernetes resource
   */
  async deleteResource(kind, name, namespace = this.namespace) {
    try {
      await KubernetesHelper.kubectl([
        'delete',
        kind,
        name,
        '-n',
        namespace,
        '--ignore-not-found=true',
      ]);
    } catch (error) {
      // Silently ignore deletion errors during cleanup
    }
  }

  /**
   * Helper: Create ConfigMap
   */
  async createConfigMap(name, data, labels = {}) {
    const configMap = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
          ...labels,
        },
      },
      data,
    };

    await this.applyResource(configMap);
  }

  /**
   * Helper: Create Agentgateway TrafficPolicy CRD
   */
  async createTrafficPolicy(name, spec, labels = {}) {
    const policy = {
      apiVersion: 'kgateway.dev/v1alpha1',
      kind: 'TrafficPolicy',
      metadata: {
        name,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
          ...labels,
        },
      },
      spec,
    };

    await this.applyResource(policy);
  }

  /**
   * Helper: Load and apply YAML file from feature config directory
   * @param {string} filename - Name of the YAML file (relative to feature's config dir)
   * @param {Object} overrides - Optional overrides to merge into the YAML
   */
  async applyYamlFile(filename, overrides = {}) {
    // Use getFeaturePath() if available, otherwise use just the feature name
    const featurePath = typeof this.getFeaturePath === 'function' 
      ? this.getFeaturePath() 
      : this.name;
    const configPath = join(PROJECT_ROOT, 'features', featurePath, 'config', filename);
    
    try {
      const content = await readFile(configPath, 'utf8');
      let resource = yaml.load(content);

      // Update namespace in the resource if it differs from the YAML default
      if (resource.metadata && resource.metadata.namespace !== this.namespace) {
        resource.metadata.namespace = this.namespace;
      }

      // Merge overrides (deep merge)
      if (Object.keys(overrides).length > 0) {
        resource = this.deepMerge(resource, overrides);
      }

      await this.applyResource(resource);
    } catch (error) {
      throw new Error(`Failed to apply YAML file ${filename}: ${error.message}`);
    }
  }

  /**
   * Helper: Deep merge two objects
   * If a value is undefined, it removes the key from the target
   */
  deepMerge(target, source) {
    const output = { ...target };

    for (const key in source) {
      if (source[key] === undefined) {
        // Remove the key if value is undefined
        delete output[key];
      } else if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        output[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        output[key] = source[key];
      }
    }

    return output;
  }
}

/**
 * Feature Manager - Orchestrates feature deployment
 */
const DEFAULT_GATEWAY_NAME = 'agentgateway';

export class FeatureManager {
  static features = new Map();
  static defaultNamespace = DEFAULT_NAMESPACE;
  /** Gateway referenced by HTTPRoutes: { name, namespace }. Set by gateway feature or default. */
  static gatewayRef = null;

  /**
   * Register a feature
   */
  static register(name, featureClass) {
    this.features.set(name, featureClass);
  }

  /**
   * Set the default namespace for all features
   */
  static setDefaultNamespace(namespace) {
    this.defaultNamespace = namespace;
  }

  /**
   * Get the default namespace
   */
  static getDefaultNamespace() {
    return this.defaultNamespace;
  }

  /**
   * Set the Gateway referenced by HTTPRoute parentRefs (used when gateway feature overrides default).
   * @param {{ name?: string, namespace?: string }} ref - name and/or namespace; omitted fields keep current or default
   */
  static setGatewayRef(ref = {}) {
    const current = this.getGatewayRef();
    this.gatewayRef = {
      name: ref.name ?? current.name,
      namespace: ref.namespace ?? current.namespace,
    };
  }

  /**
   * Get the Gateway ref for HTTPRoute parentRefs. Defaults to agentgateway in default namespace.
   * @returns {{ name: string, namespace: string }}
   */
  static getGatewayRef() {
    if (this.gatewayRef) {
      return { ...this.gatewayRef };
    }
    return {
      name: DEFAULT_GATEWAY_NAME,
      namespace: this.defaultNamespace,
    };
  }

  /**
   * Check if a feature is registered
   */
  static has(name) {
    return this.features.has(name);
  }

  /**
   * Get a registered feature
   */
  static get(name) {
    return this.features.get(name);
  }

  /**
   * Deploy a feature (or collect YAML when options.dryRun)
   * @param {string} name - Feature name
   * @param {Object} config - Feature config
   * @param {Object} [options] - Options (dryRun: true to return generated YAML instead of applying)
   * @returns {Promise<string[]|void>} When dryRun, returns array of YAML document strings
   */
  static async deploy(name, config = {}, options = {}) {
    const FeatureClass = this.get(name);

    if (!FeatureClass) {
      throw new Error(`Feature '${name}' is not registered`);
    }

    // Merge default namespace if not specified in config
    const finalConfig = {
      namespace: this.defaultNamespace,
      ...config,
    };

    if (options.dryRun) {
      finalConfig.dryRun = true;
    }

    const feature = new FeatureClass(name, finalConfig);
    const spinner = new SpinnerLogger();

    try {
      // Validate configuration (skip when dryRun - we only need to generate YAML)
      if (!options.dryRun && !feature.validate()) {
        throw new Error(`Invalid configuration for feature '${name}'`);
      }

      if (options.dryRun) {
        await feature.deploy();
        return feature._dryRunYaml || [];
      }

      const namespaceMsg = feature.namespace !== this.defaultNamespace 
        ? ` (namespace: ${feature.namespace})` 
        : '';
      spinner.start(`Deploying: ${name}${namespaceMsg}...`);

      // Pass spinner to feature
      feature.setSpinner(spinner);

      // Ensure namespace exists before applying any resources
      await KubernetesHelper.ensureNamespace(feature.namespace, spinner);

      // Deploy the feature
      await feature.deploy();

      spinner.succeed(`Feature '${name}' deployed successfully`);
    } catch (error) {
      spinner.fail(`Failed to deploy feature '${name}'`);
      throw error;
    }
  }

  /**
   * Clean up a feature
   */
  static async cleanup(name, config = {}) {
    const FeatureClass = this.get(name);

    if (!FeatureClass) {
      Logger.warn(`Feature '${name}' is not registered, skipping cleanup`);
      return;
    }

    // Merge default namespace if not specified in config
    const finalConfig = {
      namespace: this.defaultNamespace,
      ...config,
    };

    const feature = new FeatureClass(name, finalConfig);
    const spinner = new SpinnerLogger();

    try {
      const namespaceMsg = feature.namespace !== this.defaultNamespace 
        ? ` (namespace: ${feature.namespace})` 
        : '';
      spinner.start(`Cleaning up feature: ${name}${namespaceMsg}...`);

      // Pass spinner so feature can update text instead of logging (avoids interleaved output)
      feature.setSpinner(spinner);

      // Clean up the feature
      await feature.cleanup();

      spinner.succeed(`Feature '${name}' cleaned up successfully`);
    } catch (error) {
      spinner.fail(`Failed to clean up feature '${name}'`);
      throw error;
    }
  }

  /**
   * Deploy multiple features
   */
  static async deployAll(features) {
    Logger.info(`Deploying ${features.length} feature(s)...`);

    for (const { name, config } of features) {
      await this.deploy(name, config);
    }

    Logger.success('All features deployed successfully');
  }

  /**
   * Clean up multiple features
   */
  static async cleanupAll(features) {
    Logger.info(`Cleaning up ${features.length} feature(s)...`);

    for (const { name, config } of features) {
      await this.cleanup(name, config);
    }

    Logger.success('All features cleaned up successfully');
  }

  /**
   * List all registered features
   */
  static list() {
    return Array.from(this.features.keys());
  }
}

