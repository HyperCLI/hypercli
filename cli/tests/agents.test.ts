/**
 * Tests for `hyper agents` (src/commands/agents.ts).
 *
 * Mock seam: CommandContext.client is an injectable lazy factory. Tests pass a
 * fake HyperCLI whose .deployments is a MOCK Deployments record (every method
 * a vi.fn, `as unknown as Deployments` — the createMockDeploymentsApi helper),
 * so nothing here touches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APIError,
  type Agent,
  type AgentLaunchConfig,
  type Deployments,
  type HyperCLI,
  type Routine,
} from '@hypercli.com/sdk';
import * as agents from '../src/commands/agents.js';
import { CliError, UsageError, exitCodeFor } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';

const ID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const ID_A2 = 'aaaaaaaa-9999-4999-8999-999999999999';

// Sentinels: must never appear in full on stdout/stderr anywhere.
const GW_TOKEN = 'gw-full-token-abcdef0123456789';
const JWT = 'jwt-sentinel-must-not-print';
const SCOPED_KEY = 'hak-scoped-FULLSECRET-0000aaaa';

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

function agentFixture(overrides: Record<string, unknown> = {}): Agent {
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
    jwtToken: JWT,
    gatewayToken: GW_TOKEN,
    meta: { plan_id: 'solo' },
    routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
    launchConfig: { env: { FOO: 'bar' }, image: 'img' },
    publicUrl: 'https://alpha.hypercli.run',
    desktopUrl: null,
    shellUrl: null,
    ...overrides,
  } as unknown as Agent;
}

function launchConfigFixture(): AgentLaunchConfig {
  return {
    image: 'img',
    env: { FOO: 'bar' },
    secrets: {},
    routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
    command: [],
    entrypoint: [],
    restart: false,
    sync_root: '/home/node',
    sync_exclude: [],
    sync_uid: 1000,
    sync_gid: 1000,
    registry_url: null,
    registry_auth: {},
    runtime_scopes: [],
  };
}

function routineFixture(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 'routine-1',
    userId: 'user-1',
    agentId: ID_A,
    cron: '*/5 * * * *',
    prompt: 'say hi',
    enabled: true,
    name: 'greeter',
    runAt: null,
    nextRunAt: '2026-09-10T00:05:00Z',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

// ---------- mock seam ----------

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockDeployments = Record<string, ReturnType<typeof vi.fn>>;

/**
 * MOCK DeploymentsAPI: every method the agents group can call, as a vi.fn,
 * then `as unknown as Deployments` at the ctx boundary.
 */
