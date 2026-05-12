import { Feature } from '../../src/lib/feature.js';
import { KubernetesHelper, Logger } from '../../src/lib/common.js';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import yaml from 'js-yaml';

const AGENTGATEWAY_NAMESPACE = process.env.AGENTGATEWAY_NAMESPACE || 'agentgateway-system';
const AGENTGATEWAY_RELEASE = process.env.AGENTGATEWAY_RELEASE || 'enterprise-agentgateway';
const AGENTGATEWAY_VERSION = process.env.AGENTGATEWAY_VERSION || '2.1.1';
const AGENTGATEWAY_OCI_REGISTRY =
  'oci://us-docker.pkg.dev/solo-public/enterprise-agentgateway/charts';
const ENTERPRISE_AGW_LICENSE_KEY = process.env.ENTERPRISE_AGW_LICENSE_KEY;

/**
 * Token Exchange Feature
 *
 * Performs a Helm upgrade on the enterprise-agentgateway release to enable the
 * Security Token Service (STS) for OBO token exchange and elicitation flows.
 *
 * References:
 *   OBO: https://docs.solo.io/agentgateway/2.1.x/security/obo-elicitations/obo/#step-2-set-up-token-exchange
 *   Elicitation: https://docs.solo.io/agentgateway/2.1.x/security/obo-elicitations/elicitations/
 *
 * Configuration:
 * {
 *   issuer: string,           // STS issuer (default: enterprise-agentgateway.<ns>.svc.cluster.local:7777)
 *   tokenExpiration: string,  // Token TTL (default: '24h')
 *   subjectValidator: {
 *     validatorType: string,  // Default: 'remote'
 *     remoteConfig: {
 *       url: string,          // Keycloak JWKS URL
 *     },
 *   },
 *   actorValidator: {
 *     validatorType: string,  // Default: 'k8s'
 *   },
 *   elicitation: {
 *     enabled: boolean,       // Enable elicitation support (default: false)
 *     oidc: {
 *       secretName: string,   // Secret containing OAuth provider credentials
 *     },
 *   },
 * }
 */
export class TokenExchangeFeature extends Feature {
  constructor(name, config) {
    super(name, config);

    const ns = this.namespace || AGENTGATEWAY_NAMESPACE;

    const kc = config.keycloak || {};
    const realm = kc.realm || 'agw-dev';
    const kcHost = `${kc.serviceName || 'keycloak'}.${kc.serviceNamespace || 'keycloak'}.svc.cluster.local`;
    const defaultJwksUrl = `https://${kcHost}/realms/${realm}/protocol/openid-connect/certs`;

    this.tokenExchangeValues = {
      tokenExchange: {
        enabled: true,
        issuer: config.issuer || `${AGENTGATEWAY_RELEASE}.${ns}.svc.cluster.local:7777`,
        tokenExpiration: config.tokenExpiration || '24h',
        subjectValidator: config.subjectValidator || {
          validatorType: 'remote',
          remoteConfig: {
            url: config.jwksUrl || defaultJwksUrl,
          },
        },
        actorValidator: config.actorValidator || {
          validatorType: 'k8s',
        },
      },
    };

    if (config.elicitation?.enabled) {
      this.tokenExchangeValues.tokenExchange.elicitation = {
        enabled: true,
      };
      if (config.elicitation.oidc?.secretName) {
        this.tokenExchangeValues.tokenExchange.elicitation.oidc = {
          secretName: config.elicitation.oidc.secretName,
        };
      }
    }
  }

  getFeaturePath() {
    return 'token-exchange';
  }

  validate() {
    return true;
  }

  async deploy() {
    if (this.dryRun) {
      const comment = [
        '# Helm upgrade: enable STS token exchange',
        '# helm upgrade enterprise-agentgateway ... --reuse-values \\',
        '#   -f <values below>',
        yaml.dump(this.tokenExchangeValues, { lineWidth: -1, indent: 2 }).trim(),
      ].join('\n');
      this._dryRunYaml.push(comment);
      return;
    }

    this.log('Enabling STS token exchange via Helm upgrade...', 'info');

    let tempFile = null;

    try {
      tempFile = join(tmpdir(), `agw-token-exchange-${Date.now()}.yaml`);
      await writeFile(
        tempFile,
        yaml.dump(this.tokenExchangeValues, { lineWidth: -1, indent: 2 }),
        'utf8'
      );

      const helmArgs = [
        'upgrade',
        AGENTGATEWAY_RELEASE,
        `${AGENTGATEWAY_OCI_REGISTRY}/enterprise-agentgateway`,
        '--namespace',
        AGENTGATEWAY_NAMESPACE,
        '--version',
        AGENTGATEWAY_VERSION,
        '--reuse-values',
        '-f',
        tempFile,
        '--wait',
        '--timeout',
        '5m',
      ];

      if (ENTERPRISE_AGW_LICENSE_KEY) {
        helmArgs.push('--set', `licensing.licenseKey=${ENTERPRISE_AGW_LICENSE_KEY}`);
      }

      await KubernetesHelper.helm(helmArgs);

      this.log('STS token exchange enabled (port 7777)', 'success');
    } finally {
      if (tempFile) {
        try {
          await unlink(tempFile);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async cleanup() {
    this.log('Disabling STS token exchange via Helm upgrade...', 'info');

    let tempFile = null;

    try {
      const disableValues = { tokenExchange: { enabled: false } };
      tempFile = join(tmpdir(), `agw-token-exchange-disable-${Date.now()}.yaml`);
      await writeFile(tempFile, yaml.dump(disableValues, { lineWidth: -1, indent: 2 }), 'utf8');

      const helmArgs = [
        'upgrade',
        AGENTGATEWAY_RELEASE,
        `${AGENTGATEWAY_OCI_REGISTRY}/enterprise-agentgateway`,
        '--namespace',
        AGENTGATEWAY_NAMESPACE,
        '--version',
        AGENTGATEWAY_VERSION,
        '--reuse-values',
        '-f',
        tempFile,
        '--wait',
        '--timeout',
        '5m',
      ];

      if (ENTERPRISE_AGW_LICENSE_KEY) {
        helmArgs.push('--set', `licensing.licenseKey=${ENTERPRISE_AGW_LICENSE_KEY}`);
      }

      await KubernetesHelper.helm(helmArgs);

      this.log('STS token exchange disabled', 'success');
    } catch (error) {
      this.log(`Failed to disable token exchange: ${error.message}`, 'warn');
    } finally {
      if (tempFile) {
        try {
          await unlink(tempFile);
        } catch {
          /* ignore */
        }
      }
    }
  }
}
