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

  it('resets OpenClaw runtime defaults with the backend empty-launch-config contract', async () => {
    const agentId = 'c75a1d4f-9f1e-4b2e-8d3a-2f0e1a9a0001';
    const patch = vi.fn().mockResolvedValue({
      id: agentId,
      runtime: 'openclaw',
      state: 'STOPPED',
      warnings: [{ code: 'unsupported_launch_config_keys_dropped', dropped_keys: ['config'] }],
    });
    const put = vi.fn().mockResolvedValue({ routes: {} });
    const get = vi.fn().mockResolvedValue({ id: agentId, runtime: 'openclaw', state: 'STOPPED' });
    const deployments = new Deployments(
      { patch, put, get } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const fileDelete = vi.spyOn(deployments, 'fileDelete').mockRejectedValue(new Error('not found'));

    const result = await deployments.resetRuntimeDefaults(agentId, { runtime: 'openclaw' });

    expect(patch).toHaveBeenCalledWith(`/deployments/${agentId}`, {
      runtime: 'openclaw',
      reset_image: true,
      launch_config: {},
    });
    expect(put).toHaveBeenCalledWith(
      `/deployments/${agentId}/routes/openclaw`,
      expect.objectContaining({ port: 18789, auth: false }),
    );
    expect(patch).toHaveBeenCalledWith(
      `/deployments/${agentId}/env/OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN`,
      { value: '*' },
    );
    expect(fileDelete).toHaveBeenCalledWith(agentId, '.openclaw/openclaw.json');
    expect(get).toHaveBeenCalledWith(`/deployments/${agentId}`);
    expect(result.droppedLaunchKeys).toEqual(['config']);
    expect(result.agent.id).toBe(agentId);
  });

  it('resets Hermes runtime defaults without touching the whole .hermes directory', async () => {
    const agentId = 'c75a1d4f-9f1e-4b2e-8d3a-2f0e1a9a0001';
    const patch = vi.fn().mockResolvedValue({ id: agentId, runtime: 'hermes-agent', state: 'STOPPED' });
    const put = vi.fn().mockResolvedValue({ routes: {} });
    const get = vi.fn().mockResolvedValue({ id: agentId, runtime: 'hermes-agent', state: 'STOPPED' });
    const deployments = new Deployments(
      { patch, put, get } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const fileDelete = vi.spyOn(deployments, 'fileDelete').mockResolvedValue({ status: 'ok' });

    const result = await deployments.resetRuntimeDefaults(agentId, { runtime: 'hermes-agent' });

    expect(patch).toHaveBeenCalledWith(`/deployments/${agentId}`, {
      runtime: 'hermes-agent',
      reset_image: true,
      launch_config: {},
    });
    expect(put).toHaveBeenCalledWith(
      `/deployments/${agentId}/routes/hermes`,
      expect.objectContaining({ port: 8642, auth: false }),
    );
    expect(fileDelete.mock.calls.map(([, path]) => path)).toEqual([
      '.hermes/config.yaml',
      '.hermes/mem0.json',
    ]);
    expect(result.droppedLaunchKeys).toEqual([]);
  });
});
