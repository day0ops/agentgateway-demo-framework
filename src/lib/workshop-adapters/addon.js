import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../../..');

const KEYCLOAK_VERSION = '26.5.3';
const POSTGRES_VERSION = '18.2-alpine';

/**
 * Substitute {{VAR}} placeholders in a template string.
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
function _renderTemplate(template, vars) {
  return Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v), template);
}

/**
 * Generate the Keycloak Admin API curl commands for a single standard realm
 * (one that has `clients` and `users` arrays).
 */
function _generateStandardRealmCurls(realm) {
  const lines = [];
  const realmName = realm.realm;

  lines.push(`# Create realm: ${realmName}`);
  lines.push(`curl -sk -X POST "\${KEYCLOAK_SCHEME}://\${KEYCLOAK_HOST}/admin/realms" \\`);
  lines.push(`  -H "Authorization: Bearer $KEYCLOAK_TOKEN" \\`);
  lines.push(`  -H "Content-Type: application/json" \\`);
  lines.push(
    `  -d '{"realm":"${realmName}","enabled":true,"loginWithEmailAllowed":true}'`,
  );

  for (const client of realm.clients || []) {
    const isPublic = client.type === 'public';
    const flows = client.flows || [];
    const serviceAccountsEnabled = !isPublic && flows.includes('service-account');
    const standardFlowEnabled = flows.includes('authorization-code');

    lines.push('');
    lines.push(`# Client: ${client.clientId} (${client.type})`);
    lines.push(
      `curl -sk -X POST "\${KEYCLOAK_SCHEME}://\${KEYCLOAK_HOST}/admin/realms/${realmName}/clients" \\`,
    );
    lines.push(`  -H "Authorization: Bearer $KEYCLOAK_TOKEN" \\`);
    lines.push(`  -H "Content-Type: application/json" \\`);

    const clientPayload = {
      clientId: client.clientId,
      publicClient: isPublic,
      serviceAccountsEnabled,
      standardFlowEnabled,
    };
    if (!isPublic && client.clientSecret) {
      clientPayload.secret = client.clientSecret;
    }

    lines.push(`  -d '${JSON.stringify(clientPayload)}'`);
  }

  for (const user of realm.users || []) {
    const attrs = {};
    for (const [k, v] of Object.entries(user.attributes || {})) {
      attrs[k] = [v];
    }
    const userPayload = {
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      enabled: true,
      credentials: [{ type: 'password', value: realm.defaultPassword || 'Password1!', temporary: false }],
      attributes: attrs,
    };

    lines.push('');
    lines.push(`# User: ${user.username}`);
    lines.push(
      `curl -sk -X POST "\${KEYCLOAK_SCHEME}://\${KEYCLOAK_HOST}/admin/realms/${realmName}/users" \\`,
    );
    lines.push(`  -H "Authorization: Bearer $KEYCLOAK_TOKEN" \\`);
    lines.push(`  -H "Content-Type: application/json" \\`);
    lines.push(`  -d '${JSON.stringify(userPayload)}'`);
  }

  return lines.join('\n');
}

/**
 * Generate the Keycloak Admin API curl commands for a single org realm
 * (one that has a `teams` array instead of `clients`/`users`).
 */
