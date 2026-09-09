/**
 * Tests for `hyper me` (src/commands/me.ts).
 *
 * Mock seam: CommandContext.client is an injectable lazy factory — tests pass
 * a fake HyperCLI straight through ctx, capturing stdout/stderr via spies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APIError,
  type AgentAccessIdentity,
  type AuthMe,
  type HyperAgentSubscriptionSummary,
  type HyperCLI,
} from '@hypercli.com/sdk';
import * as me from '../src/commands/me.js';
import { exitCodeFor, printError } from '../src/core/errors.js';
import { createOutput } from '../src/core/output.js';
import type { CommandContext } from '../src/core/types.js';

const SECRET = 'hc_live_9f8e7d6c5b4a3210SECRET'; // sentinel: must never appear in output

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let stdoutChunks: string[];
let stderrChunks: string[];

const stdout = () => stdoutChunks.join('');
const stderr = () => stderrChunks.join('');

beforeEach(() => {
  stdoutChunks = [];
  stderrChunks = [];
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof stdoutSpy;
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof stderrSpy;
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

// ---------- fixtures ----------

function authMeFixture(overrides: Partial<AuthMe> = {}): AuthMe {
  return {
    userId: 'user_123',
    orchestraUserId: 'orch_123',
    externalId: 'orchestra:orch_123',
    privyUserId: 'privy_123',
    walletAddress: '0xabc123',
    userType: 'user',
    teamId: 'team_123',
    planId: 'pro',
    email: 'dev@example.com',
    authType: 'api_key',
    capabilities: ['jobs:run', 'flows:run'],
    tags: ['beta'],
    runtime: null,
    hasActiveSubscription: true,
    keyId: 'key_123',
    keyName: 'dev key',
    ...overrides,
  };
}

function summaryFixture(overrides: Partial<HyperAgentSubscriptionSummary> = {}): HyperAgentSubscriptionSummary {
  const base: HyperAgentSubscriptionSummary = {
    effectivePlanId: 'pro',
    currentSubscriptionId: null,
    currentEntitlementId: 'ent_123',
    pooledTpmLimit: 100_000,
    pooledRpmLimit: 600,
    pooledTpd: 5_000_000,
    slotInventory: {},
    billingResetAt: null,
    activeSubscriptionCount: 0,
    activeEntitlementCount: 1,
    entitlements: {
      effectivePlanId: 'pro',
      pooledTpmLimit: 100_000,
      pooledRpmLimit: 600,
      pooledTpd: 5_000_000,
      slotInventory: {},
      activeEntitlementCount: 1,
      billingResetAt: null,
      agentSlots: [],
    },
    entitlementItems: [
      {
        id: 'ent_123',
        userId: 'user_123',
        subscriptionId: null,
        planId: 'pro',
        planName: 'Pro',
        provider: 'activation_code',
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        updatedAt: new Date('2026-09-01T00:00:00Z'),
        tpmLimit: 100_000,
        rpmLimit: 600,
        tpdLimit: 5_000_000,
        agentTier: null,
        features: {},
        tags: [],
        meta: null,
        slotGrants: null,
        activeAgentCount: 0,
        activeAgentIds: [],
        agentSlots: [],
      },
    ],
    activeSubscriptions: [],
    subscriptions: [],
    user: {},
    agentSlots: [],
  };
  return { ...base, ...overrides };
}

function runtimeKeyIdentityFixture(): AgentAccessIdentity {
  return {
    userId: 'user_123',
    authType: 'agent_runtime_key',
    agentId: 'agent_123',
    tags: [],
    capabilities: ['agent:run'],
    keyId: 'key_rt',
    keyName: null,
    teamId: 'team_123',
    planId: 'pro',
    isAgentRuntimeKey: true,
  };
}

interface FakeHandlers {
  authMe?: () => Promise<AuthMe>;
  subscriptionSummary?: () => Promise<HyperAgentSubscriptionSummary>;
  accessIdentity?: () => Promise<AgentAccessIdentity>;
}

function fakeClient(handlers: FakeHandlers = {}): HyperCLI {
  return {
    user: { authMe: handlers.authMe ?? (async () => authMeFixture()) },
    agent: { subscriptionSummary: handlers.subscriptionSummary ?? (async () => summaryFixture()) },
    deployments: {
      accessIdentity:
        handlers.accessIdentity ?? (async () => { throw new Error('requires an agent runtime key'); }),
    },
  } as unknown as HyperCLI;
}

function makeCtx(client: HyperCLI, format: 'table' | 'json'): CommandContext {
  return {
    client: vi.fn(async () => client),
    output: createOutput(format),
    format,
    dev: false,
  };
}

// ---------- tests ----------

describe('hyper me', () => {
  it('(a) full success: json has identity + capabilities + agents section', async () => {
    const client = fakeClient({
      authMe: async () => authMeFixture({ runtime: { runtime: 'agent', agentId: 'agent_123' } }),
      accessIdentity: async () => runtimeKeyIdentityFixture(),
    });
    const ctx = makeCtx(client, 'json');

    await me.run(ctx, ['--json']);

    expect(stderr()).toBe('');
    const payload = JSON.parse(stdout());
    expect(payload.identity.userId).toBe('user_123');
    expect(payload.identity.keyId).toBe('key_123');
    expect(payload.identity.runtime).toEqual({ runtime: 'agent', agentId: 'agent_123' });
    expect(payload.identity.agent_id).toBe('agent_123');
    expect(payload.capabilities).toEqual(['jobs:run', 'flows:run']);
    expect(payload.agents.hasActivePlan).toBe(true);
    expect(payload.agents.activeEntitlementCount).toBe(1);
    expect(payload.agents.entitlementItems).toHaveLength(1);
    expect(payload.agents_error).toBeUndefined();
    expect(stdout()).not.toContain(SECRET);
  });

  it('(b) entitlement 403: exit 0 keeps identity, agents null + agents_error (never "no plan")', async () => {
    const client = fakeClient({
      subscriptionSummary: async () => {
        throw new Error('Failed to get subscription summary: Forbidden');
      },
    });
    const ctx = makeCtx(client, 'json');

    await me.run(ctx, ['--json']); // resolves — no throw, exit 0

    const payload = JSON.parse(stdout());
    expect(payload.identity.userId).toBe('user_123');
    expect(payload.agents).toBeNull();
    expect(payload.agents_error).toContain('Forbidden');
  });

  it('(b-table) entitlement failure renders the Agents section as unavailable', async () => {
    const client = fakeClient({
      subscriptionSummary: async () => {
        throw new APIError(403, 'Forbidden');
      },
    });
    const ctx = makeCtx(client, 'table');

    await me.run(ctx, []);

    const out = stdout();
    expect(out).toContain('Agents');
    expect(out).toContain('unavailable');
    expect(out).toContain('403');
  });

  it('(c) authMe 401 inactive key: exit 1, stderr says recognized-but-inactive, no retry', async () => {
    const authMe = vi.fn(async (): Promise<AuthMe> => {
      throw new APIError(401, 'API key is inactive');
    });
    const subscriptionSummary = vi.fn(summaryFixture);
    const client = fakeClient({ authMe, subscriptionSummary });
    const ctx = makeCtx(client, 'json');

    const err: unknown = await me.run(ctx, ['--json']).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(1);
    expect(authMe).toHaveBeenCalledTimes(1);
    expect(subscriptionSummary).not.toHaveBeenCalled();
    printError(err); // entrypoint behavior: `error: <message>` on stderr
    expect(stdout()).toBe('');
    expect(stderr()).toContain('error:');
    expect(stderr()).toMatch(/recognized but inactive/);
  });

  it('(c2) authMe 401 invalid key: exit 1, stderr says invalid', async () => {
    const client = fakeClient({
      authMe: async () => {
        throw new APIError(401, 'Invalid API key');
      },
    });
    const ctx = makeCtx(client, 'json');

    const err: unknown = await me.run(ctx, []).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect(exitCodeFor(err)).toBe(1);
    printError(err);
    expect(stderr()).toMatch(/invalid/i);
    expect(stdout()).toBe('');
  });

  it('(d) table mode prints labeled sections and never a key-shaped string', async () => {
    const client = fakeClient();
    const ctx = makeCtx(client, 'table');

    await me.run(ctx, []);

    const out = stdout();
    expect(out).toContain('Identity');
    expect(out).toContain('Capabilities');
    expect(out).toContain('Agents');
    expect(out).toContain('has_active_plan');
    expect(out).toContain('user_123');
    expect(out).not.toContain(SECRET);
    expect(out).not.toMatch(/hc_live_[A-Za-z0-9]{10,}/);
    expect(stderr()).toBe('');
  });

  it('--help prints help without touching the API', async () => {
    const client = fakeClient();
    const ctx = makeCtx(client, 'table');

    await me.run(ctx, ['--help']);

    expect(ctx.client).not.toHaveBeenCalled();
    expect(stdout()).toContain('hyper me');
  });
});
