import { Feature } from '../../src/lib/feature.js';

const DEFAULT_GATEWAY_NAME = 'agentgateway';
const DEFAULT_AUTH_SERVER_ID = 'default';
const DEFAULT_AUDIENCES = ['api://default'];

export class OktaJwtAuthFeature extends Feature {
  get oktaDomain() {
    return this.config.oktaDomain;
  }

  get authServerId() {
    return this.config.authServerId || DEFAULT_AUTH_SERVER_ID;
  }

  get audiences() {
    return this.config.audiences || DEFAULT_AUDIENCES;
  }

  get gatewayName() {
    return this.config.gatewayName || DEFAULT_GATEWAY_NAME;
  }

  getFeaturePath() {
    return 'okta-jwt-auth';
  }

  async deploy() {
    if (!this.oktaDomain) {
      throw new Error('OktaJwtAuthFeature requires oktaDomain in config');
    }

    this.log('Deploying Okta JWT auth feature...', 'info');
    await this.deployOktaJwksBackend();
    await this.deployJwtPolicy();
    this.log('Okta JWT auth feature deployed', 'success');
  }

  async deployOktaJwksBackend() {
    const backend = {
      apiVersion: 'agentgateway.dev/v1alpha1',
      kind: 'AgentgatewayBackend',
      metadata: {
        name: 'okta-jwks',
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': 'okta-jwt-auth',
        },
      },
      spec: {
        policies: {
          tls: {
            sni: this.oktaDomain,
          },
        },
        static: {
          host: this.oktaDomain,
          port: 443,
        },
      },
    };

    await this.applyResource(backend);
  }

  async deployJwtPolicy() {
    const issuer = `https://${this.oktaDomain}/oauth2/${this.authServerId}`;

    const policy = {
      apiVersion: 'enterpriseagentgateway.solo.io/v1alpha1',
      kind: 'EnterpriseAgentgatewayPolicy',
      metadata: {
        name: 'okta-jwt-auth',
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': 'okta-jwt-auth',
        },
      },
      spec: {
        targetRefs: [
          {
            group: 'gateway.networking.k8s.io',
            kind: 'Gateway',
            name: this.gatewayName,
          },
        ],
        traffic: {
          phase: 'PreRouting',
          jwtAuthentication: {
            mode: 'Strict',
            providers: [
              {
                issuer,
                audiences: this.audiences,
                jwks: {
                  remote: {
                    jwksPath: `oauth2/${this.authServerId}/v1/keys`,
                    cacheDuration: '5m',
                    backendRef: {
                      group: 'agentgateway.dev',
                      kind: 'AgentgatewayBackend',
                      name: 'okta-jwks',
                      namespace: this.namespace,
                    },
                  },
                },
              },
            ],
          },
          transformation: {
            request: {
              set: [
                { name: 'x-gw-org-id', value: "jwt['org_id']" },
                { name: 'x-gw-team-id', value: "jwt['team_id']" },
              ],
            },
          },
        },
      },
    };

    await this.applyResource(policy);
  }

  async cleanup() {
    this.log('Cleaning up Okta JWT auth feature...', 'info');
    await this.deleteByLabel('AgentgatewayBackend', {
      'agentgateway.dev/feature': 'okta-jwt-auth',
    });
    await this.deleteByLabel('EnterpriseAgentgatewayPolicy', {
      'agentgateway.dev/feature': 'okta-jwt-auth',
    });
    this.log('Okta JWT auth feature cleaned up', 'success');
  }
}
