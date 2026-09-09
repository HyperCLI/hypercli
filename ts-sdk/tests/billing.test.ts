import { describe, it, expect } from 'vitest';
import { HyperCLI } from '../src/client.js';

describe('Billing API', () => {
  const liveIt = process.env.HYPER_API_KEY ? it : it.skip;
let client: HyperCLI;

function getClient(): HyperCLI {
  if (!client) client = new HyperCLI({ apiKey: process.env.HYPER_API_KEY });
  return client;
}

  liveIt('should fetch balance', async () => {
    const balance = await getClient().billing.balance();
    
    expect(balance).toBeDefined();
    // Balances are returned as strings
    expect(typeof balance.total).toBe('string');
    expect(typeof balance.rewards).toBe('string');
    expect(typeof balance.paid).toBe('string');
    expect(typeof balance.available).toBe('string');
  });

  liveIt('should fetch transactions', async () => {
    const transactions = await getClient().billing.transactions();
    
    expect(Array.isArray(transactions)).toBe(true);
    
    if (transactions.length > 0) {
      const tx = transactions[0];
      expect(tx).toHaveProperty('id');
      expect(tx).toHaveProperty('amount');
      expect(tx).toHaveProperty('transactionType');
      expect(tx).toHaveProperty('createdAt');
    }
  });
});
