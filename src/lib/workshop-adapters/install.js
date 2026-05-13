// src/lib/workshop-adapters/install.js

// Defaults mirror src/lib/agentgateway.js constants
const AGW_VERSION = process.env.AGENTGATEWAY_VERSION || '2.1.1';
const AGW_NAMESPACE = process.env.AGENTGATEWAY_NAMESPACE || 'agentgateway-system';
const AGW_RELEASE = process.env.AGENTGATEWAY_RELEASE || 'enterprise-agentgateway';
const AGW_OCI = 'oci://us-docker.pkg.dev/solo-public/enterprise-agentgateway/charts';
const GATEWAY_API_VERSION = process.env.GATEWAY_API_VERSION || 'v1.4.0';

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
   * @param {{ addons: string[], labNum: number }} opts
   * @returns {string}
   */
  generate({ addons = [], labNum = 0 } = {}) {
    const sections = [];

    sections.push(`## Lab ${labNum}: Installation`);
    sections.push('');
    sections.push('Install the Agentgateway control plane and required CRDs into your cluster.');

    // Gateway API CRDs
    sections.push('');
    sections.push('### Install Gateway API CRDs');
    sections.push('');
    sections.push(`Install the Gateway API standard channel CRDs (${GATEWAY_API_VERSION}):`);
    sections.push('');
    sections.push('```bash');
    sections.push(
      `kubectl apply --server-side -f https://github.com/kubernetes-sigs/gateway-api/releases/download/${GATEWAY_API_VERSION}/standard-install.yaml`
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
    sections.push(`  --version ${AGW_VERSION} \\`);
    sections.push(`  enterprise-agentgateway-crds \\`);
    sections.push(`  ${AGW_OCI}/enterprise-agentgateway-crds`);
    sections.push('```');

    // AGW chart
    sections.push('');
    sections.push('### Install Agentgateway');
    sections.push('');
    sections.push('```bash');
    sections.push(`helm upgrade -i \\`);
    sections.push(`  -n ${AGW_NAMESPACE} \\`);
    sections.push(`  ${AGW_RELEASE} \\`);
    sections.push(`  ${AGW_OCI}/enterprise-agentgateway \\`);
    sections.push(`  --version ${AGW_VERSION} \\`);
    sections.push(`  --set licensing.licenseKey=$ENTERPRISE_AGW_LICENSE_KEY \\`);
    sections.push(`  --wait --timeout 5m`);
    sections.push('```');

    // Addons (delegated to AddonAdapter — rendered inline here)
    if (addons.length > 0) {
      sections.push('');
      sections.push('### Install Addons');
      sections.push('');
      sections.push(
        'The following optional addons were selected. Install each one below.'
      );
      for (const addonName of addons) {
        sections.push('');
        sections.push(`See **Lab ${labNum} — ${_addonTitle(addonName)}** below.`);
      }
    }

    return sections.join('\n');
  },
};

function _addonTitle(name) {
  return name
    .split('-')
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
