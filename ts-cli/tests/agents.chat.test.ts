/**
 * Tests for `hyper agents chat` (src/commands/agents.ts).
 *
 * Mock seam: CommandContext.client is an injectable lazy factory. Agent
 * records are PLAIN OBJECTS carrying a vi.fn() acpConnect — every chat
 * surface is ACP over the backend bridge, so no other connect surface
 * exists. The command gates on the runtime string, never instanceof, so no
 * SDK classes are constructed. stdout/stderr are captured via spies;
 * nothing here touches the network or a TTY.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError, type Agent, type HyperCLI } from '@hypercli.com/sdk';
import * as agents from '../src/commands/agents.js';
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

/**
 * A plain-object agent record; the only chat surface is acpConnect (throws
 * by default — each test supplies its own).
 */
function chatAgentFixture(overrides: Record<string, unknown> = {}): Agent & { acpConnect: ReturnType<typeof vi.fn> } {
  return {
    id: ID_A,
    userId: 'user-1',
    state: 'RUNNING',
    name: 'alpha',
    handle: null,
    displayName: 'alpha',
    avatarUrl: null,
    runtime: 'openclaw_acp',
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
    acpConnect: vi.fn(async () => {
      throw new Error('acpConnect not configured');
    }),
    ...overrides,
  } as unknown as Agent & { acpConnect: ReturnType<typeof vi.fn> };
}

type MockDeployments = Record<string, ReturnType<typeof vi.fn>>;

