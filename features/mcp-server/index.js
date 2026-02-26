import { Feature, FeatureManager } from '../../src/lib/feature.js';
import { KubernetesHelper } from '../../src/lib/common.js';

/**
 * MCP Server Feature
 *
 * Configures an MCP (Model Context Protocol) server backend and routes
 * traffic through agentgateway. Supports both static and dynamic (label-selector)
 * target discovery. Optionally deploys the MCP server workload.
 *
 * References:
 *   Static:  https://docs.solo.io/agentgateway/2.1.x/mcp/static-mcp/
 *   Dynamic: https://docs.solo.io/agentgateway/2.1.x/mcp/dynamic-mcp/
 *
 * This feature:
 * - Optionally deploys an MCP server workload (Deployment, Service, ServiceAccount)
 * - Creates the Service with `appProtocol: kgateway.dev/mcp`
 * - Creates an AgentgatewayBackend with `spec.mcp.targets` for MCP routing
 *   - Static targets: explicit host/port/protocol
 *   - Dynamic targets: Kubernetes label selectors (Streamable HTTP only)
 * - Creates an HTTPRoute that routes to the MCP backend
 *
 * Configuration:
 * {
 *   deployServer: boolean,         // Deploy the MCP server workload (default: true)
 *   image: string,                 // Container image (default: 'mcp-stock-server:latest')
 *   imagePullPolicy: string,       // Image pull policy (default: 'IfNotPresent')
 *   serverName: string,            // Server/app name (default: 'mcp-stock-server')
 *   serverPort: number,            // Container port the MCP server listens on (default: 8000)
 *   servicePort: number,           // Service port exposed to the cluster (default: 80)
 *   protocol: string,              // MCP transport: 'SSE' or 'StreamableHTTP' (default: 'SSE')
 *   mcpPath: string,               // Optional annotation: kgateway.dev/mcp-path override
 *   env: Object,                   // Container environment variables as key-value pairs
 *                                  //   e.g. { MCP_TRANSPORT: 'streamable-http' }
 *   backendName: string,           // AgentgatewayBackend resource name (default: 'mcp-backend')
 *   targetName: string,            // Target name inside the backend (default: 'mcp-target')
 *   matchLabels: Object,           // Dynamic discovery: label selector for MCP services
 *                                  //   e.g. { app: 'my-mcp-server' }
 *                                  //   When set, creates a selector-based target instead of static
 *                                  //   Note: only Streamable HTTP is supported for selectors
 *   targets: Array<{              // Multiple MCP targets (overrides single-server defaults)
 *     name: string,
 *     // Static target fields:
 *     host: string,
 *     port: number,
 *     protocol: string,
 *     // Dynamic target fields (mutually exclusive with host):
 *     matchLabels: Object,         //   e.g. { app: 'my-mcp-server' }
 *   }>,
 *   servers: Array<{              // Multiple server workloads to deploy (multiplex pattern)
 *     name: string,                //   Server/app name
 *     image: string,               //   Container image
 *     imagePullPolicy: string,     //   Image pull policy (default: 'IfNotPresent')
 *     serverPort: number,          //   Container port (default: 8000)
 *     servicePort: number,         //   Service port (default: 80)
 *     mcpPath: string,             //   Optional kgateway.dev/mcp-path annotation
 *     env: Object,                 //   Container env vars as key-value pairs
 *   }>,
 *   routeName: string,             // HTTPRoute name (default: 'mcp')
 *   pathPrefix: string,            // Route path prefix (default: none — matches all paths)
 *   pathRewrite: string | null,   // Replace path prefix with this before forwarding (e.g. '/'); null = no rewrite
 * }
 */
export class McpServerFeature extends Feature {
  constructor(name, config) {
    super(name, config);

    this.shouldDeployServer = config.deployServer !== false;
    this.image = config.image || 'mcp-stock-server:latest';
    this.imagePullPolicy = config.imagePullPolicy || 'IfNotPresent';
    this.serverName = config.serverName || 'mcp-stock-server';
    this.serverPort = config.serverPort || 8000;
    this.servicePort = config.servicePort || 80;
    this.protocol = config.protocol || 'SSE';
    this.mcpPath = config.mcpPath || null;

    this.backendName = config.backendName || 'mcp-backend';
    this.targetName = config.targetName || 'mcp-target';
    this.targets = config.targets || null;
    this.matchLabels = config.matchLabels || null;
    this.env = config.env || null;
    this.servers = config.servers || null;

    this.routeName = config.routeName || 'mcp';
    this.pathPrefix = config.pathPrefix || null;
    this.pathRewrite = config.pathRewrite !== undefined ? config.pathRewrite : null;
  }

