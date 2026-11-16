import { describe, expect, it, vi } from 'vitest';
import { Deployments, buildAgentConfig, canonicalSoul } from '../src/agents.js';
import type { HTTPClient } from '../src/http.js';

describe('Deployments.update', () => {
  it('sends persona selection/clear through PATCH without replacing canonical SOUL', async () => {
    const id = 'c75a1d4f-9f1e-4b2e-8d3a-2f0e1a9a0001';
    const patch = vi.fn().mockResolvedValue({ id, meta: { soul: 'canonical', persona: 'researcher' } });
    const deployments = new Deployments({ patch } as unknown as HTTPClient, 'test', 'https://api.test/agents');
    const agent = await deployments.update(id, { persona: 'researcher' });
    expect(patch).toHaveBeenLastCalledWith(`/deployments/${id}`, { persona: 'researcher' });
    expect(canonicalSoul(agent.meta)).toBe('canonical');
    await deployments.update(id, { persona: null });
    expect(patch).toHaveBeenLastCalledWith(`/deployments/${id}`, { persona: null });
    expect(canonicalSoul({ soul: '', ui: { soul: 'legacy' } })).toBe('');
    expect(canonicalSoul({ soul: null, ui: { soul: 'legacy' } })).toBe('');
    expect(canonicalSoul({ ui: { soul: 'legacy' } })).toBe('legacy');
  });
  it('passes canonical soul and role through create and PATCH, including explicit null clears', async () => {
    const id = 'c75a1d4f-9f1e-4b2e-8d3a-2f0e1a9a0001';
    const meta = { soul: '# SOUL', persona: 'researcher', role: '  Research  ', ui: { avatar: { icon_index: 2 } } };
    const post = vi.fn().mockResolvedValue({ id, runtime: 'opencode', meta });
    const patch = vi.fn().mockResolvedValue({ id, meta: { ui: { avatar: { icon_index: 2 } } } });
    const deployments = new Deployments(
      { post, patch } as unknown as HTTPClient,
      'test',
      'https://api.test/agents',
    );
    const agent = await deployments.createCodingAgent('opencode', { meta });
    expect(post.mock.calls[0][1].meta).toEqual(meta);
    expect(agent.meta?.soul).toBe('# SOUL');
    expect(agent.meta?.role).toBe('  Research  ');
    await deployments.update(id, { soul: null, role: null });
    expect(patch).toHaveBeenCalledExactlyOnceWith(`/deployments/${id}`, { soul: null, role: null });
  });

  it('creates instructions alongside avatar metadata using the existing create contract', async () => {
    const meta = { ui: { description: '# SOUL', avatar: { icon_index: 2 } } };
    const post = vi.fn().mockResolvedValue({ id: 'a', runtime: 'opencode', meta });
    const deployments = new Deployments({ post } as unknown as HTTPClient, 'test', 'https://api.test/agents');
    const agent = await deployments.createCodingAgent('opencode', { meta });
    expect(post.mock.calls[0][1].meta).toEqual(meta);
    expect(agent.meta?.ui?.description).toBe('# SOUL');
  });
  it('round-trips server description and explicitly clears it without meta replacement', async () => {
    const id = 'c75a1d4f-9f1e-4b2e-8d3a-2f0e1a9a0001';
    const patch = vi.fn().mockResolvedValue({ id, meta: { ui: { description: null, avatar: { icon_index: 2 } } } });
    const deployments = new Deployments({ patch } as unknown as HTTPClient, 'test', 'https://api.test/agents');
    const agent = await deployments.update(id, { ui: { description: null } });
    expect(patch).toHaveBeenCalledWith(`/deployments/${id}`, { ui: { description: null } });
    expect(agent.meta?.ui).toEqual({ description: null, avatar: { icon_index: 2 } });
  });
  it('sends docker null through the update payload to clear stored runner docker options', async () => {
    const agentId = 'c75a1d4f-9f1e-4b2e-8d3a-2f0e1a9a0001';
    const patch = vi.fn().mockResolvedValue({ id: agentId, state: 'STOPPED' });
    const deployments = new Deployments(
      { patch } as unknown as HTTPClient,
      'hyper_api_test',
      'https://api.test.hypercli.com/agents',
    );
    const { config: launchConfig } = buildAgentConfig({}, { docker: null });
    expect(launchConfig.docker).toBeNull();

    await deployments.update(agentId, { launchConfig });

    const [, body] = patch.mock.calls[0] as [string, Record<string, Record<string, unknown>>];
    expect(body.launch_config.docker).toBeNull();
  });

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

    const result = await deployments.resetRuntimeDefaults(agentId, { runtime: 'openclaw_acp' });

    expect(patch).toHaveBeenCalledWith(`/deployments/${agentId}`, {
      runtime: 'openclaw_acp',
      reset_image: true,
      launch_config: {},
    });
    // No public openclaw route exists post-cut: reset re-adds no route.
    expect(put).not.toHaveBeenCalledWith(
      expect.stringContaining('/routes/'),
      expect.anything(),
    );
    expect(patch).toHaveBeenCalledWith(
      `/deployments/${agentId}/env/OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN`,
      { value: '*' },
    );
    // Paired-device state is cleared too: a stale operator.pairing-only row in
    // openclaw.sqlite otherwise survives the reset and FORBIDs the re-paired
    // in-pod ACP client on operator.read/write. Legacy per-device records are
    // removed recursively as a directory (reef transport; runner forbids).
    expect(fileDelete.mock.calls.map(([, path, options]) => [path, options])).toEqual([
      ['.openclaw/openclaw.json', undefined],
      ['.openclaw/state/openclaw.sqlite', undefined],
      ['.openclaw/state/openclaw.sqlite-wal', undefined],
      ['.openclaw/state/openclaw.sqlite-shm', undefined],
      ['.openclaw/devices', { recursive: true }],
    ]);
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

    const result = await deployments.resetRuntimeDefaults(agentId, { runtime: 'hermes_acp' });

    expect(patch).toHaveBeenCalledWith(`/deployments/${agentId}`, {
      runtime: 'hermes_acp',
      reset_image: true,
      launch_config: {},
    });
    expect(put).not.toHaveBeenCalled();
    expect(fileDelete.mock.calls.map(([, path]) => path)).toEqual([
      '.hermes/config.yaml',
      '.hermes/mem0.json',
    ]);
    expect(result.droppedLaunchKeys).toEqual([]);
  });
});