function createMockDeploymentsApi(
  roster: Agent[],
  overrides: Record<string, ReturnType<typeof vi.fn>> = {},
): MockDeployments {
  const byId = (id: string): Agent => roster.find((a) => a.id === id) ?? roster[0];
  const stateful = (id: string, state: string): Agent =>
    agentFixture({ ...Object.fromEntries(Object.entries(byId(id) as unknown as Record<string, unknown>)), state, id });
  const base: MockDeployments = {
    list: vi.fn(async () => roster),
    get: vi.fn(async (ref: string) => byId(ref)),
    waitRunning: vi.fn(async (id: string) => byId(id)),
    waitForState: vi.fn(async (id: string) => byId(id)),
    start: vi.fn(async (id: string) => stateful(id, 'STARTING')),
    startOpenClaw: vi.fn(async (id: string) => stateful(id, 'STARTING')),
    startHermesAgent: vi.fn(async (id: string) => stateful(id, 'STARTING')),
    storedLaunchConfig: vi.fn(async () => launchConfigFixture()),
    secret: vi.fn(async () => {
      throw new APIError(404, 'not found');
    }),
    setSecret: vi.fn(async () => ({})),
    stop: vi.fn(async (id: string) => stateful(id, 'STOPPING')),
    delete: vi.fn(async () => ({})),
    archive: vi.fn(async (id: string) => stateful(id, 'ARCHIVING')),
    restore: vi.fn(async (id: string) => stateful(id, 'RESTORING')),
    exec: vi.fn(async () => ({ exitCode: 0, stdout: 'hello\n', stderr: '' })),
    cpTo: vi.fn(async () => ({})),
    cpFrom: vi.fn(async (_id: string, _remote: string, local: string) => local),
    subscribeLogs: vi.fn(async () => {}),
    shellConnect: vi.fn(async () => ({})),
    createScopedKey: vi.fn(async () => ({ id: 'key-1', agent_id: ID_A, key: SCOPED_KEY })),
    webSearch: vi.fn(async (query: string, options?: { count?: number }) => ({
      query: { q: query, count: options?.count ?? 5 },
      web: {
        results: [
          { title: 'HyperCLI', url: 'https://hypercli.com' },
          { title: 'HyperCLI Docs', url: 'https://docs.hypercli.com' },
        ],
      },
    })),
    getRoutes: vi.fn(async (id: string) => ({
      agentId: id,
      routes: { openclaw: { port: 18789, auth: false, prefix: '' } },
      cors: null,
      routeStatuses: { openclaw: { dns_state: 'active' } },
    })),
    setRoute: vi.fn(async (id: string, name: string, route: unknown) => ({
      agentId: id,
      routes: { [name]: route },
      cors: null,
      routeStatuses: {},
    })),
    removeRoute: vi.fn(async (id: string) => ({ agentId: id, routes: {}, cors: null, routeStatuses: {} })),
    createOpenClaw: vi.fn(async () => stateful('new-openclaw', 'STOPPED')),
    createHermesAgent: vi.fn(async () => stateful('new-hermes', 'STOPPED')),
    createGoose: vi.fn(async () => stateful('new-goose', 'STOPPED')),
    createOpenCode: vi.fn(async () => stateful('new-opencode', 'STOPPED')),
    createBuzzAgent: vi.fn(async () => stateful('new-buzz', 'STOPPED')),
  };
  return { ...base, ...overrides };
}

interface FakeClientParts {
  deployments?: MockDeployments;
  routines?: Record<string, ReturnType<typeof vi.fn>>;
  agent?: Record<string, ReturnType<typeof vi.fn>>;
}

function fakeClient(parts: FakeClientParts = {}): HyperCLI {
  return {
    deployments: parts.deployments ?? createMockDeploymentsApi([agentFixture()]),
    routines: parts.routines ?? {
      list: vi.fn(async () => []),
      create: vi.fn(async () => routineFixture()),
      update: vi.fn(async () => routineFixture()),
      delete: vi.fn(async () => {}),
    },
    agent: parts.agent ?? {
      redeemGrantCode: vi.fn(async () => {
        throw new Error('redeemGrantCode not stubbed');
      }),
    },
  } as unknown as HyperCLI;
}

function makeCtx(
  client: HyperCLI,
  format: 'table' | 'json',
): { ctx: CommandContext; clientFactory: ReturnType<typeof vi.fn> } {
  const clientFactory = vi.fn(async () => client);
  return {
    ctx: { client: clientFactory, output: createOutput(format), format, dev: false },
    clientFactory,
  };
}

function asDeployments(client: HyperCLI): MockDeployments {
  return client.deployments as unknown as MockDeployments;
}

async function runErr(ctx: CommandContext, args: string[]): Promise<unknown> {
  return agents.run(ctx, args).then(
    () => null,
    (e: unknown) => e,
  );
}

// ---------- ls ----------

describe('hyper agents ls', () => {
  it('prints the state/runtime/short-id table and total + per-state counts on stderr', async () => {
    const d = createMockDeploymentsApi([
      agentFixture({ id: ID_A, runtime: 'openclaw', state: 'RUNNING' }),
      agentFixture({ id: ID_B, name: 'beta', displayName: 'beta', runtime: 'hermes-agent', state: 'STOPPED' }),
    ]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['ls']);

    const out = stdout();
    expect(out).toContain('ID');
    expect(out).toContain('NAME');
    expect(out).toContain('RUNTIME');
    expect(out).toContain('STATE');
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
    expect(out).toContain(ID_A.slice(0, 12));
    expect(out).toContain('openclaw');
    expect(out).toContain('hermes-agent');
    expect(out).toContain('RUNNING');
    expect(out).toContain('STOPPED');
    expect(stderr()).toContain('total 2');
    expect(stderr()).toContain('RUNNING 1');
    expect(stderr()).toContain('STOPPED 1');
    expect(out).not.toContain(GW_TOKEN);
    expect(out).not.toContain(JWT);
  });

  it('passes --state through to d.list', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['ls', '--state', 'RUNNING']);

    expect(d.list).toHaveBeenCalledWith({ state: 'RUNNING' });
  });

  it('--json emits redacted record bags', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'json');

    await agents.run(ctx, ['ls']);

    const payload = JSON.parse(stdout()) as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(1);
    expect(payload[0].id).toBe(ID_A);
    expect(payload[0].dashboard).toBe(`https://console.hypercli.com/agents/${ID_A}`);
    expect(stdout()).toContain('...6789'); // gateway token last-4 only
    expect(stdout()).not.toContain(GW_TOKEN);
    expect(stdout()).not.toContain(JWT);
  });
});

