import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveIntegrationsApiBase, IntegrationsAPI } from '../src/integrations.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.HYPER_INTEGRATIONS_API_BASE;
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('deriveIntegrationsApiBase', () => {
  it('derives the prod integrations base from the default agents base', () => {
    delete process.env.HYPER_INTEGRATIONS_API_BASE;
    expect(deriveIntegrationsApiBase('https://api.hypercli.com/agents')).toBe(
      'https://api.hypercli.com/integrations',
    );
  });

  it('strips the /agents suffix from an agents base', () => {
    expect(deriveIntegrationsApiBase('https://api.agents.dev.hypercli.com/agents')).toBe(
      'https://api.agents.dev.hypercli.com/integrations',
    );
    expect(deriveIntegrationsApiBase('https://api.dev.hypercli.com/agents/')).toBe(
      'https://api.dev.hypercli.com/integrations',
    );
  });

  it('env override wins and is left untouched when it already ends in /integrations', () => {
    process.env.HYPER_INTEGRATIONS_API_BASE = 'http://localhost:9000/integrations';
    expect(deriveIntegrationsApiBase('https://ignored.example/agents')).toBe(
      'http://localhost:9000/integrations',
    );
  });
});

describe('IntegrationsAPI', () => {
  it('requires an API key', () => {
    expect(() => new IntegrationsAPI('', { apiBase: 'http://x' })).toThrow('API key required');
  });

  it('mintToken posts with bearer auth and maps snake_case fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        provider: 'github',
        access_token: 'gho_secret',
        expires_at: '2026-10-01T00:00:00Z',
        stack: 'prod',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new IntegrationsAPI('key', { apiBase: 'http://integrations.test/integrations' });
    const token = await api.mintToken('github');

    expect(fetchMock.mock.calls[0][0]).toBe('http://integrations.test/integrations/token/github');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer key',
        'Content-Type': 'application/json',
      }),
    });
    expect(token).toEqual({
      provider: 'github',
      accessToken: 'gho_secret',
      expiresAt: '2026-10-01T00:00:00Z',
      stack: 'prod',
    });
  });

  it('proxy passes method, encoded path, and query params through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new IntegrationsAPI('key', { apiBase: 'http://integrations.test/integrations' });
    const result = await api.proxy('github', 'repos/octocat/Hello-World/issues', {
      method: 'post',
      body: { title: 'hi' },
      query: { state: 'open' },
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://integrations.test/integrations/proxy/github/repos/octocat/Hello-World/issues?state=open',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ title: 'hi' }),
    });
  });

  it('listConnections normalizes the keyed connections map', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        connections: {
          github: {
            name: 'github',
            provider_id: 'github',
            display_name: 'GitHub',
            auth: 'oauth2',
            modes: ['token', 'proxy'],
            backend: 'nango',
            icon_url: '/integrations/icons/github.svg',
            connected: true,
            backend_available: true,
            connection: { connection_id: 'conn_1', created_at: '2026-09-01T00:00:00Z', enabled: false },
          },
          slack: {
            name: 'slack',
            provider_id: 'slack',
            display_name: 'Slack',
            auth: 'oauth2',
            modes: [],
            backend: 'relay',
            icon_url: '/integrations/icons/slack.svg',
            connected: false,
            backend_available: false,
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new IntegrationsAPI('key', { apiBase: 'http://integrations.test/integrations' });
    const connections = await api.listConnections();

    expect(fetchMock.mock.calls[0][0]).toBe('http://integrations.test/integrations/connections');
    expect(connections).toHaveLength(2);
    expect(connections[0]).toMatchObject({
      name: 'github',
      displayName: 'GitHub',
      modes: ['token', 'proxy'],
      connected: true,
      backendAvailable: true,
      connection: { id: 'conn_1', hyperEnabled: false, createdAt: '2026-09-01T00:00:00Z' },
    });
    expect(connections[1]).toMatchObject({
      name: 'slack',
      backend: 'relay',
      connected: false,
      backendAvailable: false,
      connection: null,
    });
  });

  it('surfaces relay 400 detail verbatim as APIError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ detail: 'Slack is managed by the HyperCLI Slack relay' }, 400),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new IntegrationsAPI('key', { apiBase: 'http://integrations.test/integrations' });
    await expect(api.disconnect('slack')).rejects.toMatchObject({
      statusCode: 400,
      detail: 'Slack is managed by the HyperCLI Slack relay',
    });
  });
});
