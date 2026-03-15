import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { getApiKey, getApiUrl, getWsUrl, DEFAULT_API_URL } from '../src/config.js';

describe('Config', () => {
  const originalApiKey = process.env.HYPERCLI_API_KEY;
  const originalApiUrl = process.env.HYPERCLI_API_URL;
  const originalWsUrl = process.env.HYPERCLI_WS_URL;

  beforeEach(() => {
    process.env.HYPERCLI_API_KEY = 'hyper_api_test_key';
    delete process.env.HYPERCLI_API_URL;
    delete process.env.HYPERCLI_WS_URL;
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.HYPERCLI_API_KEY;
    else process.env.HYPERCLI_API_KEY = originalApiKey;

    if (originalApiUrl === undefined) delete process.env.HYPERCLI_API_URL;
    else process.env.HYPERCLI_API_URL = originalApiUrl;

    if (originalWsUrl === undefined) delete process.env.HYPERCLI_WS_URL;
    else process.env.HYPERCLI_WS_URL = originalWsUrl;
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
});
