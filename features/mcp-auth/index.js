import { Feature, FeatureManager } from '../../src/lib/feature.js';
import { KubernetesHelper, CommandRunner } from '../../src/lib/common.js';

/**
 * MCP Auth Feature
 *
 * Secures an MCP backend with OAuth 2.0 authentication using agentgateway
 * and Keycloak as the identity provider. MCP clients dynamically register
 * with the IdP to obtain a client ID, then use the OAuth flow to acquire a
 * JWT that grants access to the MCP server's tools.
 *
 * Reference: https://docs.solo.io/agentgateway/2.1.x/mcp/auth/setup/
 *
 * This feature:
 * - Optionally configures Keycloak for dynamic client registration
 *   (removes trusted-hosts and allowed-client-templates policies)
 * - Creates an EnterpriseAgentgatewayPolicy targeting an AgentgatewayBackend
 *   with backend.mcp.authentication (issuer, JWKS, audiences, mode, provider,
 *   resourceMetadata)
 * - Creates/updates the HTTPRoute to include OAuth discovery paths and CORS.
 *   CORS requires Gateway API experimental CRDs and
 *   controller.extraEnv.KGW_ENABLE_GATEWAY_API_EXPERIMENTAL_FEATURES=true.
 *
 * Configuration:
 * {
 *   policyName: string,                   // Default: 'mcp-auth'
 *   backendName: string,                  // AgentgatewayBackend to protect (default: 'mcp-backend')
 *   routeName: string,                    // HTTPRoute name (default: 'mcp')
 *   mcpPath: string,                      // MCP endpoint path (default: '/mcp')
 *   keycloak: {
 *     realm: string,                      // Default: 'agw-dev'
 *     serviceName: string,                // Default: 'keycloak'
 *     serviceNamespace: string,           // Default: 'keycloak'
 *     servicePort: number,                // Default: 443
 *     jwksPath: string,                   // Default: 'realms/<realm>/protocol/openid-connect/certs'
 *     configureDynamicRegistration: bool, // Remove registration policies (default: true)
 *   },
 *   issuer: string,                       // Override OIDC issuer URL
 *   audiences: Array<string>,             // JWT audience restriction (default: [resource])
 *   mode: string,                         // JWT validation mode (default: 'Strict')
 *   provider: string,                     // IdP type (default: 'Keycloak')
 *   resource: string,                     // OAuth resource identifier (default: 'http://localhost:8080/mcp')
 *   scopesSupported: Array<string>,       // OAuth scopes (default: ['email'])
 *   bearerMethodsSupported: Array<string>,// Bearer token delivery methods (default: ['header','body','query'])
 *   cors: {
 *     enabled: boolean,                   // Enable CORS on the route (default: true)
 *     allowOrigins: Array<string>,        // Default: ['*']
 *     allowMethods: Array<string>,        // Default: ['*']
 *     allowHeaders: Array<string>,        // Default: ['Origin','Authorization','Content-Type']
 *     exposeHeaders: Array<string>,       // Default: ['Origin','X-HTTPRoute-Header']
 *     maxAge: number,                     // Default: 86400
 *   },
 * }
 */
