import { test, expect, describe } from 'bun:test';
import { AddonAdapter } from '../../src/lib/workshop-adapters/addon.js';

describe('AddonAdapter', () => {
  test('knownAddons() returns array including telemetry, cert-manager, solo-ui, keycloak', () => {
    const names = AddonAdapter.knownAddons();
    expect(names).toContain('telemetry');
    expect(names).toContain('cert-manager');
    expect(names).toContain('solo-ui');
    expect(names).toContain('keycloak');
  });

  test('generate(telemetry) contains grafana helm repo add', () => {
    const section = AddonAdapter.generate('telemetry', 0);
    expect(section).toContain('grafana.github.io/helm-charts');
    expect(section).toContain('kube-prometheus-stack');
  });

  test('generate(telemetry) contains tempo-distributed and loki', () => {
    const section = AddonAdapter.generate('telemetry', 0);
    expect(section).toContain('tempo-distributed');
    expect(section).toContain('loki');
  });

  test('generate(cert-manager) contains jetstack repo and chart', () => {
    const section = AddonAdapter.generate('cert-manager', 0);
    expect(section).toContain('jetstack');
    expect(section).toContain('cert-manager');
    expect(section).toContain('1.19.3');
  });

  test('generate(solo-ui) contains OCI registry and version', () => {
    const section = AddonAdapter.generate('solo-ui', 0);
    expect(section).toContain('us-docker.pkg.dev/solo-public');
    expect(section).toContain('0.3.13');
  });

  test('generate(keycloak) contains manifest-based note', () => {
    const section = AddonAdapter.generate('keycloak', 0);
    expect(section.toLowerCase()).toContain('manifest');
  });

  test('envVarsFor returns empty array for telemetry', () => {
    expect(AddonAdapter.envVarsFor('telemetry')).toEqual([]);
  });

  test('generate throws for unknown addon', () => {
    expect(() => AddonAdapter.generate('nonexistent-addon', 0)).toThrow();
  });
});
