import { Feature, FeatureManager } from '../../src/lib/feature.js';
import { KubernetesHelper, Logger } from '../../src/lib/common.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

/**
 * Budget Limiter Feature
 *
 * Implements cost-based budget limiting for LLM requests using an ext-proc server.
 * Unlike traditional rate limiting (requests/minute or tokens/minute), this system
 * enforces budgets measured in USD.
 *
 * Configuration:
 * {
 *   budgetAmount: number,       // Budget amount in USD (required)
 *   period: string,             // Budget period: 'hourly' | 'daily' | 'weekly' | 'monthly' (default: 'daily')
 *   entityType: string,         // Entity type: 'provider' | 'org' | 'team' (default: 'provider')
 *   name: string,               // Entity name (default: 'openai')
 *   matchExpression: string,    // CEL expression for matching requests (default: 'true')
 *   warningThresholdPct: number, // Warning threshold percentage (default: 80)
 *   description: string,        // Optional description for the budget
 *   deployInfra: boolean,       // Deploy PostgreSQL and budget-limiter service (default: true)
 * }
 */
export class BudgetLimiterFeature extends Feature {
  validate() {
    const { budgetAmount } = this.config;
    if (budgetAmount === undefined || budgetAmount === null) {
      throw new Error('budgetAmount is required');
    }
    if (typeof budgetAmount !== 'number' || budgetAmount <= 0) {
      throw new Error('budgetAmount must be a positive number');
    }
    return true;
  }

  get budgetLimiterName() {
    return 'budget-limiter';
  }

  get policyName() {
    return `${this.budgetLimiterName}-policy`;
  }

  get serviceName() {
    return 'budget-limiter';
  }

  async deploy() {
    const {
      budgetAmount,
      period = 'daily',
      entityType = 'provider',
      name = 'openai',
      matchExpression = 'true',
      warningThresholdPct = 80,
      description = '',
      deployInfra = true,
    } = this.config;

    // Deploy PostgreSQL and budget-limiter service if needed
    if (deployInfra) {
      await this.deployInfrastructure();
    }

    // Apply the EnterpriseAgentgatewayPolicy for ext-proc
    await this.applyExtProcPolicy();

    // Create the budget via HTTP API
    await this.createBudget({
      entityType,
      name,
      matchExpression,
      budgetAmount,
      period,
      warningThresholdPct,
      description,
    });
  }

  async deployInfrastructure() {
    this.log('Deploying budget-limiter infrastructure...');

    // Deploy using the Makefile target
    try {
      await execAsync('make deploy-budget-limiter', {
        cwd: process.cwd(),
        env: { ...process.env, NAMESPACE: this.namespace },
      });
    } catch (error) {
      // If make fails, try kubectl directly
      this.log('Makefile deploy failed, trying kubectl directly...', 'warn');
      await this.deployWithKubectl();
    }

    // Deploy PodMonitor for metrics scraping if CRD exists
    await this.deployPodMonitor();
  }

  async deployPodMonitor() {
    // Check if PodMonitor CRD exists
    try {
      const result = await KubernetesHelper.kubectl([
        'get', 'crd', 'podmonitors.monitoring.coreos.com',
      ], { ignoreError: true });

      if (result.exitCode !== 0) {
        this.log('PodMonitor CRD not found, skipping metrics scraping setup', 'info');
        return;
      }

      this.log('PodMonitor CRD found, deploying metrics scraping...');
      await this.applyYamlFile('pod-monitor.yaml');
      this.log('PodMonitor deployed for budget-limiter metrics');
    } catch (error) {
      this.log(`Failed to deploy PodMonitor: ${error.message}`, 'warn');
    }
  }

  async deployWithKubectl() {
    const projectRoot = process.cwd();

    // Apply PostgreSQL resources
    const postgresPath = `${projectRoot}/extras/budget-limiter/deploy/postgres.yaml`;
    await KubernetesHelper.kubectl(['apply', '-f', postgresPath, '-n', this.namespace]);

    // Wait for PostgreSQL to be ready
    this.log('Waiting for PostgreSQL to be ready...');
    try {
      await KubernetesHelper.kubectl([
        'wait', '--for=condition=ready', 'pod',
        '-l', 'app=budget-limiter-postgres',
        '-n', this.namespace,
        '--timeout=120s',
      ]);
    } catch (error) {
      this.log('PostgreSQL not ready yet, continuing...', 'warn');
    }

    // Apply deployment resources with image substitution
    const deploymentPath = `${projectRoot}/extras/budget-limiter/deploy/deployment.yaml`;
    const imageRepo = process.env.IMAGE_REPO || '';
    const imagePrefix = imageRepo ? `${imageRepo}/` : '';
    const imageTag = process.env.IMAGE_TAG || 'latest';
    const fullImage = `${imagePrefix}budget-limiter:${imageTag}`;

    let deploymentYaml = await fs.readFile(deploymentPath, 'utf8');
    deploymentYaml = deploymentYaml.replace(
      /image: budget-limiter:latest/g,
      `image: ${fullImage}`
    );
    await KubernetesHelper.applyYaml(deploymentYaml);

    // Wait for deployment to be ready
    this.log('Waiting for budget-limiter to be ready...');
    try {
      await KubernetesHelper.kubectl([
        'rollout', 'status', 'deployment/budget-limiter',
        '-n', this.namespace,
        '--timeout=60s',
      ]);
    } catch (error) {
      this.log('Budget-limiter deployment not ready yet', 'warn');
    }
  }

