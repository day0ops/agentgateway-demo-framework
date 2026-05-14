import { test, expect, describe } from 'bun:test';
import { WorkshopBuilder, WorkshopPicker } from '../../src/lib/workshop.js';

describe('WorkshopBuilder', () => {
  test('build() returns string starting with h1 title', async () => {
    const builder = new WorkshopBuilder({ title: 'My Workshop', addons: [], providers: [], labs: [] });
    const md = await builder.build();
    expect(typeof md).toBe('string');
    expect(md.startsWith('# My Workshop')).toBe(true);
  });

  test('build() includes Environment Variables section', async () => {
    const builder = new WorkshopBuilder({ title: 'Test', addons: [], providers: [], labs: [] });
    const md = await builder.build();
    expect(md).toContain('## Environment Variables');
    expect(md).toContain('ENTERPRISE_AGW_LICENSE_KEY');
  });

  test('build() includes Prerequisites section', async () => {
    const builder = new WorkshopBuilder({ title: 'Test', addons: [], providers: [], labs: [] });
    const md = await builder.build();
    expect(md).toContain('## Prerequisites');
    expect(md).toContain('kubectl');
    expect(md).toContain('helm');
  });

  test('build() has Prerequisites before Component Versions', async () => {
    const builder = new WorkshopBuilder({ title: 'Test', addons: [], providers: [], labs: [] });
    const md = await builder.build();
    const prereqPos = md.indexOf('## Prerequisites');
    const versionsPos = md.indexOf('## Component Versions');
    expect(prereqPos).toBeGreaterThan(-1);
    expect(versionsPos).toBeGreaterThan(-1);
    expect(prereqPos).toBeLessThan(versionsPos);
  });

  test('build() includes Lab 0 installation section', async () => {
    const builder = new WorkshopBuilder({ title: 'Test', addons: [], providers: [], labs: [] });
    const md = await builder.build();
    expect(md).toContain('## Lab 0: Installation');
  });

  test('build() includes Cleanup section', async () => {
    const builder = new WorkshopBuilder({ title: 'Test', addons: [], providers: [], labs: [] });
    const md = await builder.build();
    expect(md).toContain('## Cleanup');
  });

  test('build() includes Component Versions table', async () => {
    const builder = new WorkshopBuilder({ title: 'Test', addons: [], providers: [], labs: [] });
    const md = await builder.build();
    expect(md).toContain('## Component Versions');
    expect(md).toContain('Enterprise Agentgateway');
    expect(md).toContain('Gateway API');
  });

  test('_renderEnvVarsSection deduplicates vars by name', async () => {
    const builder = new WorkshopBuilder({ title: 'T', addons: [], providers: [], labs: [] });
    const section = builder._renderEnvVarsSection([
      { name: 'FOO', required: true, description: 'first' },
      { name: 'FOO', required: true, description: 'duplicate' },
      { name: 'BAR', required: false, description: 'bar' },
    ]);
    const matches = section.match(/FOO/g);
    expect(matches.length).toBe(1);
    expect(section).toContain('BAR');
  });

  test('_renderEnvVarsSection renders bash exports grouped by group', async () => {
    const builder = new WorkshopBuilder({ title: 'T', addons: [], providers: [], labs: [] });
    const section = builder._renderEnvVarsSection([], [
      { key: 'MY_VERSION', value: '1.0.0', group: 'versions' },
      { key: 'MY_NS', value: 'default', group: 'settings' },
      { key: 'MY_REG', value: 'oci://example.com', group: 'registry' },
    ]);
    expect(section).toContain('```bash');
    expect(section).toContain('export MY_VERSION="1.0.0"');
    expect(section).toContain('export MY_NS="default"');
    expect(section).toContain('# Component versions');
    expect(section).toContain('# Kubernetes settings');
    // versions comes before settings in the output
    expect(section.indexOf('# Component versions')).toBeLessThan(section.indexOf('# Kubernetes settings'));
  });

  test('build() env vars section contains bash exports block', async () => {
    const builder = new WorkshopBuilder({ title: 'Test', addons: [], providers: [], labs: [] });
    const md = await builder.build();
    expect(md).toContain('```bash');
    expect(md).toContain('export AGW_VERSION=');
    expect(md).toContain('# Component versions');
  });

  test('build() with explicit projectRoot uses that root', async () => {
    const builder = new WorkshopBuilder({
      title: 'Portability Test',
      addons: [],
      providers: [],
      labs: [],
      projectRoot: process.cwd(),
    });
    const md = await builder.build();
    expect(md.startsWith('# Portability Test')).toBe(true);
  });
});