// ---------- status ----------

describe('hyper agents status', () => {
  it('shows the dashboard URL, runtime, state, and plan field as returned', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['status', ID_A]);

    const out = stdout();
    expect(out).toContain('dashboard');
    expect(out).toContain(`https://console.hypercli.com/agents/${ID_A}`);
    expect(out).toContain('runtime');
    expect(out).toContain('openclaw');
    expect(out).toContain('state');
    expect(out).toContain('RUNNING');
    expect(out).toContain('plan_id');
    expect(out).toContain('solo');
    expect(out).not.toContain(GW_TOKEN);
    expect(out).not.toContain(JWT);
  });

  it('resolves an unambiguous id prefix', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['status', 'aaaaa']);

    expect(d.get).toHaveBeenCalledWith(ID_A);
  });

  it('ambiguous prefix -> UsageError (exit 2) listing candidates', async () => {
    const d = createMockDeploymentsApi([
      agentFixture({ id: ID_A, displayName: 'one' }),
      agentFixture({ id: ID_A2, displayName: 'two' }),
    ]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    const err = await runErr(ctx, ['status', 'aa']);

    expect(err).toBeInstanceOf(UsageError);
    expect(exitCodeFor(err)).toBe(2);
    expect((err as Error).message).toContain('ambiguous agent reference');
    expect((err as Error).message).toContain(ID_A);
    expect((err as Error).message).toContain(ID_A2);
  });

  it('--verbose appends the redacted JSON record', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['status', ID_A, '--verbose']);

    const out = stdout();
    expect(out).toContain('"launch_epoch": 3');
    expect(out).not.toContain(GW_TOKEN);
    expect(out).not.toContain(JWT);
  });
});

// ---------- wait ----------

describe('hyper agents wait', () => {
  it('defaults to RUNNING via waitRunning with timeout/interval in ms', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['wait', ID_A]);

    expect(d.waitRunning).toHaveBeenCalledWith(ID_A, 300_000, 5_000);
    expect(stdout()).toContain(`${ID_A.slice(0, 12)} reached RUNNING`);
  });

  it('custom --state dispatches waitForState with failure states minus the target', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['wait', ID_A, '--state', 'ARCHIVED', '--timeout', '12', '--interval', '0.5']);

    expect(d.waitForState).toHaveBeenCalledWith(
      ID_A,
      ['ARCHIVED'],
      12_000,
      ['FAILED', 'DELETED'],
      undefined,
      500,
    );
    expect(d.waitRunning).not.toHaveBeenCalled();
  });

  it('timeout is a CliError naming the state waited for and the current state', async () => {
    const d = createMockDeploymentsApi([agentFixture()], {
      waitRunning: vi.fn(async () => {
        throw new Error(`Timed out waiting for agent ${ID_A} to reach RUNNING (last=STOPPED)`);
      }),
    });
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    const err = await runErr(ctx, ['wait', ID_A]);

    expect(err).toBeInstanceOf(CliError);
    expect(exitCodeFor(err)).toBe(1);
    expect((err as Error).message).toContain('RUNNING');
    expect((err as Error).message).toContain('STOPPED');
  });

  it('terminal failure state while waiting is a CliError', async () => {
    const d = createMockDeploymentsApi([agentFixture()], {
      waitForState: vi.fn(async () => {
        throw new Error('Agent entered FAILED while waiting for STOPPED');
      }),
    });
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    const err = await runErr(ctx, ['wait', ID_A, '--state', 'STOPPED']);

    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toContain('FAILED');
  });
});

