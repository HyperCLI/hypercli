import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import agent from '../src/commands/agent';
import role from '../src/commands/role';
import soul from '../src/commands/soul';
import user from '../src/commands/user';
import { fileContents } from '../src/commands/metadata';
import { createOutput } from '../src/core/output';
import { UsageError } from '../src/core/errors';
import type { CommandContext } from '../src/core/types';

const ID = '11111111-1111-4111-8111-111111111111';

function fixture(overrides: Record<string, unknown> = {}) {
  const api = {
    accessIdentity: vi.fn(async () => ({ agentId: ID })),
    get: vi.fn(async (id: string) => ({
      id,
      meta: { soul: '# Soul\n', role: 'researcher', ui: { soul: 'stale' } },
    })),
    update: vi.fn(async (id: string, patch: Record<string, unknown>) => ({
      id,
      meta: {
        soul: Object.prototype.hasOwnProperty.call(patch, 'soul') ? patch.soul : '# Soul\n',
        role: Object.prototype.hasOwnProperty.call(patch, 'role') ? patch.role : 'researcher',
      },
    })),
    list: vi.fn(),
  };
  const profile = {
    getProfile: vi.fn(async () => ({ id: 'user-1', profile: '# User\n' })),
    updateProfile: vi.fn(async (value: string | null) => ({ id: 'user-1', profile: value ?? '' })),
  };
  const client = { deployments: api, user: profile, ...overrides };
  return { api, profile, client };
}

async function invoke(
  group: { run: (ctx: CommandContext, args: string[]) => Promise<number | void> },
  args: string[],
  client: unknown,
  format: 'table' | 'json' = args.includes('--json') ? 'json' : 'table',
) {
  const captured = { stdout: '', stderr: '' };
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
    client: async () => client as never,
    output: createOutput(format),
    format,
  };
  try {
    await group.run(ctx, args);
    return captured;
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hyper-metadata-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('hyper user', () => {
  it('reads and writes only canonical profile Markdown with deterministic JSON', async () => {
    const { client, profile } = fixture();
    expect((await invoke(user, [], client)).stdout).toBe('# User\n');
    expect(JSON.parse((await invoke(user, ['--json'], client)).stdout)).toEqual({
      user_id: 'user-1', profile: '# User\n',
    });
    const path = join(root, 'USER.md');
    writeFileSync(path, '# New user\n');
    expect((await invoke(user, ['-f', path], client)).stdout).toBe('# New user\n');
    expect(profile.updateProfile).toHaveBeenCalledExactlyOnceWith('# New user\n');
  });

  it('preserves empty content as an empty string and emits zero raw bytes', async () => {
    const { client, profile } = fixture();
    profile.getProfile.mockResolvedValue({ id: 'user-1', profile: '' });
    expect((await invoke(user, [], client)).stdout).toBe('');
    const path = join(root, 'empty.md');
    writeFileSync(path, '');
    expect((await invoke(user, ['-f', path], client)).stdout).toBe('');
    expect(profile.updateProfile).toHaveBeenCalledWith('');
  });

  it('maps -f - to stdin without a runtime-file fallback', () => {
    const read = vi.fn(() => '# Stdin\n');
    expect(fileContents('-', read as never)).toBe('# Stdin\n');
    expect(read).toHaveBeenCalledWith(0, 'utf8');
  });
});

describe('canonical and shorthand soul', () => {
  it('uses top-level soul before the legacy UI alias and writes through canonical agent syntax', async () => {
    const { client, api } = fixture();
    expect((await invoke(agent, [ID, 'soul'], client)).stdout).toBe('# Soul\n');
    expect(JSON.parse((await invoke(agent, [ID, 'soul', '--json'], client)).stdout)).toEqual({
      agent_id: ID, soul: '# Soul\n',
    });
    const path = join(root, 'SOUL.md');
    writeFileSync(path, '# Updated\n');
    expect((await invoke(agent, [ID, 'soul', '-f', path], client)).stdout).toBe('# Updated\n');
    expect(api.update).toHaveBeenCalledExactlyOnceWith(ID, { soul: '# Updated\n' });
  });

  it('falls back to ui.soul only when the canonical key is absent', async () => {
    const { client, api } = fixture();
    api.get.mockResolvedValue({ id: ID, meta: { ui: { soul: 'Legacy\n' } } });
    expect((await invoke(soul, [], client)).stdout).toBe('Legacy\n');
    api.get.mockResolvedValue({ id: ID, meta: { soul: '', ui: { soul: 'stale' } } });
    expect((await invoke(soul, [], client)).stdout).toBe('');
  });

  it('resolves shorthand through Backend identity, or an explicit --agent without listing', async () => {
    const { client, api } = fixture();
    await invoke(soul, [], client);
    expect(api.accessIdentity).toHaveBeenCalledOnce();
    api.accessIdentity.mockClear();
    await invoke(soul, ['--agent', ID], client);
    expect(api.accessIdentity).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('requires an explicit agent for a user-scoped credential', async () => {
    const { client, api } = fixture();
    api.accessIdentity.mockResolvedValue({ agentId: null });
    await expect(invoke(soul, [], client)).rejects.toThrow(UsageError);
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('canonical and shorthand role', () => {
  it('reads a role identifier, sets verbatim values, and maps empty string to null clear', async () => {
    const { client, api } = fixture();
    expect((await invoke(agent, [ID, 'role'], client)).stdout).toBe('researcher\n');
    expect((await invoke(role, ['  Research / Café  '], client)).stdout).toBe('  Research / Café  \n');
    expect(api.update).toHaveBeenLastCalledWith(ID, { role: '  Research / Café  ' });
    expect((await invoke(role, [''], client)).stdout).toBe('');
    expect(api.update).toHaveBeenLastCalledWith(ID, { role: null });
  });

  it('emits zero raw bytes and JSON null when role is unset', async () => {
    const { client, api } = fixture();
    api.get.mockResolvedValue({ id: ID, meta: {} });
    expect((await invoke(role, [], client)).stdout).toBe('');
    expect(JSON.parse((await invoke(role, ['--json'], client)).stdout)).toEqual({
      agent_id: ID, role: null,
    });
  });
});

describe('offline help', () => {
  it.each([
    [agent, ['--help'], 'hyper agent <id> soul'],
    [soul, ['--help'], 'hyper soul'],
    [role, ['--help'], 'role identifier'],
    [user, ['--help'], 'hyper user'],
  ])('renders %s without constructing a client', async (group, args, expected) => {
    const client = () => Promise.reject(new Error('help must stay offline'));
    const result = await invoke(group as never, args as string[], client);
    expect(result.stdout).toContain(expected as string);
    expect(result.stderr).toBe('');
  });
});
