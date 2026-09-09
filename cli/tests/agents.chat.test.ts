/**
 * Tests for `hyper agents chat` (src/commands/agents.ts).
 *
 * Mock seam: CommandContext.client is an injectable lazy factory. Agent
 * records are PLAIN OBJECTS carrying vi.fn()s for the family connect methods
 * (acpConnect / connect / connectSession) — the command gates on the runtime
 * string, never instanceof, so no SDK classes are constructed. stdout/stderr
 * are captured via spies; nothing here touches the network or a TTY.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APIError, type Agent, type HyperCLI } from '@hypercli.com/sdk';
import * as agents from '../src/commands/agents.js';
import {
  authStorePath,
  installOpenClawAuthBridge,
  readAuthStore,
  writeAuthStore,
} from '../src/core/auth-store.js';
import { CliError, UsageError, exitCodeFor } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';

const ID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

// Sentinel: must never appear in full on stdout/stderr anywhere.
const OPENAI_KEY = 'sk-live-1234567890abcdef';

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutChunks: string[];
let stderrChunks: string[];

const stdout = () => stdoutChunks.join('');
const stderr = () => stderrChunks.join('');

beforeEach(() => {
  stdoutChunks = [];
  stderrChunks = [];
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof stdoutSpy;
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof stderrSpy;
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

// ---------- fixtures ----------

interface ChatSpies {
  acpConnect: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  connectSession: ReturnType<typeof vi.fn>;
}

/**
 * A plain-object agent record wired with all three family connect spies (all
 * throwing by default); each test overrides the one its family must take and
 * asserts the other two were never called.
 */
function chatAgentFixture(overrides: Record<string, unknown> = {}): Agent & ChatSpies {
  const spies: ChatSpies = {
    acpConnect: vi.fn(async () => {
      throw new Error('acpConnect not configured');
    }),
    connect: vi.fn(async () => {
      throw new Error('connect not configured');
    }),
    connectSession: vi.fn(async () => {
      throw new Error('connectSession not configured');
    }),
  };
  return {
    id: ID_A,
    userId: 'user-1',
    state: 'RUNNING',
    name: 'alpha',
    handle: null,
    displayName: 'alpha',
    avatarUrl: null,
    runtime: 'openclaw',
    hostname: 'alpha.hypercli.run',
    cpu: 2,
    memory: 4,
    requestedSize: 'small',
    tags: [],
    launchEpoch: 3,
    agentSlotId: 'slot-1',
    clusterId: 'cluster-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    startedAt: new Date('2026-01-02T00:00:00Z'),
    stoppedAt: null,
    archivedAt: null,
    meta: null,
    routes: {},
    launchConfig: null,
    publicUrl: 'https://alpha.hypercli.run',
    desktopUrl: null,
    shellUrl: null,
    ...spies,
    ...overrides,
  } as unknown as Agent & ChatSpies;
}

type MockDeployments = Record<string, ReturnType<typeof vi.fn>>;

function chatDeployments(roster: Agent[]): MockDeployments {
  const byId = (id: string): Agent => roster.find((a) => a.id === id) ?? roster[0];
  return {
    list: vi.fn(async () => roster),
    get: vi.fn(async (id: string) => byId(id)),
    waitRunning: vi.fn(async (id: string) => byId(id)),
    start: vi.fn(async (id: string) => byId(id)),
    startOpenClaw: vi.fn(async (id: string) => byId(id)),
    startHermesAgent: vi.fn(async (id: string) => byId(id)),
    storedLaunchConfig: vi.fn(async () => ({})),
    secret: vi.fn(async () => {
      throw new APIError(404, 'not found');
    }),
    setSecret: vi.fn(async () => ({})),
  };
}

function fakeClient(deployments: MockDeployments): HyperCLI {
  return { deployments } as unknown as HyperCLI;
}

function makeCtx(client: HyperCLI, format: 'table' | 'json'): CommandContext {
  return {
    client: vi.fn(async () => client),
    output: createOutput(format),
    format,
    dev: false,
  };
}

