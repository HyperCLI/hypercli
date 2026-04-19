import { describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';
import { HyperAgent } from '../src/agent.js';

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
          id: '5aiu',
          name: '5 AIU',
          price: 100,
          aiu: 5,
          agents: 1,
          features: ['1 large agent'],
          models: ['kimi-k2.5'],
          limits: { tpd: 250000000, tpm: 173611, burst_tpm: 694444, rpm: 3472 },
          tpm_limit: 173611,
          rpm_limit: 3472,
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
      expect(plans[0]?.price).toBe(100);
      expect(plans[0]?.features).toEqual(['1 large agent']);
      expect(plans[0]?.limits.burstTpm).toBe(694444);
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
          id: '1aiu',
          name: '1 Agent',
          price: 20,
          aiu: 1,
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
          active_subscription_count: 1,
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
              agent_tier: 'large',
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
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/subscriptions/summary');
      expect((calls[0]?.init?.headers as Record<string, string>)?.Authorization).toBe('Bearer sk-hyper-test');
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

  it('updates a subscription bundle on the primary API host', async () => {
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
            plan_id: 'medium',
            plan_name: 'Medium',
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
      const result = await agent.updateSubscription('sub-1', { bundle: { medium: 1 } });
      expect(result.ok).toBe(true);
      expect(result.subscription?.planId).toBe('medium');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/subscriptions/sub-1/update');
      expect(calls[0]?.init?.method).toBe('POST');
      expect(calls[0]?.init?.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer sk-hyper-test',
          'Content-Type': 'application/json',
        }),
      );
      expect(calls[0]?.init?.body).toBe(JSON.stringify({ bundle: { medium: 1 } }));
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
            plan_id: '1aiu',
            duration: 3600,
            tags: ['customer=acme'],
          },
          entitlement: {
            id: 'ent-1',
            user_id: 'user-1',
            subscription_id: null,
            plan_id: '1aiu',
            plan_name: '1 AIU',
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
      const result = await agent.purchaseEntitlementFromBalance('1aiu', { duration: 3600, tags: ['customer=acme'] });
      expect(result.grant.type).toBe('BALANCE');
      expect(result.entitlement.startsAt?.toISOString()).toBe('2026-04-19T12:00:00.000Z');
      expect(result.payment?.provider).toBe('BALANCE');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/billing/balance/1aiu');
      expect(calls[0]?.init?.method).toBe('POST');
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
            plan_id: '1aiu',
            duration: 3600,
            tags: ['customer=acme'],
          },
          entitlement: {
            id: 'ent-1',
            user_id: 'user-1',
            subscription_id: null,
            plan_id: '1aiu',
            plan_name: '1 AIU',
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
          plan_id: '1aiu',
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
      const result = await agent.purchaseViaX402('1aiu', { quantity: 1, bundle: { small: 1 } });
      expect(result.planId).toBe('1aiu');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/x402/1aiu');
      expect(calls[0]?.init?.method).toBe('POST');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('purchases an x402 bundle through the explicit bundle route', async () => {
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
          plan_id: '_bundle',
          quantity: 1,
          bundle: { large: 2 },
          amount_paid: '200.00',
          duration_days: 30,
          expires_at: '2026-05-19T12:00:00Z',
          tpm_limit: 1000,
          rpm_limit: 10,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const result = await agent.purchaseBundleViaX402({ quantity: 1, bundle: { large: 2 } });
      expect(result.planId).toBe('_bundle');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/x402/_bundle');
      expect(calls[0]?.init?.method).toBe('POST');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('keeps legacy x402 checkout as a bundle-purchase shim', async () => {
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
          plan_id: '_bundle',
          quantity: 1,
          bundle: { medium: 1 },
          amount_paid: '40.00',
          duration_days: 30,
          expires_at: '2026-05-19T12:00:00Z',
          tpm_limit: 1000,
          rpm_limit: 10,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const result = await agent.createX402Checkout({ quantity: 1, bundle: { medium: 1 } });
      expect(result.planId).toBe('_bundle');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/x402/_bundle');
      expect(calls[0]?.init?.method).toBe('POST');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });
});
