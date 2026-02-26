import chalk from 'chalk';
import { execa } from 'execa';
import ora from 'ora';
import logSymbols from 'log-symbols';
import stringWidth from 'string-width';

/**
 * Common utilities for the agentgateway demo framework
 */

export class Logger {
  static info(message) {
    console.log(chalk.blue(logSymbols.info), message);
  }

  static success(message) {
    console.log(chalk.green(logSymbols.success), message);
  }

  static warn(message) {
    console.log(chalk.yellow(logSymbols.warning), message);
  }

  static error(message) {
    console.error(chalk.red(logSymbols.error), message);
  }

  static debug(message) {
    if (process.env.DEBUG === 'true') {
      console.log(chalk.gray(logSymbols.info), message);
    }
  }
}

/**
 * SpinnerLogger - Manages ora spinner with logging
 * Properly handles spinner state when logging messages
 */
export class SpinnerLogger {
  constructor(initialText = '') {
    this.spinner = ora(initialText);
    this.isSpinning = false;
  }

  start(text) {
    this.spinner.text = text;
    this.spinner.start();
    this.isSpinning = true;
    return this;
  }

  stop() {
    if (this.isSpinning) {
      this.spinner.stop();
      this.isSpinning = false;
    }
    return this;
  }

  succeed(message) {
    this.spinner.succeed(message);
    this.isSpinning = false;
    return this;
  }

  fail(message) {
    this.spinner.fail(message);
    this.isSpinning = false;
    return this;
  }

  warn(message) {
    this.spinner.warn(message);
    this.isSpinning = false;
    return this;
  }

  info(message) {
    this.spinner.info(message);
    this.isSpinning = false;
    return this;
  }

  setText(text) {
    this.spinner.text = text;
    return this;
  }

  /**
   * Safely log a message while spinner is running
   * Clears spinner, logs message, then re-renders spinner
   * Note: 'info' level messages are suppressed to avoid cluttering output
   */
  logWhileSpinning(message, level = 'info') {
    // Suppress info-level messages during spinner operation
    if (level === 'info') {
      return this;
    }
    
    if (this.isSpinning) {
      this.spinner.clear();
      this.spinner.frame();
    }
    
    switch (level) {
      case 'success':
        Logger.success(message);
        break;
      case 'warn':
        Logger.warn(message);
        break;
      case 'error':
        Logger.error(message);
        break;
      case 'debug':
        Logger.debug(message);
        break;
    }

    if (this.isSpinning) {
      this.spinner.render();
    }
    
    return this;
  }

  /**
   * Safely output to console while spinner is running
   * Use this instead of console.log when a spinner is active
   */
  consoleLog(...args) {
    if (this.isSpinning) {
      this.spinner.clear();
      console.log(...args);
      this.spinner.render();
    } else {
      console.log(...args);
    }
    return this;
  }

  /**
   * Clear the spinner (useful before other console output)
   */
  clear() {
    if (this.isSpinning) {
      this.spinner.clear();
    }
    return this;
  }

  /**
   * Re-render the spinner (useful after console output)
   */
  render() {
    if (this.isSpinning) {
      this.spinner.render();
    }
    return this;
  }
}

export class CommandRunner {
  static async run(command, args = [], options = {}) {
    const { verbose = false, cwd = process.cwd(), spinner = null } = options;

    if (verbose) {
      Logger.debug(`Running: ${command} ${args.join(' ')}`);
    }

    try {
      const result = await execa(command, args, {
        cwd,
        ...options,
      });
      return result;
    } catch (error) {
      if (!options.ignoreError) {
        // Don't log here - let the caller handle error logging
        // This prevents duplicate error messages in the output
        throw error;
      }
      return error;
    }
  }

  static async exec(command, options = {}) {
    return this.run('bash', ['-c', command], options);
  }
}

export class KubernetesHelper {
  static async kubectl(args, options = {}) {
    return CommandRunner.run('kubectl', args, options);
  }

  static async helm(args, options = {}) {
    return CommandRunner.run('helm', args, options);
  }

  static async waitForPod(namespace, labelSelector, timeout = 300, externalSpinner = null) {
    // Use external spinner if provided, otherwise create new one
    const spinner = externalSpinner || new SpinnerLogger();
    const ownSpinner = !externalSpinner;
    
    if (ownSpinner) {
      spinner.start('Waiting for pod to be ready...');
    } else {
      spinner.setText('Waiting for pod to be ready...');
    }
    
    try {
      await this.kubectl([
        'wait',
        '--for=condition=ready',
        'pod',
        '-l', labelSelector,
        '-n', namespace,
        `--timeout=${timeout}s`
      ], { spinner });
      
      if (ownSpinner) {
        spinner.succeed('Pod is ready');
      }
      return true;
    } catch (error) {
      if (ownSpinner) {
        spinner.fail('Pod failed to become ready');
      }
      throw error;
    }
  }

