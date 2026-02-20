import chalk from 'chalk';
import stringWidth from 'string-width';

const DIM = chalk.dim;
const CYAN = chalk.cyan;
const GREEN = chalk.green;
const YELLOW = chalk.yellow;
const BOLD = chalk.bold;
const WHITE = chalk.white;

const BOX_INNER_WIDTH = 73;

const PASSTHROUGH_PROVIDER_LABELS = {
  'vertex-ai': 'Vertex AI',
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'bedrock': 'Bedrock',
  'gemini': 'Gemini',
};

const PASSTHROUGH_TOKEN_LABELS = {
  'vertex-ai': 'GCP token',
  'openai': 'API key',
  'anthropic': 'API key',
  'bedrock': 'token',
  'gemini': 'API key',
};

function padVisual(str, width) {
  const w = stringWidth(str);
  if (w >= width) return str;
  return str + ' '.repeat(width - w);
}

function boxLine(content) {
  return `│${padVisual(content, BOX_INNER_WIDTH)}│`;
}

/**
 * Show high-level AgentGateway architecture
 */
export function showArchitecture() {
  console.log(
    CYAN(`
┌─────────────────────────────────────────────────────────────────────────────┐
│                        🏗️  AGENTGATEWAY ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐         ┌───────────────────────────────────────┐         ┌──────────────┐
│          │         │         🛡️  AgentGateway               │         │              │
│  Client  │────────▶│                                       │────────▶│ LLM Provider │
│   App    │         │  ┌─────────────────────────────────┐  │         │              │
│          │◀────────│  │         Policy Engine           │  │◀────────│ ○ Anthropic  │
└──────────┘         │  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌────┐ │  │         │ ○ OpenAI     │
                     │  │  │ PII │ │Jail │ │Rate │ │Cred│ │  │         │ ○ Bedrock    │
     📤 Request      │  │  │Guard│ │Break│ │Limit│ │Leak│ │  │         │ ○ Ollama     │
     📥 Response     │  │  └─────┘ └─────┘ └─────┘ └────┘ │  │         │              │
                     │  └─────────────────────────────────┘  │         └──────────────┘
                     │  ┌─────────────────────────────────┐  │
                     │  │    💬 Prompt Elicitation        │  │
                     │  │    (Context Enrichment)         │  │
                     │  └─────────────────────────────────┘  │
                     └───────────────────────────────────────┘
`)
  );
}

/**
 * Show flow diagram for Add provider(s) step
 * @param {number} stepIndex - 1-based step number
 * @param {string[]} [providerNames] - e.g. ['bedrock'], ['openai', 'anthropic']
 */
export function showStepProvider(stepIndex, providerNames = []) {
  const providerList = providerNames.length ? providerNames.join(', ') : 'LLM Provider';
  const providerPrefix = '     │                         │      ';
  const providerSlotWidth = BOX_INNER_WIDTH - stringWidth(providerPrefix);

  const providerLines = [];
  if (stringWidth(providerList) <= providerSlotWidth) {
    providerLines.push(providerList);
  } else {
    let line = '';
    for (const name of providerNames) {
      const candidate = line ? `${line}, ${name}` : name;
      if (stringWidth(candidate) > providerSlotWidth) {
        if (line) providerLines.push(line + ',');
        line = name;
      } else {
        line = candidate;
      }
    }
    if (line) providerLines.push(line);
  }

  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  const providerBlock = providerLines
    .map(l => boxLine(providerPrefix + padVisual(l, providerSlotWidth)))
    .join('\n');

  console.log(
    DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: ADD PROVIDER`)}
${sep}
${boxLine('')}
${boxLine('   Client                 AgentGateway                         LLM')}
${boxLine('     │                         │                                │')}
${boxLine('     │  Request                │                                │')}
${boxLine('     │────────────────────────►│───────────────────────────────►│')}
${providerBlock}
${boxLine('     │                         │                                │')}
${boxLine('     │◄────────────────────────│◄───────────────────────────────│')}
${boxLine('     │   Response              │                                │')}
${boxLine('')}
${boxLine('   ✓ Backend + HTTPRoute → traffic can reach the provider')}
${bot}
`)
  );
}