export class McpAuthFeature extends Feature {
  constructor(name, config) {
    super(name, config);

    this.policyName = config.policyName || 'mcp-auth';
    this.backendName = config.backendName || 'mcp-backend';
    this.routeName = config.routeName || 'mcp';
    this.mcpPath = config.mcpPath || '/mcp';

    const kc = config.keycloak || {};
    this.realm = kc.realm || 'agw-dev';
    this.keycloakServiceName = kc.serviceName || 'keycloak';
    this.keycloakServiceNamespace = kc.serviceNamespace || 'keycloak';
    this.keycloakServicePort = kc.servicePort || 443;
    this.jwksPath = kc.jwksPath || `realms/${this.realm}/protocol/openid-connect/certs`;
    this.configureDynamicRegistration = kc.configureDynamicRegistration !== false;

    const keycloakHost = `${this.keycloakServiceName}.${this.keycloakServiceNamespace}.svc.cluster.local`;
    const protocol = this.keycloakServicePort === 443 || this.keycloakServicePort === 8443 ? 'https' : 'http';
    this.issuer = config.issuer || `${protocol}://${keycloakHost}/realms/${this.realm}`;

    this.resource = config.resource || 'http://localhost:8080/mcp';
    this.audiences = config.audiences || [this.resource];
    this.mode = config.mode || 'Strict';
    this.provider = config.provider || 'Keycloak';
    this.scopesSupported = config.scopesSupported || ['email'];
    this.bearerMethodsSupported = config.bearerMethodsSupported || ['header', 'body', 'query'];

    const cors = config.cors || {};
    this.corsEnabled = cors.enabled !== false;
    this.corsAllowOrigins = cors.allowOrigins || ['*'];
    this.corsAllowMethods = cors.allowMethods || ['*'];
    this.corsAllowHeaders = cors.allowHeaders || ['Origin', 'Authorization', 'Content-Type'];
    this.corsExposeHeaders = cors.exposeHeaders || ['Origin', 'X-HTTPRoute-Header'];
    this.corsMaxAge = cors.maxAge || 86400;
  }

  getFeaturePath() {
    return 'mcp-auth';
  }

  validate() {
    if (!this.backendName) {
      throw new Error('MCP auth requires a backendName (AgentgatewayBackend to protect)');
    }
    return true;
  }

  async deploy() {
    this.log('Configuring MCP auth...', 'info');

    if (this.keycloakServicePort === 443 || this.keycloakServicePort === 8443) {
      await this.deployBackendTlsPolicy();
    }

    if (this.configureDynamicRegistration && !this.dryRun) {
      await this.configureKeycloakDynamicRegistration();
    }

    await this.deployMcpAuthPolicy();
    await this.deployDiscoveryRoute();

    this.log('MCP auth policy applied', 'success');
  }

