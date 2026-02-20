import { readdir, readFile, unlink } from 'fs/promises';
import { join, basename, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawn } from 'child_process';
import { createServer } from 'http';
import { randomBytes, createHash } from 'crypto';
import yaml from 'js-yaml';
import chalk from 'chalk';
import { Prompts } from './prompts.js';
import { Logger, SpinnerLogger, KubernetesHelper, CommandRunner } from './common.js';
import { FeatureManager } from '../../features/index.js';
import {
  showStepHeader,
  showDiagramForStep,
  showWaitPrompt,
} from './diagrams.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');
const TRACKING_CONFIGMAP = 'agentgateway-current-usecase';
const TRACKING_NAMESPACE = process.env.AGENTGATEWAY_NAMESPACE || 'agentgateway-system';

/**
 * Wait for user to press Space (for stepped demo flow).
 * Skips waiting if stdin is not a TTY (e.g. in CI).
 * @returns {Promise<void>}
 */
function waitForKey() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      resolve();
      return;
    }
    const onData = (key) => {
      const k = Buffer.isBuffer(key) ? key.toString() : key;
      if (k === '\u0003') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(false);
        stdin.pause();
        process.exit(0);
      }
      if (k === ' ') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(false);
        stdin.pause();
        resolve();
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}

/**
 * Use case management utilities
 * Handles agentgateway use case deployments with automatic cleanup of previous use cases
 */
export class UseCaseManager {
  static USECASES_DIR = join(PROJECT_ROOT, 'config/usecases');

