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

  test('renderEnvVarsTable deduplicates by name', async () => {
    const builder = new WorkshopBuilder({ title: 'T', addons: [], providers: [], labs: [] });
    const table = builder._renderEnvVarsTable([
      { name: 'FOO', required: true, description: 'first' },
      { name: 'FOO', required: true, description: 'duplicate' },
      { name: 'BAR', required: false, description: 'bar' },
    ]);
    const matches = table.match(/FOO/g);
    expect(matches.length).toBe(1);
    expect(table).toContain('BAR');
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
});
