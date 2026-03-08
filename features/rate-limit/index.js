import { Feature, FeatureManager } from '../../src/lib/feature.js';

/**
 * Rate Limit Feature
 *
 * Implements rate limiting in two modes:
 *
 * 1. Global (default) — uses a central Rate Limit Server shared across all
 *    proxy replicas. Requires a RateLimitConfig CRD and an
 *    EnterpriseAgentgatewayPolicy with traffic.entRateLimit.global.
 *    Supports both REQUEST and TOKEN counting types.
 *
 * 2. Local — enforced per-replica on each proxy independently (no central
 *    server). Uses EnterpriseAgentgatewayPolicy with traffic.rateLimit.local.
 *    Counts input tokens per time window.
 *
 * Reference: https://docs.solo.io/agentgateway/2.1.x/traffic-management/rate-limiting/
 *
 * Configuration:
 * {
 *   mode: string,                    // "global" (default) | "local"
 *   type: string,                    // Global only: "REQUEST" (default) | "TOKEN"
 *   name: string,                    // Resource name prefix (default: "rate-limit-config")
 *   requestsPerUnit: number,         // Global: max requests/tokens per unit (default: 5)
 *   unit: string,                    // Time unit: SECOND | MINUTE | HOUR | DAY (default: "MINUTE")
 *   descriptorKey: string,           // Global: descriptor key (default: "generic_key")
 *   descriptorValue: string,         // Global: descriptor value (default: "counter")
 *   tokens: number,                  // Local: token budget per window (default: 5)
 *   burst: number,                   // Local: burst allowance (default: 0)
 *   gatewayName: string,             // Target Gateway name (resolved from FeatureManager if omitted)
 * }
 */
export class RateLimitFeature extends Feature {
  validate() {
    const { mode = 'global', requestsPerUnit, tokens } = this.config;
    if (
      mode === 'global' &&
      requestsPerUnit !== undefined &&
      (typeof requestsPerUnit !== 'number' || requestsPerUnit < 1)
    ) {
      throw new Error('requestsPerUnit must be a positive integer');
    }
    if (mode === 'local' && tokens !== undefined && (typeof tokens !== 'number' || tokens < 1)) {
      throw new Error('tokens must be a positive integer');
    }
    return true;
  }

  get mode() {
    return this.config.mode || 'global';
  }

  get rateLimitName() {
    return this.config.name || 'rate-limit-config';
  }

  get policyName() {
    return `${this.rateLimitName}-policy`;
  }

  async deploy() {
    if (this.mode === 'local') {
      await this.deployLocal();
    } else {
      await this.deployGlobal();
    }
  }

  async deployGlobal() {
    const {
      type = 'REQUEST',
      requestsPerUnit = 5,
      unit = 'MINUTE',
      descriptorKey = 'generic_key',
      descriptorValue = 'counter',
    } = this.config;

    const gatewayRef = FeatureManager.getGatewayRef();
    const gatewayName = this.config.gatewayName || gatewayRef.name;

    const rlcOverrides = {
      metadata: { name: this.rateLimitName },
      spec: {
        raw: {
          descriptors: [
            {
              key: descriptorKey,
              value: descriptorValue,
              rateLimit: {
                requestsPerUnit,
                unit,
              },
            },
          ],
          rateLimits: [
            {
              actions: [{ genericKey: { descriptorValue } }],
              type,
            },
          ],
        },
      },
    };

    await this.applyYamlFile('rate-limit-config.yaml', rlcOverrides);

    const policyOverrides = {
      metadata: { name: this.policyName },
      spec: {
        targetRefs: [
          {
            name: gatewayName,
            group: 'gateway.networking.k8s.io',
            kind: 'Gateway',
          },
        ],
        traffic: {
          entRateLimit: {
            global: {
              rateLimitConfigRefs: [{ name: this.rateLimitName }],
            },
          },
        },
      },
    };

    await this.applyYamlFile('enterprise-agentgateway-policy.yaml', policyOverrides);
  }

  async deployLocal() {
    const { tokens = 5, burst = 0, unit = 'MINUTE' } = this.config;

    const gatewayRef = FeatureManager.getGatewayRef();
    const gatewayName = this.config.gatewayName || gatewayRef.name;

    const unitMap = {
      SECOND: 'Seconds',
      MINUTE: 'Minutes',
      HOUR: 'Hours',
      DAY: 'Days',
    };

    const policyOverrides = {
      metadata: { name: this.policyName },
      spec: {
        targetRefs: [
          {
            name: gatewayName,
            group: 'gateway.networking.k8s.io',
            kind: 'Gateway',
          },
        ],
        traffic: {
          rateLimit: {
            local: [
              {
                unit: unitMap[unit] || 'Minutes',
                tokens,
                burst,
              },
            ],
          },
        },
      },
    };

    await this.applyYamlFile('local-rate-limit-policy.yaml', policyOverrides);
  }

  async cleanup() {
    await this.deleteResource('EnterpriseAgentgatewayPolicy', this.policyName);
    if (this.mode === 'global') {
      await this.deleteResource('RateLimitConfig', this.rateLimitName);
    }
  }
}

export function createRateLimitFeature(config) {
  return new RateLimitFeature('rate-limit', config);
}
