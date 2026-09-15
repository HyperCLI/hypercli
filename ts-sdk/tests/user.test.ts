import { describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';

describe('User API', () => {
  const liveIt = process.env.HYPER_API_KEY ? it : it.skip;
let client: HyperCLI;

function getClient(): HyperCLI {
  if (!client) client = new HyperCLI({ apiKey: process.env.HYPER_API_KEY });
  return client;
}

  liveIt('should get user info', async () => {
    const user = await getClient().user.get();
    
    expect(user).toBeDefined();
    expect(user.userId).toBeDefined();
    expect(typeof user.userId).toBe('string');
    // email can be null or string
    if (user.email !== null) {
      expect(typeof user.email).toBe('string');
    }
  });
});
