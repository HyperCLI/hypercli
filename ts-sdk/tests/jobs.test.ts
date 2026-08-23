import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jobs } from '../src/jobs.js';
import type { HTTPClient } from '../src/http.js';
import { BaseJob } from '../src/job/base.js';

const wsMock = vi.hoisted(() => {
  class MockWebSocket {
    static instances: MockWebSocket[] = [];

    readonly handlers: Record<string, Array<(...args: any[]) => void>> = {};
    closed = false;

    constructor(readonly url: string) {
      MockWebSocket.instances.push(this);
    }

    on(event: string, handler: (...args: any[]) => void): this {
      this.handlers[event] = [...(this.handlers[event] ?? []), handler];
      return this;
    }

    once(event: string, handler: (...args: any[]) => void): this {
      const wrapped = (...args: any[]) => {
        this.off(event, wrapped);
        handler(...args);
      };
      return this.on(event, wrapped);
    }

    off(event: string, handler: (...args: any[]) => void): this {
      this.handlers[event] = (this.handlers[event] ?? []).filter((candidate) => candidate !== handler);
      return this;
    }

    emit(event: string, ...args: any[]): void {
      for (const handler of this.handlers[event] ?? []) handler(...args);
    }

    close(): void {
      this.closed = true;
      this.emit('close');
    }
  }

  return { MockWebSocket };
});

vi.mock('ws', () => ({ default: wsMock.MockWebSocket }));

