import { spawn } from 'child_process';
import { createServer } from 'http';
import { randomBytes, createHash } from 'crypto';
import chalk from 'chalk';
import {
  Logger,
  SpinnerLogger,
  KubernetesHelper,
  CommandRunner,
  printTrafficBox,
  wrapText,
} from './common.js';

/**
 * Use case test runner
 * Handles test execution for agentgateway use cases
 */
export class UseCaseTestRunner {
  /**
   * Run tests for a use case
   * @param {Object} usecase - Parsed use case object with metadata and spec
   * @returns {Promise<void>}
   */
  static async runTests(usecase) {
    const spinner = new SpinnerLogger();
    const { metadata, spec } = usecase;

    try {
      Logger.info(`Testing use case: ${metadata.name}`);

      if (!spec.tests || spec.tests.length === 0) {
        Logger.warn(`No tests defined for use case '${metadata.name}'`);
        return;
      }

      const testLine =
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
      console.log('');
      console.log(chalk.cyan(chalk.bold(testLine)));
      console.log(chalk.cyan(chalk.bold(`  🧪 Running Tests -> (${spec.tests.length} test(s))`)));
      console.log(chalk.cyan(chalk.bold(testLine)));
      console.log('');

      let passed = 0;
      let failed = 0;
      let skipped = 0;
      const total = spec.tests.length;

      for (let i = 0; i < spec.tests.length; i++) {
        const test = spec.tests[i];
        const testName = test.name || 'unnamed-test';
        const testDesc = test.description || 'No description';
        const idx = `[${i + 1}/${total}]`;
        const headerLabel = `  ${idx} ${testName} `;
        const headerFill = '─'.repeat(Math.max(0, testLine.length - headerLabel.length));

        console.log(chalk.dim(`${headerLabel}${headerFill}`));

        spinner.start(`Running test: ${testName}`);

        try {
          if (!test.steps || test.steps.length === 0) {
            spinner.warn(`Test '${testName}' has no steps - skipped`);
            skipped++;
            console.log('');
            continue;
          }

          if (test.setup && test.setup.length > 0) {
            spinner.setText(`Running setup for: ${testName}`);
            await this.executeTestSteps(
              { ...test, steps: test.setup },
              metadata.name,
              spec,
              spinner
            );
          }

          try {
            await this.executeTestSteps(test, metadata.name, spec, spinner);
          } finally {
            if (test.teardown && test.teardown.length > 0) {
              spinner.setText(`Running teardown for: ${testName}`);
              await this.executeTestSteps(
                { ...test, steps: test.teardown },
                metadata.name,
                spec,
                spinner
              );
            }
          }

          spinner.succeed(testName);
          if (testDesc && testDesc !== 'No description') {
            console.log(wrapText(testDesc, undefined, '  '));
          }
          passed++;
        } catch (error) {
          spinner.fail(`${testName}: ${error.message}`);
          failed++;
        }

        console.log('');
      }

      const summaryColor = failed > 0 ? chalk.red : chalk.green;
      const skippedPart = skipped > 0 ? chalk.yellow(` · ${skipped} skipped`) : '';
      console.log(summaryColor(chalk.bold(testLine)));
      console.log(
        summaryColor(chalk.bold(`  Results: ${passed} passed · ${failed} failed${skippedPart}`))
      );
      console.log(summaryColor(chalk.bold(testLine)));
      console.log('');

      if (failed > 0) {
        throw new Error(`${failed} test(s) failed`);
      }
    } catch (error) {
      if (error.message.includes('test(s) failed')) {
        throw error;
      }
      spinner.fail(`Failed to run tests: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute test steps
   * @param {Object} test - Test definition
   * @param {string} usecaseName - Use case name
   * @param {Object} spec - Use case spec
   * @param {SpinnerLogger} spinner - Spinner logger
   * @returns {Promise<void>}
   */
  static async executeTestSteps(test, usecaseName, spec, spinner) {
    const { namespace } = spec;
    const gatewayNamespace =
      namespace || process.env.AGENTGATEWAY_NAMESPACE || 'agentgateway-system';

    const gatewayFeature = (spec.features || []).find(f => f.name === 'gateway');
    const gatewayName = gatewayFeature?.config?.name || 'agentgateway';
    const gatewayPort = gatewayFeature?.config?.listeners?.[0]?.port || 8080;

    const parseTimeoutSecs = (val, fallbackSecs = 30) => {
      if (val == null) return fallbackSecs;
      if (typeof val === 'number') return val;
      const s = String(val).trim();
      if (s.endsWith('ms')) return Math.ceil(parseFloat(s) / 1000);
      if (s.endsWith('m')) return parseFloat(s) * 60;
      if (s.endsWith('s')) return parseFloat(s);
      const n = parseFloat(s);
      return isNaN(n) ? fallbackSecs : n;
    };

    const defaultTimeout = spec.timeout || 30000;
    const testTimeout = test.timeout || defaultTimeout;

    let lastResponse = null;
    let lastResponseBody = null;
    let lastResponseStatus = null;
    let bearerToken = null;
    let actorToken = null;
    let sessionCookie = null;
    let apiKey = null;
    let apiKeyHeader = null;

    for (const step of test.steps) {
      const action = step.action;

      switch (action) {
        case 'get-token': {
          const prevText = spinner.spinner.text;
          const kc = step.keycloak || {};
          if (kc.grantType === 'password' || kc.grantType === 'client_credentials') {
            spinner.setText('Obtaining token via password grant...');
            bearerToken = await this.getTokenViaPasswordGrant(step);
            spinner.stop();
            Logger.success('Token obtained via password grant');
            spinner.start(prevText);
          } else {
            spinner.stop();
            Logger.info('Opening browser for Keycloak login...');
            bearerToken = await this.getTokenViaBrowser(step);
            Logger.success('Token obtained via browser login');
            spinner.start(prevText);
          }
          break;
        }

        case 'get-session-cookie': {
          const gw = await this.getGatewayAddress(gatewayNamespace, gatewayName);
          if (!gw) throw new Error('Gateway address not found');
          const prevText = spinner.spinner.text;
          spinner.stop();
          sessionCookie = await this.getSessionCookie(gw, gatewayPort, step);
          Logger.info('Session cookie obtained');
          spinner.start(prevText);
          break;
        }

        case 'get-apikey': {
          const secretName = step.secretName || 'apikey';
          const secretNs = step.namespace || gatewayNamespace;
          const secretKey = step.secretKey || 'api-key';
          apiKeyHeader = step.headerName || 'x-ai-api-key';

          spinner.setText(`Reading API key from secret ${secretNs}/${secretName}...`);
          const result = await KubernetesHelper.kubectl([
            'get',
            'secret',
            secretName,
            '-n',
            secretNs,
            '-o',
            `jsonpath={.data.${secretKey.replace(/\./g, '\\.')}}`,
          ]);
          const b64 = (result.stdout || '').trim();
          if (!b64) {
            throw new Error(
              `API key not found in secret ${secretNs}/${secretName} key=${secretKey}`
            );
          }
          apiKey = Buffer.from(b64, 'base64').toString('utf8');
          spinner.setText('API key retrieved from secret');
          break;
        }

        case 'get-k8s-token': {
          const sa = step.serviceAccount || 'default';
          const ns = step.namespace || gatewayNamespace;
          const duration = step.duration || '1h';
          const role = step.role || 'actor';
          spinner.setText(`Creating K8s SA token for ${ns}/${sa} (${role})...`);
          const ktResult = await KubernetesHelper.kubectl([
            'create',
            'token',
            sa,
            '-n',
            ns,
            '--duration',
            duration,
          ]);
          const k8sToken = (ktResult.stdout || '').trim();
          if (!k8sToken)
            throw new Error('get-k8s-token: kubectl create token returned empty output');
          if (role === 'subject') {
            bearerToken = k8sToken;
          } else {
            actorToken = k8sToken;
          }
          spinner.setText(`K8s SA token created for ${ns}/${sa} (${role})`);
          break;
        }

        case 'exchange-sts-token': {
          const stsConf = step.sts || {};
          const stsService = stsConf.service || 'enterprise-agentgateway';
          const stsNs = stsConf.namespace || 'agentgateway-system';
          const stsPort = stsConf.port || 7777;
          const localPort = stsConf.localPort || 17777;

          spinner.setText(
            `Port-forwarding ${stsNs}/${stsService}:${stsPort} → localhost:${localPort}...`
          );
          const pfProc = spawn(
            'kubectl',
            ['port-forward', '-n', stsNs, `svc/${stsService}`, `${localPort}:${stsPort}`],
            { stdio: 'pipe' }
          );

          await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('exchange-sts-token: port-forward timed out')),
              10000
            );
            pfProc.stdout.on('data', data => {
              if (data.toString().includes('Forwarding from')) {
                clearTimeout(timer);
                resolve();
              }
            });
            pfProc.on('error', err => {
              clearTimeout(timer);
              reject(err);
            });
            pfProc.on('close', code => {
              if (code !== null) {
                clearTimeout(timer);
                reject(new Error(`port-forward exited with code ${code}`));
              }
            });
          });

          try {
            if (!bearerToken)
              throw new Error(
                'exchange-sts-token: no subject token — run get-token or get-k8s-token first'
              );

            const params = {
              grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
              subject_token: bearerToken,
              subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
            };
            if (actorToken) {
              params.actor_token = actorToken;
              params.actor_token_type = 'urn:ietf:params:oauth:token-type:jwt';
            }
            const tokenBody = new URLSearchParams(params).toString();

            const curlArgs = [
              '-s',
              '--max-time',
              '10',
              '-X',
              'POST',
              `http://localhost:${localPort}/oauth2/token`,
              '-H',
              'Content-Type: application/x-www-form-urlencoded',
              '-H',
              `Authorization: Bearer ${bearerToken}`,
              '-d',
              tokenBody,
              '-w',
              '\n%{http_code}',
            ];

            spinner.setText('Exchanging token with AGW STS...');
            const stsResult = await CommandRunner.run('curl', curlArgs, { ignoreError: true });

            const raw = (stsResult.stdout || '').trim();
            const lines = raw.split('\n');
            const httpStatus = parseInt(lines[lines.length - 1], 10);
            const stsBody = lines.slice(0, -1).join('\n').trim();

            Logger.debug(`STS /token status: ${httpStatus}, body: ${stsBody || '(empty)'}`);

            if (httpStatus !== 200) {
              const detail = stsBody || stsResult.stderr || '(no response body)';
              throw new Error(`exchange-sts-token: STS returned HTTP ${httpStatus}: ${detail}`);
            }
            if (!stsBody) throw new Error('exchange-sts-token: STS returned 200 with empty body');

            let parsed;
            try {
              parsed = JSON.parse(stsBody);
            } catch (e) {
              throw new Error(`exchange-sts-token: failed to parse STS response: ${e.message}`);
            }
            if (!parsed.access_token)
              throw new Error('exchange-sts-token: STS response missing access_token');

            bearerToken = parsed.access_token;
            spinner.setText('Token exchanged successfully');
          } finally {
            pfProc.kill();
          }
          break;
        }