  static async waitForDeployment(namespace, deploymentName, timeout = 300, externalSpinner = null) {
    // Use external spinner if provided, otherwise create new one
    const spinner = externalSpinner || new SpinnerLogger();
    const ownSpinner = !externalSpinner;
    
    const startTime = Date.now();
    const timeoutMs = timeout * 1000;
    
    // First, wait for the deployment to exist
    if (ownSpinner) {
      spinner.start('Waiting for deployment to be created...');
    } else {
      spinner.setText('Waiting for deployment to be created...');
    }
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const result = await this.kubectl([
          'get', 'deployment', deploymentName,
          '-n', namespace
        ], { ignoreError: true, spinner });
        
        if (result.exitCode === 0) {
          break;
        }
      } catch {
        // Deployment doesn't exist yet, continue waiting
      }
      
      // Wait 2 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if we've timed out
      if (Date.now() - startTime >= timeoutMs) {
        if (ownSpinner) {
          spinner.fail(`Timeout waiting for deployment ${deploymentName} to be created`);
        }
        throw new Error(`Deployment ${deploymentName} was not created within ${timeout}s`);
      }
    }
    
    // Now wait for the deployment to become available
    spinner.setText('Waiting for deployment to be ready...');
    
    try {
      const remainingTimeout = Math.max(10, Math.floor((timeoutMs - (Date.now() - startTime)) / 1000));
      
      await this.kubectl([
        'wait',
        '--for=condition=available',
        `deployment/${deploymentName}`,
        '-n', namespace,
        `--timeout=${remainingTimeout}s`
      ], { spinner });
      
      if (ownSpinner) {
        spinner.succeed('Deployment is ready');
      }
      return true;
    } catch (error) {
      if (ownSpinner) {
        spinner.fail('Deployment failed to become ready');
      }
      throw error;
    }
  }

  static async ensureNamespace(namespace, spinner = null) {
    const result = await this.kubectl(['get', 'namespace', namespace], { ignoreError: true });
    const exists = result.exitCode === 0;
    if (exists) {
      if (!spinner) {
        Logger.info(`Namespace ${namespace} already exists`);
      }
      return;
    }
    // Namespace does not exist — create it
    if (!spinner) {
      Logger.info(`Creating namespace ${namespace}...`);
    }
    await this.kubectl(['create', 'namespace', namespace]);
    if (!spinner) {
      Logger.success(`Namespace ${namespace} created`);
    }
  }

  /**
   * Check if a Kubernetes resource exists
   * @param {string} resourceType - Resource type (e.g., 'secret', 'deployment')
   * @param {string} name - Resource name
   * @param {string} namespace - Namespace (optional)
   * @returns {Promise<boolean>} True if resource exists
   */
  static async resourceExists(resourceType, name, namespace = null) {
    try {
      const args = ['get', resourceType, name];
      if (namespace) {
        args.push('-n', namespace);
      }
      args.push('--ignore-not-found=true', '-o', 'name');
      
      const result = await this.kubectl(args, { ignoreError: true });
      return result.stdout.trim().length > 0;
    } catch (error) {
      return false;
    }
  }

  static async createSecretFromLiteral(namespace, secretName, key, value, spinner = null) {
    try {
      await this.kubectl([
        'create', 'secret', 'generic', secretName,
        `--from-literal=${key}=${value}`,
        '-n', namespace,
        '--dry-run=client',
        '-o', 'yaml'
      ]).then(result => 
        this.kubectl(['apply', '-f', '-'], { 
          input: result.stdout 
        })
      );
    } catch (error) {
      // Don't log here - let the feature handle error logging
      throw error;
    }
  }

  static async applyYaml(yamlContent, spinner = null) {
    try {
      await this.kubectl(['apply', '-f', '-'], { 
        input: yamlContent 
      });
    } catch (error) {
      // Don't log here - let the feature handle error logging
      throw error;
    }
  }

  static async deleteIfExists(resourceType, resourceName, namespace, spinner = null) {
    try {
      await this.kubectl(['get', resourceType, resourceName, '-n', namespace], { 
        ignoreError: true 
      });
      await this.kubectl(['delete', resourceType, resourceName, '-n', namespace, '--wait=false']);
    } catch {
      // Silently ignore - resource doesn't exist
    }
  }

  static async getLoadBalancerAddress(namespace, serviceName, timeout = 300) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout * 1000) {
      try {
        const result = await this.kubectl([
          'get', 'svc', serviceName,
          '-n', namespace,
          '-o', 'jsonpath={.status.loadBalancer.ingress[0].ip}{.status.loadBalancer.ingress[0].hostname}'
        ], { ignoreError: true });
        
        const address = result.stdout.trim();
        if (address) {
          return address;
        }
      } catch {
        // Continue waiting
      }
      
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    throw new Error('Timeout waiting for LoadBalancer address');
  }
}

