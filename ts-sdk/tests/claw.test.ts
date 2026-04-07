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
    expect(agent.controlBaseUrl).toBe('https://api.hypercli.com');
  });

  it('normalizes generic dev API hosts onto the dev agents host', () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.dev.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', true, 'https://api.dev.hypercli.com');
    expect(agent.baseUrl).toBe('https://api.agents.dev.hypercli.com/v1');
    expect(agent.controlBaseUrl).toBe('https://api.dev.hypercli.com');
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
      return new Response(JSON.stringify({ plans: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      await agent.plans();
      expect(calls[0]?.url).toBe('https://api.hypercli.com/api/plans');
      expect((calls[0]?.init?.headers as Record<string, string>)?.Authorization).toBe('Bearer sk-hyper-test');
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
      expect(calls[0]?.url).toBe('https://api.hypercli.com/api/plans/current');
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
      expect(calls[0]?.url).toBe('https://api.hypercli.com/api/subscriptions');
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
          slot_inventory: { large: { granted: 2, used: 1, available: 1 } },
          active_subscription_count: 1,
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
      expect(summary.slotInventory.large.available).toBe(1);
      expect(calls[0]?.url).toBe('https://api.hypercli.com/api/subscriptions/summary');
      expect((calls[0]?.init?.headers as Record<string, string>)?.Authorization).toBe('Bearer sk-hyper-test');
    } finally {
      globalThis.fetch = fetchMock;
    }
  });
});
