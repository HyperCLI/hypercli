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

  it('ignores a stale namespace env override in favor of the supplied agents base', () => {
    process.env.HYPER_INTEGRATIONS_API_BASE = 'http://localhost:9000/integrations';
    expect(deriveIntegrationsApiBase('https://selected.example/agents')).toBe(
      'https://selected.example/integrations',
    );
  });
});

describe('IntegrationsAPI', () => {
  it('uses optional connection selectors without stealing provider query parameters', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new IntegrationsAPI('key', { apiBase: 'http://integrations.test/integrations' });
    await api.proxy('notion', '/v1/search?connection_id=provider-param', {
      connectionId: 'owned-connection', headers: { 'Notion-Version': '2022-06-28' },
    });
    expect(fetchMock.mock.calls[0][0]).toContain('?connection_id=provider-param');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer key', 'X-HyperCLI-Connection-Id': 'owned-connection', 'Nango-Proxy-Notion-Version': '2022-06-28',
    });
    await api.disconnect('notion', 'owned/connection');
    expect(fetchMock.mock.calls[1][0]).toContain('/connections/notion?connection_id=owned%2Fconnection');
  });

  it('returns native multi-field credentials and imports without provider adapters', async () => {
    const native = { type: 'OAUTH1', oauth_token: 'synthetic', oauth_token_secret: 'synthetic' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ provider: 'fourth', connection_id: 'c1', credentials: native, stack: 'dev' }))
      .mockResolvedValueOnce(jsonResponse({ connection: { connection_id: 'c2', enabled: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new IntegrationsAPI('key', { apiBase: 'http://integrations.test/integrations' });
    expect((await api.credentials('fourth', 'c1')).credentials).toEqual(native);
    expect(fetchMock.mock.calls[0][0]).toContain('/credentials/fourth?connection_id=c1');
    expect((await api.importConnection('fourth', native, { connectionConfig: { tenant: 'example' } })).id).toBe('c2');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ credentials: native, connection_config: { tenant: 'example' } });
  });

  it('preserves multiple connections and non-JSON proxy responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ connections: { fourth: { connected: true, connection: null,
        connections: [{ connection_id: 'c1', enabled: true }, { connection_id: 'c2', enabled: false }] } } }))
      .mockResolvedValueOnce(new Response('plain text', { headers: { 'Content-Type': 'text/plain' } }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new IntegrationsAPI('key', { apiBase: 'http://integrations.test/integrations' });
    const rows = await api.listConnections();
    expect(rows[0].connection).toBeNull();
    expect(rows[0].connections?.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(await api.proxy('fourth', 'text')).toBe('plain text');
  });

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