// ---------- create ----------

describe('hyper agents create', () => {
  it('--dry-run prints the resolved payload JSON and performs zero SDK calls', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const client = fakeClient({ deployments: d });
    const { ctx, clientFactory } = makeCtx(client, 'json');

    await agents.run(ctx, [
      'create', 'demo', '--runtime', 'openclaw', '--dry-run', '--param', 'FOO=bar',
    ]);

    const payload = JSON.parse(stdout()) as Record<string, any>;
    expect(payload.runtime).toBe('openclaw');
    expect(payload.method).toBe('createOpenClaw');
    expect(payload.options).toMatchObject({ name: 'demo', dryRun: true, env: { FOO: 'bar' } });
    expect(clientFactory).not.toHaveBeenCalled();
    for (const fn of Object.values(d)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('unknown runtime -> UsageError listing the 5 runtimes', async () => {
    const { ctx } = makeCtx(fakeClient(), 'table');

    const err = await runErr(ctx, ['create', 'demo', '--runtime', 'nope']);

    expect(err).toBeInstanceOf(UsageError);
    expect(exitCodeFor(err)).toBe(2);
    for (const runtime of ['openclaw', 'hermes', 'goose', 'opencode', 'buzz']) {
      expect((err as Error).message).toContain(runtime);
    }
  });

  it('dispatches per runtime: hermes -> createHermesAgent, buzz -> createBuzzAgent', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['create', 'h1', '--runtime', 'hermes', '--model', 'm-x']);
    expect(d.createHermesAgent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'h1', dryRun: false, config: { model: 'm-x' } }),
    );
    expect(d.createOpenClaw).not.toHaveBeenCalled();

    await agents.run(ctx, ['create', 'b1', '--runtime', 'buzz']);
    expect(d.createBuzzAgent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'b1', dryRun: false }),
    );
  });

  it('--model on openclaw is a usage error (no silent drop of the config bag)', async () => {
    const { ctx } = makeCtx(fakeClient(), 'table');

    const err = await runErr(ctx, ['create', 'demo', '--runtime', 'openclaw', '--model', 'm']);

    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toContain('--model');
  });
});

// ---------- start — runtime dispatch ----------

describe('hyper agents start', () => {
  it('openclaw: reads the gateway token secret, then startOpenClaw with stored config', async () => {
    const d = createMockDeploymentsApi([agentFixture({ runtime: 'openclaw' })], {
      secret: vi.fn(async () => ({ value: 'existinggwtoken0123', launch_epoch: 3 })),
    });
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['start', ID_A]);

    expect(d.secret).toHaveBeenCalledWith(ID_A, 'OPENCLAW_GATEWAY_TOKEN');
    expect(d.setSecret).not.toHaveBeenCalled();
    expect(d.storedLaunchConfig).toHaveBeenCalledWith(ID_A);
    expect(d.startOpenClaw).toHaveBeenCalledWith(ID_A, {
      gatewayToken: 'existinggwtoken0123',
      launchConfig: launchConfigFixture(),
    });
    expect(d.startHermesAgent).not.toHaveBeenCalled();
    expect(d.start).not.toHaveBeenCalled();
  });

  it('openclaw with no stored secret (404): mints and stores a 64-hex token, then starts', async () => {
    const d = createMockDeploymentsApi([agentFixture({ runtime: 'openclaw-pro' })], {
      secret: vi.fn(async () => {
        throw new APIError(404, 'secret not found');
      }),
    });
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['start', ID_A]);

    const minted = (d.setSecret.mock.calls[0] as unknown[])[2] as string;
    expect(minted).toMatch(/^[0-9a-f]{64}$/);
    expect(d.startOpenClaw).toHaveBeenCalledWith(ID_A, {
      gatewayToken: minted,
      launchConfig: launchConfigFixture(),
    });
  });

  it('openclaw: a non-404 secret read failure aborts the start (no silent re-mint)', async () => {
    const d = createMockDeploymentsApi([agentFixture({ runtime: 'openclaw' })], {
      secret: vi.fn(async () => {
        throw new APIError(500, 'boom');
      }),
    });
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    const err = await runErr(ctx, ['start', ID_A]);

    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toContain('secret');
    expect(d.setSecret).not.toHaveBeenCalled();
    expect(d.startOpenClaw).not.toHaveBeenCalled();
  });

  it('hermes: stored launch config then startHermesAgent', async () => {
    const d = createMockDeploymentsApi([agentFixture({ runtime: 'hermes-agent' })]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['start', ID_A]);

    expect(d.storedLaunchConfig).toHaveBeenCalledWith(ID_A);
    expect(d.startHermesAgent).toHaveBeenCalledWith(ID_A, { launchConfig: launchConfigFixture() });
    expect(d.startOpenClaw).not.toHaveBeenCalled();
    expect(d.start).not.toHaveBeenCalled();
  });

  it('other runtimes: plain start()', async () => {
    const d = createMockDeploymentsApi([agentFixture({ runtime: 'goose' })]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['start', ID_A]);

    expect(d.start).toHaveBeenCalledWith(ID_A);
    expect(d.startOpenClaw).not.toHaveBeenCalled();
    expect(d.startHermesAgent).not.toHaveBeenCalled();
  });
});

