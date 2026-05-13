import { test, expect, describe } from 'bun:test';
import { AddonAdapter } from '../../src/lib/workshop-adapters/addon.js';

const KEYCLOAK_PROFILE_CONFIG = {
  keycloakNamespace: 'keycloak',
  hostname: 'keycloak.demo.kasunt.apac.fe.solo.io',
  protocol: 'https',
  tls: {
    enabled: true,
    secretName: 'keycloak-tls',
    createCertificate: true,
  },
  realms: [
    {
      realm: 'agw-dev',
      defaultPassword: 'Password1!',
      clients: [
        {
          clientId: 'agw-client',
          type: 'confidential',
          clientSecret: 'agw-client-secret',
          flows: ['authorization-code', 'service-account'],
        },
        { clientId: 'agw-client-public', type: 'public', flows: ['authorization-code'] },
      ],
      customAttributes: ['org_id', 'team_id', 'group', 'is_org'],
      users: [
        {
          username: 'user1',
          firstName: 'Alpha',
          lastName: 'User',
          email: 'user1@acme.demo',
          attributes: { org_id: 'acme-corp', team_id: 'team-alpha', group: 'users' },
        },
      ],
    },
    {
      realm: 'org-acme',
      orgId: 'acme',
      defaultPassword: 'Password1!',
      teams: [
        {
          teamId: 'team-eng',
          clientId: 'acme-team-eng',
          clientSecret: 'acme-team-eng-secret',
          users: [
            {
              username: 'acme-eng-user1',
              firstName: 'Acme Eng',
              lastName: 'User',
              email: 'acme-eng-user1@org-acme.demo',
              attributes: { org_id: 'acme', team_id: 'team-eng' },
            },
          ],
        },
      ],
    },
  ],
  workloadClients: [
    {
      clientId: 'caller-agent',
      clientSecret: 'caller-agent-secret',
      audience: 'agentgateway',
      k8sSecretName: 'caller-agent-credentials',
      k8sSecretNamespace: 'agentgateway-system',
    },
  ],
  soloUIClients: {
    enabled: true,
    realm: 'solo-ui',
    hostname: 'http://soloui.demo.kasunt.apac.fe.solo.io',
    backendClientId: 'solo-ui-backend',
    backendClientSecret: 'solo-ui-backend-secret',
    frontendClientId: 'solo-ui-frontend',
  },
};