  async applyExtProcPolicy() {
    const gatewayRef = FeatureManager.getGatewayRef();
    const gatewayName = this.config.gatewayName || gatewayRef.name;

    const policyOverrides = {
      metadata: { name: this.policyName },
      spec: {
        targetRefs: [
          {
            name: gatewayName,
            group: 'gateway.networking.k8s.io',
            kind: 'Gateway',
          },
        ],
        traffic: {
          extProc: {
            backendRef: {
              group: '',
              kind: 'Service',
              name: this.serviceName,
              namespace: this.namespace,
              port: 4444,
            },
          },
        },
      },
    };

    await this.applyYamlFile('enterprise-agentgateway-policy.yaml', policyOverrides);
  }

  async createBudget(budgetConfig) {
    const {
      entityType,
      name,
      matchExpression,
      budgetAmount,
      period,
      warningThresholdPct,
      description,
    } = budgetConfig;

    // Wait a bit for the service to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Try to create budget via kubectl exec (since we're in cluster)
    const budgetPayload = JSON.stringify({
      entity_type: entityType,
      name: name,
      match_expression: matchExpression,
      budget_amount_usd: budgetAmount,
      period: period,
      warning_threshold_pct: warningThresholdPct,
      description: description || `Budget for ${entityType}:${name}`,
    });

    this.log(`Creating budget: ${entityType}:${name} = $${budgetAmount}/${period}`);

    try {
      // Use kubectl to create a job that posts to the API
      const result = await KubernetesHelper.kubectl([
        'run', 'budget-create-job', '--rm', '-i', '--restart=Never',
        '-n', this.namespace,
        '--image=curlimages/curl:latest',
        '--',
        'curl', '-s', '-X', 'POST',
        '-H', 'Content-Type: application/json',
        '-d', budgetPayload,
        `http://${this.serviceName}:8080/api/v1/budgets`,
      ]);
      this.log('Budget created successfully');
    } catch (error) {
      // Budget may already exist, which is fine
      this.log(`Budget creation note: ${error.message}`, 'warn');
    }
  }

  async cleanup() {
    // Delete the ext-proc policy
    await this.deleteResource('EnterpriseAgentgatewayPolicy', this.policyName);

    // Clean up PodMonitor if it exists
    await this.cleanupPodMonitor();

    // Optionally clean up infrastructure
    if (this.config.cleanupInfra) {
      await this.cleanupInfrastructure();
    }
  }

  async cleanupPodMonitor() {
    try {
      await KubernetesHelper.kubectl([
        'delete', 'podmonitor', 'budget-limiter-metrics',
        '-n', this.namespace,
        '--ignore-not-found',
      ]);
    } catch (error) {
      // Silently ignore - PodMonitor CRD might not exist
    }
  }

  async cleanupInfrastructure() {
    this.log('Cleaning up budget-limiter infrastructure...');

    try {
      await execAsync('make undeploy-budget-limiter', {
        cwd: process.cwd(),
        env: { ...process.env, NAMESPACE: this.namespace },
      });
    } catch (error) {
      // Try kubectl directly
      const projectRoot = process.cwd();

      const deploymentPath = `${projectRoot}/extras/budget-limiter/deploy/deployment.yaml`;
      await KubernetesHelper.kubectl(['delete', '-f', deploymentPath, '-n', this.namespace, '--ignore-not-found']);

      const postgresPath = `${projectRoot}/extras/budget-limiter/deploy/postgres.yaml`;
      await KubernetesHelper.kubectl(['delete', '-f', postgresPath, '-n', this.namespace, '--ignore-not-found']);
    }
  }
}

export function createBudgetLimiterFeature(config) {
  return new BudgetLimiterFeature('budget-limiter', config);
}