describe('Jobs API', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    wsMock.MockWebSocket.instances = [];
  });

  it('forwards exact exec argv without shell parsing', async () => {
    const post = vi.fn().mockResolvedValue({
      job_id: 'job-1',
      stdout: 'ok\n',
      stderr: '',
      exit_code: 0,
    });
    const jobs = new Jobs({ post } as unknown as HTTPClient);
    const argv = ['tool', '-f', '  exact value  ', ''];

    await jobs.exec('job-1', argv, 9);

    expect(post).toHaveBeenCalledWith('/api/jobs/job-1/exec', {
      command: argv,
      timeout: 9,
    });
  });

  it('rejects non-argv exec commands before HTTP', async () => {
    const post = vi.fn();
    const jobs = new Jobs({ post } as unknown as HTTPClient);

    await expect(jobs.exec('job-1', 'tool -f' as unknown as string[])).rejects.toThrow('argv list');
    expect(post).not.toHaveBeenCalled();
  });

  it.each([0, 301, 1.5])('rejects invalid exec timeout %s before HTTP', async (timeout) => {
    const post = vi.fn();
    const jobs = new Jobs({ post } as unknown as HTTPClient);

    await expect(jobs.exec('job-1', ['true'], timeout)).rejects.toThrow('integer from 1 through 300');
    expect(post).not.toHaveBeenCalled();
  });

  it('derives elapsed and timeLeft from timestamps instead of trusting stale API values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-02T00:00:30Z'));

    const http = {
      get: vi.fn().mockResolvedValue({
        job_id: 'job-1',
        job_key: 'job-key',
        state: 'running',
        gpu_type: 'l40s',
        gpu_count: 1,
        region: 'oh',
        constraints: null,
        interruptible: true,
        price_per_hour: 1.0,
        price_per_second: 1.0 / 3600,
        docker_image: 'ubuntu',
        runtime: 120,
        elapsed: 0,
        time_left: 0,
        created_at: '2026-04-02T00:00:00Z',
        started_at: '2026-04-02T00:00:00Z',
      }),
    } as unknown as HTTPClient;

    const job = await new Jobs(http).get('job-1');

    expect(job.elapsed).toBe(30);
    expect(job.timeLeft).toBe(90);
  });

  it('falls back to createdAt when a running job is missing startedAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-02T00:00:45Z'));

    const http = {
      get: vi.fn().mockResolvedValue({
        job_id: 'job-1',
        job_key: 'job-key',
        state: 'running',
        gpu_type: 'l40s',
        gpu_count: 1,
        region: 'oh',
        constraints: null,
        interruptible: true,
        price_per_hour: 1.0,
        price_per_second: 1.0 / 3600,
        docker_image: 'ubuntu',
        runtime: 300,
        created_at: '2026-04-02T00:00:00Z',
        started_at: null,
      }),
    } as unknown as HTTPClient;

    const job = await new Jobs(http).get('job-1');

    expect(job.elapsed).toBe(45);
    expect(job.timeLeft).toBe(255);
  });

  it('preserves constraints from API responses', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        job_id: 'job-1',
        job_key: 'job-key',
        state: 'running',
        gpu_type: 'h200',
        gpu_count: 8,
        region: 'br',
        constraints: { cpu_vendor: 'amd' },
        interruptible: true,
        price_per_hour: 12.34,
        price_per_second: 12.34 / 3600,
        docker_image: 'nvidia/cuda:12.0-base-ubuntu22.04',
        runtime: 300,
      }),
    } as unknown as HTTPClient;

    const job = await new Jobs(http).get('job-1');

    expect(job.constraints).toEqual({ cpu_vendor: 'amd' });
  });

  it('includes constraints when creating jobs', async () => {
    const http = {
      post: vi.fn().mockResolvedValue({
        job_id: 'dry-run',
        job_key: 'dry-run',
        state: 'dry_run',
        gpu_type: 'h200',
        gpu_count: 8,
        region: 'br',
        constraints: { cpu_vendor: 'intel' },
        interruptible: true,
        price_per_hour: 12.34,
        price_per_second: 12.34 / 3600,
        docker_image: 'nvidia/cuda:12.0-base-ubuntu22.04',
        runtime: 60,
      }),
    } as unknown as HTTPClient;

    await new Jobs(http).create({
      image: 'nvidia/cuda:12.0-base-ubuntu22.04',
      command: 'echo hello',
      gpuType: 'h200',
      gpuCount: 8,
      region: 'br',
      constraints: { cpu_vendor: 'intel' },
      runtime: 60,
      dryRun: true,
    });

    expect((http.post as any).mock.calls[0][1].constraints).toEqual({ cpu_vendor: 'intel' });
  });

  it('parses tags from API responses', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        job_id: 'job-tagged',
        job_key: 'job-key',
        state: 'running',
        gpu_type: 'l40s',
        gpu_count: 1,
        region: 'us',
        constraints: null,
        interruptible: true,
        price_per_hour: 1.0,
        price_per_second: 1.0 / 3600,
        docker_image: 'ubuntu',
        runtime: 60,
        tags: ['env=prod', 'team=ml'],
      }),
    } as unknown as HTTPClient;

    const job = await new Jobs(http).get('job-tagged');

    expect(job.tags).toEqual(['env=prod', 'team=ml']);
  });

  it('includes tags when creating jobs', async () => {
    const http = {
      post: vi.fn().mockResolvedValue({
        job_id: 'job-with-tags',
        job_key: 'job-key',
        state: 'dry_run',
        gpu_type: 'l40s',
        gpu_count: 1,
        region: 'us',
        constraints: null,
        interruptible: true,
        price_per_hour: 1.0,
        price_per_second: 1.0 / 3600,
        docker_image: 'ubuntu',
        runtime: 60,
        tags: ['env=staging'],
      }),
    } as unknown as HTTPClient;

    await new Jobs(http).create({
      image: 'ubuntu',
      tags: ['env=staging'],
      dryRun: true,
    });

    expect((http.post as any).mock.calls[0][1].tags).toEqual(['env=staging']);
  });

  it('passes repeated tag filters to list', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({ jobs: [] }),
    } as unknown as HTTPClient;

    await new Jobs(http).list(undefined, { env: 'prod', team: 'ml' });

    const params = (http.get as any).mock.calls[0][1];
    expect(params.tag).toEqual(['env=prod', 'team=ml']);
  });

  it('sends tag filters and backend pagination when listing jobs', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        jobs: [
          {
            job_id: 'job-1',
            job_key: 'job-key',
            state: 'running',
            gpu_type: 'l40s',
            gpu_count: 1,
            region: 'oh',
            tags: ['team=ml'],
            interruptible: true,
            price_per_hour: 1.2,
            price_per_second: 1.2 / 3600,
            docker_image: 'nvidia/cuda:12.0-base-ubuntu22.04',
            runtime: 300,
          },
        ],
        total_count: 1,
        page: 2,
        page_size: 25,
      }),
    } as unknown as HTTPClient;

    const result = await new Jobs(http).listPage({
      state: 'running',
      tags: { team: 'ml', env: 'prod' },
      page: 2,
      pageSize: 25,
    });

    expect(result.totalCount).toBe(1);
    expect(result.page).toBe(2);
    expect(result.jobs[0]?.tags).toEqual(['team=ml']);
    expect((http.get as any).mock.calls[0]).toEqual([
      '/api/jobs',
      { state: 'running', tag: ['team=ml', 'env=prod'], page: 2, page_size: 25 },
    ]);
  });

  it('streams metrics over job-key scoped websocket URLs', async () => {
    const jobs = new Jobs(fakeStreamHttp());

    const stream = jobs.metricsStream('job-1', { interval: 7 });
    const next = stream.next();

    await waitUntil(() => wsMock.MockWebSocket.instances[0] !== undefined);
    const socket = wsMock.MockWebSocket.instances[0];
    expect(socket?.url).toBe('wss://api.hypercli.com/orchestra/ws/metrics/jobs/job-key?interval=7');
    socket?.emit('message', Buffer.from(JSON.stringify({
      event: 'metrics_snapshot',
      data: {
        gpus: [{ index: 0, name: 'L40S', utilization_gpu_percent: 51, memory_used_mb: 64, memory_total_mb: 128 }],
        system: { cpu_percent: 12, cpu_cores: 4, memory_used_mb: 256, memory_limit_mb: 512 },
      },
    })));

    await expect(next).resolves.toMatchObject({
      done: false,
      value: {
        gpus: [{ index: 0, name: 'L40S', utilization: 51, memoryUsed: 64, memoryTotal: 128 }],
        system: { cpuPercent: 12, cpuCores: 4, memoryUsed: 256, memoryLimit: 512 },
      },
    });
    await stream.return(undefined);
    expect(socket?.closed).toBe(true);
  });

  it('streams lifecycle over job-key scoped websocket URLs', async () => {
    const jobs = new Jobs(fakeStreamHttp());

    const stream = jobs.lifecycleStream('job-1');
    const next = stream.next();

    await waitUntil(() => wsMock.MockWebSocket.instances[0] !== undefined);
    const socket = wsMock.MockWebSocket.instances[0];
    expect(socket?.url).toBe('wss://api.hypercli.com/orchestra/ws/lifecycle/job-key');
    socket?.emit('message', Buffer.from(JSON.stringify({
      event: 'terminated',
      job_id: 'job-1',
      state: 'terminated',
      reason: 'user',
    })));

    await expect(next).resolves.toMatchObject({
      done: false,
      value: {
        event: 'terminated',
        jobId: 'job-1',
        state: 'terminated',
        reason: 'user',
      },
    });
    await stream.return(undefined);
    expect(socket?.closed).toBe(true);
  });
});

