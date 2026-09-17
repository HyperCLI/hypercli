import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueApiKeyFromJwt, KeysAPI } from '../src/keys.js';
import type { HTTPClient } from '../src/http.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Keys SDK', () => {
  it('issues a scoped key with the JWT used only for canonical key creation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      key_id: 'key-issued',
      name: 'job-key',
      tags: ['jobs:self'],
      api_key: 'hyper_api_issued',
      is_active: true,
      created_at: '2026-08-08T00:00:00Z',
      expires_at: '2026-08-09T00:00:00Z',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);

    const issued = await issueApiKeyFromJwt(' user-jwt ', {
      apiUrl: 'https://api.example.test/',
      name: 'job-key',
      tags: ['jobs:self'],
      duration: '1h',
      expiresAt: '2026-08-09T00:00:00Z',
      timeout: 12000,
    });

    expect(issued.apiKey).toBe('hyper_api_issued');
    expect(issued.tags).toEqual(['jobs:self']);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/api/keys');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer user-jwt',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'job-key',
      tags: ['jobs:self'],
      duration: '1h',
      expires_at: '2026-08-09T00:00:00Z',
    });
  });

  it('rejects an empty JWT before issuing a request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(issueApiKeyFromJwt('   ', { tags: ['jobs:self'] })).rejects.toThrow('JWT required');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an issuance response without the key secret', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      key_id: 'key-masked',
      name: 'job-key',
      tags: ['jobs:self'],
      is_active: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(issueApiKeyFromJwt('user-jwt', {
      apiUrl: 'https://api.example.test',
      tags: ['jobs:self'],
    })).rejects.toThrow('API key issue response did not include the key secret');
  });

  it('creates tagged API keys', async () => {
    const http = {
      post: vi.fn().mockResolvedValue({
        key_id: 'key-123',
        name: 'team-dev',
        tags: ['jobs:self', 'team=dev'],
        api_key: 'hyper_api_live',
        is_active: true,
        created_at: '2026-04-02T00:00:00Z',
        expires_at: '2026-10-01T00:00:00Z',
      }),
    } as unknown as HTTPClient;

    const keys = new KeysAPI(http);
    const created = await keys.create('team-dev', ['jobs:self', 'team=dev'], { duration: '180d' });

    expect(created.name).toBe('team-dev');
    expect(created.tags).toEqual(['jobs:self', 'team=dev']);
    expect(created.apiKey).toBe('hyper_api_live');
    expect(created.expiresAt).toBe('2026-10-01T00:00:00Z');
    expect((http.post as any).mock.calls[0]).toEqual([
      '/api/keys',
      { name: 'team-dev', tags: ['jobs:self', 'team=dev'], duration: '180d' },
    ]);
  });

  it('normalizes alternate create response field names', async () => {
    const http = {
      post: vi.fn().mockResolvedValue({
        id: 'key-456',
        name: 'team-ops',
        tags: ['*:*'],
        key: 'hyper_api_live_alias',
        preview: 'hyper_api_****lias',
        active: true,
        createdAt: '2026-05-26T00:00:00Z',
        lastUsedAt: '2026-05-26T01:00:00Z',
        expiresAt: '2026-11-22T00:00:00Z',
      }),
    } as unknown as HTTPClient;

    const keys = new KeysAPI(http);
    const created = await keys.create('team-ops', ['*:*']);

    expect(created).toEqual(expect.objectContaining({
      keyId: 'key-456',
      name: 'team-ops',
      tags: ['*:*'],
      apiKey: 'hyper_api_live_alias',
      apiKeyPreview: 'hyper_api_****lias',
      isActive: true,
      createdAt: '2026-05-26T00:00:00Z',
      lastUsedAt: '2026-05-26T01:00:00Z',
      expiresAt: '2026-11-22T00:00:00Z',
    }));
  });

  it('lists masked API keys', async () => {
    const http = {
      get: vi.fn().mockResolvedValue([
        {
          key_id: 'key-123',
          name: 'team-dev',
          tags: ['jobs:self'],
          api_key_preview: 'hyper_api_abcd****1234',
          last4: '1234',
          is_active: true,
          created_at: '2026-04-02T00:00:00Z',
          last_used_at: '2026-04-02T01:00:00Z',
        },
      ]),
    } as unknown as HTTPClient;

    const keys = new KeysAPI(http);
    const listed = await keys.list();

    expect(listed).toHaveLength(1);
    expect(listed[0]?.apiKey).toBeNull();
    expect(listed[0]?.apiKeyPreview).toContain('****');
    expect(listed[0]?.tags).toEqual(['jobs:self']);
  });

  it('normalizes numeric API key timestamps returned by the live API', async () => {
    const http = {
      get: vi.fn().mockResolvedValue([
        {
          key_id: 'key-live-shape',
          name: 'Buzz',
          tags: ['*:*'],
          is_active: true,
          created_at: 1785477645.683563,
          last_used_at: 1785514386.193904,
          expires_at: 1785542922365,
        },
      ]),
    } as unknown as HTTPClient;

    const [key] = await new KeysAPI(http).list();

    expect(key?.createdAt).toBe('2026-07-31T06:00:45.683Z');
    expect(key?.lastUsedAt).toBe('2026-07-31T16:13:06.193Z');
    expect(key?.expiresAt).toBe('2026-08-01T00:08:42.365Z');
  });

  it('gets and renames a key', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        key_id: 'key-123',
        name: 'team-dev',
        tags: ['jobs:self'],
        api_key_preview: 'hyper_api_abcd****1234',
        is_active: true,
        created_at: '2026-04-02T00:00:00Z',
      }),
      patch: vi.fn().mockResolvedValue({
        key_id: 'key-123',
        name: 'team-ops',
        tags: ['jobs:self'],
        api_key_preview: 'hyper_api_abcd****1234',
        is_active: true,
        created_at: '2026-04-02T00:00:00Z',
      }),
    } as unknown as HTTPClient;

    const keys = new KeysAPI(http);
    const fetched = await keys.get('key-123');
    const renamed = await keys.rename('key-123', 'team-ops');

    expect(fetched.name).toBe('team-dev');
    expect(renamed.name).toBe('team-ops');
    expect((http.patch as any).mock.calls[0]).toEqual([
      '/api/keys/key-123',
      { name: 'team-ops' },
    ]);
  });

  it('disables a key', async () => {
    const http = {
      delete: vi.fn().mockResolvedValue({ status: 'deactivated', key_id: 'key-123' }),
    } as unknown as HTTPClient;

    const keys = new KeysAPI(http);
    const result = await keys.disable('key-123');

    expect(result.status).toBe('deactivated');
    expect((http.delete as any).mock.calls[0][0]).toBe('/api/keys/key-123');
  });
});
