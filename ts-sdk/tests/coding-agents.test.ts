import { describe, expect, it, vi } from 'vitest';
import {
  ClaudeCodeAgent,
  CodexAgent,
  DEFAULT_CLAUDE_CODE_IMAGE,
  DEFAULT_CODEX_IMAGE,
  DEFAULT_GOOSE_IMAGE,
  DEFAULT_KIMI_CODE_IMAGE,
  DEFAULT_OPENCODE_IMAGE,
  Deployments,
  GooseAgent,
  KimiCodeAgent,
  OpenCodeAgent,
} from '../src/agents.js';
import type { HTTPClient } from '../src/http.js';

function response(runtime: 'opencode' | 'codex' | 'claude-code' | 'goose' | 'kimi-code') {
  return {
    id: `${runtime}-1`,
    user_id: 'user-1',
    pod_id: 'pod-1',
    pod_name: 'pod-1',
    state: 'RUNNING',
    runtime,
  };
}

describe('coding agents', () => {
  it.each([
    ['createOpenCode', 'opencode', DEFAULT_OPENCODE_IMAGE, OpenCodeAgent],
    ['createCodex', 'codex', DEFAULT_CODEX_IMAGE, CodexAgent],
    ['createClaudeCode', 'claude-code', DEFAULT_CLAUDE_CODE_IMAGE, ClaudeCodeAgent],
    ['createGoose', 'goose', DEFAULT_GOOSE_IMAGE, GooseAgent],
    ['createKimiCode', 'kimi-code', DEFAULT_KIMI_CODE_IMAGE, KimiCodeAgent],
  ] as const)('creates %s with the managed runtime contract', async (helper, runtime, image, AgentClass) => {
    const post = vi.fn().mockResolvedValue(response(runtime));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    const agent = await deployments[helper]();

    expect(agent).toBeInstanceOf(AgentClass);
    expect(agent.runtime).toBe(runtime);
    expect(post).toHaveBeenCalledWith('/deployments', {
      start: true,
      runtime,
      size: 'large',
      image,
      routes: {},
      sync_root: '/home/node',
      sync_enabled: true,
      sync_uid: 1000,
      sync_gid: 1000,
      env: {
        HYPER_API_BASE: 'https://api.test.hypercli.com',
        HYPER_WORKSPACES_BOOT_SYNC: '1',
        HYPER_WORKSPACES_DIR: '/home/node/workspaces',
        HYPER_WORKSPACES_SYNC_READY_ONLY: '1',
      },
    });
    expect(post.mock.calls[0][1].env).not.toHaveProperty('OPENCLAW_GATEWAY_TOKEN');
  });

  it('launches Buzz ACP explicitly and retains caller environment injection', async () => {
    const post = vi.fn().mockResolvedValue(response('codex'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createCodex({
      buzzEnabled: true,
      env: { CODEX_API_KEY: 'test-key' },
      workspacesSync: { workspace: 'buzz' },
    });

    expect(post.mock.calls[0][1]).toMatchObject({
      runtime: 'codex',
      command: ['/usr/local/bin/buzz-acp'],
      env: {
        CODEX_API_KEY: 'test-key',
        HYPER_WORKSPACES_SYNC_WORKSPACE: 'buzz',
      },
    });
    await expect(deployments.createCodex({
      buzzEnabled: true,
      command: ['sleep', 'infinity'],
    })).rejects.toThrow('Buzz launch cannot be combined');
  });

  it('renders typed Buzz launch settings with canonical OpenCode defaults', async () => {
    const post = vi.fn().mockResolvedValue(response('opencode'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createOpenCode({
      name: 'Fizz4',
      env: {
        BUZZ_RELAY_URL: 'wss://attacker.invalid',
        BUZZ_ACP_AGENT_COMMAND: '/tmp/not-opencode',
        RUST_LOG: 'debug',
        HYPER_API_KEY: 'inference-key',
      },
      buzz: {
        privateKeyNsec: 'nsec1test',
        relayUrl: 'wss://buzz.example.test',
        model: 'hypercli/kimi-k2.6-anthropic',
        parallelism: 3,
      },
    });

    expect(post.mock.calls[0][1]).toMatchObject({
      size: 'large',
      routes: {},
      command: ['/usr/local/bin/buzz-acp'],
      env: {
        BUZZ_RELAY_URL: 'wss://buzz.example.test',
        BUZZ_ACP_AGENT_COMMAND: '/usr/local/bin/opencode',
        BUZZ_ACP_AGENT_ARGS: 'acp',
        BUZZ_ACP_MCP_COMMAND: '/usr/local/bin/buzz-dev-mcp',
        BUZZ_ACP_SESSION_TITLE: 'Fizz4',
        BUZZ_ACP_MODEL: 'hypercli/kimi-k2.6-anthropic',
        BUZZ_ACP_AGENTS: '3',
        BUZZ_ACP_LAZY_POOL: 'true',
        BUZZ_ACP_RELAY_OBSERVER: 'true',
        RUST_LOG: 'debug',
        HYPER_API_KEY: 'inference-key',
      },
    });
  });

  it('rejects coding-agent sizes that cannot run the pro runtime', async () => {
    const deployments = new Deployments(
      { post: vi.fn() } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await expect(deployments.createOpenCode({ size: 'small' })).rejects.toThrow(
      "coding agents require size='large'",
    );
  });

  it('hydrates coding runtimes returned by get', async () => {
    const agentId = '11111111-1111-4111-8111-111111111111';
    const get = vi.fn().mockResolvedValue({ ...response('claude-code'), id: agentId });
    const deployments = new Deployments(
      { get } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await expect(deployments.get(agentId)).resolves.toBeInstanceOf(ClaudeCodeAgent);
  });

  it('discovers Buzz ACP methods and merges native runtime methods', async () => {
    const agent = CodexAgent.fromDict(response('codex'));
    vi.spyOn(agent, 'exec').mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        methods: [{
          id: 'oauth',
          name: 'Browser OAuth',
          _meta: { 'terminal-auth': { command: 'codex', args: ['login'] } },
        }],
      }),
      stderr: '',
    });

    const methods = await agent.auth.methods();

    expect(methods).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'oauth', command: ['codex', 'login'] }),
      expect.objectContaining({ id: 'device', command: ['codex', 'login', '--device-auth'] }),
    ]));
  });

  it('does not pretend managed Goose credentials have a vendor logout', async () => {
    const goose = GooseAgent.fromDict(response('goose'));

    await expect(goose.auth.logout()).rejects.toThrow('injected deployment credential');
  });

  it('normalizes Claude JSON and generic unauthenticated status output', async () => {
    const claude = ClaudeCodeAgent.fromDict(response('claude-code'));
    vi.spyOn(claude, 'exec').mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ loggedIn: true, email: 'dev@example.com', subscriptionType: 'pro', loginMethod: 'oauth' }),
      stderr: '',
    });
    await expect(claude.auth.status()).resolves.toMatchObject({
      authenticated: true,
      account: 'dev@example.com',
      provider: 'pro',
      method: 'oauth',
    });

    const codex = CodexAgent.fromDict(response('codex'));
    vi.spyOn(codex, 'exec').mockResolvedValue({ exitCode: 0, stdout: 'Not logged in', stderr: '' });
    await expect(codex.auth.status()).resolves.toMatchObject({ authenticated: false });
  });

  it('logs out through the protected exec surface and rechecks status', async () => {
    const agent = OpenCodeAgent.fromDict(response('opencode'));
    const exec = vi.spyOn(agent, 'exec')
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '0 credentials', stderr: '' });

    await expect(agent.auth.logout('anthropic')).resolves.toMatchObject({ authenticated: false });
    expect(exec.mock.calls.map(([command]) => command)).toEqual([
      "'opencode' 'auth' 'logout' 'anthropic'",
      "'buzz-acp' 'models' '--agent-command' 'opencode' '--agent-args' 'acp' '--json'",
    ]);
  });

  it('runs login in an authenticated shell and captures the browser challenge', async () => {
    const agent = CodexAgent.fromDict(response('codex'));
    vi.spyOn(agent, 'exec')
      .mockResolvedValueOnce({ exitCode: 0, stdout: '{"methods":[]}', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'Logged in', stderr: '' });
    const socket = {
      onmessage: null as ((event: { data: string }) => void) | null,
      onclose: null as (() => void) | null,
      send: vi.fn((value: string) => {
        const marker = value.match(/(__HYPERCLI_AUTH_EXIT_[a-f0-9]+__=)/)?.[1];
        queueMicrotask(() => socket.onmessage?.({
          data: `Open https://auth.example/device\nVerification code: ABCD-1234\n${marker}0\n`,
        }));
      }),
      close: vi.fn(),
      readyState: 1,
    };
    vi.spyOn(agent, 'shellConnect').mockResolvedValue(socket as unknown as WebSocket);

    const login = await agent.auth.login({ method: 'device', challengeTimeoutMs: 1000 });

    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining("'codex' 'login' '--device-auth'"));
    expect(login.verificationUrl).toBe('https://auth.example/device');
    expect(login.userCode).toBe('ABCD-1234');
    await expect(login.wait(1000)).resolves.toMatchObject({ authenticated: true });
  });
});