/**
 * Show flow diagram for Add policy/policies step
 * @param {number} stepIndex - 1-based step number
 * @param {string[]} [policyNames] - e.g. ['prompt-guards'], ['prompt-enrichment']
 */
export function showStepPolicy(stepIndex, policyNames = []) {
  const policyList = policyNames.length ? policyNames.join(', ') : 'Policy';
  const policyLabelWidth = 24;
  const emojiPrefix = ' 🛡️ ';
  const maxNameWidth = policyLabelWidth - stringWidth(emojiPrefix) - 1; // -1 for '…'
  let displayName = policyList;
  if (stringWidth(displayName) > maxNameWidth) {
    while (stringWidth(displayName) > maxNameWidth) {
      displayName = displayName.slice(0, -1);
    }
    displayName = displayName.trimEnd() + '…';
  }
  const policyLabel = emojiPrefix + displayName;
  const policyPadded = padVisual(policyLabel, policyLabelWidth);

  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  console.log(
    DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: ADD POLICY`)}
${sep}
${boxLine('')}
${boxLine('   Client                 AgentGateway                         LLM')}
${boxLine('     │                         │                                │')}
${boxLine('     │  Request                │  ┌────────────────────────┐    │')}
${boxLine('     │────────────────────────►│  │' + policyPadded + '│    │')}
${boxLine('     │                         │  │    (Policy Engine)     │───►│')}
${boxLine('     │                         │  └────────────────────────┘    │')}
${boxLine('     │◄────────────────────────│◄───────────────────────────────│')}
${boxLine('     │   Response              │                                │')}
${boxLine('')}
${boxLine('   ✓ TrafficPolicy applied to route → guardrails / enrichment')}
${bot}
`)
  );
}

export function showStepExtAuth(stepIndex, authConfig = {}) {
  const idpName = authConfig.keycloak ? 'Keycloak' : 'IdP';

  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  console.log(
    DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: EXTERNAL AUTH (OAUTH AUTHORIZATION CODE)`)}
${sep}
${boxLine('')}
${boxLine(`   Client              AgentGateway              ${idpName}`)}
${boxLine('     │                      │                      │')}
${boxLine('     │  GET /route          │                      │')}
${boxLine('     │─────────────────────►│                      │')}
${boxLine('     │                      │                      │')}
${boxLine('     │  302 → Keycloak      │                      │')}
${boxLine('     │◄─────────────────────│                      │')}
${boxLine('     │                      │                      │')}
${boxLine('     │        (user logs in at Keycloak)           │')}
${boxLine('     │                      │                      │')}
${boxLine('     │  callback + code     │  exchange code       │')}
${boxLine('     │─────────────────────►│─────────────────────►│')}
${boxLine('     │                      │◄─── tokens ──────────│')}
${boxLine('     │  Set-Cookie: session │                      │')}
${boxLine('     │◄─────────────────────│                      │')}
${boxLine('')}
${boxLine('   ✓ AuthConfig + ExtAuth policy → unauthenticated requests redirect')}
${bot}
`)
  );
}

/**
 * Show flow diagram for Gateway configuration step
 * @param {number} stepIndex - 1-based step number
 * @param {string} [gatewayName] - e.g. 'custom-gateway'
 */
export function showStepGateway(stepIndex, gatewayName = 'agentgateway') {
  const gwLabel = ` 🌐 ${gatewayName}`;
  const gwLabelWidth = 30;
  const gwPadded = padVisual(gwLabel, gwLabelWidth);

  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  console.log(
    DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: CONFIGURE GATEWAY`)}
${sep}
${boxLine('')}
${boxLine('   Client                                                      LLM')}
${boxLine('     │          ┌──────────────────────────────────┐            │')}
${boxLine('     │          │' + gwPadded + '    │            │')}
${boxLine('     │─────────►│   Listeners · Routes · Policies  │───────────►│')}
${boxLine('     │◄─────────│                                  │◄───────────│')}
${boxLine('     │          └──────────────────────────────────┘            │')}
${boxLine('')}
${boxLine('   ✓ Gateway resource created → entry point for all traffic')}
${bot}
`)
  );
}

