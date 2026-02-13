import { describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';

describe('HyperClaw API', () => {
  const client = new HyperCLI();

  it.skip('should list models (requires HyperClaw API key)', async () => {
    const models = await client.claw.models();
    
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    
    if (models.length > 0) {
      const model = models[0];
      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('name');
    }
  });

  it.skip('should list plans (requires HyperClaw API key)', async () => {
    const plans = await client.claw.plans();
    
    expect(Array.isArray(plans)).toBe(true);
    expect(plans.length).toBeGreaterThan(0);
    
    if (plans.length > 0) {
      const plan = plans[0];
      expect(plan).toHaveProperty('id');
      expect(plan).toHaveProperty('name');
    }
  });

  it.skip('should get key status (requires HyperClaw API key)', async () => {
    const status = await client.claw.keyStatus();
    
    expect(status).toBeDefined();
    expect(typeof status).toBe('object');
  });
});