// ---------- stop / delete ----------

describe('hyper agents stop/delete', () => {
  it('stop --yes proceeds and reports the transitional state', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['stop', ID_A, '--yes']);

    expect(d.stop).toHaveBeenCalledWith(ID_A);
    expect(stdout()).toContain('stopping');
    expect(stdout()).toContain('STOPPING');
  });

  it('delete --yes prints the deleted id', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['delete', ID_A, '--yes']);

    expect(d.delete).toHaveBeenCalledWith(ID_A);
    expect(stdout()).toContain(`deleted ${ID_A.slice(0, 12)}`);
  });

  it('delete --json + --yes emits { deleted: <full id> }', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'json');

    await agents.run(ctx, ['delete', ID_A, '--yes', '--json']);

    const payload = JSON.parse(stdout()) as Record<string, unknown>;
    expect(payload.deleted).toBe(ID_A);
    expect(d.delete).toHaveBeenCalledWith(ID_A);
  });
});

// ---------- exec ----------

describe('hyper agents exec', () => {
  it('forwards the argv after --, prints stdout/stderr, propagates the exit code', async () => {
    const d = createMockDeploymentsApi([agentFixture()], {
      exec: vi.fn(async () => ({ exitCode: 3, stdout: 'hi there\n', stderr: 'uh oh\n' })),
    });
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    const code = await agents.run(ctx, ['exec', ID_A, '--', 'echo', 'hi', '-n']);

    expect(code).toBe(3);
    expect(d.exec).toHaveBeenCalledWith(ID_A, ['echo', 'hi', '-n'], { timeout: 30 });
    expect(stdout()).toContain('hi there');
    expect(stderr()).toContain('uh oh');
  });

  it('no command -> UsageError', async () => {
    const { ctx } = makeCtx(fakeClient(), 'table');

    const err = await runErr(ctx, ['exec', ID_A]);

    expect(err).toBeInstanceOf(UsageError);
    expect(exitCodeFor(err)).toBe(2);
  });
});

// ---------- cp ----------

describe('hyper agents cp', () => {
  it('rejects both-remote (and both-local) as UsageError', async () => {
    const { ctx } = makeCtx(fakeClient(), 'table');

    const bothRemote = await runErr(ctx, ['cp', 'aa:/x', 'bb:/y']);
    expect(bothRemote).toBeInstanceOf(UsageError);
    expect(exitCodeFor(bothRemote)).toBe(2);

    const bothLocal = await runErr(ctx, ['cp', './a', './b']);
    expect(bothLocal).toBeInstanceOf(UsageError);
  });

  it('upload: resolves the remote side and cpTo\'s the agent', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['cp', 'local.txt', 'aa:/remote.txt']);

    expect(d.cpTo).toHaveBeenCalledWith(ID_A, 'local.txt', '/remote.txt');
    expect(stdout()).toContain('copied local.txt');
  });

  it('download: cpFrom writes the returned path', async () => {
    const d = createMockDeploymentsApi([agentFixture()], {
      cpFrom: vi.fn(async () => 'out.txt'),
    });
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['cp', 'aa:/remote.txt', 'out.txt']);

    expect(d.cpFrom).toHaveBeenCalledWith(ID_A, '/remote.txt', 'out.txt');
    expect(stdout()).toContain('copied');
    expect(stdout()).toContain('out.txt');
  });

  it('treats Windows drive-letter paths as local', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['cp', 'C:\\temp\\f.txt', 'aa:/remote/f.txt']);

    expect(d.cpTo).toHaveBeenCalledWith(ID_A, 'C:\\temp\\f.txt', '/remote/f.txt');
  });
});