/**
 * Show flow diagram for a global rate limit step (with central Rate Limit Server)
 * @param {number} stepIndex - 1-based step number
 * @param {string} [type] - "REQUEST" or "TOKEN"
 */
export function showStepRateLimitGlobal(stepIndex, type = 'REQUEST') {
  const typeLabel = type === 'TOKEN' ? 'Token' : 'Request';
  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  console.log(
    DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: APPLY GLOBAL ${typeLabel.toUpperCase()} RATE LIMIT`)}
${sep}
${boxLine('')}
${boxLine('   Client              AgentGateway                            LLM')}
${boxLine('     │                      │                                   │')}
${boxLine('     │  Request             │  ┌──────────────────────────┐     │')}
${boxLine('     │─────────────────────►│  │  [RL] Rate Limit Server  │     │')}
${boxLine('     │                      │  │  (central counter)       │     │')}
${boxLine('     │                      │  └──────────┬───────────────┘     │')}
${boxLine('     │                      │  check ◄────┘                     │')}
${boxLine('     │                      │──────────────────────────────────►│')}
${boxLine('     │◄─────────────────────│◄──────────────────────────────────│')}
${boxLine('     │   Response           │                                   │')}
${boxLine('')}
${boxLine(`   ✓ RateLimitConfig + Policy → global ${typeLabel.toLowerCase()} rate limit`)}
${boxLine('   ✓ All replicas share one counter via Rate Limit Server')}
${bot}
`)
  );
}

/**
 * Show flow diagram for a local rate limit step (per-replica counters)
 * @param {number} stepIndex - 1-based step number
 */
export function showStepRateLimitLocal(stepIndex) {
  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  console.log(
    DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: APPLY LOCAL TOKEN RATE LIMIT`)}
${sep}
${boxLine('')}
${boxLine('   Client              AgentGateway                            LLM')}
${boxLine('     │                      │                                   │')}
${boxLine('     │  Request             │  ┌──────────────────────────┐     │')}
${boxLine('     │─────────────────────►│  │  [RL] Local Token Limit  │     │')}
${boxLine('     │                      │  │  (per-replica)           │     │')}
${boxLine('     │                      │  └──────────┬───────────────┘     │')}
${boxLine('     │                      │  check ◄────┘                     │')}
${boxLine('     │                      │──────────────────────────────────►│')}
${boxLine('     │◄─────────────────────│◄──────────────────────────────────│')}
${boxLine('     │   Response           │                                   │')}
${boxLine('')}
${boxLine('   ✓ Policy → local token rate limit (no central server)')}
${boxLine('   ✓ Each replica maintains its own independent counter')}
${bot}
`)
  );
}

/**
 * Show flow diagram for an MCP server step
 * @param {number} stepIndex - 1-based step number
 * @param {string[]} [serverNames] - e.g. ['mcp-stock-server']
 * @param {object} [options]
 * @param {boolean} [options.multiplex] - true when federating multiple servers
 * @param {string} [options.protocol] - e.g. 'StreamableHTTP'
 */
