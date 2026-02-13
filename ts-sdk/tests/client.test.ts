import { describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';
import { getApiKey } from '../src/config.js';

describe('HyperCLI Client', () => {
  it('should construct client with env var/config file', () => {
    const client = new HyperCLI();
    expect(client).toBeDefined();
    expect(client.jobs).toBeDefined();
    expect(client.billing).toBeDefined();
    expect(client.instances).toBeDefined();
  });

  it('should construct client with explicit API key', () => {
    const apiKey = getApiKey();
    const client = new HyperCLI({ apiKey });
    expect(client).toBeDefined();
  });

  it('should throw error with empty API key', () => {
    expect(() => new HyperCLI({ apiKey: '' })).toThrow();
  });
});