describe('AddonAdapter', () => {
  test('knownAddons() returns array including telemetry, cert-manager, solo-ui, keycloak', () => {
    const names = AddonAdapter.knownAddons();
    expect(names).toContain('telemetry');
    expect(names).toContain('cert-manager');
    expect(names).toContain('solo-ui');
    expect(names).toContain('keycloak');
  });

  test('generate(telemetry) contains grafana helm repo add', async () => {
    const section = await AddonAdapter.generate('telemetry', 0);
    expect(section).toContain('grafana.github.io/helm-charts');
    expect(section).toContain('kube-prometheus-stack');
  });

  test('generate(telemetry) contains tempo-distributed and loki', async () => {
    const section = await AddonAdapter.generate('telemetry', 0);
    expect(section).toContain('tempo-distributed');
    expect(section).toContain('loki');
  });

  test('generate(cert-manager) contains jetstack repo and chart', async () => {
    const section = await AddonAdapter.generate('cert-manager', 0);
    expect(section).toContain('jetstack');
    expect(section).toContain('cert-manager');
    expect(section).toContain('${CERT_MANAGER_VERSION}');
  });

  test('generate(solo-ui) contains OCI registry and version var', async () => {
    const section = await AddonAdapter.generate('solo-ui', 0);
    expect(section).toContain('us-docker.pkg.dev/solo-public');
    expect(section).toContain('${SOLO_UI_VERSION}');
  });

  test('generate(keycloak) without profileAddonConfig contains kubectl apply', async () => {
    const section = await AddonAdapter.generate('keycloak', 0);
    expect(section).toContain('kubectl apply');
  });

  test('generate(keycloak) without profileAddonConfig contains keycloak version shell var', async () => {
    const section = await AddonAdapter.generate('keycloak', 0);
    expect(section).toContain('$KEYCLOAK_VERSION');
  });

  test('generate(keycloak) without profileAddonConfig contains postgres deployment', async () => {
    const section = await AddonAdapter.generate('keycloak', 0);
    expect(section).toContain('postgres');
    expect(section).toContain('$POSTGRES_VERSION');
  });

  test('generate(keycloak) with profileAddonConfig.realms generates realm create curl commands', async () => {
    const section = await AddonAdapter.generate('keycloak', 0, KEYCLOAK_PROFILE_CONFIG);
    expect(section).toContain('admin/realms');
    expect(section).toContain('agw-dev');
  });

  test('generate(keycloak) with profileAddonConfig.realms generates client curl commands', async () => {
    const section = await AddonAdapter.generate('keycloak', 0, KEYCLOAK_PROFILE_CONFIG);
    expect(section).toContain('admin/realms/agw-dev/clients');
    expect(section).toContain('agw-client');
  });

  test('generate(keycloak) with profileAddonConfig.realms generates user curl commands', async () => {
    const section = await AddonAdapter.generate('keycloak', 0, KEYCLOAK_PROFILE_CONFIG);
    expect(section).toContain('admin/realms/agw-dev/users');
    expect(section).toContain('user1');
  });

  test('generate(keycloak) with profileAddonConfig.realms generates org realm', async () => {
    const section = await AddonAdapter.generate('keycloak', 0, KEYCLOAK_PROFILE_CONFIG);
    expect(section).toContain('org-acme');
    expect(section).toContain('acme-team-eng');
  });

  test('generate(keycloak) with workloadClients generates kubectl create secret', async () => {
    const section = await AddonAdapter.generate('keycloak', 0, KEYCLOAK_PROFILE_CONFIG);
    expect(section).toContain('kubectl create secret generic caller-agent-credentials');
    expect(section).toContain('--from-literal=clientId=caller-agent');
    expect(section).toContain('--from-literal=clientSecret=caller-agent-secret');
  });

  test('generate(keycloak) with soloUIClients generates solo-ui realm and clients', async () => {
    const section = await AddonAdapter.generate('keycloak', 0, KEYCLOAK_PROFILE_CONFIG);
    expect(section).toContain('solo-ui');
    expect(section).toContain('solo-ui-backend');
    expect(section).toContain('solo-ui-frontend');
  });

  test('generate(keycloak) does not reference config/profiles file paths', async () => {
    const section = await AddonAdapter.generate('keycloak', 0, KEYCLOAK_PROFILE_CONFIG);
    expect(section).not.toContain('config/profiles');
    expect(section).not.toContain('agw base addon install');
    expect(section).not.toContain('kubectl apply -f config/');
  });

  test('generate(keycloak) uses unquoted heredoc for manifest deployment', async () => {
    const section = await AddonAdapter.generate('keycloak', 0, KEYCLOAK_PROFILE_CONFIG);
    expect(section).toContain('kubectl apply -f - <<EOF');
    expect(section).not.toContain("kubectl apply -f - <<'EOF'");
    expect(section).toContain('EOF');
  });

  test('generate(keycloak) substitutes namespace placeholder with shell var', async () => {
    const section = await AddonAdapter.generate('keycloak', 0, KEYCLOAK_PROFILE_CONFIG);
    expect(section).toContain("namespace: '$KC_NAMESPACE'");
    expect(section).not.toContain('{{NAMESPACE}}');
  });

  test('generate(keycloak) substitutes hostname placeholder with shell var', async () => {
    const section = await AddonAdapter.generate('keycloak', 0, KEYCLOAK_PROFILE_CONFIG);
    expect(section).toContain("'$KEYCLOAK_HOST'");
    expect(section).not.toContain('{{HOSTNAME}}');
  });

  test('generate(keycloak) substitutes TLS secret name in manifests', async () => {
    const section = await AddonAdapter.generate('keycloak', 0, KEYCLOAK_PROFILE_CONFIG);
    expect(section).toContain('keycloak-tls');
    expect(section).not.toContain('{{TLS_SECRET_NAME}}');
  });

  test('generate(keycloak) gets admin token via curl', async () => {
    const section = await AddonAdapter.generate('keycloak', 0, KEYCLOAK_PROFILE_CONFIG);
    expect(section).toContain('realms/master/protocol/openid-connect/token');
    expect(section).toContain('KEYCLOAK_TOKEN');
  });

  test('envVarsFor returns empty array for telemetry', () => {
    expect(AddonAdapter.envVarsFor('telemetry')).toEqual([]);
  });

  test('generate throws for unknown addon', async () => {
    await expect(AddonAdapter.generate('nonexistent-addon', 0)).rejects.toThrow();
  });

  test('envExportsFor(telemetry) returns expected keys with groups', () => {
    const exports = AddonAdapter.envExportsFor('telemetry');
    const keys = exports.map(e => e.key);
    expect(keys).toContain('PROMETHEUS_STACK_VERSION');
    expect(keys).toContain('TEMPO_VERSION');
    expect(keys).toContain('LOKI_VERSION');
    expect(keys).toContain('ALLOY_VERSION');
    expect(keys).toContain('TELEMETRY_NAMESPACE');
    expect(exports.find(e => e.key === 'PROMETHEUS_STACK_VERSION').group).toBe('versions');
    expect(exports.find(e => e.key === 'TELEMETRY_NAMESPACE').group).toBe('settings');
  });

  test('envExportsFor(cert-manager) returns CERT_MANAGER_VERSION and CERT_MANAGER_NAMESPACE', () => {
    const exports = AddonAdapter.envExportsFor('cert-manager');
    const keys = exports.map(e => e.key);
    expect(keys).toContain('CERT_MANAGER_VERSION');
    expect(keys).toContain('CERT_MANAGER_NAMESPACE');
    expect(exports.find(e => e.key === 'CERT_MANAGER_VERSION').value).toBe('v1.19.3');
    expect(exports.find(e => e.key === 'CERT_MANAGER_NAMESPACE').value).toBe('cert-manager');
  });

  test('envExportsFor(solo-ui) returns SOLO_UI_VERSION and SOLO_UI_NAMESPACE', () => {
    const exports = AddonAdapter.envExportsFor('solo-ui');
    const keys = exports.map(e => e.key);
    expect(keys).toContain('SOLO_UI_VERSION');
    expect(keys).toContain('SOLO_UI_NAMESPACE');
    expect(exports.find(e => e.key === 'SOLO_UI_VERSION').value).toBe('0.3.13');
  });

  test('envExportsFor(keycloak) returns version, namespace, host, and scheme entries', () => {
    const exports = AddonAdapter.envExportsFor('keycloak', {
      keycloakNamespace: 'my-kc',
      hostname: 'kc.example.com',
      protocol: 'https',
    });
    const keys = exports.map(e => e.key);
    expect(keys).toContain('KEYCLOAK_VERSION');
    expect(keys).toContain('POSTGRES_VERSION');
    expect(keys).toContain('KC_NAMESPACE');
    expect(keys).toContain('KEYCLOAK_HOST');
    expect(keys).toContain('KEYCLOAK_SCHEME');
    expect(exports.find(e => e.key === 'KC_NAMESPACE').value).toBe('my-kc');
    expect(exports.find(e => e.key === 'KEYCLOAK_HOST').value).toBe('kc.example.com');
    expect(exports.find(e => e.key === 'KEYCLOAK_HOST').group).toBe('endpoints');
  });

  test('envExportsFor(keycloak) without config uses defaults', () => {
    const exports = AddonAdapter.envExportsFor('keycloak');
    expect(exports.find(e => e.key === 'KC_NAMESPACE').value).toBe('keycloak');
    expect(exports.find(e => e.key === 'KEYCLOAK_HOST').value).toBe('<KEYCLOAK_HOST>');
    expect(exports.find(e => e.key === 'KEYCLOAK_SCHEME').value).toBe('https');
  });

  test('envExportsFor(unknown) returns empty array', () => {
    expect(AddonAdapter.envExportsFor('nonexistent-addon')).toEqual([]);
  });
});