  getFeaturePath() {
    return 'mcp-server';
  }

  validate() {
    const validProtocols = ['SSE', 'StreamableHTTP'];
    if (!validProtocols.includes(this.protocol)) {
      throw new Error(`protocol must be one of: ${validProtocols.join(', ')}`);
    }

    if (this.matchLabels && typeof this.matchLabels !== 'object') {
      throw new Error('matchLabels must be an object of key-value label pairs');
    }

    if (this.targets) {
      for (const t of this.targets) {
        if (!t.name) {
          throw new Error('Each MCP target must have a name');
        }
        const isSelector = !!t.matchLabels;
        const isStatic = !!t.host;
        if (!isSelector && !isStatic) {
          throw new Error(`Target '${t.name}' must have either 'host' (static) or 'matchLabels' (dynamic)`);
        }
        if (isSelector && isStatic) {
          throw new Error(`Target '${t.name}' cannot have both 'host' and 'matchLabels'`);
        }
        if (isStatic && t.protocol && !validProtocols.includes(t.protocol)) {
          throw new Error(`Target '${t.name}' protocol must be one of: ${validProtocols.join(', ')}`);
        }
      }
    }

    if (this.servers) {
      for (const s of this.servers) {
        if (!s.name) {
          throw new Error('Each server in the servers array must have a name');
        }
        if (!s.image) {
          throw new Error(`Server '${s.name}' must have an image`);
        }
      }
    }

    return true;
  }

  async deploy() {
    if (this.servers) {
      for (const server of this.servers) {
        await this.deployWorkloadFor(server);
      }
    } else if (this.shouldDeployServer) {
      await this.deployWorkload();
    }

    await this.deployBackend();
    await this.deployHTTPRoute();
  }

  async deployWorkload() {
    this.log(`Deploying MCP server workload '${this.serverName}'...`, 'info');

    const saOverrides = {
      metadata: {
        name: this.serverName,
        namespace: this.namespace,
      },
    };
    await this.applyYamlFile('serviceaccount.yaml', saOverrides);

    const svcAnnotations = {};
    if (this.mcpPath) {
      svcAnnotations['kgateway.dev/mcp-path'] = this.mcpPath;
    }

    const svcOverrides = {
      metadata: {
        name: this.serverName,
        namespace: this.namespace,
        ...(Object.keys(svcAnnotations).length > 0 && { annotations: svcAnnotations }),
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
          app: this.serverName,
        },
      },
      spec: {
        selector: { app: this.serverName },
        ports: [
          {
            port: this.servicePort,
            targetPort: this.serverPort,
            appProtocol: 'kgateway.dev/mcp',
          },
        ],
      },
    };
    await this.applyYamlFile('service.yaml', svcOverrides);

