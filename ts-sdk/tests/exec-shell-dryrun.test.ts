import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  DEFAULT_OPENCLAW_IMAGE,
  Deployments,
  OpenClawAgent,
  buildAgentConfig,
  buildOpenClawRoutes,
} from '../src/agents.js';

class MockWebSocket {
  public readonly url: string;
  public onopen: (() => void) | null = null;
  public onerror: (() => void) | null = null;

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

  it('buildAgentConfig injects gateway token and preserves launch fields', () => {
    const { config, gatewayToken } = buildAgentConfig(
      { foo: 'bar' },
      {
        env: { FOO: 'bar' },
        command: ['echo', 'hello'],
        entrypoint: ['/bin/sh', '-c'],
        routes: { openclaw: { port: 18789, auth: false } },
        image: 'ghcr.io/hypercli/hypercli-openclaw:test',
      },
    );

    expect(gatewayToken).toMatch(/^ab+/);
    expect(config.config).toEqual({ foo: 'bar' });
    expect(config.env).toEqual({
      FOO: 'bar',
      OPENCLAW_GATEWAY_TOKEN: gatewayToken,
    });
    expect(config.command).toEqual(['echo', 'hello']);
    expect(config.entrypoint).toEqual(['/bin/sh', '-c']);
    expect(config.routes).toEqual({ openclaw: { port: 18789, auth: false } });
    expect(config.image).toBe('ghcr.io/hypercli/hypercli-openclaw:test');
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
          every: '0m',
          includeSystemPromptSection: false,
        },
      },
    );

    expect(config.config).toEqual({
      agents: {
        defaults: {
          model: 'openai/gpt-5.4',
          heartbeat: {
            target: 'last',
            every: '0m',
            includeSystemPromptSection: false,
          },
        },
      },
    });
  });

  it('buildOpenClawRoutes returns the default gateway and desktop routes', () => {
    expect(buildOpenClawRoutes()).toEqual({
      openclaw: { port: 18789, auth: false, prefix: '' },
      desktop: { port: 3000, auth: true, prefix: 'desktop' },
    });
  });

  it('buildOpenClawRoutes allows route overrides', () => {
    expect(buildOpenClawRoutes({
      includeDesktop: false,
      gatewayPort: 19999,
      gatewayAuth: true,
      gatewayPrefix: 'app',
    })).toEqual({
      openclaw: { port: 19999, auth: true, prefix: 'app' },
    });
  });

  it('createOpenClaw defaults routes when omitted', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-openclaw',
      user_id: 'user-1',
      pod_id: 'pod-1',
      pod_name: 'pod-1',
      state: 'starting',
      openclaw_url: 'wss://agent.dev.hypercli.com',
    });
    const deployments = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    await deployments.createOpenClaw({ name: 'test-agent' });

    expect(post).toHaveBeenCalledWith('/deployments', expect.objectContaining({
      image: DEFAULT_OPENCLAW_IMAGE,
      sync_root: '/home/node',
      sync_enabled: true,
      env: expect.not.objectContaining({ HOME: expect.anything() }),
      routes: {
        openclaw: { port: 18789, auth: false, prefix: '' },
        desktop: { port: 3000, auth: true, prefix: 'desktop' },
      },
    }));
  });

  it('createOpenClaw respects explicit empty routes', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-openclaw',
      user_id: 'user-1',
      pod_id: 'pod-1',
      pod_name: 'pod-1',
      state: 'starting',
    });
    const deployments = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    await deployments.createOpenClaw({ name: 'test-agent', routes: {} });

    expect(post).toHaveBeenCalledWith('/deployments', expect.objectContaining({
      image: DEFAULT_OPENCLAW_IMAGE,
      sync_root: '/home/node',
      sync_enabled: true,
      env: expect.not.objectContaining({ HOME: expect.anything() }),
      routes: {},
    }));
  });

  it('startOpenClaw defaults sync root', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-openclaw',
      user_id: 'user-1',
      pod_id: 'pod-1',
      pod_name: 'pod-1',
      state: 'starting',
      openclaw_url: 'wss://agent.dev.hypercli.com',
    });
    const deployments = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    await deployments.startOpenClaw('agent-123');

    expect(post).toHaveBeenCalledWith('/deployments/agent-123/start', expect.objectContaining({
      image: DEFAULT_OPENCLAW_IMAGE,
      sync_root: '/home/node',
      sync_enabled: true,
      env: expect.not.objectContaining({ HOME: expect.anything() }),
      routes: {
        openclaw: { port: 18789, auth: false, prefix: '' },
        desktop: { port: 3000, auth: true, prefix: 'desktop' },
      },
    }));
  });

  it('hydrates generic and OpenClaw agents correctly', () => {
    const generic = Agent.fromDict({
      id: 'agent-1',
      user_id: 'user-1',
      pod_id: 'pod-1',
      pod_name: 'pod-name',
      state: 'running',
      hostname: 'agent.dev.hyperclaw.app',
    });

    const openclaw = OpenClawAgent.fromDict({
      id: 'agent-2',
      user_id: 'user-1',
      pod_id: 'pod-2',
      pod_name: 'pod-name-2',
      state: 'running',
      hostname: 'agent2.dev.hyperclaw.app',
      openclaw_url: 'wss://openclaw-agent2.dev.hyperclaw.app',
      gateway_token: 'gw-123',
      jwt_token: 'jwt-123',
      command: ['sleep', '3600'],
      entrypoint: ['/bin/sh', '-c'],
    });

    expect(generic.publicUrl).toBe('https://agent.dev.hyperclaw.app');
    expect(generic.desktopUrl).toBe('https://desktop-agent.dev.hyperclaw.app');
    expect(generic.shellUrl).toBeNull();
    expect(openclaw.gatewayUrl).toBe('wss://openclaw-agent2.dev.hyperclaw.app');
    expect(openclaw.gatewayToken).toBe('gw-123');
    expect(openclaw.command).toEqual(['sleep', '3600']);
    expect(openclaw.entrypoint).toEqual(['/bin/sh', '-c']);
  });

  it('OpenClawAgent falls back to the root host for the gateway URL', () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-root',
      user_id: 'user-1',
      pod_id: 'pod-root',
      pod_name: 'pod-root',
      state: 'running',
      hostname: 'agent-root.dev.hyperclaw.app',
    });

    expect(agent.gatewayUrl).toBe('wss://agent-root.dev.hyperclaw.app');
  });

  it('OpenClawAgent gateway forwards deployment pairing context without using jwt query auth', () => {
    const deployments = new Deployments(
      { post: vi.fn(), get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );
    const agent = OpenClawAgent.fromDict({
      id: 'agent-ctx',
      user_id: 'user-1',
      pod_id: 'pod-ctx',
      pod_name: 'pod-ctx',
      state: 'running',
      openclaw_url: 'wss://openclaw-agent.dev.hypercli.com/ws',
      gateway_token: 'gw-ctx',
      jwt_token: 'jwt-ctx',
      routes: { openclaw: { port: 18789, auth: false } },
    });
    (agent as any)._deployments = deployments;

    const gateway = agent.gateway({ clientId: 'openclaw-control-ui', clientMode: 'webchat' }) as any;

    expect(gateway.deploymentId).toBe('agent-ctx');
    expect(gateway.apiKey).toBe('sk-hyper-test');
    expect(gateway.apiBase).toBe('https://api.dev.hypercli.com/agents');
    expect(gateway.autoApprovePairing).toBe(true);
    expect(gateway.gatewayToken).toBe('gw-ctx');
    expect(gateway.token).toBeUndefined();
  });

  it('OpenClawAgent gateway allows jwt-less connect when openclaw route auth is disabled', () => {
    const deployments = new Deployments(
      { post: vi.fn(), get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );
    const agent = OpenClawAgent.fromDict({
      id: 'agent-jwtless',
      user_id: 'user-1',
      pod_id: 'pod-jwtless',
      pod_name: 'pod-jwtless',
      state: 'running',
      openclaw_url: 'wss://openclaw-agent.dev.hypercli.com/ws',
      gateway_token: 'gw-jwtless',
      routes: { openclaw: { port: 18789, auth: false } },
    });
    (agent as any)._deployments = deployments;

    const gateway = agent.gateway() as any;

    expect(gateway.token).toBeUndefined();
    expect(gateway.gatewayToken).toBe('gw-jwtless');
  });

  it('OpenClawAgent config helpers mutate OpenClaw config through configApply', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-helpers',
      user_id: 'user-1',
      pod_id: 'pod-helpers',
      pod_name: 'pod-helpers',
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
      pod_id: 'pod-provider-matrix',
      pod_name: 'pod-provider-matrix',
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
      pod_id: 'pod-ready',
      pod_name: 'pod-ready',
      state: 'running',
      openclaw_url: 'wss://openclaw-agent.dev.hypercli.com/ws',
      gateway_token: 'gw-ready',
      jwt_token: 'jwt-ready',
    });

    const waitReady = vi.fn().mockResolvedValue({ gateway: { mode: 'local' } });
    const close = vi.fn();
    vi.spyOn(agent, 'gateway').mockReturnValue({
      waitReady,
      close,
    } as any);

    const result = await agent.waitReady(90_000, { retryIntervalMs: 250, probe: 'status' });

    expect(result.gateway.mode).toBe('local');
    expect(waitReady).toHaveBeenCalledWith(90_000, { retryIntervalMs: 250, probe: 'status' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('OpenClawAgent gateway helper wrappers delegate to the GatewayClient surface', async () => {
    const agent = OpenClawAgent.fromDict({
      id: 'agent-gateway-helpers',
      user_id: 'user-1',
      pod_id: 'pod-gateway-helpers',
      pod_name: 'pod-gateway-helpers',
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

    vi.spyOn(agent, 'connect').mockResolvedValue({
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
    expect(close).toHaveBeenCalledTimes(11);
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
      pod_id: 'pod-ready',
      pod_name: 'pod-ready',
      state: 'running',
    });
    vi.spyOn(deployments, 'waitRunning').mockResolvedValue(ready);

    const agent = Agent.fromDict({
      id: 'agent-ready',
      user_id: 'user-1',
      pod_id: 'pod-pending',
      pod_name: 'pod-pending',
      state: 'pending',
    });
    (agent as any)._deployments = deployments;

    const result = await agent.waitRunning(42_000, 250);

    expect(deployments.waitRunning).toHaveBeenCalledWith('agent-ready', 42_000, 250);
    expect(result).toBe(ready);
  });

  it('create posts config and returns bound OpenClawAgent', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-1',
      user_id: 'user-1',
      pod_id: 'pod-1',
      pod_name: 'pod-name',
      state: 'starting',
      openclaw_url: 'wss://openclaw-pod-name.dev.hyperclaw.app',
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
        start: true,
        env: expect.objectContaining({
          FOO: 'bar',
          OPENCLAW_GATEWAY_TOKEN: expect.any(String),
        }),
        command: ['nginx', '-g', 'daemon off;'],
        entrypoint: ['/docker-entrypoint.sh'],
      }),
    );
    expect(agent).toBeInstanceOf(OpenClawAgent);
    expect((agent as OpenClawAgent).gatewayToken).toMatch(/^ab+/);
  });

  it('create posts only meta.ui and hydrates it back onto the agent', async () => {
    const post = vi.fn().mockResolvedValue({
      id: 'agent-2',
      user_id: 'user-1',
      pod_id: 'pod-2',
      pod_name: 'pod-name-2',
      state: 'starting',
      meta: {
        ui: {
          avatar: {
            image: 'data:image/png;base64,xyz',
            icon_index: 5,
          },
        },
      },
      openclaw_url: 'wss://openclaw-pod-name-2.dev.hyperclaw.app',
    });
    const agents = new Deployments(
      { post, get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hyperclaw.app',
    );

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
    );
    expect((post as any).mock.calls[0][1].meta.internal).toBeUndefined();
    expect(agent.meta).toEqual({
      ui: {
        avatar: {
          image: 'data:image/png;base64,xyz',
          icon_index: 5,
        },
      },
    });
  });

  it('list returns hydrated items', async () => {
    const get = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'agent-1',
          user_id: 'user-1',
          pod_id: 'pod-1',
          pod_name: 'pod-name',
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
    });
    expect((ws as any).url).toBe('wss://api.agents.dev.hypercli.com/ws/shell/agent-1?jwt=jwt-abc&shell=%2Fbin%2Fsh');
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
    });
    expect((ws as any).url).toBe('wss://api.agents.dev.hypercli.com/ws/shell/agent-1?jwt=jwt-bash&shell=%2Fbin%2Fbash');
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/deployments/agent-1/files/workspace')) {
        return new Response(JSON.stringify({
          directories: [{ name: 'dir', path: 'workspace/dir/', type: 'directory' }],
          files: [{ name: 'a.txt', path: 'workspace/a.txt', type: 'file' }],
        }), { status: 200 });
      }
      if (url.endsWith('/deployments/agent-1/files/workspace/a.txt') && (!init || !init.method)) {
        return new Response(new Uint8Array([104, 101, 108, 108, 111]), { status: 200 });
      }
      if (url.endsWith('/deployments/agent-1/files/workspace/a.txt') && init?.method === 'PUT') {
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

    const entries = await agents.filesList('agent-1', 'workspace');
    const hiddenEntries = await agents.filesList('agent-1', '.openclaw');
    const content = await agents.fileRead('agent-1', 'workspace/a.txt');
    const writeResult = await agents.fileWrite('agent-1', 'workspace/a.txt', 'payload');
    const deleteResult = await agents.fileDelete('agent-1', 'workspace/a.txt');

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
  });
});
