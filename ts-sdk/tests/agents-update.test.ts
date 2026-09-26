import { describe, expect, it, vi } from 'vitest';
import { Agent, Deployments, buildAgentConfig } from '../src/agents.js';
import { projectManagedContext, MANAGED_CONTEXT_PATHS } from '../src/index.js';
import type { HTTPClient } from '../src/http.js';

describe('Deployments.update', () => {
  it('creates instructions alongside avatar metadata using the existing create contract', async () => {
    const meta = { ui: { description: '# SOUL', avatar: { icon_index: 2 } } };
    const post = vi.fn().mockResolvedValue({ id: 'a', runtime: 'opencode', meta });
    const deployments = new Deployments({ post } as unknown as HTTPClient, 'test', 'https://api.test/agents');
    const agent = await deployments.createOpenCode({ meta });
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

describe('managed context projection', () => {
  function setup(overrides = {}) {
    const files = new Map<string, string>();
    const api = {
      waitForFileApiReady: vi.fn().mockResolvedValue(undefined),
      filesList: vi.fn(async (_agent, path) => path === ''
        ? [{ name: '.hypercli', type: 'directory' }]
        : [...files.keys()].map((path) => ({ name: path.split('/')[1], type: 'file' }))),
      fileRead: vi.fn(async (_agent, path) => files.get(path)),
      fileWrite: vi.fn(async (_agent, path, text) => { files.set(path, text); return {}; }),
    };
    const agent = Agent.fromDict({ id: 'a', user_id: 'owner', state: 'STOPPED', ...overrides });
    const run = (context = { profile: 'About me', description: 'Be useful' }, owner = 'owner') =>
      projectManagedContext(api as unknown as Deployments, agent, owner, context);
    return { api, files, run };
  }
  it('writes exact managed files, refreshes intact projections, and preserves edited files', async () => {
    const { run, files, api } = setup();
    expect((await run()).map((r) => r.status)).toEqual(['written', 'written']);
    expect([...files.keys()]).toEqual([...MANAGED_CONTEXT_PATHS]);
    expect((await run()).map((r) => r.status)).toEqual(['unchanged', 'unchanged']);
    files.set('.hypercli/SOUL.md', files.get('.hypercli/SOUL.md') + '\nUser edit');
    expect((await run({ profile: 'New me', description: 'New instructions' })).map((r) => r.status)).toEqual(['written', 'preserved']);
    expect(api.fileWrite).toHaveBeenCalledTimes(3);
  });
  it('preserves unmanaged files, including empty files', async () => {
    const { run, files, api } = setup();
    files.set('.hypercli/USER.md', 'My own profile');
    files.set('.hypercli/SOUL.md', '');
    expect((await run()).map((r) => r.status)).toEqual(['preserved', 'preserved']);
    expect(api.fileWrite).not.toHaveBeenCalled();
  });
  it.each([{ state: 'ARCHIVED' }, { state: 'CREATING' }])('never contacts Reef for unsupported targets %j', async (overrides) => {
    const { run, api } = setup(overrides);
    expect((await run()).every((r) => r.status === 'skipped')).toBe(true);
    expect(api.waitForFileApiReady).not.toHaveBeenCalled();
    expect(api.fileWrite).not.toHaveBeenCalled();
  });
  it('does not project viewer profiles into shared agents', async () => {
    const { run, api } = setup();
    await run(undefined, 'viewer');
    expect(api.waitForFileApiReady).not.toHaveBeenCalled();
    expect(api.fileWrite).not.toHaveBeenCalled();
  });
  it('reports persistence policy gaps without changing custom policy', async () => {
    const { run, api } = setup({ launch_config: { sync_include: ['.codex'] } });
    const result = await run();
    expect(result.every((r) => r.status === 'skipped' && r.detail?.includes('Persistence policy'))).toBe(true);
    expect(api.fileWrite).not.toHaveBeenCalled();
  });
  it('reports partial failures per file', async () => {
    const { run, api } = setup();
    api.fileWrite.mockRejectedValueOnce(new Error('storage unavailable'));
    expect((await run()).map((r) => r.status)).toEqual(['failed', 'written']);
  });
  it('reports readiness failure without writing files', async () => {
    const { run, api } = setup();
    api.waitForFileApiReady.mockRejectedValueOnce(new Error('not ready'));
    expect((await run()).every((r) => r.status === 'skipped' && r.detail?.includes('not ready'))).toBe(true);
    expect(api.fileWrite).not.toHaveBeenCalled();
  });
  it('distinguishes omitted and explicitly cleared profiles', async () => {
    const { api, files } = setup();
    const agent = Agent.fromDict({ id: 'a', user_id: 'owner', state: 'RUNNING' });
    const result = await projectManagedContext(api as unknown as Deployments, agent, 'owner', { description: null });
    expect(result.map((r) => r.status)).toEqual(['skipped', 'written']);
    expect(files.has('.hypercli/USER.md')).toBe(false);
    expect(files.get('.hypercli/SOUL.md')).toMatch(/-->\n$/);
  });
});
