import { Feature } from '../../src/lib/feature.js';

const DEFAULT_GATEWAY_NAME = 'agentgateway';
const DEFAULT_KEYCLOAK_REALM = 'agw-dev';
const DEFAULT_AUDIENCES = ['account'];

/**
 * Keycloak JWT Auth Feature
 *
 * Validates Keycloak JWTs at the gateway in strict mode.
 * Extracts org_id and team_id JWT claims into x-gw-org-id and x-gw-team-id headers.
 *
 * Configuration:
 * {
 *   keycloakHost: string,   // Keycloak domain, e.g. keycloak.demo.example.com (required)
 *   keycloakRealm: string,  // Keycloak realm (default: 'agw-dev')
 *   audiences: string[],    // Expected audiences (default: ['account'])
 *   gatewayName: string,    // Gateway resource name (default: 'agentgateway')
 * }
 */
export class KeycloakJwtAuthFeature extends Feature {
  get keycloakHost() {
    return this.config.keycloakHost;
  }

  get keycloakRealm() {
    return this.config.keycloakRealm || DEFAULT_KEYCLOAK_REALM;
  }

  get audiences() {
    return this.config.audiences || DEFAULT_AUDIENCES;
  }

  get gatewayName() {
    return this.config.gatewayName || DEFAULT_GATEWAY_NAME;
  }

  getFeaturePath() {
    return 'keycloak-jwt-auth';
  }

  async deploy() {
    if (!this.keycloakHost) {
      throw new Error('KeycloakJwtAuthFeature requires keycloakHost in config');
    }

    this.log('Deploying Keycloak JWT auth feature...', 'info');
    await this.deployKeycloakJwksBackend();
    await this.deployJwtPolicy();
    this.log('Keycloak JWT auth feature deployed', 'success');
  }

  async deployKeycloakJwksBackend() {
    const backend = {
      apiVersion: 'agentgateway.dev/v1alpha1',
      kind: 'AgentgatewayBackend',
      metadata: {
        name: 'keycloak-jwks',
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': 'keycloak-jwt-auth',
        },
      },
      spec: {
        policies: {
          tls: {
            sni: this.keycloakHost,
          },
        },
        static: {
          host: this.keycloakHost,
          port: 443,
        },
      },
    };

    await this.applyResource(backend);
  }

  async deployJwtPolicy() {
    const issuer = `https://${this.keycloakHost}/realms/${this.keycloakRealm}`;

    const policy = {
      apiVersion: 'enterpriseagentgateway.solo.io/v1alpha1',
      kind: 'EnterpriseAgentgatewayPolicy',
      metadata: {
        name: 'keycloak-jwt-auth',
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': 'keycloak-jwt-auth',
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
                    jwksPath: `realms/${this.keycloakRealm}/protocol/openid-connect/certs`,
                    cacheDuration: '5m',
                    backendRef: {
                      group: 'agentgateway.dev',
                      kind: 'AgentgatewayBackend',
                      name: 'keycloak-jwks',
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
    this.log('Cleaning up Keycloak JWT auth feature...', 'info');
    await this.deleteByLabel('AgentgatewayBackend', {
      'agentgateway.dev/feature': 'keycloak-jwt-auth',
    });
    await this.deleteByLabel('EnterpriseAgentgatewayPolicy', {
      'agentgateway.dev/feature': 'keycloak-jwt-auth',
    });
    this.log('Keycloak JWT auth feature cleaned up', 'success');
  }
}
