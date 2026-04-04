import { describe, it, expect } from 'vitest';
import { UserAPI } from '../src/user.js';

describe('User auth me API', () => {
  it('returns capability-aware auth context', async () => {
    const http = {
      get: async (path: string) => {
        throw new Error(`unexpected product path ${path}`);
      },
    };

    const authHttp = {
      get: async (path: string) => {
        expect(path).toBe('/auth/me');
        return {
          user_id: 'user-123',
          orchestra_user_id: 'orch-123',
          team_id: 'team-123',
          plan_id: 'pro',
          email: 'user@example.com',
          auth_type: 'orchestra_key',
          capabilities: ['models:*', 'voice:*'],
          key_id: 'key-123',
          key_name: 'runtime-key',
        };
      },
    };

    const authMe = await new UserAPI(http as any, authHttp as any).authMe();

    expect(authMe.userId).toBe('user-123');
    expect(authMe.capabilities).toEqual(['models:*', 'voice:*']);
    expect(authMe.keyId).toBe('key-123');
  });
});
