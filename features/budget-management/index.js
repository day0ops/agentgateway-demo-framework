import { Feature, FeatureManager } from '../../src/lib/feature.js';
import { KubernetesHelper, Logger } from '../../src/lib/common.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const execAsync = promisify(exec);

const DEFAULT_KEYCLOAK_REALM = 'agw-dev';
const DEFAULT_KEYCLOAK_HOST = 'keycloak.keycloak.svc.cluster.local';
const DEFAULT_TLS_SECRET_NAME = 'budget-management-tls-secret';
const DEFAULT_TLS_HOSTNAME = 'localhost';

/**
 * Budget Management Feature
 *
 * Implements cost-based budget limiting for LLM requests using an ext-proc server.
 * Unlike traditional rate limiting (requests/minute or tokens/minute), this system
 * enforces budgets measured in USD.
 *
 * Configuration:
 * {
 *   deployInfra: boolean,       // Deploy PostgreSQL and budget-management service (default: true)
 *   serviceType: string,        // Kubernetes service type for budget-management (default: 'ClusterIP')
 *   uiPath: string,             // Path prefix for the UI (default: '/budget')
 *   enableCORS: boolean,        // Enable CORS for the UI (default: false, requires KGW_ENABLE_GATEWAY_API_EXPERIMENTAL_FEATURES=true)
 *   enableAuth: boolean,        // Enable OIDC authentication via AgentGateway + ext-auth (default: false)
 *   auth: {
 *     clientId: string,         // OIDC client ID (default: 'budget-management')
 *     clientSecret: string,     // OIDC client secret (default: 'budget-management-secret')
 *     realm: string,            // Keycloak realm (default: 'agw-dev')
 *     issuerUrl: string,        // OIDC issuer URL (default: 'https://keycloak.keycloak.svc.cluster.local/realms/agw-dev/')
 *     appUrl: string,           // Public app URL (auto-detected if not specified)
 *     callbackPath: string,     // Callback path for auth redirect (default: '${uiPath}/callback')
 *     logoutPath: string,       // Logout path relative to appUrl (default: '/logout')
 *     extAuthBackend: string,   // Ext-auth service backend name (default: 'ext-auth-service-enterprise-agentgateway')
 *     sessionCacheHost: string, // Redis session cache host:port (default: 'ext-cache-enterprise-agentgateway:6379')
 *   },
 *   enableTLS: boolean,         // Enable TLS via cert-manager (default: false)
 *   useListenerSet: boolean,    // Use ListenerSet for HTTPS listener (default: false, uses Gateway listener patch)
 *   tls: {
 *     secretName: string,       // TLS secret name (default: 'budget-management-tls-secret')
 *     hostname: string,         // Hostname for TLS certificate (default: 'localhost')
 *     issuerRef: {              // Certificate issuer reference
 *       name: string,           // Issuer name (default: 'selfsigned-issuer')
 *       kind: string,           // Issuer kind (default: 'ClusterIssuer')
 *     },
 *     additionalDnsNames: [],   // Additional DNS names for the certificate
 *   },
 *   createBudget: {             // Optional: Create a budget on deploy
 *     amount: number,           // Budget amount in USD (required if createBudget is specified)
 *     period: string,           // Budget period: 'hourly' | 'daily' | 'weekly' | 'monthly' (default: 'daily')
 *     entityType: string,       // Entity type: 'provider' | 'org' | 'team' (default: 'provider')
 *     name: string,             // Entity name (default: 'openai')
 *     matchExpression: string,  // CEL expression for matching requests (default: 'true')
 *     warningThresholdPct: number, // Warning threshold percentage (default: 80)
 *     description: string,      // Optional description for the budget
 *   },
 * }
 */
