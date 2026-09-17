import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailableGPU, HyperCLI, Job } from '@hypercli.com/sdk';
import * as jobs from '../src/commands/jobs.js';
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

const ID_A = 'abc10000-0000-0000-0000-000000000001';
const ID_B = 'abc20000-0000-0000-0000-000000000002';
const ID_FULL = '11111111-2222-3333-4444-555555555555';

function jobFixture(overrides: Partial<Job> = {}): Job {
  return {
    jobId: ID_FULL,
    jobKey: 'key',
    state: 'running',
    gpuType: 'l40s',
    gpuCount: 1,
    region: 'us',
    constraints: null,
    interruptible: true,
    pricePerHour: 0.8,
    pricePerSecond: 0.0002,
    dockerImage: 'nvidia/cuda:12.6.3',
    runtime: 3600,
    elapsed: 10,
    timeLeft: 3590,
    hostname: null,
    coldBoot: false,
    createdAt: 1_700_000_000,
    startedAt: 1_700_000_005,
    completedAt: null,
    tags: null,
    ...overrides,
  };
}

function gpuFixture(overrides: Partial<AvailableGPU> = {}): AvailableGPU {
  return {
    gpuType: 'l40s',
    gpuName: 'L40S',
    gpuCount: 1,
    cpuCores: 16,
    memoryGb: 128,
    storageGb: 200,
    region: 'us',
    regionName: 'US',
    country: 'US',
    priceSpot: 0.8,
    priceOnDemand: 1.2,
    ...overrides,
  };
}

interface FakeHandlers {
  list?: () => Promise<Job[]>;
  get?: (id: string) => Promise<Job>;
  create?: (options: unknown) => Promise<Job>;
  cancel?: (id: string) => Promise<unknown>;
  extend?: (id: string, runtime: number) => Promise<Job>;
  logs?: (id: string) => Promise<string>;
  exec?: (id: string, command: string[], timeout: number) => Promise<unknown>;
  listAvailable?: (gpu?: string, region?: string) => Promise<AvailableGPU[]>;
  capacity?: (gpu?: string) => Promise<unknown>;
}

