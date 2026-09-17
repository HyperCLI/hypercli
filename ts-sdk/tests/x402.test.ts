import { afterEach, describe, expect, it, vi } from 'vitest';
import { X402Client } from '../src/x402.js';

const signer = {
  address: '0x0000000000000000000000000000000000000001',
  signTypedData: async () => '0xsigned',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('X402Client.createJob', () => {
  it('POSTs a flat JobCreateRequest to /api/x402/job (no amount/job wrapper)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          job: { job_id: 'job-1', job_key: 'key', state: 'starting', runtime: 3600 },
          access_key: 'access',
          status_url: 'https://example.com/status',
          logs_url: 'https://example.com/logs',
          cancel_url: 'https://example.com/cancel',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new X402Client('http://x402.test');
    const launch = await client.createJob({
      amount: 1.25,
      signer,
      image: 'repo/image:tag',
      command: 'echo hi',
      gpuType: 'l40s',
    });

    expect(launch.job.jobId).toBe('job-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://x402.test/api/x402/job');
    expect(init.method).toBe('POST');
    const payload = JSON.parse(String(init.body));
    expect(payload.docker_image).toBe('repo/image:tag');
    expect(payload.gpu_type).toBe('l40s');
    expect(payload.command).toBe(Buffer.from('echo hi', 'utf8').toString('base64'));
    // Flat JobCreateRequest: pricing comes from the x402 payment challenge.
    expect(payload).not.toHaveProperty('amount');
    expect(payload).not.toHaveProperty('job');
  });
});
