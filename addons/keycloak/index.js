import { Feature, FeatureManager } from '../../src/lib/feature.js';
import { KubernetesHelper, CommandRunner } from '../../src/lib/common.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_DIR = join(__dirname, 'config');

const KEYCLOAK_VERSION = '26.5.3';
const POSTGRES_VERSION = '18.2-alpine';

/**
 * Keycloak Feature (manifest-based, no Helm)
 *
 * Deploys Keycloak + PostgreSQL via raw Kubernetes manifests.  After pods are
 * healthy the Keycloak Admin API is used to bootstrap a realm, a single OIDC
 * client, and test users.
 *
 * YAML templates live in ./config/ "and use {{VAR}} placeholders that are
 * resolved at deploy time.
 */
export class KeycloakFeature extends Feature {
  constructor(name, config) {
    super(name, config);
    this.keycloakNamespace = config.keycloakNamespace || 'keycloak';
    this.hostname = config.hostname || 'keycloak.keycloak.svc.cluster.local';
    this.protocol = config.protocol || 'https';
    this.realm = config.realm || 'agw-dev';
    this.clientId = config.clientId || 'agw-client';
    this.clientSecret = config.clientSecret || 'agw-client-secret';
    this.publicClientId = config.publicClientId || 'agw-client-public';
    this.tlsEnabled = config.tls?.enabled !== false;
    this.tlsSecretName = config.tls?.secretName || 'keycloak-tls';
    this.createCertificate = config.tls?.createCertificate !== false;
    this.workloadClients = config.workloadClients || [];
  }

  validate() {
    return true;
  }

  async deploy() {
    this.log('Installing Keycloak (manifest-based)...', 'info');

    await KubernetesHelper.ensureNamespace(this.keycloakNamespace, this.spinner);

    if (this.tlsEnabled && this.createCertificate) {
      await this.applyTemplate('certificate.yaml');
      await this.waitForCertificate();
    }

    await this.applyTemplate('postgres.yaml');
    await this.waitForPostgres();
    await this.initPostgresDb();
    await this.applyTemplate('keycloak.yaml');
    await this.waitForKeycloak();
    await this.setupLocalDns();
    await this.configureKeycloak();

    this.log('Keycloak installed successfully', 'success');
  }

  // ---------------------------------------------------------------------------
  // Template helpers
  // ---------------------------------------------------------------------------

  templateVars() {
    return {
      NAMESPACE: this.keycloakNamespace,
      HOSTNAME: this.hostname,
      KEYCLOAK_VERSION,
      POSTGRES_VERSION,
      TLS_SECRET_NAME: this.tlsSecretName,
    };
  }

