// src/lib/workshop-adapters/install.js
import yaml from 'js-yaml';

// Defaults mirror src/lib/agentgateway.js constants
const AGW_VERSION = process.env.AGENTGATEWAY_VERSION || '2.1.1';
const AGW_NAMESPACE = process.env.AGENTGATEWAY_NAMESPACE || 'agentgateway-system';
const AGW_RELEASE = process.env.AGENTGATEWAY_RELEASE || 'enterprise-agentgateway';
const AGW_CRDS_RELEASE = process.env.AGENTGATEWAY_CRDS_RELEASE || 'enterprise-agentgateway-crds';
const AGW_OCI = 'oci://us-docker.pkg.dev/solo-public/enterprise-agentgateway/charts';
const GATEWAY_API_VERSION = process.env.GATEWAY_API_VERSION || 'v1.4.0';

/**
 * Resolve version/registry fields from optional profile data.
 * @param {object|null} profileData
 * @returns {{ version, ociRegistry, gatewayApiVersion, gatewayApiChannel, crdsVersion, crdsOciRegistry }}
 */
function _resolveVersions(profileData) {
  return {
    version: profileData?.agentgateway?.version ?? AGW_VERSION,
    ociRegistry: profileData?.agentgateway?.ociRegistry ?? AGW_OCI,
    gatewayApiVersion: profileData?.gatewayApi?.version ?? GATEWAY_API_VERSION,
    gatewayApiChannel: profileData?.gatewayApi?.channel ?? 'standard',
    crdsVersion:
      profileData?.['agentgateway-crds']?.version ??
      (profileData?.agentgateway?.version ?? AGW_VERSION),
    crdsOciRegistry:
      profileData?.['agentgateway-crds']?.ociRegistry ??
      (profileData?.agentgateway?.ociRegistry ?? AGW_OCI),
  };
}

export const InstallAdapter = {
  /**
   * Env vars required for the installation section.
   */
  envVars() {
    return [
      {
        name: 'ENTERPRISE_AGW_LICENSE_KEY',
        required: true,
        description: 'Enterprise Agentgateway license key from Solo.io',
      },
    ];
  },

  /**
   * Generate the Installation lab section markdown.
   * @param {{ addons?: string[], labNum?: number, profileData?: object|null }} opts
   * @returns {string}
   */
  generate({ addons = [], labNum = 0, profileData = null } = {}) {
    const { version, ociRegistry, gatewayApiVersion, gatewayApiChannel, crdsVersion, crdsOciRegistry } =
      _resolveVersions(profileData);

    const installFile =
      gatewayApiChannel === 'experimental' ? 'experimental-install.yaml' : 'standard-install.yaml';
    const channelLabel = gatewayApiChannel === 'experimental' ? 'experimental' : 'standard';

    const sections = [];

    sections.push(`## Lab ${labNum}: Installation`);
    sections.push('');
    sections.push('Install the Agentgateway control plane and required CRDs into your cluster.');

    // Gateway API CRDs
    sections.push('');
    sections.push('### Install Gateway API CRDs');
    sections.push('');
    sections.push(
      `Install the Gateway API ${channelLabel} channel CRDs (${gatewayApiVersion}):`
    );
    sections.push('');
    sections.push('```bash');
    sections.push(
      `kubectl apply --server-side -f https://github.com/kubernetes-sigs/gateway-api/releases/download/${gatewayApiVersion}/${installFile}`
    );
    sections.push('```');

    // AGW CRDs
    sections.push('');
    sections.push('### Install Agentgateway CRDs');
    sections.push('');
    sections.push('```bash');
    sections.push(`kubectl create namespace ${AGW_NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -`);
    sections.push('');
    sections.push(`helm upgrade -i --create-namespace \\`);
    sections.push(`  --namespace ${AGW_NAMESPACE} \\`);
    sections.push(`  --version ${crdsVersion} \\`);
    sections.push(`  ${AGW_CRDS_RELEASE} \\`);
    sections.push(`  ${crdsOciRegistry}/enterprise-agentgateway-crds`);
    sections.push('```');

    // AGW chart
    sections.push('');
    sections.push('### Install Agentgateway');
    sections.push('');

    const hasHelmValues =
      profileData?.helmValues != null && Object.keys(profileData.helmValues).length > 0;

    if (hasHelmValues) {
      // Strip licensing key before dumping so the license key never appears in docs
      const { licensing: _licensing, ...safeHelmValues } = profileData.helmValues;
      sections.push('#### Create a `values.yaml` file');
      sections.push('');
      sections.push('```yaml');
      sections.push(yaml.dump(safeHelmValues, { indent: 2 }).trimEnd());
      sections.push('```');
      sections.push('');
    }

    sections.push('```bash');
    sections.push(`helm upgrade -i \\`);
    sections.push(`  -n ${AGW_NAMESPACE} \\`);
    sections.push(`  ${AGW_RELEASE} \\`);
    sections.push(`  ${ociRegistry}/enterprise-agentgateway \\`);
    sections.push(`  --version ${version} \\`);
    if (hasHelmValues) {
      sections.push(`  --values values.yaml \\`);
    }
    sections.push(`  --set licensing.licenseKey=$ENTERPRISE_AGW_LICENSE_KEY \\`);
    sections.push(`  --wait --timeout 5m`);
    sections.push('```');

    // Additional resources (profile-specific)
    if (profileData?.resources?.length > 0) {
      sections.push('');
      sections.push('### Apply Additional Resources');
      sections.push('');
      sections.push('Apply the following profile-specific resources:');
      sections.push('');
      sections.push('```bash');
      for (const resource of profileData.resources) {
        sections.push(`kubectl apply -f config/profiles/${resource}`);
      }
      sections.push('```');
    }

    return sections.join('\n');
  },

  /**
   * Return component version info for the versions table.
   * @param {object|null} profileData
   * @returns {{ agwVersion: string, gatewayApiVersion: string, agwOci: string }}
   */
  versions(profileData = null) {
    const { version, ociRegistry, gatewayApiVersion, gatewayApiChannel } = _resolveVersions(profileData);
    return {
      agwVersion: version,
      gatewayApiVersion,
      gatewayApiChannel,
      agwOci: ociRegistry,
      agwRelease: AGW_RELEASE,
      agwCrdsRelease: AGW_CRDS_RELEASE,
      agwNamespace: AGW_NAMESPACE,
    };
  },
};