        case 'call-agent': {
          const agentName = step.agent || 'caller-agent';
          const agentNs = step.namespace || gatewayNamespace;
          const agentPort = step.port || 8080;
          const localPort = step.localPort || 28080;
          const message = step.message || step.prompt || 'Hello';
          const threadId = step.threadId || 'test-thread';

          spinner.setText(`Calling agent ${agentNs}/${agentName}...`);
          const pfProc = spawn(
            'kubectl',
            ['port-forward', '-n', agentNs, `svc/${agentName}`, `${localPort}:${agentPort}`],
            { stdio: 'pipe' }
          );

          await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('call-agent: port-forward timed out')),
              10000
            );
            pfProc.stdout.on('data', data => {
              if (data.toString().includes('Forwarding from')) {
                clearTimeout(timer);
                resolve();
              }
            });
            pfProc.on('error', err => {
              clearTimeout(timer);
              reject(err);
            });
            pfProc.on('close', code => {
              if (code !== null) {
                clearTimeout(timer);
                reject(new Error(`port-forward exited with code ${code}`));
              }
            });
          });

          try {
            const payload = JSON.stringify({
              message,
              thread_id: threadId,
            });

            const headers = ['Content-Type: application/json'];
            if (bearerToken) {
              headers.push(`Authorization: Bearer ${bearerToken}`);
            }

            const curlArgs = [
              '-s',
              '--max-time',
              String(parseTimeoutSecs(step.timeout || testTimeout)),
              '-X',
              'POST',
              `http://localhost:${localPort}/chat`,
              ...headers.flatMap(h => ['-H', h]),
              '-d',
              payload,
              '-w',
              '\n%{http_code}',
            ];

            spinner.setText(`Sending message to ${agentName}...`);
            const agentResult = await CommandRunner.run('curl', curlArgs, { ignoreError: true });

            const raw = (agentResult.stdout || '').trim();
            const lines = raw.split('\n');
            const httpStatus = parseInt(lines[lines.length - 1], 10);
            const agentBody = lines.slice(0, -1).join('\n').trim();

            lastResponseStatus = httpStatus;
            lastResponseBody = agentBody;
            lastResponse = { status: httpStatus, body: agentBody };

            if (step.showTraffic || test.showTraffic) {
              const prevText = spinner.spinner.text;
              spinner.stop();
              printTrafficBox(
                {
                  method: 'POST',
                  url: `http://${agentName}/chat`,
                  headers: Object.fromEntries(headers.map(h => h.split(': '))),
                  body: payload,
                },
                { status: httpStatus, body: agentBody }
              );
              spinner.start(prevText);
            }

            spinner.setText(`Agent response received, status: ${httpStatus}`);
          } finally {
            pfProc.kill();
          }
          break;
        }

        case 'send-request': {
          const gateway = await this.getGatewayAddress(gatewayNamespace, gatewayName);
          if (!gateway) {
            throw new Error('Gateway address not found - ensure gateway is deployed');
          }

          if (step.auth === 'bearer' && bearerToken) {
            step.headers = { ...step.headers, Authorization: `Bearer ${bearerToken}` };
          } else if (step.auth === 'session' && sessionCookie) {
            step.headers = { ...step.headers, Cookie: sessionCookie };
          }
          if (apiKey && apiKeyHeader) {
            step.headers = { ...step.headers, [apiKeyHeader]: apiKey };
          }

          spinner.setText(`Sending request to ${gateway}...`);

          try {
            const stepTimeout = step.timeout || testTimeout;
            const maxRetries = step.retries ?? 0;
            const retryDelay = step.retryDelay ?? 3000;
            let result;

            for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
              result = await this.sendHttpRequest(gateway, step, spinner, stepTimeout, gatewayPort);
              if (result.status < 500 || attempt > maxRetries) break;
              spinner.setText(
                `Request returned ${result.status}, retrying in ${retryDelay / 1000}s (${attempt}/${maxRetries})...`
              );
              await new Promise(r => setTimeout(r, retryDelay));
            }

            lastResponse = { ...result.response, headers: result.responseHeaders };
            lastResponseBody = result.body;
            lastResponseStatus = result.status;

            if (step.showTraffic || test.showTraffic) {
              const prevText = spinner.spinner.text;
              spinner.stop();
              printTrafficBox(result.requestInfo, {
                status: result.status,
                headers: result.responseHeaders,
                body: result.body,
              });
              spinner.start(prevText);
            }

            spinner.setText(`Request sent, status: ${lastResponseStatus}`);
          } catch (error) {
            throw new Error(`Request failed: ${error.message}`);
          }
          break;
        }

        case 'verify':
          spinner.setText('Verifying response...');

          if (!lastResponse) {
            throw new Error('No response to verify - send-request must come before verify');
          }

          await this.verifyResponse(
            lastResponse,
            lastResponseBody,
            lastResponseStatus,
            step,
            spinner
          );
          break;

        case 'send-mcp-request': {
          const mcpGateway = await this.getGatewayAddress(gatewayNamespace, gatewayName);
          if (!mcpGateway) {
            throw new Error('Gateway address not found - ensure gateway is deployed');
          }

          if (step.auth === 'bearer' && bearerToken) {
            step.headers = { ...step.headers, Authorization: `Bearer ${bearerToken}` };
          }

          spinner.setText(`Sending MCP request (${step.method}) to ${mcpGateway}...`);

          try {
            const stepTimeout = step.timeout || testTimeout;
            const maxRetries = step.retries ?? 0;
            const retryDelay = step.retryDelay ?? 3000;
            let result;

            for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
              result = await this.sendMcpRequest(
                mcpGateway,
                step,
                spinner,
                stepTimeout,
                gatewayPort
              );
              if (result.status < 500 || attempt > maxRetries) break;
              spinner.setText(
                `MCP request returned ${result.status}, retrying in ${retryDelay / 1000}s (${attempt}/${maxRetries})...`
              );
              await new Promise(r => setTimeout(r, retryDelay));
            }

            lastResponse = { ...result.response, headers: result.responseHeaders };
            lastResponseBody = result.body;
            lastResponseStatus = result.status;

            if (step.showTraffic || test.showTraffic) {
              const prevText = spinner.spinner.text;
              spinner.stop();
              printTrafficBox(result.requestInfo, {
                status: result.status,
                headers: result.responseHeaders,
                body: result.body,
              });
              spinner.start(prevText);
            }

            spinner.setText(`MCP request sent, status: ${lastResponseStatus}`);
          } catch (error) {
            throw new Error(`MCP request failed: ${error.message}`);
          }
          break;
        }

        case 'verify-resource': {
          const { kind, name: resName, namespace: resNs, jsonpath, expect: resExpect } = step;
          const ns = resNs || gatewayNamespace;
          spinner.setText(`Verifying ${kind} '${resName}' in ${ns}...`);

          for (const check of resExpect) {
            const result = await KubernetesHelper.kubectl(
              ['get', kind, resName, '-n', ns, '-o', `jsonpath=${check.jsonpath}`],
              { ignoreError: true }
            );

            const actual = result.stdout.trim();
            const expected = String(check.value);

            if (actual !== expected) {
              throw new Error(
                `${kind} '${resName}' field ${check.jsonpath}: expected '${expected}', got '${actual}'`
              );
            }
          }
          break;
        }

        case 'wait': {
          const duration = step.duration || 1000;
          spinner.setText(`Waiting ${duration / 1000}s for cache expiration...`);
          await new Promise(r => setTimeout(r, duration));
          break;
        }

        case 'set-budget-usage': {
          const entityType = step.entityType || 'provider';
          const name = step.name || 'openai';
          const usage = step.usage || 0;
          const budgetNs = step.namespace || 'agentgateway-system';

          spinner.setText(`Setting budget usage for ${entityType}/${name} to $${usage}...`);

          const sqlCmd = `UPDATE budget_definitions SET current_usage_usd = ${usage} WHERE entity_type = '${entityType}' AND name = '${name}'`;

          await KubernetesHelper.kubectl([
            'exec',
            '-n',
            budgetNs,
            'budget-management-postgres-0',
            '--',
            'psql',
            '-U',
            'budget',
            '-d',
            'budget_management',
            '-c',
            sqlCmd,
          ]);

          spinner.setText(`Budget usage set to $${usage} for ${entityType}/${name}`);
          break;
        }

        case 'reset-budget-usage': {
          const entityType = step.entityType || 'provider';
          const name = step.name || 'openai';
          const budgetNs = step.namespace || 'agentgateway-system';
          const budgetService = step.service || 'budget-management';
          const budgetPort = step.port || 8080;
          const localPort = step.localPort || 18081;

          spinner.setText(`Resetting budget usage for ${entityType}/${name}...`);

          const { cleanup } = await this.startPortForward(
            budgetNs,
            budgetService,
            localPort,
            budgetPort,
            'reset-budget-usage'
          );

          try {
            const listResult = await CommandRunner.run(
              'curl',
              ['-s', '--max-time', '10', `http://localhost:${localPort}/api/v1/budgets`],
              { ignoreError: true }
            );

            const response = JSON.parse(listResult.stdout || '{"budgets":[]}');
            const budgets = response.budgets || [];
            const budget = budgets.find(b => b.entity_type === entityType && b.name === name);

            if (!budget) {
              throw new Error(`reset-budget-usage: budget not found for ${entityType}/${name}`);
            }

            await CommandRunner.run(
              'curl',
              [
                '-s',
                '--max-time',
                '10',
                '-X',
                'POST',
                `http://localhost:${localPort}/api/v1/budgets/${budget.id}/reset`,
              ],
              { ignoreError: true }
            );

            spinner.setText(`Budget usage reset for ${entityType}/${name}`);
          } finally {
            await cleanup();
          }
          break;
        }

        case 'set-budget': {
          const entityType = step.entityType || 'provider';
          const name = step.name || 'openai';
          const amount = step.amount != null ? step.amount : 5.0;
          const budgetNs = step.namespace || 'agentgateway-system';
          const budgetService = step.service || 'budget-management';
          const budgetPort = step.port || 8080;
          const localPort = step.localPort || 18080;

          spinner.setText(`Setting budget for ${entityType}/${name} to $${amount}...`);

          const { cleanup } = await this.startPortForward(
            budgetNs,
            budgetService,
            localPort,
            budgetPort,
            'set-budget'
          );

          try {
            const listResult = await CommandRunner.run(
              'curl',
              ['-s', '--max-time', '10', `http://localhost:${localPort}/api/v1/budgets`],
              { ignoreError: true }
            );

            const response = JSON.parse(listResult.stdout || '{"budgets":[]}');
            const budgets = response.budgets || [];
            const budget = budgets.find(b => b.entity_type === entityType && b.name === name);

            if (!budget) {
              throw new Error(`set-budget: budget not found for ${entityType}/${name}`);
            }

            const updateBody = JSON.stringify({
              entity_type: entityType,
              name: name,
              budget_amount_usd: amount,
              period: budget.period || 'daily',
              match_expression: budget.match_expression || 'true',
              warning_threshold_pct: budget.warning_threshold_pct || 80,
            });

            const updateResult = await CommandRunner.run(
              'curl',
              [
                '-s',
                '--max-time',
                '10',
                '-X',
                'PUT',
                `http://localhost:${localPort}/api/v1/budgets/${budget.id}`,
                '-H',
                'Content-Type: application/json',
                '-d',
                updateBody,
              ],
              { ignoreError: true }
            );

            const updateStatus = updateResult.stdout ? JSON.parse(updateResult.stdout) : {};
            if (updateStatus.error) {
              throw new Error(`set-budget: ${updateStatus.error}`);
            }

            spinner.setText(`Budget set to $${amount} for ${entityType}/${name}`);
          } finally {
            await cleanup();
          }
          break;
        }

        case 'create-budget': {
          const entityType = step.entityType || 'provider';
          const name = step.name;
          const amount = step.amount || 10.0;
          const period = step.period || 'daily';
          const matchExpression = step.matchExpression || 'true';
          const warningThresholdPct = step.warningThresholdPct || 80;
          const description = step.description || `Budget for ${entityType}:${name}`;
          const budgetNs = step.namespace || 'agentgateway-system';
          const budgetService = step.service || 'budget-management';
          const budgetPort = step.port || 8080;
          const localPort = step.localPort || 18082;

          if (!name) {
            throw new Error('create-budget: name is required');
          }

          spinner.setText(`Creating budget for ${entityType}/${name} ($${amount}/${period})...`);

          const { cleanup } = await this.startPortForward(
            budgetNs,
            budgetService,
            localPort,
            budgetPort,
            'create-budget'
          );

          try {
            const createBody = JSON.stringify({
              entity_type: entityType,
              name: name,
              budget_amount_usd: amount,
              period: period,
              match_expression: matchExpression,
              warning_threshold_pct: warningThresholdPct,
              description: description,
            });

            const createResult = await CommandRunner.run(
              'curl',
              [
                '-s',
                '--max-time',
                '10',
                '-X',
                'POST',
                `http://localhost:${localPort}/api/v1/budgets`,
                '-H',
                'Content-Type: application/json',
                '-d',
                createBody,
              ],
              { ignoreError: true }
            );

            const result = createResult.stdout ? JSON.parse(createResult.stdout) : {};
            if (result.error) {
              Logger.warn(`create-budget: ${result.error.message || result.error}`);
            } else {
              spinner.setText(`Budget created: ${entityType}/${name} = $${amount}/${period}`);
            }
          } finally {
            await cleanup();
          }
          break;
        }

        case 'delete-budget': {
          const entityType = step.entityType || 'provider';
          const name = step.name;
          const budgetNs = step.namespace || 'agentgateway-system';
          const budgetService = step.service || 'budget-management';
          const budgetPort = step.port || 8080;
          const localPort = step.localPort || 18083;

          if (!name) {
            throw new Error('delete-budget: name is required');
          }

          spinner.setText(`Deleting budget for ${entityType}/${name}...`);

          const { cleanup } = await this.startPortForward(
            budgetNs,
            budgetService,
            localPort,
            budgetPort,
            'delete-budget'
          );

          try {
            const listResult = await CommandRunner.run(
              'curl',
              ['-s', '--max-time', '10', `http://localhost:${localPort}/api/v1/budgets`],
              { ignoreError: true }
            );

            const response = JSON.parse(listResult.stdout || '{"budgets":[]}');
            const budgets = response.budgets || [];
            const budget = budgets.find(b => b.entity_type === entityType && b.name === name);

            if (budget) {
              await CommandRunner.run(
                'curl',
                [
                  '-s',
                  '--max-time',
                  '10',
                  '-X',
                  'DELETE',
                  `http://localhost:${localPort}/api/v1/budgets/${budget.id}`,
                ],
                { ignoreError: true }
              );
              spinner.setText(`Budget deleted: ${entityType}/${name}`);
            } else {
              spinner.setText(`Budget not found: ${entityType}/${name} (skipping delete)`);
            }
          } finally {
            await cleanup();
          }
          break;
        }

        default:
          spinner.clear();
          Logger.warn(`Unknown test action: ${action}`);
          spinner.render();
      }
    }
  }

  /**
   * Obtain a token via the browser-based Authorization Code + PKCE flow.
   */
  static async getTokenViaBrowser(step) {
    const kc = step.keycloak || {};
    const realm = kc.realm || 'agw-dev';
    const clientId = kc.clientId || 'agw-client-public';
    const hostname = kc.hostname || 'keycloak.keycloak.svc.cluster.local';
    const loginTimeout = kc.timeout || 240000;

    const keycloakBase = `https://${hostname}`;

    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const { callbackPort, codePromise, server } = await this.startCallbackServer(loginTimeout);

    const redirectUri = `http://localhost:${callbackPort}/callback`;
    const authorizeUrl =
      `${keycloakBase}/realms/${realm}/protocol/openid-connect/auth?` +
      `client_id=${encodeURIComponent(clientId)}` +
      '&response_type=code' +
      '&scope=openid' +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code_challenge=${codeChallenge}` +
      '&code_challenge_method=S256';

    const openCmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(openCmd, [authorizeUrl], { stdio: 'ignore', detached: true }).unref();

    Logger.info(`Waiting for login (timeout: ${loginTimeout / 1000}s)...`);

    const authCode = await codePromise;
    server.close();

    Logger.debug(`Auth code received: ${authCode.substring(0, 20)}...`);
    Logger.debug(`Client ID: ${clientId}`);
    Logger.debug(`Redirect URI: ${redirectUri}`);

    const clientSecret = kc.clientSecret || process.env.KEYCLOAK_SECRET || '';
    const tokenUrl = `${keycloakBase}/realms/${realm}/protocol/openid-connect/token`;
    const tokenParts = [
      'grant_type=authorization_code',
      `client_id=${encodeURIComponent(clientId)}`,
      `code=${encodeURIComponent(authCode)}`,
      `redirect_uri=${encodeURIComponent(redirectUri)}`,
      `code_verifier=${encodeURIComponent(codeVerifier)}`,
    ];
    if (clientSecret) tokenParts.push(`client_secret=${encodeURIComponent(clientSecret)}`);
    const tokenBody = tokenParts.join('&');

    Logger.debug(`Token URL: ${tokenUrl}`);
    Logger.debug(`Token body: ${tokenBody.substring(0, 200)}...`);

    const result = await CommandRunner.run(
      'curl',
      [
        '-sSk',
        '--max-time',
        '10',
        '-X',
        'POST',
        tokenUrl,
        '-H',
        'Content-Type: application/x-www-form-urlencoded',
        '-d',
        tokenBody,
      ],
      { ignoreError: true }
    );

    const body = (result.stdout || '').trim();
    const curlErr = (result.stderr || '').trim();

    Logger.debug(`Token response length: ${body.length} chars`);
    if (curlErr) Logger.debug(`Token curl stderr: ${curlErr}`);

    if (!body) {
      throw new Error('Token exchange failed: empty response from Keycloak');
    }

    let tokenResp;
    try {
      tokenResp = JSON.parse(body);
    } catch (e) {
      throw new Error(
        `Token exchange: invalid JSON response from Keycloak: ${body.substring(0, 200)}`
      );
    }

    if (tokenResp.error) {
      throw new Error(`Token exchange failed: ${tokenResp.error_description || tokenResp.error}`);
    }

    if (!tokenResp.access_token) {
      throw new Error('Token exchange: no access_token in response');
    }

    return tokenResp.access_token;
  }

  /**
   * Obtain a token via password grant (resource owner credentials) or client_credentials grant.
   */
  static async getTokenViaPasswordGrant(step) {
    const kc = step.keycloak || {};
    const realm = kc.realm || 'agw-dev';
    const clientId = kc.clientId || 'agw-client-public';
    const hostname = kc.hostname || 'keycloak.keycloak.svc.cluster.local';
    const grantType = kc.grantType || 'password';

    const keycloakBase = `https://${hostname}`;
    const tokenUrl = `${keycloakBase}/realms/${realm}/protocol/openid-connect/token`;

    const tokenParts = [`grant_type=${grantType}`, `client_id=${encodeURIComponent(clientId)}`];

    if (grantType === 'password') {
      const username = kc.username || process.env.KEYCLOAK_USERNAME;
      const password = kc.password || process.env.KEYCLOAK_PASSWORD;
      if (!username || !password) {
        throw new Error(
          'password grant requires username and password (set via step config or KEYCLOAK_USERNAME/KEYCLOAK_PASSWORD env vars)'
        );
      }
      tokenParts.push(`username=${encodeURIComponent(username)}`);
      tokenParts.push(`password=${encodeURIComponent(password)}`);
    }

    const clientSecret = kc.clientSecret || process.env.KEYCLOAK_SECRET;
    if (clientSecret) {
      tokenParts.push(`client_secret=${encodeURIComponent(clientSecret)}`);
    }

    const tokenBody = tokenParts.join('&');

    const result = await CommandRunner.run(
      'curl',
      [
        '-sSk',
        '--max-time',
        '10',
        '-X',
        'POST',
        tokenUrl,
        '-H',
        'Content-Type: application/x-www-form-urlencoded',
        '-d',
        tokenBody,
      ],
      { ignoreError: true }
    );

    const body = (result.stdout || '').trim();
    if (!body) {
      throw new Error(`${grantType} grant failed: empty response from Keycloak`);
    }

    let tokenResp;
    try {
      tokenResp = JSON.parse(body);
    } catch (e) {
      throw new Error(`${grantType} grant: invalid JSON response`);
    }

    if (tokenResp.error) {
      throw new Error(
        `${grantType} grant failed: ${tokenResp.error_description || tokenResp.error}`
      );
    }

    if (!tokenResp.access_token) {
      throw new Error(`${grantType} grant: no access_token in response`);
    }

    return tokenResp.access_token;
  }

  /**
   * Get a session cookie via browser-based OAuth2 + session flow.
   */
  static async getSessionCookie(gatewayAddress, gatewayPort, step) {
    const oauth = step.oauth2 || {};
    const callbackPath = oauth.callbackPath || '/callback';
    const loginTimeout = oauth.timeout || 240000;

    const gatewayBase = `http://${gatewayAddress}:${gatewayPort}`;
    const startPath = oauth.startPath || '/openai/v1/chat/completions';
    const startUrl = `${gatewayBase}${startPath}`;

    const openCmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';

    Logger.info(`Opening browser to initiate OAuth2 flow: ${startUrl}`);
    spawn(openCmd, [startUrl], { stdio: 'ignore', detached: true }).unref();

    Logger.info(
      `Waiting for OAuth2 callback at ${callbackPath} (timeout: ${loginTimeout / 1000}s)...`
    );

    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        if (req.url?.startsWith(callbackPath)) {
          const cookies = req.headers.cookie || '';
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Session obtained! You may close this tab.</h1></body></html>');
          server.close();
          resolve(cookies);
        }
      });
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        Logger.info(`Callback server listening on http://localhost:${port}${callbackPath}`);
      });
      setTimeout(() => {
        server.close();
        reject(new Error('Session cookie timeout: no callback received'));
      }, loginTimeout);
    });
  }

  /**
   * Start a local callback server for OAuth2 flows.
   */
  static startCallbackServer(timeout) {
    return new Promise((resolve, reject) => {
      let codeResolve;
      let codeReject;
      const codePromise = new Promise((res, rej) => {
        codeResolve = res;
        codeReject = rej;
      });

      const server = createServer((req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');
          const errorDesc = url.searchParams.get('error_description');

          res.writeHead(200, { 'Content-Type': 'text/html' });
          if (error) {
            res.end(`<html><body><h1>Error: ${error}</h1><p>${errorDesc || ''}</p></body></html>`);
            codeReject(new Error(`OAuth error: ${error} - ${errorDesc}`));
          } else if (code) {
            res.end('<html><body><h1>Login successful! You may close this tab.</h1></body></html>');
            codeResolve(code);
          } else {
            res.end('<html><body><h1>No code received</h1></body></html>');
            codeReject(new Error('No authorization code in callback'));
          }
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        Logger.debug(`Callback server listening on port ${port}`);
        resolve({ callbackPort: port, codePromise, server });
      });

      setTimeout(() => {
        server.close();
        codeReject(new Error('Login timeout'));
      }, timeout);
    });
  }

  /**
   * Send an HTTP request to the gateway
   */
  static async sendHttpRequest(gateway, step, spinner, timeout = 15000, port = 8080) {
    const endpoint = step.endpoint || '/openai/v1/chat/completions';
    const method = step.method || 'POST';
    const headers = step.headers || {};
    const prompt = step.prompt || 'Hello';
    const model = step.model;

    let body;
    if (step.body) {
      body = typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
    } else if (step.input !== undefined) {
      body = JSON.stringify({ ...(model !== undefined && { model }), input: step.input });
    } else {
      body = JSON.stringify({
        ...(model !== undefined && { model }),
        messages: [{ role: 'user', content: prompt }],
      });
    }

    const url = `http://${gateway}:${port}${endpoint}`;

    const headerArgs = [];
    if (!headers['Content-Type']) {
      headerArgs.push('-H', 'Content-Type: application/json');
    }
    for (const [k, v] of Object.entries(headers)) {
      headerArgs.push('-H', `${k}: ${v}`);
    }

    const curlArgs = [
      '-s',
      '--max-time',
      String(Math.ceil(timeout / 1000)),
      '-X',
      method,
      url,
      ...headerArgs,
      '-d',
      body,
      '-w',
      '\n%{http_code}',
      '-D',
      '/dev/stderr',
    ];

    Logger.debug(`curl command: curl ${curlArgs.join(' ')}`);

    const result = await CommandRunner.run('curl', curlArgs, { ignoreError: true });

    const raw = (result.stdout || '').trim();
    const lines = raw.split('\n');
    const httpStatus = parseInt(lines[lines.length - 1], 10);
    const responseBody = lines.slice(0, -1).join('\n').trim();

    const responseHeaders = {};
    // Split by \r\n or \n to handle HTTP headers properly
    const stderrLines = (result.stderr || '').split(/\r?\n/);
    for (const line of stderrLines) {
      // Remove any trailing \r and match header pattern
      const cleanLine = line.replace(/\r$/, '');
      const match = cleanLine.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        responseHeaders[match[1].toLowerCase()] = match[2].trim();
      }
    }

    // Debug: log captured headers
    const headerKeys = Object.keys(responseHeaders);
    if (headerKeys.length > 0) {
      Logger.debug(`Captured response headers: ${headerKeys.join(', ')}`);
    } else {
      Logger.debug(
        `No response headers captured. stderr: ${(result.stderr || '').substring(0, 200)}`
      );
    }

    return {
      status: httpStatus,
      body: responseBody,
      response: { status: httpStatus, body: responseBody },
      responseHeaders,
      requestInfo: {
        method,
        url,
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
      },
    };
  }

  /**
   * Send an MCP request to the gateway
   */
  static async sendMcpRequest(gateway, step, spinner, timeout = 30000, port = 8080) {
    const endpoint = step.endpoint || '/mcp';
    const method = step.method || 'tools/list';
    const params = step.params || {};
    const headers = step.headers || {};

    const url = `http://${gateway}:${port}${endpoint}`;

    const mcpRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    };

    const body = JSON.stringify(mcpRequest);

    const headerArgs = ['-H', 'Content-Type: application/json'];
    for (const [k, v] of Object.entries(headers)) {
      headerArgs.push('-H', `${k}: ${v}`);
    }

    const curlArgs = [
      '-s',
      '--max-time',
      String(Math.ceil(timeout / 1000)),
      '-X',
      'POST',
      url,
      ...headerArgs,
      '-d',
      body,
      '-w',
      '\n%{http_code}',
      '-D',
      '/dev/stderr',
    ];

    Logger.debug(`MCP curl command: curl ${curlArgs.join(' ')}`);

    const result = await CommandRunner.run('curl', curlArgs, { ignoreError: true });

    const raw = (result.stdout || '').trim();
    const lines = raw.split('\n');
    const httpStatus = parseInt(lines[lines.length - 1], 10);
    const responseBody = lines.slice(0, -1).join('\n').trim();

    const responseHeaders = {};
    // Split by \r\n or \n to handle HTTP headers properly
    const stderrLines = (result.stderr || '').split(/\r?\n/);
    for (const line of stderrLines) {
      // Remove any trailing \r and match header pattern
      const cleanLine = line.replace(/\r$/, '');
      const match = cleanLine.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        responseHeaders[match[1].toLowerCase()] = match[2].trim();
      }
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(responseBody);
    } catch {
      parsedBody = responseBody;
    }

    return {
      status: httpStatus,
      body: parsedBody,
      response: { status: httpStatus, body: parsedBody },
      responseHeaders,
      requestInfo: {
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: mcpRequest,
      },
    };
  }

  /**
   * Verify response against expected values
   */
  static async verifyResponse(response, body, status, step, spinner) {
    const { expect = {} } = step;

    // Handle statusCode as an alias for numeric status check
    if (expect.statusCode !== undefined) {
      if (status !== expect.statusCode) {
        throw new Error(`Expected status code ${expect.statusCode}, got ${status}`);
      }
    }

    if (expect.status === 'success') {
      if (status < 200 || status >= 300) {
        throw new Error(`Expected success status (2xx), got ${status}`);
      }
    } else if (expect.status === 'blocked') {
      if (status !== 403) {
        throw new Error(`Expected blocked status (403), got ${status}`);
      }
    } else if (expect.status === 'error') {
      if (status < 400) {
        throw new Error(`Expected error status (4xx or 5xx), got ${status}`);
      }
    } else if (typeof expect.status === 'number') {
      if (status !== expect.status) {
        throw new Error(`Expected status ${expect.status}, got ${status}`);
      }
    }

    if (expect.contains) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      Logger.debug(`Response body:\n${bodyStr.substring(0, 2000)}`);
      const items = Array.isArray(expect.contains) ? expect.contains : [expect.contains];
      const lowerBody = bodyStr.toLowerCase();
      for (const item of items) {
        if (!lowerBody.includes(String(item).toLowerCase())) {
          throw new Error(`Response does not contain expected text: "${item}"`);
        }
      }
    }

    if (expect.piiRedacted === true) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      const piiPatterns = [
        /\d{3}-\d{2}-\d{4}/,
        /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/,
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
      ];

      for (const pattern of piiPatterns) {
        if (pattern.test(bodyStr)) {
          spinner.clear();
          Logger.warn('Warning: Potential unredacted PII found in response');
          spinner.render();
        }
      }
    }

    if (expect.reason) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      if (!bodyStr.toLowerCase().includes(expect.reason.toLowerCase())) {
        throw new Error(`Response does not contain expected reason: "${expect.reason}"`);
      }
    }

    if (expect.mcpResult) {
      const result = typeof body === 'object' ? body : JSON.parse(body);
      if (!result.result) {
        throw new Error('MCP response missing result field');
      }

      if (expect.mcpResult.tools) {
        const tools = result.result.tools || [];
        for (const expectedTool of expect.mcpResult.tools) {
          const found = tools.some(t => t.name === expectedTool);
          if (!found) {
            throw new Error(`Expected MCP tool '${expectedTool}' not found in response`);
          }
        }
      }

      if (expect.mcpResult.content) {
        const content = result.result.content || [];
        const contentText = content
          .map(c => c.text || '')
          .join(' ')
          .toLowerCase();
        for (const expectedContent of expect.mcpResult.content) {
          if (!contentText.includes(expectedContent.toLowerCase())) {
            throw new Error(`Expected content '${expectedContent}' not found in MCP response`);
          }
        }
      }
    }

    if (expect.headers) {
      const respHeaders = response.headers || {};
      for (const [key, expectedValue] of Object.entries(expect.headers)) {
        const actualValue = respHeaders[key.toLowerCase()];
        if (actualValue === undefined) {
          throw new Error(`Expected header '${key}' not found in response`);
        }
        if (expectedValue !== '*' && actualValue !== expectedValue) {
          throw new Error(`Header '${key}': expected '${expectedValue}', got '${actualValue}'`);
        }
      }
    }
  }

  /**
   * Start a port-forward process with proper error handling
   * @param {string} namespace - K8s namespace
   * @param {string} service - Service name
   * @param {number} localPort - Local port
   * @param {number} remotePort - Remote port
   * @param {string} actionName - Action name for error messages
   * @returns {Promise<{process: ChildProcess, cleanup: () => Promise<void>}>}
   */
  static async startPortForward(namespace, service, localPort, remotePort, actionName) {
    let stderrOutput = '';
    const pfProc = spawn(
      'kubectl',
      ['port-forward', '-n', namespace, `svc/${service}`, `${localPort}:${remotePort}`],
      { stdio: 'pipe' }
    );

    pfProc.stderr.on('data', data => {
      stderrOutput += data.toString();
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${actionName}: port-forward timed out`)),
        15000
      );
      pfProc.stdout.on('data', data => {
        if (data.toString().includes('Forwarding from')) {
          clearTimeout(timer);
          resolve();
        }
      });
      pfProc.on('error', err => {
        clearTimeout(timer);
        reject(err);
      });
      pfProc.on('close', code => {
        if (code !== null) {
          clearTimeout(timer);
          const detail = stderrOutput.trim() || `exit code ${code}`;
          reject(new Error(`${actionName}: port-forward failed: ${detail}`));
        }
      });
    });

    const cleanup = async () => {
      pfProc.kill();
      // Small delay to allow OS to release the port
      await new Promise(r => setTimeout(r, 100));
    };

    return { process: pfProc, cleanup };
  }

  /**
   * Get gateway address from Kubernetes service
   */
  static async getGatewayAddress(namespace, gatewayName = 'agentgateway') {
    try {
      const result = await KubernetesHelper.kubectl(
        [
          'get',
          'svc',
          gatewayName,
          '-n',
          namespace,
          '-o',
          'jsonpath={.status.loadBalancer.ingress[0].ip}',
        ],
        { ignoreError: true }
      );

      let address = (result.stdout || '').trim();

      if (!address) {
        const hostnameResult = await KubernetesHelper.kubectl(
          [
            'get',
            'svc',
            gatewayName,
            '-n',
            namespace,
            '-o',
            'jsonpath={.status.loadBalancer.ingress[0].hostname}',
          ],
          { ignoreError: true }
        );
        address = (hostnameResult.stdout || '').trim();
      }

      if (!address) {
        address = 'localhost';
      }

      return address;
    } catch {
      return 'localhost';
    }
  }
}