  async applyTemplate(filename) {
    const raw = await readFile(join(CONFIG_DIR, filename), 'utf8');
    const vars = this.templateVars();
    const rendered = raw.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (vars[key] === undefined)
        throw new Error(`Unknown template variable: {{${key}}} in ${filename}`);
      return vars[key];
    });

    const docs = yaml.loadAll(rendered).filter(Boolean);
    for (const doc of docs) {
      await this.applyResource(doc);
    }
  }

  // ---------------------------------------------------------------------------
  // Wait helpers
  // ---------------------------------------------------------------------------

  async waitForCertificate() {
    this.log('Waiting for TLS certificate to be ready...', 'info');

    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const result = await KubernetesHelper.kubectl([
          'get',
          'certificate',
          this.tlsSecretName,
          '-n',
          this.keycloakNamespace,
          '-o',
          'jsonpath={.status.conditions[?(@.type=="Ready")].status}',
        ]);
        if (result?.stdout?.trim() === 'True') {
          this.log('TLS certificate is ready', 'info');
          return;
        }
      } catch {
        // certificate may not exist yet
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    this.log('Certificate may not be fully ready yet, proceeding...', 'warn');
  }

  async waitForPostgres() {
    this.log('Waiting for PostgreSQL to be ready...', 'info');
    try {
      await KubernetesHelper.kubectl([
        'wait',
        '--for=condition=Ready',
        'pod',
        '-l',
        'app=postgres',
        '-n',
        this.keycloakNamespace,
        '--timeout=300s',
      ]);
    } catch (error) {
      throw new Error(`PostgreSQL did not become ready: ${error.message}`);
    }
  }

  async initPostgresDb() {
    this.log('Initialising PostgreSQL database...', 'info');
    await new Promise(r => setTimeout(r, 5000));

    const execInPg = async sql => {
      try {
        await KubernetesHelper.kubectl(
          [
            '-n',
            this.keycloakNamespace,
            'exec',
            'deploy/postgres',
            '--',
            'psql',
            '-U',
            'postgres',
            '-d',
            'postgres',
            '-c',
            sql,
          ],
          { ignoreError: true }
        );
      } catch {
        // ignore – object may already exist
      }
    };

    await execInPg('CREATE DATABASE keycloak;');
    await execInPg("CREATE USER keycloak WITH PASSWORD 'password';");
    await execInPg('GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak;');
  }

  async waitForKeycloak() {
    this.log('Waiting for Keycloak to be ready...', 'info');
    try {
      await KubernetesHelper.kubectl([
        'wait',
        '--for=condition=Ready',
        'pod',
        '-l',
        'app=keycloak',
        '-n',
        this.keycloakNamespace,
        '--timeout=600s',
      ]);
    } catch (error) {
      this.log(`Keycloak may not be fully ready: ${error.message}`, 'warn');
    }
  }

  // ---------------------------------------------------------------------------
  // Local DNS (/etc/hosts) so the browser can reach Keycloak via its hostname
  // ---------------------------------------------------------------------------

  async setupLocalDns() {
    this.log('Setting up local DNS for Keycloak...', 'info');

    const lbIp = await this.waitForLoadBalancer();
    if (!lbIp) {
      this.log('Could not resolve LoadBalancer IP — skipping /etc/hosts setup', 'warn');
      return;
    }

    const hostsEntry = `${lbIp} ${this.hostname}`;

    try {
      const check = await CommandRunner.exec(
        `grep -q "${this.hostname}" /etc/hosts 2>/dev/null && echo exists || echo missing`,
        { ignoreError: true }
      );

      if (check.stdout.trim() === 'exists') {
        this.log(`/etc/hosts already contains ${this.hostname}, skipping`, 'info');
        return;
      }

      this.log(`Need to add ${this.hostname} -> ${lbIp} to /etc/hosts`, 'info');
      this.log('Requesting sudo access...', 'info');
      await CommandRunner.exec('sudo -v');

      await CommandRunner.exec(`echo '${hostsEntry}' | sudo tee -a /etc/hosts > /dev/null`);
      this.log(`/etc/hosts: ${this.hostname} -> ${lbIp}`, 'success');
    } catch (error) {
      this.log(`Could not update /etc/hosts: ${error.message}`, 'warn');
      this.log(`Please add manually: ${hostsEntry}`, 'warn');
    }
  }

  async waitForLoadBalancer() {
    this.log('Waiting for Keycloak LoadBalancer IP...', 'info');

    for (let i = 0; i < 60; i++) {
      try {
        const result = await KubernetesHelper.kubectl(
          [
            'get',
            'svc',
            'keycloak',
            '-n',
            this.keycloakNamespace,
            '-o',
            'jsonpath={.status.loadBalancer.ingress[0].ip}{.status.loadBalancer.ingress[0].hostname}',
          ],
          { ignoreError: true }
        );

        const addr = (result.stdout || '').trim();
        if (addr) return addr;
      } catch {
        /* not ready yet */
      }
      await new Promise(r => setTimeout(r, 5000));
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Post-deploy Keycloak configuration via Admin REST API
  // ---------------------------------------------------------------------------

  /**
   * Determine the base URL for Admin API calls.
   * Tries LoadBalancer IP first, falls back to FQDN hostname.
   */
  async getAdminBaseUrl() {
    const lbAddress = await this.waitForLoadBalancer();

    if (lbAddress) {
      const lbUrl = `${this.protocol}://${lbAddress}`;
      // Test connectivity to LB IP
      try {
        const result = await CommandRunner.run(
          'curl',
          ['-sSfk', '--connect-timeout', '5', `${lbUrl}/realms/master`],
          { ignoreError: true }
        );

        if (result.exitCode === 0) {
          this.log(`Using LoadBalancer address for Admin API: ${lbAddress}`, 'info');
          return lbUrl;
        }
      } catch {
        // LB not reachable, fall through to FQDN
      }
    }

    this.log(`Falling back to FQDN for Admin API: ${this.hostname}`, 'info');
    return `${this.protocol}://${this.hostname}`;
  }

  async configureKeycloak() {
    this.log('Configuring Keycloak via Admin API...', 'info');

    const baseUrl = await this.getAdminBaseUrl();
    const token = await this.getAdminToken(baseUrl);

    await this.createRealm(baseUrl, token);
    await this.configureUserProfile(baseUrl, token);

    await this.createConfidentialClient(baseUrl, token);
    await this.createPublicClient(baseUrl, token);
    await this.createBudgetManagementClient(baseUrl, token);
    await this.createUsers(baseUrl, token);

    if (this.workloadClients.length > 0) {
      await this.configureWorkloadClients(baseUrl, token);
    }

    this.log('Keycloak configuration complete', 'info');
  }

  async configureUserProfile(baseUrl, token) {
    this.log('Configuring User Profile attributes...', 'info');

    // Get current user profile config
    const getResult = await CommandRunner.run(
      'curl',
      [
        '-sSfk',
        '-H',
        `Authorization: Bearer ${token}`,
        `${baseUrl}/admin/realms/${this.realm}/users/profile`,
      ],
      { ignoreError: true }
    );

    let profile;
    try {
      profile = JSON.parse(getResult.stdout);
    } catch {
      this.log('Could not parse user profile, using defaults', 'warn');
      profile = { attributes: [] };
    }

    // Custom attributes we need for budget management
    const customAttributes = [
      {
        name: 'group',
        displayName: 'Group',
        permissions: { view: ['admin', 'user'], edit: ['admin'] },
        validations: {},
      },
      {
        name: 'org_id',
        displayName: 'Organization ID',
        permissions: { view: ['admin', 'user'], edit: ['admin'] },
        validations: {},
      },
      {
        name: 'team_id',
        displayName: 'Team ID',
        permissions: { view: ['admin', 'user'], edit: ['admin'] },
        validations: {},
      },
      {
        name: 'is_org',
        displayName: 'Is Org Admin',
        permissions: { view: ['admin', 'user'], edit: ['admin'] },
        validations: {},
      },
    ];

    // Add custom attributes if they don't exist
    const existingNames = new Set(profile.attributes.map(a => a.name));
    for (const attr of customAttributes) {
      if (!existingNames.has(attr.name)) {
        profile.attributes.push(attr);
        this.log(`Adding user profile attribute: ${attr.name}`, 'info');
      }
    }

    // Update the user profile
    await this.kcApi('PUT', `${baseUrl}/admin/realms/${this.realm}/users/profile`, token, profile);
    this.log('User Profile configured', 'info');
  }

  async createBudgetManagementClient(baseUrl, token) {
    this.log('Creating budget-management client...', 'info');

    const payload = {
      clientId: 'budget-management',
      secret: 'budget-management-secret',
      enabled: true,
      publicClient: false,
      standardFlowEnabled: true,
      serviceAccountsEnabled: false,
      directAccessGrantsEnabled: true,
      redirectUris: ['*'],
      webOrigins: ['*'],
      attributes: {
        'post.logout.redirect.uris': '*',
        'access.token.signed.response.alg': 'RS256',
        'id.token.signed.response.alg': 'RS256',
      },
    };

    const result = await this.registerClient(baseUrl, token, payload);
    let id = this.extractIdFromLocation(result.stdout);
    if (!id) id = await this.lookupClientId(baseUrl, token, 'budget-management');

    if (id) {
      await this.addGroupMapper(baseUrl, token, id);
      await this.addOrgIdMapper(baseUrl, token, id);
      await this.addTeamIdMapper(baseUrl, token, id);
      await this.addIsOrgMapper(baseUrl, token, id);
    }

    this.log('budget-management client created with org_id/team_id/is_org claim mappers', 'info');
    return id;
  }

  // ---------------------------------------------------------------------------
  // Workload identity clients
  // ---------------------------------------------------------------------------

  async configureWorkloadClients(baseUrl, token) {
    this.log(`Configuring ${this.workloadClients.length} workload client(s)...`, 'info');
    let k8sIdpRegistered = false;

    for (const client of this.workloadClients) {
      const clientInternalId = await this.createWorkloadClient(baseUrl, token, client);

      if (clientInternalId) {
        await this.addAudienceMapper(
          baseUrl,
          token,
          clientInternalId,
          client.audience || 'agentgateway'
        );

        if (client.configureTokenExchange) {
          if (!k8sIdpRegistered) {
            await this.registerK8sIdentityProvider(
              baseUrl,
              token,
              client.k8sOidcIssuer || 'https://kubernetes.default.svc.cluster.local',
              client.k8sJwksUrl || 'https://kubernetes.default.svc.cluster.local/openid/v1/jwks'
            );
            k8sIdpRegistered = true;
          }
        }
      }

      if (client.k8sSecretName) {
        await this.createWorkloadClientSecret(client);
      }
    }
  }

  async createWorkloadClient(baseUrl, token, client) {
    const clientId = client.clientId;
    this.log(`Creating workload client '${clientId}'...`, 'info');

    const payload = {
      clientId,
      enabled: true,
      publicClient: false,
      standardFlowEnabled: false,
      serviceAccountsEnabled: true,
      directAccessGrantsEnabled: false,
      attributes: { 'access.token.signed.response.alg': 'RS256' },
    };
    if (client.clientSecret) payload.secret = client.clientSecret;

    const result = await CommandRunner.run(
      'curl',
      [
        '-sSik',
        '-X',
        'POST',
        '-H',
        `Authorization: Bearer ${token}`,
        '-H',
        'Content-Type: application/json',
        '-d',
        JSON.stringify(payload),
        `${baseUrl}/admin/realms/${this.realm}/clients`,
      ],
      { ignoreError: true }
    );

    let id = this.extractIdFromLocation(result.stdout);
    if (!id) id = await this.lookupClientId(baseUrl, token, clientId);

    if (id) {
      this.log(`Workload client '${clientId}' created (internal id: ${id})`, 'info');
    } else {
      this.log(`Workload client '${clientId}' may already exist`, 'warn');
    }
    return id;
  }

  async addAudienceMapper(baseUrl, token, clientInternalId, audience) {
    this.log(`Adding audience mapper (aud=${audience})...`, 'info');
    await this.kcApi(
      'POST',
      `${baseUrl}/admin/realms/${this.realm}/clients/${clientInternalId}/protocol-mappers/models`,
      token,
      {
        name: `audience-${audience}`,
        protocol: 'openid-connect',
        protocolMapper: 'oidc-audience-mapper',
        config: {
          'included.custom.audience': audience,
          'access.token.claim': 'true',
          'id.token.claim': 'false',
        },
      }
    );
  }

  async registerK8sIdentityProvider(baseUrl, token, issuer, jwksUrl) {
    this.log(`Registering Kubernetes OIDC identity provider (issuer=${issuer})...`, 'info');
    await this.kcApi(
      'POST',
      `${baseUrl}/admin/realms/${this.realm}/identity-provider/instances`,
      token,
      {
        providerId: 'oidc',
        alias: 'kubernetes',
        displayName: 'Kubernetes',
        enabled: true,
        trustEmail: false,
        storeToken: false,
        addReadTokenRoleOnCreate: false,
        config: {
          validateSignature: 'true',
          useJwksUrl: 'true',
          jwksUrl,
          issuer,
          tokenUrl: `${issuer}/openid/v1/token`,
          authorizationUrl: `${issuer}/openid/v1/auth`,
          disableUserInfoService: 'true',
          clientAuthMethod: 'client_secret_post',
          syncMode: 'IMPORT',
        },
      }
    );
  }

  async createWorkloadClientSecret(client) {
    const secretNamespace = client.k8sSecretNamespace || FeatureManager.getDefaultNamespace();
    this.log(
      `Creating K8s Secret '${client.k8sSecretName}' in namespace '${secretNamespace}'...`,
      'info'
    );

    await KubernetesHelper.ensureNamespace(secretNamespace, this.spinner);

    await this.applyResource({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: client.k8sSecretName,
        namespace: secretNamespace,
        labels: { 'app.kubernetes.io/managed-by': 'agentgateway-demo' },
      },
      type: 'Opaque',
      stringData: { client_secret: client.clientSecret },
    });
  }

  async kcApi(method, url, token, body) {
    const args = [
      '-sSfk',
      '-X',
      method,
      '-H',
      `Authorization: Bearer ${token}`,
      '-H',
      'Content-Type: application/json',
    ];
    if (body) args.push('-d', JSON.stringify(body));
    args.push(url);
    return CommandRunner.run('curl', args, { ignoreError: true });
  }

  async getAdminToken(baseUrl) {
    this.log('Obtaining admin token...', 'info');

    for (let i = 0; i < 30; i++) {
      try {
        const result = await CommandRunner.run(
          'curl',
          [
            '-sSfk',
            '-X',
            'POST',
            `${baseUrl}/realms/master/protocol/openid-connect/token`,
            '-H',
            'Content-Type: application/x-www-form-urlencoded',
            '-d',
            'username=admin&password=admin&grant_type=password&client_id=admin-cli',
          ],
          { ignoreError: true }
        );

        if (result.stdout) {
          const parsed = JSON.parse(result.stdout);
          if (parsed.access_token) return parsed.access_token;
        }
      } catch {
        /* not ready yet */
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error('Failed to obtain Keycloak admin token');
  }

  async createRealm(baseUrl, token) {
    this.log(`Creating realm '${this.realm}'...`, 'info');
    await this.kcApi('POST', `${baseUrl}/admin/realms`, token, {
      realm: this.realm,
      enabled: true,
      displayName: this.realm,
      loginWithEmailAllowed: true,
      duplicateEmailsAllowed: false,
      resetPasswordAllowed: true,
      editUsernameAllowed: false,
      bruteForceProtected: false,
      accessCodeLifespan: 300,
      accessCodeLifespanUserAction: 600,
      accessCodeLifespanLogin: 1800,
    });
  }

  async createConfidentialClient(baseUrl, token) {
    this.log(`Creating confidential client '${this.clientId}'...`, 'info');

    const payload = {
      clientId: this.clientId,
      secret: this.clientSecret,
      enabled: true,
      publicClient: false,
      standardFlowEnabled: true,
      serviceAccountsEnabled: true,
      directAccessGrantsEnabled: true,
      authorizationServicesEnabled: true,
      redirectUris: ['*'],
      webOrigins: ['*'],
      attributes: {
        'post.logout.redirect.uris': '*',
        'access.token.signed.response.alg': 'RS256',
        'id.token.signed.response.alg': 'RS256',
      },
    };

    const result = await this.registerClient(baseUrl, token, payload);
    let id = this.extractIdFromLocation(result.stdout);
    if (!id) id = await this.lookupClientId(baseUrl, token, this.clientId);

    if (id) {
      await this.addGroupMapper(baseUrl, token, id);
      await this.addOrgIdMapper(baseUrl, token, id);
      await this.addTeamIdMapper(baseUrl, token, id);
      await this.addIsOrgMapper(baseUrl, token, id);
    }

    process.env.KEYCLOAK_CLIENT_ID = this.clientId;
    process.env.KEYCLOAK_SECRET = this.clientSecret;
    this.log('Client credentials exported to KEYCLOAK_CLIENT_ID / KEYCLOAK_SECRET', 'info');

    return id;
  }

  async createPublicClient(baseUrl, token) {
    this.log(`Creating public client '${this.publicClientId}'...`, 'info');

    const payload = {
      clientId: this.publicClientId,
      enabled: true,
      publicClient: true,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: ['*'],
      webOrigins: ['*'],
      attributes: {
        'post.logout.redirect.uris': '*',
        'pkce.code.challenge.method': 'S256',
        'access.token.signed.response.alg': 'RS256',
        'id.token.signed.response.alg': 'RS256',
      },
    };

    const result = await this.registerClient(baseUrl, token, payload);
    let id = this.extractIdFromLocation(result.stdout);
    if (!id) id = await this.lookupClientId(baseUrl, token, this.publicClientId);

    if (id) {
      await this.addGroupMapper(baseUrl, token, id);
      await this.addOrgIdMapper(baseUrl, token, id);
      await this.addTeamIdMapper(baseUrl, token, id);
      await this.addIsOrgMapper(baseUrl, token, id);
    }

    return id;
  }

  async registerClient(baseUrl, token, payload) {
    return CommandRunner.run(
      'curl',
      [
        '-sSik',
        '-X',
        'POST',
        '-H',
        `Authorization: Bearer ${token}`,
        '-H',
        'Content-Type: application/json',
        '-d',
        JSON.stringify(payload),
        `${baseUrl}/admin/realms/${this.realm}/clients`,
      ],
      { ignoreError: true }
    );
  }

  async addGroupMapper(baseUrl, token, clientInternalId) {
    this.log('Adding group attribute mapper...', 'info');
    await this.kcApi(
      'POST',
      `${baseUrl}/admin/realms/${this.realm}/clients/${clientInternalId}/protocol-mappers/models`,
      token,
      {
        name: 'group',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-usermodel-attribute-mapper',
        config: {
          'claim.name': 'group',
          'jsonType.label': 'String',
          'user.attribute': 'group',
          'id.token.claim': 'true',
          'access.token.claim': 'true',
        },
      }
    );
  }

  async addOrgIdMapper(baseUrl, token, clientInternalId) {
    this.log('Adding org_id attribute mapper...', 'info');
    await this.kcApi(
      'POST',
      `${baseUrl}/admin/realms/${this.realm}/clients/${clientInternalId}/protocol-mappers/models`,
      token,
      {
        name: 'org_id',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-usermodel-attribute-mapper',
        config: {
          'claim.name': 'org_id',
          'jsonType.label': 'String',
          'user.attribute': 'org_id',
          'id.token.claim': 'true',
          'access.token.claim': 'true',
        },
      }
    );
  }

  async addTeamIdMapper(baseUrl, token, clientInternalId) {
    this.log('Adding team_id attribute mapper...', 'info');
    await this.kcApi(
      'POST',
      `${baseUrl}/admin/realms/${this.realm}/clients/${clientInternalId}/protocol-mappers/models`,
      token,
      {
        name: 'team_id',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-usermodel-attribute-mapper',
        config: {
          'claim.name': 'team_id',
          'jsonType.label': 'String',
          'user.attribute': 'team_id',
          'id.token.claim': 'true',
          'access.token.claim': 'true',
        },
      }
    );
  }

  async addIsOrgMapper(baseUrl, token, clientInternalId) {
    this.log('Adding is_org attribute mapper...', 'info');
    await this.kcApi(
      'POST',
      `${baseUrl}/admin/realms/${this.realm}/clients/${clientInternalId}/protocol-mappers/models`,
      token,
      {
        name: 'is_org',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-usermodel-attribute-mapper',
        config: {
          'claim.name': 'is_org',
          'jsonType.label': 'boolean',
          'user.attribute': 'is_org',
          'id.token.claim': 'true',
          'access.token.claim': 'true',
        },
      }
    );
  }

  extractIdFromLocation(stdout) {
    if (!stdout) return null;
    const match = stdout.match(/[Ll]ocation:\s*.*\/clients\/([^\s\r\n]+)/);
    return match ? match[1] : null;
  }

  async lookupClientId(baseUrl, token, clientId) {
    try {
      const result = await CommandRunner.run(
        'curl',
        [
          '-sSfk',
          '-H',
          `Authorization: Bearer ${token}`,
          `${baseUrl}/admin/realms/${this.realm}/clients?clientId=${clientId}`,
        ],
        { ignoreError: true }
      );
      if (result.stdout) return JSON.parse(result.stdout)[0]?.id || null;
    } catch {
      /* fallthrough */
    }
    return null;
  }

  async createUsers(baseUrl, token) {
    this.log('Creating/updating users...', 'info');
    const users = [
      // Org admin for acme-corp - can manage all org/team budgets
      {
        username: 'org-admin',
        email: 'orgadmin@solo.io',
        firstName: 'Org',
        lastName: 'Admin',
        attributes: {
          group: ['admins'],
          is_org: ['true'],
          org_id: ['acme-corp'],
        },
      },
      // Team member of team-alpha under acme-corp
      {
        username: 'user1',
        email: 'user1@solo.io',
        firstName: 'Joe',
        lastName: 'Blogg',
        attributes: {
          group: ['users'],
          is_org: ['false'],
          org_id: ['acme-corp'],
          team_id: ['team-alpha'],
        },
      },
      // Team member of team-alpha under acme-corp
      {
        username: 'user2',
        email: 'user2@solo.io',
        firstName: 'Bob',
        lastName: 'Doe',
        attributes: {
          group: ['users'],
          is_org: ['false'],
          org_id: ['acme-corp'],
          team_id: ['team-alpha'],
        },
      },
      // Team member of team-beta under acme-corp
      {
        username: 'team-user',
        email: 'teamuser@solo.io',
        firstName: 'Team',
        lastName: 'User',
        attributes: {
          group: ['users'],
          is_org: ['false'],
          org_id: ['acme-corp'],
          team_id: ['team-beta'],
        },
      },
    ];
    for (const u of users) {
      await this.createOrUpdateUser(baseUrl, token, u);
    }
  }

  async createOrUpdateUser(baseUrl, token, user) {
    // Check if user already exists
    const existingId = await this.lookupUserId(baseUrl, token, user.username);

    if (existingId) {
      // Update existing user's attributes
      this.log(`Updating user '${user.username}' attributes...`, 'info');
      await this.kcApi('PUT', `${baseUrl}/admin/realms/${this.realm}/users/${existingId}`, token, {
        ...user,
        enabled: true,
        emailVerified: true,
      });
    } else {
      // Create new user
      this.log(`Creating user '${user.username}'...`, 'info');
      await this.kcApi('POST', `${baseUrl}/admin/realms/${this.realm}/users`, token, {
        ...user,
        enabled: true,
        emailVerified: true,
        credentials: [{ type: 'password', value: 'Passwd00', temporary: false }],
      });
    }
  }

  async lookupUserId(baseUrl, token, username) {
    try {
      const result = await CommandRunner.run(
        'curl',
        [
          '-sSfk',
          '-H',
          `Authorization: Bearer ${token}`,
          `${baseUrl}/admin/realms/${this.realm}/users?username=${encodeURIComponent(username)}&exact=true`,
        ],
        { ignoreError: true }
      );
      if (result.stdout) {
        const users = JSON.parse(result.stdout);
        return users[0]?.id || null;
      }
    } catch {
      /* user not found */
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  async cleanup() {
    this.log('Cleaning up Keycloak...', 'info');
    const ns = this.keycloakNamespace;

    if (this.workloadClients.length > 0) {
      await this.cleanupWorkloadClients();
    }

    await this.deleteResource('deployment', 'keycloak', ns);
    await this.deleteResource('service', 'keycloak', ns);
    await this.deleteResource('secret', 'keycloak-secrets', ns);

    await this.deleteResource('deployment', 'postgres', ns);
    await this.deleteResource('service', 'postgres', ns);
    await this.deleteResource('secret', 'postgres-credentials', ns);
    await this.deleteResource('persistentvolumeclaim', 'postgres-pvc', ns);
    await this.deleteResource('serviceaccount', 'postgres', ns);

    if (this.tlsEnabled && this.createCertificate) {
      await this.deleteResource('certificate', this.tlsSecretName, ns);
      await this.deleteResource('secret', this.tlsSecretName, ns);
    }

    this.log('Keycloak cleaned up', 'success');
  }

  async cleanupWorkloadClients() {
    const baseUrl = `${this.protocol}://${this.hostname}`;
    let token;
    try {
      token = await this.getAdminToken(baseUrl);
    } catch (error) {
      this.log(
        `Could not obtain admin token for workload client cleanup: ${error.message}`,
        'warn'
      );
      return;
    }

    let k8sIdpRemoved = false;
    for (const client of this.workloadClients) {
      try {
        const id = await this.lookupClientId(baseUrl, token, client.clientId);
        if (id) {
          await this.kcApi('DELETE', `${baseUrl}/admin/realms/${this.realm}/clients/${id}`, token);
          this.log(`Workload client '${client.clientId}' deleted`, 'info');
        }
      } catch (error) {
        this.log(`Failed to delete workload client '${client.clientId}': ${error.message}`, 'warn');
      }

      if (client.configureTokenExchange && !k8sIdpRemoved) {
        try {
          await this.kcApi(
            'DELETE',
            `${baseUrl}/admin/realms/${this.realm}/identity-provider/instances/kubernetes`,
            token
          );
          this.log('Kubernetes IdP removed', 'info');
          k8sIdpRemoved = true;
        } catch (error) {
          this.log(`Failed to remove Kubernetes IdP: ${error.message}`, 'warn');
        }
      }

      if (client.k8sSecretName) {
        const secretNamespace = client.k8sSecretNamespace || FeatureManager.getDefaultNamespace();
        await this.deleteResource('secret', client.k8sSecretName, secretNamespace);
      }
    }
  }
}