export function showStepMcpServer(stepIndex, serverNames = [], options = {}) {
  const { multiplex = false, protocol } = options;
  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  const titleSuffix = multiplex ? ' (MULTIPLEX)' : '';
  const infoPrefix = '     │                         │      ';
  const infoSlotWidth = BOX_INNER_WIDTH - stringWidth(infoPrefix);

  if (multiplex && serverNames.length > 1) {
    const infoLines = serverNames
      .map(s => boxLine(infoPrefix + padVisual(`→ ${s}`, infoSlotWidth)))
      .join('\n');

    console.log(
      DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: MCP SERVER${titleSuffix}`)}
${sep}
${boxLine('')}
${boxLine('   Client                 AgentGateway                   MCP Servers')}
${boxLine('     │                         │                                │')}
${boxLine('     │  MCP Request            │                                │')}
${boxLine('     │────────────────────────►│───────────────────────────────►│')}
${infoLines}
${boxLine('     │                         │                                │')}
${boxLine('     │◄────────────────────────│◄───────────────────────────────│')}
${boxLine('     │  MCP Response           │                                │')}
${boxLine('')}
${boxLine('   ✓ Backend + label selectors → federated MCP endpoint')}
${bot}
`)
    );
  } else {
    const serverLabel = serverNames.length ? serverNames[0] : 'MCP Server';
    const infoLines = [];
    infoLines.push(boxLine(infoPrefix + padVisual(serverLabel, infoSlotWidth)));
    if (protocol) {
      infoLines.push(boxLine(infoPrefix + padVisual(`[${protocol}]`, infoSlotWidth)));
    }
    const infoBlock = infoLines.join('\n');

    console.log(
      DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: MCP SERVER`)}
${sep}
${boxLine('')}
${boxLine('   Client                 AgentGateway                   MCP Server')}
${boxLine('     │                         │                                │')}
${boxLine('     │  MCP Request            │                                │')}
${boxLine('     │────────────────────────►│───────────────────────────────►│')}
${infoBlock}
${boxLine('     │                         │                                │')}
${boxLine('     │◄────────────────────────│◄───────────────────────────────│')}
${boxLine('     │  MCP Response           │                                │')}
${boxLine('')}
${boxLine('   ✓ Backend + HTTPRoute → agentgateway proxies MCP traffic')}
${bot}
`)
    );
  }
}

/**
 * Show a generic step diagram when step type is unknown
 * @param {number} stepIndex - 1-based step number
 * @param {string} title - Step title
 * @param {string[]} featureNames - Feature names being applied
 */
export function showStepGeneric(stepIndex, title, featureNames = []) {
  const list = featureNames.length ? featureNames.join(', ') : 'features';
  const titleContent = `  📍 STEP ${stepIndex}: ${title}`;
  const applyingContent = `   Applying: ${list}`;

  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  console.log(
    DIM(`
${top}
${boxLine(titleContent)}
${sep}
${boxLine('')}
${boxLine(applyingContent)}
${boxLine('')}
${bot}
`)
  );
}

/**
 * Show flow diagram for passthrough token authentication.
 * The client supplies its own Bearer token and AgentGateway forwards it as-is.
 * @param {number} stepIndex - 1-based step number
 * @param {string} [providerLabel] - e.g. 'Vertex AI', 'OpenAI'
 * @param {string} [tokenLabel] - e.g. 'GCP Access Token', 'API Key'
 */
export function showStepPassthroughToken(stepIndex, providerLabel = 'LLM Provider', tokenLabel = 'token') {
  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  const rightCol = padVisual(providerLabel, 16);

  console.log(
    DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: PASSTHROUGH TOKEN AUTH`)}
${sep}
${boxLine('')}
${boxLine(`   Client              AgentGateway              ${rightCol}`)}
${boxLine('     │                      │                         │')}
${boxLine('     │  + Authorization:    │                         │')}
${boxLine(`     │    Bearer <${padVisual(tokenLabel + '>', 10)}│                         │`)}
${boxLine('     │─────────────────────►│                         │')}
${boxLine('     │                      │  passthrough (same tkn) │')}
${boxLine('     │                      │────────────────────────►│')}
${boxLine('     │                      │◄────────────────────────│')}
${boxLine('     │◄─────────────────────│  Response               │')}
${boxLine('     │                      │                         │')}
${boxLine('')}
${boxLine('   ✓ authMode: passthrough → no API key stored on gateway')}
${boxLine('   ✓ Client must supply a valid token in Authorization header')}
${bot}
`)
  );
}

