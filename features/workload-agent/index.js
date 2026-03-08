import { Feature, FeatureManager } from '../../src/lib/feature.js';
import { KubernetesHelper } from '../../src/lib/common.js';

/**
 * Workload Agent Feature
 *
 * Deploys any autonomous workload agent as a Kubernetes Deployment with
 * ServiceAccount, Service, and HTTPRoute. Handles Keycloak client secret
 * injection and optional SA token projection for Phase 2 token exchange.
 *
 * Used for both the caller-agent (calls stock-agent via AGW) and the
 * stock-agent in the workload-identity-chain use case (calls MCP as its
 * own identity with MCP_AUTH_MODE=workload).
 *
 * Configuration:
 * {
 *   agentName: string,           // Default: 'caller-agent'
 *   image: string,               // Default: 'caller-agent:latest'
 *   imagePullPolicy: string,     // Default: 'IfNotPresent'
 *   pathPrefix: string,          // Default: '/caller-agent'
 *   routeName: string,           // Default: agentName
 *   port: number,                // Default: 8080
 *   keycloakUrl: string,         // Default: http://keycloak.keycloak.svc.cluster.local:8080
 *   keycloakRealm: string,       // Default: 'agw-dev'
 *   clientId: string,            // Default: 'caller-agent'
 *   clientSecretName: string,    // K8s Secret name with 'client_secret' key (default: 'caller-agent-credentials')
 *   audience: string,            // Default: 'agentgateway'
 *   stockAgentUrl: string,       // STOCK_AGENT_URL env var (default: http://agentgateway.<ns>.svc.cluster.local:8080/agent/run)
 *   llmBaseUrl: string,          // LLM_BASE_URL env var — for agents that need an LLM endpoint (optional)
 *   mcpUrl: string,              // MCP_URL env var — for agents that call MCP directly (optional)
 *   model: string,               // MODEL env var (optional)
 *   mcpAuthMode: string,         // MCP_AUTH_MODE env var: 'propagate' or 'workload' (optional)
 *   additionalEnv: [{name, value}], // Extra env vars merged into the deployment (optional)
 *   useTokenExchange: bool,      // Phase 2: mount SA token + set USE_TOKEN_EXCHANGE=true (default: false)
 *   saTokenAudience: string,     // Audience for the projected SA token (default: 'agentgateway')
 *   saTokenPath: string,         // Mount path inside container (default: /var/run/secrets/tokens/sa-token)
 * }
 */
export class WorkloadAgentFeature extends Feature {
  constructor(name, config) {
    super(name, config);

    const ns = this.namespace;
    this.agentName = config.agentName || 'caller-agent';
    this.image = Feature.resolveImage(config.image || 'caller-agent:latest');
    this.imagePullPolicy = config.imagePullPolicy || 'IfNotPresent';
    this.pathPrefix = config.pathPrefix || '/caller-agent';
    this.routeName = config.routeName || this.agentName;
    this.port = config.port ?? 8080;

    this.keycloakUrl = config.keycloakUrl || 'http://keycloak.keycloak.svc.cluster.local:8080';
    this.keycloakRealm = config.keycloakRealm || 'agw-dev';
    this.clientId = config.clientId || 'caller-agent';
    this.clientSecretName = config.clientSecretName || 'caller-agent-credentials';
    this.audience = config.audience || 'agentgateway';
    this.stockAgentUrl =
      config.stockAgentUrl || `http://agentgateway.${ns}.svc.cluster.local:8080/agent/run`;

    this.llmBaseUrl = config.llmBaseUrl || null;
    this.mcpUrl = config.mcpUrl || null;
    this.model = config.model || null;
    this.mcpAuthMode = config.mcpAuthMode || null;
    this.additionalEnv = Array.isArray(config.additionalEnv) ? config.additionalEnv : [];

    this.useTokenExchange = config.useTokenExchange || false;
    this.saTokenAudience = config.saTokenAudience || 'agentgateway';
    this.saTokenPath = config.saTokenPath || '/var/run/secrets/tokens/sa-token';
  }

  getFeaturePath() {
    return 'workload-agent';
  }

  validate() {
    return true;
  }

  async deploy() {
    this.log(`Deploying workload agent '${this.agentName}'...`, 'info');

    await this.deployServiceAccount();
    await this.deployDeployment();
    await this.deployService();
    await this.deployHTTPRoute();

    if (!this.dryRun) {
      await this.waitForReady();
    }

    this.log(`Workload agent '${this.agentName}' deployed`, 'success');
  }

  async deployServiceAccount() {
    await this.applyResource({
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: {
        name: this.agentName,
        namespace: this.namespace,
        labels: this.commonLabels(),
      },
    });
  }

