import { Router, type Request, type Response } from 'express';

export const keycloakRouter = Router();

interface TokenRequest {
  grantType: 'password' | 'client_credentials';
  username?: string;
  password?: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
  realm?: string;
}

interface TokenExchangeRequest {
  subjectToken: string;
  subjectTokenType?: string;
  requestedTokenType?: string;
  audience?: string;
  scope?: string;
  realm?: string;
}

// Acquire token from Keycloak
keycloakRouter.post('/token', async (req: Request, res: Response) => {
  const { keycloakUrl, defaultRealm } = req.app.locals.config;
  const { grantType, username, password, clientId, clientSecret, scope, realm } =
    req.body as TokenRequest;

  const tokenUrl = `${keycloakUrl}/realms/${realm || defaultRealm}/protocol/openid-connect/token`;

  const params = new URLSearchParams();
  params.append('grant_type', grantType);
  params.append('client_id', clientId);

  if (clientSecret) {
    params.append('client_secret', clientSecret);
  }

  if (grantType === 'password') {
    if (!username || !password) {
      res
        .status(400)
        .json({ error: { message: 'Username and password are required for password grant' } });
      return;
    }
    params.append('username', username);
    params.append('password', password);
  }

  if (scope) {
    params.append('scope', scope);
  }

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: {
          message: data.error_description || data.error || 'Token acquisition failed',
        },
      });
      return;
    }

    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token request failed';
    res.status(500).json({ error: { message } });
  }
});

// Token exchange (OBO)
keycloakRouter.post('/token-exchange', async (req: Request, res: Response) => {
  const { keycloakUrl, defaultRealm, stsPort } = req.app.locals.config;
  const {
    subjectToken,
    subjectTokenType = 'urn:ietf:params:oauth:token-type:access_token',
    requestedTokenType = 'urn:ietf:params:oauth:token-type:access_token',
    audience,
    scope,
    realm,
  } = req.body as TokenExchangeRequest;

  if (!subjectToken) {
    res.status(400).json({ error: { message: 'Subject token is required' } });
    return;
  }

  // Try STS port first, fall back to Keycloak
  const stsUrl = `http://localhost:${stsPort}/token`;
  const keycloakTokenUrl = `${keycloakUrl}/realms/${realm || defaultRealm}/protocol/openid-connect/token`;

  const params = new URLSearchParams();
  params.append('grant_type', 'urn:ietf:params:oauth:grant-type:token-exchange');
  params.append('subject_token', subjectToken);
  params.append('subject_token_type', subjectTokenType);
  params.append('requested_token_type', requestedTokenType);

  if (audience) {
    params.append('audience', audience);
  }

  if (scope) {
    params.append('scope', scope);
  }

  // Try STS endpoint first
  try {
    const response = await fetch(stsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) {
      const data = await response.json();
      res.json(data);
      return;
    }
  } catch {
    // STS not available, try Keycloak
  }

  // Fall back to Keycloak
  try {
    const response = await fetch(keycloakTokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: {
          message: data.error_description || data.error || 'Token exchange failed',
        },
      });
      return;
    }

    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token exchange request failed';
    res.status(500).json({ error: { message } });
  }
});
