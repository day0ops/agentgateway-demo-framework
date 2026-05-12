/**
 * Addon Registry
 *
 * Central registry for all profile-based addons.
 * Addons are infrastructure components installed alongside agentgateway
 * (e.g., telemetry, keycloak, argocd, cert-manager, etc.)
 */

import { FeatureManager } from '../src/lib/feature.js';
import { TelemetryFeature } from './telemetry/index.js';
import { CertManagerFeature } from './cert-manager/index.js';
import { SoloUIFeature } from './solo-ui/index.js';
import { KeycloakFeature } from './keycloak/index.js';
import { ExternalDnsFeature } from './external-dns/index.js';
import { AgentgatewayExtensionsFeature } from './agentgateway-extensions/index.js';

// Register all addons
FeatureManager.register('telemetry', TelemetryFeature);
FeatureManager.register('cert-manager', CertManagerFeature);
FeatureManager.register('solo-ui', SoloUIFeature);
FeatureManager.register('keycloak', KeycloakFeature);
FeatureManager.register('external-dns', ExternalDnsFeature);
FeatureManager.register('agentgateway-extensions', AgentgatewayExtensionsFeature);

// Export for direct use if needed
export {
  TelemetryFeature,
  CertManagerFeature,
  SoloUIFeature,
  KeycloakFeature,
  ExternalDnsFeature,
  AgentgatewayExtensionsFeature,
};