function _generateOrgRealmCurls(realm) {
  const lines = [];
  const realmName = realm.realm;

  lines.push(`# Create realm: ${realmName}`);
  lines.push(`curl -sk -X POST "\${KEYCLOAK_SCHEME}://\${KEYCLOAK_HOST}/admin/realms" \\`);
  lines.push(`  -H "Authorization: Bearer $KEYCLOAK_TOKEN" \\`);
  lines.push(`  -H "Content-Type: application/json" \\`);
  lines.push(`  -d '{"realm":"${realmName}","enabled":true}'`);

  for (const team of realm.teams || []) {
    lines.push('');
    lines.push(`# Team client: ${team.clientId}`);
    lines.push(
      `curl -sk -X POST "\${KEYCLOAK_SCHEME}://\${KEYCLOAK_HOST}/admin/realms/${realmName}/clients" \\`,
    );
    lines.push(`  -H "Authorization: Bearer $KEYCLOAK_TOKEN" \\`);
    lines.push(`  -H "Content-Type: application/json" \\`);
    const teamClientPayload = {
      clientId: team.clientId,
      secret: team.clientSecret,
      publicClient: false,
      serviceAccountsEnabled: true,
    };
    lines.push(`  -d '${JSON.stringify(teamClientPayload)}'`);

    for (const user of team.users || []) {
      const attrs = {};
      for (const [k, v] of Object.entries(user.attributes || {})) {
        attrs[k] = [v];
      }
      const userPayload = {
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        enabled: true,
        credentials: [{ type: 'password', value: realm.defaultPassword || 'Password1!', temporary: false }],
        attributes: attrs,
      };

      lines.push('');
      lines.push(`# User: ${user.username}`);
      lines.push(
        `curl -sk -X POST "\${KEYCLOAK_SCHEME}://\${KEYCLOAK_HOST}/admin/realms/${realmName}/users" \\`,
      );
      lines.push(`  -H "Authorization: Bearer $KEYCLOAK_TOKEN" \\`);
      lines.push(`  -H "Content-Type: application/json" \\`);
      lines.push(`  -d '${JSON.stringify(userPayload)}'`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate documentation for the Telemetry addon.
 * @param {number} subIndex
 * @param {object|null} profileAddonConfig
 * @returns {string}
 */
function _generateTelemetry(subIndex, profileAddonConfig) {
  const lines = [];

  lines.push('### Install Telemetry Stack');
  lines.push('');
  lines.push(
    'Installs Prometheus/Grafana, Tempo Distributed, Loki, and Alloy for full observability.',
  );

  lines.push('');
  lines.push('#### Add Helm repositories');
  lines.push('');
  lines.push('```bash');
  lines.push('helm repo add prometheus-community https://prometheus-community.github.io/helm-charts');
  lines.push('helm repo add grafana https://grafana.github.io/helm-charts');
  lines.push('helm repo update');
  lines.push('```');

  lines.push('');
  lines.push('#### Install kube-prometheus-stack');
  lines.push('');
  lines.push('```bash');
  lines.push('helm upgrade -i kube-prometheus-stack prometheus-community/kube-prometheus-stack \\');
  lines.push('  -n ${TELEMETRY_NAMESPACE} \\');
  lines.push('  --version ${PROMETHEUS_STACK_VERSION} \\');
  lines.push('  --create-namespace \\');
  lines.push('  --wait');
  lines.push('```');

  lines.push('');
  lines.push('#### Install tempo-distributed');
  lines.push('');
  lines.push('```bash');
  lines.push('helm upgrade -i tempo grafana/tempo-distributed \\');
  lines.push('  -n ${TELEMETRY_NAMESPACE} \\');
  lines.push('  --version ${TEMPO_VERSION} \\');
  lines.push('  --create-namespace \\');
  lines.push('  --wait');
  lines.push('```');

  lines.push('');
  lines.push('#### Install loki');
  lines.push('');
  lines.push('```bash');
  lines.push('helm upgrade -i loki grafana/loki \\');
  lines.push('  -n ${TELEMETRY_NAMESPACE} \\');
  lines.push('  --version ${LOKI_VERSION} \\');
  lines.push('  --create-namespace \\');
  lines.push('  --wait');
  lines.push('```');

  lines.push('');
  lines.push('#### Install alloy');
  lines.push('');
  lines.push('```bash');
  lines.push('helm upgrade -i alloy grafana/alloy \\');
  lines.push('  -n ${TELEMETRY_NAMESPACE} \\');
  lines.push('  --version ${ALLOY_VERSION} \\');
  lines.push('  --create-namespace \\');
  lines.push('  --wait');
  lines.push('```');

  return lines.join('\n');
}

/**
 * Generate documentation for the cert-manager addon.
 * @param {number} subIndex
 * @param {object|null} profileAddonConfig
 * @returns {string}
 */
function _generateCertManager(subIndex, profileAddonConfig) {
  const lines = [];

  lines.push('### Install Certificate Manager');
  lines.push('');
  lines.push('Installs cert-manager for automated TLS certificate management.');

  lines.push('');
  lines.push('#### Install cert-manager');
  lines.push('');
  lines.push('```bash');
  lines.push('helm repo add jetstack https://charts.jetstack.io');
  lines.push('helm repo update');
  lines.push('');
  lines.push('helm upgrade -i cert-manager jetstack/cert-manager \\');
  lines.push('  -n ${CERT_MANAGER_NAMESPACE} \\');
  lines.push('  --version ${CERT_MANAGER_VERSION} \\');
  lines.push('  --create-namespace \\');
  lines.push('  --set installCRDs=true \\');
  lines.push('  --wait');
  lines.push('```');

  lines.push('');
  lines.push('#### Create ClusterIssuers');
  lines.push('');
  lines.push('```bash');
  lines.push("kubectl apply -f - <<'EOF'");
  lines.push('apiVersion: cert-manager.io/v1');
  lines.push('kind: ClusterIssuer');
  lines.push('metadata:');
  lines.push('  name: selfsigned-issuer');
  lines.push('spec:');
  lines.push('  selfSigned: {}');
  lines.push('---');
  lines.push('apiVersion: cert-manager.io/v1');
  lines.push('kind: ClusterIssuer');
  lines.push('metadata:');
  lines.push('  name: selfsigned-ca-issuer');
  lines.push('spec:');
  lines.push('  selfSigned: {}');
  lines.push('EOF');
  lines.push('```');

  return lines.join('\n');
}

/**
 * Generate documentation for the Solo UI addon.
 * @param {number} subIndex
 * @param {object|null} profileAddonConfig
 * @returns {string}
 */
function _generateSoloUI(subIndex, profileAddonConfig) {
  const lines = [];

  lines.push('### Install Solo UI');
  lines.push('');
  lines.push('Installs the Solo UI management console (includes ClickHouse).');

  lines.push('');
  lines.push('#### Install Solo UI CRDs');
  lines.push('');
  lines.push('```bash');
  lines.push('helm upgrade -i solo-ui-crds \\');
  lines.push(
    '  oci://us-docker.pkg.dev/solo-public/solo-enterprise-helm/charts/management-crds \\',
  );
  lines.push('  -n ${SOLO_UI_NAMESPACE} \\');
  lines.push('  --version ${SOLO_UI_VERSION} \\');
  lines.push('  --create-namespace \\');
  lines.push('  --wait --timeout 5m');
  lines.push('```');

  lines.push('');
  lines.push('#### Install Solo UI');
  lines.push('');
  lines.push('```bash');
  lines.push('helm upgrade -i solo-ui \\');
  lines.push('  oci://us-docker.pkg.dev/solo-public/solo-enterprise-helm/charts/management \\');
  lines.push('  -n ${SOLO_UI_NAMESPACE} \\');
  lines.push('  --version ${SOLO_UI_VERSION} \\');
  lines.push('  --create-namespace \\');
  lines.push('  --wait --timeout 5m');
  lines.push('```');

  return lines.join('\n');
}

/**
 * Generate documentation for the Keycloak addon.
 * @param {number} subIndex
 * @param {object|null} profileAddonConfig
 * @returns {Promise<string>}
 */
async function _generateKeycloak(subIndex, profileAddonConfig) {
  const cfg = profileAddonConfig || {};
  const namespace = cfg.keycloakNamespace || 'keycloak';
  const hostname = cfg.hostname || 'localhost';
  const protocol = cfg.protocol || 'https';
  const tlsSecretName = cfg.tls?.secretName || 'keycloak-tls';
  const storageClassName = '';

  // Read template files
  const postgresTemplate = await readFile(
    join(PROJECT_ROOT, 'addons/keycloak/config/postgres.yaml'),
    'utf8',
  );
  const keycloakTemplate = await readFile(
    join(PROJECT_ROOT, 'addons/keycloak/config/keycloak.yaml'),
    'utf8',
  );

  // Render postgres template — use shell var names so unquoted heredoc expands them at apply time
  let postgresRendered = _renderTemplate(postgresTemplate, {
    NAMESPACE: '$KC_NAMESPACE',
    POSTGRES_VERSION: '$POSTGRES_VERSION',
    STORAGE_CLASS_NAME: storageClassName,
  });
  // Remove storageClassName line when empty
  postgresRendered = postgresRendered.replace(/\n\s*storageClassName: ''\n/, '\n');

  // Render keycloak template — use shell var names so unquoted heredoc expands them at apply time
  const keycloakRendered = _renderTemplate(keycloakTemplate, {
    NAMESPACE: '$KC_NAMESPACE',
    HOSTNAME: '$KEYCLOAK_HOST',
    KEYCLOAK_VERSION: '$KEYCLOAK_VERSION',
    TLS_SECRET_NAME: tlsSecretName,
  });

  const lines = [];

  lines.push('### Install Keycloak');
  lines.push('');
  lines.push('Deploys Keycloak identity provider with PostgreSQL backend.');

  lines.push('');
  lines.push('#### Create namespace');
  lines.push('');
  lines.push('```bash');
  lines.push('kubectl create namespace ${KC_NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -');
  lines.push('```');

  lines.push('');
  lines.push('#### Deploy PostgreSQL');
  lines.push('');
  lines.push('```bash');
  lines.push('kubectl apply -f - <<EOF');
  lines.push(postgresRendered.trimEnd());
  lines.push('EOF');
  lines.push('```');

  lines.push('');
  lines.push('#### Wait for PostgreSQL to be ready');
  lines.push('');
  lines.push('```bash');
  lines.push(
    'kubectl rollout status deployment/postgres -n ${KC_NAMESPACE} --timeout=120s',
  );
  lines.push('```');

  lines.push('');
  lines.push('#### Deploy Keycloak');
  lines.push('');
  lines.push('```bash');
  lines.push('kubectl apply -f - <<EOF');
  lines.push(keycloakRendered.trimEnd());
  lines.push('EOF');
  lines.push('```');

  lines.push('');
  lines.push('#### Wait for Keycloak to be ready');
  lines.push('');
  lines.push('```bash');
  lines.push(
    'kubectl rollout status deployment/keycloak -n ${KC_NAMESPACE} --timeout=600s',
  );
  lines.push('```');

  // Admin API configuration
  lines.push('');
  lines.push('#### Configure Keycloak via Admin API');
  lines.push('');
  lines.push('```bash');
  lines.push('# Get admin token');
  lines.push('KEYCLOAK_TOKEN=$(curl -sk -X POST \\');
  lines.push(
    '  "${KEYCLOAK_SCHEME}://${KEYCLOAK_HOST}/realms/master/protocol/openid-connect/token" \\',
  );
  lines.push(
    '  -d "client_id=admin-cli&grant_type=password&username=admin&password=admin" | jq -r \'.access_token\')',
  );

  // Generate realm configurations
  const realms = cfg.realms || [];
  for (const realm of realms) {
    lines.push('');
    if (realm.teams) {
      lines.push(_generateOrgRealmCurls(realm));
    } else {
      lines.push(_generateStandardRealmCurls(realm));
    }
  }

  // Workload clients (K8s secrets)
  const workloadClients = cfg.workloadClients || [];
  if (workloadClients.length > 0) {
    lines.push('');
    lines.push('# Create workload client Kubernetes secrets');
    for (const wc of workloadClients) {
      lines.push('');
      lines.push(`kubectl create secret generic ${wc.k8sSecretName} \\`);
      lines.push(`  -n ${wc.k8sSecretNamespace} \\`);
      lines.push(`  --from-literal=clientId=${wc.clientId} \\`);
      lines.push(`  --from-literal=clientSecret=${wc.clientSecret} \\`);
      lines.push(`  --from-literal=audience=${wc.audience} \\`);
      lines.push('  --dry-run=client -o yaml | kubectl apply -f -');
    }
  }

  // Solo UI clients
  const soloUIClients = cfg.soloUIClients;
  if (soloUIClients?.enabled) {
    const suiRealm = soloUIClients.realm || 'solo-ui';
    lines.push('');
    lines.push(`# Create Solo UI realm: ${suiRealm}`);
    lines.push(`curl -sk -X POST "\${KEYCLOAK_SCHEME}://\${KEYCLOAK_HOST}/admin/realms" \\`);
    lines.push(`  -H "Authorization: Bearer $KEYCLOAK_TOKEN" \\`);
    lines.push(`  -H "Content-Type: application/json" \\`);
    lines.push(`  -d '{"realm":"${suiRealm}","enabled":true}'`);

    // Backend client (confidential)
    if (soloUIClients.backendClientId) {
      const backendPayload = {
        clientId: soloUIClients.backendClientId,
        secret: soloUIClients.backendClientSecret,
        publicClient: false,
        serviceAccountsEnabled: false,
        standardFlowEnabled: true,
      };
      lines.push('');
      lines.push(`# Backend client (confidential): ${soloUIClients.backendClientId}`);
      lines.push(
        `curl -sk -X POST "\${KEYCLOAK_SCHEME}://\${KEYCLOAK_HOST}/admin/realms/${suiRealm}/clients" \\`,
      );
      lines.push(`  -H "Authorization: Bearer $KEYCLOAK_TOKEN" \\`);
      lines.push(`  -H "Content-Type: application/json" \\`);
      lines.push(`  -d '${JSON.stringify(backendPayload)}'`);
    }

    // Frontend client (public)
    if (soloUIClients.frontendClientId) {
      const frontendPayload = {
        clientId: soloUIClients.frontendClientId,
        publicClient: true,
        serviceAccountsEnabled: false,
        standardFlowEnabled: true,
      };
      lines.push('');
      lines.push(`# Frontend client (public): ${soloUIClients.frontendClientId}`);
      lines.push(
        `curl -sk -X POST "\${KEYCLOAK_SCHEME}://\${KEYCLOAK_HOST}/admin/realms/${suiRealm}/clients" \\`,
      );
      lines.push(`  -H "Authorization: Bearer $KEYCLOAK_TOKEN" \\`);
      lines.push(`  -H "Content-Type: application/json" \\`);
      lines.push(`  -d '${JSON.stringify(frontendPayload)}'`);
    }
  }

  lines.push('```');

  return lines.join('\n');
}

export const AddonAdapter = {
  /** Return list of known addon names. */
  knownAddons() {
    return ['telemetry', 'cert-manager', 'solo-ui', 'keycloak'];
  },

  /** Env vars required for an addon. */
  envVarsFor(addonName) {
    const known = new Set(['telemetry', 'cert-manager', 'solo-ui', 'keycloak']);
    if (!known.has(addonName)) return [];
    return [];
  },

  /**
   * Return env export objects for the consolidated env vars section.
   * @param {string} addonName
   * @param {object|null} profileAddonConfig
   * @returns {Array<{key: string, value: string, group: string}>}
   */
  envExportsFor(addonName, profileAddonConfig = null) {
    const cfg = profileAddonConfig || {};
    switch (addonName) {
      case 'telemetry':
        return [
          { key: 'PROMETHEUS_STACK_VERSION', value: '80.4.2', group: 'versions' },
          { key: 'TEMPO_VERSION', value: '1.29.0', group: 'versions' },
          { key: 'LOKI_VERSION', value: '6.6.2', group: 'versions' },
          { key: 'ALLOY_VERSION', value: '0.12.0', group: 'versions' },
          { key: 'TELEMETRY_NAMESPACE', value: 'telemetry', group: 'settings' },
        ];
      case 'cert-manager':
        return [
          { key: 'CERT_MANAGER_VERSION', value: 'v1.19.3', group: 'versions' },
          { key: 'CERT_MANAGER_NAMESPACE', value: 'cert-manager', group: 'settings' },
        ];
      case 'solo-ui':
        return [
          { key: 'SOLO_UI_VERSION', value: '0.3.13', group: 'versions' },
          { key: 'SOLO_UI_NAMESPACE', value: 'agentgateway-system', group: 'settings' },
        ];
      case 'keycloak':
        return [
          { key: 'KEYCLOAK_VERSION', value: KEYCLOAK_VERSION, group: 'versions' },
          { key: 'POSTGRES_VERSION', value: POSTGRES_VERSION, group: 'versions' },
          { key: 'KC_NAMESPACE', value: cfg.keycloakNamespace || 'keycloak', group: 'settings' },
          { key: 'KEYCLOAK_HOST', value: cfg.hostname || '<KEYCLOAK_HOST>', group: 'endpoints' },
          { key: 'KEYCLOAK_SCHEME', value: cfg.protocol || 'https', group: 'endpoints' },
        ];
      default:
        return [];
    }
  },

  /**
   * Generate a markdown section for an addon installation.
   * @param {string} addonName
   * @param {number} subIndex
   * @param {object|null} profileAddonConfig
   * @returns {Promise<string>}
   */
  async generate(addonName, subIndex = 0, profileAddonConfig = null) {
    switch (addonName) {
      case 'telemetry':
        return _generateTelemetry(subIndex, profileAddonConfig);
      case 'cert-manager':
        return _generateCertManager(subIndex, profileAddonConfig);
      case 'solo-ui':
        return _generateSoloUI(subIndex, profileAddonConfig);
      case 'keycloak':
        return _generateKeycloak(subIndex, profileAddonConfig);
      default:
        throw new Error(`Unknown addon: '${addonName}'`);
    }
  },
};