  async deployBackendTlsPolicy() {
    const tlsPolicyName = `${this.keycloakServiceName}-backend-tls`;
    this.log(`Applying backend TLS policy '${tlsPolicyName}'...`, 'info');

    const tlsPolicy = {
      apiVersion: 'enterpriseagentgateway.solo.io/v1alpha1',
      kind: 'EnterpriseAgentgatewayPolicy',
      metadata: {
        name: tlsPolicyName,
        namespace: this.keycloakServiceNamespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      spec: {
        targetRefs: [
          {
            group: '',
            kind: 'Service',
            name: this.keycloakServiceName,
          },
        ],
        backend: {
          tls: {
            insecureSkipVerify: 'All',
          },
        },
      },
    };

    await this.applyResource(tlsPolicy);
  }

  async configureKeycloakDynamicRegistration() {
    this.log('Configuring Keycloak for dynamic client registration...', 'info');

    const protocol = this.keycloakServicePort === 443 || this.keycloakServicePort === 8443 ? 'https' : 'http';
    const baseUrl = `${protocol}://${this.keycloakServiceName}.${this.keycloakServiceNamespace}.svc.cluster.local`;

    let token;
    try {
      const result = await CommandRunner.run('kubectl', [
        '-n', this.keycloakServiceNamespace,
        'exec', 'deploy/keycloak', '--',
        'bash', '-c',
        `curl -sSfk -X POST ${baseUrl}/realms/master/protocol/openid-connect/token ` +
        `-H 'Content-Type: application/x-www-form-urlencoded' ` +
        `-d 'username=admin&password=admin&grant_type=password&client_id=admin-cli'`,
      ], { ignoreError: true });

      if (result.stdout) {
        const parsed = JSON.parse(result.stdout);
        token = parsed.access_token;
      }
    } catch {
      this.log('Could not obtain Keycloak admin token for dynamic registration setup', 'warn');
      return;
    }

    if (!token) {
      this.log('Could not obtain Keycloak admin token, skipping dynamic registration config', 'warn');
      return;
    }

    await this.removeRegistrationPolicy(baseUrl, token, 'trusted-hosts');
    await this.removeRegistrationPolicy(baseUrl, token, 'allowed-client-templates', 'anonymous');

    this.log('Keycloak dynamic client registration configured', 'info');
  }

  async removeRegistrationPolicy(baseUrl, token, providerId, subType) {
    try {
      const listResult = await CommandRunner.run('kubectl', [
        '-n', this.keycloakServiceNamespace,
        'exec', 'deploy/keycloak', '--',
        'bash', '-c',
        `curl -sSfk -H 'Authorization: Bearer ${token}' ` +
        `'${baseUrl}/admin/realms/${this.realm}/components?type=org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy'`,
      ], { ignoreError: true });

      if (!listResult.stdout) return;

      const policies = JSON.parse(listResult.stdout);
      const match = policies.find(p => {
        if (p.providerId !== providerId) return false;
        if (subType && p.subType !== subType) return false;
        return true;
      });

      if (!match) return;

      await CommandRunner.run('kubectl', [
        '-n', this.keycloakServiceNamespace,
        'exec', 'deploy/keycloak', '--',
        'bash', '-c',
        `curl -sSfk -X DELETE -H 'Authorization: Bearer ${token}' ` +
        `'${baseUrl}/admin/realms/${this.realm}/components/${match.id}'`,
      ], { ignoreError: true });

      this.log(`Removed Keycloak registration policy '${providerId}'`, 'info');
    } catch {
      this.log(`Could not remove Keycloak registration policy '${providerId}'`, 'warn');
    }
  }

  async deployMcpAuthPolicy() {
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
          mcp: {
            authentication: {
              issuer: this.issuer,
              jwks: {
                backendRef: {
                  name: this.keycloakServiceName,
                  kind: 'Service',
                  namespace: this.keycloakServiceNamespace,
                  port: this.keycloakServicePort,
                },
                jwksPath: `/${this.jwksPath}`,
              },
              audiences: this.audiences,
              mode: this.mode,
              provider: this.provider,
              resourceMetadata: {
                resourceMetadata: {
                  resource: this.resource,
                  scopesSupported: this.scopesSupported,
                  bearerMethodsSupported: this.bearerMethodsSupported,
                },
              },
            },
          },
        },
      },
    };

    await this.applyResource(policy);
    this.log(`EnterpriseAgentgatewayPolicy '${this.policyName}' targeting backend '${this.backendName}'`, 'info');
  }

  async deployDiscoveryRoute() {
    const gatewayRef = FeatureManager.getGatewayRef();

    const rule = {
      backendRefs: [
        {
          name: this.backendName,
          group: 'agentgateway.dev',
          kind: 'AgentgatewayBackend',
        },
      ],
      matches: [
        { path: { type: 'PathPrefix', value: this.mcpPath } },
        { path: { type: 'PathPrefix', value: `/.well-known/oauth-protected-resource${this.mcpPath}` } },
        { path: { type: 'PathPrefix', value: `/.well-known/oauth-authorization-server${this.mcpPath}` } },
        { path: { type: 'PathPrefix', value: `/${this.jwksPath}` } },
      ],
    };

    if (this.corsEnabled) {
      rule.filters = [
        {
          type: 'CORS',
          cors: {
            allowCredentials: true,
            allowHeaders: this.corsAllowHeaders,
            allowMethods: this.corsAllowMethods,
            allowOrigins: this.corsAllowOrigins,
            exposeHeaders: this.corsExposeHeaders,
            maxAge: this.corsMaxAge,
          },
        },
      ];
    }

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
        rules: [rule],
      },
    };

    await this.applyResource(route);
    this.log(`HTTPRoute '${this.routeName}' updated with MCP auth discovery paths`, 'info');
  }

  async cleanup() {
    this.log('Cleaning up MCP auth...', 'info');

    await this.deleteResource('EnterpriseAgentgatewayPolicy', this.policyName);
    await this.deleteResource(
      'EnterpriseAgentgatewayPolicy',
      `${this.keycloakServiceName}-backend-tls`,
      this.keycloakServiceNamespace,
    );

    this.log('MCP auth cleaned up', 'success');
  }
}
