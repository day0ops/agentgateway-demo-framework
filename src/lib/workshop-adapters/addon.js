const ADDON_REGISTRY = {
  telemetry: {
    title: 'Telemetry Stack',
    description:
      'Installs Prometheus/Grafana, Tempo Distributed, Loki, and Alloy for full observability.',
    helmRepos: [
      { name: 'grafana', url: 'https://grafana.github.io/helm-charts' },
      { name: 'prometheus-community', url: 'https://prometheus-community.github.io/helm-charts' },
    ],
    helmInstalls: [
      {
        release: 'kube-prometheus-stack',
        chart: 'prometheus-community/kube-prometheus-stack',
        version: '80.4.2',
        namespace: 'telemetry',
      },
      {
        release: 'tempo',
        chart: 'grafana/tempo-distributed',
        version: '1.29.0',
        namespace: 'telemetry',
      },
      { release: 'loki', chart: 'grafana/loki', version: '6.6.2', namespace: 'telemetry' },
      { release: 'alloy', chart: 'grafana/alloy', version: '0.12.0', namespace: 'telemetry' },
    ],
    envVars: [],
  },
  'cert-manager': {
    title: 'Certificate Manager',
    description: 'Installs cert-manager for automated TLS certificate management.',
    helmRepos: [{ name: 'jetstack', url: 'https://charts.jetstack.io' }],
    helmInstalls: [
      {
        release: 'cert-manager',
        chart: 'jetstack/cert-manager',
        version: '1.19.3',
        namespace: 'cert-manager',
        extraArgs: ['--set', 'installCRDs=true'],
      },
    ],
    envVars: [],
  },
  'solo-ui': {
    title: 'Solo UI',
    description: 'Installs the Solo UI management console (includes ClickHouse).',
    ociInstalls: [
      {
        release: 'solo-ui-crds',
        chart: 'oci://us-docker.pkg.dev/solo-public/solo-enterprise-helm/charts/management-crds',
        version: '0.3.13',
        namespace: 'agentgateway-system',
      },
      {
        release: 'solo-ui',
        chart: 'oci://us-docker.pkg.dev/solo-public/solo-enterprise-helm/charts/management',
        version: '0.3.13',
        namespace: 'agentgateway-system',
      },
    ],
    envVars: [],
  },
  keycloak: {
    title: 'Keycloak',
    description:
      'Deploys Keycloak identity provider. Uses Kubernetes manifests rather than Helm.',
    manifestBased: true,
    note:
      'Keycloak is deployed via Kubernetes manifests managed by the agw CLI. Run the following command to install it:\n\n```bash\nagw base addon install keycloak\n```',
    envVars: [],
  },
};

export const AddonAdapter = {
  /** Return list of known addon names. */
  knownAddons() {
    return Object.keys(ADDON_REGISTRY);
  },

  /** Env vars required for an addon. */
  envVarsFor(addonName) {
    const descriptor = ADDON_REGISTRY[addonName];
    if (!descriptor) return [];
    return descriptor.envVars || [];
  },

  /**
   * Generate a markdown section for an addon installation.
   * @param {string} addonName
   * @param {number} subIndex
   * @returns {string}
   */
  generate(addonName, subIndex = 0) {
    const descriptor = ADDON_REGISTRY[addonName];
    if (!descriptor) throw new Error(`Unknown addon: '${addonName}'`);

    const lines = [];
    lines.push(`### Install ${descriptor.title}`);
    lines.push('');
    lines.push(descriptor.description);

    if (descriptor.manifestBased) {
      lines.push('');
      lines.push(descriptor.note);
      return lines.join('\n');
    }

    // Helm repo adds
    if (descriptor.helmRepos?.length > 0) {
      lines.push('');
      lines.push('Add Helm repositories:');
      lines.push('');
      lines.push('```bash');
      for (const repo of descriptor.helmRepos) {
        lines.push(`helm repo add ${repo.name} ${repo.url}`);
      }
      lines.push('helm repo update');
      lines.push('```');
    }

    // Helm installs (repo-based)
    if (descriptor.helmInstalls?.length > 0) {
      for (const install of descriptor.helmInstalls) {
        lines.push('');
        lines.push(`Install \`${install.release}\`:`);
        lines.push('');
        lines.push('```bash');
        const args = [
          `helm upgrade -i ${install.release} ${install.chart} \\`,
          `  -n ${install.namespace} \\`,
          `  --version ${install.version} \\`,
          `  --create-namespace \\`,
          `  --wait`,
        ];
        if (install.extraArgs?.length) {
          // Insert extraArgs before --wait
          args.splice(args.length - 1, 0, `  ${install.extraArgs.join(' ')} \\`);
          // Fix the line before to have a backslash continuation
          args[args.length - 2] = args[args.length - 2].replace(/\s*$/, ' \\');
        }
        lines.push(...args);
        lines.push('```');
      }
    }

    // OCI installs
    if (descriptor.ociInstalls?.length > 0) {
      for (const install of descriptor.ociInstalls) {
        lines.push('');
        lines.push(`Install \`${install.release}\`:`);
        lines.push('');
        lines.push('```bash');
        lines.push(`helm upgrade -i ${install.release} \\`);
        lines.push(`  ${install.chart} \\`);
        lines.push(`  -n ${install.namespace} \\`);
        lines.push(`  --version ${install.version} \\`);
        lines.push(`  --create-namespace \\`);
        lines.push(`  --wait --timeout 5m`);
        lines.push('```');
      }
    }

    return lines.join('\n');
  },
};
