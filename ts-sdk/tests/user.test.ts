import { describe, it, expect, vi } from 'vitest';
import { HyperCLI } from '../src/client.js';
import { UserAPI } from '../src/user.js';
import type { HTTPClient } from '../src/http.js';

describe('account markdown', () => {
  it('maps metadata and PATCHes only the typed field, including clear', async () => {
    const data = { user_id: 'owner', meta: JSON.stringify({ billing: { keep: true }, ui: { profile: '# Me' } }) };
    const get = vi.fn().mockResolvedValue(data);
    const patch = vi.fn().mockResolvedValue(data);
    const api = new UserAPI({ get, patch } as unknown as HTTPClient);
    expect((await api.get()).ui.profile).toBe('# Me');
    await api.updateProfile(null);
    expect(patch).toHaveBeenCalledExactlyOnceWith('/api/user', { ui: { profile: null } });
    await api.update({ name: 'Ada' });
    expect(patch).toHaveBeenLastCalledWith('/api/user', { name: 'Ada' });
  });
  it.each([null, 'invalid', '[]', '{"ui":{"profile":42}}'])('tolerates legacy metadata %s', async (meta) => {
    const api = new UserAPI({ get: vi.fn().mockResolvedValue({ meta }) } as unknown as HTTPClient);
    expect((await api.get()).ui).toEqual({});
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
    // email can be null or string
    if (user.email !== null) {
      expect(typeof user.email).toBe('string');
    }
  });
});