// ---------- logs ----------

describe('hyper agents logs', () => {
  it('one-shot: subscribeLogs with follow:false, prints collected lines', async () => {
    const d = createMockDeploymentsApi([agentFixture()], {
      subscribeLogs: vi.fn(async (_id: string, handler: (line: string) => void) => {
        handler('line one');
        handler('line two');
      }),
    });
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    const code = await agents.run(ctx, ['logs', ID_A]);

    expect(code).toBe(0);
    expect(d.subscribeLogs).toHaveBeenCalledWith(
      ID_A,
      expect.any(Function),
      expect.objectContaining({ follow: false, tailLines: 100 }),
    );
    expect(stdout()).toContain('line one');
    expect(stdout()).toContain('line two');
  });

  it('-f: subscribeLogs with follow:true, a signal, and streamed lines', async () => {
    let seenSignal: AbortSignal | undefined;
    const d = createMockDeploymentsApi([agentFixture()], {
      subscribeLogs: vi.fn(async (_id: string, handler: (line: string) => void, options: { signal?: AbortSignal }) => {
        seenSignal = options.signal;
        handler('live line');
      }),
    });
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    const code = await agents.run(ctx, ['logs', ID_A, '-f', '-n', '5']);

    expect(code).toBe(0);
    expect(d.subscribeLogs).toHaveBeenCalledWith(
      ID_A,
      expect.any(Function),
      expect.objectContaining({ follow: true, tailLines: 5 }),
    );
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(stdout()).toContain('live line');
  });
});

// ---------- activate ----------

describe('hyper agents activate', () => {
  const redemption = {
    grant: {
      id: 'grant-1',
      userId: 'user-1',
      entitlementId: 'ent-1',
      type: 'code',
      planId: 'solo',
      duration: 2_592_000,
      code: 'PROMO-123',
      tags: ['promo'],
      meta: null,
      appliedAt: new Date('2026-09-01T00:00:00Z'),
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: null,
    },
    entitlement: {
      id: 'ent-1',
      userId: 'user-1',
      subscriptionId: null,
      planId: 'solo',
      planName: 'Solo',
      provider: 'activation_code',
      status: 'ACTIVE',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      expiresAt: new Date('2026-10-01T00:00:00Z'),
      updatedAt: null,
      tpmLimit: 1000,
      rpmLimit: 60,
      tpdLimit: 10000,
      agentTier: null,
      features: {},
      tags: ['promo'],
      meta: null,
      slotGrants: null,
      activeAgentCount: 0,
      activeAgentIds: [],
      agentSlots: [],
    },
  };

  it('redeems the grant code and prints the entitlement summary', async () => {
    const redeem = vi.fn(async () => redemption);
    const { ctx } = makeCtx(fakeClient({ agent: { redeemGrantCode: redeem } }), 'table');

    await agents.run(ctx, ['activate', 'PROMO-123']);

    expect(redeem).toHaveBeenCalledWith('PROMO-123', { extendExisting: false });
    const out = stdout();
    expect(out).toContain('Code activated');
    expect(out).toContain('PROMO-123');
    expect(out).toContain('Solo');
    expect(out).toContain('solo');
    expect(out).toContain('2026-10-01');
  });
});

// ---------- routines ----------

