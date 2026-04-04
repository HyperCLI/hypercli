import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jobs } from '../src/jobs.js';
import type { HTTPClient } from '../src/http.js';

describe('Jobs API', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
});