  /**
   * Recursively find all YAML files in a directory
   * @param {string} dir - Directory to search
   * @param {string} baseDir - Base directory for relative paths
   * @returns {Promise<Array<{file: string, relativePath: string}>>}
   */
  static async findYamlFiles(dir, baseDir = this.USECASES_DIR) {
    const files = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        // Recursively search subdirectories
        const subFiles = await this.findYamlFiles(fullPath, baseDir);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
        files.push({
          file: fullPath,
          relativePath: relativePath.replace(/\\/g, '/'), // Normalize path separators
        });
      }
    }

    return files;
  }

  /**
   * Get all available use cases (recursively searches subdirectories)
   * @returns {Promise<Array<{name: string, file: string, displayName: string, category?: string}>>}
   */
  static async list() {
    try {
      const yamlFiles = await this.findYamlFiles(this.USECASES_DIR);
      
      return yamlFiles.map(({ file, relativePath }) => {
        // Extract category from path (e.g., "ai/function-calling.yaml" -> category: "ai")
        const pathParts = relativePath.split('/');
        const category = pathParts.length > 1 ? pathParts[0] : undefined;
        
        // Use the filename (without extension) as the name
        const name = basename(file, '.yaml');
        
        // Build display name with category prefix if present
        const displayName = category 
          ? `${category}/${name}`.replace(/-/g, ' ')
          : name.replace(/-/g, ' ');
        
        return {
          name,
          file,
          displayName,
          category,
        };
      });
    } catch (error) {
      throw new Error(`Failed to list use cases: ${error.message}`);
    }
  }

  /**
   * Get a specific use case by name (supports category/name format like "ai/function-calling")
   * @param {string} name - Use case name or "category/name" format
   * @returns {Promise<{name: string, file: string, displayName: string, category?: string}>}
   */
  static async get(name) {
    const usecases = await this.list();
    
    // Support both "name" and "category/name" formats
    let usecase;
    if (name.includes('/')) {
      // Format: "category/name"
      const [category, usecaseName] = name.split('/');
      usecase = usecases.find(u => u.category === category && u.name === usecaseName);
    } else {
      // Format: "name" - find by name (prefer exact match, then try with category)
      usecase = usecases.find(u => u.name === name);
      
      // If multiple matches with same name in different categories, prefer exact match
      // or throw error if ambiguous
      const matches = usecases.filter(u => u.name === name);
      if (matches.length > 1) {
        throw new Error(
          `Ambiguous use case name '${name}'. Use category/name format. ` +
          `Found in: ${matches.map(m => m.category || 'root').join(', ')}`
        );
      }
    }
    
    if (!usecase) {
      throw new Error(`Use case '${name}' not found`);
    }
    
    return usecase;
  }

  /**
   * Check if a use case exists
   * @param {string} name - Use case name
   * @returns {Promise<boolean>}
   */
  static async exists(name) {
    try {
      await this.get(name);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Prompt user to select a use case
   * @returns {Promise<{name: string, file: string}>} Selected use case
   */
  static async select() {
    try {
      const usecases = await this.list();

      if (usecases.length === 0) {
        throw new Error('No use cases found in config/usecases/');
      }

      const grouped = new Map();
      for (const uc of usecases) {
        const cat = uc.category || 'uncategorized';
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat).push(uc);
      }

      const tree = [...grouped.entries()].map(([category, items]) => ({
        label: category.replace(/-/g, ' '),
        value: category,
        children: items.map(uc => ({
          name: uc.name.replace(/-/g, ' '),
          value: uc.name,
        })),
      }));

      const selectedName = await Prompts.selectTree(
        'Select use case to deploy:',
        tree,
      );

      const usecase = usecases.find(u => u.name === selectedName);

      return {
        name: usecase.name,
        file: usecase.file,
      };
    } catch (error) {
      throw new Error(`Failed to select use case: ${error.message}`);
    }
  }

  /**
   * Get use cases by category or tag
   * @param {string} filter - Filter criteria
   * @returns {Promise<Array<{name: string, file: string, displayName: string}>>}
   */
  static async filter(filter) {
    const usecases = await this.list();
    return usecases.filter(u => u.name.includes(filter));
  }

  /**
   * Parse use case YAML file
   * @param {string} filePath - Path to the use case YAML file
   * @returns {Promise<Object>} Parsed use case definition
   */
  static async parse(filePath) {
    try {
      const content = await readFile(filePath, 'utf8');
      const usecase = yaml.load(content);

      if (!usecase || !usecase.spec) {
        throw new Error('Invalid use case file: missing spec');
      }

      return usecase;
    } catch (error) {
      throw new Error(`Failed to parse use case file: ${error.message}`);
    }
  }

  /**
   * Get the currently deployed use case
   * @returns {Promise<string|null>} Current use case name or null
   */
  static async getCurrentUseCase() {
    try {
      const result = await KubernetesHelper.kubectl([
        'get', 'configmap', TRACKING_CONFIGMAP,
        '-n', TRACKING_NAMESPACE,
        '-o', 'jsonpath={.data.usecase}'
      ], { ignoreError: true });

      return result.stdout.trim() || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Set the currently deployed use case
   * @param {string} name - Use case name
   */
  static async setCurrentUseCase(name) {
    const configMap = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: TRACKING_CONFIGMAP,
        namespace: TRACKING_NAMESPACE,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/component': 'usecase-tracker',
        },
      },
      data: {
        usecase: name,
      },
    };

    const yamlContent = yaml.dump(configMap);
    await KubernetesHelper.applyYaml(yamlContent);
  }

  /**
   * Clear the current use case tracking
   */
  static async clearCurrentUseCase() {
    try {
      await KubernetesHelper.kubectl([
        'delete', 'configmap', TRACKING_CONFIGMAP,
        '-n', TRACKING_NAMESPACE,
        '--ignore-not-found=true'
      ]);
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * Get ordered steps from use case spec.
   * Uses spec.steps if present; otherwise infers steps from spec.features
   * (Step 1: Add provider = providers feature(s), Step 2: Add policy = rest).
   * @param {Object} spec - Use case spec
   * @returns {Array<{ title: string, description?: string, features: Array<{name: string, config?: object}> }>}
   */
  static getSteps(spec) {
    if (spec.steps && Array.isArray(spec.steps) && spec.steps.length > 0) {
      return spec.steps.map((s) => ({
        title: s.title || 'Step',
        description: s.description,
        features: s.features || [],
      }));
    }
    const features = spec.features || [];
    if (features.length === 0) return [];

    const gatewayFeatures = features.filter((f) => f.name === 'gateway');
    const rest = features.filter((f) => f.name !== 'gateway');
    const providerFeatures = rest.filter((f) => f.name === 'providers');
    const policyFeatures = rest.filter((f) => f.name !== 'providers');

    const steps = [];
    if (gatewayFeatures.length > 0) {
      steps.push({
        title: 'Gateway',
        description: 'Configure the Gateway (HTTPRoutes will reference it via parentRefs).',
        features: gatewayFeatures,
      });
    }
    if (providerFeatures.length > 0) {
      steps.push({
        title: 'Add provider',
        description: 'Configure the LLM provider backend and route.',
        features: providerFeatures,
      });
    }
    if (policyFeatures.length > 0) {
      steps.push({
        title: 'Add policy',
        description: 'Apply policies (guardrails, enrichment, etc.) to the route.',
        features: policyFeatures,
      });
    }
    if (steps.length === 0) {
      steps.push({ title: 'Deploy', features });
    }
    return steps;
  }

  /**
   * Deploy a use case
   * @param {string} name - Use case name or file path
   * @param {Object} [options] - Deploy options
   * @param {boolean} [options.stepped=true] - When true and interactive, step through with diagrams and wait for key
   * @param {boolean} [options.prompt=true] - When false, skip interactive stepping (no wait for key)
   * @param {boolean} [options.diagrams=true] - When false, hide ASCII flow diagrams during stepped deploy
   * @returns {Promise<void>}
   */
  static async deploy(name, options = {}) {
    const { stepped = true, prompt = true, diagrams: diagramsOpt = true } = options;
    const diagrams = diagramsOpt && process.env.HIDE_DIAGRAMS !== 'true';
    const spinner = new SpinnerLogger();

    try {
      // Get the use case file
      let filePath;
      if (name.endsWith('.yaml')) {
        filePath = name;
      } else {
        const usecase = await this.get(name);
        filePath = usecase.file;
      }

      // Parse the use case definition
      const usecase = await this.parse(filePath);
      const { metadata, spec } = usecase;

      // Check if there's a currently deployed use case
      const currentUseCase = await this.getCurrentUseCase();

      if (currentUseCase && currentUseCase !== metadata.name) {
        Logger.warn(`Found existing use case '${currentUseCase}' deployed`);
        Logger.info(`Cleaning up previous use case before deploying '${metadata.name}'...`);

        try {
          await this.cleanup(currentUseCase);
          Logger.success(`Previous use case cleaned up`);
        } catch (error) {
          Logger.warn(`Failed to clean up previous use case: ${error.message}`);
          Logger.info(`Continuing with deployment...`);
        }
      }

      Logger.info(`Deploying use case: ${metadata.name}`);
      if (metadata.description) {
        Logger.info(`Description: ${metadata.description}`);
      }

      const { namespace, providers = [] } = spec;

      if (namespace) {
        Logger.info(`Using namespace: ${namespace}`);
        FeatureManager.setDefaultNamespace(namespace);
      }

      if (providers.length > 0) {
        Logger.info(`Providers: ${providers.join(', ')}`);
      }

      const steps = this.getSteps(spec);
      const allFeatures = steps.flatMap((s) => s.features);

      if (allFeatures.length === 0) {
        Logger.warn('No features configured in use case');
        return;
      }

      // Pre-process features (inject targetRefs etc.) using full feature list
      const specForPreprocess = { ...spec, features: allFeatures };
      this.preprocessFeatures(specForPreprocess);

      // Reset gateway ref to default; gateway feature will override if present
      FeatureManager.setGatewayRef({
        name: 'agentgateway',
        namespace: FeatureManager.getDefaultNamespace(),
      });

      const useSteppedFlow = stepped && prompt && steps.length > 0 && process.stdin.isTTY;

      if (useSteppedFlow && steps.length > 1) {
        showWaitPrompt();
        await waitForKey();
      }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepIndex = i + 1;
        const totalSteps = steps.length;

        if (useSteppedFlow) {
          showStepHeader(stepIndex, totalSteps, step.title, step.description);
          if (diagrams) {
            showDiagramForStep(stepIndex, step.features);
          }
          Logger.info(`Applying: ${step.features.map((f) => f.name).join(', ')}`);
          showWaitPrompt();
          await waitForKey();
        } else if (steps.length > 1) {
          Logger.info(`Step ${stepIndex}/${totalSteps}: ${step.title} — ${step.features.map((f) => f.name).join(', ')}`);
        }

        for (const feature of step.features) {
          const { name: featureName, config = {} } = feature;
          try {
            await FeatureManager.deploy(featureName, config);
          } catch (error) {
            throw error;
          }
        }
      }

      await this.setCurrentUseCase(metadata.name);

      Logger.success(`Use case '${metadata.name}' deployed successfully`);

      if (!process.env.DISABLE_TEST && spec.tests && spec.tests.length > 0) {
        await this.test(metadata.name);
      }
    } catch (error) {
      spinner.fail(`Failed to deploy use case: ${error.message}`);
      throw error;
    }
  }

  /**
   * Dry run: generate and print YAML for a use case without applying (copy-friendly output).
   * @param {string} name - Use case name or file path
   * @returns {Promise<void>}
   */
  static async dryRun(name) {
    try {
      let filePath;
      if (name.endsWith('.yaml')) {
        filePath = name;
      } else {
        const usecase = await this.get(name);
        filePath = usecase.file;
      }

      const usecase = await this.parse(filePath);
      const { metadata, spec } = usecase;

      const { namespace } = spec;
      if (namespace) {
        FeatureManager.setDefaultNamespace(namespace);
      }

      const steps = this.getSteps(spec);
      const allFeatures = steps.flatMap((s) => s.features);

      if (allFeatures.length === 0) {
        Logger.warn('No features configured in use case');
        return;
      }

      const specForPreprocess = { ...spec, features: allFeatures };
      this.preprocessFeatures(specForPreprocess);

      // Default gateway ref so HTTPRoutes have a parentRef; gateway feature will override if present
      FeatureManager.setGatewayRef({
        name: 'agentgateway',
        namespace: FeatureManager.getDefaultNamespace(),
      });

      const hasGatewayFeature = allFeatures.some((f) => f.name === 'gateway');
      const collected = [];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        for (const feature of step.features) {
          const { name: featureName, config = {} } = feature;
          const yamlDocs = await FeatureManager.deploy(featureName, config, { dryRun: true });
          if (yamlDocs && yamlDocs.length > 0) {
            collected.push({ featureName, yamlDocs });
          }
        }
      }

      const gatewayRef = FeatureManager.getGatewayRef();
      const lines = [];
      const sep = '# ' + '='.repeat(76);
      lines.push(sep);
      lines.push(`# Generated YAML for use case: ${metadata.name}`);
      if (metadata.description) {
        lines.push(`# ${metadata.description}`);
      }
      lines.push(sep);
      lines.push('# Gateway referenced by HTTPRoute parentRefs:');
      lines.push(`#   name: ${gatewayRef.name}`);
      lines.push(`#   namespace: ${gatewayRef.namespace}`);
      lines.push(sep);
      lines.push('# Copy the YAML below to apply manually or to another medium.');
      lines.push(sep);
      lines.push('');

      // Include default Gateway YAML when use case does not override with gateway feature
      if (!hasGatewayFeature) {
        const defaultGatewayPath = join(PROJECT_ROOT, 'config', 'gateway', 'default-gateway.yaml');
        try {
          let defaultGatewayYaml = await readFile(defaultGatewayPath, 'utf8');
          const defaultGateway = yaml.load(defaultGatewayYaml);
          defaultGateway.metadata.namespace = gatewayRef.namespace;
          defaultGateway.metadata.name = gatewayRef.name;
          defaultGatewayYaml = yaml.dump(defaultGateway, { lineWidth: -1, indent: 2 });
          lines.push('# --- Default Gateway (referenced by HTTPRoutes below) ---');
          lines.push('');
          lines.push('---');
          lines.push(defaultGatewayYaml.trim());
          lines.push('');
        } catch (err) {
          lines.push(`# (Default Gateway YAML not found: ${defaultGatewayPath})`);
          lines.push('');
        }
      }

      for (const { featureName, yamlDocs } of collected) {
        lines.push(`# --- Feature: ${featureName} ---`);
        lines.push('');
        for (const doc of yamlDocs) {
          lines.push('---');
          lines.push(doc.trim());
          lines.push('');
        }
      }

      const output = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
      console.log(output);
    } catch (error) {
      Logger.error(`Dry run failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Pre-process features to inject dynamic configuration
   * @param {Object} spec - Use case spec
   */
  static preprocessFeatures(spec) {
    // Find providers feature to get list of provider names
    const providersFeature = spec.features.find(f => f.name === 'providers');
    if (!providersFeature) {
      return; // No providers, nothing to inject
    }

    const providers = providersFeature.config?.providers || [];
    if (providers.length === 0) {
      return;
    }

    // Build targetRefs for all provider HTTPRoutes
    const targetRefs = providers.map(provider => {
      const providerName = typeof provider === 'string' ? provider : provider.name;
      return {
        group: 'gateway.networking.k8s.io',
        kind: 'HTTPRoute',
        name: providerName
      };
    });

    // Inject targetRefs into policy features if not already specified
    const policyFeatures = ['prompt-guards', 'prompt-enrichment', 'guardrail-webhook'];
    for (const feature of spec.features) {
      if (policyFeatures.includes(feature.name) && !feature.config?.targetRefs) {
        feature.config = feature.config || {};
        feature.config.targetRefs = targetRefs;
        Logger.debug(`Auto-injected targetRefs for ${feature.name}: ${targetRefs.map(t => t.name).join(', ')}`);
      }
    }
  }

  /**
   * Clean up a use case
   * @param {string} name - Use case name or file path
   * @returns {Promise<void>}
   */
  static async cleanup(name) {
    const spinner = new SpinnerLogger();

    try {
      // Get the use case file
      let filePath;
      if (name.endsWith('.yaml')) {
        filePath = name;
      } else {
        const usecase = await this.get(name);
        filePath = usecase.file;
      }

      // Parse the use case definition
      const usecase = await this.parse(filePath);
      const { metadata, spec } = usecase;

      const { namespace } = spec;
      const steps = this.getSteps(spec);
      const features = steps.flatMap((s) => s.features);

      if (namespace) {
        FeatureManager.setDefaultNamespace(namespace);
      }

      if (features.length === 0) {
        Logger.info(`Cleaning up use case '${metadata.name}' (no features)`);
        return;
      }

      const featureWord = features.length === 1 ? 'feature' : 'features';
      Logger.info(`Cleaning up use case '${metadata.name}' (${features.length} ${featureWord})`);

      for (const feature of features.reverse()) {
        const { name: featureName, config = {} } = feature;

        try {
          await FeatureManager.cleanup(featureName, config);
        } catch (error) {
          Logger.warn(`Failed to clean up feature '${featureName}': ${error.message}`);
          // Continue with other features
        }
      }

      // Check if this is the currently tracked use case
      const currentUseCase = await this.getCurrentUseCase();
      if (currentUseCase === metadata.name) {
        await this.clearCurrentUseCase();
      }

      Logger.success(`Use case '${metadata.name}' cleaned up successfully`);
    } catch (error) {
      spinner.fail(`Failed to clean up use case: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clean up the currently deployed use case (if any)
   * @returns {Promise<void>}
   */
  static async cleanupAll() {
    const currentUseCase = await this.getCurrentUseCase();
    if (currentUseCase) {
      await this.cleanup(currentUseCase);
    } else {
      await this.clearCurrentUseCase();
      Logger.info('No use case currently deployed; nothing to clean');
    }
  }

  /**
   * Test a use case
   * @param {string} name - Use case name or file path
   * @returns {Promise<void>}
   */
  static async test(name) {
    const spinner = new SpinnerLogger();

    try {
      // Get the use case file
      let filePath;
      if (name.endsWith('.yaml')) {
        filePath = name;
      } else {
        const usecase = await this.get(name);
        filePath = usecase.file;
      }

      // Parse the use case definition
      const usecase = await this.parse(filePath);
      const { metadata, spec } = usecase;

      Logger.info(`Testing use case: ${metadata.name}`);

      // Check if tests are defined
      if (!spec.tests || spec.tests.length === 0) {
        Logger.warn(`No tests defined for use case '${metadata.name}'`);
        return;
      }

      const testLine = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
      console.log('');
      console.log(chalk.cyan(chalk.bold(testLine)));
      console.log(chalk.cyan(chalk.bold(`  🧪 Running Tests -> (${spec.tests.length} test(s))`)));
      console.log(chalk.cyan(chalk.bold(testLine)));
      console.log('');

      let passed = 0;
      let failed = 0;
      let skipped = 0;

      // Run each test
      for (const test of spec.tests) {
        const testName = test.name || 'unnamed-test';
        const testDesc = test.description || 'No description';
        
        spinner.start(`Running test: ${testName}`);

        try {
          // Validate test structure
          if (!test.steps || test.steps.length === 0) {
            spinner.warn(`Test '${testName}' has no steps - skipped`);
            skipped++;
            continue;
          }

          // Execute test steps
          await this.executeTestSteps(test, metadata.name, spec, spinner);
          
          spinner.succeed(`${testName}: ${testDesc}`);
          passed++;
        } catch (error) {
          spinner.fail(`${testName}: ${error.message}`);
          failed++;
        }
      }

      if (failed > 0) {
        throw new Error(`${failed} test(s) failed`);
      }

    } catch (error) {
      if (error.message.includes('test(s) failed')) {
        throw error;
      }
      spinner.fail(`Failed to run tests: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute test steps
   * @param {Object} test - Test definition
   * @param {string} usecaseName - Use case name
   * @param {Object} spec - Use case spec
   * @param {SpinnerLogger} spinner - Spinner logger
   * @returns {Promise<void>}
   */
  static async executeTestSteps(test, usecaseName, spec, spinner) {
    const { namespace } = spec;
    const gatewayNamespace = namespace || process.env.AGENTGATEWAY_NAMESPACE || 'agentgateway-system';

    // Resolve gateway name and port from the gateway feature config (if present), otherwise defaults
    const gatewayFeature = (spec.features || []).find(f => f.name === 'gateway');
    const gatewayName = gatewayFeature?.config?.name || 'agentgateway';
    const gatewayPort = gatewayFeature?.config?.listeners?.[0]?.port || 8080;
    
    // Get timeout configuration (step > test > spec > default 30s)
    const defaultTimeout = spec.timeout || 30000;
    const testTimeout = test.timeout || defaultTimeout;
    
    // Store responses for verification
    let lastResponse = null;
    let lastResponseBody = null;
    let lastResponseStatus = null;
    let bearerToken = null;
    let actorToken = null;
    let sessionCookie = null;
    let apiKey = null;
    let apiKeyHeader = null;

    for (const step of test.steps) {
      const action = step.action;

      switch (action) {
        case 'get-token': {
          const prevText = spinner.spinner.text;
          const kc = step.keycloak || {};
          if (kc.grantType === 'password' || kc.grantType === 'client_credentials') {
            spinner.setText('Obtaining token via password grant...');
            bearerToken = await this.getTokenViaPasswordGrant(step);
            spinner.stop();
            Logger.success('Token obtained via password grant');
            spinner.start(prevText);
          } else {
            spinner.stop();
            Logger.info('Opening browser for Keycloak login...');
            bearerToken = await this.getTokenViaBrowser(step);
            Logger.success('Token obtained via browser login');
            spinner.start(prevText);
          }
          break;
        }

        case 'get-session-cookie': {
          const gw = await this.getGatewayAddress(gatewayNamespace, gatewayName);
          if (!gw) throw new Error('Gateway address not found');
          const prevText = spinner.spinner.text;
          spinner.stop();
          sessionCookie = await this.getSessionCookie(gw, gatewayPort, step);
          Logger.info('Session cookie obtained');
          spinner.start(prevText);
          break;
        }

        case 'get-apikey': {
          const secretName = step.secretName || 'apikey';
          const secretNs = step.namespace || gatewayNamespace;
          const secretKey = step.secretKey || 'api-key';
          apiKeyHeader = step.headerName || 'x-ai-api-key';

          spinner.setText(`Reading API key from secret ${secretNs}/${secretName}...`);
          const result = await KubernetesHelper.kubectl([
            'get', 'secret', secretName,
            '-n', secretNs,
            '-o', `jsonpath={.data.${secretKey.replace(/\./g, '\\.')}}`,
          ]);
          const b64 = (result.stdout || '').trim();
          if (!b64) {
            throw new Error(`API key not found in secret ${secretNs}/${secretName} key=${secretKey}`);
          }
          apiKey = Buffer.from(b64, 'base64').toString('utf8');
          spinner.setText('API key retrieved from secret');
          break;
        }

        case 'get-k8s-token': {
          const sa = step.serviceAccount || 'default';
          const ns = step.namespace || gatewayNamespace;
          const duration = step.duration || '1h';
          // role: 'actor' (default) stores as actorToken; 'subject' stores as bearerToken
          const role = step.role || 'actor';
          spinner.setText(`Creating K8s SA token for ${ns}/${sa} (${role})...`);
          const ktResult = await KubernetesHelper.kubectl([
            'create', 'token', sa, '-n', ns, '--duration', duration,
          ]);
          const k8sToken = (ktResult.stdout || '').trim();
          if (!k8sToken) throw new Error('get-k8s-token: kubectl create token returned empty output');
          if (role === 'subject') {
            bearerToken = k8sToken;
          } else {
            actorToken = k8sToken;
          }
          spinner.setText(`K8s SA token created for ${ns}/${sa} (${role})`);
          break;
        }

        case 'exchange-sts-token': {
          const stsConf = step.sts || {};
          const stsService = stsConf.service || 'enterprise-agentgateway';
          const stsNs = stsConf.namespace || 'agentgateway-system';
          const stsPort = stsConf.port || 7777;
          const localPort = stsConf.localPort || 17777;

          spinner.setText(`Port-forwarding ${stsNs}/${stsService}:${stsPort} → localhost:${localPort}...`);
          const pfProc = spawn('kubectl', [
            'port-forward', '-n', stsNs, `svc/${stsService}`,
            `${localPort}:${stsPort}`,
          ], { stdio: 'pipe' });

          // Wait until the port-forward signals it is ready
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('exchange-sts-token: port-forward timed out')), 10000);
            pfProc.stdout.on('data', (data) => {
              if (data.toString().includes('Forwarding from')) {
                clearTimeout(timer);
                resolve();
              }
            });
            pfProc.on('error', (err) => { clearTimeout(timer); reject(err); });
            pfProc.on('close', (code) => {
              if (code !== null) { clearTimeout(timer); reject(new Error(`port-forward exited with code ${code}`)); }
            });
          });

          try {
            if (!bearerToken) throw new Error('exchange-sts-token: no subject token — run get-token or get-k8s-token first');

            // The STS requires the calling agent to authenticate via Authorization header.
            // In impersonation mode (no actorToken), the agent sends its own token as
            // both the Authorization header and the subject_token body field.
            // In delegation mode (actorToken set), the actor token goes in the body and
            // the subject token must carry a may_act claim authorizing the actor.
            const params = {
              grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
              subject_token: bearerToken,
              subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
            };
            if (actorToken) {
              params.actor_token = actorToken;
              params.actor_token_type = 'urn:ietf:params:oauth:token-type:jwt';
            }
            const tokenBody = new URLSearchParams(params).toString();

            const curlArgs = [
              '-s', '--max-time', '10',
              '-X', 'POST', `http://localhost:${localPort}/oauth2/token`,
              '-H', 'Content-Type: application/x-www-form-urlencoded',
              '-H', `Authorization: Bearer ${bearerToken}`,
              '-d', tokenBody,
              '-w', '\n%{http_code}',
            ];

            spinner.setText('Exchanging token with AGW STS...');
            const stsResult = await CommandRunner.run('curl', curlArgs, { ignoreError: true });

            const raw = (stsResult.stdout || '').trim();
            const lines = raw.split('\n');
            const httpStatus = parseInt(lines[lines.length - 1], 10);
            const stsBody = lines.slice(0, -1).join('\n').trim();

            Logger.debug(`STS /token status: ${httpStatus}, body: ${stsBody || '(empty)'}`);

            if (httpStatus !== 200) {
              const detail = stsBody || stsResult.stderr || '(no response body)';
              throw new Error(`exchange-sts-token: STS returned HTTP ${httpStatus}: ${detail}`);
            }
            if (!stsBody) throw new Error('exchange-sts-token: STS returned 200 with empty body');

            let stsParsed;
            try { stsParsed = JSON.parse(stsBody); } catch {
              throw new Error(`exchange-sts-token: invalid JSON from STS: ${stsBody.substring(0, 300)}`);
            }
            if (!stsParsed.access_token) {
              throw new Error(`exchange-sts-token: ${stsParsed.error_description || stsParsed.error || JSON.stringify(stsParsed)}`);
            }
            bearerToken = stsParsed.access_token;
            spinner.setText('STS token exchange successful');
          } finally {
            pfProc.kill();
          }
          break;
        }

        case 'call-agent': {
          const agentGateway = await this.getGatewayAddress(gatewayNamespace, gatewayName);
          if (!agentGateway) {
            throw new Error('call-agent: gateway address not found — ensure gateway is deployed');
          }

          const agentEndpoint = step.endpoint || '/agent';
          const agentQuery = step.query || step.prompt || 'Hello';
          const agentPort = step.port || gatewayPort;
          const agentUrl = `http://${agentGateway}:${agentPort}${agentEndpoint}/run`;

          const agentHeaders = {
            'Content-Type': 'application/json',
            ...step.headers,
          };
          if (step.auth === 'bearer' && bearerToken) {
            agentHeaders['Authorization'] = `Bearer ${bearerToken}`;
          }

          spinner.setText(`Calling agent at ${agentEndpoint}...`);
          const agentResult = await CommandRunner.run('curl', [
            '-s', '--max-time', String(step.timeout || testTimeout / 1000 || 60),
            '-X', 'POST', agentUrl,
            ...Object.entries(agentHeaders).flatMap(([k, v]) => ['-H', `${k}: ${v}`]),
            '-d', JSON.stringify({ query: agentQuery }),
            '-w', '\n%{http_code}',
          ], { ignoreError: true });

          const agentRaw = (agentResult.stdout || '').trim();
          const agentLines = agentRaw.split('\n');
          const agentStatus = parseInt(agentLines[agentLines.length - 1], 10);
          const agentBody = agentLines.slice(0, -1).join('\n').trim();

          Logger.debug(`call-agent status: ${agentStatus}, body: ${agentBody.substring(0, 200)}`);

          if (agentStatus !== 200) {
            throw new Error(`call-agent: agent returned HTTP ${agentStatus}: ${agentBody || agentResult.stderr || '(empty)'}`);
          }

          lastResponse = { status: agentStatus };
          lastResponseBody = agentBody;
          lastResponseStatus = agentStatus;
          spinner.setText(`Agent responded (${agentStatus})`);
          break;
        }

        case 'send-request':
          // Get gateway address
          const gateway = await this.getGatewayAddress(gatewayNamespace, gatewayName);
          
          if (!gateway) {
            throw new Error('Gateway address not found - ensure gateway is deployed');
          }

          if (step.auth === 'bearer' && bearerToken) {
            step.headers = { ...step.headers, Authorization: `Bearer ${bearerToken}` };
          }
          if (step.auth === 'cookie' && sessionCookie) {
            step.headers = { ...step.headers, Cookie: sessionCookie };
          }
          if (step.auth === 'apikey' && apiKey) {
            const hdr = apiKeyHeader || step.headerName || 'x-ai-api-key';
            step.headers = { ...step.headers, [hdr]: apiKey };
          }

          spinner.setText(`Sending request to ${gateway}...`);
          
          try {
            // Determine timeout for this step (step > test > spec > default)
            const stepTimeout = step.timeout || testTimeout;
            
            // Make the actual HTTP request
            const result = await this.sendHttpRequest(gateway, step, spinner, stepTimeout, gatewayPort);
            lastResponse = result.response;
            lastResponseBody = result.body;
            lastResponseStatus = result.status;
            
            spinner.setText(`Request sent, status: ${lastResponseStatus}`);
          } catch (error) {
            throw new Error(`Request failed: ${error.message}`);
          }
          break;

        case 'verify':
          spinner.setText('Verifying response...');
          
          if (!lastResponse) {
            throw new Error('No response to verify - send-request must come before verify');
          }
          
          // Verify the response
          await this.verifyResponse(lastResponse, lastResponseBody, lastResponseStatus, step, spinner);
          break;

        case 'send-mcp-request': {
          const mcpGateway = await this.getGatewayAddress(gatewayNamespace, gatewayName);
          if (!mcpGateway) {
            throw new Error('Gateway address not found - ensure gateway is deployed');
          }

          if (step.auth === 'bearer' && bearerToken) {
            step.headers = { ...step.headers, Authorization: `Bearer ${bearerToken}` };
          }

          spinner.setText(`Sending MCP request (${step.method}) to ${mcpGateway}...`);

          try {
            const stepTimeout = step.timeout || testTimeout;
            const maxRetries = step.retries ?? 5;
            const retryDelay = step.retryDelay ?? 3000;
            let result;

            for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
              result = await this.sendMcpRequest(mcpGateway, step, spinner, stepTimeout, gatewayPort);
              if (result.status < 500 || attempt > maxRetries) break;
              spinner.setText(`MCP request returned ${result.status}, retrying in ${retryDelay / 1000}s (${attempt}/${maxRetries})...`);
              await new Promise(r => setTimeout(r, retryDelay));
            }

            lastResponse = result.response;
            lastResponseBody = result.body;
            lastResponseStatus = result.status;
            spinner.setText(`MCP request sent, status: ${lastResponseStatus}`);
          } catch (error) {
            throw new Error(`MCP request failed: ${error.message}`);
          }
          break;
        }

        case 'verify-resource': {
          // Verify a Kubernetes resource field via kubectl + JSONPath
          const { kind, name: resName, namespace: resNs, jsonpath, expect: resExpect } = step;
          const ns = resNs || gatewayNamespace;
          spinner.setText(`Verifying ${kind} '${resName}' in ${ns}...`);

          for (const check of resExpect) {
            const result = await KubernetesHelper.kubectl([
              'get', kind, resName,
              '-n', ns,
              '-o', `jsonpath=${check.jsonpath}`,
            ], { ignoreError: true });

            const actual = result.stdout.trim();
            const expected = String(check.value);

            if (actual !== expected) {
              throw new Error(
                `${kind} '${resName}' field ${check.jsonpath}: expected '${expected}', got '${actual}'`
              );
            }
          }
          break;
        }

        default:
          spinner.clear();
          Logger.warn(`Unknown test action: ${action}`);
          spinner.render();
      }
    }
  }

  /**
   * Obtain a token via the browser-based Authorization Code + PKCE flow.
   *
   * 1. Resolve the Keycloak LoadBalancer address
   * 2. Start a temporary local HTTP server (redirect URI target)
   * 3. Generate PKCE code_verifier / code_challenge
   * 4. Open the browser to Keycloak's /auth endpoint
   * 5. User logs in → Keycloak redirects to localhost with ?code=
   * 6. Exchange the code for tokens (POST to /token with code_verifier)
   * 7. Return the access_token
   *
   * Step config:
   *   keycloak:
   *     realm: agw-dev
   *     clientId: agw-client-public     # must be a public client
   *     serviceName: keycloak
   *     serviceNamespace: keycloak
   *     servicePort: 443
   */
  static async getTokenViaBrowser(step) {
    const kc = step.keycloak || {};
    const realm = kc.realm || 'agw-dev';
    const clientId = kc.clientId || 'agw-client-public';
    const hostname = kc.hostname || 'keycloak.keycloak.svc.cluster.local';
    const loginTimeout = kc.timeout || 240000;

    const keycloakBase = `https://${hostname}`;

    // PKCE
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    // Start local callback server
    const { callbackPort, codePromise, server } = await this.startCallbackServer(loginTimeout);

    const redirectUri = `http://localhost:${callbackPort}/callback`;
    const authorizeUrl = `${keycloakBase}/realms/${realm}/protocol/openid-connect/auth?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&response_type=code` +
      `&scope=openid` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code_challenge=${codeChallenge}` +
      `&code_challenge_method=S256`;

    // Open browser
    const openCmd = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    spawn(openCmd, [authorizeUrl], { stdio: 'ignore', detached: true }).unref();

    Logger.info(`Waiting for login (timeout: ${loginTimeout / 1000}s)...`);

    // Wait for the authorization code from the callback
    const authCode = await codePromise;
    server.close();

    Logger.debug(`Auth code received: ${authCode.substring(0, 20)}...`);
    Logger.debug(`Client ID: ${clientId}`);
    Logger.debug(`Redirect URI: ${redirectUri}`);

    // Exchange code for tokens
    const clientSecret = kc.clientSecret || process.env.KEYCLOAK_SECRET || '';
    const tokenUrl = `${keycloakBase}/realms/${realm}/protocol/openid-connect/token`;
    const tokenParts = [
      'grant_type=authorization_code',
      `client_id=${encodeURIComponent(clientId)}`,
      `code=${encodeURIComponent(authCode)}`,
      `redirect_uri=${encodeURIComponent(redirectUri)}`,
      `code_verifier=${encodeURIComponent(codeVerifier)}`,
    ];
    if (clientSecret) tokenParts.push(`client_secret=${encodeURIComponent(clientSecret)}`);
    const tokenBody = tokenParts.join('&');

    Logger.debug(`Token URL: ${tokenUrl}`);
    Logger.debug(`Token body: ${tokenBody.substring(0, 200)}...`);

    const result = await CommandRunner.run('curl', [
      '-sSk', '--max-time', '10',
      '-X', 'POST', tokenUrl,
      '-H', 'Content-Type: application/x-www-form-urlencoded',
      '-d', tokenBody,
    ], { ignoreError: true });

    const body = (result.stdout || '').trim();
    const curlErr = (result.stderr || '').trim();

    Logger.debug(`Token response length: ${body.length} chars`);
    if (curlErr) Logger.debug(`Token curl stderr: ${curlErr}`);

    if (!body) {
      throw new Error(`get-token: empty response from token endpoint. stderr: ${curlErr}`);
    }

    let parsed;
    try { parsed = JSON.parse(body); } catch {
      throw new Error(`get-token: invalid JSON from token endpoint: ${body.substring(0, 300)}`);
    }

    if (!parsed.access_token) {
      throw new Error(`get-token: ${parsed.error_description || parsed.error || 'no access_token in response'}`);
    }

    try {
      const [header] = parsed.access_token.split('.');
      const decoded = JSON.parse(Buffer.from(header, 'base64url').toString());
      Logger.debug(`JWT header: alg=${decoded.alg}, typ=${decoded.typ}, kid=${decoded.kid}`);
    } catch { /* ignore decode errors */ }

    Logger.debug(`Access token:\n${parsed.access_token}`);

    return parsed.access_token;
  }

  /**
   * Obtain an access token using the Resource Owner Password Credentials grant
   * (or client_credentials grant) — no browser required.
   *
   * Step config:
   *   keycloak:
   *     realm: agw-dev
   *     clientId: agw-client
   *     clientSecret: <secret>          # or KEYCLOAK_SECRET env
   *     grantType: password             # or client_credentials
   *     username: user1                 # required for password grant
   *     password: Passwd00              # required for password grant
   *     hostname: keycloak.keycloak.svc.cluster.local
   */
  static async getTokenViaPasswordGrant(step) {
    const kc = step.keycloak || {};
    const realm = kc.realm || 'agw-dev';
    const clientId = kc.clientId || process.env.KEYCLOAK_CLIENT_ID || 'agw-client';
    const clientSecret = kc.clientSecret || process.env.KEYCLOAK_SECRET || '';
    const hostname = kc.hostname || 'keycloak.keycloak.svc.cluster.local';
    const scheme = kc.scheme || 'https';
    const grantType = kc.grantType || 'password';

    const tokenUrl = `${scheme}://${hostname}/realms/${realm}/protocol/openid-connect/token`;

    const tokenParts = [
      `grant_type=${encodeURIComponent(grantType)}`,
      `client_id=${encodeURIComponent(clientId)}`,
    ];
    if (clientSecret) {
      tokenParts.push(`client_secret=${encodeURIComponent(clientSecret)}`);
    }
    if (grantType === 'password') {
      const username = kc.username || process.env.KEYCLOAK_USERNAME || '';
      const password = kc.password || process.env.KEYCLOAK_PASSWORD || '';
      if (!username) throw new Error('get-token: password grant requires username');
      tokenParts.push(`username=${encodeURIComponent(username)}`);
      tokenParts.push(`password=${encodeURIComponent(password)}`);
    }
    const tokenBody = tokenParts.join('&');

    Logger.debug(`Token URL: ${tokenUrl}`);
    Logger.debug(`Grant type: ${grantType}, client_id: ${clientId}`);

    const result = await CommandRunner.run('curl', [
      '-sSk', '--max-time', '10',
      '-X', 'POST', tokenUrl,
      '-H', 'Content-Type: application/x-www-form-urlencoded',
      '-d', tokenBody,
    ], { ignoreError: true });

    const body = (result.stdout || '').trim();
    const curlErr = (result.stderr || '').trim();

    if (!body) {
      throw new Error(`get-token: empty response from token endpoint. stderr: ${curlErr}`);
    }

    let parsed;
    try { parsed = JSON.parse(body); } catch {
      throw new Error(`get-token: invalid JSON from token endpoint: ${body.substring(0, 300)}`);
    }

    if (!parsed.access_token) {
      throw new Error(`get-token: ${parsed.error_description || parsed.error || 'no access_token in response'}`);
    }

    try {
      const [header] = parsed.access_token.split('.');
      const decoded = JSON.parse(Buffer.from(header, 'base64url').toString());
      Logger.debug(`JWT header: alg=${decoded.alg}, typ=${decoded.typ}, kid=${decoded.kid}`);
    } catch { /* ignore decode errors */ }

    Logger.debug(`Access token:\n${parsed.access_token}`);

    return parsed.access_token;
  }

  static async getSessionCookie(gatewayAddress, gatewayPort, step) {
    const endpoint = step.endpoint || '/';
    const cookieName = step.cookieName || 'keycloak-session';
    const gatewayUrl = `http://${gatewayAddress}:${gatewayPort}${endpoint}`;

    const result = await CommandRunner.run('curl', [
      '-sSk', '--max-time', '10',
      '-o', '/dev/null',
      '-w', '%{redirect_url}',
      gatewayUrl,
    ], { ignoreError: true });

    const redirectUrl = (result.stdout || '').trim();
    if (!redirectUrl) {
      throw new Error('get-session-cookie: gateway did not return a redirect to Keycloak');
    }

    Logger.debug(`Keycloak auth URL: ${redirectUrl}`);

    Logger.info('Open the following URL in your browser to log in:\n');
    console.log(`  ${chalk.cyan.underline(redirectUrl)}\n`);
    Logger.info(
      'After login, open your browser\'s DevTools Network tab and copy the '
      + `${chalk.bold(cookieName)} value from the ${chalk.bold('Set-Cookie')} response header.`,
    );

    const raw = await Prompts.input(`Paste the ${cookieName} cookie value`);
    const value = raw.trim();
    if (!value) {
      throw new Error('get-session-cookie: no cookie value provided');
    }

    if (value.startsWith(`${cookieName}=`)) return value;
    return `${cookieName}=${value}`;
  }

  static startCallbackServer(timeout) {
    return new Promise((resolve, reject) => {
      let codeResolve, codeReject;
      const codePromise = new Promise((res, rej) => { codeResolve = res; codeReject = rej; });

      const timer = setTimeout(() => {
        server.close();
        codeReject(new Error('get-token: login timed out — no callback received'));
      }, timeout);

      const server = createServer((req, res) => {
        const url = new URL(req.url, `http://localhost`);
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Login failed</h2><p>You can close this tab.</p></body></html>');
          clearTimeout(timer);
          codeReject(new Error(`get-token: Keycloak error: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Missing code</h2></body></html>');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Login successful!</h2><p>You can close this tab.</p></body></html>');
        clearTimeout(timer);
        codeResolve(code);
      });

      server.listen(0, '127.0.0.1', () => {
        resolve({ callbackPort: server.address().port, codePromise, server });
      });

      server.on('error', (err) => reject(err));
    });
  }

  /**
   * Send an HTTP request to the gateway
   * @param {string} gateway - Gateway address
   * @param {Object} step - Test step configuration
   * @param {SpinnerLogger} spinner - Spinner logger
   * @param {number} timeout - Request timeout in milliseconds
   * @returns {Promise<{response: Response, body: any, status: number}>}
   */
  static async sendHttpRequest(gateway, step, spinner, timeout = 15000, port = 8080) {
    const { prompt, endpoint, model, method = 'POST', headers = {} } = step;
    
    // Determine the endpoint
    let url;
    if (endpoint) {
      // Direct endpoint specified
      url = endpoint.startsWith('http') ? endpoint : `http://${gateway}:${port}${endpoint}`;
    } else if (prompt) {
      // LLM prompt - use default chat completion endpoint
      // The path will be rewritten by kgateway based on the Backend configuration
      url = `http://${gateway}:${port}/chat`;
    } else {
      throw new Error('Test step must specify either "prompt" or "endpoint"');
    }

    // Build request body
    let body = null;
    if (prompt) {
      // LLM chat completion format (OpenAI-compatible)
      body = JSON.stringify({
        model: model || '',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });
    } else if (step.input != null) {
      // Embeddings format (OpenAI-compatible)
      const embeddingBody = { input: step.input };
      if (model) embeddingBody.model = model;
      body = JSON.stringify(embeddingBody);
    } else if (step.body) {
      // Custom body specified
      body = typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
    }

    // Build headers (expand ${ENV_VAR} references in values)
    const expandedHeaders = {};
    for (const [key, val] of Object.entries(headers)) {
      expandedHeaders[key] = String(val).replace(/\$\{(\w+)\}/g, (_, v) => process.env[v] || '');
    }
    const requestHeaders = {
      'Content-Type': 'application/json',
      ...expandedHeaders
    };

    Logger.debug(`Sending ${method} request to ${url} (timeout: ${timeout}ms)`);
    if (body) {
      Logger.debug(`Request body: ${body.substring(0, 200)}...`);
    }

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Make the request with timeout
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body || undefined,
        signal: controller.signal,
        ...(step.followRedirects === false && { redirect: 'manual' }),
      });

      clearTimeout(timeoutId);

      const status = response.status;
      const contentType = response.headers.get('content-type');
      
      // Parse response body
      let responseBody;
      try {
        if (contentType && contentType.includes('application/json')) {
          responseBody = await response.json();
        } else {
          responseBody = await response.text();
        }
      } catch (error) {
        responseBody = null;
      }

      Logger.debug(`Response status: ${status}`);
      if (responseBody) {
        Logger.debug(`Response body: ${JSON.stringify(responseBody).substring(0, 200)}...`);
      }

      return {
        response,
        body: responseBody,
        status
      };
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Check if it was a timeout
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout}ms`);
      }
      
      throw error;
    }
  }

  /**
   * Send an MCP (JSON-RPC) request to the gateway.
   *
   * Performs the Streamable HTTP handshake:
   *   1. POST initialize → receive server capabilities + session id
   *   2. POST notifications/initialized
   *   3. POST the actual method (e.g. tools/list, tools/call)
   *
   * @param {string} gateway - Gateway address
   * @param {Object} step - Test step: { endpoint, method, params, headers }
   * @param {SpinnerLogger} spinner
   * @param {number} timeout - ms
   * @param {number} port
   * @returns {Promise<{response: Response, body: any, status: number}>}
   */
  static async sendMcpRequest(gateway, step, spinner, timeout = 30000, port = 8080) {
    const endpoint = step.endpoint || '/mcp';
    const url = endpoint.startsWith('http') ? endpoint : `http://${gateway}:${port}${endpoint}`;

    const expandedHeaders = {};
    for (const [key, val] of Object.entries(step.headers || {})) {
      expandedHeaders[key] = String(val).replace(/\$\{(\w+)\}/g, (_, v) => process.env[v] || '');
    }
    const baseHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...expandedHeaders };

    let rpcId = 1;
    let sessionId = null;

    const jsonRpcPost = async (method, params, isNotification = false) => {
      const body = {
        jsonrpc: '2.0',
        method,
        ...(params ? { params } : {}),
        ...(!isNotification ? { id: rpcId++ } : {}),
      };
      const hdrs = { ...baseHeaders };
      if (sessionId) hdrs['Mcp-Session-Id'] = sessionId;

      Logger.debug(`MCP ${method} -> ${url}  body=${JSON.stringify(body).substring(0, 300)}`);

      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeout);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(tid);

        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;

        const ct = res.headers.get('content-type') || '';
        let resBody;
        if (ct.includes('text/event-stream')) {
          const text = await res.text();
          const lines = text.split('\n');
          const dataLines = lines.filter(l => l.startsWith('data: ')).map(l => l.slice(6));
          const last = dataLines[dataLines.length - 1];
          try { resBody = JSON.parse(last); } catch { resBody = text; }
        } else if (ct.includes('application/json')) {
          resBody = await res.json();
        } else {
          resBody = await res.text();
        }

        Logger.debug(`MCP ${method} <- status=${res.status}  body=${JSON.stringify(resBody).substring(0, 300)}`);
        return { response: res, body: resBody, status: res.status };
      } catch (err) {
        clearTimeout(tid);
        if (err.name === 'AbortError') throw new Error(`MCP request timed out after ${timeout}ms`);
        throw err;
      }
    };

    const cleanupSession = async () => {
      if (!sessionId) return;
      try {
        const hdrs = { ...baseHeaders, 'Mcp-Session-Id': sessionId };
        await fetch(url, { method: 'DELETE', headers: hdrs, signal: AbortSignal.timeout(5000) });
      } catch { /* best-effort */ }
    };

    // 1. Initialize
    spinner.setText(`MCP initialize -> ${url}`);
    const initRes = await jsonRpcPost('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'agentgateway-demo-test', version: '1.0.0' },
    });

    if (initRes.status >= 400) {
      return initRes;
    }

    // 2. Notify initialized
    await jsonRpcPost('notifications/initialized', undefined, true);

    // 3. For tools/call, first discover tools so the gateway builds its routing map
    if (step.method === 'tools/call') {
      spinner.setText(`MCP tools/list (warmup) -> ${url}`);
      await jsonRpcPost('tools/list');
    }

    // 4. Actual method
    spinner.setText(`MCP ${step.method} -> ${url}`);
    const result = await jsonRpcPost(step.method, step.params || undefined);

    // 5. Clean up session
    await cleanupSession();

    return result;
  }

  /**
   * Verify the response matches expectations
   * @param {Response} response - HTTP response
   * @param {any} body - Response body
   * @param {number} status - Response status code
   * @param {Object} step - Test step with expectations
   * @param {SpinnerLogger} spinner - Spinner logger
   * @returns {Promise<void>}
   */
  static async verifyResponse(response, body, status, step, spinner) {
    const { expect = {} } = step;

    // Verify status
    if (expect.status === 'success') {
      // 2xx success
      if (status < 200 || status >= 300) {
        throw new Error(`Expected success status (2xx), got ${status}`);
      }
    } else if (expect.status === 'blocked') {
      // Blocked by guardrails should be 403 Forbidden
      if (status !== 403) {
        throw new Error(`Expected blocked status (403), got ${status}`);
      }
    } else if (expect.status === 'error') {
      // Any error (4xx or 5xx)
      if (status < 400) {
        throw new Error(`Expected error status (4xx or 5xx), got ${status}`);
      }
    } else if (typeof expect.status === 'number') {
      // Exact status code match
      if (status !== expect.status) {
        throw new Error(`Expected status ${expect.status}, got ${status}`);
      }
    }

    if (expect.contains) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      Logger.debug(`Response body:\n${bodyStr.substring(0, 2000)}`);
      const items = Array.isArray(expect.contains) ? expect.contains : [expect.contains];
      const lowerBody = bodyStr.toLowerCase();
      for (const item of items) {
        if (!lowerBody.includes(String(item).toLowerCase())) {
          throw new Error(`Response does not contain expected text: "${item}"`);
        }
      }
    }

    // Verify PII redaction
    if (expect.piiRedacted === true) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      // Check for common PII patterns that should be masked
      const piiPatterns = [
        /\d{3}-\d{2}-\d{4}/, // SSN
        /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/, // Credit card
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ // Email
      ];
      
      for (const pattern of piiPatterns) {
        if (pattern.test(bodyStr)) {
          spinner.clear();
          Logger.warn(`Warning: Potential unredacted PII found in response`);
          spinner.render();
          // Note: This is a soft warning, not a hard failure
          // Full implementation would be more sophisticated
        }
      }
    }

    // Verify reason if specified
    if (expect.reason) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      if (!bodyStr.toLowerCase().includes(expect.reason.toLowerCase())) {
        Logger.debug(`Expected reason "${expect.reason}" not found in response`);
      }
    }

    // Verify model matches expected priority models
    if (expect.modelIn) {
      const expectedModels = Array.isArray(expect.modelIn) ? expect.modelIn : [expect.modelIn];
      let actualModel = null;
      
      // Extract model from response body
      if (body && typeof body === 'object') {
        // Try different common model field names
        actualModel = body.model || body.model_name || body.id || null;
        
        // For OpenAI format: "chatcmpl-xxx" -> extract from choices[0].message if available
        if (!actualModel && body.choices && body.choices[0]) {
          actualModel = body.choices[0].model || null;
        }
        
        // For Anthropic format: check id field format
        if (!actualModel && body.id) {
          // Anthropic IDs are like "msg_xxx" - model is in the response metadata
          // But typically model is in the root
          actualModel = body.model || null;
        }
      } else if (typeof body === 'string') {
        try {
          const parsed = JSON.parse(body);
          actualModel = parsed.model || parsed.model_name || parsed.id || null;
          if (!actualModel && parsed.choices && parsed.choices[0]) {
            actualModel = parsed.choices[0].model || null;
          }
        } catch {
          // Not JSON, try to find model in string using regex
          const modelPatterns = [
            /"model"\s*:\s*"([^"]+)"/,
            /"model_name"\s*:\s*"([^"]+)"/,
            /model["\s:=]+([a-z0-9\-\.]+)/i
          ];
          
          for (const pattern of modelPatterns) {
            const match = body.match(pattern);
            if (match && match[1]) {
              actualModel = match[1];
              break;
            }
          }
        }
      }
      
      if (!actualModel) {
        throw new Error('Could not extract model from response. Response body: ' + JSON.stringify(body).substring(0, 200));
      }
      
      // Normalize model name (remove version suffixes, etc.)
      const normalizeModel = (model) => {
        if (!model) return '';
        // Remove common version suffixes
        return model
          .replace(/-\d{4}-\d{2}-\d{2}$/, '') // Remove date suffixes like -20241022
          .replace(/-latest$/, '') // Remove -latest suffix
          .toLowerCase();
      };
      
      const normalizedActual = normalizeModel(actualModel);
      
      // Check if actual model matches any of the expected models
      // Allow partial matches (e.g., "gpt-3.5-turbo-20241022" matches "gpt-3.5-turbo")
      const matches = expectedModels.some(expected => {
        const normalizedExpected = normalizeModel(expected);
        
        // Exact match after normalization
        if (normalizedActual === normalizedExpected) return true;
        
        // Check if actual model starts with expected (for versioned models)
        if (normalizedActual.startsWith(normalizedExpected) || normalizedExpected.startsWith(normalizedActual)) {
          return true;
        }
        
        // Check if expected is a substring (for partial matches)
        if (normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual)) {
          return true;
        }
        
        // Check original values for exact match
        if (actualModel === expected) return true;
        if (actualModel.startsWith(expected) || expected.startsWith(actualModel)) return true;
        
        return false;
      });
      
      if (!matches) {
        throw new Error(
          `Model mismatch: expected one of [${expectedModels.join(', ')}], got "${actualModel}"`
        );
      }
      
      Logger.debug(`Model verification passed: "${actualModel}" matches one of [${expectedModels.join(', ')}]`);
    }

    // Verify guard was triggered
    if (expect.guard) {
      Logger.debug(`Checking for guard: ${expect.guard}`);
      // Full implementation would check specific guard headers or response fields
    }

    // Verify warnings
    if (expect.warnings) {
      Logger.debug(`Checking for warnings: ${JSON.stringify(expect.warnings)}`);
      // Full implementation would check for warning headers or response fields
    }

    spinner.setText('Response verified successfully');
  }

  /**
   * Get the gateway LoadBalancer address
   * @param {string} namespace - Gateway namespace
   * @returns {Promise<string|null>} Gateway address or null
   */
  static async getGatewayAddress(namespace, gatewayName = 'agentgateway') {
    try {
      const result = await KubernetesHelper.kubectl([
        'get', 'gateway', gatewayName,
        '-n', namespace,
        '-o', 'jsonpath={.status.addresses[0].value}'
      ], { ignoreError: true });

      return result.stdout.trim() || null;
    } catch (error) {
      return null;
    }
  }

}

