import express from 'express';
import cors from 'cors';
import { proxyRouter } from './routes/proxy';
import { keycloakRouter } from './routes/keycloak';
import { historyRouter } from './routes/history';
import { metadataRouter } from './routes/metadata';

const app = express();
const PORT = process.env.PORT || 8081;

// Configuration from environment
const config = {
  agentgatewayUrl: process.env.AGENTGATEWAY_URL || 'http://localhost:8080',
  keycloakUrl: process.env.KEYCLOAK_URL || 'http://localhost:9000',
  defaultRealm: process.env.DEFAULT_REALM || 'agw-dev',
  stsPort: parseInt(process.env.STS_PORT || '7777'),
};

// Make config available to routes
app.locals.config = config;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Gateway status check - try multiple health endpoints
app.post('/api/gateway/status', async (req, res) => {
  const gatewayUrl = req.body.agentgatewayUrl || config.agentgatewayUrl;
  const healthEndpoints = ['/healthz', '/health', '/ready', '/'];

  for (const endpoint of healthEndpoints) {
    try {
      const response = await fetch(`${gatewayUrl}${endpoint}`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok || response.status < 500) {
        res.json({ connected: true, url: gatewayUrl, endpoint });
        return;
      }
    } catch {
      // Try next endpoint
    }
  }

  // All endpoints failed
  res.json({
    connected: false,
    url: gatewayUrl,
    message: `Could not reach ${gatewayUrl} on any health endpoint`,
  });
});

// Routes
app.use('/api/proxy', proxyRouter);
app.use('/api/keycloak', keycloakRouter);
app.use('/api/history', historyRouter);
app.use('/api/metadata', metadataRouter);

// Start server
app.listen(PORT, () => {
  console.log(`AGW Tester server running on port ${PORT}`);
  console.log(`  Agentgateway URL: ${config.agentgatewayUrl}`);
  console.log(`  Keycloak URL: ${config.keycloakUrl}`);
});
