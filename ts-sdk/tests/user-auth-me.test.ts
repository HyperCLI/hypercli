import { describe, it, expect } from 'vitest';
import { isRuntimeAgent, runtimeAgentId, UserAPI } from '../src/user.js';

describe('User auth me API', () => {
  it('returns capability-aware auth context', async () => {
    const http = {
      get: async (path: string) => {
        expect(path).toBe('/api/auth/me');
        return {
          user_id: 'user-123',
          orchestra_user_id: 'orch-123',
          team_id: 'team-123',
          plan_id: 'pro',
          email: 'user@example.com',
          auth_type: 'orchestra_key',
          capabilities: ['models:*', 'voice:*'],
          tags: ['runtime=agent', 'runtime_agent=agent-123'],
          runtime: { runtime: 'agent', agent_id: 'agent-123' },
          has_active_subscription: true,
          key_id: 'key-123',
          key_name: 'runtime-key',
        };
      },
    };

    const authMe = await new UserAPI(http as any).authMe();

    expect(authMe.userId).toBe('user-123');
    expect(authMe.capabilities).toEqual(['models:*', 'voice:*']);
    expect(authMe.tags).toEqual(['runtime=agent', 'runtime_agent=agent-123']);
    expect(isRuntimeAgent(authMe)).toBe(true);
    expect(runtimeAgentId(authMe)).toBe('agent-123');
    expect(authMe.hasActiveSubscription).toBe(true);
    expect(authMe.keyId).toBe('key-123');
  });
});
