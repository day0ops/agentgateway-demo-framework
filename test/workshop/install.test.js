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

  test('generate() returns string containing Lab 0 heading', () => {
    const section = InstallAdapter.generate({ addons: [], labNum: 0 });
    expect(section).toContain('## Lab 0: Installation');
  });

  test('generate() contains helm upgrade command for agentgateway', () => {
    const section = InstallAdapter.generate({ addons: [], labNum: 0 });
    expect(section).toContain('helm upgrade');
    expect(section).toContain('enterprise-agentgateway');
    expect(section).toContain('ENTERPRISE_AGW_LICENSE_KEY');
  });

  test('generate() contains Gateway API CRD install URL with version', () => {
    const section = InstallAdapter.generate({ addons: [], labNum: 0 });
    expect(section).toContain('gateway-api/releases/download');
    expect(section).toContain('standard-install.yaml');
  });

  test('generate() contains agentgateway CRDs helm install', () => {
    const section = InstallAdapter.generate({ addons: [], labNum: 0 });
    expect(section).toContain('enterprise-agentgateway-crds');
    expect(section).toContain('us-docker.pkg.dev/solo-public');
  });

  test('generate() does not include addon sections when addons is empty', () => {
    const section = InstallAdapter.generate({ addons: [], labNum: 0 });
    expect(section).not.toContain('### Install Telemetry');
    expect(section).not.toContain('### Install cert-manager');
  });

  test('generate() without profile uses default versions', () => {
    const section = InstallAdapter.generate({ labNum: 0 });
    expect(section).toContain('## Lab 0: Installation');
    expect(section).toContain('standard-install.yaml');
    expect(section).toContain('enterprise-agentgateway-crds');
  });

  test('generate() with profile uses profile versions', () => {
    const profileData = {
      agentgateway: { version: '9.9.9', ociRegistry: 'oci://custom.registry/charts' },
      gatewayApi: { version: 'v9.0.0' },
    };
    const section = InstallAdapter.generate({ labNum: 0, profileData });
    expect(section).toContain('9.9.9');
    expect(section).toContain('custom.registry');
    expect(section).toContain('v9.0.0');
  });

  test('generate() with experimental channel uses experimental-install.yaml', () => {
    const profileData = { gatewayApi: { version: 'v1.5.0', channel: 'experimental' } };
    const section = InstallAdapter.generate({ labNum: 0, profileData });
    expect(section).toContain('experimental-install.yaml');
    expect(section).not.toContain('standard-install.yaml');
  });

  test('generate() with helmValues renders values.yaml block', () => {
    const profileData = {
      helmValues: { controller: { extraEnv: { FOO: 'bar' } } },
    };
    const section = InstallAdapter.generate({ labNum: 0, profileData });
    expect(section).toContain('values.yaml');
    expect(section).toContain('```yaml');
    expect(section).toContain('FOO');
  });

  test('generate() with resources renders apply section', () => {
    const profileData = {
      resources: ['my-profile/gateway.yaml', 'my-profile/params.yaml'],
    };
    const section = InstallAdapter.generate({ labNum: 0, profileData });
    expect(section).toContain('Apply Additional Resources');
    expect(section).toContain('gateway.yaml');
    expect(section).toContain('params.yaml');
  });

  test('generate() always includes license key set flag', () => {
    const section = InstallAdapter.generate({ labNum: 0 });
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
