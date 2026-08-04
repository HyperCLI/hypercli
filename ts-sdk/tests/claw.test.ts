import { describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';
import { HyperAgent, hasActivePlan, parseHyperAgentPlanId } from '../src/agent.js';

describe('HyperAgent API', () => {
  const client = new HyperCLI({ apiKey: 'hyper_api_test_key' });

  it('exposes HyperAgent as the primary inference client', () => {
    expect(client.agent).toBeInstanceOf(HyperAgent);
  });

  it('derives the inference base from the agents API base', () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    expect(agent.baseUrl).toBe('https://api.agents.hypercli.com/v1');
    expect(agent.controlBaseUrl).toBe('https://api.hypercli.com/agents');
  });

  it('normalizes generic dev API hosts onto the dev agents host', () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.dev.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', true, 'https://api.dev.hypercli.com');
    expect(agent.baseUrl).toBe('https://api.agents.dev.hypercli.com/v1');
    expect(agent.controlBaseUrl).toBe('https://api.dev.hypercli.com/agents');
  });

  it('returns token usage attributed by agent', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        agents: [{
          agent_id: 'agent-123',
          name: 'Research',
          managed: true,
          avatar_url: null,
          total_tokens: 120,
          prompt_tokens: 70,
          completion_tokens: 50,
          requests: 3,
        }],
        unattributed: {
          total_tokens: 4,
          prompt_tokens: 2,
          completion_tokens: 2,
          requests: 1,
        },
        days: 1,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      await expect(agent.agentUsage(1)).resolves.toEqual({
        agents: [{
          agentId: 'agent-123',
          name: 'Research',
          managed: true,
          avatarUrl: null,
          totalTokens: 120,
          promptTokens: 70,
          completionTokens: 50,
          requests: 3,
        }],
        unattributed: {
          totalTokens: 4,
          promptTokens: 2,
          completionTokens: 2,
          requests: 1,
        },
        days: 1,
      });
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/usage/agents?days=1');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it.skip('should list models (requires HyperAgent API key)', async () => {
    const models = await client.agent.models();
    
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    
    if (models.length > 0) {
      const model = models[0];
      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('name');
    }
  });

  it.skip('should list plans (requires HyperAgent API key)', async () => {
    const plans = await client.agent.plans();
    
    expect(Array.isArray(plans)).toBe(true);
    expect(plans.length).toBeGreaterThan(0);
    
    if (plans.length > 0) {
      const plan = plans[0];
      expect(plan).toHaveProperty('id');
      expect(plan).toHaveProperty('name');
    }
  });

  it('uses the API plans endpoint on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        plans: [{
          id: 'pro',
          name: 'Pro',
          price: 149,
          amount_cents: 14900,
          contract_version: '2026-08',
          agents: 3,
          max_agent_size: 'large',
          agent_resources: { max_agents: 3, total_cpu: 6, total_memory: 24 },
          features: ['Up to 3 large agents'],
          models: ['kimi-k2.6'],
          limits: { tpd: 100000000, tpm: 69444, burst_tpm: 3472200, rpm: 347 },
          tpm_limit: 69444,
          rpm_limit: 347,
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const plans = await agent.plans();
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/plans');
      expect((calls[0]?.init?.headers as Record<string, string>)?.Authorization).toBe('Bearer sk-hyper-test');
      expect(plans[0]?.price).toBe(149);
      expect(plans[0]?.canonicalId).toBe('pro');
      expect(parseHyperAgentPlanId('team')).toBe('team');
      expect(parseHyperAgentPlanId('free')).toBeNull();
      expect(plans[0]?.features).toEqual(['Up to 3 large agents']);
      expect(plans[0]?.limits.burstTpm).toBe(3472200);
      expect(plans[0]?.amountCents).toBe(14900);
      expect(plans[0]?.contractVersion).toBe('2026-08');
      expect(plans[0]?.maxAgentSize).toBe('large');
      expect(plans[0]?.slotGrants).toEqual({ large: 3 });
      expect(plans[0]?.agentResources).toEqual({ maxAgents: 3, totalCpu: 6, totalMemory: 24 });
      expect(plans[0]?.aiu).toBeUndefined();
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('uses the API current-plan endpoint on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          id: 'solo',
          name: 'Solo',
          price: 39,
          limits: { tpd: 1, burst_tpm: 1, rpm: 1 },
          features: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    try {
      await agent.currentPlan();
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/plans/current');
      expect((calls[0]?.init?.headers as Record<string, string>)?.Authorization).toBe('Bearer sk-hyper-test');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('uses the API subscriptions endpoint on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'sub-1',
              user_id: 'user-1',
              plan_id: 'large',
              plan_name: 'Large',
              provider: 'STRIPE',
              status: 'ACTIVE',
              quantity: 2,
              current_period_end: '2026-04-15T00:00:00Z',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    try {
      const subscriptions = await agent.subscriptions();
      expect(subscriptions[0]?.quantity).toBe(2);
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/subscriptions');
      expect((calls[0]?.init?.headers as Record<string, string>)?.Authorization).toBe('Bearer sk-hyper-test');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('uses the API subscription-summary endpoint on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          effective_plan_id: 'large',
          current_subscription_id: 'sub-1',
          pooled_tpm_limit: 2000,
          pooled_rpm_limit: 20,
          pooled_tpd: 2000000,
          billing_reset_at: '2026-04-15T00:00:00Z',
          slot_inventory: { large: { granted: 2, used: 1, available: 1 } },
          agent_slots: [{
            id: 'slot-1',
            entitlement_id: 'ent-1',
            plan_id: 'pro',
            size: 'large',
            agent_id: 'agent-1',
            occupied: true,
          }],
          active_subscription_count: 0,
          active_entitlement_count: 1,
          entitlement_items: [
            {
              id: 'ent-1',
              user_id: 'user-1',
              subscription_id: 'sub-1',
              plan_id: 'large',
              plan_name: 'Large',
              provider: 'STRIPE',
              status: 'ACTIVE',
              expires_at: '2026-04-15T00:00:00Z',
              tpd_limit: 1000000,
              agent_tier: 'large',
              slot_grants: { large: 1 },
              features: { voice: true },
              tags: ['customer=acme'],
              active_agent_count: 1,
              active_agent_ids: ['agent-1'],
            },
          ],
          active_subscriptions: [],
          subscriptions: [],
          user: { id: 'user-1', team_id: 'team-1' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    try {
      const summary = await agent.subscriptionSummary();
      expect(summary.currentSubscriptionId).toBe('sub-1');
      expect(summary.currentEntitlementId).toBe('sub-1');
      expect(summary.slotInventory.large.available).toBe(1);
      expect(summary.entitlements.activeEntitlementCount).toBe(1);
      expect(summary.entitlements.billingResetAt?.toISOString()).toBe('2026-04-15T00:00:00.000Z');
      expect(summary.entitlementItems ?? []).toHaveLength(1);
      expect(summary.entitlementItems?.[0]?.slotGrants).toEqual({ large: 1 });
      expect(summary.entitlementItems?.[0]?.tpdLimit).toBe(1000000);
      expect(summary.entitlementItems?.[0]?.activeAgentIds).toEqual(['agent-1']);
      expect(summary.agentSlots[0]?.size).toBe('large');
      expect(summary.entitlements.agentSlots[0]?.agentId).toBe('agent-1');
      expect(hasActivePlan(summary)).toBe(true);
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/subscriptions/summary');
      expect((calls[0]?.init?.headers as Record<string, string>)?.Authorization).toBe('Bearer sk-hyper-test');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('derives subscription slot grants from nested entitlement data', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          effective_plan_id: 'pro',
          slot_inventory: { large: { granted: 1, used: 0, available: 1 } },
          active_subscription_count: 1,
          active_entitlement_count: 1,
          active_subscriptions: [
            {
              id: 'sub-1',
              plan_id: 'pro',
              plan_name: 'Pro',
              status: 'ACTIVE',
              entitlements: [
                {
                  id: 'ent-1',
                  subscription_id: 'sub-1',
                  plan_id: 'pro',
                  status: 'ACTIVE',
                  slot_grants: { large: 1 },
                },
              ],
            },
          ],
          subscriptions: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    try {
      const summary = await agent.subscriptionSummary();
      expect(summary.activeSubscriptions[0]?.slotGrants).toEqual({ large: 1 });
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('uses the API entitlements endpoint on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          effective_plan_id: 'large',
          current_subscription_id: 'sub-1',
          current_entitlement_id: 'sub-1',
          pooled_tpm_limit: 2000,
          pooled_rpm_limit: 20,
          pooled_tpd: 2000000,
          slot_inventory: { large: { granted: 2, used: 1, available: 1 } },
          active_subscription_count: 1,
          active_entitlement_count: 1,
          entitlements: {
            effective_plan_id: 'large',
            pooled_tpm_limit: 2000,
            pooled_rpm_limit: 20,
            pooled_tpd: 2000000,
            slot_inventory: { large: { granted: 2, used: 1, available: 1 } },
            active_entitlement_count: 1,
          },
          active_subscriptions: [],
          subscriptions: [],
          user: { id: 'user-1', team_id: 'team-1' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    try {
      const summary = await agent.entitlements();
      expect(summary.currentEntitlementId).toBe('sub-1');
      expect(summary.entitlements.slotInventory.large.granted).toBe(2);
      expect(hasActivePlan(summary)).toBe(true);
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/entitlements');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('cancels a subscription on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'Subscription will be cancelled at the end of the current billing period',
          subscription: {
            id: 'sub-1',
            user_id: 'user-1',
            plan_id: 'large',
            plan_name: 'Large',
            provider: 'STRIPE',
            status: 'ACTIVE',
            cancel_at_period_end: true,
            can_cancel: true,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    try {
      const result = await agent.cancelSubscription('sub-1');
      expect(result.ok).toBe(true);
      expect(result.subscription?.cancelAtPeriodEnd).toBe(true);
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/subscriptions/sub-1/cancel');
      expect(calls[0]?.init?.method).toBe('POST');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('updates a recurring subscription plan and quantity on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'Subscription updated',
          subscription: {
            id: 'sub-1',
            user_id: 'user-1',
            plan_id: 'team',
            plan_name: 'Team',
            quantity: 2,
            provider: 'STRIPE',
            status: 'ACTIVE',
            cancel_at_period_end: false,
            can_cancel: true,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    try {
      const result = await agent.updateSubscription('sub-1', { planId: 'team', quantity: 2 });
      expect(result.ok).toBe(true);
      expect(result.subscription?.planId).toBe('team');
      expect(result.subscription?.quantity).toBe(2);
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/subscriptions/sub-1/update');
      expect(calls[0]?.init?.method).toBe('POST');
      expect(calls[0]?.init?.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer sk-hyper-test',
          'Content-Type': 'application/json',
        }),
      );
      expect(calls[0]?.init?.body).toBe(JSON.stringify({ plan_id: 'team', quantity: 2 }));
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('creates a Stripe billing portal session for payment method updates', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          id: 'bps_123',
          url: 'https://billing.stripe.com/p/session/test',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;

    try {
      const result = await agent.createStripeBillingPortalSession({
        returnUrl: 'https://claw.hypercli.com/dashboard/agents',
        flowType: 'payment_method_update',
      });

      expect(result.id).toBe('bps_123');
      expect(result.url).toBe('https://billing.stripe.com/p/session/test');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/stripe/billing-portal');
      expect(calls[0]?.init?.method).toBe('POST');
      expect(calls[0]?.init?.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer sk-hyper-test',
          'Content-Type': 'application/json',
        }),
      );
      expect(calls[0]?.init?.body).toBe(
        JSON.stringify({
          return_url: 'https://claw.hypercli.com/dashboard/agents',
          flow_data: { type: 'payment_method_update' },
        }),
      );
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('purchases a balance-funded entitlement on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          grant: {
            id: 'grant-1',
            type: 'BALANCE',
            plan_id: 'solo',
            duration: 3600,
            tags: ['customer=acme'],
          },
          entitlement: {
            id: 'ent-1',
            user_id: 'user-1',
            subscription_id: null,
            plan_id: 'solo',
            plan_name: 'Solo',
            provider: 'BALANCE',
            status: 'ACTIVE',
            starts_at: '2026-04-19T12:00:00Z',
            expires_at: '2026-04-19T13:00:00Z',
            tpm_limit: 1000,
            rpm_limit: 10,
            tpd_limit: 1000000,
            agent_tier: 'small',
            features: {},
            tags: ['customer=acme'],
            slot_grants: { small: 1, medium: 0, large: 0 },
            active_agent_count: 0,
            active_agent_ids: [],
          },
          payment: {
            id: 'pay-1',
            user_id: 'user-1',
            provider: 'BALANCE',
            status: 'SUCCEEDED',
            amount: '10000',
            currency: 'usdc',
            external_payment_id: 'tx-1',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const result = await agent.purchaseEntitlementFromBalance('solo', { duration: 3600, tags: ['customer=acme'] });
      expect(result.grant.type).toBe('BALANCE');
      expect(result.entitlement.startsAt?.toISOString()).toBe('2026-04-19T12:00:00.000Z');
      expect(result.payment?.provider).toBe('BALANCE');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/billing/balance/solo');
      expect(calls[0]?.init?.method).toBe('POST');
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
        duration: 3600,
        tags: ['customer=acme'],
      });
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('can request balance entitlement extension', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          grant: { id: 'grant-1', type: 'BALANCE', plan_id: 'solo', duration: 3600 },
          entitlement: { id: 'ent-1', plan_id: 'solo', provider: 'BALANCE', tags: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await agent.purchaseEntitlementFromBalance('solo', { duration: 3600, extendExisting: true });
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/billing/balance/solo');
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
        duration: 3600,
        extend_existing: true,
      });
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('redeems a grant code on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          grant: {
            id: 'grant-1',
            type: 'ACTIVATION_CODE',
            code: 'promo-123',
            plan_id: 'solo',
            duration: 3600,
            tags: ['customer=acme'],
          },
          entitlement: {
            id: 'ent-1',
            user_id: 'user-1',
            subscription_id: null,
            plan_id: 'solo',
            plan_name: 'Solo',
            provider: 'ACTIVATION_CODE',
            status: 'ACTIVE',
            starts_at: '2026-04-19T12:00:00Z',
            expires_at: '2026-04-19T13:00:00Z',
            tpm_limit: 1000,
            rpm_limit: 10,
            tpd_limit: 1000000,
            agent_tier: 'small',
            features: {},
            tags: ['customer=acme'],
            slot_grants: { small: 1, medium: 0, large: 0 },
            active_agent_count: 0,
            active_agent_ids: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const result = await agent.redeemGrantCode('promo-123');
      expect(result.grant.code).toBe('promo-123');
      expect(result.entitlement.provider).toBe('ACTIVATION_CODE');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/billing/grants/redeem');
      expect(calls[0]?.init?.method).toBe('POST');
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ code: 'promo-123' });
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('can request grant-code extension on redeem', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          grant: { id: 'grant-1', type: 'ACTIVATION_CODE', code: 'promo-123' },
          entitlement: { id: 'ent-1', plan_id: 'solo', provider: 'ACTIVATION_CODE' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await agent.redeemGrantCode('promo-123', { extendExisting: true });
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/billing/grants/redeem');
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
        code: 'promo-123',
        extend_existing: true,
      });
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('purchases a concrete x402 plan on the agents control host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          ok: true,
          key: 'hyper_api_x402',
          plan_id: 'solo',
          quantity: 1,
          bundle: { small: 1 },
          amount_paid: '20.00',
          duration_days: 30,
          expires_at: '2026-05-19T12:00:00Z',
          tpm_limit: 1000,
          rpm_limit: 10,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const result = await agent.purchaseViaX402('solo', { quantity: 1 });
      expect(result.planId).toBe('solo');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/x402/solo');
      expect(calls[0]?.init?.method).toBe('POST');
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ quantity: 1 });
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('rejects the retired explicit x402 bundle route locally', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      throw new Error('unexpected fetch');
    }) as typeof fetch;

    try {
      await expect(agent.purchaseBundleViaX402({ quantity: 1, bundle: { large: 2 } }))
        .rejects.toThrow('Arbitrary slot bundles are no longer supported');
      expect(calls).toHaveLength(0);
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('requires a canonical plan ID for x402 checkout', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      throw new Error('unexpected fetch');
    }) as typeof fetch;

    try {
      await expect(agent.createX402Checkout({ quantity: 1 }))
        .rejects.toThrow('A canonical plan ID is required');
      expect(calls).toHaveLength(0);
    } finally {
      globalThis.fetch = fetchMock;
    }
  });
});
