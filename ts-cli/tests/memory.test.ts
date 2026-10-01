import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError, type HyperCLI } from '@hypercli.com/sdk';
import * as memory from '../src/commands/memory.js';
import { UsageError, exitCodeFor, printError } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';
import { GROUPS, findGroup } from '../src/registry.js';
import { renderRootHelp } from '../src/core/help.js';

let stdout: string;
let stderr: string;
beforeEach(() => {
  stdout = ''; stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => { stdout += String(value); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((value) => { stderr += String(value); return true; });
});
afterEach(() => vi.restoreAllMocks());

function setup(format: 'table' | 'json' = 'table') {
  const chunk = { id: 'chunk-1', sessionId: 'session-1', seqStart: 1, seqEnd: 9, text: 'Release plan', score: 0.9 };
  const summary = { sessionId: 'session-1', title: 'Release', summaryText: 'Ship it' as string | null, summaryCursor: null, summarizedAt: null, importedAt: null, pending: false };
  const api = {
    search: vi.fn(async () => ({ items: [chunk] })),
    getSummary: vi.fn(async () => summary),
    getChunks: vi.fn(async () => ({ items: [chunk], nextCursor: 'opaque+/=', hasMore: true })),
    getTail: vi.fn(async () => ({ sessionId: 'session-1', items: [{ seqStart: 9, seqEnd: 10, role: 'user', text: 'hello', participantId: null }] })),
    rebuild: vi.fn(async () => ({ sessionId: 's', status: 'pending' })),
  };
  const client = vi.fn(async () => ({ memory: api }) as unknown as HyperCLI);
  const ctx: CommandContext = { client, format, output: createOutput(format), dev: false };
  return { api, ctx, client };
}

describe('hyper memory', () => {
  it('registers in root help', () => {
    expect(findGroup('memory')).toBe(memory);
    expect(renderRootHelp(GROUPS)).toContain('memory');
  });

  it.each(['--help', 'search', 'summary', 'chunks', 'tail', 'rebuild'])('prints offline help for %s', async (command) => {
    const { ctx, client } = setup();
    await memory.run(ctx, command === '--help' ? [command] : [command, '--help']);
    expect(stdout).toContain('hyper memory search');
    expect(stdout).toContain('once per 24h');
    expect(client).not.toHaveBeenCalled();
  });

  it.each(['-s', '--session-id'])('search joins query words and supports %s', async (flag) => {
    const { ctx, api } = setup();
    await memory.run(ctx, ['search', 'release', 'plan', flag, 'session-1', '--limit', '3']);
    expect(api.search).toHaveBeenCalledWith('release plan', { sessionId: 'session-1', limit: 3 });
    expect(stdout).toContain('SESSION');
    expect(stdout).toContain('Release plan');
  });

  it('search works across sessions without optional flags', async () => {
    const { ctx, api } = setup();
    await memory.run(ctx, ['search', 'plan']);
    expect(api.search).toHaveBeenCalledWith('plan', { sessionId: undefined, limit: undefined });
  });

  it('fetches summary and rebuild output without local rate-limit logic', async () => {
    const { ctx, api } = setup();
    await memory.run(ctx, ['summary', 's']);
    await memory.run(ctx, ['rebuild', 's']);
    await memory.run(ctx, ['rebuild', 's']);
    expect(api.getSummary).toHaveBeenCalledWith('s');
    expect(api.rebuild).toHaveBeenCalledTimes(2);
    expect(stdout).toBe('Ship it\nSummary rebuild pending: s\nSummary rebuild pending: s\n');
  });

  it('fetches chunks with cursor/limit and shows next cursor on stderr', async () => {
    const { ctx, api } = setup();
    await memory.run(ctx, ['chunks', 's', '--cursor', 'old+/=', '--limit', '2']);
    expect(api.getChunks).toHaveBeenCalledWith('s', { cursor: 'old+/=', limit: 2 });
    expect(stdout).toContain('Release plan');
    expect(stderr).toContain('Next cursor: opaque+/=');
  });

  it('fetches tail with default and explicit n', async () => {
    const { ctx, api } = setup();
    await memory.run(ctx, ['tail', 's']);
    expect(api.getTail).toHaveBeenLastCalledWith('s', 20);
    await memory.run(ctx, ['tail', 's', '--n', '7']);
    expect(api.getTail).toHaveBeenLastCalledWith('s', 7);
    expect(stdout).toContain('hello');
  });

  it.each(['search', 'summary', 'chunks', 'tail', 'rebuild'])('%s JSON is one complete SDK response', async (command) => {
    const { ctx, api } = setup('json');
    await memory.run(ctx, [command, 's', '--json']);
    const method = { search: 'search', summary: 'getSummary', chunks: 'getChunks', tail: 'getTail', rebuild: 'rebuild' }[command] as keyof typeof api;
    expect(JSON.parse(stdout)).toEqual(await api[method].mock.results[0].value);
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(stderr).toBe('');
  });

  it.each([
    ['search'], ['search', ' '], ['summary'], ['tail', 's', 'extra'], ['unknown'],
    ['tail', 's', '--n', '0'], ['tail', 's', '--n', '1.5'], ['tail', 's', '--n', 'abc'],
    ['tail', 's', '--n', '101'], ['search', 'q', '--limit', '101'],
    ['chunks', 's', '--limit', '9007199254740992'], ['search', 'q', '--limit', '-1'],
    ['summary', 's', '--limit', '2'], ['search', 'q', '--n', '2'],
    ['search', 'q', '-s', ''], ['search', 'q', '--bogus'],
  ])('rejects bad argv %j before constructing a client', async (...args) => {
    const { ctx, client } = setup();
    await expect(memory.run(ctx, args)).rejects.toBeInstanceOf(UsageError);
    expect(client).not.toHaveBeenCalled();
    expect(stdout).toBe('');
  });

  it('renders empty results and missing summaries', async () => {
    const { ctx, api } = setup();
    api.search.mockResolvedValue({ items: [] });
    api.getChunks.mockResolvedValue({ items: [], nextCursor: '', hasMore: false });
    api.getTail.mockResolvedValue({ sessionId: 'session-1', items: [] });
    await memory.run(ctx, ['search', 'nothing']);
    await memory.run(ctx, ['chunks', 's']);
    await memory.run(ctx, ['tail', 's']);
    expect(stdout).toBe('No results.\nNo chunks.\nNo messages.\n');
  });

  it.each([false, true])('renders an absent summary with pending=%s', async (pending) => {
    const { ctx, api } = setup();
    const result = await api.getSummary();
    api.getSummary.mockResolvedValue({ ...result, summaryText: null, pending });
    await memory.run(ctx, ['summary', 's']);
    expect(stdout).toBe(pending ? 'Summary pending.\n' : 'No summary yet.\n');
  });

  it.each([403, 404, 429])('preserves server error %s for the CLI error handler', async (status) => {
    const { ctx, api } = setup();
    const error = new APIError(status, 'Rebuild unavailable');
    api.rebuild.mockRejectedValue(error);
    await expect(memory.run(ctx, ['rebuild', 's'])).rejects.toBe(error);
    expect(exitCodeFor(error)).toBe(1);
    printError(error);
    expect(stderr).toContain('Rebuild unavailable');
    expect(stdout).toBe('');
  });

  it.each(['table', 'json'] as const)('appends the Retry-After delay to rebuild cooldown errors in %s mode', async (format) => {
    const { ctx, api } = setup(format);
    const error = new APIError(429, 'Rebuild unavailable', 'POST', 'https://api.example/agents/sessions/s/summary/rebuild', undefined, 86400);
    api.rebuild.mockRejectedValue(error);
    const thrown = await memory.run(ctx, ['rebuild', 's']).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(APIError);
    expect((thrown as APIError).statusCode).toBe(429);
    expect(exitCodeFor(thrown)).toBe(1);
    printError(thrown);
    expect(stderr).toContain('Rebuild unavailable (retry after 86400s)');
    expect(stdout).toBe('');
  });
});