async function runErr(ctx: CommandContext, args: string[]): Promise<unknown> {
  return agents.run(ctx, args).then(
    () => null,
    (e: unknown) => e,
  );
}

// ---------- fake runtime chat surfaces (plain objects) ----------

type AcpNotification = { update: Record<string, unknown> };
type AcpOptions = { onUpdate?: (notification: AcpNotification) => void };

function acpChunk(text: string): AcpNotification {
  return {
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  };
}

/** ACP client fake: prompt() drives the captured onUpdate with `chunks`. */
function fakeAcpClient(chunks: string[], sessionId = 'sess-acp-1') {
  let onUpdate: ((notification: AcpNotification) => void) | undefined;
  const client = {
    newSession: vi.fn(async () => ({ sessionId })),
    loadSession: vi.fn(async () => ({})),
    prompt: vi.fn(async () => {
      for (const chunk of chunks) onUpdate?.(acpChunk(chunk));
      return { stopReason: 'end_turn' };
    }),
    close: vi.fn(),
  };
  const acpConnect = vi.fn(async (options: AcpOptions) => {
    onUpdate = options.onUpdate;
    return client;
  });
  return { acpConnect, client };
}

type ChatEvent = { type: string; text?: string; replace?: boolean };

/** Canonical session fake (hermes/openclaw): chatSend yields `events`. */
function fakeSessionClient(
  events: ChatEvent[],
  options: { existing?: Array<{ key: string; label?: string | null }>; createdKey?: string } = {},
) {
  const createdKey = options.createdKey ?? 'sess-created-1';
  return {
    sessionsList: vi.fn(async () => options.existing ?? []),
    sessionsCreate: vi.fn(async (params: { key?: string } = {}) => ({ key: params.key ?? createdKey })),
    chatSend: vi.fn(async function* () {
      for (const event of events) yield event;
    }),
    close: vi.fn(),
  };
}

const REPLY_EVENTS: ChatEvent[] = [
  { type: 'content', text: 'Hello' },
  { type: 'content', text: ' world' },
  { type: 'done' },
];

// ---------- per-family dispatch ----------

describe('hyper agents chat — family dispatch', () => {
  it('openclaw: gateway connectSession path taken, never acpConnect/connect', async () => {
    const session = fakeSessionClient(REPLY_EVENTS);
    const agent = chatAgentFixture({
      runtime: 'openclaw',
      connectSession: vi.fn(async () => session),
    });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'say', 'hi']);

    expect(agent.connectSession).toHaveBeenCalledTimes(1);
    expect(agent.acpConnect).not.toHaveBeenCalled();
    expect(agent.connect).not.toHaveBeenCalled();
    // No session flag: a brand-new session every invocation, even on openclaw.
    expect(session.sessionsCreate).toHaveBeenCalledWith({});
    expect(session.chatSend).toHaveBeenCalledWith('say hi', 'sess-created-1');
    expect(session.close).toHaveBeenCalled();
    expect(stdout()).toBe('Hello world\n');
    expect(stderr()).toContain('session opened sess-created-1');
  });

  it('opencode: ACP path taken, never connectSession/connect', async () => {
    const { acpConnect, client } = fakeAcpClient(['Hello', ' world']);
    const agent = chatAgentFixture({ runtime: 'opencode', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'say', 'hi']);

    expect(acpConnect).toHaveBeenCalledTimes(1);
    expect(agent.connectSession).not.toHaveBeenCalled();
    expect(agent.connect).not.toHaveBeenCalled();
    expect(client.newSession).toHaveBeenCalledTimes(1);
    expect(client.prompt).toHaveBeenCalledWith('sess-acp-1', 'say hi');
    expect(client.close).toHaveBeenCalled();
    expect(stdout()).toBe('Hello world\n');
  });

  it('hermes-agent: HermesAgent.connect path, fresh session by default', async () => {
    const session = fakeSessionClient(REPLY_EVENTS);
    const connect = vi.fn(async () => session);
    const agent = chatAgentFixture({ runtime: 'hermes-agent', connect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'ping']);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(agent.connectSession).not.toHaveBeenCalled();
    expect(agent.acpConnect).not.toHaveBeenCalled();
    expect(session.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(session.chatSend).toHaveBeenCalledWith('ping', 'sess-created-1');
    expect(stdout()).toBe('Hello world\n');
  });

  it('buzz-agent: rides the ACP path like every coding agent', async () => {
    const { acpConnect, client } = fakeAcpClient(['buzz reply']);
    const agent = chatAgentFixture({ runtime: 'buzz-agent', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'ping']);

    expect(acpConnect).toHaveBeenCalledTimes(1);
    expect(agent.connectSession).not.toHaveBeenCalled();
    expect(client.prompt).toHaveBeenCalledWith('sess-acp-1', 'ping');
    expect(stdout()).toBe('buzz reply\n');
  });

  it('openclaw: pairing auto-approve surfaces info lines on stderr', async () => {
    const session = fakeSessionClient(REPLY_EVENTS);
    const connectSession = vi.fn(async (options: {
      onPairing?: (pairing: { requestId: string; status: string } | null) => void;
    }) => {
      options.onPairing?.({ requestId: 'req-9', status: 'pending' });
      options.onPairing?.({ requestId: 'req-9', status: 'approved' });
      return session;
    });
    const agent = chatAgentFixture({ runtime: 'openclaw', connectSession });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi']);

    expect(stderr()).toContain('auto-approving');
    expect(stderr()).toContain('paired device');
    // autoApprovePairing is passed through (SDK defaults it on regardless).
    expect(connectSession).toHaveBeenCalledWith(
      expect.objectContaining({ autoApprovePairing: true }),
    );
    expect(stdout()).toBe('Hello world\n');
  });
});

