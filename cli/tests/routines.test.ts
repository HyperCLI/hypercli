/**
 * Tests for `hyper routines` (src/commands/routines.ts).
 *
 * Same mock seam as tests/agents.test.ts: CommandContext.client is an
 * injectable lazy factory; tests pass a fake HyperCLI whose .routines and
 * .deployments are vi.fn records, so nothing here touches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, HyperCLI, Routine } from '@hypercli.com/sdk';
import * as routines from '../src/commands/routines.js';
import { CliError, UsageError } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';

const ID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

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

function routineFixture(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 'routine-1',
    userId: 'user-1',
    agentId: ID_A,
    cron: '0 9 * * 1-5',
    prompt: 'write the standup notes',
    enabled: true,
    name: 'standup',
    runAt: null,
    sessionId: null,
    nextRunAt: '2026-09-14T09:00:00Z',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function agentFixture(overrides: Record<string, unknown> = {}): Agent {
  return {
    id: ID_A,
    state: 'RUNNING',
    name: 'alpha',
    runtime: 'opencode',
    ...overrides,
  } as unknown as Agent;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFns = Record<string, ReturnType<typeof vi.fn>>;

function fakeAcp(overrides: MockFns = {}): MockFns {
  return {
    newSession: vi.fn(async () => ({ sessionId: 'sess-new' })),
    loadSession: vi.fn(async () => ({})),
    prompt: vi.fn(async () => ({ stopReason: 'end_turn' })),
    close: vi.fn(),
    ...overrides,
  };
}

interface FakeClientParts {
  routines?: MockFns;
  deployments?: MockFns;
}

function fakeClient(parts: FakeClientParts = {}): HyperCLI {
  return {
    routines: parts.routines ?? {
      list: vi.fn(async () => []),
      get: vi.fn(async () => routineFixture()),
      create: vi.fn(async () => routineFixture()),
      update: vi.fn(async () => routineFixture()),
      delete: vi.fn(async () => {}),
    },
    deployments: parts.deployments ?? {
      list: vi.fn(async () => [agentFixture()]),
      get: vi.fn(async () => agentFixture()),
    },
  } as unknown as HyperCLI;
}

function makeCtx(
  client: HyperCLI,
  format: 'table' | 'json' = 'table',
): { ctx: CommandContext; clientFactory: ReturnType<typeof vi.fn> } {
  const clientFactory = vi.fn(async () => client);
  return {
    ctx: { client: clientFactory, output: createOutput(format), format, dev: false },
    clientFactory,
  };
}

async function runErr(ctx: CommandContext, args: string[]): Promise<unknown> {
  return routines.run(ctx, args).then(
    () => null,
    (e: unknown) => e,
  );
}

// ---------- list ----------

describe('hyper routines list', () => {
  it('prints name, truncated prompt, humanized schedule, next run, enabled, session, id', async () => {
    const list = vi.fn(async () => [
      routineFixture(),
      routineFixture({
        id: 'routine-2',
        name: null,
        cron: null,
        runAt: '2026-06-15T12:00:00Z',
        enabled: false,
        sessionId: 'session-aaaaaaaaaaaaaaaa-bbbb',
        nextRunAt: null,
        prompt: 'x'.repeat(80),
      }),
    ]);
    const { ctx } = makeCtx(fakeClient({ routines: { list } }), 'table');

    await routines.run(ctx, ['list']);

    const out = stdout();
    expect(out).toContain('NAME');
    expect(out).toContain('PROMPT');
    expect(out).toContain('SCHEDULE');
    expect(out).toContain('NEXT RUN');
    expect(out).toContain('ENABLED');
    expect(out).toContain('SESSION');
    expect(out).toContain('standup');
    expect(out).toContain('write the standup notes');
    expect(out).toContain('Weekdays at 9:00 AM');
    expect(out).toContain('2026-09-14T09:00:00Z');
    expect(out).toContain('Once on ');
    expect(out).toContain('session-aaa');
    expect(out).not.toContain('session-aaaaaaaaaaaaaaaa-bbbb');
    expect(out).toContain('…');
    expect(stderr()).toContain('total 2');
  });

  it('passes --agent through as an agentId filter', async () => {
    const list = vi.fn(async () => []);
    const { ctx } = makeCtx(fakeClient({ routines: { list } }), 'table');

    await routines.run(ctx, ['list', '--agent', 'abcd']);

    expect(list).toHaveBeenCalledWith({ agentId: 'abcd' });
    expect(stdout()).toContain('No routines found.');
  });

  it('--json prints the full record bag as a single JSON value', async () => {
    const list = vi.fn(async () => [routineFixture()]);
    const { ctx } = makeCtx(fakeClient({ routines: { list } }), 'json');

    await routines.run(ctx, ['list', '--json']);

    const parsed = JSON.parse(stdout().trim()) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: 'routine-1',
      name: 'standup',
      agent_id: ID_A,
      cron: '0 9 * * 1-5',
      prompt: 'write the standup notes',
      enabled: true,
      next_run_at: '2026-09-14T09:00:00Z',
    });
  });
});

// ---------- get ----------

describe('hyper routines get', () => {
  it('prints every field of one routine', async () => {
    const get = vi.fn(async () => routineFixture({ sessionId: 'sess-bound' }));
    const { ctx } = makeCtx(fakeClient({ routines: { get } }), 'table');

    await routines.run(ctx, ['get', 'routine-1']);

    expect(get).toHaveBeenCalledWith('routine-1');
    const out = stdout();
    for (const field of ['id', 'name', 'agent_id', 'cron', 'session_id', 'next_run_at', 'prompt', 'enabled', 'created_at']) {
      expect(out).toContain(field);
    }
    expect(out).toContain('routine-1');
    expect(out).toContain('sess-bound');
    expect(out).toContain('Weekdays at 9:00 AM');
  });

  it('rejects missing / extra arguments without calling the API', async () => {
    const get = vi.fn();
    const { ctx } = makeCtx(fakeClient({ routines: { get } }), 'table');

    expect(await runErr(ctx, ['get'])).toBeInstanceOf(UsageError);
    expect(await runErr(ctx, ['get', 'a', 'b'])).toBeInstanceOf(UsageError);
    expect(get).not.toHaveBeenCalled();
  });
});

// ---------- create ----------

describe('hyper routines create', () => {
  it('requires --prompt and exactly one of --cron/--run-at', async () => {
    const create = vi.fn();
    const { ctx } = makeCtx(fakeClient({ routines: { create } }), 'table');

    expect(await runErr(ctx, ['create', '--cron', '* * * * *'])).toBeInstanceOf(UsageError);
    expect(
      await runErr(ctx, ['create', '--cron', '* * * * *', '--run-at', '2026-12-01T00:00:00Z', '--prompt', 'x']),
    ).toBeInstanceOf(UsageError);
    expect(await runErr(ctx, ['create', '--prompt', 'x'])).toBeInstanceOf(UsageError);
    expect(create).not.toHaveBeenCalled();
  });

  it('maps flags to the SDK body, including --disabled', async () => {
    const create = vi.fn(async () => routineFixture({ enabled: false, runAt: '2026-12-01T00:00:00Z', cron: null }));
    const { ctx } = makeCtx(fakeClient({ routines: { create } }), 'table');

    await routines.run(ctx, [
      'create', '--run-at', '2026-12-01T00:00:00Z', '--prompt', 'once', '--name', 'one-shot',
      '--session', 'sess-1', '--disabled',
    ]);

    expect(create).toHaveBeenCalledWith({
      prompt: 'once',
      runAt: '2026-12-01T00:00:00Z',
      name: 'one-shot',
      sessionId: 'sess-1',
      enabled: false,
    });
    expect(create.mock.calls[0][0]).not.toHaveProperty('cron');
    expect(create.mock.calls[0][0]).not.toHaveProperty('agentId');
    expect(stdout()).toContain('created');
  });

  it('--agent resolves an id prefix against the deployments roster', async () => {
    const create = vi.fn(async () => routineFixture());
    const list = vi.fn(async () => [agentFixture()]);
    const { ctx } = makeCtx(
      fakeClient({ routines: { create }, deployments: { list } }),
      'table',
    );

    await routines.run(ctx, ['create', '--cron', '0 9 * * *', '--prompt', 'daily', '--agent', 'aaaa']);

    expect(create).toHaveBeenCalledWith({
      prompt: 'daily',
      cron: '0 9 * * *',
      agentId: ID_A,
      enabled: true,
    });
  });

  it('--agent with no match is a CliError and never creates', async () => {
    const create = vi.fn();
    const list = vi.fn(async () => [agentFixture()]);
    const { ctx } = makeCtx(
      fakeClient({ routines: { create }, deployments: { list } }),
      'table',
    );

    expect(
      await runErr(ctx, ['create', '--cron', '0 9 * * *', '--prompt', 'daily', '--agent', 'zzzz']),
    ).toBeInstanceOf(CliError);
    expect(create).not.toHaveBeenCalled();
  });
});

// ---------- delete ----------

describe('hyper routines delete', () => {
  it('delete --yes removes the routine and prints the id', async () => {
    const del = vi.fn(async () => {});
    const { ctx } = makeCtx(fakeClient({ routines: { delete: del } }), 'table');

    await routines.run(ctx, ['delete', 'routine-1', '--yes']);

    expect(del).toHaveBeenCalledWith('routine-1');
    expect(stdout()).toContain('deleted routine-1');
  });

  it('non-interactive stdout without --yes still deletes (no prompt possible)', async () => {
    const del = vi.fn(async () => {});
    const { ctx } = makeCtx(fakeClient({ routines: { delete: del } }), 'table');

    await routines.run(ctx, ['delete', 'routine-2']);

    expect(del).toHaveBeenCalledWith('routine-2');
  });
});

// ---------- run (no server-side run-now: local executor replay) ----------

describe('hyper routines run', () => {
  function runClient(
    routineOverrides: Partial<Routine> = {},
    agentOverrides: Record<string, unknown> = {},
    acp: MockFns = fakeAcp(),
  ) {
    const acpConnect = vi.fn(async () => acp);
    const get = vi.fn(async () => routineFixture(routineOverrides));
    const deploymentsGet = vi.fn(async () =>
      agentFixture({ acpConnect, ...agentOverrides }));
    const client = fakeClient({
      routines: { get },
      deployments: { get: deploymentsGet, list: vi.fn(async () => []) },
    });
    return { client, get, deploymentsGet, acpConnect, acp };
  }

  it('unbound routine: creates a fresh session, sends the prompt, prints session + stop reason', async () => {
    const { client, acpConnect, acp } = runClient();
    const { ctx } = makeCtx(client, 'table');

    await routines.run(ctx, ['run', 'routine-1']);

    expect(acp.newSession).toHaveBeenCalled();
    expect(acp.prompt).toHaveBeenCalledWith('sess-new', 'write the standup notes');
    const out = stdout();
    expect(out).toContain('sess-new');
    expect(out).toContain('resumed');
    expect(out).toContain('no');
    expect(out).toContain('end_turn');
    expect(out).toContain('standup');
    // The connect options carry the CLI client name.
    expect(acpConnect.mock.calls[0][0].clientInfo.name).toBe('hypercli-cli');
  });

  it('bound session_id: resumes via session/load and prompts on the bound session', async () => {
    const { client, acp } = runClient({ sessionId: 'sess-bound' });
    const { ctx } = makeCtx(client, 'table');

    await routines.run(ctx, ['run', 'routine-1']);

    expect(acp.loadSession).toHaveBeenCalledWith('sess-bound');
    expect(acp.newSession).not.toHaveBeenCalled();
    expect(acp.prompt).toHaveBeenCalledWith('sess-bound', 'write the standup notes');
    expect(stdout()).toContain('yes');
  });

  it('bound session that fails to load falls back to a new session', async () => {
    const acp = fakeAcp({
      loadSession: vi.fn(async () => {
        throw new Error('session/load not advertised');
      }),
    });
    const { client } = runClient({ sessionId: 'sess-bound' }, {}, acp);
    const { ctx } = makeCtx(client, 'table');

    await routines.run(ctx, ['run', 'routine-1']);

    expect(acp.newSession).toHaveBeenCalled();
    expect(acp.prompt).toHaveBeenCalledWith('sess-new', 'write the standup notes');
    expect(stderr()).toContain('could not resume bound session sess-bound');
    expect(stdout()).toContain('sess-new');
  });

  it('refuses to run when the agent is not RUNNING', async () => {
    const { client, acpConnect } = runClient({}, { state: 'STOPPED' });
    const { ctx } = makeCtx(client, 'table');

    const err = await runErr(ctx, ['run', 'routine-1']);
    expect(err).toBeInstanceOf(CliError);
    expect(String((err as Error).message)).toContain('STOPPED');
    expect(acpConnect).not.toHaveBeenCalled();
  });

  it('refuses non-ACP runtimes (executor parity)', async () => {
    const { client, acpConnect } = runClient({}, { runtime: 'openclaw' });
    const { ctx } = makeCtx(client, 'table');

    const err = await runErr(ctx, ['run', 'routine-1']);
    expect(err).toBeInstanceOf(CliError);
    expect(String((err as Error).message)).toContain('openclaw');
    expect(acpConnect).not.toHaveBeenCalled();
  });

  it('maps a missing routine to a CliError naming the stage', async () => {
    const get = vi.fn(async () => {
      throw new Error('404 not found');
    });
    const { ctx } = makeCtx(fakeClient({ routines: { get } }), 'table');

    const err = await runErr(ctx, ['run', 'routine-gone']);
    expect(err).toBeInstanceOf(CliError);
    expect(String((err as Error).message)).toContain('get routine');
  });

  it('--wait additionally prints the assistant reply collected from updates', async () => {
    let onUpdate: ((n: unknown) => void) | undefined;
    const acp = fakeAcp({
      prompt: vi.fn(async () => {
        onUpdate?.({ update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'ignored' } } });
        onUpdate?.({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello ' } } });
        onUpdate?.({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } } });
        return { stopReason: 'end_turn' };
      }),
    });
    const acpConnect = vi.fn(async (options: { onUpdate?: (n: unknown) => void }) => {
      onUpdate = options.onUpdate;
      return acp;
    });
    const get = vi.fn(async () => routineFixture());
    const deploymentsGet = vi.fn(async () => agentFixture({ acpConnect }));
    const { ctx } = makeCtx(
      fakeClient({ routines: { get }, deployments: { get: deploymentsGet } }),
      'table',
    );

    await routines.run(ctx, ['run', 'routine-1', '--wait']);

    expect(stdout()).toContain('hello world');
  });

  it('without --wait the reply is not printed even when updates arrive', async () => {
    let onUpdate: ((n: unknown) => void) | undefined;
    const acp = fakeAcp({
      prompt: vi.fn(async () => {
        onUpdate?.({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'secret reply' } } });
        return { stopReason: 'end_turn' };
      }),
    });
    const acpConnect = vi.fn(async (options: { onUpdate?: (n: unknown) => void }) => {
      onUpdate = options.onUpdate;
      return acp;
    });
    const get = vi.fn(async () => routineFixture());
    const deploymentsGet = vi.fn(async () => agentFixture({ acpConnect }));
    const { ctx } = makeCtx(
      fakeClient({ routines: { get }, deployments: { get: deploymentsGet } }),
      'table',
    );

    await routines.run(ctx, ['run', 'routine-1']);

    expect(stdout()).not.toContain('secret reply');
    expect(stdout()).toContain('end_turn');
  });

  it('--json run emits the trigger record as one JSON value', async () => {
    const { client } = runClient();
    const { ctx } = makeCtx(client, 'json');

    await routines.run(ctx, ['run', 'routine-1', '--json']);

    const parsed = JSON.parse(stdout().trim()) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      routine_id: 'routine-1',
      routine_name: 'standup',
      agent_id: ID_A,
      session_id: 'sess-new',
      resumed: false,
      stop_reason: 'end_turn',
    });
    expect(parsed).not.toHaveProperty('reply');
  });

  it('rejects a bad --timeout without calling the API', async () => {
    const { client } = runClient();
    const { ctx, clientFactory } = makeCtx(client, 'table');

    expect(await runErr(ctx, ['run', 'routine-1', '--timeout', 'nope'])).toBeInstanceOf(UsageError);
    expect(clientFactory).not.toHaveBeenCalled();
  });
});

// ---------- help ----------

describe('hyper routines --help', () => {
  it('bare group and --help print the usage listing offline', async () => {
    const { ctx } = makeCtx(fakeClient(), 'table');

    await routines.run(ctx, []);
    expect(stdout()).toContain('hyper routines list');
    expect(stdout()).toContain('hyper routines get <routine-id>');
    expect(stdout()).toContain('hyper routines create');
    expect(stdout()).toContain('hyper routines run <routine-id>');
    expect(stdout()).toContain('hyper routines delete <routine-id>');

    stdoutChunks = [];
    await routines.run(ctx, ['--help']);
    expect(stdout()).toContain('hyper routines run <routine-id>');
  });

  it('subcommand --help prints group help without constructing the client', async () => {
    const { ctx, clientFactory } = makeCtx(fakeClient(), 'table');

    for (const sub of ['list', 'get', 'create', 'run', 'delete']) {
      await routines.run(ctx, [sub, '--help']);
      expect(stdout()).toContain('hyper routines');
    }
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('unknown subcommand is a UsageError with a hint', async () => {
    const { ctx } = makeCtx(fakeClient(), 'table');

    const err = await runErr(ctx, ['creat']);
    expect(err).toBeInstanceOf(UsageError);
    expect(String((err as Error).message)).toContain("did you mean 'create'");
  });
});
