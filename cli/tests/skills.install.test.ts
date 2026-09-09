/**
 * hyper skills install — fused export + mkdir + cpTo, against a fully mocked
 * client seam (ctx.client is an injectable lazy factory; nothing here
 * touches the network). The real bundle is rebuilt in beforeAll so the
 * export step reads the compiled cli/skills/*.json files.
 */

import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Deployments, HyperCLI } from '@hypercli.com/sdk';
import { run } from '../src/commands/skills';
import { parseUniversal } from '../src/core/argv';
import { CliError, UsageError } from '../src/core/errors';
import { createOutput } from '../src/core/output';
import type { CommandContext } from '../src/core/types';

const ID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

const ALL_NAMES = [
  'hypercli',
  'hypercli-account',
  'hypercli-agents',
  'hypercli-auth',
  'hypercli-compute',
  'hypercli-flows',
  'hypercli-voice',
];

/** Verified runtime -> [sync-root-relative skills dir, absolute skills dir]. */
const VERIFIED: Array<[string, string, string]> = [
  ['openclaw', '.openclaw/skills', '/home/node/.openclaw/skills'],
  ['openclaw-pro', '.openclaw/skills', '/home/node/.openclaw/skills'],
  ['hermes-agent', '.hermes/skills', '/home/hermes/.hermes/skills'],
  ['opencode', '.agents/skills', '/home/node/.agents/skills'],
  ['buzz-agent', '.agents/skills', '/home/node/.agents/skills'],
  ['goose', '.goose/skills', '/home/node/.goose/skills'],
  ['codex', '.codex/skills', '/home/node/.codex/skills'],
  ['claude-code', '.claude/skills', '/home/node/.claude/skills'],
];

interface ExecCall {
  id: string;
  argv: string[];
}

interface CpCall {
  id: string;
  local: string;
  remote: string;
}

function agentFixture(overrides: Record<string, unknown> = {}): Agent {
  return {
    id: ID_A,
    state: 'RUNNING',
    name: 'alpha',
    handle: null,
    runtime: 'openclaw',
    hostname: 'alpha.hypercli.run',
    launchConfig: null,
    ...overrides,
  } as unknown as Agent;
}

interface Seam {
  ctx: CommandContext;
  execCalls: ExecCall[];
  cpCalls: CpCall[];
  stdout: () => string;
  stderr: () => string;
}

// ---------- capture ----------

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutChunks: string[];
let stderrChunks: string[];

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

