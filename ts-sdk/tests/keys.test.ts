import { describe, expect, it, vi } from 'vitest';
import { KeysAPI } from '../src/keys.js';
import type { HTTPClient } from '../src/http.js';

describe('Keys SDK', () => {
  it('creates tagged API keys', async () => {
    const http = {
      post: vi.fn().mockResolvedValue({
        key_id: 'key-123',
        name: 'team-dev',
        tags: ['jobs:self', 'team=dev'],
        api_key: 'hyper_api_live',
        is_active: true,
        created_at: '2026-04-02T00:00:00Z',
      }),
    } as unknown as HTTPClient;

    const keys = new KeysAPI(http);
    const created = await keys.create('team-dev', ['jobs:self', 'team=dev']);

    expect(created.name).toBe('team-dev');
    expect(created.tags).toEqual(['jobs:self', 'team=dev']);
    expect(created.apiKey).toBe('hyper_api_live');
    expect((http.post as any).mock.calls[0]).toEqual([
      '/api/keys',
      { name: 'team-dev', tags: ['jobs:self', 'team=dev'] },
    ]);
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
