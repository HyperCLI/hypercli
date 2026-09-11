import { describe, expect, it, vi } from 'vitest';
import { Deployments } from '../src/agents.js';
import type { HTTPClient } from '../src/http.js';

describe('Deployments.update', () => {
  it('PATCHes the agents deployments endpoint with only supported fields', async () => {
    const patch = vi.fn().mockResolvedValue({ id: 'c75a1d4f-9f1e-4b2e-8d3a-2f0e1a9a0001', state: 'RUNNING' });
    const deployments = new Deployments(
      { patch } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.update('c75a1d4f-9f1e-4b2e-8d3a-2f0e1a9a0001', {
      name: 'demo',
      size: 'large',
      refreshFromLagoon: true,
      error: null,
    });

    expect(patch).toHaveBeenCalledTimes(1);
    const [path, body] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/deployments/c75a1d4f-9f1e-4b2e-8d3a-2f0e1a9a0001');
    expect(body).toEqual({ name: 'demo', size: 'large' });
    expect(body).not.toHaveProperty('refresh_from_lagoon');
    expect(body).not.toHaveProperty('error');
  });

  it('maps runtime and resetImage to the backend wire fields', async () => {
    const patch = vi.fn().mockResolvedValue({ id: 'c75a1d4f-9f1e-4b2e-8d3a-2f0e1a9a0001', state: 'STOPPED' });
    const deployments = new Deployments(
      { patch } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );

    await deployments.update('c75a1d4f-9f1e-4b2e-8d3a-2f0e1a9a0001', {
      runtime: 'openclaw',
      resetImage: true,
    });

    const [, body] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toEqual({ runtime: 'openclaw', reset_image: true });
  });
});
