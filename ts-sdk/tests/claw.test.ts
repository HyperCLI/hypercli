import { describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';
import { HyperAgent } from '../src/agent.js';

describe('HyperAgent API', () => {
  const client = new HyperCLI();

  it('exposes HyperAgent as the primary inference client', () => {
    expect(client.agent).toBeInstanceOf(HyperAgent);
  });

  it('derives the inference base from the agents API base', () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', false, 'https://api.hypercli.com/agents');
    expect(agent.baseUrl).toBe('https://api.agents.hypercli.com/v1');
  });

  it('normalizes generic dev API hosts onto the dev agents host', () => {
    const http = { apiKey: 'hyper_api_test_key', baseUrl: 'https://api.dev.hypercli.com' } as any;
    const agent = new HyperAgent(http, 'sk-hyper-test', true, 'https://api.dev.hypercli.com');
    expect(agent.baseUrl).toBe('https://api.agents.dev.hypercli.com/v1');
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
});
