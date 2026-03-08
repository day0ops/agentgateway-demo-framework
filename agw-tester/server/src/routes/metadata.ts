import { Router, type Request, type Response } from 'express';

export const metadataRouter = Router();

// Fetch OAuth protected resource metadata
metadataRouter.get('/protected-resource', async (req: Request, res: Response) => {
  const { agentgatewayUrl } = req.app.locals.config;
  const metadataUrl = `${agentgatewayUrl}/.well-known/oauth-protected-resource`;

  try {
    const response = await fetch(metadataUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      res.status(response.status).json({
        error: {
          message: `Failed to fetch metadata: ${response.statusText}`,
        },
      });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch protected resource metadata';
    res.status(500).json({ error: { message } });
  }
});

// Fetch OpenID Connect discovery document
metadataRouter.get('/openid-configuration', async (req: Request, res: Response) => {
  const { keycloakUrl, defaultRealm } = req.app.locals.config;
  const realm = (req.query.realm as string) || defaultRealm;
  const discoveryUrl = `${keycloakUrl}/realms/${realm}/.well-known/openid-configuration`;

  try {
    const response = await fetch(discoveryUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      res.status(response.status).json({
        error: {
          message: `Failed to fetch OpenID configuration: ${response.statusText}`,
        },
      });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch OpenID configuration';
    res.status(500).json({ error: { message } });
  }
});