function makeSeam(
  agent: Agent,
  options: { execExitCode?: number; execStderr?: string } = {},
): Seam {
  const execCalls: ExecCall[] = [];
  const cpCalls: CpCall[] = [];
  const deployments = {
    list: vi.fn(async () => [agent]),
    get: vi.fn(async (_id: string) => agent),
    exec: vi.fn(async (id: string, argv: string[]) => {
      execCalls.push({ id, argv });
      return {
        exitCode: options.execExitCode ?? 0,
        stdout: '',
        stderr: options.execStderr ?? '',
      };
    }),
    cpTo: vi.fn(async (id: string, local: string, remote: string) => {
      cpCalls.push({ id, local, remote });
      return {};
    }),
  } as unknown as Deployments;
  const format = 'json' as const;
  const ctx: CommandContext = {
    client: () => Promise.resolve({ deployments } as unknown as HyperCLI),
    output: createOutput(format),
    format,
    dev: false,
  };
  return {
    ctx,
    execCalls,
    cpCalls,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

beforeAll(async () => {
  const { buildAll } = (await import('../scripts/build-skills.mjs')) as { buildAll: () => unknown };
  buildAll();
});

describe('hyper skills install', () => {
  it.each(VERIFIED)(
    'runtime %s defaults to %s',
    async (runtime, expectedRel, expectedAbs) => {
      const seam = makeSeam(agentFixture({ runtime }));
      await run(seam.ctx, ['install', 'alpha', '--json']);

      expect(seam.execCalls).toHaveLength(1);
      expect(seam.execCalls[0].id).toBe(ID_A);
      expect(seam.execCalls[0].argv.slice(0, 2)).toEqual(['mkdir', '-p']);
      expect(seam.execCalls[0].argv.slice(2)).toEqual(
        ALL_NAMES.map((n) => `${expectedAbs}/${n}`),
      );

      expect(seam.cpCalls).toHaveLength(ALL_NAMES.length);
      for (let i = 0; i < ALL_NAMES.length; i++) {
        expect(seam.cpCalls[i].id).toBe(ID_A);
        expect(seam.cpCalls[i].remote).toBe(`${expectedRel}/${ALL_NAMES[i]}/SKILL.md`);
      }

      const record = JSON.parse(seam.stdout()) as Record<string, unknown>;
      expect(record.agent_id).toBe(ID_A);
      expect(record.runtime).toBe(runtime);
      expect(record.dir).toBe(expectedRel);
      expect(record.skills).toEqual(ALL_NAMES);
      expect(seam.stderr()).toContain(`creating ${expectedAbs}`);

      // temp export dir is removed in the finally, even on success
      const tmpRoot = dirname(dirname(seam.cpCalls[0].local));
      expect(existsSync(tmpRoot)).toBe(false);
    },
  );

  it('resolves agents by unambiguous name prefix', async () => {
    const seam = makeSeam(agentFixture());
    await run(seam.ctx, ['install', 'alp', '--json']);
    expect(JSON.parse(seam.stdout()).agent_id).toBe(ID_A);
  });

  it('--dir overrides the default for an unverified runtime (kimi-code)', async () => {
    const seam = makeSeam(agentFixture({ runtime: 'kimi-code' }));
    await run(seam.ctx, ['install', 'alpha', '--dir', '.kimi-code/skills', '--json']);
    const record = JSON.parse(seam.stdout()) as Record<string, unknown>;
    expect(record.dir).toBe('.kimi-code/skills');
    expect(seam.cpCalls[0].remote).toBe('.kimi-code/skills/hypercli/SKILL.md');
    expect(seam.execCalls[0].argv[2]).toBe('/home/node/.kimi-code/skills/hypercli');
  });

  it('--dir accepts an absolute path under the sync root and strips the prefix', async () => {
    const seam = makeSeam(agentFixture({ runtime: 'openclaw' }));
    await run(seam.ctx, ['install', 'alpha', '--dir', '/home/node/custom/skills', '--json']);
    const record = JSON.parse(seam.stdout()) as Record<string, unknown>;
    expect(record.dir).toBe('custom/skills');
    expect(seam.cpCalls[0].remote).toBe('custom/skills/hypercli/SKILL.md');
  });

  it('--dir honors launchConfig.sync_root over the runtime default', async () => {
    const seam = makeSeam(
      agentFixture({ runtime: 'openclaw', launchConfig: { sync_root: '/data' } }),
    );
    await run(seam.ctx, ['install', 'alpha', '--dir', '/data/skills', '--json']);
    expect(seam.execCalls[0].argv[2]).toBe('/data/skills/hypercli');
    expect(seam.cpCalls[0].remote).toBe('skills/hypercli/SKILL.md');
  });

  it('rejects an absolute --dir outside the sync root', async () => {
    const seam = makeSeam(agentFixture({ runtime: 'openclaw' }));
    const err = await run(seam.ctx, ['install', 'alpha', '--dir', '/etc/skills']).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toContain('/home/node');
    expect(seam.execCalls).toHaveLength(0);
    expect(seam.cpCalls).toHaveLength(0);
  });

  it('unverified runtime without --dir is a usage error (exit 2)', async () => {
    const seam = makeSeam(agentFixture({ runtime: 'kimi-code' }));
    const err = await run(seam.ctx, ['install', 'alpha']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(2);
    expect((err as Error).message).toContain('kimi-code');
    expect((err as Error).message).toContain('--dir');
    expect(seam.execCalls).toHaveLength(0);
  });

  it('a failed remote mkdir aborts with CliError and pushes nothing', async () => {
    const seam = makeSeam(agentFixture(), { execExitCode: 1, execStderr: 'read-only file system' });
    const err = await run(seam.ctx, ['install', 'alpha']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toContain('read-only file system');
    expect(seam.cpCalls).toHaveLength(0);
  });

  it('unknown agent reference is a CliError naming the reference', async () => {
    const seam = makeSeam(agentFixture());
    const err = await run(seam.ctx, ['install', 'bravo']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toContain("no agent matches 'bravo'");
  });

  it('missing agent id is a usage error', async () => {
    const seam = makeSeam(agentFixture());
    const err = await run(seam.ctx, ['install']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(2);
  });
});
