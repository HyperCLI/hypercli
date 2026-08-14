import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_FILE_MAX_BYTES,
  AGENT_FILE_OPERATION_TIMEOUT_MS,
  AGENT_FILE_TRANSFER_CHUNK_BYTES,
  Agent,
  DEFAULT_OPENCLAW_IMAGE,
  DEFAULT_AGENT_RUNTIME_SCOPES,
  DEFAULT_OPENCLAW_PRO_IMAGE,
  Deployments,
  OpenClawAgent,
  OpenClawProAgent,
  buildAgentConfig,
  buildOpenClawRoutes,
} from '../src/agents.js';
import { APIError } from '../src/errors.js';
import { HTTPClient } from '../src/http.js';

class MockWebSocket {
  public readonly url: string;
  public binaryType = 'blob';
  public onopen: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: ((event: { reason?: string }) => void) | null = null;
  public close = vi.fn();

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => this.onopen?.());
  }
}

describe('HyperClaw agents SDK', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('WebSocket', MockWebSocket as any);
    vi.stubGlobal('crypto', {
      getRandomValues: (values: Uint8Array) => {
        values.fill(0xab);
        return values;
      },
      randomUUID: () => 'uuid-123',
    } as any);
  });

  it('buildAgentConfig sends only an explicit gateway token as a Secret', () => {
    const { config, gatewayToken } = buildAgentConfig(
      { foo: 'bar' },
      {
        env: { FOO: 'bar' },
        gatewayToken: 'gw-explicit',
        command: ['echo', 'hello'],
        entrypoint: ['/bin/sh', '-c'],
        routes: { openclaw: { port: 18789, auth: false } },
        image: 'ghcr.io/hypercli/hypercli-openclaw:test',
        syncUid: 2000,
        syncGid: 2001,
      },
    );

    expect(gatewayToken).toBe('gw-explicit');
    expect(config.config).toEqual({ foo: 'bar' });
    expect(config.env).toEqual({
      FOO: 'bar',
    });
    expect(config.secrets).toEqual({ OPENCLAW_GATEWAY_TOKEN: 'gw-explicit' });
    expect(config.command).toEqual(['echo', 'hello']);
    expect(config.entrypoint).toEqual(['/bin/sh', '-c']);
    expect(config.routes).toEqual({ openclaw: { port: 18789, auth: false } });
    expect(config.image).toBe('ghcr.io/hypercli/hypercli-openclaw:test');
    expect(config.sync_uid).toBe(2000);
    expect(config.sync_gid).toBe(2001);
  });

  it.each([
    ['syncUid', -1],
    ['syncUid', 1.5],
    ['syncUid', Number.NaN],
    ['syncUid', 4_294_967_295],
    ['syncGid', -1],
    ['syncGid', 1.5],
    ['syncGid', Number.NaN],
    ['syncGid', 4_294_967_295],
  ] as const)('buildAgentConfig rejects invalid %s ownership', (field, value) => {
    expect(() => buildAgentConfig({}, { [field]: value })).toThrow(
      /must be an integer between 0 and 4294967294/,
    );
  });

  it('buildAgentConfig rejects nested launch fields in config', () => {
    expect(() => buildAgentConfig(
      { env: { FOO: 'bar' } },
      {},
    )).toThrow(/Launch settings must be top-level fields/);
  });

  it('buildAgentConfig merges heartbeat config into OpenClaw config defaults', () => {
    const { config } = buildAgentConfig(
      {
        agents: {
          defaults: {
            model: 'openai/gpt-5.4',
            heartbeat: {
              target: 'last',
            },
          },
        },
      },
      {
        heartbeat: {
          every: '1h',
          target: 'last',
        },
      },
    );

    expect(config.config).toEqual({
      agents: {
        defaults: {
          model: 'openai/gpt-5.4',
          heartbeat: {
            target: 'last',
            every: '1h',
          },
        },
      },
    });
  });

  it('buildOpenClawRoutes returns the default gateway route', () => {
    expect(buildOpenClawRoutes()).toEqual({
      openclaw: { port: 18789, auth: false, prefix: '' },
    });
  });

  it('buildOpenClawRoutes allows route overrides', () => {
    expect(buildOpenClawRoutes({
      includeDesktop: true,
      gatewayPort: 19999,
      gatewayAuth: true,
      gatewayPrefix: 'app',
    })).toEqual({
      openclaw: { port: 19999, auth: true, prefix: 'app' },
      desktop: { port: 3000, auth: true, prefix: 'desktop' },
    });
  });

  it('createOpenClaw defaults routes when omitted', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-openclaw',
      user_id: 'user-1',
      state: 'starting',
      hostname: 'agent.dev.hypercli.com',
      routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
    });
    const deployments = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    await deployments.createOpenClaw({ name: 'test-agent', dryRun: true });

    expect(post).toHaveBeenCalledWith('/deployments', expect.objectContaining({
      image: DEFAULT_OPENCLAW_IMAGE,
      sync_root: '/home/node',
      sync_exclude: expect.arrayContaining([
        'shared/**',
        '.openclaw/npm/**/node_modules/**',
      ]),
      env: expect.objectContaining({
        HYPER_WORKSPACES_BOOT_SYNC: '1',
        HYPER_WORKSPACES_DIR: '/home/node/shared',
        HYPER_WORKSPACES_SYNC_READY_ONLY: '1',
      }),
      routes: {
        openclaw: { port: 18789, auth: false, prefix: '' },
      },
    }), { retries: 1 });
    expect(post.mock.calls[0]?.[1].env).not.toHaveProperty('HYPER_API_BASE');
  });

  it('createOpenClaw respects explicit empty routes', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-openclaw',
      user_id: 'user-1',
      state: 'starting',
    });
    const deployments = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    await deployments.createOpenClaw({ name: 'test-agent', routes: {}, dryRun: true });

    expect(post).toHaveBeenCalledWith('/deployments', expect.objectContaining({
      image: DEFAULT_OPENCLAW_IMAGE,
      sync_root: '/home/node',
      sync_exclude: expect.arrayContaining([
        'shared/**',
        '.openclaw/npm/**/node_modules/**',
      ]),
      env: expect.objectContaining({
        HYPER_WORKSPACES_BOOT_SYNC: '1',
        HYPER_WORKSPACES_DIR: '/home/node/shared',
        HYPER_WORKSPACES_SYNC_READY_ONLY: '1',
      }),
      routes: {},
    }), { retries: 1 });
  });

  it('createOpenClawPro defaults desktop image env and routes', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-openclaw',
      user_id: 'user-1',
      state: 'starting',
      launch_config: {
        image: DEFAULT_OPENCLAW_PRO_IMAGE,
        env: { OPENCLAW_DESKTOP_ENABLED: '1' },
        routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
      },
    });
    const deployments = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    const agent = await deployments.createOpenClawPro({ name: 'test-agent', dryRun: true });

    expect(post).toHaveBeenCalledWith('/deployments', expect.objectContaining({
      image: DEFAULT_OPENCLAW_PRO_IMAGE,
      sync_root: '/home/node',
      sync_exclude: expect.arrayContaining([
        'shared/**',
        '.openclaw/npm/**/node_modules/**',
      ]),
      runtime_scopes: DEFAULT_AGENT_RUNTIME_SCOPES,
      env: expect.objectContaining({
        HYPER_WORKSPACES_BOOT_SYNC: '1',
        HYPER_WORKSPACES_DIR: '/home/node/shared',
        HYPER_WORKSPACES_SYNC_READY_ONLY: '1',
        OPENCLAW_DESKTOP_ENABLED: '1',
      }),
      routes: {
        openclaw: { port: 18789, auth: false, prefix: '' },
        desktop: { port: 3000, auth: true, prefix: 'desktop' },
      },
    }), { retries: 1 });
    expect(agent).toBeInstanceOf(OpenClawProAgent);
  });

  it('createOpenClaw accepts memory index launch options', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-openclaw',
      user_id: 'user-1',
      state: 'starting',
      launch_config: {
        env: {},
        routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
      },
    });
    const deployments = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    await deployments.createOpenClaw({
      name: 'test-agent',
      dryRun: true,
      memoryIndex: {
        onSessionStart: true,
        onSearch: true,
        watch: true,
        watchDebounceMs: 60000,
        intervalMinutes: 120,
      },
    });

    expect(post).toHaveBeenCalledWith('/deployments', expect.objectContaining({
      env: expect.objectContaining({
        OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START: '1',
        OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH: '1',
        OPENCLAW_MEMORY_SEARCH_SYNC_WATCH: '1',
        OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS: '60000',
        OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: '120',
      }),
    }), { retries: 1 });
  });

  it('createOpenClaw accepts workspace sync launch options', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-openclaw',
      user_id: 'user-1',
      state: 'starting',
    });
    const deployments = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    await deployments.createOpenClaw({
      name: 'test-agent',
      dryRun: true,
      workspacesSync: {
        readyOnly: false,
        workspace: 'team-knowledge',
      },
    });

    expect(post).toHaveBeenCalledWith('/deployments', expect.objectContaining({
      env: expect.objectContaining({
        HYPER_WORKSPACES_BOOT_SYNC: '1',
        HYPER_WORKSPACES_DIR: '/home/node/shared',
        HYPER_WORKSPACES_SYNC_READY_ONLY: '0',
        HYPER_WORKSPACES_SYNC_WORKSPACE: 'team-knowledge',
      }),
    }), { retries: 1 });
  });

  it('createOpenClaw lets explicit HYPER_API_BASE override the derived product API base', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-openclaw',
      user_id: 'user-1',
      state: 'starting',
    });
    const deployments = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    await deployments.createOpenClaw({
      name: 'test-agent',
      dryRun: true,
      env: { HYPER_API_BASE: 'https://api.override.test' },
    });

    expect(post).toHaveBeenCalledWith('/deployments', expect.objectContaining({
      env: expect.objectContaining({
        HYPER_API_BASE: 'https://api.override.test',
      }),
    }), { retries: 1 });
  });

  it('createOpenClaw preserves an explicit Workspaces directory override', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-openclaw',
      user_id: 'user-1',
      state: 'starting',
    });
    const deployments = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    await deployments.createOpenClaw({
      name: 'test-agent',
      dryRun: true,
      env: { HYPER_WORKSPACES_DIR: '/home/node/custom-shared' },
    });

    expect(post).toHaveBeenCalledWith('/deployments', expect.objectContaining({
      env: expect.objectContaining({
        HYPER_WORKSPACES_DIR: '/home/node/custom-shared',
      }),
    }), { retries: 1 });
  });

  it('createOpenClaw can disable workspace boot sync', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-openclaw',
      user_id: 'user-1',
      state: 'starting',
    });
    const deployments = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    await deployments.createOpenClaw({ name: 'test-agent', workspacesSync: false, dryRun: true });

    expect(post).toHaveBeenCalledWith('/deployments', expect.objectContaining({
      env: expect.objectContaining({
        HYPER_WORKSPACES_BOOT_SYNC: '0',
      }),
    }), { retries: 1 });
  });

  it('startOpenClaw without overrides inherits the backend launch contract', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-openclaw',
      user_id: 'user-1',
      state: 'starting',
      hostname: 'agent.dev.hypercli.com',
      routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
    });
    const deployments = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    await deployments.startOpenClaw('agent-123');

    expect(post).toHaveBeenCalledWith('/deployments/agent-123/start', {}, { retries: 1 });
  });

  it('hydrates generic and OpenClaw agents correctly', () => {
    const generic = Agent.fromDict({
      id: 'agent-1',
      user_id: 'user-1',
      state: 'running',
      hostname: 'agent.dev.hyperclaw.app',
    });

    const openclaw = OpenClawAgent.fromDict({
      id: 'agent-2',
      user_id: 'user-1',
      state: 'running',
      hostname: 'openclaw-agent2.dev.hyperclaw.app',
      routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
      gateway_token: 'must-not-hydrate',
      jwt_token: 'jwt-123',
      command: ['sleep', '3600'],
      entrypoint: ['/bin/sh', '-c'],
    });

    expect(generic.publicUrl).toBe('https://agent.dev.hyperclaw.app');
    expect(generic.desktopUrl).toBe('https://desktop-agent.dev.hyperclaw.app');
    expect(generic.shellUrl).toBeNull();
    expect(openclaw.gatewayUrl).toBe('wss://openclaw-agent2.dev.hyperclaw.app');
    expect(openclaw.gatewayToken).toBeNull();
    expect(openclaw.command).toEqual(['sleep', '3600']);
    expect(openclaw.entrypoint).toEqual(['/bin/sh', '-c']);
  });

  it('OpenClawAgent derives its gateway URL from the hostname', () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-root',
      user_id: 'user-1',
      state: 'running',
      hostname: 'agent-root.dev.hyperclaw.app',
    });

    expect(agent.gatewayUrl).toBe('wss://agent-root.dev.hyperclaw.app');
  });

  it('OpenClawAgent gateway forwards deployment pairing context without using jwt query auth', async () => {
    const get = vi.fn(async (path: string) => path.endsWith('/secrets/OPENCLAW_GATEWAY_TOKEN')
      ? { agent_id: 'agent-ctx', key: 'OPENCLAW_GATEWAY_TOKEN', value: 'gw-ctx', launch_epoch: 1 }
      : path.endsWith('/routes')
        ? {
            agent_id: 'agent-ctx',
            routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
            route_statuses: { openclaw: { hostname: 'openclaw-agent.dev.hypercli.com', url: 'https://openclaw-agent.dev.hypercli.com', dns_state: 'active' } },
          }
        : {
          id: 'agent-ctx',
          user_id: 'user-1',
          state: 'RUNNING',
          hostname: 'openclaw-agent.dev.hypercli.com',
          launch_epoch: 1,
        });
    const deployments = new Deployments(
      { post: vi.fn(), get, delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );
    const agent = OpenClawAgent.fromDict({
      id: 'agent-ctx',
      user_id: 'user-1',
      state: 'running',
      jwt_token: 'jwt-ctx',
      hostname: 'openclaw-agent.dev.hypercli.com',
      routes: { openclaw: { port: 18789, auth: false } },
    });
    (agent as any)._deployments = deployments;

    await agent.waitForGatewayContext();
    const gateway = agent.gateway({ clientId: 'openclaw-control-ui', clientMode: 'webchat' }) as any;

    expect(gateway.url).toBe('wss://openclaw-agent.dev.hypercli.com');
    expect(gateway.deploymentId).toBe('agent-ctx');
    expect(gateway.apiKey).toBe('sk-hyper-test');
    expect(gateway.apiBase).toBe('https://api.dev.hypercli.com/agents');
    expect(gateway.autoApprovePairing).toBe(true);
    expect(gateway.gatewayToken).toBe('gw-ctx');
    expect(gateway.token).toBeUndefined();
  });

  it('OpenClawAgent gateway allows jwt-less connect when openclaw route auth is disabled', async () => {
    const get = vi.fn(async (path: string) => path.endsWith('/secrets/OPENCLAW_GATEWAY_TOKEN')
      ? { agent_id: 'agent-jwtless', key: 'OPENCLAW_GATEWAY_TOKEN', value: 'gw-jwtless', launch_epoch: 1 }
      : path.endsWith('/routes')
        ? {
            agent_id: 'agent-jwtless',
            routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
            route_statuses: { openclaw: { hostname: 'openclaw-agent.dev.hypercli.com', url: 'https://openclaw-agent.dev.hypercli.com', dns_state: 'active' } },
          }
        : {
          id: 'agent-jwtless',
          user_id: 'user-1',
          state: 'RUNNING',
          hostname: 'openclaw-agent.dev.hypercli.com',
          launch_epoch: 1,
        });
    const deployments = new Deployments(
      { post: vi.fn(), get, delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );
    const agent = OpenClawAgent.fromDict({
      id: 'agent-jwtless',
      user_id: 'user-1',
      state: 'running',
      hostname: 'openclaw-agent.dev.hypercli.com',
      routes: { openclaw: { port: 18789, auth: false } },
    });
    (agent as any)._deployments = deployments;

    await agent.waitForGatewayContext();
    const gateway = agent.gateway() as any;

    expect(gateway.token).toBeUndefined();
    expect(gateway.gatewayToken).toBe('gw-jwtless');
  });

  it('OpenClawAgent config helpers mutate OpenClaw config through configApply', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-helpers',
      user_id: 'user-1',
      state: 'running',
      openclaw_url: 'wss://openclaw-agent.dev.hypercli.com/ws',
      gateway_token: 'gw-helpers',
      jwt_token: 'jwt-helpers',
    });
    const baseConfig = {
      models: {
        providers: {
          hyperclaw: {
            api: 'anthropic-messages',
            baseUrl: 'https://api.example',
            models: [{ id: 'kimi-k2.5', name: 'Kimi K2.5' }],
          },
        },
      },
      agents: { defaults: {} },
    };
    const applied: Array<Record<string, any>> = [];
    vi.spyOn(agent, 'configGet').mockImplementation(async () => structuredClone(baseConfig));
    vi.spyOn(agent, 'configApply').mockImplementation(async (config) => {
      applied.push(structuredClone(config));
    });

    const provider = await agent.providerUpsert('moonshot', {
      api: 'anthropic-messages',
      baseUrl: 'https://moonshot.example',
      apiKey: { source: 'env', provider: 'default', id: 'MOONSHOT_API_KEY' },
      auth: 'api-key',
      authHeader: true,
      headers: {
        'x-provider': 'moonshot',
      },
      injectNumCtxForOpenAICompat: true,
      models: [{ id: 'kimi-k2.5', name: 'Kimi K2.5', reasoning: true, input: ['text'] }],
    });
    expect(provider.baseUrl).toBe('https://moonshot.example');
    expect(provider.auth).toBe('api-key');
    expect(provider.authHeader).toBe(true);
    expect(provider.injectNumCtxForOpenAICompat).toBe(true);
    expect(provider.headers).toEqual({ 'x-provider': 'moonshot' });

    const model = await agent.modelUpsert('moonshot', 'kimi-k2.5', {
      name: 'Kimi K2.5',
      reasoning: true,
      contextWindow: 262144,
    });
    expect(model.contextWindow).toBe(262144);

    const primary = await agent.setDefaultModel('moonshot', 'kimi-k2.5');
    expect(primary).toBe('moonshot/kimi-k2.5');

    const memorySearch = await agent.setMemorySearch({
      provider: 'embeddings',
      model: 'qwen3-embedding',
      baseUrl: 'https://embed.example',
      apiKey: 'embed-key',
    });
    expect(memorySearch.remote.baseUrl).toBe('https://embed.example');

    const telegram = await agent.telegramUpsert({
      botToken: 'telegram-token',
      allowFrom: ['123456'],
    });
    expect(telegram.botToken).toBe('telegram-token');

    const slack = await agent.slackUpsert({
      botToken: 'xoxb-test',
      channels: { C123: { enabled: true, users: ['U123'] } },
    }, { accountId: 'work' });
    expect(slack.botToken).toBe('xoxb-test');

    const discord = await agent.discordUpsert({
      token: 'discord-token',
      guilds: { G123: { enabled: true } },
    });
    expect(discord.token).toBe('discord-token');

    expect(applied).toHaveLength(7);
    expect(applied[0]?.models?.providers?.moonshot?.apiKey).toEqual({
      source: 'env',
      provider: 'default',
      id: 'MOONSHOT_API_KEY',
    });
    expect(applied[1]?.models?.providers?.moonshot?.models?.[0]?.reasoning).toBe(true);
    expect(applied[2]?.agents?.defaults?.model?.primary).toBe('moonshot/kimi-k2.5');
    expect(applied[3]?.agents?.defaults?.memorySearch?.remote?.apiKey).toBe('embed-key');
    expect(applied[4]?.channels?.telegram?.allowFrom).toEqual(['123456']);
    expect(applied[5]?.channels?.slack?.accounts?.work?.channels?.C123?.users).toEqual(['U123']);
    expect(applied[6]?.channels?.discord?.guilds?.G123?.enabled).toBe(true);
  });

  it('providerUpsert matches the gateway provider config shape for anthropic, openai, and google providers', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-provider-matrix',
      user_id: 'user-1',
      state: 'running',
      openclaw_url: 'wss://openclaw-agent.dev.hypercli.com/ws',
      gateway_token: 'gw-provider-matrix',
      jwt_token: 'jwt-provider-matrix',
    });
    const baseConfig = {
      models: {
        providers: {},
      },
      agents: { defaults: {} },
    };
    const applied: Array<Record<string, any>> = [];
    vi.spyOn(agent, 'configGet').mockImplementation(async () => structuredClone(baseConfig));
    vi.spyOn(agent, 'configApply').mockImplementation(async (config) => {
      applied.push(structuredClone(config));
    });

    await agent.providerUpsert('anthropic', {
      api: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: { source: 'env', provider: 'default', id: 'ANTHROPIC_API_KEY' },
      auth: 'api-key',
      headers: { 'anthropic-version': '2023-06-01' },
      models: [
        {
          id: 'claude-sonnet-4-5',
          name: 'Claude Sonnet 4.5',
          reasoning: true,
          input: ['text', 'image'],
          contextWindow: 200000,
          maxTokens: 64000,
        },
      ],
    });

    await agent.providerUpsert('openai', {
      api: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: { source: 'env', provider: 'default', id: 'OPENAI_API_KEY' },
      auth: 'api-key',
      authHeader: true,
      injectNumCtxForOpenAICompat: true,
      models: [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          reasoning: true,
          input: ['text', 'image'],
          contextWindow: 400000,
          maxTokens: 128000,
          compat: {
            supportsTools: true,
            thinkingFormat: 'openrouter',
          },
        },
      ],
    });

    await agent.providerUpsert('google', {
      api: 'google-generative-ai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: { source: 'env', provider: 'default', id: 'GOOGLE_API_KEY' },
      auth: 'api-key',
      headers: { 'x-goog-api-client': 'hypercli-test' },
      models: [
        {
          id: 'gemini-2.5-pro',
          name: 'Gemini 2.5 Pro',
          reasoning: true,
          input: ['text', 'image'],
          contextWindow: 1048576,
          maxTokens: 65536,
        },
      ],
    });

    expect(applied).toHaveLength(3);
    expect(applied[0]).toMatchObject({
      models: {
        providers: {
          anthropic: {
            api: 'anthropic-messages',
            baseUrl: 'https://api.anthropic.com/v1',
            apiKey: { source: 'env', provider: 'default', id: 'ANTHROPIC_API_KEY' },
            auth: 'api-key',
            headers: { 'anthropic-version': '2023-06-01' },
            models: [
              {
                id: 'claude-sonnet-4-5',
                name: 'Claude Sonnet 4.5',
                reasoning: true,
                input: ['text', 'image'],
                contextWindow: 200000,
                maxTokens: 64000,
              },
            ],
          },
        },
      },
    });
    expect(applied[1]).toMatchObject({
      models: {
        providers: {
          openai: {
            api: 'openai-responses',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: { source: 'env', provider: 'default', id: 'OPENAI_API_KEY' },
            auth: 'api-key',
            authHeader: true,
            injectNumCtxForOpenAICompat: true,
            models: [
              {
                id: 'gpt-5.4',
                name: 'GPT-5.4',
                reasoning: true,
                input: ['text', 'image'],
                contextWindow: 400000,
                maxTokens: 128000,
                compat: {
                  supportsTools: true,
                  thinkingFormat: 'openrouter',
                },
              },
            ],
          },
        },
      },
    });
    expect(applied[2]).toMatchObject({
      models: {
        providers: {
          google: {
            api: 'google-generative-ai',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            apiKey: { source: 'env', provider: 'default', id: 'GOOGLE_API_KEY' },
            auth: 'api-key',
            headers: { 'x-goog-api-client': 'hypercli-test' },
            models: [
              {
                id: 'gemini-2.5-pro',
                name: 'Gemini 2.5 Pro',
                reasoning: true,
                input: ['text', 'image'],
                contextWindow: 1048576,
                maxTokens: 65536,
              },
            ],
          },
        },
      },
    });
  });

  it('OpenClawAgent waitReady delegates to GatewayClient.waitReady', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-ready',
      user_id: 'user-1',
      state: 'running',
      hostname: 'openclaw-agent.dev.hypercli.com',
      routes: { openclaw: { port: 18789, auth: false } },
      gateway_token: 'gw-ready',
      jwt_token: 'jwt-ready',
    });
    agent.gatewayUrl = 'wss://openclaw-agent.dev.hypercli.com';
    agent.gatewayToken = 'gw-ready';

    const waitReady = vi.fn().mockResolvedValue({ gateway: { mode: 'local' } });
    const close = vi.fn();
    const release = vi.fn();
    vi.spyOn(agent, 'acquireConnectedGateway').mockResolvedValue({
      client: { waitReady, close },
      release,
    } as any);

    const result = await agent.waitReady(90_000, { retryIntervalMs: 250, probe: 'status' });

    expect(result.gateway.mode).toBe('local');
    expect(waitReady).toHaveBeenCalledWith(90_000, { retryIntervalMs: 250, probe: 'status' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('OpenClawAgent gateway helper wrappers delegate to the GatewayClient surface', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-gateway-helpers',
      user_id: 'user-1',
      state: 'running',
      openclaw_url: 'wss://openclaw-agent.dev.hypercli.com/ws',
      gateway_token: 'gw-helpers',
      jwt_token: 'jwt-helpers',
    });

    const close = vi.fn();
    const configPatch = vi.fn().mockResolvedValue(undefined);
    const modelsList = vi.fn().mockResolvedValue([{ id: 'kimi-k2.5' }]);
    const agentsList = vi.fn().mockResolvedValue([{ id: 'workspace-agent' }]);
    const filesList = vi.fn().mockResolvedValue([{ name: 'README.md' }]);
    const fileGet = vi.fn().mockResolvedValue('hello');
    const fileSet = vi.fn().mockResolvedValue(undefined);
    const chatHistory = vi.fn().mockResolvedValue([{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }]);
    const sendChat = vi.fn().mockResolvedValue({ runId: 'run-123' });
    const cronList = vi.fn().mockResolvedValue([{ id: 'job-1' }]);
    const chatSend = vi.fn(async function* (_message: string, _sessionKey: string) {
      yield { type: 'content', text: 'chunk-1' };
      yield { type: 'done' };
    });
    const release = vi.fn();

    const gatewayClient = {
      close,
      configPatch,
      modelsList,
      agentsList,
      filesList,
      fileGet,
      fileSet,
      chatHistory,
      sendChat,
      chatSend,
      cronList,
    } as any;
    vi.spyOn(agent, 'connect').mockResolvedValue(gatewayClient);
    vi.spyOn(agent, 'acquireConnectedGateway').mockResolvedValue({
      client: gatewayClient,
      release,
    } as any);

    await agent.configPatch({ gateway: { mode: 'local' } });
    expect(configPatch).toHaveBeenCalledWith({ gateway: { mode: 'local' } });

    await expect(agent.modelsList()).resolves.toEqual([{ id: 'kimi-k2.5' }]);

    await expect(agent.workspaceFiles()).resolves.toEqual({
      agentId: 'workspace-agent',
      files: [{ name: 'README.md' }],
    });
    expect(agentsList).toHaveBeenCalled();
    expect(filesList).toHaveBeenCalledWith('workspace-agent');

    await expect(agent.fileGet('README.md')).resolves.toBe('hello');
    expect(fileGet).toHaveBeenCalledWith('workspace-agent', 'README.md');

    await agent.fileSet('README.md', 'updated');
    expect(fileSet).toHaveBeenCalledWith('workspace-agent', 'README.md', 'updated');

    await expect(agent.fileGet('README.md', 'explicit-agent')).resolves.toBe('hello');
    expect(fileGet).toHaveBeenCalledWith('explicit-agent', 'README.md');

    await agent.fileSet('README.md', 'explicit-update', 'explicit-agent');
    expect(fileSet).toHaveBeenCalledWith('explicit-agent', 'README.md', 'explicit-update');

    await expect(agent.chatHistory('main', 20)).resolves.toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ]);
    expect(chatHistory).toHaveBeenCalledWith('main', 20);

    await expect(
      agent.chatSendMessage('hello', {
        sessionKey: 'main',
        agentId: 'workspace-agent',
        attachments: [{ id: 'att-1', dataUrl: 'data:image/png;base64,YWJj', mimeType: 'image/png' }],
      }),
    ).resolves.toEqual({ runId: 'run-123' });
    expect(sendChat).toHaveBeenCalledWith(
      'hello',
      'main',
      'workspace-agent',
      [{ id: 'att-1', dataUrl: 'data:image/png;base64,YWJj', mimeType: 'image/png' }],
    );

    const streamed = [];
    for await (const event of agent.chatSend('stream me', 'main')) {
      streamed.push(event);
    }
    expect(chatSend).toHaveBeenCalledWith('stream me', 'main', undefined);
    expect(streamed).toEqual([
      { type: 'content', text: 'chunk-1' },
      { type: 'done' },
    ]);

    await expect(agent.cronList()).resolves.toEqual([{ id: 'job-1' }]);
    expect(cronList).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(11);
    expect(close).not.toHaveBeenCalled();
  });

  it('OpenClawAgent waitRunning still delegates to Deployments.waitRunning', async () => {
    const deployments = new Deployments(
      { post: vi.fn(), get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );
    const ready = OpenClawAgent.fromDict({
      id: 'agent-ready',
      user_id: 'user-1',
      state: 'running',
      routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
      hostname: 'agent-ready.hypercli.app',
    });
    vi.spyOn(deployments, 'waitRunning').mockResolvedValue(ready);

    const agent = OpenClawAgent.fromDict({
      id: 'agent-ready',
      user_id: 'user-1',
      state: 'starting',
      launch_epoch: 10,
      routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
      hostname: 'agent-ready.hypercli.app',
    });
    (agent as any)._deployments = deployments;
    const gateway = vi.spyOn(agent, 'waitForGatewayContext');

    const result = await agent.waitRunning(42_000, 250);

    expect(deployments.waitRunning).toHaveBeenCalledWith('agent-ready', 42_000, 250, 10);
    expect(gateway).not.toHaveBeenCalled();
    expect(result).toBe(ready);
  });

  it('Agent waitRunning delegates to Deployments.waitRunning', async () => {
    const deployments = new Deployments(
      { post: vi.fn(), get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );
    const ready = Agent.fromDict({
      id: 'agent-ready',
      user_id: 'user-1',
      state: 'running',
    });
    vi.spyOn(deployments, 'waitRunning').mockResolvedValue(ready);

    const agent = Agent.fromDict({
      id: 'agent-ready',
      user_id: 'user-1',
      state: 'STARTING',
      launch_epoch: 10,
    });
    (agent as any)._deployments = deployments;

    const result = await agent.waitRunning(42_000, 250);

    expect(deployments.waitRunning).toHaveBeenCalledWith('agent-ready', 42_000, 250, 10);
    expect(result).toBe(ready);
  });

  it('create posts config and returns bound OpenClawAgent', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-1',
      user_id: 'user-1',
      state: 'starting',
      hostname: 'openclaw-pod-name.dev.hyperclaw.app',
      routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
    });
    const agents = new Deployments({ post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hyperclaw.app');

    const agent = await agents.create({
      name: 'smoke',
      size: 'large',
      dryRun: true,
      command: ['nginx', '-g', 'daemon off;'],
      entrypoint: ['/docker-entrypoint.sh'],
      env: { FOO: 'bar' },
    });

    expect(post).toHaveBeenCalledWith(
      '/deployments',
      expect.objectContaining({
        name: 'smoke',
        size: 'large',
        dry_run: true,
        env: { FOO: 'bar' },
        command: ['nginx', '-g', 'daemon off;'],
        entrypoint: ['/docker-entrypoint.sh'],
      }),
      { retries: 1 },
    );
    expect(agent).toBeInstanceOf(OpenClawAgent);
    expect((agent as OpenClawAgent).gatewayToken).toBeNull();
  });

  it('create posts only canonical meta.ui and hydrates it back onto the agent', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-2',
      user_id: 'user-1',
      state: 'creating',
      hostname: 'openclaw-pod-name-2.dev.hyperclaw.app',
      routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
      meta: {
        ui: {
          avatar: {
            image: 'data:image/png;base64,xyz',
            icon_index: 5,
          },
        },
      },
    });
    const agents = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hyperclaw.app',
    );
    const wait = vi.spyOn(agents, 'waitForState');

    const agent = await agents.create({
      name: 'meta-check',
      meta: {
        ui: {
          avatar: {
            image: 'data:image/png;base64,xyz',
            icon_index: 5,
          },
        },
      },
    });

    expect(post).toHaveBeenCalledWith(
      '/deployments',
      expect.objectContaining({
        name: 'meta-check',
        meta: {
          ui: {
            avatar: {
              image: 'data:image/png;base64,xyz',
              icon_index: 5,
            },
          },
        },
      }),
      { retries: 1 },
    );
    expect((post as any).mock.calls[0][1].meta.internal).toBeUndefined();
    expect((post as any).mock.calls[0][1].start).toBeUndefined();
    expect(agent.state).toBe('creating');
    expect(wait).not.toHaveBeenCalled();
  });

  it('list returns hydrated items', async () => {
    const get = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'agent-1',
          user_id: 'user-1',
          state: 'running',
        },
      ],
      budget: { total_cpu: 8 },
    });
    const agents = new Deployments({ post: vi.fn(), get, delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hyperclaw.app');

    const result = await agents.list();

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Agent);
  });

  it('exec forwards dry_run payload', async () => {
    const post = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout: 'preview\n',
      stderr: '',
      dry_run: true,
    });
    const agents = new Deployments({ post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.hypercli.com');

    const result = await agents.exec('agent-1', 'ls -la', { timeout: 20, dryRun: true });

    expect(post).toHaveBeenCalledWith('/deployments/agent-1/exec', {
      command: 'ls -la',
      timeout: 20,
      dry_run: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('preview\n');
  });

  it('shellToken and shellConnect use configured agents websocket base', async () => {
    const post = vi.fn().mockResolvedValue({
      jwt: 'jwt-abc',
      ws_url: 'wss://api.agents.dev.hypercli.com/ws/shell/agent-1?jwt=jwt-abc&shell=%2Fbin%2Fsh',
      shell: '/bin/sh',
      dry_run: true,
    });
    const agents = new Deployments({ post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hypercli.com');

    const token = await agents.shellToken('agent-1', '/bin/sh', true);
    const ws = await agents.shellConnect('agent-1', '/bin/sh');

    expect(token.jwt).toBe('jwt-abc');
    expect(post).toHaveBeenNthCalledWith(1, '/deployments/agent-1/shell/token', {
      shell: '/bin/sh',
      dry_run: true,
    });
    expect(post).toHaveBeenNthCalledWith(2, '/deployments/agent-1/shell/token', {
      shell: '/bin/sh',
    }, {
      retries: 3,
      retryStatuses: [429, 502, 503, 504],
      timeout: 4_000,
      signal: expect.any(AbortSignal),
    });
    expect((ws as any).url).toBe('wss://api.agents.dev.hypercli.com/ws/shell/agent-1?jwt=jwt-abc&shell=%2Fbin%2Fsh');
    expect(ws.binaryType).toBe('arraybuffer');
  });

  it('shellConnect defaults to websocket shells without exec probing', async () => {
    const post = vi.fn().mockResolvedValue({
      jwt: 'jwt-bash',
      ws_url: 'wss://api.agents.dev.hypercli.com/ws/shell/agent-1?jwt=jwt-bash&shell=%2Fbin%2Fbash',
      shell: '/bin/bash',
    });
    const agents = new Deployments({ post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hypercli.com');

    const ws = await agents.shellConnect('agent-1');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/deployments/agent-1/shell/token', {
      shell: '/bin/bash',
    }, {
      retries: 3,
      retryStatuses: [429, 502, 503, 504],
      timeout: 4_000,
      signal: expect.any(AbortSignal),
    });
    expect((ws as any).url).toBe('wss://api.agents.dev.hypercli.com/ws/shell/agent-1?jwt=jwt-bash&shell=%2Fbin%2Fbash');
  });

  it('shellConnect bounds websocket opening and closes a stalled socket', async () => {
    vi.useFakeTimers();
    let pendingSocketClose: ReturnType<typeof vi.fn> | null = null;
    class PendingWebSocket {
      public readonly url: string;
      public binaryType = 'blob';
      public onopen: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public onclose: ((event: { reason?: string }) => void) | null = null;
      public close = vi.fn();

      constructor(public readonly url: string) {
        this.url = url;
        pendingSocketClose = this.close;
      }
    }
    vi.stubGlobal('WebSocket', PendingWebSocket as any);
    const post = vi.fn().mockResolvedValue({ jwt: 'jwt-bash', shell: '/bin/bash' });
    const agents = new Deployments({ post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hypercli.com');

    const connection = agents.shellConnect('agent-1', '/bin/bash', { openTimeoutMs: 100 });
    const rejection = expect(connection).rejects.toThrow('Shell connection timed out');
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(pendingSocketClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('shellConnect bounds the complete token operation', async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockReturnValue(new Promise(() => undefined));
    const agents = new Deployments({ post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hypercli.com');

    const connection = agents.shellConnect('agent-1', '/bin/bash', { tokenTimeoutMs: 100 });
    const rejection = expect(connection).rejects.toThrow('Shell token request timed out');
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    vi.useRealTimers();
  });

  it('shellConnect bounds agent-name resolution within the token deadline', async () => {
    vi.useFakeTimers();
    const get = vi.fn().mockReturnValue(new Promise(() => undefined));
    const post = vi.fn();
    const agents = new Deployments({ post, get, delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hypercli.com');

    const connection = agents.shellConnect('friendly-name', '/bin/bash', { tokenTimeoutMs: 100 });
    const rejection = expect(connection).rejects.toThrow('Shell token request timed out');
    await vi.advanceTimersByTimeAsync(100);
    await rejection;

    expect(post).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith('/deployments', undefined, {
      signal: expect.any(AbortSignal),
    });
    expect((get.mock.calls[0][2] as { signal: AbortSignal }).signal.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('shellConnect only falls back when bash is explicitly unavailable', async () => {
    const post = vi.fn()
      .mockRejectedValueOnce(new APIError(422, '/bin/bash not found'))
      .mockResolvedValueOnce({ jwt: 'jwt-sh', shell: '/bin/sh' });
    const agents = new Deployments({ post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hypercli.com');

    const ws = await agents.shellConnect('agent-1');

    expect(post).toHaveBeenCalledTimes(2);
    expect((ws as any).url).toContain('shell=%2Fbin%2Fsh');
  });

  it('shellConnect retains a close reason after websocket error for shell fallback', async () => {
    class ShellAwareWebSocket {
      public binaryType = 'blob';
      public onopen: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public onclose: ((event: { reason?: string }) => void) | null = null;
      public close = vi.fn();

      constructor(public readonly url: string) {
        queueMicrotask(() => {
          if (url.includes('shell=%2Fbin%2Fbash')) {
            this.onerror?.();
            this.onclose?.({ reason: '/bin/bash not found' });
          } else {
            this.onopen?.();
          }
        });
      }
    }
    vi.stubGlobal('WebSocket', ShellAwareWebSocket as any);
    const post = vi.fn((_: string, payload: { shell: string }) => Promise.resolve({
      jwt: payload.shell === '/bin/bash' ? 'jwt-bash' : 'jwt-sh',
      shell: payload.shell,
    }));
    const agents = new Deployments({ post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hypercli.com');

    const ws = await agents.shellConnect('agent-1');

    expect(post).toHaveBeenCalledTimes(2);
    expect((ws as any).url).toContain('shell=%2Fbin%2Fsh');
  });

  it('shellConnect retains close metadata when the websocket closes before opening', async () => {
    class ClosingWebSocket {
      public binaryType = 'blob';
      public onopen: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public onclose: ((event: { code: number; reason: string }) => void) | null = null;
      public close = vi.fn();

      constructor(public readonly url: string) {
        queueMicrotask(() => this.onclose?.({ code: 4403, reason: 'forbidden' }));
      }
    }
    vi.stubGlobal('WebSocket', ClosingWebSocket as any);
    const post = vi.fn().mockResolvedValue({ jwt: 'jwt-sh', shell: '/bin/sh' });
    const agents = new Deployments({ post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hypercli.com');

    const error = await agents.shellConnect('agent-1', '/bin/sh').catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      message: 'WebSocket closed before opening: forbidden',
      closeCode: 4403,
      closeReason: 'forbidden',
    });
  });

  it('shellConnect aborts and closes a pending websocket', async () => {
    let pendingSocketClose: ReturnType<typeof vi.fn> | null = null;
    class PendingWebSocket {
      public binaryType = 'blob';
      public onopen: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public onclose: ((event: { reason?: string }) => void) | null = null;
      public close = vi.fn();

      constructor(public readonly url: string) {
        pendingSocketClose = this.close;
      }
    }
    vi.stubGlobal('WebSocket', PendingWebSocket as any);
    const post = vi.fn().mockResolvedValue({ jwt: 'jwt-bash', shell: '/bin/bash' });
    const agents = new Deployments({ post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hypercli.com');
    const controller = new AbortController();

    const connection = agents.shellConnect('agent-1', '/bin/bash', { signal: controller.signal });
    const rejection = expect(connection).rejects.toThrow('Shell connection cancelled');
    await vi.waitFor(() => expect(pendingSocketClose).not.toBeNull());
    controller.abort();

    await rejection;
    expect(pendingSocketClose).toHaveBeenCalledTimes(1);
    await expect(connection).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('shellConnect does not retry another shell after a network failure', async () => {
    const post = vi.fn().mockRejectedValue(new Error('network unavailable'));
    const agents = new Deployments({ post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hypercli.com');

    await expect(agents.shellConnect('agent-1')).rejects.toThrow('network unavailable');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty', ''],
    ['plain-text', 'temporarily unavailable'],
  ])('HTTPClient retries an explicitly configured %s transient response', async (_, body) => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(body, {
        status: 503,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jwt: 'jwt-ready' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HTTPClient('https://api.agents.dev.hypercli.com', 'sk-hyper-test');

    const result = await client.post<{ jwt: string }>('/deployments/agent-1/shell/token', {}, {
      retries: 2,
      backoff: 0,
      retryStatuses: [503],
    });

    expect(result.jwt).toBe('jwt-ready');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.stubGlobal('fetch', originalFetch);
  });

  it('HTTPClient does not replay a POST when its response body times out', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve({
      status: 200,
      statusText: 'OK',
      json: () => new Promise((_, reject) => {
        const signal = init?.signal as AbortSignal;
        const rejectOnAbort = () => {
          const error = new Error('Response body timed out');
          error.name = 'AbortError';
          reject(error);
        };
        if (signal.aborted) rejectOnAbort();
        else signal.addEventListener('abort', rejectOnAbort, { once: true });
      }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HTTPClient('https://api.agents.dev.hypercli.com', 'sk-hyper-test', 10);

    await expect(client.post('/deployments/agent-1/shell/token', {})).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Request timed out after 10ms',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', originalFetch);
  });

  it('HTTPClient normalizes lower-level transport timeouts', async () => {
    const originalFetch = globalThis.fetch;
    const transportError = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
    });
    const fetchMock = vi.fn().mockRejectedValue(transportError);
    vi.stubGlobal('fetch', fetchMock);
    const client = new HTTPClient('https://api.agents.dev.hypercli.com', 'sk-hyper-test');

    try {
      await expect(client.post('/deployments/agent-1/stop', undefined, { retries: 1 })).rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'Request timed out',
        cause: transportError,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('HTTPClient preserves an external abort that wins the timeout race', async () => {
    vi.useFakeTimers();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const requestSignal = init?.signal as AbortSignal;
      const rejectLater = () => setTimeout(() => reject(requestSignal.reason), 20);
      if (requestSignal.aborted) rejectLater();
      else requestSignal.addEventListener('abort', rejectLater, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HTTPClient('https://api.agents.dev.hypercli.com', 'sk-hyper-test', 10);
    const controller = new AbortController();
    const cancellation = new Error('caller cancelled the request');

    try {
      const result = expect(client.post('/deployments/agent-1/stop', undefined, {
        retries: 1,
        signal: controller.signal,
      })).rejects.toBe(cancellation);
      controller.abort(cancellation);
      await vi.runAllTimersAsync();
      await result;
    } finally {
      vi.useRealTimers();
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('logsConnect uses configured agents websocket base', async () => {
    const post = vi.fn().mockResolvedValue({
      jwt: 'jwt-logs',
      ws_url: 'wss://wrong-host.example/ws/logs/agent-1?jwt=jwt-logs',
    });
    const agents = new Deployments({ post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any, 'sk-hyper-test', 'https://api.dev.hypercli.com');

    const ws = await agents.logsConnect('agent-1', { container: 'reef', tailLines: 400 });

    expect(post).toHaveBeenCalledWith('/deployments/agent-1/logs/token');
    expect((ws as any).url).toBe('wss://api.agents.dev.hypercli.com/ws/logs/agent-1?jwt=jwt-logs&container=reef&tail_lines=400');
  });

  it('file operations use the path-based deployment file API', async () => {
    expect(AGENT_FILE_MAX_BYTES).toBe(250 * 1024 * 1024);
    expect(AGENT_FILE_TRANSFER_CHUNK_BYTES).toBe(64 * 1024);
    expect(AGENT_FILE_OPERATION_TIMEOUT_MS).toBe(300_000);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/deployments/agent-1/files/')) {
        return new Response(JSON.stringify({
          directories: [
            { name: '.openclaw', path: '.openclaw/', type: 'directory' },
            { name: 'workspace', path: 'workspace/', type: 'directory' },
          ],
          files: [{ name: 'AGENTS.md', path: 'AGENTS.md', type: 'file' }],
        }), { status: 200 });
      }
      if (url.endsWith('/deployments/agent-1/files/workspace')) {
        return new Response(JSON.stringify({
          directories: [{ name: 'dir', path: 'workspace/dir/', type: 'directory' }],
          files: [{ name: 'a.txt', path: 'workspace/a.txt', type: 'file' }],
        }), { status: 200 });
      }
      if (url.endsWith('/deployments/agent-1/files/workspace/a.txt') && (!init || !init.method)) {
        return new Response(new Uint8Array([104, 101, 108, 108, 111]), { status: 200 });
      }
      if (url.endsWith('/deployments/agent-1/files/workspace/a.txt') && init?.method === 'POST') {
        expect(init.body).toBeInstanceOf(Uint8Array);
        return new Response(JSON.stringify({ status: 'ok', target: 'pod' }), { status: 200 });
      }
      if (url.endsWith('/deployments/agent-1/files/workspace/a.txt') && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ status: 'ok', target: 'pod' }), { status: 200 });
      }
      if (url.endsWith('/deployments/agent-1/files/.openclaw') && (!init || !init.method)) {
        return new Response(JSON.stringify({
          type: 'directory',
          prefix: '.openclaw/',
          directories: [{ name: 'workspace', path: '.openclaw/workspace/', type: 'directory' }],
          files: [{ name: 'openclaw.json', path: '.openclaw/openclaw.json', type: 'file' }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const agents = new Deployments(
      { post: vi.fn(), get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    const rootEntries = await agents.filesList('agent-1');
    const entries = await agents.filesList('agent-1', 'workspace');
    const hiddenEntries = await agents.filesList('agent-1', '.openclaw');
    const content = await agents.fileRead('agent-1', 'workspace/a.txt');
    const writeResult = await agents.fileWrite('agent-1', 'workspace/a.txt', 'payload');
    const deleteResult = await agents.fileDelete('agent-1', 'workspace/a.txt');

    expect(rootEntries).toEqual([
      { name: '.openclaw', path: '.openclaw/', type: 'directory' },
      { name: 'workspace', path: 'workspace/', type: 'directory' },
      { name: 'AGENTS.md', path: 'AGENTS.md', type: 'file' },
    ]);
    expect(entries).toEqual([
      { name: 'dir', path: 'workspace/dir/', type: 'directory' },
      { name: 'a.txt', path: 'workspace/a.txt', type: 'file' },
    ]);
    expect(hiddenEntries).toEqual([
      { name: 'workspace', path: '.openclaw/workspace/', type: 'directory' },
      { name: 'openclaw.json', path: '.openclaw/openclaw.json', type: 'file' },
    ]);
    expect(content).toBe('hello');
    expect(writeResult).toEqual({ status: 'ok', target: 'pod' });
    expect(deleteResult).toEqual({ status: 'ok', target: 'pod' });
    await expect(agents.fileRead('agent-1', '.openclaw')).rejects.toThrow('Path is a directory: .openclaw');
    await expect(
      agents.fileWriteBytes('agent-1', 'workspace/too-large.bin', new Uint8Array(AGENT_FILE_MAX_BYTES + 1)),
    ).rejects.toThrow('250 MiB');
    await expect(agents.filesList('agent-1', '/')).rejects.toThrow('sync root');
    await expect(agents.fileWrite('agent-1', '/etc/hosts', 'blocked')).rejects.toThrow('sync root');
    await expect(agents.fileDelete('agent-1', '/etc/hosts')).rejects.toThrow('sync root');
  });
});