function fakeClient(handlers: FakeHandlers = {}): HyperCLI {
  return {
    jobs: {
      list: handlers.list ?? (async () => []),
      get: handlers.get ?? (async () => jobFixture()),
      create: handlers.create ?? (async () => jobFixture()),
      cancel: handlers.cancel ?? (async () => ({})),
      extend: handlers.extend ?? (async () => jobFixture()),
      logs: handlers.logs ?? (async () => ''),
      exec: handlers.exec ?? (async () => ({ jobId: '', stdout: '', stderr: '', exitCode: 0 })),
    },
    instances: {
      listAvailable: handlers.listAvailable ?? (async () => []),
      capacity: handlers.capacity ?? (async () => ({})),
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

describe('hyper jobs', () => {
  it('gpus renders the catalog table with price and availability', async () => {
    const client = fakeClient({
      listAvailable: async () => [
        gpuFixture(),
        gpuFixture({ gpuType: 'h100', gpuName: 'H100', gpuCount: 8, region: 'eu', priceSpot: null, priceOnDemand: null }),
      ],
      capacity: async () => ({ idle: { l40s: { us: 3 } } }),
    });
    const ctx = makeCtx(client, 'table');

    await jobs.run(ctx, ['gpus']);

    const out = stdout();
    expect(out).toContain('GPU_TYPE');
    expect(out).toContain('REGION');
    expect(out).toContain('PRICE/HR');
    expect(out).toContain('AVAILABLE');
    expect(out).toContain('l40s');
    expect(out).toContain('h100 x8');
    expect(out).toContain('$0.80');
    expect(out).toMatch(/l40s\s+us\s+128\s+\$0\.80\s+3/);
    expect(stderr()).toContain('2 GPU configurations');
  });

  it('gpus --json prints the raw catalog records', async () => {
    const client = fakeClient({ listAvailable: async () => [gpuFixture()] });
    const ctx = makeCtx(client, 'json');

    await jobs.run(ctx, ['gpus', '--json']);

    const payload = JSON.parse(stdout());
    expect(payload).toHaveLength(1);
    expect(payload[0].gpuType).toBe('l40s');
    expect(payload[0].priceSpot).toBe(0.8);
  });

  it('create --dry-run prints the resolved payload and calls nothing', async () => {
    const create = vi.fn(async () => jobFixture());
    const client = fakeClient({ create });
    const ctx = makeCtx(client, 'table');

    await jobs.run(ctx, [
      'create', '--image', 'img:1', '--gpu', 'h100', '--count', '2',
      '--env', 'A=B', '--name', 'train', '--dry-run', '--', 'echo', 'hi',
    ]);

    expect(ctx.client).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    const out = stdout();
    expect(out).toContain('"image": "img:1"');
    expect(out).toContain('"command": "echo hi"');
    expect(out).toContain('"gpuType": "h100"');
    expect(out).toContain('"A": "B"');
    expect(out).toContain('"name": "train"');
  });

  it('create submits CreateJobOptions built from flags', async () => {
    const create = vi.fn(async () => jobFixture());
    const client = fakeClient({ create });
    const ctx = makeCtx(client, 'json');

    await jobs.run(ctx, [
      'create', '--image', 'img:1', '--gpu', 'h100', '--count', '2', '--region', 'us',
      '--runtime', '120', '--env', 'A=B', '--name', 'train', '--json', '--', 'python', 'train.py',
    ]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      image: 'img:1',
      command: 'python train.py',
      gpuType: 'h100',
      gpuCount: 2,
      region: 'us',
      runtime: 120,
      env: { A: 'B' },
      tags: { name: 'train' },
    });
    expect(JSON.parse(stdout()).jobId).toBe(ID_FULL);
  });

  it("create without '--' is a UsageError (exit 2) showing an example", async () => {
    const client = fakeClient();
    const ctx = makeCtx(client, 'table');

    const err: unknown = await jobs.run(ctx, ['create', '--image', 'img:1']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(2);
    printError(err);
    expect(stderr()).toContain('-- CMD');
    expect(stderr()).toMatch(/example: hyper jobs create/);
    expect(stdout()).toBe('');
    expect(ctx.client).not.toHaveBeenCalled();
  });

  it('logs --tail N prints only the last N lines', async () => {
    const logs = vi.fn(async () => 'line1\nline2\nline3\n');
    const client = fakeClient({ logs });
    const ctx = makeCtx(client, 'table');

    await jobs.run(ctx, ['logs', ID_FULL, '--tail', '2']);

    expect(logs).toHaveBeenCalledWith(ID_FULL);
    expect(stdout()).toBe('line2\nline3\n');
    expect(stdout()).not.toContain('line1');
  });

  it('cancel skips confirmation under --json and proceeds', async () => {
    const cancel = vi.fn(async () => ({}));
    const client = fakeClient({ cancel });
    const ctx = makeCtx(client, 'json');

    await jobs.run(ctx, ['cancel', ID_FULL, '--json']);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(ID_FULL);
    expect(JSON.parse(stdout())).toEqual({ id: ID_FULL, canceled: true });
  });

  it('prefix resolution: ambiguous prefix errors with candidates', async () => {
    const list = vi.fn(async () => [
      jobFixture({ jobId: ID_A }),
      jobFixture({ jobId: ID_B }),
    ]);
    const client = fakeClient({ list });
    const ctx = makeCtx(client, 'table');

    const err: unknown = await jobs.run(ctx, ['get', 'abc']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(1);
    printError(err);
    const message = (err as Error).message;
    expect(message).toMatch(/ambiguous id prefix 'abc'/);
    expect(message).toContain(ID_A);
    expect(message).toContain(ID_B);
  });

  it('prefix resolution: unambiguous prefix resolves against the listing', async () => {
    const get = vi.fn(async () => jobFixture({ jobId: ID_A }));
    const client = fakeClient({ list: async () => [jobFixture({ jobId: ID_A })], get });
    const ctx = makeCtx(client, 'table');

    await jobs.run(ctx, ['get', 'abc10']);

    expect(get).toHaveBeenCalledWith(ID_A);
    expect(stdout()).toContain(ID_A);
  });

  it('list renders the table and reports state counts on stderr', async () => {
    const client = fakeClient({
      list: async () => [
        jobFixture({ jobId: ID_A, state: 'running' }),
        jobFixture({ jobId: ID_B, state: 'queued', tags: ['name=train'] }),
      ],
    });
    const ctx = makeCtx(client, 'table');

    await jobs.run(ctx, ['list']);

    const out = stdout();
    expect(out).toContain('ID');
    expect(out).toContain('STATE');
    expect(out).toContain(ID_A);
    expect(out).toContain('l40s x1');
    expect(out).toContain('train');
    expect(stderr()).toContain('2 jobs: running=1 queued=1');
  });

  it('--help prints help without touching the API', async () => {
    const client = fakeClient();
    const ctx = makeCtx(client, 'table');

    await jobs.run(ctx, ['--help']);

    expect(ctx.client).not.toHaveBeenCalled();
    expect(stdout()).toContain('hyper jobs');
  });
});
