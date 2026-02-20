import { Feature, FeatureManager } from '../../src/lib/feature.js';
import { KubernetesHelper } from '../../src/lib/common.js';

/**
 * M2M Agent Feature
 *
 * Deploys the M2M ADK agent (from extras/m2m-agent/) as a long-running
 * Deployment inside the cluster. The agent uses M2MPlugin to exchange
 * the caller's JWT with the AGW STS and injects the resulting token into
 * every outbound MCP tool call.
 *
 * Reference: extras/m2m-agent/
 *
 * Resources created:
 * - Secret            — API keys (GOOGLE_API_KEY / OPENAI_API_KEY)
 * - ServiceAccount    — m2m-agent
 * - Deployment        — m2m-agent:latest; reads API keys from the Secret
 * - Service           — ClusterIP :8080
 * - HTTPRoute         — exposes /agent through the existing gateway
 *
 * Configuration:
 * {
 *   agentName: string,         // Default: 'm2m-agent'
 *   image: string,             // Default: 'm2m-agent:latest'
 *   imagePullPolicy: string,   // Default: 'IfNotPresent'
 *   model: string,             // Default: 'gemini-2.0-flash'
 *   mcpUrl: string,            // MCP server URL through the AGW proxy
 *   stsTokenUrl: string,       // AGW STS /oauth2/token endpoint
 *   pathPrefix: string,        // Default: '/agent'
 *   routeName: string,         // HTTPRoute name (default: 'm2m-agent')
 *   googleApiKey: string,      // Fallback: GOOGLE_API_KEY env var
 *   openaiApiKey: string,      // Fallback: OPENAI_API_KEY env var
 *   apiSecretName: string,     // Default: 'm2m-agent-api-keys'
 * }
 */
export class M2MAgentFeature extends Feature {
  constructor(name, config) {
    super(name, config);

    this.agentName = config.agentName || 'm2m-agent';
    this.image = config.image || 'm2m-agent:latest';
    this.imagePullPolicy = config.imagePullPolicy || 'IfNotPresent';
    this.model = config.model || 'gemini-2.0-flash';

    const ns = this.namespace;
    this.mcpUrl = config.mcpUrl ||
      `http://agentgateway.${ns}.svc.cluster.local:8080/mcp`;
    this.stsTokenUrl = config.stsTokenUrl ||
      `http://enterprise-agentgateway.${ns}.svc.cluster.local:7777/oauth2/token`;

    this.pathPrefix = config.pathPrefix || '/agent';
    this.routeName = config.routeName || 'm2m-agent';

    this.googleApiKey = config.googleApiKey || process.env.GOOGLE_API_KEY || '';
    this.openaiApiKey = config.openaiApiKey || process.env.OPENAI_API_KEY || '';
    this.apiSecretName = config.apiSecretName || 'm2m-agent-api-keys';
  }

  getFeaturePath() {
    return 'm2m-agent';
  }

  validate() {
    if (!this.googleApiKey && !this.openaiApiKey && !this.dryRun) {
      throw new Error(
        'm2m-agent requires GOOGLE_API_KEY or OPENAI_API_KEY (env or config)',
      );
    }
    return true;
  }

  async deploy() {
    this.log('Deploying M2M ADK agent...', 'info');

    await this.deployApiSecret();
    await this.deployServiceAccount();
    await this.deployDeployment();
    await this.deployService();
    await this.deployHTTPRoute();

    if (!this.dryRun) {
      await this.waitForReady();
    }

    this.log('M2M ADK agent deployed', 'success');
  }

  async deployApiSecret() {
    const apiKey = this.dryRun && !this.googleApiKey && !this.openaiApiKey
      ? '<set GOOGLE_API_KEY or OPENAI_API_KEY>'
      : undefined;

    const secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: this.apiSecretName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      type: 'Opaque',
      stringData: {
        'google-api-key': apiKey || this.googleApiKey,
        'openai-api-key': apiKey || this.openaiApiKey,
      },
    };

