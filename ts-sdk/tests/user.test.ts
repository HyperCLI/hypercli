import { describe, it, expect, vi } from 'vitest';
import { HyperCLI } from '../src/client.js';
import { UserAPI } from '../src/user.js';
import type { HTTPClient } from '../src/http.js';

describe('account markdown', () => {
  it('reads canonical profile first and uses the public profile API for get/set/clear', async () => {
    const data = {
      user_id: 'owner',
      meta: JSON.stringify({ profile: '# Canonical', billing: { keep: true }, ui: { profile: '# Legacy' } }),
    };
    const profileResponse = {
      id: 'owner', avatar_url: null, display_name: 'Ned', profile: '# Canonical',
    };
    const get = vi.fn(async (path: string) => path === '/users/profile' ? profileResponse : data);
    const patch = vi.fn().mockResolvedValue(profileResponse);
    const api = new UserAPI({ get, patch } as unknown as HTTPClient);
    expect((await api.get()).profile).toBe('# Canonical');
    expect((await api.get()).ui.profile).toBe('# Canonical');
    expect(await api.getProfile()).toEqual({
      id: 'owner', avatarUrl: null, displayName: 'Ned', profile: '# Canonical',
    });
    await api.updateProfile(null);
    expect(patch).toHaveBeenCalledExactlyOnceWith('/users/profile', { profile: null });
    await api.update({ name: 'Ada' });
    expect(patch).toHaveBeenLastCalledWith('/api/user', { name: 'Ada' });
    await api.update({ profile: null });
    expect(patch).toHaveBeenLastCalledWith('/api/user', { profile: null });
  });

  it('falls back to legacy ui.profile only when the canonical key is absent', async () => {
    const api = new UserAPI({
      get: vi.fn().mockResolvedValue({ meta: JSON.stringify({ ui: { profile: '# Legacy' } }) }),
    } as unknown as HTTPClient);
    expect((await api.get()).profile).toBe('# Legacy');
  });

  it.each([null, 'invalid', '[]', '{"ui":{"profile":42}}'])('tolerates malformed metadata %s', async (meta) => {
    const api = new UserAPI({ get: vi.fn().mockResolvedValue({ meta }) } as unknown as HTTPClient);
    expect((await api.get()).ui).toEqual({});
    expect((await api.get()).profile).toBeUndefined();
  });
});

describe('User API', () => {
  const liveIt = process.env.HYPER_API_KEY ? it : it.skip;
  let client: HyperCLI;

  function getClient(): HyperCLI {
    if (!client) client = new HyperCLI({ apiKey: process.env.HYPER_API_KEY });
    return client;
  }

  liveIt('should get user info', async () => {
    const user = await getClient().user.get();

    expect(user).toBeDefined();
    expect(user.userId).toBeDefined();
    expect(typeof user.userId).toBe('string');
    if (user.email !== null) {
      expect(user.email).not.toBeNull();
    }
  });
});
