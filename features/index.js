/**
 * Feature Registry
 *
 * Central registry for all agentgateway features.
 * Import this module to automatically register all available features.
 *
 * Note: Profile-based addons (like telemetry) are registered separately
 * in addons/index.js
 */

import { FeatureManager, PolicyRegistry } from '../src/lib/feature.js';
import { GatewayFeature } from './gateway/index.js';
import { ProvidersFeature } from './providers/index.js';
import { PromptEnrichmentFeature } from './prompt-enrichment/index.js';
import { PromptGuardsFeature } from './prompt-guards/index.js';
import { GuardrailWebhookFeature } from './guardrail-webhook/index.js';
import { ModelFailoverFeature } from './model-failover/index.js';
import { FunctionCallingFeature } from './function-calling/index.js';
import { RateLimitFeature } from './rate-limit/index.js';
import { TokenExchangeFeature } from './token-exchange/index.js';
import { OboTokenExchangeFeature } from './obo-token-exchange/index.js';
import { OAuthAuthorizationCodeFeature } from './oauth-authorization-code/index.js';
import { OAuthAccessTokenValidationFeature } from './oauth-access-token-validation/index.js';
import { AgentFeature } from './agent/index.js';
import { ApiKeyAuthFeature } from './apikey-auth/index.js';
import { McpServerFeature } from './mcp-server/index.js';
import { McpAuthFeature } from './mcp-auth/index.js';
import { McpToolAccessFeature } from './mcp-tool-access/index.js';
import { WorkloadAgentFeature } from './workload-agent/index.js';
import { BudgetManagementFeature } from './budget-management/index.js';
import { ElicitationSecretFeature } from './elicitation-secret/index.js';
import { ElicitationBackendFeature } from './elicitation-backend/index.js';

// Register all features
FeatureManager.register('gateway', GatewayFeature);
FeatureManager.register('providers', ProvidersFeature);
FeatureManager.register('prompt-enrichment', PromptEnrichmentFeature);
FeatureManager.register('prompt-guards', PromptGuardsFeature);
FeatureManager.register('guardrail-webhook', GuardrailWebhookFeature);
FeatureManager.register('model-failover', ModelFailoverFeature);
FeatureManager.register('function-calling', FunctionCallingFeature);
FeatureManager.register('rate-limit', RateLimitFeature);
FeatureManager.register('token-exchange', TokenExchangeFeature);
FeatureManager.register('obo-token-exchange', OboTokenExchangeFeature);
FeatureManager.register('oauth-authorization-code', OAuthAuthorizationCodeFeature);
FeatureManager.register('oauth-access-token-validation', OAuthAccessTokenValidationFeature);
FeatureManager.register('agent', AgentFeature);
FeatureManager.register('apikey-auth', ApiKeyAuthFeature);
FeatureManager.register('mcp-server', McpServerFeature);
FeatureManager.register('mcp-auth', McpAuthFeature);
FeatureManager.register('mcp-tool-access', McpToolAccessFeature);
FeatureManager.register('workload-agent', WorkloadAgentFeature);
FeatureManager.register('budget-management', BudgetManagementFeature);
FeatureManager.register('elicitation-secret', ElicitationSecretFeature);
FeatureManager.register('elicitation-backend', ElicitationBackendFeature);

// Export the FeatureManager and PolicyRegistry for use in other modules
export { FeatureManager, PolicyRegistry };

// Export individual feature classes
export {
  GatewayFeature,
  ProvidersFeature,
  PromptEnrichmentFeature,
  PromptGuardsFeature,
  GuardrailWebhookFeature,
  ModelFailoverFeature,
  FunctionCallingFeature,
  RateLimitFeature,
  TokenExchangeFeature,
  OboTokenExchangeFeature,
  OAuthAuthorizationCodeFeature,
  OAuthAccessTokenValidationFeature,
  AgentFeature,
  ApiKeyAuthFeature,
  McpServerFeature,
  McpAuthFeature,
  McpToolAccessFeature,
  WorkloadAgentFeature,
  BudgetManagementFeature,
  ElicitationSecretFeature,
  ElicitationBackendFeature,
};
