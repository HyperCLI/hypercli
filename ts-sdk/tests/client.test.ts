import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';

describe('HyperCLI Client', () => {
  const originalHyperApiKey = process.env.HYPER_API_KEY;
  const originalApiKey = process.env.HYPERCLI_API_KEY;
  const originalAgentApiKey = process.env.HYPER_AGENTS_API_KEY;
  const originalAgentsApiBaseUrl = process.env.AGENTS_API_BASE_URL;

  beforeEach(() => {
    process.env.HYPER_API_KEY = 'hyper_api_test_key';
    delete process.env.HYPERCLI_API_KEY;
    delete process.env.HYPER_AGENTS_API_KEY;
    delete process.env.AGENTS_API_BASE_URL;
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
});
