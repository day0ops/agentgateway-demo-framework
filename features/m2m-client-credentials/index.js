import { Feature, FeatureManager } from '../../src/lib/feature.js';

/**
 * OAuth Client Credentials Feature
 *
 * Secures routes for machine-to-machine (M2M) authentication using the
 * OAuth2 client credentials grant. Calling services obtain an access token
 * from the IdP (e.g. Keycloak) using only their client credentials — no user
 * interaction required. The gateway validates the presented Bearer token via
 * JWT (JWKS) or token introspection.
 *
 * Reference: https://docs.solo.io/agentgateway/2.1.x/security/extauth/oauth/access-token/
 *
 * This feature:
 * - Creates an AuthConfig with oauth2.accessTokenValidation using either
 *   JWT (remote/inline JWKS) or RFC 7662 token introspection
 * - Optionally creates a Kubernetes Secret holding the gateway's own
 *   client credentials used to authenticate introspection requests
 * - Creates an EnterpriseAgentgatewayPolicy with entExtAuth referencing
 *   the AuthConfig and the ext-auth-service backend
 *
 * Configuration:
 * {
 *   authConfigName: string,           // Default: 'oauth-client-credentials'
 *   policyName: string,               // Default: 'oauth-client-credentials'
 *   validationMode: string,           // 'jwt' (default) or 'introspection'
 *   keycloak: {
 *     realm: string,                  // Default: 'agw-dev'
 *     serviceName: string,            // Default: 'keycloak'
 *     serviceNamespace: string,       // Default: 'keycloak'
 *     servicePort: number,            // Default: 443
 *     jwksPath: string,               // Default: 'realms/<realm>/protocol/openid-connect/certs'
 *   },
 *   // JWT mode options (validationMode: 'jwt')
 *   jwksMode: string,                 // 'remote' (default) or 'inline'
 *   inlineJwks: string,               // Pre-fetched JWKS JSON (jwksMode='inline' only)
 *   cacheDuration: string,            // JWKS cache duration for remote mode (default: '5m')
 *   issuer: string,                   // Override OIDC issuer URL
 *   // Introspection mode options (validationMode: 'introspection')
 *   introspection: {
 *     secretName: string,             // Secret name for client credentials (default: 'oauth-introspection-client')
 *     clientId: string,               // Client ID for authenticated introspection requests
 *     clientSecret: string,           // Client secret for authenticated introspection requests
 *     userIdAttributeName: string,    // Claim mapped to the user ID header (default: 'sub')
 *   },
 *   requiredScopes: Array<string>,    // Scopes the token must contain (optional)
 *   extAuthBackend: {
 *     name: string,                   // Default: 'ext-auth-service-enterprise-agentgateway'
 *     port: number,                   // Default: 8083
 *   },
 *   targetRefs: Array<{
 *     group: string,
 *     kind: string,
 *     name: string,
 *   }>,
 * }
 */
export class M2MClientCredentialsFeature extends Feature {
  constructor(name, config) {
    super(name, config);

    this.authConfigName = config.authConfigName || 'm2m-client-credentials';
    this.policyName = config.policyName || 'm2m-client-credentials';
    this.validationMode = config.validationMode || 'jwt';

    const kc = config.keycloak || {};
    this.realm = kc.realm || 'agw-dev';
    this.keycloakServiceName = kc.serviceName || 'keycloak';
    this.keycloakServiceNamespace = kc.serviceNamespace || 'keycloak';
    this.keycloakServicePort = kc.servicePort || 443;
    this.jwksPath = kc.jwksPath || `realms/${this.realm}/protocol/openid-connect/certs`;

    const keycloakHost = `${this.keycloakServiceName}.${this.keycloakServiceNamespace}.svc.cluster.local`;
    this.issuer = config.issuer || `https://${keycloakHost}/realms/${this.realm}`;

    this.jwksMode = config.jwksMode || 'remote';
    this.inlineJwks = config.inlineJwks || process.env.KEYCLOAK_CERT_KEYS || null;
    this.cacheDuration = config.cacheDuration || '5m';

    const intr = config.introspection || {};
    this.introspectionSecretName = intr.secretName || 'oauth-introspection-client';
    this.introspectionClientId = intr.clientId || process.env.KEYCLOAK_CLIENT_ID || '';
    this.introspectionClientSecret = intr.clientSecret || process.env.KEYCLOAK_SECRET || '';
    this.introspectionUserIdAttributeName = intr.userIdAttributeName || 'sub';

    this.requiredScopes = config.requiredScopes || null;

    const extAuth = config.extAuthBackend || {};
    this.extAuthServiceName = extAuth.name || 'ext-auth-service-enterprise-agentgateway';
    this.extAuthServicePort = extAuth.port || 8083;

    this.targetRefs = config.targetRefs || null;
  }

