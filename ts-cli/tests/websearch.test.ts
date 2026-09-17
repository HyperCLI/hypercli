/**
 * Tests for `hyper websearch` (src/commands/websearch.ts).
 *
 * Mock seam matches tests/agents.test.ts: CommandContext.client is an
 * injectable lazy factory returning a fake HyperCLI whose
 * .deployments.webSearch is a vi.fn, so nothing here touches the network.
 * `hyper websearch` is the sole web search surface; these tests pin its
 * behavior end to end (argv parsing, API call, table/json rendering, errors).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError, type Deployments, type HyperCLI } from '@hypercli.com/sdk';
import * as websearch from '../src/commands/websearch.js';
import { CliError, UsageError, exitCodeFor } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutChunks: string[];
let stderrChunks: string[];

const stdout = () => stdoutChunks.join('');

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

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockDeployments = Record<string, ReturnType<typeof vi.fn>>;

function createMockDeploymentsApi(
  overrides: Record<string, ReturnType<typeof vi.fn>> = {},
): MockDeployments {
  return {
    webSearch: vi.fn(async (query: string, options?: { count?: number }) => ({
      query: { q: query, count: options?.count ?? 5 },
      web: {
        results: [
          { title: 'HyperCLI', url: 'https://hypercli.com' },
          { title: 'HyperCLI Docs', url: 'https://docs.hypercli.com' },
        ],
      },
    })),
    ...overrides,
  };
}

function fakeClient(deployments: MockDeployments): HyperCLI {
  return { deployments: deployments as unknown as Deployments } as unknown as HyperCLI;
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

async function runErr(ctx: CommandContext, args: string[]): Promise<unknown> {
  return websearch.run(ctx, args).then(
    () => null,
    (e: unknown) => e,
  );
}

describe('hyper websearch', () => {
  it('prints the title/url table in table mode', async () => {
    const d = createMockDeploymentsApi();
    const { ctx } = makeCtx(fakeClient(d), 'table');

    await websearch.run(ctx, ['HyperCLI Brave agent container smoke']);

    expect(d.webSearch).toHaveBeenCalledWith('HyperCLI Brave agent container smoke', { count: 5 });
    const out = stdout();
    expect(out).toContain('TITLE');
    expect(out).toContain('URL');
    expect(out).toContain('HyperCLI');
    expect(out).toContain('https://hypercli.com');
  });

  it('joins multi-word positionals into one query', async () => {
    const d = createMockDeploymentsApi();
    const { ctx } = makeCtx(fakeClient(d), 'table');

    await websearch.run(ctx, ['hypercli', 'brave', 'smoke']);

    expect(d.webSearch).toHaveBeenCalledWith('hypercli brave smoke', { count: 5 });
  });

  it('passes -n/--count through to d.webSearch', async () => {
    const d = createMockDeploymentsApi();
    const { ctx } = makeCtx(fakeClient(d), 'table');

    await websearch.run(ctx, ['hypercli', '--count', '1']);
    expect(d.webSearch).toHaveBeenCalledWith('hypercli', { count: 1 });

    await websearch.run(ctx, ['hypercli', '-n', '3']);
    expect(d.webSearch).toHaveBeenCalledWith('hypercli', { count: 3 });
  });

  it('--json emits the raw Brave payload, parseable on stdout', async () => {
    const d = createMockDeploymentsApi();
    const { ctx } = makeCtx(fakeClient(d), 'json');

    await websearch.run(ctx, ['HyperCLI Brave agent container smoke', '--count', '1', '--json']);

    expect(d.webSearch).toHaveBeenCalledWith('HyperCLI Brave agent container smoke', { count: 1 });
    const payload = JSON.parse(stdout()) as Record<string, any>;
    expect(payload.web.results[0].title).toBe('HyperCLI');
    expect(payload.query).toEqual({ q: 'HyperCLI Brave agent container smoke', count: 1 });
  });

  it('table mode with no results prints an empty state', async () => {
    const d = createMockDeploymentsApi({
      webSearch: vi.fn(async () => ({ web: { results: [] } })),
    });
    const { ctx } = makeCtx(fakeClient(d), 'table');

    await websearch.run(ctx, ['hypercli']);

    expect(stdout()).toContain('No results.');
  });

  it('missing query and out-of-range --count are UsageError (exit 2)', async () => {
    const d = createMockDeploymentsApi();
    const { ctx } = makeCtx(fakeClient(d), 'table');

    const missing = await runErr(ctx, ['--count', '1']);
    expect(missing).toBeInstanceOf(UsageError);
    expect(exitCodeFor(missing)).toBe(2);

    for (const bad of ['0', '21', 'abc']) {
      const err = await runErr(ctx, ['hypercli', '--count', bad]);
      expect(err).toBeInstanceOf(UsageError);
      expect(exitCodeFor(err)).toBe(2);
    }
    expect(d.webSearch).not.toHaveBeenCalled();
  });

  it('API failure is a CliError naming the failing call', async () => {
    const d = createMockDeploymentsApi({
      webSearch: vi.fn(async () => {
        throw new APIError(502, 'brave upstream unavailable');
      }),
    });
    const { ctx } = makeCtx(fakeClient(d), 'table');

    const err = await runErr(ctx, ['hypercli']);

    expect(err).toBeInstanceOf(CliError);
    expect(exitCodeFor(err)).toBe(1);
    expect((err as Error).message).toContain('web search failed');
    expect((err as Error).message).toContain('502');
  });

  it('--help prints the usage line without constructing the SDK client', async () => {
    const d = createMockDeploymentsApi();
    const { ctx, clientFactory } = makeCtx(fakeClient(d), 'table');

    await websearch.run(ctx, ['--help']);

    expect(stdout()).toContain('hyper websearch');
    expect(clientFactory).not.toHaveBeenCalled();
    expect(d.webSearch).not.toHaveBeenCalled();
  });
});