/**
 * Show diagram for enabling the STS token exchange server via Helm upgrade.
 * @param {number} stepIndex - 1-based step number
 * @param {object} [config]
 * @param {string} [config.idpName] - e.g. 'Keycloak'
 */
export function showStepTokenExchange(stepIndex, config = {}) {
  const { idpName = 'Keycloak' } = config;

  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  console.log(
    DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: SET UP TOKEN EXCHANGE (HELM UPGRADE)`)}
${sep}
${boxLine('')}
${boxLine('   helm upgrade enterprise-agentgateway ... --reuse-values')}
${boxLine('')}
${boxLine('   tokenExchange:')}
${boxLine('     enabled: true')}
${boxLine('     issuer: enterprise-agentgateway...:7777')}
${boxLine('     subjectValidator:')}
${boxLine(`       remote → ${idpName} JWKS`)}
${boxLine('     actorValidator:')}
${boxLine('       k8s   → ServiceAccount tokens')}
${boxLine('')}
${boxLine('   ┌─────────────────┐     ┌──────────────────┐')}
${boxLine('   │  Control Plane  │     │     ' + padVisual(idpName, 10) + '   │')}
${boxLine('   │   :7777 (STS)   │────►│   JWKS endpoint  │')}
${boxLine('   └─────────────────┘     └──────────────────┘')}
${boxLine('')}
${boxLine('   ✓ STS enabled on port 7777 of the control plane service')}
${boxLine('   ✓ Subject tokens validated against ' + idpName + ' OIDC JWKS')}
${boxLine('   ✓ Actor tokens validated via Kubernetes SA tokens')}
${bot}
`)
  );
}

/**
 * Show flow diagram for OBO (On Behalf Of) token exchange with JWT validation.
 * Client authenticates with IdP, exchanges token via STS, then AgentGateway
 * validates the STS-issued JWT against the IdP JWKS endpoint.
 * @param {number} stepIndex - 1-based step number
 * @param {object} [config]
 * @param {string} [config.idpName] - e.g. 'Keycloak'
 * @param {string} [config.targetName] - e.g. 'MCP Server'
 */
export function showStepOboTokenExchange(stepIndex, config = {}) {
  const { idpName = 'Keycloak', targetName = 'MCP Server' } = config;

  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  const idpCol = padVisual(idpName + '/STS', 14);
  const tgtCol = padVisual(targetName, 12);

  console.log(
    DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: OBO TOKEN EXCHANGE (JWT POLICY)`)}
${sep}
${boxLine('')}
${boxLine(`   Client        ${idpCol}      AgentGateway     ${tgtCol}`)}
${boxLine('     │                │               │               │')}
${boxLine('     │  1 authenticate│               │               │')}
${boxLine('     │───────────────►│               │               │')}
${boxLine('     │◄─ access token─│               │               │')}
${boxLine('     │                │               │               │')}
${boxLine('     │  2 exchange token (OBO)        │               │')}
${boxLine('     │───────────────►│               │               │')}
${boxLine('     │◄── STS token ──│               │               │')}
${boxLine('     │                │               │               │')}
${boxLine('     │  3 request + Bearer (STS)      │               │')}
${boxLine('     │───────────────────────────────►│               │')}
${boxLine('     │                │  JWKS lookup  │               │')}
${boxLine('     │                │◄──────────────│               │')}
${boxLine('     │                │               │──────────────►│')}
${boxLine('     │                │               │◄──────────────│')}
${boxLine('     │◄───────────────────────────────│               │')}
${boxLine('')}
${boxLine(`   ✓ JWT policy validates STS-issued token via ${idpName} JWKS`)}
${boxLine('   ✓ Unauthenticated requests are rejected at the gateway')}
${bot}
`)
  );
}

/**
 * Show flow diagram for API key authentication (ext-auth).
 * Client provides an API key in a request header; ext-auth validates it
 * against Kubernetes Secrets before forwarding.
 * @param {number} stepIndex - 1-based step number
 * @param {object} [config]
 * @param {string} [config.headerName] - e.g. 'x-ai-api-key'
 */
