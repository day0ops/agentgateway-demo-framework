import { Router, type Request, type Response } from 'express';

export const proxyRouter = Router();

interface ProxyLLMRequest {
  endpoint: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body: unknown;
  agentgatewayUrl?: string;
}

interface ProxyMCPRequest {
  endpoint: string;
  body: unknown;
  agentgatewayUrl?: string;
}

// Proxy LLM requests to agentgateway
proxyRouter.post('/llm', async (req: Request, res: Response) => {
  const { endpoint, method, headers, body, agentgatewayUrl: clientUrl } = req.body as ProxyLLMRequest;
  const agentgatewayUrl = clientUrl || req.app.locals.config.agentgatewayUrl;

  if (!endpoint) {
    res.status(400).json({ error: { message: 'Endpoint is required' } });
    return;
  }

  const url = `${agentgatewayUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  const startTime = Date.now();

  try {
    const fetchOptions: RequestInit = {
      method: method || 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(120000),
    };

    if (method !== 'GET' && body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    const durationMs = Date.now() - startTime;

    // Get response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let responseBody: unknown;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    res.json({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Proxy request failed';
    res.status(502).json({
      status: 502,
      statusText: 'Bad Gateway',
      headers: {},
      body: { error: message },
      durationMs,
    });
  }
});

// Proxy MCP requests to agentgateway
proxyRouter.post('/mcp', async (req: Request, res: Response) => {
  const { endpoint, body, agentgatewayUrl: clientUrl } = req.body as ProxyMCPRequest;
  const agentgatewayUrl = clientUrl || req.app.locals.config.agentgatewayUrl;

  const url = `${agentgatewayUrl}${endpoint || '/mcp'}`;
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    const durationMs = Date.now() - startTime;
    const responseBody = await response.json();

    // Check for elicitation response
    if (responseBody.error?.code === -32001 || responseBody.elicitation) {
      res.json({
        elicitation: {
          id: responseBody.elicitation?.id || responseBody.error?.data?.elicitation_id,
          status: 'PENDING',
          elicitationUrl: responseBody.elicitation?.url || responseBody.error?.data?.elicitation_url,
          createdAt: new Date().toISOString(),
        },
        response: responseBody,
        durationMs,
      });
      return;
    }

    res.json({
      response: responseBody,
      durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'MCP proxy request failed';
    res.status(502).json({
      error: { message },
      durationMs,
    });
  }
});
