import { Feature, FeatureManager } from '../../src/lib/feature.js';

/**
 * Elicitation Backend Feature
 *
 * Creates an AgentgatewayBackend and EnterpriseAgentgatewayPolicy configured
 * for token exchange with elicitation support. This enables the out-of-band
 * OAuth consent flow where agents can request user authorization for external
 * APIs (e.g., GitHub, Google) on behalf of users.
 *
 * Reference: https://docs.solo.io/agentgateway/2.1.x/security/obo-elicitations/elicitations/
 *
 * Flow:
 * 1. Agent makes request to backend requiring external API access
 * 2. STS checks for upstream token; if missing, returns elicitation URL (PENDING)
 * 3. User opens URL in Solo UI, completes OAuth with external provider
 * 4. STS stores token (COMPLETED)
 * 5. Agent retries; token is injected into upstream request
 *
 * This feature:
 * - Creates an AgentgatewayBackend for the external API
 * - Creates an EnterpriseAgentgatewayPolicy with tokenExchange.elicitation
 *   referencing the elicitation secret
 * - Creates an HTTPRoute for the backend
 *
 * Configuration:
 * {
 *   backendName: string,             // AgentgatewayBackend name (default: 'elicitation-backend')
 *   policyName: string,              // EnterpriseAgentgatewayPolicy name (default: 'elicitation-policy')
 *   routeName: string,               // HTTPRoute name (default: 'elicitation-route')
 *   pathPrefix: string,              // Route path prefix (default: '/api')
 *   secretName: string,              // Elicitation secret name (required)
 *   upstream: {
 *     host: string,                  // Upstream API host (e.g., 'api.github.com')
 *     port: number,                  // Upstream port (default: 443)
 *     tls: boolean,                  // Enable TLS (default: true)
 *     insecureSkipVerify: boolean,   // Skip TLS verification (default: false)
 *   },
 *   tokenHeader: string,             // Header to inject token (default: 'Authorization')
 *   tokenPrefix: string,             // Token prefix (default: 'Bearer ')
 * }
 */
export class ElicitationBackendFeature extends Feature {
  constructor(name, config) {
    super(name, config);

    this.backendName = config.backendName || 'elicitation-backend';
    this.policyName = config.policyName || 'elicitation-policy';
    this.routeName = config.routeName || 'elicitation-route';
    this.pathPrefix = config.pathPrefix || '/api';
    this.secretName = config.secretName || 'elicitation-oauth';

    const upstream = config.upstream || {};
    this.upstreamHost = upstream.host || 'api.github.com';
    this.upstreamPort = upstream.port || 443;
    this.upstreamTls = upstream.tls !== false;
    this.upstreamInsecureSkipVerify = upstream.insecureSkipVerify || false;

    this.tokenHeader = config.tokenHeader || 'Authorization';
    this.tokenPrefix = config.tokenPrefix !== undefined ? config.tokenPrefix : 'Bearer ';
  }

  getFeaturePath() {
    return 'elicitation-backend';
  }

  validate() {
    if (!this.secretName) {
      throw new Error('Elicitation backend requires secretName');
    }
    if (!this.upstreamHost) {
      throw new Error('Elicitation backend requires upstream.host');
    }
    return true;
  }

  async deploy() {
    this.log(`Configuring elicitation backend '${this.backendName}'...`, 'info');

    await this.deployBackend();
    await this.deployPolicy();
    await this.deployHTTPRoute();

    this.log('Elicitation backend configured', 'success');
  }

  async deployBackend() {
    const backend = {
      apiVersion: 'agentgateway.dev/v1alpha1',
      kind: 'AgentgatewayBackend',
      metadata: {
        name: this.backendName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      spec: {
        http: {
          host: this.upstreamHost,
          port: this.upstreamPort,
        },
      },
    };

    await this.applyResource(backend);
    this.log(`AgentgatewayBackend '${this.backendName}' created`, 'info');
  }

  async deployPolicy() {
    const policy = {
      apiVersion: 'enterpriseagentgateway.solo.io/v1alpha1',
      kind: 'EnterpriseAgentgatewayPolicy',
      metadata: {
        name: this.policyName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      spec: {
        targetRefs: [
          {
            group: 'agentgateway.dev',
            kind: 'AgentgatewayBackend',
            name: this.backendName,
          },
        ],
        backend: {
          tokenExchange: {
            elicitation: {
              secretName: this.secretName,
              tokenHeader: this.tokenHeader,
              tokenPrefix: this.tokenPrefix,
            },
          },
        },
      },
    };

    if (this.upstreamTls) {
      policy.spec.backend.tls = {
        insecureSkipVerify: this.upstreamInsecureSkipVerify ? 'All' : 'None',
      };
    }

    await this.applyResource(policy);
    this.log(`EnterpriseAgentgatewayPolicy '${this.policyName}' created with elicitation`, 'info');
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
            namespace: gatewayRef.namespace,
          },
        ],
        rules: [
          {
            matches: [
              {
                path: {
                  type: 'PathPrefix',
                  value: this.pathPrefix,
                },
              },
            ],
            backendRefs: [
              {
                name: this.backendName,
                group: 'agentgateway.dev',
                kind: 'AgentgatewayBackend',
              },
            ],
          },
        ],
      },
    };

    await this.applyResource(route);
    this.log(`HTTPRoute '${this.routeName}' created at ${this.pathPrefix}`, 'info');
  }

  async cleanup() {
    this.log('Cleaning up elicitation backend...', 'info');

    await this.deleteResource('HTTPRoute', this.routeName);
    await this.deleteResource('EnterpriseAgentgatewayPolicy', this.policyName);
    await this.deleteResource('AgentgatewayBackend', this.backendName);

    this.log('Elicitation backend cleaned up', 'success');
  }
}