describe('hyper agents routines', () => {
  it('list prints name, schedule summary, enabled, id', async () => {
    const routines = {
      list: vi.fn(async () => [routineFixture(), routineFixture({ id: 'routine-2', cron: null, runAt: '2026-12-01T00:00:00Z', enabled: false })]),
    };
    const { ctx } = makeCtx(fakeClient({ routines }), 'table');

    await agents.run(ctx, ['routines', 'list']);

    const out = stdout();
    expect(out).toContain('NAME');
    expect(out).toContain('SCHEDULE');
    expect(out).toContain('ENABLED');
    expect(out).toContain('greeter');
    expect(out).toContain('cron: */5 * * * *');
    expect(out).toContain('once: 2026-12-01T00:00:00Z');
    expect(out).toContain('routine-1');
    expect(out).toContain('routine-2');
  });

  it('create requires --prompt and exactly one of --cron/--run-at', async () => {
    const { ctx } = makeCtx(fakeClient(), 'table');

    expect(await runErr(ctx, ['routines', 'create', '--cron', '* * * * *'])).toBeInstanceOf(UsageError);
    expect(
      await runErr(ctx, [
        'routines', 'create', '--cron', '* * * * *', '--run-at', '2026-12-01T00:00:00Z', '--prompt', 'x',
      ]),
    ).toBeInstanceOf(UsageError);
    expect(
      await runErr(ctx, ['routines', 'create', '--prompt', 'x']),
    ).toBeInstanceOf(UsageError);
  });

  it('create maps flags to the SDK body (agentId omitted unless --agent)', async () => {
    const create = vi.fn(async () => routineFixture());
    const { ctx } = makeCtx(fakeClient({ routines: { list: vi.fn(), create, update: vi.fn(), delete: vi.fn() } }), 'table');

    await agents.run(ctx, [
      'routines', 'create', '--cron', '0 9 * * *', '--prompt', 'standup', '--name', 'daily',
    ]);

    expect(create).toHaveBeenCalledWith({
      prompt: 'standup',
      cron: '0 9 * * *',
      name: 'daily',
      enabled: true,
    });
    expect(create.mock.calls[0][0]).not.toHaveProperty('agentId');
    expect(stdout()).toContain('created');
  });

  it('delete --yes removes the routine and prints the id', async () => {
    const del = vi.fn(async () => {});
    const { ctx } = makeCtx(fakeClient({ routines: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: del } }), 'table');

    await agents.run(ctx, ['routines', 'delete', 'routine-1', '--yes']);

    expect(del).toHaveBeenCalledWith('routine-1');
    expect(stdout()).toContain('deleted routine-1');
  });

  it('hidden update maps --enable/--disable and rejects empty updates', async () => {
    const update = vi.fn(async () => routineFixture({ enabled: false }));
    const { ctx } = makeCtx(fakeClient({ routines: { list: vi.fn(), create: vi.fn(), update, delete: vi.fn() } }), 'table');

    await agents.run(ctx, ['routines', 'update', 'routine-1', '--disable']);
    expect(update).toHaveBeenCalledWith('routine-1', { enabled: false });

    expect(await runErr(ctx, ['routines', 'update', 'routine-1'])).toBeInstanceOf(UsageError);
  });
});

// ---------- token (hidden) ----------

describe('hyper agents token', () => {
  it('table mode prints the key exactly once and warns it is not stored', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['token', ID_A]);

    expect(d.createScopedKey).toHaveBeenCalledWith(ID_A, undefined);
    const occurrences = stdout().split(SCOPED_KEY).length - 1;
    expect(occurrences).toBe(1);
    expect(stderr()).toContain('not stored');
  });

  it('--scope values are joined into the key name', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['token', ID_A, '--scope', 'files', '--scope', 'exec']);

    expect(d.createScopedKey).toHaveBeenCalledWith(ID_A, 'files,exec');
  });

  it('--json carries the key in the record bag', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'json');

    await agents.run(ctx, ['token', ID_A]);

    const payload = JSON.parse(stdout()) as Record<string, unknown>;
    expect(payload.key).toBe(SCOPED_KEY);
    expect(payload.agent_id).toBe(ID_A);
  });
});

// ---------- config / models (hidden, openclaw-only) ----------

