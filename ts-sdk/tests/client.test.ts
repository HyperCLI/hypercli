import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { BrowserHyperCLI } from '../src/browser.js';
import { HyperCLI } from '../src/client.js';

describe('HyperCLI Client', () => {
  const originalHyperApiKey = process.env.HYPER_API_KEY;
  const originalApiKey = process.env.HYPERCLI_API_KEY;
  const originalAgentApiKey = process.env.HYPER_AGENTS_API_KEY;
  const originalAgentsApiBaseUrl = process.env.AGENTS_API_BASE_URL;
  const originalAgentsWsUrl = process.env.AGENTS_WS_URL;
  const originalApiBase = process.env.HYPER_API_BASE;
  const originalApiUrl = process.env.HYPERCLI_API_URL;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.HYPER_API_KEY = 'hyper_api_test_key';
    delete process.env.HYPERCLI_API_KEY;
    delete process.env.HYPER_AGENTS_API_KEY;
    delete process.env.AGENTS_API_BASE_URL;
    delete process.env.AGENTS_WS_URL;
    delete process.env.HYPER_API_BASE;
    delete process.env.HYPERCLI_API_URL;
  });

  afterEach(() => {
    if (originalHyperApiKey === undefined) delete process.env.HYPER_API_KEY;
    else process.env.HYPER_API_KEY = originalHyperApiKey;

    if (originalApiKey === undefined) delete process.env.HYPERCLI_API_KEY;
    else process.env.HYPERCLI_API_KEY = originalApiKey;

    if (originalAgentApiKey === undefined) delete process.env.HYPER_AGENTS_API_KEY;
    else process.env.HYPER_AGENTS_API_KEY = originalAgentApiKey;

    if (originalAgentsApiBaseUrl === undefined) delete process.env.AGENTS_API_BASE_URL;
    else process.env.AGENTS_API_BASE_URL = originalAgentsApiBaseUrl;

    if (originalAgentsWsUrl === undefined) delete process.env.AGENTS_WS_URL;
    else process.env.AGENTS_WS_URL = originalAgentsWsUrl;

    if (originalApiBase === undefined) delete process.env.HYPER_API_BASE;
    else process.env.HYPER_API_BASE = originalApiBase;

    if (originalApiUrl === undefined) delete process.env.HYPERCLI_API_URL;
    else process.env.HYPERCLI_API_URL = originalApiUrl;

    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should construct client with env var/config file', () => {
    const client = new HyperCLI();
    expect(client).toBeDefined();
    expect(client.agent).toBeDefined();
    expect(client.jobs).toBeDefined();
    expect(client.billing).toBeDefined();
    expect(client.instances).toBeDefined();
    expect(client.voice).toBeDefined();
  });

  it('should construct client with explicit API key', () => {
    const client = new HyperCLI({ apiKey: 'hyper_api_explicit_test_key' });
    expect(client).toBeDefined();
  });

  it('should throw error with empty API key', () => {
    expect(() => new HyperCLI({ apiKey: '', agentApiKey: '' })).toThrow();
  });

  it('should use agent env for deployments while keeping product auth for platform APIs', () => {
    process.env.HYPER_AGENTS_API_KEY = 'sk-agent';
    process.env.AGENTS_API_BASE_URL = 'https://api.agents.dev.hypercli.com';

    const client = new HyperCLI();
    expect(client.apiKey).toBe('hyper_api_test_key');
    expect((client.deployments as any).agentApiKey).toBe('sk-agent');
    expect((client.deployments as any).agentApiBase).toBe('https://api.dev.hypercli.com/agents');
  });

  it('should derive agent endpoints from an explicit product apiUrl', () => {
    const client = new HyperCLI({
      apiKey: 'hyper_api_test_key',
      agentApiKey: 'sk-agent',
      apiUrl: 'https://api.dev.hypercli.com',
    });

    expect((client.deployments as any).agentApiBase).toBe('https://api.dev.hypercli.com/agents');
    expect(client.agent.baseUrl).toBe('https://api.agents.dev.hypercli.com/v1');
  });

  it('should expose HyperAgent from the browser-safe client', () => {
    const client = new BrowserHyperCLI({
      apiUrl: 'https://api.hypercli.com',
      token: 'hyper_api_test_key',
    });

    expect(client.agent).toBeDefined();
    expect(client.agent.apiKey).toBe('hyper_api_test_key');
    expect(client.agent.controlBaseUrl).toBe('https://api.hypercli.com/agents');
    expect(client.agent.baseUrl).toBe('https://api.agents.hypercli.com/v1');
  });

  it('should fetch compact platform status from /status', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        ok: false,
        checked_at: '2026-06-16T10:00:00Z',
        models: { 'qwen3-tts': true },
        clusters: { large: false },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const client = new HyperCLI({
      apiKey: 'hyper_api_test_key',
      apiUrl: 'https://api.example.com',
    });

    await expect(client.status()).resolves.toEqual({
      ok: false,
      checkedAt: '2026-06-16T10:00:00Z',
      models: { 'qwen3-tts': true },
      clusters: { large: false },
    });
    expect(calls).toEqual(['https://api.example.com/status']);
  });
});