export async function checkDependencies() {
  const required = ['kubectl', 'helm', 'docker', 'lok8s', 'jq', 'yq'];
  const missing = [];

  Logger.info('Checking dependencies...');

  for (const cmd of required) {
    try {
      await CommandRunner.run('command', ['-v', cmd], { ignoreError: true });
      console.log(chalk.green('✓'), cmd);
    } catch {
      console.log(chalk.yellow('✗'), cmd, chalk.gray('(missing)'));
      missing.push(cmd);
    }
  }

  if (missing.length > 0) {
    Logger.error(`Missing required dependencies: ${missing.join(', ')}`);
    Logger.info('Please install missing dependencies before continuing.');
    return false;
  }

  Logger.success('All dependencies are installed');
  return true;
}

export function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Print a bordered box showing raw HTTP request and response details.
 * @param {{ method: string, url: string, headers: Object, body: any }} request
 * @param {{ status: number, headers: Object, body: any }} response
 */
export function printTrafficBox(request, response) {
  const BOX_WIDTH = Math.min(process.stdout.columns || 100, 100);
  const INNER = BOX_WIDTH - 2;
  const CONTENT_MAX = INNER - 2;

  const DIM = chalk.dim;

  const padVisual = (str, width) => {
    const w = stringWidth(str);
    return w >= width ? str : str + ' '.repeat(width - w);
  };

  const top    = DIM('┌' + '─'.repeat(INNER) + '┐');
  const bottom = DIM('└' + '─'.repeat(INNER) + '┘');
  const mid    = DIM('├' + '─'.repeat(INNER) + '┤');

  const row = (text = '') => {
    const safe = String(text).replace(/\r?\n/g, ' ');
    const visLen = stringWidth(safe);
    const content = visLen > CONTENT_MAX
      ? safe.replace(/\x1B\[[0-9;]*m/g, '').substring(0, CONTENT_MAX - 1) + '…'
      : safe;
    return DIM('│') + ' ' + padVisual(content, CONTENT_MAX) + ' ' + DIM('│');
  };

  const sectionRow = (label, colorFn) => {
    const colored = colorFn(' ' + label);
    return DIM('│') + padVisual(colored, INNER) + DIM('│');
  };

  const maskSensitive = (key, value) => {
    const k = key.toLowerCase();
    if (['authorization', 'x-ai-api-key', 'x-api-key', 'cookie'].includes(k)) {
      const s = String(value);
      return s.length > 20 ? s.substring(0, 12) + '…[masked]' : s;
    }
    return value;
  };

  const formatBodyLines = (body, maxLines = 30) => {
    if (body == null || body === '') return ['(empty)'];
    let str;
    if (typeof body === 'object') {
      try { str = JSON.stringify(body, null, 2); } catch { str = String(body); }
    } else {
      str = String(body);
    }
    const lines = str.split('\n');
    return lines.length > maxLines
      ? [...lines.slice(0, maxLines), chalk.dim(`… (${lines.length - maxLines} more lines)`)]
      : lines;
  };

  const out = ['', top];

  out.push(sectionRow('REQUEST', chalk.bold.cyan));
  out.push(row());
  out.push(row(`  ${chalk.bold(request.method)}  ${request.url}`));

  if (request.headers && Object.keys(request.headers).length > 0) {
    out.push(row());
    out.push(row(chalk.dim('  Headers')));
    for (const [k, v] of Object.entries(request.headers)) {
      out.push(row(`    ${chalk.dim(k + ':')} ${maskSensitive(k, v)}`));
    }
  }

  if (request.body != null) {
    out.push(row());
    out.push(row(chalk.dim('  Body')));
    for (const l of formatBodyLines(request.body)) {
      out.push(row('    ' + l));
    }
  }

  out.push(mid);

  out.push(sectionRow('RESPONSE', chalk.bold.magenta));
  out.push(row());

  const statusFn = response.status >= 200 && response.status < 300
    ? chalk.green
    : response.status >= 400 ? chalk.red : chalk.yellow;
  out.push(row('  ' + chalk.dim('Status:') + ' ' + statusFn(String(response.status))));

  if (response.headers && Object.keys(response.headers).length > 0) {
    out.push(row());
    out.push(row(chalk.dim('  Headers')));
    for (const [k, v] of Object.entries(response.headers)) {
      out.push(row(`    ${chalk.dim(k + ':')} ${v}`));
    }
  }

  if (response.body != null) {
    out.push(row());
    out.push(row(chalk.dim('  Body')));
    for (const l of formatBodyLines(response.body)) {
      out.push(row('    ' + l));
    }
  }

  out.push(bottom, '');
  console.log(out.join('\n'));
}