function chatDeployments(roster: Agent[]): MockDeployments {
  const byId = (id: string): Agent => roster.find((a) => a.id === id) ?? roster[0];
  return {
    list: vi.fn(async () => roster),
    get: vi.fn(async (id: string) => byId(id)),
    waitRunning: vi.fn(async (id: string) => byId(id)),
    start: vi.fn(async (id: string) => byId(id)),
    storedLaunchConfig: vi.fn(async () => ({})),
    // Start performs no secrets ceremony; these spies must never fire in chat.
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

// ---------- fake ACP chat surface (plain object) ----------

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
    resumeSession: vi.fn(async () => ({})),
    waitForIdle: vi.fn(async () => {}),
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

// ---------- family dispatch: every runtime rides ACP ----------

describe('hyper agents chat — family dispatch', () => {
  it.each(['openclaw', 'openclaw-pro', 'hermes-agent', 'openclaw_acp', 'hermes_acp', 'opencode', 'buzz-agent'])(
    '%s: ACP connect/newSession/prompt, fresh session by default',
    async (runtime) => {
      const { acpConnect, client } = fakeAcpClient(['Hello', ' world']);
      const agent = chatAgentFixture({ runtime, acpConnect });
      const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

      await agents.run(ctx, ['chat', ID_A, 'say', 'hi']);

      expect(acpConnect).toHaveBeenCalledTimes(1);
      // No session flag: a brand-new session every invocation.
      expect(client.newSession).toHaveBeenCalledTimes(1);
      expect(client.resumeSession).not.toHaveBeenCalled();
      expect(client.waitForIdle).not.toHaveBeenCalled();
      expect(client.prompt).toHaveBeenCalledWith('sess-acp-1', 'say hi');
      expect(client.close).toHaveBeenCalled();
      expect(stdout()).toBe('Hello world\n');
      expect(stderr()).toContain('session opened sess-acp-1');
    },
  );
});

// ---------- sessions ----------

describe('hyper agents chat — sessions', () => {
  it('--session resumes via resumeSession instead of newSession', async () => {
    const { acpConnect, client } = fakeAcpClient(['resumed']);
    const agent = chatAgentFixture({ runtime: 'opencode', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi', '--session', 'sess-old-9']);

    expect(client.resumeSession).toHaveBeenCalledWith('sess-old-9', { replayFrom: { type: 'start' } });
    expect(client.newSession).not.toHaveBeenCalled();
    // The resumed session's foreground epoch settles before the new prompt:
    // resume → waitForIdle → prompt, in that order.
    expect(client.waitForIdle).toHaveBeenCalledWith('sess-old-9');
    expect(client.prompt).toHaveBeenCalledWith('sess-old-9', 'hi');
    const order = (fn: ReturnType<typeof vi.fn>) => fn.mock.invocationCallOrder[0];
    expect(order(client.resumeSession)).toBeLessThan(order(client.waitForIdle));
    expect(order(client.waitForIdle)).toBeLessThan(order(client.prompt));
    expect(stdout()).toBe('resumed\n');
  });

  it('--session with a live resumed turn: prompt waits the old epoch out instead of hitting the foreground gate', async () => {
    const { acpConnect, client } = fakeAcpClient(['waited']);
    // The in-flight turn at disconnect finishes while we wait: waitForIdle
    // observes the live foreground and resolves once it goes idle.
    let release!: () => void;
    client.waitForIdle.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const agent = chatAgentFixture({ runtime: 'opencode', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    const running = agents.run(ctx, ['chat', ID_A, 'ping', '--session', 'sess-old-9']);

    await vi.waitFor(() => expect(client.resumeSession).toHaveBeenCalledWith('sess-old-9', { replayFrom: { type: 'start' } }));
    expect(client.prompt).not.toHaveBeenCalled();
    release();
    await running;

    expect(client.prompt).toHaveBeenCalledWith('sess-old-9', 'ping');
    expect(stdout()).toBe('waited\n');
  });

  it('--session works identically on openclaw, but via the shared ACP surface', async () => {
    const { acpConnect, client } = fakeAcpClient(['resumed']);
    const agent = chatAgentFixture({ runtime: 'openclaw_acp', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'json');

    await agents.run(ctx, ['chat', ID_A, 'hi', '--session', 'sess-old-9', '--json']);

    expect(client.resumeSession).toHaveBeenCalledWith('sess-old-9', { replayFrom: { type: 'start' } });
    const payload = JSON.parse(stdout());
    expect(payload.session).toEqual({ id: 'sess-old-9', resumed: true });
  });

  it('-s is the short flag for --session', async () => {
    const { acpConnect, client } = fakeAcpClient(['resumed']);
    const agent = chatAgentFixture({ runtime: 'opencode', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi', '-s', 'sess-old-9']);

    expect(client.resumeSession).toHaveBeenCalledWith('sess-old-9', { replayFrom: { type: 'start' } });
    expect(client.newSession).not.toHaveBeenCalled();
    expect(stdout()).toBe('resumed\n');
  });

  it('--new no longer parses: usage error, exit 2', async () => {
    const agent = chatAgentFixture({ runtime: 'opencode' });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    const err = await runErr(ctx, ['chat', ID_A, 'hi', '--new']);

    expect(err).toBeInstanceOf(UsageError);
    expect(exitCodeFor(err)).toBe(2);
  });

  it('--json: fresh session reports session {id, resumed:false}', async () => {
    const { acpConnect } = fakeAcpClient(['hi']);
    const agent = chatAgentFixture({ runtime: 'opencode', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'json');

    await agents.run(ctx, ['chat', ID_A, 'hi', '--json']);

    const payload = JSON.parse(stdout());
    expect(payload.session).toEqual({ id: 'sess-acp-1', resumed: false });
    expect(payload.session.id).toBe(payload.session_id);
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
  it('--json emits exactly {reply, session_id, session, runtime, agent_id}', async () => {
    const { acpConnect } = fakeAcpClient(['Hello', ' world']);
    const agent = chatAgentFixture({ runtime: 'opencode', acpConnect });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'json');

    await agents.run(ctx, ['chat', ID_A, 'hi', '--json']);

    const payload = JSON.parse(stdout());
    expect(Object.keys(payload).sort()).toEqual(['agent_id', 'reply', 'runtime', 'session', 'session_id']);
    expect(payload).toEqual({
      reply: 'Hello world',
      session_id: 'sess-acp-1',
      session: { id: 'sess-acp-1', resumed: false },
      runtime: 'opencode',
      agent_id: ID_A,
    });
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

  it('a prompt failure is a prompt-stage CliError', async () => {
    const { acpConnect } = fakeAcpClient(['Hello']);
    const agent = chatAgentFixture({
      runtime: 'openclaw_acp',
      acpConnect: vi.fn(async (options: AcpOptions) => ({
        newSession: vi.fn(async () => ({ sessionId: 's1' })),
        resumeSession: vi.fn(async () => ({})),
        prompt: vi.fn(async () => Promise.reject(new Error('model exploded'))),
        close: vi.fn(),
        onUpdate: options.onUpdate,
      })),
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
  it('non-RUNNING openclaw agent: start, wait, then connect — no secret ceremony', async () => {
    const { acpConnect } = fakeAcpClient(['Hello', ' world']);
    const agent = chatAgentFixture({ runtime: 'openclaw_acp', state: 'STOPPED', acpConnect });
    const d = chatDeployments([agent]);
    const ctx = makeCtx(fakeClient(d), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi']);

    // Same openclaw start dispatch as `agents start`; no gateway-token dance.
    expect(d.secret).not.toHaveBeenCalled();
    expect(d.setSecret).not.toHaveBeenCalled();
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.storedLaunchConfig).not.toHaveBeenCalled();
    expect(d.start).toHaveBeenCalledWith(ID_A);
    expect(d.waitRunning).toHaveBeenCalledWith(ID_A, expect.any(Number), 5_000);
    expect(acpConnect).toHaveBeenCalledTimes(1);
    expect(d.start.mock.invocationCallOrder[0]).toBeLessThan(
      d.waitRunning.mock.invocationCallOrder[0],
    );
    expect(d.waitRunning.mock.invocationCallOrder[0]).toBeLessThan(
      acpConnect.mock.invocationCallOrder[0],
    );
    expect(stderr()).toContain('started agent');
    expect(stdout()).toBe('Hello world\n');
  });

  it('non-RUNNING hermes agent: same start dispatch, no secret ceremony', async () => {
    const { acpConnect } = fakeAcpClient(['hi']);
    const agent = chatAgentFixture({ runtime: 'hermes_acp', state: 'STOPPED', acpConnect });
    const d = chatDeployments([agent]);
    const ctx = makeCtx(fakeClient(d), 'table');

    await agents.run(ctx, ['chat', ID_A, 'hi']);

    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.secret).not.toHaveBeenCalled();
    expect(d.setSecret).not.toHaveBeenCalled();
    expect(d.waitRunning).toHaveBeenCalled();
    expect(acpConnect).toHaveBeenCalledTimes(1);
  });

  it('overall timeout aborts with a stage-named CliError', async () => {
    const agent = chatAgentFixture({
      runtime: 'openclaw_acp',
      acpConnect: vi.fn(() => new Promise(() => {})),
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

// ---------- redaction on config (launch_config) get ----------
describe('hyper agents config redaction', () => {
  const configWithKey = () => ({ env: { OPENAI_API_KEY: OPENAI_KEY, plain: 'value' } });

  it('json output masks secret-shaped values', async () => {
    const agent = chatAgentFixture({ launchConfig: configWithKey() });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'json');

    await agents.run(ctx, ['config', 'get', ID_A, '--json']);

    const payload = JSON.parse(stdout());
    expect(payload.env.OPENAI_API_KEY).toBe('...cdef');
    expect(payload.env.plain).toBe('value');
    expect(stdout()).not.toContain(OPENAI_KEY);
  });

  it('table output masks secret-shaped values', async () => {
    const agent = chatAgentFixture({ launchConfig: configWithKey() });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'table');

    await agents.run(ctx, ['config', 'get', ID_A]);

    expect(stdout()).toContain('...cdef');
    expect(stdout()).toContain('value');
    expect(stdout()).not.toContain(OPENAI_KEY);
  });

  it('strips secrets and registry_auth entirely', async () => {
    const agent = chatAgentFixture({
      launchConfig: { image: 'img', secrets: { token: OPENAI_KEY }, registry_auth: { password: OPENAI_KEY } },
    });
    const ctx = makeCtx(fakeClient(chatDeployments([agent])), 'json');

    await agents.run(ctx, ['config', ID_A, '--json']);

    const payload = JSON.parse(stdout());
    expect(payload).toEqual({ image: 'img' });
    expect(stdout()).not.toContain(OPENAI_KEY);
  });
});