export function showStepApiKeyAuth(stepIndex, config = {}) {
  const { headerName = 'x-ai-api-key' } = config;

  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  const C = 5;
  const G = 40;
  const L = 61;

  const pipe  = ' '.repeat(C) + '│' + ' '.repeat(G - C - 1) + '│' + ' '.repeat(L - G - 1) + '│';
  const label = `  1 request + ${headerName}`;
  const req   = ' '.repeat(C) + '│' + label + ' '.repeat(L - C - 1 - label.length) + '│';
  const arrow = ' '.repeat(C) + '│' + '─'.repeat(G - C - 2) + '►│' + ' '.repeat(L - G - 1) + '│';
  const boxW  = 23;
  const boxL  = G - Math.floor(boxW / 2);
  const bTop  = ' '.repeat(C) + '│' + ' '.repeat(boxL - C - 1) + '┌' + '─'.repeat(G - boxL - 1) + '┴' + '─'.repeat(boxL + boxW - G - 2) + '┐' + ' '.repeat(L - boxL - boxW) + '│';
  const bMid1 = ' '.repeat(C) + '│' + ' '.repeat(boxL - C - 1) + '│' + padVisual(' ext-auth: check key', boxW - 2) + '│' + ' '.repeat(L - boxL - boxW) + '│';
  const bMid2 = ' '.repeat(C) + '│' + ' '.repeat(boxL - C - 1) + '│' + padVisual(' (K8s Secret lookup)', boxW - 2) + '│' + ' '.repeat(L - boxL - boxW) + '│';
  const bBot  = ' '.repeat(C) + '│' + ' '.repeat(boxL - C - 1) + '└' + '─'.repeat(G - boxL - 1) + '┬' + '─'.repeat(boxL + boxW - G - 2) + '┘' + ' '.repeat(L - boxL - boxW) + '│';
  const fwd   = ' '.repeat(C) + '│' + ' '.repeat(G - C - 1) + '│' + '─'.repeat(L - G - 2) + '►│';
  const bck   = ' '.repeat(C) + '│' + ' '.repeat(G - C - 1) + '│' + '◄' + '─'.repeat(L - G - 2) + '│';
  const resp  = ' '.repeat(C) + '│' + '◄' + '─'.repeat(G - C - 2) + '│' + padVisual('  Response', L - G - 1) + '│';

  console.log(
    DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: API KEY AUTHENTICATION (EXT-AUTH)`)}
${sep}
${boxLine('')}
${boxLine('   Client                              AgentGateway          LLM')}
${boxLine(pipe)}
${boxLine(req)}
${boxLine(arrow)}
${boxLine(bTop)}
${boxLine(bMid1)}
${boxLine(bMid2)}
${boxLine(bBot)}
${boxLine(fwd)}
${boxLine(bck)}
${boxLine(resp)}
${boxLine('')}
${boxLine('   ✓ AuthConfig + ExtAuth policy → 401 without valid API key')}
${boxLine(`   ✓ API key extracted from ${headerName} header`)}
${boxLine('   ✓ Keys stored as K8s Secrets (type extauth.solo.io/apikey)')}
${bot}
`)
  );
}

/**
 * Show flow diagram for OAuth access token validation (ext-auth JWT).
 * Client obtains a token from the IdP out-of-band, then sends it to the
 * gateway where ext-auth validates the JWT before forwarding.
 * @param {number} stepIndex - 1-based step number
 * @param {object} [config]
 * @param {string} [config.idpName] - e.g. 'Keycloak'
 */