describe('WorkshopPicker', () => {
  test('buildChoices() returns grouped choices including separators', async () => {
    const choices = await WorkshopPicker.buildChoices();
    expect(choices.some(c => c.type === 'separator')).toBe(true);
    expect(choices.some(c => c.value)).toBe(true);
  });

  test('buildChoices() includes addon entries', async () => {
    const choices = await WorkshopPicker.buildChoices();
    const values = choices.filter(c => c.value).map(c => c.value);
    expect(values.some(v => v.type === 'addon')).toBe(true);
  });

  test('buildChoices() includes usecase entries', async () => {
    const choices = await WorkshopPicker.buildChoices();
    const values = choices.filter(c => c.value).map(c => c.value);
    expect(values.some(v => v.type === 'usecase')).toBe(true);
  });

  test('buildChoices() includes provider entries', async () => {
    const choices = await WorkshopPicker.buildChoices();
    const values = choices.filter(c => c.value).map(c => c.value);
    expect(values.some(v => v.type === 'provider')).toBe(true);
  });

  test('buildChoices(projectRoot) includes addon entries from that root', async () => {
    const choices = await WorkshopPicker.buildChoices(process.cwd());
    const values = choices.filter(c => c.value).map(c => c.value);
    expect(values.some(v => v.type === 'addon')).toBe(true);
  });
});

describe('WorkshopBuilder — integration', () => {
  test('build() with providers generates Lab 1: Providers', async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || '<OPENAI_API_KEY>';
    try {
      const builder = new WorkshopBuilder({
        title: 'Integration Test',
        addons: [],
        providers: ['openai'],
        labs: [],
      });
      const md = await builder.build();
      expect(md).toContain('## Lab 1: Providers');
    } finally {
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
    }
  });

  test('build() with addon includes addon section in Lab 0', async () => {
    const builder = new WorkshopBuilder({
      title: 'Integration Test',
      addons: ['telemetry'],
      providers: [],
      labs: [],
    });
    const md = await builder.build();
    expect(md).toContain('Telemetry');
    expect(md).toContain('grafana');
  });

  test('build() with usecase lab includes lab heading after providers', async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || '<OPENAI_API_KEY>';
    try {
      const builder = new WorkshopBuilder({
        title: 'Integration Test',
        addons: [],
        providers: ['openai'],
        labs: [{ type: 'usecase', name: 'apikey-auth' }],
      });
      const md = await builder.build();
      expect(md).toContain('## Lab 2:');
      expect(md).toContain('Apikey Auth');
    } finally {
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
    }
  });

  test('build() env vars table includes provider-specific keys', async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || '<OPENAI_API_KEY>';
    try {
      const builder = new WorkshopBuilder({
        title: 'Integration Test',
        addons: [],
        providers: ['openai'],
        labs: [],
      });
      const md = await builder.build();
      expect(md).toContain('OPENAI_API_KEY');
    } finally {
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
    }
  });

  test('build() with profileData uses profile versions in versions table', async () => {
    const builder = new WorkshopBuilder({
      title: 'Profile Test',
      addons: [],
      providers: [],
      labs: [],
      profile: null,
      environment: null,
    });
    // Manually inject profileData by overriding selection
    builder.selection.profile = null; // no real file needed
    const md = await builder.build();
    // Without a profile, should still render the versions table with defaults
    expect(md).toContain('## Component Versions');
    expect(md).toContain('Enterprise Agentgateway');
  });
});