  async deployDeployment() {
    const env = [
      { name: 'KEYCLOAK_URL', value: this.keycloakUrl },
      { name: 'KEYCLOAK_REALM', value: this.keycloakRealm },
      { name: 'CLIENT_ID', value: this.clientId },
      {
        name: 'CLIENT_SECRET',
        valueFrom: {
          secretKeyRef: {
            name: this.clientSecretName,
            key: 'client_secret',
            optional: true,
          },
        },
      },
      { name: 'AUDIENCE', value: this.audience },
      { name: 'STOCK_AGENT_URL', value: this.stockAgentUrl },
      { name: 'USE_TOKEN_EXCHANGE', value: String(this.useTokenExchange) },
      ...(this.llmBaseUrl ? [{ name: 'LLM_BASE_URL', value: this.llmBaseUrl }] : []),
      ...(this.mcpUrl ? [{ name: 'MCP_URL', value: this.mcpUrl }] : []),
      ...(this.model ? [{ name: 'MODEL', value: this.model }] : []),
      ...(this.mcpAuthMode ? [{ name: 'MCP_AUTH_MODE', value: this.mcpAuthMode }] : []),
      ...this.additionalEnv,
    ];

    const volumeMounts = [];
    const volumes = [];

    if (this.useTokenExchange) {
      env.push({ name: 'SA_TOKEN_PATH', value: this.saTokenPath });
      volumeMounts.push({
        name: 'sa-token',
        mountPath: this.saTokenPath.replace(/\/[^/]+$/, ''),
        readOnly: true,
      });
      volumes.push({
        name: 'sa-token',
        projected: {
          sources: [
            {
              serviceAccountToken: {
                path: 'sa-token',
                expirationSeconds: 3600,
                audience: this.saTokenAudience,
              },
            },
          ],
        },
      });
    }

    await this.applyResource({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: this.agentName,
        namespace: this.namespace,
        labels: this.commonLabels(),
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
                ports: [{ containerPort: this.port }],
                env,
                resources: {
                  requests: { memory: '128Mi', cpu: '50m' },
                  limits: { memory: '256Mi', cpu: '200m' },
                },
                readinessProbe: {
                  httpGet: { path: '/health', port: this.port },
                  initialDelaySeconds: 10,
                  periodSeconds: 10,
                },
                livenessProbe: {
                  httpGet: { path: '/health', port: this.port },
                  initialDelaySeconds: 20,
                  periodSeconds: 30,
                },
                ...(volumeMounts.length ? { volumeMounts } : {}),
              },
            ],
            ...(volumes.length ? { volumes } : {}),
          },
        },
      },
    });
    this.log(`Deployment '${this.agentName}' created`, 'info');
  }

  async deployService() {
    await this.applyResource({
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: this.agentName,
        namespace: this.namespace,
        labels: this.commonLabels(),
      },
      spec: {
        selector: { app: this.agentName },
        ports: [{ port: this.port, targetPort: this.port }],
        type: 'ClusterIP',
      },
    });
  }

  async deployHTTPRoute() {
    const gatewayRef = FeatureManager.getGatewayRef();
    await this.applyResource({
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'HTTPRoute',
      metadata: {
        name: this.routeName,
        namespace: this.namespace,
        labels: this.commonLabels(),
      },
      spec: {
        parentRefs: [{ name: gatewayRef.name, namespace: gatewayRef.namespace || this.namespace }],
        rules: [
          {
            matches: [{ path: { type: 'PathPrefix', value: this.pathPrefix } }],
            filters: [
              {
                type: 'URLRewrite',
                urlRewrite: {
                  path: { type: 'ReplacePrefixMatch', replacePrefixMatch: '/' },
                },
              },
            ],
            backendRefs: [{ name: this.agentName, namespace: this.namespace, port: this.port }],
          },
        ],
      },
    });
    this.log(`HTTPRoute '${this.routeName}' at ${this.pathPrefix}`, 'info');
  }

  async waitForReady() {
    this.log(`Waiting for '${this.agentName}' to be ready...`, 'info');
    try {
      await KubernetesHelper.kubectl([
        'rollout',
        'status',
        `deployment/${this.agentName}`,
        '-n',
        this.namespace,
        '--timeout=120s',
      ]);
    } catch {
      this.log(`${this.agentName} rollout timed out (may still be pulling image)`, 'warn');
    }
  }

  commonLabels() {
    return {
      'app.kubernetes.io/managed-by': 'agentgateway-demo',
      'agentgateway.dev/feature': this.name,
      app: this.agentName,
    };
  }

  async cleanup() {
    this.log(`Cleaning up workload agent '${this.agentName}'...`, 'info');

    await this.deleteResource('HTTPRoute', this.routeName);
    await this.deleteResource('Deployment', this.agentName);
    await this.deleteResource('Service', this.agentName);
    await this.deleteResource('ServiceAccount', this.agentName);

    this.log(`Workload agent '${this.agentName}' cleaned up`, 'success');
  }
}