export function showStepAccessTokenValidation(stepIndex, config = {}) {
  const { idpName = 'Keycloak' } = config;

  const top = '┌' + '─'.repeat(BOX_INNER_WIDTH) + '┐';
  const sep = '├' + '─'.repeat(BOX_INNER_WIDTH) + '┤';
  const bot = '└' + '─'.repeat(BOX_INNER_WIDTH) + '┘';

  const idpCol = padVisual(idpName, 10);

  console.log(
    DIM(`
${top}
${boxLine(`  📍 STEP ${stepIndex}: ACCESS TOKEN VALIDATION (EXT-AUTH)`)}
${sep}
${boxLine('')}
${boxLine(`   Client           ${idpCol}      AgentGateway              LLM`)}
${boxLine('     │                  │               │                    │')}
${boxLine('     │  1 get token     │               │                    │')}
${boxLine('     │─────────────────►│               │                    │')}
${boxLine('     │◄── access token ─│               │                    │')}
${boxLine('     │                  │               │                    │')}
${boxLine('     │  2 request + Authorization: Bearer <token>            │')}
${boxLine('     │─────────────────────────────────►│                    │')}
${boxLine('     │                  │  ┌────────────┴──────────┐         │')}
${boxLine('     │                  │  │ ext-auth: validate JWT│         │')}
${boxLine('     │                  │  │ (JWKS from IdP)       │         │')}
${boxLine('     │                  │  └────────────┬──────────┘         │')}
${boxLine('     │                  │               │───────────────────►│')}
${boxLine('     │                  │               │◄───────────────────│')}
${boxLine('     │◄─────────────────────────────────│  Response          │')}
${boxLine('')}
${boxLine(`   ✓ AuthConfig + ExtAuth policy → 403 without valid JWT`)}
${boxLine(`   ✓ Tokens validated via ${idpName} JWKS (no redirect flow)`)}
${bot}
`)
  );
}

/**
 * Print step header (step N of M, title, optional description)
 * @param {number} stepIndex - 1-based
 * @param {number} totalSteps
 * @param {string} title
 * @param {string} [description]
 */