  getFeaturePath() {
    return 'm2m-client-credentials';
  }

  validate() {
    if (this.validationMode === 'jwt' && this.jwksMode === 'inline' && !this.inlineJwks) {
      throw new Error(
        'JWT validation with inline JWKS requires inlineJwks config or KEYCLOAK_CERT_KEYS env var.',
      );
    }
    if (this.validationMode === 'introspection') {
      if (!this.introspectionClientId) {
        throw new Error(
          'Introspection validation requires introspection.clientId or KEYCLOAK_CLIENT_ID env var.',
        );
      }
      if (!this.introspectionClientSecret) {
        throw new Error(
          'Introspection validation requires introspection.clientSecret or KEYCLOAK_SECRET env var.',
        );
      }
    }
    return true;
  }

  async deploy() {
    this.log('Configuring OAuth client credentials authentication...', 'info');

    if (this.keycloakServicePort === 443 || this.keycloakServicePort === 8443) {
      await this.deployBackendTlsPolicy();
    }
    if (this.validationMode === 'introspection') {
      await this.deployIntrospectionSecret();
    }
    await this.deployAuthConfig();
    await this.deployExtAuthPolicy();

    this.log('OAuth client credentials policy applied', 'success');
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

  async deployIntrospectionSecret() {
    const clientSecret = this.dryRun && !this.introspectionClientSecret
      ? '<set introspection.clientSecret or KEYCLOAK_SECRET>'
      : this.introspectionClientSecret;

    const secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: this.introspectionSecretName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      type: 'extauth.solo.io/oauth',
      stringData: {
        'client-secret': clientSecret,
      },
    };

    await this.applyResource(secret);
    this.log(`Introspection client secret '${this.introspectionSecretName}' created`, 'info');
  }

  async deployAuthConfig() {
    const keycloakHost = `${this.keycloakServiceName}.${this.keycloakServiceNamespace}.svc.cluster.local`;
    const accessTokenValidation = {};

    if (this.validationMode === 'introspection') {
      const introspectionUrl = `https://${keycloakHost}/realms/${this.realm}/protocol/openid-connect/token/introspect`;
      accessTokenValidation.introspection = {
        introspectionUrl,
        clientId: this.introspectionClientId,
        clientSecretRef: {
          name: this.introspectionSecretName,
          namespace: this.namespace,
        },
        userIdAttributeName: this.introspectionUserIdAttributeName,
      };
    } else {
      if (this.jwksMode === 'inline') {
        accessTokenValidation.jwt = {
          localJwks: {
            inlineString: this.inlineJwks,
          },
        };
      } else {
        accessTokenValidation.jwt = {
          remoteJwks: {
            url: `https://${keycloakHost}/${this.jwksPath}`,
            cacheDuration: this.cacheDuration,
          },
        };
      }
    }

    if (this.requiredScopes && this.requiredScopes.length > 0) {
      accessTokenValidation.requiredScopes = {
        scopes: this.requiredScopes,
      };
    }

    const authConfig = {
      apiVersion: 'extauth.solo.io/v1',
      kind: 'AuthConfig',
      metadata: {
        name: this.authConfigName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      spec: {
        configs: [
          {
            oauth2: {
              accessTokenValidation,
            },
          },
        ],
      },
    };

    await this.applyResource(authConfig);
    this.log(`AuthConfig '${this.authConfigName}' created`, 'info');
  }

  async deployExtAuthPolicy() {
    const gatewayRef = FeatureManager.getGatewayRef();

    const targetRefs = this.targetRefs || [
      {
        group: 'gateway.networking.k8s.io',
        kind: 'Gateway',
        name: gatewayRef.name,
      },
    ];

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
        targetRefs,
        traffic: {
          entExtAuth: {
            authConfigRef: {
              name: this.authConfigName,
              namespace: this.namespace,
            },
            backendRef: {
              name: this.extAuthServiceName,
              namespace: this.namespace,
              port: this.extAuthServicePort,
            },
          },
        },
      },
    };

    await this.applyResource(policy);
    this.log(
      `EnterpriseAgentgatewayPolicy '${this.policyName}' targeting ${targetRefs.map(r => r.name).join(', ')}`,
      'info',
    );
  }

  async cleanup() {
    this.log('Cleaning up OAuth client credentials authentication...', 'info');

    await this.deleteResource('EnterpriseAgentgatewayPolicy', this.policyName);
    await this.deleteResource('AuthConfig', this.authConfigName);
    if (this.validationMode === 'introspection') {
      await this.deleteResource('Secret', this.introspectionSecretName);
    }
    await this.deleteResource(
      'EnterpriseAgentgatewayPolicy',
      `${this.keycloakServiceName}-backend-tls`,
      this.keycloakServiceNamespace,
    );

    this.log('OAuth client credentials authentication cleaned up', 'success');
  }
}
