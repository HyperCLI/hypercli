/**
 * hyper skills — golden-sample group tests.
 *
 * run() is invoked with a CommandContext built exactly like the entrypoint
 * builds it (format resolved from the same argv), with a client() that fails
 * if ever called: this group must stay offline.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseUniversal } from '../src/core/argv';
import { CliError, UsageError } from '../src/core/errors';
import { createOutput } from '../src/core/output';
import type { CommandContext } from '../src/core/types';
import { run } from '../src/commands/skills';

const ALL_NAMES = [
  'hypercli',
  'hypercli-account',
  'hypercli-agents',
  'hypercli-auth',
  'hypercli-compute',
  'hypercli-flows',
  'hypercli-voice',
];

interface Captured {
  stdout: string;
  stderr: string;
}

async function invoke(args: string[]): Promise<Captured> {
  const format = parseUniversal(args).format;
  const captured: Captured = { stdout: '', stderr: '' };
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    captured.stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    captured.stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  const ctx: CommandContext = {
    client: () => Promise.reject(new Error('skills group must not use the API client')),
    output: createOutput(format),
    format,
    dev: false,
  };

  try {
    await run(ctx, args);
    return captured;
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

beforeAll(async () => {
  const { buildAll } = (await import('../scripts/build-skills.mjs')) as { buildAll: () => unknown };
  buildAll();
});

describe('hyper skills (inventory)', () => {
  it('table lists all 7 bundled skills and fits 80 columns', async () => {
    const { stdout, stderr } = await invoke([]);
    expect(stderr).toBe('');
    const [header] = stdout.split('\n');
    expect(header).toContain('NAME');
    expect(header).toContain('DESCRIPTION');
    expect(header).toContain('COMMANDS');
    for (const skillName of ALL_NAMES) {
      expect(stdout).toContain(skillName);
    }
    for (const line of stdout.trimEnd().split('\n')) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it("'list' aliases the bare inventory", async () => {
    const { stdout } = await invoke(['list']);
    for (const skillName of ALL_NAMES) {
      expect(stdout).toContain(skillName);
    }
  });

  it("'ls' aliases the bare inventory", async () => {
    const { stdout, stderr } = await invoke(['ls']);
    expect(stderr).toBe('');
    const [header] = stdout.split('\n');
    expect(header).toContain('NAME');
    for (const skillName of ALL_NAMES) {
      expect(stdout).toContain(skillName);
    }
  });

  it('--json emits the full index array', async () => {
    const { stdout } = await invoke(['--json']);
    const data = JSON.parse(stdout) as { name: string; description: string; commands: string[] }[];
    expect(data.map((s) => s.name)).toEqual(ALL_NAMES);
    for (const skill of data) {
      expect(typeof skill.description).toBe('string');
      expect(Array.isArray(skill.commands)).toBe(true);
    }
  });
});

describe('hyper skills <name>', () => {
  it("prefix 'auth' resolves and cats the markdown verbatim", async () => {
    const { stdout, stderr } = await invoke(['auth']);
    expect(stderr).toBe('');
    expect(stdout).toContain('HyperCLI Auth');
    expect(stdout.startsWith('# ')).toBe(true);
  });

  it('exact match resolves without prefix ambiguity', async () => {
    const { stdout } = await invoke(['hypercli-agents']);
    expect(stdout).toContain('#');
  });

  it('--json emits {name, description, commands, markdown}', async () => {
    const { stdout } = await invoke(['auth', '--json']);
    const data = JSON.parse(stdout) as Record<string, unknown>;
    expect(data.name).toBe('hypercli-auth');
    expect(typeof data.description).toBe('string');
    expect(Array.isArray(data.commands)).toBe(true);
    expect(String(data.markdown)).toContain('HyperCLI Auth');
  });

  it('unknown name errors listing available skills', async () => {
    const err = await invoke(['bogus']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    const message = (err as Error).message;
    expect(message).toContain("unknown skill 'bogus'");
    for (const skillName of ALL_NAMES) {
      expect(message).toContain(skillName);
    }
    expect((err as CliError).exitCode).toBe(1);
  });

  it('ambiguous prefix errors listing candidates', async () => {
    const err = await invoke(['hypercli-a']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    const message = (err as Error).message;
    expect(message).toContain("ambiguous skill prefix 'hypercli-a'");
    expect(message).toContain('hypercli-account');
    expect(message).toContain('hypercli-agents');
    expect(message).toContain('hypercli-auth');
  });

  it('extra positionals are a usage error (exit 2)', async () => {
    const err = await invoke(['auth', 'extra']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(2);
  });
});

describe('hyper skills export', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'hyper-skills-test-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes every bundled skill as <dir>/<name>/SKILL.md, byte-verbatim', async () => {
    const dir = join(tmp, 'nested', 'export');
    const { stdout, stderr } = await invoke(['export', dir]);
    for (const skillName of ALL_NAMES) {
      const file = join(dir, skillName, 'SKILL.md');
      expect(existsSync(file)).toBe(true);
      const compiled = JSON.parse(
        readFileSync(
          fileURLToPath(new URL(`../skills/${skillName}.json`, import.meta.url)),
          'utf8',
        ),
      ) as { markdown: string };
      expect(readFileSync(file, 'utf8')).toBe(compiled.markdown);
      expect(stderr).toContain(`wrote ${join(dir, skillName, 'SKILL.md')}`);
    }
    expect(stdout).toContain(dir);
    expect(stdout).toContain(ALL_NAMES.join(', '));
  });

  it('--json emits exactly {dir, skills}', async () => {
    const dir = join(tmp, 'json-export');
    const { stdout } = await invoke(['export', dir, '--json']);
    expect(JSON.parse(stdout)).toEqual({ dir, skills: ALL_NAMES });
  });

  it('overwrites exported files but leaves unrelated files in place', async () => {
    const dir = join(tmp, 'existing');
    mkdirSync(join(dir, 'hypercli'), { recursive: true });
    writeFileSync(join(dir, 'hypercli', 'SKILL.md'), 'stale', 'utf8');
    writeFileSync(join(dir, 'keep-me.txt'), 'unrelated', 'utf8');
    await invoke(['export', dir]);
    expect(readFileSync(join(dir, 'keep-me.txt'), 'utf8')).toBe('unrelated');
    expect(readFileSync(join(dir, 'hypercli', 'SKILL.md'), 'utf8')).not.toBe('stale');
  });

  it('refuses a target that exists as a non-directory', async () => {
    const file = join(tmp, 'not-a-dir');
    writeFileSync(file, 'x', 'utf8');
    const err = await invoke(['export', file]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toContain('not a directory');
    expect((err as CliError).exitCode).toBe(1);
  });

  it('missing target directory is a usage error (exit 2)', async () => {
    const err = await invoke(['export']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(2);
  });
});