describe('BaseJob hostname settling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits on the consumer after RUNNING and allows an explicit override', async () => {
    vi.useFakeTimers();
    const job = { jobId: 'job-1', state: 'running', hostname: 'new-agent.example.test' } as any;
    const client = { jobs: { get: vi.fn().mockResolvedValue(job) } } as any;
    const managed = new BaseJob(client, job);
    const health = vi.spyOn(managed, 'checkHealth').mockResolvedValue(true);

    expect(BaseJob.DEFAULT_HOSTNAME_SETTLE_DELAY).toBe(15000);
    const pending = managed.waitReady(30000, 5000);
    await vi.advanceTimersByTimeAsync(BaseJob.DEFAULT_HOSTNAME_SETTLE_DELAY);
    await expect(pending).resolves.toBe(true);
    expect(health).toHaveBeenCalledTimes(1);

    health.mockClear();
    const immediate = managed.waitReady(30000, 5000, 0);
    await vi.runAllTimersAsync();
    await expect(immediate).resolves.toBe(true);
    expect(health).toHaveBeenCalledTimes(1);
  });
});

function fakeStreamHttp(): HTTPClient {
  return {
    baseUrl: 'https://api.hypercli.com',
    get: vi.fn().mockResolvedValue({
      job_id: 'job-1',
      job_key: 'job-key',
      state: 'running',
      gpu_type: 'l40s',
      gpu_count: 1,
      region: 'us',
      interruptible: true,
      price_per_hour: 1,
      price_per_second: 1 / 3600,
      docker_image: 'ubuntu',
      runtime: 600,
    }),
  } as unknown as HTTPClient;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(predicate()).toBe(true);
}
