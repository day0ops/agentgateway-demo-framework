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
});
