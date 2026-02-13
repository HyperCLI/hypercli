import { describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';

describe('Instances API', () => {
  const client = new HyperCLI();

  it('should list GPU types', async () => {
    const gpuTypesDict = await client.instances.types();
    const gpuTypes = Object.values(gpuTypesDict);
    
    expect(gpuTypes.length).toBeGreaterThan(0);
    
    // Check for known GPU types
    expect(gpuTypesDict).toHaveProperty('l40s');
    expect(gpuTypesDict).toHaveProperty('h100');
  });

  it('should list regions', async () => {
    const regionsDict = await client.instances.regions();
    const regions = Object.values(regionsDict);
    
    expect(regions.length).toBeGreaterThan(0);
    
    // Check for known regions
    expect(regionsDict).toHaveProperty('oh');
    expect(regionsDict).toHaveProperty('va');
  });

  it('should get pricing', async () => {
    const pricing = await client.instances.pricing();
    
    expect(pricing).toBeDefined();
    expect(typeof pricing).toBe('object');
    
    // Should have pricing for known GPU types (keys are uppercase)
    const keys = Object.keys(pricing);
    expect(keys.length).toBeGreaterThan(0);
    
    // Check for L40S (uppercase)
    const l40sKey = keys.find(k => k.toLowerCase() === 'l40s');
    if (l40sKey) {
      expect(pricing[l40sKey]).toHaveProperty('spot');
      expect(pricing[l40sKey]).toHaveProperty('onDemand');
    }
  });

  it('should get capacity', async () => {
    const capacity = await client.instances.capacity();
    
    expect(capacity).toBeDefined();
    expect(typeof capacity).toBe('object');
    
    // Capacity might be an object or array depending on the API response
  });
});