export class BudgetManagementFeature extends Feature {
  validate() {
    const { createBudget } = this.config;

    // If createBudget is specified, validate its required fields
    if (createBudget) {
      if (createBudget.amount === undefined || createBudget.amount === null) {
        throw new Error('createBudget.amount is required when createBudget is specified');
      }
      if (typeof createBudget.amount !== 'number' || createBudget.amount <= 0) {
        throw new Error('createBudget.amount must be a positive number');
      }
    }

    return true;
  }

  get budgetManagementName() {
    return 'budget-management';
  }

  get policyName() {
    return `${this.budgetManagementName}-policy`;
  }

  get serviceName() {
    return 'budget-management';
  }

  get authConfigName() {
    return 'budget-management-auth';
  }

  get authPolicyName() {
    return 'budget-management-auth-policy';
  }

  get authSecretName() {
    return 'budget-management-oauth';
  }

  get httpRouteName() {
    return 'budget-management-ui';
  }

  get listenerSetName() {
    return 'budget-management-https';
  }

  get useListenerSet() {
    return this.config.useListenerSet === true;
  }

  async inferProviderHttpRouteName() {
    if (this.dryRun) return null;

    try {
      const result = await KubernetesHelper.kubectl(
        [
          'get',
          'httproute',
          '-n',
          this.namespace,
          '-l',
          'agentgateway.dev/provider',
          '-o',
          'jsonpath={.items[0].metadata.name}',
        ],
        { ignoreError: true }
      );
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  get certificateName() {
    return 'budget-management-tls';
  }

  get tlsSecretName() {
    return this.config.tls?.secretName || DEFAULT_TLS_SECRET_NAME;
  }

  get tlsHostname() {
    return this.config.tls?.hostname || DEFAULT_TLS_HOSTNAME;
  }

  get tlsPort() {
    return this.config.tls?.port ?? 443;
  }

  get uiPath() {
    return this.config.uiPath || '/budget';
  }

  get enableCORS() {
    // CORS requires Gateway API experimental features (KGW_ENABLE_GATEWAY_API_EXPERIMENTAL_FEATURES=true)
    return this.config.enableCORS === true;
  }

  async deploy() {
    const {
      deployInfra = true,
      enableAuth = false,
      enableTLS = false,
      createBudget: budgetConfig,
    } = this.config;

    // Deploy TLS certificate if enabled
    if (enableTLS) {
      await this.deployTLS();
    }

    // Deploy PostgreSQL and budget-management service if needed
    if (deployInfra) {
      await this.deployInfrastructure(enableAuth);
    }

    // Apply the EnterpriseAgentgatewayPolicy for ext-proc
    await this.applyExtProcPolicy();

    // Always deploy HTTPRoute (needed for CORS, TLS, and auth routing)
    await this.deployHTTPRoute();

    // Deploy auth if enabled
    if (enableAuth) {
      await this.deployAuth();
    }

    // Create the budget via HTTP API if configured
    if (budgetConfig) {
      const {
        amount,
        period = 'daily',
        entityType = 'provider',
        name = 'openai',
        matchExpression = 'true',
        warningThresholdPct = 80,
        description = '',
      } = budgetConfig;

      await this.createBudget({
        entityType,
        name,
        matchExpression,
        budgetAmount: amount,
        period,
        warningThresholdPct,
        description,
      });
    }
  }

  async deployInfrastructure(enableAuth = false) {
    if (this.dryRun) {
      // In dry-run mode, just collect the YAML without waiting
      await this.collectInfraYaml(enableAuth);
      return;
    }

    this.log('Deploying budget-management infrastructure...');

    await this.deployWithKubectl(enableAuth);

    // Deploy PodMonitor for metrics scraping if CRD exists
    await this.deployPodMonitor();
  }

  async collectInfraYaml(enableAuth = false) {
    const configDir = join(__dirname, 'config');

    // Collect PostgreSQL YAML
    const postgresPath = join(configDir, 'postgres.yaml');
    const postgresYaml = await fs.readFile(postgresPath, 'utf8');
    if (this._dryRunYaml) {
      this._dryRunYaml.push(postgresYaml);
    }

    // Collect deployment YAML with substitutions
    const deploymentPath = join(configDir, 'deployment.yaml');
    const imageRepo = process.env.IMAGE_REPO || '';
    const imagePrefix = imageRepo ? `${imageRepo}/` : '';
    const imageTag = process.env.IMAGE_TAG || 'latest';
    const fullImage = `${imagePrefix}budget-management:${imageTag}`;

    let deploymentYaml = await fs.readFile(deploymentPath, 'utf8');
    deploymentYaml = deploymentYaml.replace(
      /image: budget-management:latest/g,
      `image: ${fullImage}`
    );

    const serviceType = this.config.serviceType || 'ClusterIP';
    if (serviceType !== 'ClusterIP') {
      deploymentYaml = deploymentYaml.replace(/type: ClusterIP/g, `type: ${serviceType}`);
    }

    if (enableAuth) {
      deploymentYaml = deploymentYaml.replace(
        /value: "false"(\s+# AUTH_ENABLED)/g,
        'value: "true"$1'
      );
    }

    if (this._dryRunYaml) {
      this._dryRunYaml.push(deploymentYaml);
    }
  }

  async deployPodMonitor() {
    // Check if PodMonitor CRD exists
    try {
      const result = await KubernetesHelper.kubectl(
        ['get', 'crd', 'podmonitors.monitoring.coreos.com'],
        { ignoreError: true }
      );

      if (result.exitCode !== 0) {
        this.log('PodMonitor CRD not found, skipping metrics scraping setup', 'info');
        return;
      }

      this.log('PodMonitor CRD found, deploying metrics scraping...');
      await this.applyYamlFile('pod-monitor.yaml');
      this.log('PodMonitor deployed for budget-management metrics');
    } catch (error) {
      this.log(`Failed to deploy PodMonitor: ${error.message}`, 'warn');
    }
  }

  async deployWithKubectl(enableAuth = false) {
    const configDir = join(__dirname, 'config');

    // Apply PostgreSQL resources
    const postgresPath = join(configDir, 'postgres.yaml');
    await KubernetesHelper.kubectl(['apply', '-f', postgresPath, '-n', this.namespace]);

    // Wait for PostgreSQL to be ready
    this.log('Waiting for PostgreSQL to be ready...');
    try {
      await KubernetesHelper.kubectl([
        'wait',
        '--for=condition=ready',
        'pod',
        '-l',
        'app=budget-management-postgres',
        '-n',
        this.namespace,
        '--timeout=120s',
      ]);
    } catch (error) {
      this.log('PostgreSQL not ready yet, continuing...', 'warn');
    }

    // Apply deployment resources with image substitution
    const deploymentPath = join(configDir, 'deployment.yaml');
    const imageRepo = process.env.IMAGE_REPO || '';
    const imagePrefix = imageRepo ? `${imageRepo}/` : '';
    const imageTag = process.env.IMAGE_TAG || 'latest';
    const fullImage = `${imagePrefix}budget-management:${imageTag}`;

    let deploymentYaml = await fs.readFile(deploymentPath, 'utf8');
    deploymentYaml = deploymentYaml.replace(
      /image: budget-management:latest/g,
      `image: ${fullImage}`
    );

    const serviceType = this.config.serviceType || 'ClusterIP';
    if (serviceType !== 'ClusterIP') {
      deploymentYaml = deploymentYaml.replace(/type: ClusterIP/g, `type: ${serviceType}`);
    }

    // Set AUTH_ENABLED environment variable if auth is enabled
    if (enableAuth) {
      deploymentYaml = deploymentYaml.replace(
        /value: "false"(\s+# AUTH_ENABLED)/g,
        'value: "true"$1'
      );
    }

    await KubernetesHelper.applyYaml(deploymentYaml);

    // Wait for deployment to be ready
    this.log('Waiting for budget-management to be ready...');
    try {
      await KubernetesHelper.kubectl([
        'rollout',
        'status',
        'deployment/budget-management',
        '-n',
        this.namespace,
        '--timeout=60s',
      ]);
    } catch (error) {
      this.log('Budget-management deployment not ready yet', 'warn');
    }
  }

  async deployAuth() {
    this.log('Deploying OIDC authentication for budget-management UI...');

    const auth = this.config.auth || {};
    const clientId = auth.clientId || 'budget-management';
    const clientSecret = auth.clientSecret || 'budget-management-secret';
    const realm = auth.realm || DEFAULT_KEYCLOAK_REALM;
    const issuerUrl = auth.issuerUrl || `https://${DEFAULT_KEYCLOAK_HOST}/realms/${realm}/`;
    const callbackPath = auth.callbackPath || `${this.uiPath}/callback`;
    const logoutPath = auth.logoutPath || '/logout';

    // Resolve appUrl
    let appUrl = auth.appUrl;
    if (!appUrl) {
      appUrl = await this.resolveAppUrl();
    }

    // Deploy OAuth Secret
    await this.deployOAuthSecret(clientSecret);

    // Deploy AuthConfig
    await this.deployAuthConfig({
      appUrl,
      callbackPath,
      logoutPath,
      clientId,
      issuerUrl,
    });

    // Deploy Auth Policy
    await this.deployAuthPolicy();

    this.log('OIDC authentication deployed for budget-management UI', 'success');
  }

  async deployTLS() {
    this.log('Deploying TLS certificate for budget-management UI...');

    const tls = this.config.tls || {};
    const hostname = tls.hostname || DEFAULT_TLS_HOSTNAME;
    const secretName = tls.secretName || DEFAULT_TLS_SECRET_NAME;
    const issuerRef = tls.issuerRef || { name: 'selfsigned-issuer', kind: 'ClusterIssuer' };
    const additionalDnsNames = tls.additionalDnsNames || [];

    // Build DNS names list
    const dnsNames = [
      hostname,
      `${this.serviceName}.${this.namespace}.svc.cluster.local`,
      ...additionalDnsNames,
    ];

    // Create Certificate resource
    const certificate = {
      apiVersion: 'cert-manager.io/v1',
      kind: 'Certificate',
      metadata: {
        name: this.certificateName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      spec: {
        secretName,
        issuerRef: {
          name: issuerRef.name,
          kind: issuerRef.kind,
        },
        dnsNames,
      },
    };

    await this.applyResource(certificate);
    this.log(`Certificate '${this.certificateName}' created`, 'info');

    // Wait for certificate to be ready
    await this.waitForCertificate();

    if (this.useListenerSet) {
      await this.ensureHTTPSListenerSet();
    } else {
      await this.ensureHTTPSGatewayListener();
    }

    this.log('TLS deployed for budget-management UI', 'success');
  }

  async waitForCertificate() {
    if (this.dryRun) return;

    this.log('Waiting for TLS certificate to be ready...');

    const maxAttempts = 30;
    const delayMs = 2000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await KubernetesHelper.kubectl([
          'get',
          'certificate',
          this.certificateName,
          '-n',
          this.namespace,
          '-o',
          'jsonpath={.status.conditions[?(@.type=="Ready")].status}',
        ]);

        if (result.stdout.trim() === 'True') {
          this.log('TLS certificate is ready', 'info');
          return;
        }
      } catch {
        // Certificate may not exist yet
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    this.log('TLS certificate not ready after timeout, continuing...', 'warn');
  }

  async ensureHTTPSListenerSet() {
    this.log('Ensuring HTTPS ListenerSet...');

    const gatewayRef = FeatureManager.getGatewayRef();

    try {
      await this.applyYamlFile('listenerset.yaml', {
        metadata: { namespace: gatewayRef.namespace },
        spec: {
          parentRef: { name: gatewayRef.name, namespace: gatewayRef.namespace },
          listeners: [
            {
              name: 'https',
              port: this.tlsPort,
              protocol: 'HTTPS',
              hostname: this.tlsHostname,
              tls: {
                mode: 'Terminate',
                certificateRefs: [{ name: this.tlsSecretName, kind: 'Secret' }],
              },
              allowedRoutes: { namespaces: { from: 'All' } },
            },
          ],
        },
      });
      this.log(`ListenerSet '${this.listenerSetName}' applied`, 'info');
    } catch (error) {
      this.log(`Failed to apply ListenerSet: ${error.message}`, 'warn');
    }
  }

  async ensureHTTPSGatewayListener() {
    const gatewayRef = FeatureManager.getGatewayRef();

    const httpsListener = {
      name: 'https',
      port: this.tlsPort,
      protocol: 'HTTPS',
      hostname: this.tlsHostname,
      tls: {
        mode: 'Terminate',
        certificateRefs: [{ name: this.tlsSecretName, kind: 'Secret' }],
      },
      allowedRoutes: { namespaces: { from: 'All' } },
    };

    // In dryRun mode, read default gateway config and merge the HTTPS listener
    if (this.dryRun) {
      try {
        const defaultGatewayPath = join(PROJECT_ROOT, 'config', 'gateway', 'default-gateway.yaml');
        const content = await fs.readFile(defaultGatewayPath, 'utf8');
        const gateway = yaml.load(content);

        // Override with actual gateway ref
        gateway.metadata.name = gatewayRef.name;
        gateway.metadata.namespace = gatewayRef.namespace;

        // Merge HTTPS listener
        const listeners = gateway.spec.listeners || [];
        const existingIdx = listeners.findIndex(l => l.name === 'https');
        if (existingIdx === -1) {
          listeners.push(httpsListener);
        } else {
          listeners[existingIdx] = httpsListener;
        }
        gateway.spec.listeners = listeners;

        await this.applyResource(gateway);
      } catch (error) {
        // Fallback: generate minimal Gateway with just HTTPS listener
        const gateway = {
          apiVersion: 'gateway.networking.k8s.io/v1',
          kind: 'Gateway',
          metadata: {
            name: gatewayRef.name,
            namespace: gatewayRef.namespace,
          },
          spec: {
            gatewayClassName: 'enterprise-agentgateway',
            listeners: [httpsListener],
          },
        };
        await this.applyResource(gateway);
      }
      return;
    }

    this.log('Ensuring HTTPS listener on Gateway...');

    try {
      const result = await KubernetesHelper.kubectl([
        'get',
        'gateway',
        gatewayRef.name,
        '-n',
        gatewayRef.namespace,
        '-o',
        'json',
      ]);
      const gateway = JSON.parse(result.stdout);
      const listeners = gateway.spec.listeners || [];
      const existingIdx = listeners.findIndex(l => l.name === 'https');

      if (existingIdx === -1) {
        listeners.push(httpsListener);
        this.log('HTTPS listener added to Gateway', 'info');
      } else {
        listeners[existingIdx] = httpsListener;
        this.log('HTTPS listener updated on Gateway', 'info');
      }

      gateway.spec.listeners = listeners;
      await this.applyResource(gateway);
    } catch (error) {
      this.log(`Failed to update HTTPS listener on Gateway: ${error.message}`, 'warn');
    }
  }

  async resolveAppUrl() {
    const enableTLS = this.config.enableTLS || false;
    const protocol = enableTLS ? 'https' : 'http';
    const defaultPort = enableTLS ? 8443 : 80;

    // In dryRun mode, return placeholder
    if (this.dryRun) {
      return enableTLS ? 'https://localhost:8443' : 'http://localhost:8080';
    }

    if (process.env.INGRESS_GW_ADDRESS) {
      return `${protocol}://${process.env.INGRESS_GW_ADDRESS}:${defaultPort}`;
    }

    try {
      const gatewayRef = FeatureManager.getGatewayRef();
      const result = await KubernetesHelper.kubectl(
        [
          'get',
          'gateway',
          gatewayRef.name,
          '-n',
          gatewayRef.namespace,
          '-o',
          'jsonpath={.status.addresses[0].value}',
        ],
        { ignoreError: true }
      );

      const addr = result.stdout.trim();
      if (addr) {
        return `${protocol}://${addr}:${defaultPort}`;
      }
    } catch {
      // fall through to default
    }

    Logger.warn('Could not resolve gateway address for appUrl, using localhost fallback');
    return enableTLS ? 'https://localhost:8443' : 'http://localhost:8080';
  }

  async deployHTTPRoute() {
    const gatewayRef = FeatureManager.getGatewayRef();
    const enableTLS = this.config.enableTLS || false;

    let parentRef;
    if (enableTLS && this.useListenerSet) {
      parentRef = {
        name: this.listenerSetName,
        namespace: gatewayRef.namespace,
        kind: 'ListenerSet',
        group: 'gateway.networking.k8s.io',
      };
    } else {
      parentRef = {
        name: gatewayRef.name,
        group: 'gateway.networking.k8s.io',
        kind: 'Gateway',
        ...(enableTLS && { sectionName: 'https' }),
      };
    }

    const rule = {
      matches: [
        {
          path: {
            type: 'PathPrefix',
            value: this.uiPath,
          },
        },
      ],
      ...(this.config.rewritePath
        ? {
            filters: [
              {
                type: 'URLRewrite',
                urlRewrite: {
                  path: {
                    type: 'ReplacePrefixMatch',
                    replacePrefixMatch: this.config.rewritePath,
                  },
                },
              },
            ],
          }
        : {}),
      backendRefs: [
        {
          name: this.serviceName,
          port: 8080,
        },
      ],
    };

    // Add CORS filter (requires Gateway API experimental CRDs and KGW_ENABLE_GATEWAY_API_EXPERIMENTAL_FEATURES=true)
    if (this.enableCORS) {
      rule.filters = rule.filters || [];
      rule.filters.push({
        type: 'CORS',
        cors: {
          allowCredentials: true,
          allowHeaders: ['Origin', 'Authorization', 'Content-Type', 'Accept'],
          allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
          allowOrigins: ['*'],
          exposeHeaders: ['Content-Type', 'X-Budget-Cost-USD', 'X-Budget-Remaining-USD'],
          maxAge: 86400,
        },
      });
    }

    const rules = [rule];

    const enableAuth = this.config.enableAuth || false;
    const callbackPath = (this.config.auth || {}).callbackPath || `${this.uiPath}/callback`;
    if (enableAuth) {
      rules.push({
        matches: [{ path: { type: 'PathPrefix', value: callbackPath } }],
        backendRefs: [{ name: this.serviceName, port: 8080 }],
      });
    }

    const httpRoute = {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'HTTPRoute',
      metadata: {
        name: this.httpRouteName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      spec: {
        parentRefs: [parentRef],
        rules,
      },
    };

    // Add hostname if TLS is enabled
    if (enableTLS) {
      httpRoute.spec.hostnames = [this.tlsHostname];
    }

    await this.applyResource(httpRoute);
    const paths = [this.uiPath, ...(enableAuth ? [callbackPath] : [])];
    this.log(`HTTPRoute '${this.httpRouteName}' created with paths: ${paths.join(', ')}`, 'info');
  }

  async deployOAuthSecret(clientSecret) {
    const secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: this.authSecretName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      type: 'extauth.solo.io/oauth',
      stringData: {
        'client-secret': clientSecret,
      },
    };

    await this.applyResource(secret);
    this.log(`OAuth Secret '${this.authSecretName}' created`, 'info');
  }

  async deployAuthConfig(config) {
    const { appUrl, callbackPath, logoutPath, clientId, issuerUrl } = config;
    const auth = this.config.auth || {};

    const authConfig = {
      apiVersion: 'extauth.solo.io/v1',
      kind: 'AuthConfig',
      metadata: {
        name: this.authConfigName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      spec: {
        configs: [
          {
            oauth2: {
              oidcAuthorizationCode: {
                appUrl,
                callbackPath,
                logoutPath,
                clientId,
                clientSecretRef: {
                  name: this.authSecretName,
                  namespace: this.namespace,
                },
                issuerUrl,
                scopes: ['openid', 'email', 'profile'],
                session: {
                  failOnFetchFailure: true,
                  redis: {
                    cookieName: 'budget-session',
                    options: {
                      host: auth.sessionCacheHost || 'ext-cache-enterprise-agentgateway:6379',
                    },
                  },
                },
                headers: {
                  idTokenHeader: 'jwt',
                },
              },
            },
          },
        ],
      },
    };

    await this.applyResource(authConfig);
    this.log(`AuthConfig '${this.authConfigName}' created`, 'info');
  }

  async deployAuthPolicy() {
    const auth = this.config.auth || {};
    const policy = {
      apiVersion: 'enterpriseagentgateway.solo.io/v1alpha1',
      kind: 'EnterpriseAgentgatewayPolicy',
      metadata: {
        name: this.authPolicyName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      spec: {
        targetRefs: [
          {
            group: 'gateway.networking.k8s.io',
            kind: 'HTTPRoute',
            name: this.httpRouteName,
          },
        ],
        traffic: {
          entExtAuth: {
            authConfigRef: {
              name: this.authConfigName,
              namespace: this.namespace,
            },
            backendRef: {
              name: auth.extAuthBackend || 'ext-auth-service-enterprise-agentgateway',
              namespace: this.namespace,
              port: 8083,
            },
          },
        },
      },
    };

    await this.applyResource(policy);
    this.log(`EnterpriseAgentgatewayPolicy '${this.authPolicyName}' created`, 'info');
  }

  async applyExtProcPolicy() {
    const gatewayRef = FeatureManager.getGatewayRef();
    const providerRouteName = await this.inferProviderHttpRouteName();

    if (providerRouteName) {
      this.log(`Attaching ext-proc policy to provider HTTPRoute '${providerRouteName}'`, 'info');
    } else {
      this.log('No provider HTTPRoute found, attaching ext-proc policy to Gateway', 'warn');
    }

    const targetRef = providerRouteName
      ? {
          group: 'gateway.networking.k8s.io',
          kind: 'HTTPRoute',
          name: providerRouteName,
        }
      : {
          name: gatewayRef.name,
          group: 'gateway.networking.k8s.io',
          kind: 'Gateway',
        };

    const policyOverrides = {
      metadata: { name: this.policyName },
      spec: {
        targetRefs: [targetRef],
        traffic: {
          extProc: {
            backendRef: {
              group: '',
              kind: 'Service',
              name: this.serviceName,
              namespace: this.namespace,
              port: 4444,
            },
          },
        },
      },
    };

    await this.applyYamlFile('ext-proc-policy.yaml', policyOverrides);
  }

  async createBudget(budgetConfig) {
    // Skip budget creation in dryRun mode (requires running service)
    if (this.dryRun) return;

    const {
      entityType,
      name,
      matchExpression,
      budgetAmount,
      period,
      warningThresholdPct,
      description,
    } = budgetConfig;

    // Wait a bit for the service to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Try to create budget via kubectl exec (since we're in cluster)
    const budgetPayload = JSON.stringify({
      entity_type: entityType,
      name: name,
      match_expression: matchExpression,
      budget_amount_usd: budgetAmount,
      period: period,
      warning_threshold_pct: warningThresholdPct,
      description: description || `Budget for ${entityType}:${name}`,
    });

    this.log(`Creating budget: ${entityType}:${name} = $${budgetAmount}/${period}`);

    try {
      // Use kubectl to create a job that posts to the API
      await KubernetesHelper.kubectl([
        'run',
        'budget-create-job',
        '--rm',
        '-i',
        '--restart=Never',
        '-n',
        this.namespace,
        '--image=curlimages/curl:latest',
        '--',
        'curl',
        '-s',
        '-X',
        'POST',
        '-H',
        'Content-Type: application/json',
        '-d',
        budgetPayload,
        `http://${this.serviceName}:8080/api/v1/budgets`,
      ]);
      this.log('Budget created successfully');
    } catch (error) {
      // Budget may already exist, which is fine
      this.log(`Budget creation note: ${error.message}`, 'warn');
    }
  }

  async cleanup() {
    // Delete the ext-proc policy
    await this.deleteResource('EnterpriseAgentgatewayPolicy', this.policyName);

    // Clean up auth resources if they were deployed
    if (this.config.enableAuth) {
      await this.cleanupAuth();
    }

    // Clean up TLS resources if they were deployed
    if (this.config.enableTLS) {
      await this.cleanupTLS();
    }

    // Clean up PodMonitor if it exists
    await this.cleanupPodMonitor();

    // Optionally clean up infrastructure
    if (this.config.cleanupInfra) {
      await this.cleanupInfrastructure();
    }
  }

  async cleanupAuth() {
    this.log('Cleaning up auth resources...');

    await this.deleteResource('EnterpriseAgentgatewayPolicy', this.authPolicyName);
    await this.deleteResource('AuthConfig', this.authConfigName);
    await this.deleteResource('Secret', this.authSecretName);
    await this.deleteResource('HTTPRoute', this.httpRouteName);

    this.log('Auth resources cleaned up', 'info');
  }

  async cleanupTLS() {
    this.log('Cleaning up TLS resources...');

    if (this.useListenerSet) {
      await this.deleteResource('ListenerSet', this.listenerSetName);
    } else {
      // Remove HTTPS listener from Gateway
      const gatewayRef = FeatureManager.getGatewayRef();
      try {
        const result = await KubernetesHelper.kubectl([
          'get',
          'gateway',
          gatewayRef.name,
          '-n',
          gatewayRef.namespace,
          '-o',
          'json',
        ]);
        const gateway = JSON.parse(result.stdout);
        gateway.spec.listeners = (gateway.spec.listeners || []).filter(l => l.name !== 'https');
        await this.applyResource(gateway);
        this.log('HTTPS listener removed from Gateway', 'info');
      } catch (error) {
        this.log(`Failed to remove HTTPS listener: ${error.message}`, 'warn');
      }
    }

    // Delete Certificate
    await this.deleteResource('Certificate', this.certificateName);

    // Delete TLS Secret (created by cert-manager)
    await this.deleteResource('Secret', this.tlsSecretName);

    this.log('TLS resources cleaned up', 'info');
  }

  async cleanupPodMonitor() {
    try {
      await KubernetesHelper.kubectl([
        'delete',
        'podmonitor',
        'budget-management-metrics',
        '-n',
        this.namespace,
        '--ignore-not-found',
      ]);
    } catch (error) {
      // Silently ignore - PodMonitor CRD might not exist
    }
  }

  async cleanupInfrastructure() {
    this.log('Cleaning up budget-management infrastructure...');

    try {
      await execAsync('make undeploy-budget-management', {
        cwd: process.cwd(),
        env: { ...process.env, NAMESPACE: this.namespace },
      });
    } catch (error) {
      const configDir = join(__dirname, 'config');

      await KubernetesHelper.kubectl([
        'delete',
        '-f',
        join(configDir, 'deployment.yaml'),
        '-n',
        this.namespace,
        '--ignore-not-found',
      ]);

      await KubernetesHelper.kubectl([
        'delete',
        '-f',
        join(configDir, 'postgres.yaml'),
        '-n',
        this.namespace,
        '--ignore-not-found',
      ]);
    }
  }
}

export function createBudgetManagementFeature(config) {
  return new BudgetManagementFeature('budget-management', config);
}
