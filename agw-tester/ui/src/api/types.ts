// Request/Response types
export interface LLMRequest {
  endpoint: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body: unknown;
}

export interface LLMResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
}

export interface MCPRequest {
  method: string;
  params?: unknown;
}

export interface MCPResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  durationMs: number;
}

// History types
export interface HistoryEntry {
  id: string;
  timestamp: string;
  type: 'llm' | 'mcp';
  endpoint: string;
  method: string;
  request: unknown;
  response: unknown;
  durationMs: number;
  status: number;
}

// Keycloak/OAuth types
export interface TokenRequest {
  grantType: 'password' | 'client_credentials';
  username?: string;
  password?: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface TokenExchangeRequest {
  subjectToken: string;
  subjectTokenType?: string;
  requestedTokenType?: string;
  audience?: string;
  scope?: string;
}

export interface DecodedJWT {
  header: {
    alg: string;
    typ: string;
    kid?: string;
  };
  payload: Record<string, unknown>;
  signature: string;
  raw: string;
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported?: string[];
  resource_documentation?: string;
}

// Config types
export interface AppConfig {
  agentgatewayUrl: string;
  keycloakUrl: string;
  defaultRealm: string;
  clientId: string;
  clientSecret: string;
  stsPort: number;
  variables: Record<string, string>;
}

// Gateway status
export interface GatewayStatus {
  connected: boolean;
  version?: string;
  uptime?: number;
}

// Provider/Model info
export interface Provider {
  id: string;
  name: string;
  models: Model[];
}

export interface Model {
  id: string;
  name: string;
  provider: string;
}

export const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', provider: 'anthropic' },
    ],
  },
];

// Request templates
export interface RequestTemplate {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body: unknown;
}

export const DEFAULT_TEMPLATES: RequestTemplate[] = [
  {
    id: 'openai-chat',
    name: 'OpenAI Chat Completion',
    description: 'Standard OpenAI chat completion request',
    endpoint: '/openai/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'Hello, how are you?' },
      ],
    },
  },
  {
    id: 'anthropic-messages',
    name: 'Anthropic Messages',
    description: 'Standard Anthropic messages API request',
    endpoint: '/anthropic/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'Hello, how are you?' },
      ],
    },
  },
  {
    id: 'mcp-tools-list',
    name: 'MCP Tools List',
    description: 'List available MCP tools',
    endpoint: '/mcp',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    },
  },
  {
    id: 'mcp-tools-call',
    name: 'MCP Tool Call',
    description: 'Call an MCP tool',
    endpoint: '/mcp',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'tool_name',
        arguments: {},
      },
    },
  },
];