    await this.applyResource(secret);
    this.log(`Secret '${this.apiSecretName}' created`, 'info');
  }

  async deployServiceAccount() {
    const sa = {
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: {
        name: this.agentName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
          app: this.agentName,
        },
      },
    };

    await this.applyResource(sa);
  }

  async deployDeployment() {
    const deployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: this.agentName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
          app: this.agentName,
        },
      },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: this.agentName } },
        template: {
          metadata: { labels: { app: this.agentName } },
          spec: {
            serviceAccountName: this.agentName,
            containers: [
              {
                name: 'agent',
                image: this.image,
                imagePullPolicy: this.imagePullPolicy,
                ports: [{ containerPort: 8080 }],
                env: [
                  { name: 'MODEL', value: this.model },
                  { name: 'MCP_URL', value: this.mcpUrl },
                  { name: 'STS_TOKEN_URL', value: this.stsTokenUrl },
                  {
                    name: 'GOOGLE_API_KEY',
                    valueFrom: {
                      secretKeyRef: {
                        name: this.apiSecretName,
                        key: 'google-api-key',
                        optional: true,
                      },
                    },
                  },
                  {
                    name: 'OPENAI_API_KEY',
                    valueFrom: {
                      secretKeyRef: {
                        name: this.apiSecretName,
                        key: 'openai-api-key',
                        optional: true,
                      },
                    },
                  },
                ],
                resources: {
                  requests: { memory: '256Mi', cpu: '100m' },
                  limits: { memory: '512Mi', cpu: '500m' },
                },
                readinessProbe: {
                  httpGet: { path: '/health', port: 8080 },
                  initialDelaySeconds: 15,
                  periodSeconds: 10,
                },
                livenessProbe: {
                  httpGet: { path: '/health', port: 8080 },
                  initialDelaySeconds: 30,
                  periodSeconds: 30,
                },
              },
            ],
          },
        },
      },
    };

    await this.applyResource(deployment);
    this.log(`Deployment '${this.agentName}' created`, 'info');
  }

  async deployService() {
    const svc = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: this.agentName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
          app: this.agentName,
        },
      },
      spec: {
        selector: { app: this.agentName },
        ports: [{ port: 8080, targetPort: 8080 }],
        type: 'ClusterIP',
      },
    };

    await this.applyResource(svc);
  }

  async deployHTTPRoute() {
    const gatewayRef = FeatureManager.getGatewayRef();

    const route = {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'HTTPRoute',
      metadata: {
        name: this.routeName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      spec: {
        parentRefs: [
          {
            name: gatewayRef.name,
            namespace: gatewayRef.namespace || this.namespace,
          },
        ],
        rules: [
          {
            matches: [
              {
                path: { type: 'PathPrefix', value: this.pathPrefix },
              },
            ],
            backendRefs: [
              {
                name: this.agentName,
                namespace: this.namespace,
                port: 8080,
              },
            ],
          },
        ],
      },
    };

    await this.applyResource(route);
    this.log(`HTTPRoute '${this.routeName}' at ${this.pathPrefix}`, 'info');
  }

  async waitForReady() {
    this.log(`Waiting for ${this.agentName} to be ready...`, 'info');
    try {
      await KubernetesHelper.kubectl([
        'rollout', 'status', `deployment/${this.agentName}`,
        '-n', this.namespace,
        '--timeout=120s',
      ]);
    } catch {
      this.log(`${this.agentName} rollout timed out (may still be pulling image)`, 'warn');
    }
  }

  async cleanup() {
    this.log('Cleaning up M2M ADK agent...', 'info');

    await this.deleteResource('HTTPRoute', this.routeName);
    await this.deleteResource('Deployment', this.agentName);
    await this.deleteResource('Service', this.agentName);
    await this.deleteResource('ServiceAccount', this.agentName);
    await this.deleteResource('Secret', this.apiSecretName);

    this.log('M2M ADK agent cleaned up', 'success');
  }
}
