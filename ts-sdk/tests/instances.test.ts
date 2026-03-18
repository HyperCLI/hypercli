import { afterEach, describe, expect, it, vi } from 'vitest';
import { Instances } from '../src/instances.js';
import type { HTTPClient } from '../src/http.js';

describe('Instances API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves constraints on GPU configs', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        h200: {
          name: 'H200',
          description: 'NVIDIA H200 141GB SXM',
          configs: [
            {
              gpu_count: 8,
              cpu_cores: 192,
              memory_gb: 1536,
              storage_gb: 7680,
              regions: ['br'],
              constraints: { cpu_vendor: 'intel' },
            },
          ],
        },
      }),
    } as unknown as HTTPClient;

    const types = await new Instances(http).types(true);

    expect(types.h200.configs[0].constraints).toEqual({ cpu_vendor: 'intel' });
  });
});
