import { afterEach, describe, expect, it, vi } from 'vitest';
import { HyperAgent } from '../src/agent.js';

function makeAgent() {
  const http = { apiKey: 'hyper_api_test', baseUrl: 'http://agents.test/agents' } as any;
  return new HyperAgent(http, 'hyper_api_test', false, 'http://agents.test/agents');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HyperAgent trial flows', () => {
  it('posts /stripe/trial with success/cancel urls and returns checkout_url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ checkout_url: 'https://checkout.stripe.com/c/test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const agent = makeAgent();
    const result = await agent.createStripeTrialCheckout({
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });

    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/c/test');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://agents.test/agents/stripe/trial');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer hyper_api_test');
    expect(JSON.parse(String(init.body))).toEqual({
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
    });
  });

  it('posts /stripe/trial with an empty object when no urls are given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ checkout_url: 'https://checkout.stripe.com/c/t' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const agent = makeAgent();
    const result = await agent.createStripeTrialCheckout();

    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/c/t');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://agents.test/agents/stripe/trial');
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it('claimTrialEntitlement warns and throws because the backend endpoint does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const agent = makeAgent();
    await expect(agent.claimTrialEntitlement()).rejects.toThrow(/deprecated/);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain('/agents/plans/trial');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
