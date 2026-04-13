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
      expect(summary.billingResetAt?.toISOString()).toBe('2026-04-15T00:00:00.000Z');
      expect(summary.slotInventory.large.available).toBe(1);
      expect(summary.entitlements.activeEntitlementCount).toBe(1);
      expect(summary.entitlementItems[0]?.planId).toBe('large');
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
          billing_reset_at: '2026-04-15T00:00:00Z',
          slot_inventory: { large: { granted: 2, used: 1, available: 1 } },
          active_subscription_count: 1,
          active_entitlement_count: 1,
          entitlements: {
            effective_plan_id: 'large',
            pooled_tpm_limit: 2000,
            pooled_rpm_limit: 20,
            pooled_tpd: 2000000,
            billing_reset_at: '2026-04-15T00:00:00Z',
            slot_inventory: { large: { granted: 2, used: 1, available: 1 } },
            active_entitlement_count: 1,
          },
          entitlement_items: [
            {
              id: 'ent-1',
              user_id: 'user-1',
              plan_id: 'large',
              plan_name: 'Large',
              provider: 'X402',
              status: 'ACTIVE',
              expires_at: '2026-04-20T00:00:00Z',
              agent_tier: 'large',
              features: { voice: true },
              tags: ['customer=acme'],
              active_agent_count: 0,
              active_agent_ids: [],
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
      const summary = await agent.entitlements();
      expect(summary.currentEntitlementId).toBe('sub-1');
      expect(summary.entitlements.billingResetAt?.toISOString()).toBe('2026-04-15T00:00:00.000Z');
      expect(summary.entitlements.slotInventory.large.granted).toBe(2);
      expect(summary.entitlementItems[0]?.provider).toBe('X402');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/entitlements');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('lists entitlement instances on the primary API host', async () => {
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
              id: 'ent-1',
              user_id: 'user-1',
              subscription_id: null,
              plan_id: 'large',
              plan_name: 'Large',
              provider: 'X402',
              status: 'ACTIVE',
              expires_at: '2026-04-20T00:00:00Z',
              agent_tier: 'large',
              features: { voice: true },
              tags: ['customer=acme'],
              active_agent_count: 0,
              active_agent_ids: [],
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
      const entitlements = await agent.entitlementInstances();
      expect(entitlements[0]?.planId).toBe('large');
      expect(entitlements[0]?.tags).toEqual(['customer=acme']);
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/entitlements/instances');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('updates a subscription on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'Subscription upgraded immediately',
          subscription: {
            id: 'sub-1',
            user_id: 'user-1',
            plan_id: 'large',
            plan_name: 'Large',
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
      const result = await agent.updateSubscription('sub-1', { bundle: { large: 1 } });
      expect(result.ok).toBe(true);
      expect(result.subscription?.planId).toBe('large');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/subscriptions/sub-1/update');
      expect(calls[0]?.init?.method).toBe('POST');
      expect(calls[0]?.init?.body).toBe(JSON.stringify({ bundle: { large: 1 } }));
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('cancels a subscription through the update endpoint', async () => {
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
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/subscriptions/sub-1/update');
      expect(calls[0]?.init?.method).toBe('POST');
      expect(calls[0]?.init?.body).toBe(JSON.stringify({ bundle: {} }));
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('uses the user usage endpoints on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const url = String(input);
      if (url.endsWith('/usage')) {
        return new Response(JSON.stringify({
          total_tokens: 100,
          prompt_tokens: 60,
          completion_tokens: 40,
          request_count: 5,
          active_keys: 2,
          current_tpm: 1000,
          current_rpm: 10,
          period: '30d',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/usage/history')) {
        return new Response(JSON.stringify({
          history: [{ date: '2026-04-13', total_tokens: 100, prompt_tokens: 60, completion_tokens: 40, requests: 5 }],
          days: 7,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        keys: [{ key_hash: 'key-1', name: 'Primary', total_tokens: 100, prompt_tokens: 60, completion_tokens: 40, requests: 5 }],
        days: 7,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      const summary = await agent.usageSummary();
      const history = await agent.usageHistory();
      const keys = await agent.keyUsage();
      expect(summary.totalTokens).toBe(100);
      expect(history.history[0]?.date).toBe('2026-04-13');
      expect(keys.keys[0]?.keyHash).toBe('key-1');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/usage');
      expect(calls[1]?.url).toBe('https://api.hypercli.com/agents/usage/history?days=7');
      expect(calls[2]?.url).toBe('https://api.hypercli.com/agents/usage/keys?days=7');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('uses the user types and billing endpoints on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const url = String(input);
      if (url.endsWith('/types')) {
        return new Response(JSON.stringify({
          types: [{ id: 'medium', name: 'Medium', cpu: 1, memory: 2, cpu_limit: 1, memory_limit: 2 }],
          plans: [{ id: '2aiu', name: '2 AIU', price: 20, agents: 1, agent_type: 'medium', highlighted: true }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/billing/info')) {
        return new Response(JSON.stringify({
          company_billing: { address: ['HyperCLI'], email: 'support@hypercli.com' },
          profile: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/billing/profile') && init?.method === 'PUT') {
        return new Response(JSON.stringify({
          company_billing: { address: ['HyperCLI'], email: 'support@hypercli.com' },
          profile: { billing_name: 'Test User' },
          synced_stripe_customer_ids: ['cus_123'],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        company_billing: { address: ['HyperCLI'], email: 'support@hypercli.com' },
        profile: { billing_name: 'Test User' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      const types = await agent.agentTypes();
      const info = await agent.billingInfo();
      const profile = await agent.billingProfile();
      const updated = await agent.updateBillingProfile({
        billingName: 'Test User',
        billingCompany: null,
        billingTaxId: null,
        billingLine1: null,
        billingLine2: null,
        billingCity: null,
        billingState: null,
        billingPostalCode: null,
        billingCountry: null,
      });
      expect(types.types[0]?.id).toBe('medium');
      expect(info.email).toBe('support@hypercli.com');
      expect(profile.profile?.billingName).toBe('Test User');
      expect(updated.syncedStripeCustomerIds).toEqual(['cus_123']);
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/types');
      expect(calls[1]?.url).toBe('https://api.hypercli.com/agents/billing/info');
      expect(calls[2]?.url).toBe('https://api.hypercli.com/agents/billing/profile');
      expect(calls[3]?.url).toBe('https://api.hypercli.com/agents/billing/profile');
      expect(calls[3]?.init?.method).toBe('PUT');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });

  it('uses the user payment and checkout endpoints on the primary API host', async () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    const fetchMock = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const url = String(input);
      if (url.includes('/billing/payments/pay_123')) {
        return new Response(JSON.stringify({
          id: 'pay_123',
          user_id: 'user-1',
          subscription_id: null,
          entitlement_id: null,
          provider: 'STRIPE',
          status: 'SUCCEEDED',
          amount: '2000',
          currency: 'usd',
          external_payment_id: 'pi_123',
          created_at: '2026-04-13T00:00:00Z',
          updated_at: '2026-04-13T00:00:00Z',
          user: { id: 'user-1', email: 'user@example.com', wallet_address: null, team_id: 'team-1', plan_id: '2aiu' },
          subscription: null,
          entitlement: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/billing/payments')) {
        return new Response(JSON.stringify({
          items: [{
            id: 'pay_123',
            user_id: 'user-1',
            subscription_id: null,
            entitlement_id: null,
            provider: 'STRIPE',
            status: 'SUCCEEDED',
            amount: '2000',
            currency: 'usd',
            external_payment_id: 'pi_123',
            created_at: '2026-04-13T00:00:00Z',
            updated_at: '2026-04-13T00:00:00Z',
            user: { id: 'user-1', email: 'user@example.com', wallet_address: null, team_id: 'team-1', plan_id: '2aiu' },
            subscription: null,
            entitlement: null,
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/stripe/checkout')) {
        return new Response(JSON.stringify({ checkout_url: 'https://checkout.stripe.test/session' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        ok: true,
        key: 'sk-x402',
        plan_id: '2aiu',
        quantity: 1,
        bundle: { medium: 1 },
        amount_paid: '20.000000',
        duration_days: 30,
        expires_at: '2026-05-13T00:00:00Z',
        tpm_limit: 1000,
        rpm_limit: 10,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      const payments = await agent.payments({ limit: 10, provider: 'stripe', status: 'succeeded' });
      const payment = await agent.payment('pay_123');
      const stripe = await agent.createStripeCheckout({ bundle: { medium: 1 } });
      const x402 = await agent.createX402Checkout({ bundle: { medium: 1 } });
      expect(payments.items[0]?.id).toBe('pay_123');
      expect(payment.externalPaymentId).toBe('pi_123');
      expect(stripe.checkoutUrl).toBe('https://checkout.stripe.test/session');
      expect(x402.planId).toBe('2aiu');
      expect(calls[0]?.url).toBe('https://api.hypercli.com/agents/billing/payments?limit=10&provider=stripe&status=succeeded');
      expect(calls[1]?.url).toBe('https://api.hypercli.com/agents/billing/payments/pay_123');
      expect(calls[2]?.url).toBe('https://api.hypercli.com/agents/stripe/checkout');
      expect(calls[3]?.url).toBe('https://api.hypercli.com/agents/x402/checkout');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });
});
