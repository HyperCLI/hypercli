/**
 * Tests for `hyper flow` (src/commands/flow.ts).
 *
 * Mock seam: CommandContext.client is an injectable lazy factory — tests pass
 * a fake HyperCLI whose `renders` member is a bag of vi.fn()s, so SDK call
 * surfaces (method name, first arg, params payload) are assertable directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HyperCLI, Render } from '@hypercli.com/sdk';
import * as flow from '../src/commands/flow.js';
import { CliError, UsageError, exitCodeFor } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';

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

function renderFixture(overrides: Partial<Render> = {}): Render {
  return {
    renderId: 'r_123',
    state: 'queued',
    template: null,
    renderType: 'text-to-image',
    tags: null,
    resultUrl: null,
    error: null,
    createdAt: 1770000000,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function fakeRenders(overrides: Partial<ReturnType<typeof baseRenders>> = {}) {
  return { ...baseRenders(), ...overrides };
}

function baseRenders() {
  return {
    flow: vi.fn(async (type: string, params: Record<string, unknown>) => {
      void type;
      void params;
      return renderFixture();
    }),
    list: vi.fn(async () => [
      renderFixture(),
      renderFixture({ renderId: 'r_456', state: 'completed', resultUrl: 'https://cdn.example.com/out.png' }),
    ]),
    get: vi.fn(async () =>
      renderFixture({ state: 'completed', resultUrl: 'https://cdn.example.com/out.png', completedAt: 1770000060 }),
    ),
    wait: vi.fn(async () =>
      renderFixture({ state: 'completed', resultUrl: 'https://cdn.example.com/out.png', completedAt: 1770000060 }),
    ),
    cancel: vi.fn(async () => ({ ok: true })),
  };
}

type FakeRenders = ReturnType<typeof fakeRenders>;

function fakeClient(renders: FakeRenders): HyperCLI {
  return { renders } as unknown as HyperCLI;
}

function makeCtx(client: HyperCLI, format: 'table' | 'json' = 'table'): CommandContext {
  return {
    client: vi.fn(async () => client),
    output: createOutput(format),
    format,
    dev: false,
  };
}

// ---------- tests ----------

describe('hyper flow', () => {
  it('(a) create merges typed flags first, then --param overrides (param wins)', async () => {
    const renders = fakeRenders();
    const ctx = makeCtx(fakeClient(renders));

    await flow.run(ctx, [
      'create', 'text-to-image',
      '--prompt', 'a cat',
      '--width', '512',
      '--param', 'width=1024',
      '--param', 'hd=true',
    ]);

    expect(renders.flow).toHaveBeenCalledTimes(1);
    const [type, params] = renders.flow.mock.calls[0];
    expect(type).toBe('text-to-image');
    expect(params).toEqual({ prompt: 'a cat', width: 1024, hd: true });
    expect(stdout()).toContain('r_123');
    expect(stdout()).toContain('hyper flow status r_123');
    expect(stderr()).toBe('');
  });

  it('(b) create rejects an unknown flow type with the candidate list', async () => {
    const renders = fakeRenders();
    const ctx = makeCtx(fakeClient(renders));

    const err: unknown = await flow.run(ctx, ['create', 'nope', '--param', 'prompt=x']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(UsageError);
    expect(exitCodeFor(err)).toBe(2);
    const message = (err as Error).message;
    expect(message).toContain("'nope'");
    expect(message).toContain('text-to-image');
    expect(message).toContain('first-last-frame-video');
    expect(renders.flow).not.toHaveBeenCalled();
    expect(ctx.client).not.toHaveBeenCalled();
  });

  it('(c) --dry-run prints the resolved {type, params} with zero SDK calls', async () => {
    const renders = fakeRenders();
    const ctx = makeCtx(fakeClient(renders));

    await flow.run(ctx, ['create', 'text-to-image', '--prompt', 'a cat', '--dry-run']);

    expect(ctx.client).not.toHaveBeenCalled();
    expect(renders.flow).not.toHaveBeenCalled();
    expect(JSON.parse(stdout())).toEqual({ type: 'text-to-image', params: { prompt: 'a cat' } });
    expect(stderr()).toBe('');
  });

  it('(d) legacy type dispatches but is absent from help text', async () => {
    const renders = fakeRenders();

    await flow.run(makeCtx(fakeClient(renders)), [
      'create', 'speaking-video',
      '--prompt', 'hi',
      '--image-url', 'https://cdn.example.com/face.png',
      '--dry-run',
    ]);

    const resolved = JSON.parse(stdout());
    expect(resolved.type).toBe('speaking-video');
    expect(resolved.params.image_url).toBe('https://cdn.example.com/face.png');
    expect(renders.flow).not.toHaveBeenCalled();

    stdoutChunks = [];
    await flow.run(makeCtx(fakeClient(renders)), ['--help']);
    const help = stdout();
    expect(help).toContain('text-to-image');
    expect(help).toContain('hyper files upload');
    expect(help).not.toContain('speaking-video');
  });

  it('(e) wait maps an SDK timeout to CliError naming the final state', async () => {
    const renders = fakeRenders({
      wait: vi.fn(async () => {
        throw new Error(
          'Render r_123 did not complete within 1s (+1800s queue grace, +300s active grace); lastRender={"state":"running"}',
        );
      }),
      get: vi.fn(async () => renderFixture({ state: 'running' })),
    });
    const ctx = makeCtx(fakeClient(renders));

    const err: unknown = await flow.run(ctx, ['wait', 'r_123', '--timeout', '1']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(CliError);
    expect(exitCodeFor(err)).toBe(1);
    expect((err as Error).message).toContain('did not complete within 1s');
    expect((err as Error).message).toContain('running');
    expect(stdout()).toBe('');
  });

  it('(e2) wait prints the final status line on success', async () => {
    const renders = fakeRenders();
    const ctx = makeCtx(fakeClient(renders));

    await flow.run(ctx, ['wait', 'r_123', '--timeout', '5']);

    expect(renders.wait).toHaveBeenCalledWith('r_123', { timeoutMs: 5000 });
    expect(stdout()).toContain('flow r_123 completed');
    expect(stdout()).toContain('https://cdn.example.com/out.png');
  });

  it('(f) status renders type, state and result URLs', async () => {
    const renders = fakeRenders({
      get: vi.fn(async () =>
        renderFixture({
          renderType: 'text-to-video',
          state: 'completed',
          resultUrl: 'https://cdn.example.com/out.mp4',
          completedAt: 1770000060,
        }),
      ),
    });
    const ctx = makeCtx(fakeClient(renders));

    await flow.run(ctx, ['status', 'r_123']);

    expect(renders.get).toHaveBeenCalledWith('r_123');
    const out = stdout();
    expect(out).toContain('text-to-video');
    expect(out).toContain('completed');
    expect(out).toContain('https://cdn.example.com/out.mp4');
    expect(stderr()).toBe('');
  });

  it('(g) cancel without an interactive TTY proceeds', async () => {
    const renders = fakeRenders();
    const ctx = makeCtx(fakeClient(renders));

    await flow.run(ctx, ['cancel', 'r_123']);

    expect(renders.cancel).toHaveBeenCalledWith('r_123');
    expect(stdout()).toContain('cancelled flow r_123');
    expect(stderr()).toBe('');
  });

  it('list renders a table and forwards --state to the SDK', async () => {
    const renders = fakeRenders();
    const ctx = makeCtx(fakeClient(renders));

    await flow.run(ctx, ['list', '--state', 'completed']);

    expect(renders.list).toHaveBeenCalledWith({ state: 'completed' });
    const out = stdout();
    expect(out).toContain('ID');
    expect(out).toContain('RESULTS');
    expect(out).toContain('r_123');
    expect(out).toContain('r_456');
  });
});
