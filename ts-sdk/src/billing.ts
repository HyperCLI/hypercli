/**
 * Billing API - balance and transactions
 */
import type { HTTPClient } from './http.js';

export interface Balance {
  total: string;
  rewards: string;
  paid: string;
  available: string;
}

export interface Transaction {
  id: string;
  userId: string;
  amount: number;
  amountUsd: number;
  transactionType: string;
  status: string;
  rewards: boolean;
  jobId: string | null;
  createdAt: string;
}

function balanceFromDict(data: any): Balance {
  return {
    total: data.total_balance || '0',
    rewards: data.rewards_balance || '0',
    paid: data.balance || '0',
    available: data.available_balance || '0',
  };
}

function transactionFromDict(data: any): Transaction {
  return {
    id: data.id || '',
    userId: data.user_id || '',
    amount: data.amount || 0,
    amountUsd: data.amount_usd || 0,
    transactionType: data.transaction_type || '',
    status: data.status || '',
    rewards: data.rewards || false,
    jobId: data.job_id || null,
    createdAt: data.created_at || '',
  };
}

export class Billing {
  constructor(private http: HTTPClient) {}

  /**
   * Get account balance
   */
  async balance(): Promise<Balance> {
    const data = await this.http.get('/api/balance');
    return balanceFromDict(data);
  }

  /**
   * List transactions
   */
  async transactions(limit: number = 50, page: number = 1): Promise<Transaction[]> {
    const data = await this.http.get('/api/tx', {
      page: String(page),
      page_size: String(limit),
    });
    const txList = data.transactions || [];
    return txList.map(transactionFromDict);
  }

  /**
   * Get a specific transaction
   */
  async getTransaction(transactionId: string): Promise<Transaction> {
    const data = await this.http.get(`/api/tx/${transactionId}`);
    return transactionFromDict(data);
  }
}
