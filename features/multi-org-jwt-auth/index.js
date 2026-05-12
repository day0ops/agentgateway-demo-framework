import { Feature } from '../../src/lib/feature.js';

const DEFAULT_KEYCLOAK_HOST = 'keycloak.keycloak.svc.cluster.local';
const DEFAULT_GATEWAY_NAME = 'agentgateway';

export class MultiOrgJwtAuthFeature extends Feature {
  get keycloakHost() {
    return this.config.keycloakHost || DEFAULT_KEYCLOAK_HOST;
  }

  get gatewayName() {
    return this.config.gatewayName || DEFAULT_GATEWAY_NAME;
  }

  get orgRealms() {
    return this.config.orgRealms || [];
  }

  getFeaturePath() {
    return 'multi-org-jwt-auth';
  }

  async deploy() {
    this.log('Deploying multi-org JWT auth feature...', 'info');

    await this.deployKeycloakJwksBackend();
    await this.deployJwtPolicy();
    await this.deployEchoBackend();
    await this.applyYamlFile('echo-httproute.yaml');

    this.log('Multi-org JWT auth feature deployed', 'success');
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
          'agentgateway.dev/feature': 'multi-org-jwt-auth',
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
    if (!this.orgRealms.length) {
      throw new Error('MultiOrgJwtAuthFeature requires at least one orgRealm in config.orgRealms');
    }

    const providers = this.orgRealms.map(({ realm }) => ({
      issuer: `https://${this.keycloakHost}/realms/${realm}`,
      audiences: ['account'],
      jwks: {
        remote: {
          jwksPath: `realms/${realm}/protocol/openid-connect/certs`,
          cacheDuration: '5m',
          backendRef: {
            group: 'agentgateway.dev',
            kind: 'AgentgatewayBackend',
            name: 'keycloak-jwks',
            namespace: this.namespace,
          },
        },
      },
    }));

    const policy = {
      apiVersion: 'enterpriseagentgateway.solo.io/v1alpha1',
      kind: 'EnterpriseAgentgatewayPolicy',
      metadata: {
        name: 'multi-org-jwt-auth',
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': 'multi-org-jwt-auth',
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
            providers,
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

  async deployEchoBackend() {
    const deployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: 'echo-backend',
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': 'multi-org-jwt-auth',
          app: 'echo-backend',
        },
      },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: 'echo-backend' } },
        template: {
          metadata: {
            labels: { app: 'echo-backend', 'agentgateway.dev/feature': 'multi-org-jwt-auth' },
          },
          spec: {
            containers: [
              {
                name: 'httpbin',
                image: 'kennethreitz/httpbin',
                ports: [{ containerPort: 80 }],
                resources: {
                  requests: { cpu: '50m', memory: '64Mi' },
                  limits: { cpu: '200m', memory: '128Mi' },
                },
              },
            ],
          },
        },
      },
    };

    const service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: 'echo-backend',
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': 'multi-org-jwt-auth',
        },
      },
      spec: {
        selector: { app: 'echo-backend' },
        ports: [{ port: 80, targetPort: 80 }],
      },
    };

    await this.applyResource(deployment);
    await this.applyResource(service);
  }

  async cleanup() {
    this.log('Cleaning up multi-org JWT auth feature...', 'info');
    await this.deleteByLabel('AgentgatewayBackend', {
      'agentgateway.dev/feature': 'multi-org-jwt-auth',
    });
    await this.deleteByLabel('EnterpriseAgentgatewayPolicy', {
      'agentgateway.dev/feature': 'multi-org-jwt-auth',
    });
    await this.deleteByLabel('HTTPRoute', {
      'agentgateway.dev/feature': 'multi-org-jwt-auth',
    });
    await this.deleteByLabel('Service', {
      'agentgateway.dev/feature': 'multi-org-jwt-auth',
    });
    await this.deleteByLabel('Deployment', {
      'agentgateway.dev/feature': 'multi-org-jwt-auth',
    });
    this.log('Multi-org JWT auth feature cleaned up', 'success');
  }
}