export function showStepHeader(stepIndex, totalSteps, title, description) {
  console.log('');
  console.log(YELLOW(BOLD('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));
  console.log(YELLOW(BOLD(`  Step ${stepIndex} of ${totalSteps}: ${title}`)));
  console.log(YELLOW(BOLD('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')));
  console.log('');
  if (description) {
    const maxWidth = 75;
    const words = description.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (line.length + word.length + 1 > maxWidth && line.length > 0) {
        console.log(WHITE(line));
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) console.log(WHITE(line));
    console.log('');
  }
}

/**
 * Print "press Space to continue" and wait
 */
export function showWaitPrompt() {
  console.log(DIM('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(YELLOW('👉 Press SPACE to continue...'));
}

/**
 * Resolve which diagram to show for a step based on feature names
 * @param {number} stepIndex - 1-based
 * @param {Array<{name: string, config?: object}>} features - features in this step
 */
export function showDiagramForStep(stepIndex, features) {
  const names = features.map((f) => f.name);
  const hasGateway = names.includes('gateway');
  const hasProviders = names.includes('providers');
  const hasRateLimit = names.includes('rate-limit');
  const hasMcpServer = names.includes('mcp-server');
  const hasExtAuth = names.includes('oauth-authorization-code');
  const hasAccessTokenValidation = names.includes('oauth-access-token-validation');
  const hasClientCredentials = names.includes('m2m-client-credentials');
  const hasApiKeyAuth = names.includes('apikey-auth');
  const hasTokenExchange = names.includes('token-exchange');
  const hasOboToken = names.includes('obo-token-exchange');
  const policyNames = names.filter((n) => n !== 'providers' && n !== 'gateway' && n !== 'rate-limit' && n !== 'mcp-server' && n !== 'oauth-authorization-code' && n !== 'oauth-access-token-validation' && n !== 'm2m-client-credentials' && n !== 'obo-token-exchange' && n !== 'token-exchange' && n !== 'apikey-auth');

  if (hasTokenExchange) {
    const teConfig = features.find((f) => f.name === 'token-exchange')?.config || {};
    const idpName = teConfig.keycloak ? 'Keycloak' : 'IdP';
    showStepTokenExchange(stepIndex, { idpName });
    return;
  }
  if (hasOboToken) {
    const oboConfig = features.find((f) => f.name === 'obo-token-exchange')?.config || {};
    const idpName = oboConfig.keycloak ? 'Keycloak' : 'IdP';
    showStepOboTokenExchange(stepIndex, { idpName });
    return;
  }
  if (hasApiKeyAuth) {
    const akConfig = features.find((f) => f.name === 'apikey-auth')?.config || {};
    showStepApiKeyAuth(stepIndex, { headerName: akConfig.headerName || 'x-ai-api-key' });
    return;
  }
  if (hasAccessTokenValidation) {
    const atvConfig = features.find((f) => f.name === 'oauth-access-token-validation')?.config || {};
    const idpName = atvConfig.keycloak ? 'Keycloak' : 'IdP';
    showStepAccessTokenValidation(stepIndex, { idpName });
    return;
  }
  if (hasClientCredentials) {
    const ccConfig = features.find((f) => f.name === 'm2m-client-credentials')?.config || {};
    const idpName = ccConfig.keycloak ? 'Keycloak' : 'IdP';
    showStepAccessTokenValidation(stepIndex, { idpName });
    return;
  }
  if (hasExtAuth) {
    const authConfig = features.find((f) => f.name === 'oauth-authorization-code')?.config || {};
    showStepExtAuth(stepIndex, authConfig);
    return;
  }
  if (hasGateway) {
    const gatewayConfig = features.find((f) => f.name === 'gateway')?.config;
    const gatewayName = gatewayConfig?.name || 'agentgateway';
    showStepGateway(stepIndex, gatewayName);
    return;
  }
  if (hasMcpServer) {
    const mcpConfig = features.find((f) => f.name === 'mcp-server')?.config || {};
    const protocol = mcpConfig.protocol;
    let serverNames = [];
    if (Array.isArray(mcpConfig.servers)) {
      serverNames = mcpConfig.servers.map((s) => s.name).filter(Boolean);
    } else if (mcpConfig.serverName) {
      serverNames = [mcpConfig.serverName];
    }
    const multiplex = Array.isArray(mcpConfig.targets) && mcpConfig.targets.length > 1;
    showStepMcpServer(stepIndex, serverNames, { multiplex, protocol });
    return;
  }
  if (hasProviders) {
    const providerConfig = features.find((f) => f.name === 'providers')?.config || {};
    const providers = Array.isArray(providerConfig.providers) ? providerConfig.providers : [];
    const passthroughProviders = providers.filter((p) => typeof p === 'object' && p.authMode === 'passthrough');

    if (passthroughProviders.length > 0 && passthroughProviders.length === providers.length) {
      const p = passthroughProviders[0];
      const providerName = p.providerName || p.name || 'LLM Provider';
      const providerLabel = PASSTHROUGH_PROVIDER_LABELS[providerName] || providerName;
      const tokenLabel = PASSTHROUGH_TOKEN_LABELS[providerName] || 'token';
      showStepPassthroughToken(stepIndex, providerLabel, tokenLabel);
      return;
    }

    let providerLabels = [];
    if (providers.length) {
      providerLabels = providers
        .map((p) => (typeof p === 'string' ? p : p.name || p.pathPrefix || 'provider'))
        .filter(Boolean);
    } else if (Array.isArray(providerConfig.groups)) {
      providerLabels = providerConfig.groups
        .flatMap((g) => (g.providers || []).map((p) => p.name || p.providerName || 'provider'))
        .filter(Boolean);
    }
    showStepProvider(stepIndex, providerLabels.length ? providerLabels : ['provider']);
    return;
  }
  if (hasRateLimit) {
    const rlConfig = features.find((f) => f.name === 'rate-limit')?.config || {};
    if (rlConfig.mode === 'local') {
      showStepRateLimitLocal(stepIndex);
    } else {
      showStepRateLimitGlobal(stepIndex, rlConfig.type || 'REQUEST');
    }
    return;
  }
  if (policyNames.length > 0) {
    showStepPolicy(stepIndex, policyNames);
    return;
  }
  showStepGeneric(stepIndex, `Apply: ${names.join(', ')}`, names);
}
