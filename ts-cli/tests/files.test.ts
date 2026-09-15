/**
 * Tests for `hyper files` (src/commands/files.ts).
 *
 * Mock seam: CommandContext.client is an injectable lazy factory — tests pass
 * a fake HyperCLI straight through ctx, capturing stdout/stderr via spies.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { File as HyperFile, HyperCLI } from '@hypercli.com/sdk';
import * as files from '../src/commands/files.js';
import { exitCodeFor, printError } from '../src/core/errors.js';
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

function fileFixture(overrides: Partial<HyperFile> = {}): HyperFile {
  return {
    id: 'file_123',
    userId: 'user_123',
    filename: 'image.png',
    contentType: 'image/png',
    fileSize: 2048,
    url: 's3://hypercli/files/file_123.png',
    state: 'done',
    error: null,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

interface FakeHandlers {
  upload?: (path: string) => Promise<HyperFile>;
  get?: (fileId: string) => Promise<HyperFile>;
  delete?: (fileId: string) => Promise<unknown>;
}

function fakeClient(handlers: FakeHandlers = {}): HyperCLI {
  return {
    files: {
      upload: handlers.upload ?? (async () => fileFixture()),
      get: handlers.get ?? (async () => fileFixture()),
      delete: handlers.delete ?? (async () => ({})),
      isReady: (f: HyperFile) => f.state === 'done',
      waitReady: async (fileId: string) => fileFixture({ id: fileId }),
    },
  } as unknown as HyperCLI;
}

function makeCtx(client: HyperCLI, format: 'table' | 'json'): CommandContext {
  return {
    client: vi.fn(async () => client),
    output: createOutput(format),
    format,
    dev: false,
  };
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'hyper-files-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// ---------- tests ----------

describe('hyper files', () => {
  it('upload: missing file -> CliError naming the path, API never touched', async () => {
    const upload = vi.fn(async () => fileFixture());
    const client = fakeClient({ upload });
    const ctx = makeCtx(client, 'json');
    const missing = join(workDir, 'nope.png');

    const err: unknown = await files.run(ctx, ['upload', missing, '--json']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(1);
    printError(err);
    expect(stderr()).toContain(missing);
    expect(stdout()).toBe('');
    expect(upload).not.toHaveBeenCalled();
    expect(ctx.client).not.toHaveBeenCalled();
  });

  it('upload: prints the id record (table) and stderr info carries id + url', async () => {
    const client = fakeClient();
    const ctx = makeCtx(client, 'table');
    const source = join(workDir, 'image.png');
    await writeFile(source, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await files.run(ctx, ['upload', source]);

    const out = stdout();
    expect(out).toContain('file_123');
    expect(out).toContain('image.png');
    expect(out).toContain('s3://hypercli/files/file_123.png');
    expect(stderr()).toContain('file_123');
  });

  it('upload --json: raw record on stdout', async () => {
    const client = fakeClient();
    const ctx = makeCtx(client, 'json');
    const source = join(workDir, 'image.png');
    await writeFile(source, Buffer.from([1, 2, 3]));

    await files.run(ctx, ['upload', source, '--json']);

    const payload = JSON.parse(stdout());
    expect(payload.id).toBe('file_123');
    expect(payload.filename).toBe('image.png');
    expect(payload.fileSize).toBe(2048);
  });

  it('upload: waits for processing when the upload is not yet ready', async () => {
    const waitReady = vi.fn(async (id: string) => fileFixture({ id, state: 'done' }));
    const client = {
      files: {
        upload: async () => fileFixture({ state: 'processing' }),
        isReady: (f: HyperFile) => f.state === 'done',
        waitReady,
      },
    } as unknown as HyperCLI;
    const ctx = makeCtx(client, 'json');
    const source = join(workDir, 'image.png');
    await writeFile(source, Buffer.from([1]));

    await files.run(ctx, ['upload', source, '--json']);

    expect(waitReady).toHaveBeenCalledWith('file_123');
    const payload = JSON.parse(stdout());
    expect(payload.state).toBe('done');
  });

  it('get: renders id/name/url/created/size', async () => {
    const get = vi.fn(async () => fileFixture());
    const client = fakeClient({ get });
    const ctx = makeCtx(client, 'table');

    await files.run(ctx, ['get', 'file_123']);

    expect(get).toHaveBeenCalledWith('file_123');
    const out = stdout();
    expect(out).toContain('file_123');
    expect(out).toContain('image.png');
    expect(out).toContain('s3://hypercli/files/file_123.png');
    expect(out).toContain('2026-09-01T00:00:00Z');
    expect(out).toContain('2048');
  });

  it('delete --json: proceeds without any prompt', async () => {
    const del = vi.fn(async () => ({}));
    const client = fakeClient({ delete: del });
    const ctx = makeCtx(client, 'json');

    await files.run(ctx, ['delete', 'file_123', '--json']);

    expect(del).toHaveBeenCalledWith('file_123');
    const payload = JSON.parse(stdout());
    expect(payload).toEqual({ id: 'file_123', deleted: true });
  });

  it('delete: non-TTY without --yes/--json refuses (exit 1) and never calls the API', async () => {
    const del = vi.fn(async () => ({}));
    const client = fakeClient({ delete: del });
    const ctx = makeCtx(client, 'table');

    const err: unknown = await files.run(ctx, ['delete', 'file_123']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(1);
    printError(err);
    expect(stderr()).toContain('--yes');
    expect(del).not.toHaveBeenCalled();
  });

  it('delete --yes: skips the prompt and deletes', async () => {
    const del = vi.fn(async () => ({}));
    const client = fakeClient({ delete: del });
    const ctx = makeCtx(client, 'table');

    await files.run(ctx, ['delete', 'file_123', '--yes']);

    expect(del).toHaveBeenCalledWith('file_123');
    expect(stdout()).toContain('Deleted file_123');
  });

  it('unknown subcommand -> UsageError (exit 2)', async () => {
    const client = fakeClient();
    const ctx = makeCtx(client, 'table');

    const err: unknown = await files.run(ctx, ['frobnicate']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(2);
    expect(stdout()).toBe('');
  });

  it('--help prints help without touching the API', async () => {
    const client = fakeClient();
    const ctx = makeCtx(client, 'table');

    await files.run(ctx, ['--help']);

    expect(ctx.client).not.toHaveBeenCalled();
    expect(stdout()).toContain('hyper files');
  });
});
