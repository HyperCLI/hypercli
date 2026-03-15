import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';

describe('HyperCLI Client', () => {
  const originalApiKey = process.env.HYPERCLI_API_KEY;

  beforeEach(() => {
    process.env.HYPERCLI_API_KEY = 'hyper_api_test_key';
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.HYPERCLI_API_KEY;
    else process.env.HYPERCLI_API_KEY = originalApiKey;
  });

  it('should construct client with env var/config file', () => {
    const client = new HyperCLI();
    expect(client).toBeDefined();
    expect(client.agent).toBeDefined();
    expect(client.jobs).toBeDefined();
    expect(client.billing).toBeDefined();
    expect(client.instances).toBeDefined();
  });

  it('should construct client with explicit API key', () => {
    const client = new HyperCLI({ apiKey: 'hyper_api_explicit_test_key' });
    expect(client).toBeDefined();
  });

  it('should throw error with empty API key', () => {
    expect(() => new HyperCLI({ apiKey: '' })).toThrow();
  });
});
