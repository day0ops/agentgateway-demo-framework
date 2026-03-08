import { Feature } from '../../src/lib/feature.js';

/**
 * Elicitation Secret Feature
 *
 * Creates a Kubernetes secret containing external OAuth provider credentials
 * for use with the agentgateway elicitation flow. This enables agents to
 * request user authorization for external APIs (e.g., GitHub, Google) on
 * behalf of users.
 *
 * Reference: https://docs.solo.io/agentgateway/2.1.x/security/obo-elicitations/elicitations/
 *
 * This feature:
 * - Creates a Secret with OAuth provider configuration (client ID, secret,
 *   authorize URL, access token URL, scopes, redirect URI)
 * - The secret is referenced by EnterpriseAgentgatewayPolicy tokenExchange.elicitation
 *
 * Configuration:
 * {
 *   secretName: string,              // Secret name (default: 'elicitation-oauth')
 *   provider: string,                // Provider name for labeling (default: 'github')
 *   clientId: string,                // OAuth client ID (required, or use env var)
 *   clientIdEnvVar: string,          // Env var for client ID (default: '<PROVIDER>_CLIENT_ID')
 *   clientSecret: string,            // OAuth client secret (required, or use env var)
 *   clientSecretEnvVar: string,      // Env var for client secret (default: '<PROVIDER>_CLIENT_SECRET')
 *   authorizeUrl: string,            // OAuth authorize URL (required for custom providers)
 *   accessTokenUrl: string,          // OAuth access token URL (required for custom providers)
 *   scopes: string | Array<string>,  // OAuth scopes (comma-separated string or array)
 *   redirectUri: string,             // Redirect URI for elicitation (default: 'http://localhost:4000/age/elicitations')
 * }
 *
 * Supported providers with defaults:
 * - github: GitHub OAuth
 * - google: Google OAuth
 * - custom: Requires authorizeUrl and accessTokenUrl
 */
export class ElicitationSecretFeature extends Feature {
  constructor(name, config) {
    super(name, config);

    this.secretName = config.secretName || 'elicitation-oauth';
    this.provider = (config.provider || 'github').toLowerCase();

    const providerUpper = this.provider.toUpperCase();
    const clientIdEnvVar = config.clientIdEnvVar || `${providerUpper}_CLIENT_ID`;
    const clientSecretEnvVar = config.clientSecretEnvVar || `${providerUpper}_CLIENT_SECRET`;

    this.clientId = config.clientId || process.env[clientIdEnvVar] || '';
    this.clientSecret = config.clientSecret || process.env[clientSecretEnvVar] || '';

    const providerDefaults = {
      github: {
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        accessTokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: 'read:user,repo',
      },
      google: {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        accessTokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: 'openid,email,profile',
      },
    };

    const defaults = providerDefaults[this.provider] || {};
    this.authorizeUrl = config.authorizeUrl || defaults.authorizeUrl || '';
    this.accessTokenUrl = config.accessTokenUrl || defaults.accessTokenUrl || '';

    const configScopes = config.scopes;
    if (Array.isArray(configScopes)) {
      this.scopes = configScopes.join(',');
    } else if (typeof configScopes === 'string') {
      this.scopes = configScopes;
    } else {
      this.scopes = defaults.scopes || '';
    }

    this.redirectUri = config.redirectUri || 'http://localhost:4000/age/elicitations';
  }

  getFeaturePath() {
    return 'elicitation-secret';
  }

  validate() {
    if (!this.clientId) {
      throw new Error(
        `Elicitation secret requires clientId or ${this.provider.toUpperCase()}_CLIENT_ID env var`
      );
    }
    if (!this.clientSecret) {
      throw new Error(
        `Elicitation secret requires clientSecret or ${this.provider.toUpperCase()}_CLIENT_SECRET env var`
      );
    }
    if (!this.authorizeUrl) {
      throw new Error('Elicitation secret requires authorizeUrl for custom providers');
    }
    if (!this.accessTokenUrl) {
      throw new Error('Elicitation secret requires accessTokenUrl for custom providers');
    }
    return true;
  }

  async deploy() {
    this.log(`Creating elicitation secret '${this.secretName}' for provider '${this.provider}'...`, 'info');

    const secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: this.secretName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
          'agentgateway.dev/provider': this.provider,
        },
      },
      type: 'Opaque',
      stringData: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        authorize_url: this.authorizeUrl,
        access_token_url: this.accessTokenUrl,
        scopes: this.scopes,
        redirect_uri: this.redirectUri,
      },
    };

    await this.applyResource(secret);
    this.log(`Elicitation secret '${this.secretName}' created`, 'success');
  }

  async cleanup() {
    this.log('Cleaning up elicitation secret...', 'info');
    await this.deleteResource('Secret', this.secretName);
    this.log('Elicitation secret cleaned up', 'success');
  }
}
