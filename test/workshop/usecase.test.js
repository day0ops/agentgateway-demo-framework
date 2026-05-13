// test/workshop/usecase.test.js
import { test, expect, describe } from 'bun:test';
import { UseCaseAdapter } from '../../src/lib/workshop-adapters/usecase.js';

describe('UseCaseAdapter', () => {
  test('generate(apikey-auth) returns Lab N heading', async () => {
    const section = await UseCaseAdapter.generate({ name: 'apikey-auth', labNum: 2, deployedProviders: ['openai'] });
    expect(section).toContain('## Lab 2:');
  });

  test('generate(apikey-auth) contains sequence diagram fenced block', async () => {
    const section = await UseCaseAdapter.generate({ name: 'apikey-auth', labNum: 2, deployedProviders: ['openai'] });
    expect(section).toContain('```mermaid');
    expect(section).toContain('sequenceDiagram');
  });

  test('generate(apikey-auth) skips providers step and adds note', async () => {
    const section = await UseCaseAdapter.generate({ name: 'apikey-auth', labNum: 2, deployedProviders: ['openai'] });
    // Should NOT show a full providers deploy block
    // Should contain a reference back to providers lab
    expect(section.toLowerCase()).toContain('providers');
    expect(section).toContain('Lab 1');
  });

  test('generate(apikey-auth) contains step headings', async () => {
    const section = await UseCaseAdapter.generate({ name: 'apikey-auth', labNum: 2, deployedProviders: ['openai'] });
    expect(section).toContain('### Step');
  });

  test('generate(apikey-auth) contains yaml blocks from dryRun or sidecar', async () => {
    const section = await UseCaseAdapter.generate({ name: 'apikey-auth', labNum: 2, deployedProviders: ['openai'] });
    expect(section).toContain('```yaml');
  });

  test('generate throws for unknown use case', async () => {
    await expect(
      UseCaseAdapter.generate({ name: 'nonexistent-use-case', labNum: 2, deployedProviders: [] })
    ).rejects.toThrow();
  });
});