// ---------- sessions ----------

describe('hyper agents chat — sessions', () => {
  it('ACP --session resumes via loadSession instead of newSession', async () => {
    const { acpConnect, client } = fakeAcpClient(['resumed']);
    const agent = chatAgentFixture({ runtime: 'opencode', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi', '--session', 'sess-old-9']);

    expect(client.loadSession).toHaveBeenCalledWith('sess-old-9');
    expect(client.newSession).not.toHaveBeenCalled();
    expect(client.prompt).toHaveBeenCalledWith('sess-old-9', 'hi');
    expect(stdout()).toBe('resumed\n');
  });

  it('hermes --session reuses an existing session by label', async () => {
    const session = fakeSessionClient(REPLY_EVENTS, {
      existing: [{ key: 'sess-42', label: 'demo' }],
    });
    const connect = vi.fn(async () => session);
    const agent = chatAgentFixture({ runtime: 'hermes-agent', connect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi', '--session', 'demo']);

    expect(session.sessionsCreate).not.toHaveBeenCalled();
    expect(session.chatSend).toHaveBeenCalledWith('hi', 'sess-42');
  });

  it('hermes --session creates the named session when it is absent', async () => {
    const session = fakeSessionClient(REPLY_EVENTS);
    const connect = vi.fn(async () => session);
    const agent = chatAgentFixture({ runtime: 'hermes-agent', connect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi', '--session', 'demo']);

    expect(session.sessionsCreate).toHaveBeenCalledWith({ key: 'demo' });
    expect(session.chatSend).toHaveBeenCalledWith('hi', 'demo');
  });

  it('openclaw -s NAME reuses-or-creates a named session', async () => {
    const session = fakeSessionClient(REPLY_EVENTS);
    const agent = chatAgentFixture({
      runtime: 'openclaw',
      connectSession: vi.fn(async () => session),
    });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi', '-s', 'standup']);

    expect(session.sessionsCreate).toHaveBeenCalledWith({ key: 'standup' });
    expect(session.chatSend).toHaveBeenCalledWith('hi', 'standup');
  });

  it('openclaw -s NAME reuses an existing session without creating', async () => {
    const session = fakeSessionClient(REPLY_EVENTS, {
      existing: [{ key: 'k-existing', label: 'standup' }],
    });
    const agent = chatAgentFixture({
      runtime: 'openclaw',
      connectSession: vi.fn(async () => session),
    });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi', '--session', 'standup']);

    expect(session.sessionsCreate).not.toHaveBeenCalled();
    expect(session.chatSend).toHaveBeenCalledWith('hi', 'k-existing');
  });

  it('--new no longer parses: usage error, exit 2', async () => {
    const agent = chatAgentFixture({ runtime: 'opencode' });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    const err = await runErr(ctx, ['chat', ID_A, 'hi', '--new']);

    expect(err).toBeInstanceOf(UsageError);
    expect(exitCodeFor(err)).toBe(2);
  });

  it('-s is the short flag for --session (named session reuse)', async () => {
    const { acpConnect, client } = fakeAcpClient(['resumed']);
    const agent = chatAgentFixture({ runtime: 'opencode', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi', '-s', 'sess-old-9']);

    expect(client.loadSession).toHaveBeenCalledWith('sess-old-9');
    expect(client.newSession).not.toHaveBeenCalled();
    expect(stdout()).toBe('resumed\n');
  });

  it('missing prompt is a usage error (exit 2)', async () => {
    const agent = chatAgentFixture({ runtime: 'opencode' });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    const err = await runErr(ctx, ['chat', ID_A]);

    expect(err).toBeInstanceOf(UsageError);
    expect(exitCodeFor(err)).toBe(2);
  });
});

// ---------- reply extraction + output ----------

describe('hyper agents chat — reply extraction', () => {
  it('--json emits exactly {reply, session_id, runtime, agent_id}', async () => {
    const { acpConnect } = fakeAcpClient(['Hello', ' world']);
    const agent = chatAgentFixture({ runtime: 'opencode', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'json');

    await agents.run(ctx, ['chat', ID_A, 'hi', '--json']);

    const payload = JSON.parse(stdout());
    expect(Object.keys(payload).sort()).toEqual(['agent_id', 'reply', 'runtime', 'session_id']);
    expect(payload).toEqual({
      reply: 'Hello world',
      session_id: 'sess-acp-1',
      runtime: 'opencode',
      agent_id: ID_A,
    });
  });

  it('hermes replace events fold to the final text, not concatenated deltas', async () => {
    const session = fakeSessionClient([
      { type: 'content', text: 'Hel' },
      { type: 'content', text: 'lo' },
      { type: 'content', text: 'Hello', replace: true },
      { type: 'done' },
    ]);
    const connect = vi.fn(async () => session);
    const agent = chatAgentFixture({ runtime: 'hermes-agent', connect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'json');

    await agents.run(ctx, ['chat', ID_A, 'hi', '--json']);

    expect(JSON.parse(stdout()).reply).toBe('Hello');
  });

  it('--stream prints deltas live and does not duplicate the final reply', async () => {
    const { acpConnect } = fakeAcpClient(['Hello', ' world']);
    const agent = chatAgentFixture({ runtime: 'opencode', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi', '--stream']);

    expect(stdout()).toBe('Hello world\n');
  });

  it('--json --stream keeps stdout a single JSON value (deltas ride stderr)', async () => {
    const { acpConnect } = fakeAcpClient(['Hello']);
    const agent = chatAgentFixture({ runtime: 'opencode', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'json');

    await agents.run(ctx, ['chat', ID_A, 'hi', '--json', '--stream']);

    const payload = JSON.parse(stdout());
    expect(payload.reply).toBe('Hello');
    expect(stderr()).toContain('Hello');
  });

  it('a runtime error event is a prompt-stage CliError', async () => {
    const session = fakeSessionClient([{ type: 'error', text: 'model exploded' }]);
    const agent = chatAgentFixture({
      runtime: 'openclaw',
      connectSession: vi.fn(async () => session),
    });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    const err = await runErr(ctx, ['chat', ID_A, 'hi']);

    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toBe('chat: prompt stage failed: model exploded');
    expect(exitCodeFor(err)).toBe(1);
  });

  it('no assistant reply (turn ended silently) is a prompt-stage CliError', async () => {
    const { acpConnect } = fakeAcpClient([]);
    const agent = chatAgentFixture({ runtime: 'opencode', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    const err = await runErr(ctx, ['chat', ID_A, 'hi']);

    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toContain('chat: prompt stage failed:');
    expect((err as Error).message).toContain('without an assistant reply');
  });
});

// ---------- lifecycle: start + wait before connect ----------

describe('hyper agents chat — lifecycle', () => {
  it('non-RUNNING openclaw agent: secret dance start, wait, then connect', async () => {
    const session = fakeSessionClient(REPLY_EVENTS);
    const connectSession = vi.fn(async () => session);
    const agent = chatAgentFixture({ runtime: 'openclaw', state: 'STOPPED', connectSession });
    const d = chatDeployments([agent]);
    const ctx = makeCtx(fakeClient(d), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi']);

    // Same openclaw start dispatch as `agents start`.
    expect(d.secret).toHaveBeenCalledWith(ID_A, 'OPENCLAW_GATEWAY_TOKEN');
    expect(d.setSecret).toHaveBeenCalledTimes(1);
    expect(d.storedLaunchConfig).toHaveBeenCalledWith(ID_A);
    expect(d.startOpenClaw).toHaveBeenCalledTimes(1);
    expect(d.waitRunning).toHaveBeenCalledWith(ID_A, expect.any(Number), 5_000);
    expect(connectSession).toHaveBeenCalledTimes(1);
    expect(d.startOpenClaw.mock.invocationCallOrder[0]).toBeLessThan(
      d.waitRunning.mock.invocationCallOrder[0],
    );
    expect(d.waitRunning.mock.invocationCallOrder[0]).toBeLessThan(
      connectSession.mock.invocationCallOrder[0],
    );
    expect(stderr()).toContain('started agent');
    expect(stdout()).toBe('Hello world\n');
    // The generated gateway token never reaches stdout/stderr in full.
    const token = d.startOpenClaw.mock.calls[0][1].gatewayToken as string;
    expect(token).toHaveLength(64);
    expect(stdout()).not.toContain(token);
    expect(stderr()).not.toContain(token);
  });

  it('non-RUNNING hermes agent: startHermesAgent dispatch, no openclaw secret dance', async () => {
    const session = fakeSessionClient(REPLY_EVENTS);
    const connect = vi.fn(async () => session);
    const agent = chatAgentFixture({ runtime: 'hermes-agent', state: 'STOPPED', connect });
    const d = chatDeployments([agent]);
    const ctx = makeCtx(fakeClient(d), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi']);

    expect(d.startHermesAgent).toHaveBeenCalledTimes(1);
    expect(d.setSecret).not.toHaveBeenCalled();
    expect(d.startOpenClaw).not.toHaveBeenCalled();
    expect(d.waitRunning).toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('overall timeout aborts with a stage-named CliError', async () => {
    const agent = chatAgentFixture({
      runtime: 'openclaw',
      connectSession: vi.fn(() => new Promise(() => {})),
    });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    const err = await runErr(ctx, ['chat', ID_A, 'hi', '--timeout', '0.05']);

    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toMatch(/^chat: connect stage failed: timed out after 0\.05s$/);
    expect(exitCodeFor(err)).toBe(1);
  });

  it('unsupported runtime names the runtime in a CliError', async () => {
    const agent = chatAgentFixture({ runtime: 'weird' });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    const err = await runErr(ctx, ['chat', ID_A, 'hi']);

    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toContain("chat is not supported on runtime 'weird'");
  });
});

// ---------- redaction fix on config get ----------
describe('hyper agents config get redaction', () => {
  const configWithKey = () => ({ env: { OPENAI_API_KEY: OPENAI_KEY, plain: 'value' } });

  it('json output masks secret-shaped values', async () => {
    const configGet = vi.fn(async () => configWithKey());
    const agent = chatAgentFixture({ runtime: 'openclaw', configGet });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'json');

    await agents.run(ctx, ['config', 'get', ID_A, '--json']);

    const payload = JSON.parse(stdout());
    expect(payload.env.OPENAI_API_KEY).toBe('...cdef');
    expect(payload.env.plain).toBe('value');
    expect(stdout()).not.toContain(OPENAI_KEY);
  });

  it('table output masks secret-shaped values', async () => {
    const configGet = vi.fn(async () => configWithKey());
    const agent = chatAgentFixture({ runtime: 'openclaw', configGet });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['config', 'get', ID_A]);

    expect(stdout()).toContain('...cdef');
    expect(stdout()).toContain('value');
    expect(stdout()).not.toContain(OPENAI_KEY);
  });
});

// ---------- openclaw pairing auth store (~/.hypercli/auth.json) ----------

describe('openclaw auth store', () => {
  const ACCOUNT_KEY = 'hc_live_ACCOUNT_KEY_NEVER_STORED';
  let tmpHome = '';
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'hypercli-auth-'));
    savedEnv = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      HOMEDRIVE: process.env.HOMEDRIVE,
      HOMEPATH: process.env.HOMEPATH,
    };
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    delete process.env.HOMEDRIVE;
    delete process.env.HOMEPATH;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('writes and reads back per-agent pairing fields under the redirected HOME', () => {
    expect(authStorePath()).toBe(join(tmpHome, '.hypercli', 'auth.json'));

    writeAuthStore({
      version: 1,
      device: { deviceId: 'd1', publicKey: 'pk', privateKey: 'sk', createdAtMs: 7 },
      agents: {
        [ID_A]: {
          deviceToken: 'dtok-1',
          role: 'operator',
          scopes: ['operator.admin'],
          gatewayUrl: 'wss://a.hypercli.run',
          updatedAtMs: 9,
        },
      },
    });

    const roundTripped = readAuthStore();
    expect(roundTripped.device).toEqual({
      deviceId: 'd1',
      publicKey: 'pk',
      privateKey: 'sk',
      createdAtMs: 7,
    });
    expect(roundTripped.agents?.[ID_A]?.deviceToken).toBe('dtok-1');
    expect(roundTripped.agents?.[ID_A]?.role).toBe('operator');
  });

  it('attempts 0600 perms on POSIX; file always exists', () => {
    writeAuthStore({ version: 1, device: { deviceId: 'd1', publicKey: 'pk', privateKey: 'sk' } });
    const mode = statSync(authStorePath()).mode;
    if (process.platform !== 'win32') {
      expect(mode & 0o777).toBe(0o600);
    }
  });

  it('never carries account API-key material', () => {
    writeAuthStore({
      version: 1,
      device: { deviceId: 'd1', publicKey: 'pk', privateKey: 'sk' },
      agents: { [ID_A]: { deviceToken: 'dtok-1' } },
    });

    const raw = readFileSync(authStorePath(), 'utf8');
    expect(raw).not.toContain(ACCOUNT_KEY);
    expect(raw).not.toMatch(/hc_live_[A-Za-z0-9_]{10,}/);
    // And the field the SDK actually stores stays.
    expect(raw).toContain('dtok-1');
  });

  it('bridge: an SDK-shaped write lands in auth.json and reads back SDK-shaped', () => {
    installOpenClawAuthBridge(authStorePath());
    const storage = (globalThis as { localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage;

    // What the gateway module writes after a connect hello (gateway.ts:4136-4145).
    storage.setItem(
      'openclaw.device.auth.v1',
      JSON.stringify({
        version: 1,
        deviceId: 'd1',
        publicKey: 'pk',
        privateKey: 'sk',
        createdAtMs: 7,
        tokens: {
          [`${ID_A}|operator`]: {
            token: 'dtok-1',
            role: 'operator',
            scopes: ['operator.read'],
            updatedAtMs: 9,
            gatewayUrl: 'wss://a.hypercli.run',
          },
        },
      }),
    );

    const file = readAuthStore();
    expect(file.device?.deviceId).toBe('d1');
    expect(file.agents?.[ID_A]?.deviceToken).toBe('dtok-1');

    // And on the next process lifetime the SDK reads the same shape back
    // (loadStoredDeviceToken keys tokens by `<deploymentId>|<role>`).
    const raw = storage.getItem('openclaw.device.auth.v1');
    const sdkView = JSON.parse(raw as string);
    expect(sdkView.deviceId).toBe('d1');
    expect(sdkView.privateKey).toBe('sk');
    expect(sdkView.tokens[`${ID_A}|operator`].token).toBe('dtok-1');
  });
});
