import { InstallAdapter } from './workshop-adapters/install.js';
import { AddonAdapter } from './workshop-adapters/addon.js';
import { ProviderAdapter } from './workshop-adapters/provider.js';
import { UseCaseAdapter } from './workshop-adapters/usecase.js';
import { FeatureAdapter } from './workshop-adapters/feature.js';
import { UseCaseManager } from './usecase.js';
import inquirer from 'inquirer';
import { Prompts } from './prompts.js';

/**
 * WorkshopBuilder
 *
 * Assembles a single workshop.md from a WorkshopSelection.
 * Adapters (Install, Addon, Provider, UseCase, Feature) each return markdown
 * for their section. Env vars are collected from all adapters and rendered
 * as a deduped table at the top.
 *
 * @typedef {Object} WorkshopSelection
 * @property {string} title
 * @property {string[]} addons
 * @property {string[]} providers
 * @property {Array<{type:'usecase'|'feature', name:string}>} labs
 */
export class WorkshopBuilder {
  constructor(selection) {
    this.selection = selection;
  }

  /**
   * Build the full workshop markdown document.
   * @returns {Promise<string>}
   */
  async build() {
    const { title = 'Agentgateway Workshop', addons = [], providers = [], labs = [] } = this.selection;

    const envVarMap = new Map(); // name → {name, required, description}
    const labSections = [];
    let labNum = 0;

    // ── Lab 0: Installation ─────────────────────────────────────────────────
    InstallAdapter.envVars().forEach(v => envVarMap.set(v.name, v));
    for (const addonName of addons) {
      AddonAdapter.envVarsFor(addonName).forEach(v => envVarMap.set(v.name, v));
    }

    const installLines = [InstallAdapter.generate({ addons, labNum })];
    for (const addonName of addons) {
      installLines.push('');
      installLines.push(AddonAdapter.generate(addonName, labNum));
    }
    labSections.push(installLines.join('\n'));
    labNum++;

    // ── Lab 1: Providers ────────────────────────────────────────────────────
    if (providers.length > 0) {
      ProviderAdapter.envVarsFor(providers).forEach(v => envVarMap.set(v.name, v));
      labSections.push(await ProviderAdapter.generate(providers, labNum));
      labNum++;
    }

    // ── Labs N: use cases + standalone features ─────────────────────────────
    for (const lab of labs) {
      if (lab.type === 'usecase') {
        labSections.push(
          await UseCaseAdapter.generate({ name: lab.name, labNum, deployedProviders: providers })
        );
      } else if (lab.type === 'feature') {
        labSections.push(await FeatureAdapter.generate({ name: lab.name, labNum }));
      }
      labNum++;
    }

    // ── Assemble ────────────────────────────────────────────────────────────
    const allEnvVars = [...envVarMap.values()];
    const parts = [
      `# ${title}\n`,
      this._renderEnvVarsTable(allEnvVars),
      this._renderPrerequisites(),
      ...labSections,
      this._renderCleanup(),
    ];

    return parts.join('\n\n---\n\n');
  }

  /**
   * Render env vars as a markdown table, deduplicating by name.
   * Required-first, then optional.
   * @param {Array<{name:string, required:boolean|string, description:string}>} vars
   * @returns {string}
   */
  _renderEnvVarsTable(vars) {
    const seen = new Set();
    const deduped = vars.filter(v => {
      if (seen.has(v.name)) return false;
      seen.add(v.name);
      return true;
    });

    deduped.sort((a, b) => {
      const aReq = a.required === true || a.required === 'true';
      const bReq = b.required === true || b.required === 'true';
      if (aReq && !bReq) return -1;
      if (!aReq && bReq) return 1;
      return a.name.localeCompare(b.name);
    });

    const rows = deduped.map(v => {
      const req = v.required === true ? '✅ Required' : v.required || 'Optional';
      return `| \`${v.name}\` | ${req} | ${v.description} |`;
    });

    return [
      '## Environment Variables',
      '',
      'Set these before running any lab commands:',
      '',
      '| Variable | Required | Description |',
      '|----------|----------|-------------|',
      ...rows,
    ].join('\n');
  }

  _renderPrerequisites() {
    return [
      '## Prerequisites',
      '',
      'Ensure the following tools are installed and on your PATH:',
      '',
      '| Tool | Purpose |',
      '|------|---------|',
      '| `kubectl` | Kubernetes CLI |',
      '| `helm` | Kubernetes package manager |',
      '| `curl` | HTTP testing |',
      '| `jq` | JSON processing |',
      '',
      'A running Kubernetes cluster with the current context pointing to it is assumed.',
    ].join('\n');
  }

  _renderCleanup() {
    return [
      '## Cleanup',
      '',
      'To remove all resources created in this workshop:',
      '',
      '```bash',
      '# Remove agentgateway',
      'helm uninstall enterprise-agentgateway -n agentgateway-system',
      'helm uninstall enterprise-agentgateway-crds -n agentgateway-system',
      '',
      '# Remove Gateway API CRDs',
      'kubectl delete -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.4.0/standard-install.yaml',
      '```',
    ].join('\n');
  }
}

const KNOWN_PROVIDERS = [
  { name: 'openai', label: 'OpenAI' },
  { name: 'bedrock', label: 'AWS Bedrock' },
  { name: 'vertex-ai', label: 'Google Vertex AI' },
  { name: 'anthropic', label: 'Anthropic' },
  { name: 'azure', label: 'Azure OpenAI' },
];

/**
 * Interactive picker that builds a WorkshopSelection from user choices.
 * Uses Prompts.multiSelect (inquirer checkbox) grouped by category.
 */
export class WorkshopPicker {
  /**
   * Build flat choice list for the multi-select picker.
   * Choices are grouped by separators: Addons, Providers, Use Cases.
   * @returns {Promise<Array>}
   */
  static async buildChoices() {
    const choices = [];

    // Addons
    choices.push(new inquirer.Separator('── Addons ──'));
    for (const addonName of AddonAdapter.knownAddons()) {
      choices.push({
        name: addonName,
        value: { type: 'addon', name: addonName },
      });
    }

    // Providers
    choices.push(new inquirer.Separator('── Providers ──'));
    for (const p of KNOWN_PROVIDERS) {
      choices.push({
        name: p.label,
        value: { type: 'provider', name: p.name },
      });
    }

    // Use cases grouped by category
    const usecases = await UseCaseManager.list();
    const byCategory = new Map();
    for (const uc of usecases) {
      const cat = uc.category || 'general';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(uc);
    }

    for (const [cat, items] of [...byCategory.entries()].sort()) {
      choices.push(new inquirer.Separator(`── Use Cases: ${cat} ──`));
      for (const uc of items) {
        choices.push({
          name: uc.displayName || uc.name,
          value: { type: 'usecase', name: uc.name },
        });
      }
    }

    return choices;
  }

  /**
   * Run interactive prompts and return a WorkshopSelection.
   * @returns {Promise<import('./workshop.js').WorkshopSelection>}
   */
  static async prompt() {
    const title = await Prompts.input('Workshop title:', 'Agentgateway Workshop');
    const choices = await this.buildChoices();
    const selected = await Prompts.multiSelect('Select labs to include:', choices);

    const addons = selected.filter(s => s.type === 'addon').map(s => s.name);
    const providers = selected.filter(s => s.type === 'provider').map(s => s.name);
    const labs = selected
      .filter(s => s.type === 'usecase' || s.type === 'feature')
      .map(s => ({ type: s.type, name: s.name }));

    return { title, addons, providers, labs };
  }
}
