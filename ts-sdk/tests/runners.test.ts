import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveRunnersApiBase, RunnersAPI } from '../src/runners.js';
import type { Runner } from '../src/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const runnerWire = {
  runner_id: 'ab72fe95-8821-40ab-978c-158890c162aa',
  owner_user_id: 'user-1',
  name: 'workstation',
  tags: ['linux', 'gpu'],
  platform: { os: 'linux', arch: 'x86_64' },
  version: '0.1.0',
  created_at: '2026-09-08T10:00:00Z',
  last_seen_at: '2026-09-09T09:00:00Z',
  disconnected_at: null,
  meta: { ui: { display_name: 'Build box' } },
  connected: true,
  ready: false,
  connection_scope: 'current_backend_instance',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Runners SDK', () => {
  it('derives the runners API base under the agents API base', () => {
    expect(deriveRunnersApiBase('https://api.hypercli.com/agents')).toBe('https://api.hypercli.com/agents/runners');
    expect(deriveRunnersApiBase('https://api.hypercli.com/agents/runners')).toBe('https://api.hypercli.com/agents/runners');
  });

  it('lists runners with normalized fields including meta.ui.displayName', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([runnerWire]));
    vi.stubGlobal('fetch', fetchMock);

    const api = new RunnersAPI('key', { apiBase: 'http://agents.test/agents/runners' });
    const runners = await api.list();

    expect(runners).toHaveLength(1);
    expect(runners[0]).toMatchObject({
      runnerId: runnerWire.runner_id,
      ownerUserId: 'user-1',
      name: 'workstation',
      tags: ['linux', 'gpu'],
      platform: { os: 'linux', arch: 'x86_64' },
      connected: true,
      ready: false,
      connectionScope: 'current_backend_instance',
      meta: { ui: { displayName: 'Build box' } },
    });
    expect(fetchMock.mock.calls[0][0]).toBe('http://agents.test/agents/runners');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer key' }),
    });
  });

  it('tolerates runners without meta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...runnerWire, meta: null }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new RunnersAPI('key', { apiBase: 'http://agents.test/agents/runners' });
    const runner: Runner = await api.get(runnerWire.runner_id);

    expect(runner.meta).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe(`http://agents.test/agents/runners/${runnerWire.runner_id}`);
  });

  it('updates meta.ui.display_name with a snake_case PATCH body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(runnerWire));
    vi.stubGlobal('fetch', fetchMock);

    const api = new RunnersAPI('key', { apiBase: 'http://agents.test/agents/runners' });
    const runner = await api.update(runnerWire.runner_id, { ui: { displayName: 'Build box' } });

    expect(runner.meta?.ui?.displayName).toBe('Build box');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ ui: { display_name: 'Build box' } }),
    });
  });

  it('sends JSON null to clear the display name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...runnerWire, meta: { ui: { display_name: null } } }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new RunnersAPI('key', { apiBase: 'http://agents.test/agents/runners' });
    await api.update(runnerWire.runner_id, { ui: { displayName: null } });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ ui: { display_name: null } }),
    });
  });
});
