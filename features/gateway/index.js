import { Feature, FeatureManager } from '../../src/lib/feature.js';

/**
 * Gateway Feature
 *
 * Overrides the default Gateway referenced by HTTPRoutes. Use this in a use case to:
 * - Use a different Gateway name or namespace
 * - Add or modify listeners (e.g. HTTP, HTTPS with TLS)
 * - Customize gatewayClassName or other spec fields
 *
 * When this feature is deployed, all HTTPRoutes created by other features in the same
 * use case will reference this Gateway via parentRefs.
 *
 * Configuration:
 * {
 *   name: string,             // Gateway resource name (default: agentgateway)
 *   namespace: string,        // Optional; defaults to use case namespace
 *   gatewayClassName: string,
 *   listeners: [              // Gateway API listeners
 *     {
 *       name: string,         // Listener name (e.g. 'http', 'https')
 *       port: number,         // Port number
 *       protocol: string,     // 'HTTP' or 'HTTPS'
 *       tls?: {               // TLS config (required for HTTPS)
 *         mode: string,       // 'Terminate' or 'Passthrough'
 *         certificateRefs: [  // References to TLS secrets
 *           { name: string, namespace?: string }
 *         ]
 *       },
 *       allowedRoutes?: { namespaces: { from: string } }
 *     }
 *   ]
 * }
 */
export class GatewayFeature extends Feature {
  getFeaturePath() {
    return this.name;
  }

  validate() {
    return true;
  }

  async deploy() {
    const { name = 'agentgateway', namespace, gatewayClassName, listeners } = this.config;

    const overrides = {
      metadata: {
        name,
        namespace: namespace ?? this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
          app: name,
        },
      },
    };

    const specOverrides = {};
    if (gatewayClassName !== undefined) specOverrides.gatewayClassName = gatewayClassName;
    if (listeners !== undefined && listeners.length > 0) specOverrides.listeners = listeners;
    if (Object.keys(specOverrides).length > 0) overrides.spec = specOverrides;

    await this.applyYamlFile('gateway.yaml', overrides);

    FeatureManager.setGatewayRef({
      name: overrides.metadata.name,
      namespace: overrides.metadata.namespace,
    });
    this.log(
      `Gateway '${overrides.metadata.name}' set as default for HTTPRoute parentRefs`,
      'info'
    );
  }

  async cleanup() {
    const { name = 'agentgateway' } = this.config;
    await this.deleteResource('Gateway', name, this.namespace);
  }
}
