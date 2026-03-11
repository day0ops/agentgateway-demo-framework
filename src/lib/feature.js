import { Logger, KubernetesHelper, SpinnerLogger } from './common.js';
import yaml from 'js-yaml';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');
const DEFAULT_NAMESPACE = process.env.AGENTGATEWAY_NAMESPACE || 'agentgateway-system';
const IMAGE_REPO = process.env.IMAGE_REPO || '';

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
   * Resolve container image with IMAGE_REPO prefix if set.
   * Skips prefixing if image already contains a registry (has a slash before the first colon).
   * @param {string} image - Image name (e.g., 'stock-server-mcp:latest')
   * @returns {string} Resolved image (e.g., 'myregistry.com/stock-server-mcp:latest')
   */
  static resolveImage(image) {
    if (!IMAGE_REPO || !image) return image;
    const slashIndex = image.indexOf('/');
    const colonIndex = image.indexOf(':');
    const hasRegistry = slashIndex !== -1 && (colonIndex === -1 || slashIndex < colonIndex);
    if (hasRegistry) return image;
    return `${IMAGE_REPO}/${image}`;
  }

  /**
   * Helper: Apply Kubernetes resource (or collect YAML when dryRun)
   */
  async applyResource(resource) {
    // Check if this should be deferred to PolicyRegistry
    if (resource.kind === 'EnterpriseAgentgatewayPolicy' && PolicyRegistry.isEnabled()) {
      const registered = PolicyRegistry.register(resource, this.name, this.namespace);
      if (registered) {
        // Policy registered for deferred merge+apply; don't add to dryRunYaml
        return;
      }
    }

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
    const featurePath =
      typeof this.getFeaturePath === 'function' ? this.getFeaturePath() : this.name;
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
 * Policy Registry - Collects and merges EnterpriseAgentgatewayPolicy resources
 * for staged application at the end of use case deployment.
 *
 * This feature is enabled by default but can be disabled via:
 * - Environment variable: DISABLE_POLICY_COALESCING=true
 *
 * When disabled, each feature applies its own EnterpriseAgentgatewayPolicy directly.
 */
export class PolicyRegistry {
  static policies = new Map(); // Map<targetRefKey, policyEntry>
  static contributors = new Map(); // Map<targetRefKey, Set<featureName>>
  static enabled = false;

  /**
   * Check if policy coalescing feature is available (not disabled via env var)
   */
  static isCoalescingEnabled() {
    return process.env.DISABLE_POLICY_COALESCING !== 'true';
  }

  static getTargetRefKey(targetRef, defaultNamespace) {
    const kind = targetRef.kind || 'Unknown';
    const ns = targetRef.namespace || defaultNamespace || 'default';
    const name = targetRef.name || 'unknown';
    return `${kind}:${ns}/${name}`;
  }

  static enable() {
    // Only enable if coalescing feature is not disabled
    if (this.isCoalescingEnabled()) {
      this.enabled = true;
      this.clear();
    }
  }
  static disable() {
    this.enabled = false;
  }
  static isEnabled() {
    return this.enabled && this.isCoalescingEnabled();
  }
  static clear() {
    this.policies.clear();
    this.contributors.clear();
  }

  static register(policy, featureName, defaultNamespace) {
    // Returns true if registered (deferred), false if should apply immediately
    if (!this.enabled) return false;
    if (policy.kind !== 'EnterpriseAgentgatewayPolicy') return false;

    const targetRefs = policy.spec?.targetRefs || [];
    if (targetRefs.length === 0) return false;

    for (const targetRef of targetRefs) {
      const key = this.getTargetRefKey(targetRef, defaultNamespace);

      if (this.policies.has(key)) {
        const existing = this.policies.get(key);
        const merged = this.mergePolicy(existing, policy, featureName);
        this.policies.set(key, merged);
      } else {
        const entry = JSON.parse(JSON.stringify(policy));
        entry._contributors = [featureName];
        entry._targetRefKey = key;
        this.policies.set(key, entry);
      }

      if (!this.contributors.has(key)) this.contributors.set(key, new Set());
      this.contributors.get(key).add(featureName);
    }
    return true;
  }

  static mergePolicy(existing, incoming, featureName) {
    const merged = JSON.parse(JSON.stringify(existing));

    // Merge labels
    if (incoming.metadata?.labels) {
      merged.metadata.labels = { ...(merged.metadata.labels || {}), ...incoming.metadata.labels };
    }

    // Merge spec.traffic
    if (incoming.spec?.traffic) {
      merged.spec.traffic = this.mergeSection(
        merged.spec.traffic || {},
        incoming.spec.traffic,
        'spec.traffic',
        featureName
      );
    }

    // Merge spec.backend
    if (incoming.spec?.backend) {
      merged.spec.backend = this.mergeSection(
        merged.spec.backend || {},
        incoming.spec.backend,
        'spec.backend',
        featureName
      );
    }

    merged._contributors = [...(merged._contributors || []), featureName];
    return merged;
  }

  static mergeSection(existing, incoming, path, featureName) {
    if (!incoming) return existing;
    if (!existing || Object.keys(existing).length === 0) return incoming;

    const result = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      if (result[key] === undefined) {
        result[key] = value;
      } else if (Array.isArray(value)) {
        // Merge arrays by union: deduplicate identical entries, detect same-name conflicts
        const existingArr = Array.isArray(result[key]) ? result[key] : [result[key]];
        const existingMap = new Map(existingArr.map(item => [JSON.stringify(item), item]));
        for (const item of value) {
          const itemStr = JSON.stringify(item);
          if (!existingMap.has(itemStr)) {
            if (item && typeof item === 'object' && 'name' in item) {
              const nameConflict = existingArr.find(
                e => e && typeof e === 'object' && e.name === item.name
              );
              if (nameConflict) {
                throw new Error(
                  `Policy conflict at ${path}.${key}[name=${item.name}]: feature '${featureName}' cannot set this field - ` +
                    'already set by previous feature(s). Only one feature can configure each policy field.'
                );
              }
            }
            existingMap.set(itemStr, item);
          }
        }
        result[key] = [...existingMap.values()];
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.mergeSection(result[key], value, `${path}.${key}`, featureName);
      } else if (JSON.stringify(result[key]) === JSON.stringify(value)) {
        // Allow identical scalar values from multiple features (e.g., phase: 'PreRouting')
      } else {
        throw new Error(
          `Policy conflict at ${path}.${key}: feature '${featureName}' cannot set this field - ` +
            'already set by previous feature(s). Only one feature can configure each policy field.'
        );
      }
    }
    return result;
  }

  static async commit(options = {}) {
    const { dryRun = false, spinner = null } = options;
    const yamlDocs = [];

    for (const [_key, policy] of this.policies) {
      const contributors = policy._contributors || [];
      const targetRefKey = policy._targetRefKey || '';
      const cleanPolicy = JSON.parse(JSON.stringify(policy));
      delete cleanPolicy._contributors;
      delete cleanPolicy._targetRefKey;

      // Single contributor: use <feature>-<targetRef name> for clarity
      // Multiple contributors: use merged-<contributors>-<targetRef name>
      const targetSuffix = targetRefKey.split('/').pop() || '';
      let policyName;
      if (contributors.length === 1) {
        policyName = targetSuffix ? `${contributors[0]}-${targetSuffix}` : contributors[0];
      } else {
        const baseName = `merged-${contributors.join('-')}`;
        policyName = targetSuffix ? `${baseName}-${targetSuffix}` : baseName;
      }
      cleanPolicy.metadata.name = policyName;
      cleanPolicy.metadata.labels = {
        ...(cleanPolicy.metadata.labels || {}),
        'agentgateway.dev/merged-policy': 'true',
        'agentgateway.dev/contributors': contributors.join('_'),
      };

      const yamlContent = yaml.dump(cleanPolicy, { lineWidth: -1, indent: 2 });

      if (dryRun) {
        yamlDocs.push(yamlContent);
      } else {
        await KubernetesHelper.applyYaml(yamlContent, spinner);
      }
    }
    return yamlDocs;
  }

  static getMergedPolicyCount() {
    return this.policies.size;
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

      const namespaceMsg =
        feature.namespace !== this.defaultNamespace ? ` (namespace: ${feature.namespace})` : '';
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
      const namespaceMsg =
        feature.namespace !== this.defaultNamespace ? ` (namespace: ${feature.namespace})` : '';
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
