import { describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';

describe('Jobs API', () => {
  const client = new HyperCLI();
  let createdJobId: string | undefined;

  it('should list jobs', async () => {
    const jobs = await client.jobs.list();
    expect(Array.isArray(jobs)).toBe(true);
  });

  it('should create a minimal job', async () => {
    const job = await client.jobs.create({
      image: 'nvidia/cuda:12.0-base-ubuntu22.04',
      gpuType: 'l4',
      command: 'echo hello && sleep 10',
      runtime: 60,
    });

    expect(job).toBeDefined();
    expect(job.jobId).toBeDefined();
    expect(job.gpuType.toLowerCase()).toBe('l4');
    
    createdJobId = job.jobId;
  }, 60000); // 60s timeout for job creation

  it('should get created job by ID', async () => {
    if (!createdJobId) {
      throw new Error('No job created in previous test');
    }

    const job = await client.jobs.get(createdJobId);
    
    expect(job).toBeDefined();
    expect(job.jobId).toBe(createdJobId);
    expect(job.gpuType.toLowerCase()).toBe('l4');
  });

  it('should get job metrics', async () => {
    if (!createdJobId) {
      throw new Error('No job created in previous test');
    }

    // Metrics may only be available for running jobs
    try {
      const metrics = await client.jobs.metrics(createdJobId);
      expect(metrics).toBeDefined();
    } catch (error: any) {
      // Job might be queued/completed, metrics only available when running
      expect(error.message).toMatch(/queued|completed|metrics only available/i);
    }
  });

  it('should cancel the job', async () => {
    if (!createdJobId) {
      throw new Error('No job created in previous test');
    }

    await client.jobs.cancel(createdJobId);
    
    // Verify job is canceled
    const job = await client.jobs.get(createdJobId);
    expect(['canceled', 'cancelled', 'canceling', 'cancelling']).toContain(job.state.toLowerCase());
  });
});
