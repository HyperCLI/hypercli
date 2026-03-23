import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  getApiKey,
  getAgentApiKey,
  getApiUrl,
  getAgentsApiBaseUrl,
  getAgentsWsUrl,
  getWsUrl,
  DEFAULT_API_URL,
  DEFAULT_AGENTS_API_BASE_URL,
  DEFAULT_AGENTS_WS_URL,
} from '../src/config.js';

describe('Config', () => {
  const originalHyperApiKey = process.env.HYPER_API_KEY;
  const originalApiKey = process.env.HYPERCLI_API_KEY;
  const originalHyperApiBase = process.env.HYPER_API_BASE;
  const originalApiUrl = process.env.HYPERCLI_API_URL;
  const originalAgentsApiKey = process.env.HYPER_AGENTS_API_KEY;
  const originalWsUrl = process.env.HYPERCLI_WS_URL;
  const originalAgentsApiBaseUrl = process.env.AGENTS_API_BASE_URL;
  const originalAgentsWsUrl = process.env.AGENTS_WS_URL;

  beforeEach(() => {
    process.env.HYPER_API_KEY = 'hyper_api_test_key';
    delete process.env.HYPERCLI_API_KEY;
    delete process.env.HYPER_API_BASE;
    delete process.env.HYPERCLI_API_URL;
    delete process.env.HYPER_AGENTS_API_KEY;
    delete process.env.HYPERCLI_WS_URL;
    delete process.env.AGENTS_API_BASE_URL;
    delete process.env.AGENTS_WS_URL;
  });

  afterEach(() => {
    if (originalHyperApiKey === undefined) delete process.env.HYPER_API_KEY;
    else process.env.HYPER_API_KEY = originalHyperApiKey;

    if (originalApiKey === undefined) delete process.env.HYPERCLI_API_KEY;
    else process.env.HYPERCLI_API_KEY = originalApiKey;

    if (originalHyperApiBase === undefined) delete process.env.HYPER_API_BASE;
    else process.env.HYPER_API_BASE = originalHyperApiBase;

    if (originalApiUrl === undefined) delete process.env.HYPERCLI_API_URL;
    else process.env.HYPERCLI_API_URL = originalApiUrl;

    if (originalAgentsApiKey === undefined) delete process.env.HYPER_AGENTS_API_KEY;
    else process.env.HYPER_AGENTS_API_KEY = originalAgentsApiKey;

    if (originalWsUrl === undefined) delete process.env.HYPERCLI_WS_URL;
    else process.env.HYPERCLI_WS_URL = originalWsUrl;

    if (originalAgentsApiBaseUrl === undefined) delete process.env.AGENTS_API_BASE_URL;
    else process.env.AGENTS_API_BASE_URL = originalAgentsApiBaseUrl;

    if (originalAgentsWsUrl === undefined) delete process.env.AGENTS_WS_URL;
    else process.env.AGENTS_WS_URL = originalAgentsWsUrl;
  });

  it('should return API key from env', () => {
    const key = getApiKey();
    expect(key).toBeDefined();
    expect(typeof key).toBe('string');
    expect(key).toMatch(/^hyper_api_/);
  });

  it('should prefer agent API key for agent surfaces', () => {
    process.env.HYPER_AGENTS_API_KEY = 'sk-agent';
    expect(getAgentApiKey()).toBe('sk-agent');
    expect(getApiKey()).toBe('hyper_api_test_key');
  });

  it('should return default API URL', () => {
    const url = getApiUrl();
    expect(url).toBe(DEFAULT_API_URL);
  });

  it('should derive WebSocket URL from API URL', () => {
    const wsUrl = getWsUrl();
    expect(wsUrl).toBeDefined();
    expect(wsUrl).toMatch(/^wss?:\/\//);
  });

  it('should return default agents URLs', () => {
    expect(getAgentsApiBaseUrl()).toBe(DEFAULT_AGENTS_API_BASE_URL);
    expect(getAgentsWsUrl()).toBe(DEFAULT_AGENTS_WS_URL);
    expect(getAgentsApiBaseUrl(true)).toBe('https://api.dev.hypercli.com/agents');
    expect(getAgentsWsUrl(true)).toBe('wss://api.agents.dev.hypercli.com/ws');
  });

  it('should respect agents env overrides', () => {
    process.env.AGENTS_API_BASE_URL = 'https://api.dev.hypercli.com/agents';
    process.env.AGENTS_WS_URL = 'wss://api.agents.dev.hypercli.com/ws';

    expect(getAgentsApiBaseUrl()).toBe('https://api.dev.hypercli.com/agents');
    expect(getAgentsWsUrl()).toBe('wss://api.agents.dev.hypercli.com/ws');
  });

  it('should derive agents endpoints from product base when direct base is unset', () => {
    process.env.HYPER_API_BASE = 'https://api.dev.hypercli.com';

    expect(getAgentsApiBaseUrl()).toBe('https://api.dev.hypercli.com/agents');
    expect(getAgentsWsUrl()).toBe('wss://api.agents.dev.hypercli.com/ws');
  });
});