describe('hyper agents config', () => {
  it('config on a hermes agent errors with runtime gating', async () => {
    const d = createMockDeploymentsApi([agentFixture({ runtime: 'hermes-agent' })]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    const err = await runErr(ctx, ['config', 'get', ID_A]);

    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toBe(
      'config is only supported on openclaw agents (this is hermes-agent)',
    );
  });

  it('config get prints the gateway config as JSON', async () => {
    const configGet = vi.fn(async () => ({ agents: { defaults: { model: 'm1' } } }));
    const d = createMockDeploymentsApi([agentFixture({ configGet })]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['config', 'get', ID_A]);

    expect(configGet).toHaveBeenCalled();
    expect(JSON.parse(stdout())).toEqual({ agents: { defaults: { model: 'm1' } } });
  });

  it('config set nests dotted --param keys and patches the gateway', async () => {
    const configPatch = vi.fn(async () => {});
    const d = createMockDeploymentsApi([agentFixture({ configPatch })]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['config', 'set', ID_A, '--param', 'a.b=2', '--param', 'flag=true']);

    expect(configPatch).toHaveBeenCalledWith({ a: { b: 2 }, flag: true });
    expect(stdout()).toContain('config patched');
  });

  it('models on a goose agent errors with the same runtime gating', async () => {
    const d = createMockDeploymentsApi([agentFixture({ runtime: 'goose' })]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    const err = await runErr(ctx, ['models', ID_A]);

    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toBe('models is only supported on openclaw agents (this is goose)');
  });

  it('models on openclaw prints the provider/name table', async () => {
    const modelsList = vi.fn(async () => [
      { provider: 'anthropic', name: 'claude-x', contextWindow: 200000 },
      { provider: 'openai', name: 'gpt-x' },
    ]);
    const d = createMockDeploymentsApi([agentFixture({ modelsList })]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['models', ID_A]);

    const out = stdout();
    expect(out).toContain('anthropic');
    expect(out).toContain('claude-x');
    expect(out).toContain('200000');
  });
});

// ---------- routes (hidden) ----------

describe('hyper agents routes', () => {
  it('list prints the route table with dns status', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['routes', 'list', ID_A]);

    const out = stdout();
    expect(out).toContain('NAME');
    expect(out).toContain('PORT');
    expect(out).toContain('openclaw');
    expect(out).toContain('18789');
    expect(out).toContain('active');
  });

  it('add validates --port and forwards the route config', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    expect(await runErr(ctx, ['routes', 'add', ID_A, 'web'])).toBeInstanceOf(UsageError);
    expect(await runErr(ctx, ['routes', 'add', ID_A, 'web', '--port', 'abc'])).toBeInstanceOf(UsageError);

    await agents.run(ctx, ['routes', 'add', ID_A, 'web', '--port', '8080', '--prefix', 'web', '--no-auth']);
    expect(d.setRoute).toHaveBeenCalledWith(ID_A, 'web', { port: 8080, prefix: 'web', auth: false });
  });

  it('treats the self selector as a routes alias without listing agents', async () => {
    const d = createMockDeploymentsApi([agentFixture()]);
    const { ctx } = makeCtx(fakeClient({ deployments: d }), 'table');

    await agents.run(ctx, ['routes', 'add', 'self', 'web', '--port', '3000', '--no-auth']);

    expect(d.list).not.toHaveBeenCalled();
    expect(d.setRoute).toHaveBeenCalledWith('self', 'web', { port: 3000, auth: false });
  });
});

// ---------- help / dispatch ----------

describe('hyper agents group surface', () => {
  it('--help lists the core commands and omits the hidden ones', async () => {
    const { ctx, clientFactory } = makeCtx(fakeClient(), 'table');

    await agents.run(ctx, ['--help']);

    const out = stdout();
    expect(out).toContain('hyper agents ls');
    expect(out).toContain('hyper agents create');
    expect(out).toContain('hyper agents routines list');
    expect(out).not.toContain('archive');
    expect(out).not.toContain('token');
    expect(out).not.toContain('config set');
    expect(out).not.toContain('restore');
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('unknown subcommand -> UsageError (exit 2)', async () => {
    const { ctx } = makeCtx(fakeClient(), 'table');

    const err = await runErr(ctx, ['frobnicate']);

    expect(err).toBeInstanceOf(UsageError);
    expect(exitCodeFor(err)).toBe(2);
  });

  it('bare group prints help', async () => {
    const { ctx } = makeCtx(fakeClient(), 'table');

    await agents.run(ctx, []);

    expect(stdout()).toContain('hyper agents ls');
  });
});
