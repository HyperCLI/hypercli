import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  getApiKey,
  getApiUrl,
  getAgentsApiBaseUrl,
  getAgentsWsUrl,
  getWsUrl,
  DEFAULT_API_URL,
  DEFAULT_AGENTS_API_BASE_URL,
  DEFAULT_AGENTS_WS_URL,
} from '../src/config.js';

describe('Config', () => {
  const originalApiKey = process.env.HYPERCLI_API_KEY;
  const originalApiUrl = process.env.HYPERCLI_API_URL;
  const originalWsUrl = process.env.HYPERCLI_WS_URL;
  const originalAgentsApiBaseUrl = process.env.AGENTS_API_BASE_URL;
  const originalAgentsWsUrl = process.env.AGENTS_WS_URL;

  beforeEach(() => {
    process.env.HYPERCLI_API_KEY = 'hyper_api_test_key';
    delete process.env.HYPERCLI_API_URL;
    delete process.env.HYPERCLI_WS_URL;
    delete process.env.AGENTS_API_BASE_URL;
    delete process.env.AGENTS_WS_URL;
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.HYPERCLI_API_KEY;
    else process.env.HYPERCLI_API_KEY = originalApiKey;

    if (originalApiUrl === undefined) delete process.env.HYPERCLI_API_URL;
    else process.env.HYPERCLI_API_URL = originalApiUrl;

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
    expect(getAgentsApiBaseUrl(true)).toBe('https://api.agents.dev.hypercli.com/api');
    expect(getAgentsWsUrl(true)).toBe('wss://api.agents.dev.hypercli.com/ws');
  });

  it('should respect agents env overrides', () => {
    process.env.AGENTS_API_BASE_URL = 'https://api.agents.dev.hypercli.com/api';
    process.env.AGENTS_WS_URL = 'wss://api.agents.dev.hypercli.com/ws';

    expect(getAgentsApiBaseUrl()).toBe('https://api.agents.dev.hypercli.com/api');
    expect(getAgentsWsUrl()).toBe('wss://api.agents.dev.hypercli.com/ws');
  });
});
