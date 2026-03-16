import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Agent,
  Deployments,
  OpenClawAgent,
  buildAgentConfig,
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
      { env: { FOO: 'bar' } },
      {
        command: ['echo', 'hello'],
        entrypoint: ['/bin/sh', '-c'],
        routes: { openclaw: { port: 18789, auth: false } },
        image: 'ghcr.io/acme/reef:test',
      },
    );

    expect(gatewayToken).toMatch(/^ab+/);
    expect(config.env).toEqual({
      FOO: 'bar',
      OPENCLAW_GATEWAY_TOKEN: gatewayToken,
    });
    expect(config.command).toEqual(['echo', 'hello']);
    expect(config.entrypoint).toEqual(['/bin/sh', '-c']);
    expect(config.routes).toEqual({ openclaw: { port: 18789, auth: false } });
    expect(config.image).toBe('ghcr.io/acme/reef:test');
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
    expect(generic.shellUrl).toBe('https://shell-agent.dev.hyperclaw.app');
    expect(openclaw.gatewayUrl).toBe('wss://openclaw-agent2.dev.hyperclaw.app');
    expect(openclaw.gatewayToken).toBe('gw-123');
    expect(openclaw.command).toEqual(['sleep', '3600']);
    expect(openclaw.entrypoint).toEqual(['/bin/sh', '-c']);
  });

  it('OpenClawAgent gateway forwards deployment pairing context', () => {
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
    });
    (agent as any)._deployments = deployments;

    const gateway = agent.gateway({ clientId: 'openclaw-control-ui', clientMode: 'webchat' }) as any;

    expect(gateway.deploymentId).toBe('agent-ctx');
    expect(gateway.apiKey).toBe('sk-hyper-test');
    expect(gateway.apiBase).toBe('https://api.dev.hypercli.com/agents');
    expect(gateway.autoApprovePairing).toBe(true);
    expect(gateway.gatewayToken).toBe('gw-ctx');
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
      apiKey: 'moonshot-key',
      models: [{ id: 'kimi-k2.5', name: 'Kimi K2.5', reasoning: true }],
    });
    expect(provider.baseUrl).toBe('https://moonshot.example');

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

    expect(applied).toHaveLength(4);
    expect(applied[0]?.models?.providers?.moonshot?.apiKey).toBe('moonshot-key');
    expect(applied[1]?.models?.providers?.moonshot?.models?.[0]?.reasoning).toBe(true);
    expect(applied[2]?.agents?.defaults?.model?.primary).toBe('moonshot/kimi-k2.5');
    expect(applied[3]?.agents?.defaults?.memorySearch?.remote?.apiKey).toBe('embed-key');
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
      cpu: 4,
      memory: 16,
      dryRun: true,
      command: ['nginx', '-g', 'daemon off;'],
      entrypoint: ['/docker-entrypoint.sh'],
      env: { FOO: 'bar' },
    });

    expect(post).toHaveBeenCalledWith(
      '/deployments',
      expect.objectContaining({
        name: 'smoke',
        cpu: 4,
        memory: 16,
        dry_run: true,
        start: true,
        config: expect.objectContaining({
          env: expect.objectContaining({
            FOO: 'bar',
            OPENCLAW_GATEWAY_TOKEN: expect.any(String),
          }),
          command: ['nginx', '-g', 'daemon off;'],
          entrypoint: ['/docker-entrypoint.sh'],
        }),
      }),
    );
    expect(agent).toBeInstanceOf(OpenClawAgent);
    expect((agent as OpenClawAgent).gatewayToken).toMatch(/^ab+/);
  });

  it('list returns hydrated items and budget', async () => {
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

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toBeInstanceOf(Agent);
    expect(result.budget).toEqual({ total_cpu: 8 });
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
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const agents = new Deployments(
      { post: vi.fn(), get: vi.fn(), delete: vi.fn(), apiKey: 'hyper_api_test' } as any,
      'sk-hyper-test',
      'https://api.dev.hypercli.com',
    );

    const entries = await agents.filesList('agent-1', 'workspace');
    const content = await agents.fileRead('agent-1', 'workspace/a.txt');
    const writeResult = await agents.fileWrite('agent-1', 'workspace/a.txt', 'payload');
    const deleteResult = await agents.fileDelete('agent-1', 'workspace/a.txt');

    expect(entries).toEqual([
      { name: 'dir', path: 'workspace/dir/', type: 'directory' },
      { name: 'a.txt', path: 'workspace/a.txt', type: 'file' },
    ]);
    expect(content).toBe('hello');
    expect(writeResult).toEqual({ status: 'ok', target: 'pod' });
    expect(deleteResult).toEqual({ status: 'ok', target: 'pod' });
  });
});
