import { describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';

describe('User API', () => {
  const client = new HyperCLI();

  it('should get user info', async () => {
    const user = await client.user.get();
    
    expect(user).toBeDefined();
    expect(user.userId).toBeDefined();
    expect(typeof user.userId).toBe('string');
    // email can be null or string
    if (user.email !== null) {
      expect(typeof user.email).toBe('string');
    }
  });
});
