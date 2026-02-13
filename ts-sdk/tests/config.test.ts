import { describe, it, expect } from 'vitest';
import { getApiKey, getApiUrl, getWsUrl, DEFAULT_API_URL } from '../src/config.js';

describe('Config', () => {
  it('should return API key from config file', () => {
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
