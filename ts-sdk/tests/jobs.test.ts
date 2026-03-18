import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jobs } from '../src/jobs.js';
import type { HTTPClient } from '../src/http.js';

describe('Jobs API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
