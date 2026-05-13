// test/workshop/install.test.js
import { test, expect, describe } from 'bun:test';
import { InstallAdapter } from '../../src/lib/workshop-adapters/install.js';

describe('InstallAdapter', () => {
  test('envVars() returns ENTERPRISE_AGW_LICENSE_KEY as required', () => {
    const vars = InstallAdapter.envVars();
    const licenseVar = vars.find(v => v.name === 'ENTERPRISE_AGW_LICENSE_KEY');
    expect(licenseVar).toBeDefined();
    expect(licenseVar.required).toBe(true);
  });

  test('generate() returns string containing Lab 0 heading', async () => {
    const section = await InstallAdapter.generate({ addons: [], labNum: 0 });
    expect(section).toContain('## Lab 0: Installation');
  });

  test('generate() contains helm upgrade command for agentgateway', async () => {
    const section = await InstallAdapter.generate({ addons: [], labNum: 0 });
    expect(section).toContain('helm upgrade');
    expect(section).toContain('enterprise-agentgateway');
    expect(section).toContain('ENTERPRISE_AGW_LICENSE_KEY');
  });

  test('generate() contains Gateway API CRD install URL with version', async () => {
    const section = await InstallAdapter.generate({ addons: [], labNum: 0 });
    expect(section).toContain('gateway-api/releases/download');
    expect(section).toContain('standard-install.yaml');
  });

  test('generate() contains agentgateway CRDs helm install', async () => {
    const section = await InstallAdapter.generate({ addons: [], labNum: 0 });
    expect(section).toContain('enterprise-agentgateway-crds');
    expect(section).toContain('us-docker.pkg.dev/solo-public');
  });

  test('generate() does not include addon sections when addons is empty', async () => {
    const section = await InstallAdapter.generate({ addons: [], labNum: 0 });
    expect(section).not.toContain('### Install Telemetry');
    expect(section).not.toContain('### Install cert-manager');
  });

  test('generate() without profile uses default versions', async () => {
    const section = await InstallAdapter.generate({ labNum: 0 });
    expect(section).toContain('## Lab 0: Installation');
    expect(section).toContain('standard-install.yaml');
    expect(section).toContain('enterprise-agentgateway-crds');
  });

  test('generate() with profile uses profile versions', async () => {
    const profileData = {
      agentgateway: { version: '9.9.9', ociRegistry: 'oci://custom.registry/charts' },
      gatewayApi: { version: 'v9.0.0' },
    };
    const section = await InstallAdapter.generate({ labNum: 0, profileData });
    expect(section).toContain('9.9.9');
    expect(section).toContain('custom.registry');
    expect(section).toContain('v9.0.0');
  });

  test('generate() with experimental channel uses experimental-install.yaml', async () => {
    const profileData = { gatewayApi: { version: 'v1.5.0', channel: 'experimental' } };
    const section = await InstallAdapter.generate({ labNum: 0, profileData });
    expect(section).toContain('experimental-install.yaml');
    expect(section).not.toContain('standard-install.yaml');
  });

  test('generate() with helmValues renders heredoc <<EOF format', async () => {
    const profileData = {
      helmValues: { controller: { extraEnv: { FOO: 'bar' } } },
    };
    const section = await InstallAdapter.generate({ labNum: 0, profileData });
    expect(section).toContain("<<'EOF'");
    expect(section).toContain('FOO');
    expect(section).not.toContain('values.yaml');
  });

  test('generate() with helmValues puts --set licenseKey before --values heredoc', async () => {
    const profileData = {
      helmValues: { controller: { extraEnv: { FOO: 'bar' } } },
    };
    const section = await InstallAdapter.generate({ labNum: 0, profileData });
    const licensePos = section.indexOf('$ENTERPRISE_AGW_LICENSE_KEY');
    const heredocPos = section.indexOf("--values - <<'EOF'");
    expect(licensePos).toBeGreaterThan(-1);
    expect(heredocPos).toBeGreaterThan(-1);
    expect(licensePos).toBeLessThan(heredocPos);
  });

  test('generate() without helmValues has no heredoc and includes --wait', async () => {
    const section = await InstallAdapter.generate({ labNum: 0 });
    expect(section).not.toContain("<<'EOF'");
    expect(section).toContain('--wait --timeout 5m');
  });

  test('generate() with resources renders apply section', async () => {
    const profileData = {
      resources: ['agentgateway-with-keycloak/enterprise-agentgateway-sharedext-params.yaml'],
    };
    const section = await InstallAdapter.generate({ labNum: 0, profileData });
    expect(section).toContain('Apply Additional Resources');
    expect(section).toContain("kubectl apply -f - <<'EOF'");
    expect(section).toContain('EnterpriseAgentgatewayParameters');
  });

  test('generate() with missing resource outputs comment fallback', async () => {
    const profileData = {
      resources: ['nonexistent-profile/does-not-exist.yaml'],
    };
    const section = await InstallAdapter.generate({ labNum: 0, profileData });
    expect(section).toContain('# (resource not found: config/profiles/nonexistent-profile/does-not-exist.yaml)');
  });

  test('generate() sets env vars block with AGW_VERSION', async () => {
    const section = await InstallAdapter.generate({ labNum: 0 });
    expect(section).toContain('### Set environment variables');
    expect(section).toContain('export AGW_VERSION=');
    expect(section).toContain('export AGW_OCI_REGISTRY=');
    expect(section).toContain('export GATEWAY_API_VERSION=');
    expect(section).toContain('export AGW_NAMESPACE="agentgateway-system"');
    expect(section).toContain('export AGW_RELEASE="enterprise-agentgateway"');
    expect(section).toContain('export AGW_CRDS_RELEASE="enterprise-agentgateway-crds"');
  });

  test('generate() uses $VARNAME in helm commands', async () => {
    const section = await InstallAdapter.generate({ labNum: 0 });
    expect(section).toContain('${AGW_NAMESPACE}');
    expect(section).toContain('${AGW_VERSION}');
    expect(section).toContain('${AGW_OCI_REGISTRY}');
    expect(section).toContain('${GATEWAY_API_VERSION}');
    expect(section).toContain('${AGW_RELEASE}');
    expect(section).toContain('${AGW_CRDS_RELEASE}');
  });

  test('generate() always includes license key set flag', async () => {
    const section = await InstallAdapter.generate({ labNum: 0 });
    expect(section).toContain('$ENTERPRISE_AGW_LICENSE_KEY');
  });

  test('versions() without profile returns defaults', () => {
    const v = InstallAdapter.versions();
    expect(v.agwVersion).toBeTruthy();
    expect(v.gatewayApiVersion).toBeTruthy();
    expect(v.agwOci).toContain('oci://');
  });

  test('versions() with profileData returns overridden values', () => {
    const profileData = {
      agentgateway: { version: '3.0.0', ociRegistry: 'oci://my-registry/charts' },
      gatewayApi: { version: 'v2.0.0' },
    };
    const v = InstallAdapter.versions(profileData);
    expect(v.agwVersion).toBe('3.0.0');
    expect(v.agwOci).toBe('oci://my-registry/charts');
    expect(v.gatewayApiVersion).toBe('v2.0.0');
  });
});