    const deployOverrides = {
      metadata: {
        name: this.serverName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
          app: this.serverName,
        },
      },
      spec: {
        selector: { matchLabels: { app: this.serverName } },
        template: {
          metadata: { labels: { app: this.serverName } },
          spec: {
            serviceAccountName: this.serverName,
            containers: [
              {
                name: 'server',
                image: this.image,
                imagePullPolicy: this.imagePullPolicy,
                ports: [{ containerPort: this.serverPort }],
                ...(this.env && {
                  env: Object.entries(this.env).map(([name, value]) => ({
                    name,
                    value: String(value),
                  })),
                }),
              },
            ],
          },
        },
      },
    };
    await this.applyYamlFile('deployment.yaml', deployOverrides);

    this.log(`MCP server '${this.serverName}' workload deployed`, 'info');
  }

  async deployWorkloadFor(server) {
    const name = server.name;
    const image = server.image;
    const imagePullPolicy = server.imagePullPolicy || this.imagePullPolicy;
    const serverPort = server.serverPort || this.serverPort;
    const servicePort = server.servicePort || this.servicePort;
    const mcpPath = server.mcpPath || this.mcpPath || null;
    const env = server.env || null;

    this.log(`Deploying MCP server workload '${name}'...`, 'info');

    const saOverrides = {
      metadata: {
        name,
        namespace: this.namespace,
      },
    };
    await this.applyYamlFile('serviceaccount.yaml', saOverrides);

    const svcAnnotations = {};
    if (mcpPath) {
      svcAnnotations['kgateway.dev/mcp-path'] = mcpPath;
    }

    const svcOverrides = {
      metadata: {
        name,
        namespace: this.namespace,
        ...(Object.keys(svcAnnotations).length > 0 && { annotations: svcAnnotations }),
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
          app: name,
        },
      },
      spec: {
        selector: { app: name },
        ports: [
          {
            port: servicePort,
            targetPort: serverPort,
            appProtocol: 'kgateway.dev/mcp',
          },
        ],
      },
    };
    await this.applyYamlFile('service.yaml', svcOverrides);

    const deployOverrides = {
      metadata: {
        name,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
          app: name,
        },
      },
      spec: {
        selector: { matchLabels: { app: name } },
        template: {
          metadata: { labels: { app: name } },
          spec: {
            serviceAccountName: name,
            containers: [
              {
                name: 'server',
                image,
                imagePullPolicy,
                ports: [{ containerPort: serverPort }],
                ...(env && {
                  env: Object.entries(env).map(([k, value]) => ({
                    name: k,
                    value: String(value),
                  })),
                }),
              },
            ],
          },
        },
      },
    };
    await this.applyYamlFile('deployment.yaml', deployOverrides);

    this.log(`MCP server '${name}' workload deployed`, 'info');
  }

  buildTarget(t) {
    if (t.matchLabels) {
      return {
        name: t.name,
        selector: {
          services: { matchLabels: t.matchLabels },
        },
      };
    }
    return {
      name: t.name,
      static: {
        host: t.host,
        port: t.port || this.servicePort,
        protocol: t.protocol || this.protocol,
      },
    };
  }

  async deployBackend() {
    let targets;

    if (this.targets) {
      targets = this.targets.map(t => this.buildTarget(t));
    } else if (this.matchLabels) {
      targets = [
        {
          name: this.targetName,
          selector: {
            services: { matchLabels: this.matchLabels },
          },
        },
      ];
    } else {
      const serverHost = `${this.serverName}.${this.namespace}.svc.cluster.local`;
      targets = [
        {
          name: this.targetName,
          static: {
            host: serverHost,
            port: this.servicePort,
            protocol: this.protocol,
          },
        },
      ];
    }

    const overrides = {
      metadata: {
        name: this.backendName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      spec: {
        mcp: { targets },
      },
    };

    const isDynamic = targets.some(t => t.selector);
    const mode = isDynamic ? 'dynamic' : 'static';
    await this.applyYamlFile('backend.yaml', overrides);
    this.log(`AgentgatewayBackend '${this.backendName}' created with ${targets.length} ${mode} MCP target(s)`, 'info');
  }

  async deployHTTPRoute() {
    const gatewayRef = FeatureManager.getGatewayRef();

    const rule = {
      backendRefs: [
        {
          name: this.backendName,
          group: 'agentgateway.dev',
          kind: 'AgentgatewayBackend',
        },
      ],
    };

    if (this.pathPrefix) {
      rule.matches = [
        {
          path: {
            type: 'PathPrefix',
            value: this.pathPrefix,
          },
        },
      ];
    }

    if (this.pathRewrite != null) {
      rule.filters = [
        {
          type: 'URLRewrite',
          urlRewrite: {
            path: { type: 'ReplacePrefixMatch', replacePrefixMatch: this.pathRewrite },
          },
        },
      ];
    }

    const overrides = {
      metadata: {
        name: this.routeName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentgateway-demo',
          'agentgateway.dev/feature': this.name,
        },
      },
      spec: {
        parentRefs: [
          {
            name: gatewayRef.name,
            namespace: gatewayRef.namespace,
          },
        ],
        rules: [rule],
      },
    };

    await this.applyYamlFile('httproute.yaml', overrides);
    const pathMsg = this.pathPrefix ? ` at ${this.pathPrefix}` : '';
    const rewriteMsg = this.pathRewrite != null ? ` (rewrite → ${this.pathRewrite})` : '';
    this.log(`HTTPRoute '${this.routeName}' created${pathMsg}${rewriteMsg}`, 'info');
  }

  async cleanup() {
    this.log('Cleaning up MCP server feature...', 'info');

    await this.deleteResource('HTTPRoute', this.routeName);
    await this.deleteResource('AgentgatewayBackend', this.backendName);

    if (this.servers) {
      for (const server of this.servers) {
        await this.deleteResource('Deployment', server.name);
        await this.deleteResource('Service', server.name);
        await this.deleteResource('ServiceAccount', server.name);
      }
    } else if (this.shouldDeployServer) {
      await this.deleteResource('Deployment', this.serverName);
      await this.deleteResource('Service', this.serverName);
      await this.deleteResource('ServiceAccount', this.serverName);
    }

    this.log('MCP server feature cleaned up', 'info');
  }
}
