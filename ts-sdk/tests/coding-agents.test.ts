import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  BuzzAgent,
  ClaudeCodeAgent,
  CodexAgent,
  DEFAULT_AGENT_RUNTIME_SCOPES,
  DEFAULT_BUZZ_AGENT_IMAGE,
  DEFAULT_BUZZ_CLAUDE_CODE_IMAGE,
  DEFAULT_BUZZ_CODING_AGENT_IMAGES,
  DEFAULT_BUZZ_CODEX_IMAGE,
  DEFAULT_BUZZ_GOOSE_IMAGE,
  DEFAULT_BUZZ_KIMI_CODE_IMAGE,
  DEFAULT_BUZZ_OPENCODE_IMAGE,
  DEFAULT_CLAUDE_CODE_IMAGE,
  DEFAULT_CODING_AGENT_IMAGES,
  DEFAULT_CODEX_IMAGE,
  DEFAULT_GOOSE_IMAGE,
  DEFAULT_KIMI_CODE_IMAGE,
  DEFAULT_OPENCODE_IMAGE,
  DEFAULT_BUZZ_RUST_LOG,
  Deployments,
  GooseAgent,
  KimiCodeAgent,
  OpenCodeAgent,
} from '../src/agents.js';
import type { HTTPClient } from '../src/http.js';

const CODEX_0146_DEVICE_AUTH_PROMPT = [
  '\r\nWelcome to Codex [v\x1b[90m0.146.0\x1b[0m]\r\n',
  "\x1b[90mOpenAI's command-line coding agent\x1b[0m\r\n\r\n",
  'Follow these steps to sign in with ChatGPT using device code authorization:\r\n\r\n',
  '1. Open this link in your browser and sign in to your account\r\n',
  '   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\r\n\r\n',
  '2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\r\n',
  '   \x1b[94mABCD-EFGHJ\x1b[0m\r\n\r\n',
  '\x1b[90mContinue only if you started this login in Codex. If a website or another ',
  'person gave you this code, cancel.\x1b[0m\r\n\r\n',
].join('');

const buzzGolden = JSON.parse(readFileSync(
  new URL('../../tests/fixtures/buzz-launch-contract.json', import.meta.url),
  'utf8',
)) as {
  runtime_scopes: string[];
  common: Record<string, unknown>;
  common_env: Record<string, string>;
  runtimes: Record<string, {
    sync_include: string[];
    image: string;
    agent_command: string;
    agent_args: string;
    mcp_command: string;
    env: Record<string, string>;
  }>;
};

function response(runtime: 'buzz-agent' | 'opencode' | 'codex' | 'claude-code' | 'goose' | 'kimi-code') {
  return {
    id: `${runtime}-1`,
    user_id: 'user-1',
    state: 'RUNNING',
    runtime,
  };
}

