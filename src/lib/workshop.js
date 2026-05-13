import { InstallAdapter } from './workshop-adapters/install.js';

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

    // Lab 0: Installation (always included)
    InstallAdapter.envVars().forEach(v => envVarMap.set(v.name, v));
    labSections.push(InstallAdapter.generate({ addons, labNum }));
    labNum++;

    // Remaining adapters added in later tasks — stubs for now

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
