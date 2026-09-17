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
          privy_user_id: 'did:privy:privy-123',
          wallet_address: '0x1111111111111111111111111111111111111111',
          user_type: 'paid',
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
    expect(authMe.externalId).toBe('did:privy:privy-123');
    expect(authMe.privyUserId).toBe('did:privy:privy-123');
    expect(authMe.walletAddress).toBe('0x1111111111111111111111111111111111111111');
    expect(authMe.userType).toBe('paid');
    expect(authMe.capabilities).toEqual(['models:*', 'voice:*']);
    expect(authMe.tags).toEqual(['runtime=agent', 'runtime_agent=agent-123']);
    expect(isRuntimeAgent(authMe)).toBe(true);
    expect(runtimeAgentId(authMe)).toBe('agent-123');
    expect(authMe.hasActiveSubscription).toBe(true);
    expect(authMe.keyId).toBe('key-123');
  });

  it('tolerates top-level runtime fields when the nested runtime object is absent', async () => {
    const http = {
      get: async () => ({
        user_id: 'user-top',
        runtime: 'agent',
        agent_id: 'agent-top',
      }),
    };

    const authMe = await new UserAPI(http as any).authMe();

    expect(authMe.runtime).toEqual({ runtime: 'agent', agentId: 'agent-top' });
    expect(isRuntimeAgent(authMe)).toBe(true);
    expect(runtimeAgentId(authMe)).toBe('agent-top');
  });

  it('returns null runtime when neither shape is present', async () => {
    const http = {
      get: async () => ({ user_id: 'user-plain' }),
    };

    const authMe = await new UserAPI(http as any).authMe();

    expect(authMe.runtime).toBeNull();
    expect(isRuntimeAgent(authMe)).toBe(false);
  });
});