describe('coding agents', () => {
  it('publishes explicit generic and Buzz image catalogs', () => {
    expect(DEFAULT_CODING_AGENT_IMAGES).toEqual({
      'buzz-agent': DEFAULT_BUZZ_AGENT_IMAGE,
      opencode: DEFAULT_OPENCODE_IMAGE,
      codex: DEFAULT_CODEX_IMAGE,
      'claude-code': DEFAULT_CLAUDE_CODE_IMAGE,
      goose: DEFAULT_GOOSE_IMAGE,
      'kimi-code': DEFAULT_KIMI_CODE_IMAGE,
    });
    expect(DEFAULT_BUZZ_CODING_AGENT_IMAGES).toEqual({
      'buzz-agent': DEFAULT_BUZZ_AGENT_IMAGE,
      opencode: DEFAULT_BUZZ_OPENCODE_IMAGE,
      codex: DEFAULT_BUZZ_CODEX_IMAGE,
      'claude-code': DEFAULT_BUZZ_CLAUDE_CODE_IMAGE,
      goose: DEFAULT_BUZZ_GOOSE_IMAGE,
      'kimi-code': DEFAULT_BUZZ_KIMI_CODE_IMAGE,
    });
    expect(new Set([
      ...Object.values(DEFAULT_CODING_AGENT_IMAGES),
      ...Object.values(DEFAULT_BUZZ_CODING_AGENT_IMAGES),
    ]).size).toBe(11);
  });

  it.each([
    ['createBuzzAgent', 'buzz-agent', DEFAULT_BUZZ_AGENT_IMAGE, BuzzAgent, undefined, []],
    ['createOpenCode', 'opencode', DEFAULT_OPENCODE_IMAGE, OpenCodeAgent, [
      '.config/opencode',
      '.local/share/opencode',
      '.local/state/opencode',
      '.cache/opencode',
    ], undefined],
    ['createCodex', 'codex', DEFAULT_CODEX_IMAGE, CodexAgent, ['.codex'], undefined],
    ['createClaudeCode', 'claude-code', DEFAULT_CLAUDE_CODE_IMAGE, ClaudeCodeAgent, ['.claude', '.claude.json'], undefined],
    ['createGoose', 'goose', DEFAULT_GOOSE_IMAGE, GooseAgent, ['.goose'], undefined],
    ['createKimiCode', 'kimi-code', DEFAULT_KIMI_CODE_IMAGE, KimiCodeAgent, ['.kimi-code'], undefined],
  ] as const)('creates %s with the managed runtime contract', async (helper, runtime, image, AgentClass, syncInclude, syncExclude) => {
    const post = vi.fn().mockResolvedValue(response(runtime));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const agent = await deployments[helper]();

    expect(agent).toBeInstanceOf(AgentClass);
    expect(agent.runtime).toBe(runtime);
    expect(post).toHaveBeenCalledWith('/deployments', expect.objectContaining({
      runtime,
      image,
      sync_root: '/home/node',
      sync_uid: 1000,
      sync_gid: 1000,
      restart: false,
      runtime_scopes: DEFAULT_AGENT_RUNTIME_SCOPES,
    }), { retries: 1 });
    const expectedEnv: Record<string, string> = {
      HYPER_WORKSPACES_BOOT_SYNC: '1',
      HYPER_WORKSPACES_DIR: '/home/node/shared',
      HYPER_WORKSPACES_SYNC_READY_ONLY: '1',
    };
    expect(post.mock.calls[0][1].env).toEqual(expectedEnv);
    expect(post.mock.calls[0][1].routes).toEqual({});
    expect(post.mock.calls[0][1].secrets ?? {}).not.toHaveProperty('HYPER_ACP_WS_TOKEN');
    expect(agent.hyperAcpWsToken).toBeNull();
    if (syncInclude === undefined) {
      expect(post.mock.calls[0][1]).not.toHaveProperty('sync_include');
    } else {
      expect(post.mock.calls[0][1].sync_include).toEqual(syncInclude);
    }
    if (syncExclude === undefined) {
      expect(post.mock.calls[0][1]).not.toHaveProperty('sync_exclude');
    } else {
      expect(post.mock.calls[0][1].sync_exclude).toEqual(syncExclude);
    }
    expect(post.mock.calls[0][1].env).not.toHaveProperty('OPENCLAW_GATEWAY_TOKEN');
  });

  it('honors a coding-agent runtime scope override', async () => {
    const post = vi.fn().mockResolvedValue(response('opencode'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createOpenCode({ runtimeScopes: ['models:*'] });

    expect(post.mock.calls[0][1].runtime_scopes).toEqual(['models:*']);
  });

  it('honors a coding-agent Workspaces directory override', async () => {
    const post = vi.fn().mockResolvedValue(response('codex'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createCodex({
      env: { HYPER_WORKSPACES_DIR: '/home/node/custom-shared' },
    });

    expect(post.mock.calls[0][1].env.HYPER_WORKSPACES_DIR).toBe('/home/node/custom-shared');
  });

  it.each([
    [{ syncInclude: null }, undefined, undefined],
    [{ syncExclude: null }, undefined, undefined],
    [{ syncInclude: ['work'], syncExclude: ['tmp'] }, ['work'], undefined],
    [{ syncExclude: ['.cache'] }, undefined, ['.cache']],
  ] as const)('applies coding-agent sync policy overrides', async (options, expectedInclude, expectedExclude) => {
    const post = vi.fn().mockResolvedValue(response('codex'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createCodex(options);

    expect(post.mock.calls[0][1].sync_include).toEqual(expectedInclude);
    expect(post.mock.calls[0][1].sync_exclude).toEqual(expectedExclude);
  });

  it('rejects empty coding-agent sync include', async () => {
    const deployments = new Deployments(
      { post: vi.fn() } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await expect(deployments.createCodex({ syncInclude: [] })).rejects.toThrow(
      /syncInclude must contain/,
    );
  });

  it('reads the runtime subclass sync default during creation', async () => {
    const post = vi.fn().mockResolvedValue(response('codex'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const original = CodexAgent.defaultSyncInclude;
    Object.defineProperty(CodexAgent, 'defaultSyncInclude', {
      configurable: true,
      value: ['.custom-codex'],
    });

    try {
      await deployments.createCodex();
    } finally {
      Object.defineProperty(CodexAgent, 'defaultSyncInclude', {
        configurable: true,
        value: original,
      });
    }

    expect(post.mock.calls[0][1].sync_include).toEqual(['.custom-codex']);
  });

  it('gives include precedence when both filters are supplied', async () => {
    const post = vi.fn().mockResolvedValue(response('codex'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createCodex({ syncInclude: ['.codex'], syncExclude: ['tmp'] });
    expect(post.mock.calls[0][1].sync_include).toEqual(['.codex']);
    expect(post.mock.calls[0][1]).not.toHaveProperty('sync_exclude');
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
      image: DEFAULT_BUZZ_CODEX_IMAGE,
      command: ['/usr/local/bin/hyper-acp', 'plugin', 'buzz'],
      restart: false,
      env: {
        CODEX_API_KEY: 'test-key',
        HYPER_WORKSPACES_SYNC_WORKSPACE: 'buzz',
        RUST_LOG: DEFAULT_BUZZ_RUST_LOG,
        HYPER_ACP_WS_URL: 'wss://api.test.hypercli.com/ws',
        BUZZ_ACP_RELAY_OBSERVER: 'false',
      },
    });
    await expect(deployments.createCodex({
      buzzEnabled: true,
      command: ['sleep', 'infinity'],
    })).rejects.toThrow('Buzz launch cannot be combined');
  });

  it.each([
    ['createBuzzAgent', 'buzz-agent', DEFAULT_BUZZ_AGENT_IMAGE],
    ['createOpenCode', 'opencode', DEFAULT_BUZZ_OPENCODE_IMAGE],
    ['createCodex', 'codex', DEFAULT_BUZZ_CODEX_IMAGE],
    ['createClaudeCode', 'claude-code', DEFAULT_BUZZ_CLAUDE_CODE_IMAGE],
    ['createGoose', 'goose', DEFAULT_BUZZ_GOOSE_IMAGE],
    ['createKimiCode', 'kimi-code', DEFAULT_BUZZ_KIMI_CODE_IMAGE],
  ] as const)('uses the specialized Buzz image for %s', async (helper, runtime, image) => {
    const post = vi.fn().mockResolvedValue(response(runtime));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments[helper]({ buzzEnabled: true });

    expect(post.mock.calls[0][1]).toMatchObject({
      runtime,
      image,
      command: ['/usr/local/bin/hyper-acp', 'plugin', 'buzz'],
    });
  });

  it.each([
    ['createBuzzAgent', 'buzz-agent'],
    ['createOpenCode', 'opencode'],
    ['createCodex', 'codex'],
    ['createClaudeCode', 'claude-code'],
    ['createGoose', 'goose'],
    ['createKimiCode', 'kimi-code'],
  ] as const)('matches the shared cross-language Buzz golden for %s', async (helper, runtime) => {
    const post = vi.fn().mockResolvedValue(response(runtime));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments[helper]({
      // The shared golden pins the exact buzz launch payload, including the
      // complete secrets map; hyper-acp provisioning is tested separately.
      buzzActivity: false,
      buzz: {
        privateKeyNsec: 'nsec1test',
        relayUrl: 'wss://buzz.example.test',
      },
    });

    const payload = post.mock.calls[0][1];
    const expectedRuntime = buzzGolden.runtimes[runtime];
    expect(payload).toMatchObject(buzzGolden.common);
    expect(payload.runtime).toBe(runtime);
    expect(payload.runtime_scopes).toEqual(buzzGolden.runtime_scopes);
    expect(payload.image).toBe(expectedRuntime.image);
    expect(payload.sync_include).toEqual(expectedRuntime.sync_include);
    expect(payload.env.BUZZ_ACP_AGENT_COMMAND).toBe(expectedRuntime.agent_command);
    expect(payload.env.BUZZ_ACP_AGENT_ARGS).toBe(expectedRuntime.agent_args);
    expect(payload.env.BUZZ_ACP_MCP_COMMAND).toBe(expectedRuntime.mcp_command);
    for (const [key, value] of Object.entries(buzzGolden.common_env)) {
      expect(payload.env[key]).toBe(
        key === 'HYPER_ACP_WS_URL' ? 'wss://api.test.hypercli.com/ws' : value,
      );
    }
    expect(payload.env.CLAUDE_CODE_EXECUTABLE ?? null).toBe(
      expectedRuntime.claude_code_executable,
    );
    for (const [key, value] of Object.entries(expectedRuntime.env)) {
      expect(payload.env[key]).toBe(value);
    }
    for (const key of ['BUZZ_AGENT_REQUIRE_REPLY']) {
      if (!(key in buzzGolden.common_env) && !(key in expectedRuntime.env)) {
        expect(payload.env[key]).toBeUndefined();
      }
    }
    expect(payload.env.BUZZ_PRIVATE_KEY).toBeUndefined();
    expect(payload.env.NOSTR_PRIVATE_KEY).toBeUndefined();
    expect(payload.secrets).toEqual({
      BUZZ_PRIVATE_KEY: 'nsec1test',
      NOSTR_PRIVATE_KEY: 'nsec1test',
    });
  });

  it('honors an explicit image override for a typed Buzz launch', async () => {
    const post = vi.fn().mockResolvedValue(response('opencode'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createOpenCode({
      image: 'registry.example.test/custom-buzz-opencode:immutable',
      buzz: {
        privateKeyNsec: 'nsec1test',
        relayUrl: 'wss://buzz.example.test',
      },
    });

    expect(post.mock.calls[0][1].image).toBe(
      'registry.example.test/custom-buzz-opencode:immutable',
    );
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
      // Exact secrets/routes assertions below pin the buzz contract;
      // hyper-acp provisioning is tested separately.
      buzzActivity: false,
      env: {
        BUZZ_RELAY_URL: 'wss://attacker.invalid',
        BUZZ_ACP_AGENT_COMMAND: '/tmp/not-opencode',
        BUZZ_ACP_REQUIRE_REPLY: 'false',
        BUZZ_MANAGED_AGENT: 'forged',
        BUZZ_MANAGED_AGENT_START_NONCE: 'forged',
        CLAUDE_CODE_EXECUTABLE: '/host/bin/claude',
        RUST_LOG: 'debug',
        HYPER_API_KEY: 'inference-key',
      },
      buzz: {
        privateKeyNsec: 'nsec1test',
        relayUrl: 'wss://buzz.example.test',
        model: 'hypercli/kimi-k2.6-anthropic',
        parallelism: 3,
        requireReply: true,
      },
    });

    expect(post.mock.calls[0][1]).toMatchObject({
      size: 'large',
      image: DEFAULT_BUZZ_OPENCODE_IMAGE,
      routes: {},
      command: ['/usr/local/bin/hyper-acp', 'plugin', 'buzz'],
      restart: false,
      env: {
        BUZZ_RELAY_URL: 'wss://buzz.example.test',
        BUZZ_ACP_AGENT_COMMAND: '/usr/local/bin/opencode',
        BUZZ_ACP_AGENT_ARGS: 'acp',
        BUZZ_ACP_MCP_COMMAND: '',
        BUZZ_ACP_SESSION_TITLE: 'Fizz4',
        BUZZ_ACP_MODEL: 'hypercli/kimi-k2.6-anthropic',
        BUZZ_ACP_AGENTS: '3',
        BUZZ_ACP_LAZY_POOL: 'true',
        BUZZ_ACP_RELAY_OBSERVER: 'false',
        HYPER_ACP_WS_URL: 'wss://api.test.hypercli.com/ws',
        BUZZ_ACP_REQUIRE_REPLY: 'true',
        RUST_LOG: 'debug',
        HYPER_API_KEY: 'inference-key',
      },
    });
    expect(post.mock.calls[0][1].env.BUZZ_AGENT_REQUIRE_REPLY).toBeUndefined();
    expect(post.mock.calls[0][1].env.CLAUDE_CODE_EXECUTABLE).toBeUndefined();
    expect(post.mock.calls[0][1].env.BUZZ_MANAGED_AGENT).toBeUndefined();
    // The SDK no longer mints a start nonce; caller-supplied values are
    // still stripped so users cannot inject the reserved key.
    expect(post.mock.calls[0][1].env.BUZZ_MANAGED_AGENT_START_NONCE).toBeUndefined();
    expect(post.mock.calls[0][1].secrets).toEqual({
      BUZZ_PRIVATE_KEY: 'nsec1test',
      NOSTR_PRIVATE_KEY: 'nsec1test',
    });
  });

  it('sets the native reply guard only for native Buzz Agent launches', async () => {
    const post = vi.fn().mockResolvedValue(response('buzz-agent'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createBuzzAgent({
      buzz: {
        privateKeyNsec: 'nsec1test',
        relayUrl: 'wss://buzz.example.test',
      },
    });

    expect(post.mock.calls[0][1].runtime).toBe('buzz-agent');
    expect(post.mock.calls[0][1].env.BUZZ_ACP_REQUIRE_REPLY).toBe('true');
    expect(post.mock.calls[0][1].env.BUZZ_AGENT_REQUIRE_REPLY).toBe('1');
  });

  it('uses a safe default ACP log filter for typed Buzz launches', async () => {
    const post = vi.fn().mockResolvedValue(response('opencode'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createOpenCode({
      buzz: {
        privateKeyNsec: 'nsec1test',
        relayUrl: 'wss://buzz.example.test',
      },
    });

    expect(post.mock.calls[0][1].env.RUST_LOG).toBe(DEFAULT_BUZZ_RUST_LOG);
    expect(post.mock.calls[0][1].restart).toBe(false);
    expect(DEFAULT_BUZZ_RUST_LOG).toBe('hyper_acp=info,buzz_acp=info,pool::prompt=info,acp::stream=off');
  });

  it('forces typed Buzz launches to keep restart disabled', async () => {
    const post = vi.fn().mockResolvedValue(response('opencode'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createOpenCode({
      restart: true,
      buzz: {
        privateKeyNsec: 'nsec1test',
        relayUrl: 'wss://buzz.example.test',
      },
    });

    expect(post.mock.calls[0][1].restart).toBe(false);
  });

  it('preserves the requested size for non-Buzz coding agents', async () => {
    const post = vi.fn().mockResolvedValue(response('opencode'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createOpenCode({ size: 'small' });

    expect(post.mock.calls[0][1].size).toBe('small');
  });

  it('rejects Buzz coding-agent sizes that cannot run the pro runtime', async () => {
    const deployments = new Deployments(
      { post: vi.fn() } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await expect(deployments.createOpenCode({
      size: 'small',
      buzz: {
        privateKeyNsec: 'nsec1test',
        relayUrl: 'wss://buzz.example.test',
      },
    })).rejects.toThrow(
      "Buzz coding agents require size='large' or 'medium'",
    );
  });

  it('allows a medium Buzz coding agent and forwards the requested size', async () => {
    const post = vi.fn().mockResolvedValue(response('opencode'));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.createOpenCode({
      size: 'medium',
      buzz: {
        privateKeyNsec: 'nsec1test',
        relayUrl: 'wss://buzz.example.test',
      },
    });

    expect(post.mock.calls[0][1].size).toBe('medium');
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

  it('hydrates the native Buzz runtime returned by get', async () => {
    const agentId = '11111111-1111-4111-8111-111111111111';
    const get = vi.fn().mockResolvedValue({ ...response('buzz-agent'), id: agentId });
    const deployments = new Deployments(
      { get } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await expect(deployments.get(agentId)).resolves.toBeInstanceOf(BuzzAgent);
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
      ['opencode', 'auth', 'logout', 'anthropic'],
      ['hyper-acp', 'plugin', 'models', '--agent-command', 'opencode', '--agent-args', 'acp', '--json'],
    ]);
  });

  it('runs login in an authenticated shell and captures the browser challenge', async () => {
    const agent = CodexAgent.fromDict(response('codex'));
    vi.spyOn(agent, 'exec')
      .mockResolvedValueOnce({ exitCode: 0, stdout: '{"methods":[]}', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'Logged in', stderr: '' });
    let finishPrompt: (() => void) | undefined;
    const socket = {
      onmessage: null as ((event: { data: string }) => void) | null,
      onclose: null as (() => void) | null,
      send: vi.fn((value: string) => {
        const marker = value.match(/(__HYPERCLI_AUTH_EXIT_[a-f0-9]+__=)/)?.[1];
        const splitUrl = CODEX_0146_DEVICE_AUTH_PROMPT.indexOf('codex/device') + 'cod'.length;
        const splitCode = CODEX_0146_DEVICE_AUTH_PROMPT.indexOf('ABCD-EFGHJ') + 'ABCD-'.length;
        const chunks = [
          '\x1b]0;codex login --device-auth',
          `\x07${CODEX_0146_DEVICE_AUTH_PROMPT.slice(0, splitUrl)}`,
          CODEX_0146_DEVICE_AUTH_PROMPT.slice(splitUrl, splitCode),
        ];
        for (const data of chunks) queueMicrotask(() => socket.onmessage?.({ data }));
        finishPrompt = () => socket.onmessage?.({
          data: `${CODEX_0146_DEVICE_AUTH_PROMPT.slice(splitCode)}${marker}0\n`,
        });
      }),
      close: vi.fn(),
      readyState: 1,
    };
    vi.spyOn(agent, 'shellConnect').mockResolvedValue(socket as unknown as WebSocket);

    let challengeReady = false;
    const loginPromise = agent.auth.login({ method: 'device', challengeTimeoutMs: 1000 })
      .then((login) => {
        challengeReady = true;
        return login;
      });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(challengeReady).toBe(false);
    expect(finishPrompt).toBeTypeOf('function');
    finishPrompt?.();
    const login = await loginPromise;

    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining("'codex' 'login' '--device-auth'"));
    expect(login.verificationUrl).toBe('https://auth.openai.com/codex/device');
    expect(login.userCode).toBe('ABCD-EFGHJ');
    expect(login.output).toContain('device code authorization');
    expect(login.output).not.toContain('\x1b');
    await expect(login.wait(1000)).resolves.toMatchObject({ authenticated: true });
  });

  it('cancels the shell when runtime authentication times out', async () => {
    vi.stubGlobal('WebSocket', undefined);
    const agent = CodexAgent.fromDict(response('codex'));
    vi.spyOn(agent, 'exec').mockResolvedValue({ exitCode: 0, stdout: '{"methods":[]}', stderr: '' });
    const socket = {
      onmessage: null as ((event: { data: string }) => void) | null,
      onclose: null as (() => void) | null,
      send: vi.fn((value: string) => {
        if (value.includes('codex') && value.includes('--device-auth')) {
          queueMicrotask(() => socket.onmessage?.({
            data: 'Open https://auth.example/device and enter device code ABCD-EFGH\n',
          }));
        }
      }),
      close: vi.fn(),
      readyState: 1,
    };
    vi.spyOn(agent, 'shellConnect').mockResolvedValue(socket as unknown as WebSocket);

    const login = await agent.auth.login({ method: 'device', challengeTimeoutMs: 1000 });

    await expect(login.wait(1)).rejects.toThrow('Runtime authentication timed out');
    expect(socket.send).toHaveBeenCalledWith('\x03');
    expect(socket.close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe('buzz hyper-acp raw outbound launch', () => {
  function provisionDeployments(runtime: 'buzz-agent' | 'opencode' | 'codex' | 'claude-code' | 'goose' | 'kimi-code' = 'buzz-agent') {
    const post = vi.fn().mockResolvedValue(response(runtime));
    const deployments = new Deployments(
      { post } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    return { post, deployments };
  }

  it('runs hyper-acp with raw outbound ws and the copied Buzz ACP plugin child', async () => {
    const { post, deployments } = provisionDeployments('buzz-agent');
    const agent = await deployments.createBuzzAgent({
      routes: { custom: { port: 9000, auth: true } },
      buzzEnabled: true,
    });
    const payload = post.mock.calls[0][1];
    expect(payload.command).toEqual(['/usr/local/bin/hyper-acp', 'plugin', 'buzz']);
    expect(payload.routes.custom).toEqual({ port: 9000, auth: true });
    expect(payload.routes).not.toHaveProperty('hyper-acp');
    expect(payload.env.HYPER_ACP_WS_URL).toBe('wss://api.test.hypercli.com/ws');
    expect(payload.env).not.toHaveProperty('HYPER_ACP_AGENT_COMMAND');
    expect(payload.env.BUZZ_ACP_RELAY_OBSERVER).toBe('false');
    expect(payload.env).not.toHaveProperty('HYPER_ACP_WS_LISTEN');
    expect(payload.env).not.toHaveProperty('HYPER_ACP_LOG');
    expect(payload.env).not.toHaveProperty('HYPER_ACP_WS_TOKEN');
    expect(payload.secrets ?? {}).not.toHaveProperty('HYPER_ACP_WS_TOKEN');
    expect(agent.hyperAcpWsToken).toBeNull();
  });

  it('strips caller-supplied observer env and child command overrides', async () => {
    const { post, deployments } = provisionDeployments('buzz-agent');
    await deployments.createBuzzAgent({
      buzzEnabled: true,
      env: {
        HYPER_ACP_WS_LISTEN: '127.0.0.1:1',
        HYPER_ACP_LOG: '/tmp/caller.db',
        HYPER_ACP_WS_TOKEN: 'leak',
        HYPER_ACP_WS_URL: 'ws://caller.invalid/ws',
        HYPER_ACP_AGENT_COMMAND: '/tmp/not-buzz-acp',
        BUZZ_ACP_RELAY_OBSERVER: 'true',
      },
    });
    const payload = post.mock.calls[0][1];
    expect(payload.env.HYPER_ACP_WS_URL).toBe('wss://api.test.hypercli.com/ws');
    expect(payload.env).not.toHaveProperty('HYPER_ACP_AGENT_COMMAND');
    expect(payload.env.BUZZ_ACP_RELAY_OBSERVER).toBe('false');
    expect(payload.env).not.toHaveProperty('HYPER_ACP_WS_LISTEN');
    expect(payload.env).not.toHaveProperty('HYPER_ACP_LOG');
    expect(payload.env).not.toHaveProperty('HYPER_ACP_WS_TOKEN');
  });

  it('deprecated buzzActivity flag does not reenable the observer route', async () => {
    const { post, deployments } = provisionDeployments('buzz-agent');
    const agent = await deployments.createBuzzAgent({ buzzEnabled: true, buzzActivity: true });
    const payload = post.mock.calls[0][1];
    expect(payload.routes ?? {}).not.toHaveProperty('hyper-acp');
    expect(payload.env.HYPER_ACP_WS_URL).toBe('wss://api.test.hypercli.com/ws');
    expect(payload.env ?? {}).not.toHaveProperty('HYPER_ACP_WS_LISTEN');
    expect(payload.env ?? {}).not.toHaveProperty('HYPER_ACP_LOG');
    expect(payload.secrets ?? {}).not.toHaveProperty('HYPER_ACP_WS_TOKEN');
    expect(agent.hyperAcpWsToken).toBeNull();
  });

  it('provisions nothing on a non-buzz image by default', async () => {
    const { post, deployments } = provisionDeployments('codex');
    const agent = await deployments.createCodex();
    const payload = post.mock.calls[0][1];
    expect(payload.routes ?? {}).not.toHaveProperty('hyper-acp');
    expect(payload.env ?? {}).not.toHaveProperty('HYPER_ACP_WS_LISTEN');
    expect(payload.env ?? {}).not.toHaveProperty('HYPER_ACP_LOG');
    expect(payload.secrets ?? {}).not.toHaveProperty('HYPER_ACP_WS_TOKEN');
    expect(agent.hyperAcpWsToken).toBeNull();
  });
});
