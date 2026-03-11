import { beforeEach, describe, expect, it, vi } from 'vitest';

const wsState = vi.hoisted(() => ({ wsInstances: [] as any[] }));

vi.mock('ws', () => {
  class MockWebSocket {
    public readonly url: string;
    private handlers: Record<string, Array<(...args: any[]) => void>> = {};

    constructor(url: string) {
      this.url = url;
      wsState.wsInstances.push(this);
      queueMicrotask(() => this.emit('open'));
    }

    on(event: string, cb: (...args: any[]) => void) {
      this.handlers[event] = this.handlers[event] || [];
      this.handlers[event].push(cb);
    }

    once(event: string, cb: (...args: any[]) => void) {
      const wrapped = (...args: any[]) => {
        this.off(event, wrapped);
        cb(...args);
      };
      this.on(event, wrapped);
    }

    off(event: string, cb: (...args: any[]) => void) {
      this.handlers[event] = (this.handlers[event] || []).filter(h => h !== cb);
    }

    emit(event: string, ...args: any[]) {
      for (const cb of this.handlers[event] || []) cb(...args);
    }
  }
  return { default: MockWebSocket };
});

import { Jobs } from '../src/jobs.js';
import { Agents } from '../src/agents.js';

describe('Exec/Shell/DryRun integration (mock)', () => {
  beforeEach(() => {
    wsState.wsInstances.length = 0;
    vi.restoreAllMocks();
  });

  it('jobs.create sends dry_run payload', async () => {
    const post = vi.fn().mockResolvedValue({
      job_id: 'job-123',
      job_key: 'jk',
      state: 'validated',
      gpu_type: 'l40s',
      gpu_count: 1,
      region: 'us-east-1',
      interruptible: true,
      price_per_hour: 1.2,
      price_per_second: 0.0003,
      docker_image: 'nvidia/cuda',
      runtime: 300,
      cold_boot: false,
    });
    const jobs = new Jobs({ post, get: vi.fn() } as any);

    await jobs.create({
      image: 'nvidia/cuda',
      command: 'echo hi',
      dryRun: true,
    });

    const [, payload] = post.mock.calls[0];
    expect(payload.dry_run).toBe(true);
    expect(payload.command).toBeTypeOf('string');
  });

  it('jobs.exec calls /api/jobs/{id}/exec and maps response', async () => {
    const post = vi.fn().mockResolvedValue({
      job_id: 'job-123',
      stdout: 'ok\n',
      stderr: '',
      exit_code: 0,
    });
    const jobs = new Jobs({ post, get: vi.fn() } as any);

    const result = await jobs.exec('job-123', 'echo ok', 15);

    expect(post).toHaveBeenCalledWith('/api/jobs/job-123/exec', { command: 'echo ok', timeout: 15 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok\n');
  });

  it('jobs.shellConnect builds websocket URL from API base', async () => {
    const get = vi.fn().mockResolvedValue({
      job_id: 'job-123',
      job_key: 'job-key-xyz',
      state: 'running',
      gpu_type: 'l40s',
      gpu_count: 1,
      region: 'oh',
      interruptible: true,
      price_per_hour: 1.0,
      price_per_second: 0.1,
      docker_image: 'x',
      runtime: 1,
    });
    const jobs = new Jobs({ get, baseUrl: 'https://api.hypercli.com/api' } as any);

    const ws = await jobs.shellConnect('job-123', '/bin/sh');

    expect(ws).toBeDefined();
    expect(wsState.wsInstances[0].url).toBe(
      'wss://api.hypercli.com/orchestra/ws/shell/job-123?token=job-key-xyz&shell=%2Fbin%2Fsh'
    );
  });

  it('agents.exec posts command for HyperClaw containers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ exit_code: 0, stdout: 'done', stderr: '' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const agents = new Agents({ apiKey: 'hyper_api_x' } as any, 'sk-claw', 'https://api.hypercli.com');

    const result = await agents.exec('agent-1', 'ls', 20);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.hypercli.com/api/agents/agent-1/exec',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('done');
  });

  it('agents.shellConnect fetches token then connects websocket', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'jwt-abc' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const agents = new Agents({ apiKey: 'hyper_api_x' } as any, 'sk-claw', 'https://api.hypercli.com');

    const ws = await agents.shellConnect('agent-1');

    expect(ws).toBeDefined();
    expect(wsState.wsInstances[0].url).toBe('wss://api.hypercli.com/ws/shell/agent-1?jwt=jwt-abc');
  });
});
