/**
 * Billing API - balance and transactions
 */
import type { HTTPClient } from './http.js';

export interface Balance {
  total: string;
  rewards: string;
  paid: string;
  available: string;
  pendingReservations?: string;
  currency?: string;
  decimals?: number;
  userId?: string;
}

export interface Transaction {
  id: string;
  userId: string;
  amount: number;
  amountUsd: string;
  transactionType: string;
  status: string;
  rewards: boolean;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  meta: Record<string, any> | null;
}

export interface ListTransactionsOptions {
  page?: number;
  pageSize?: number;
  transactionType?: string;
  status?: string;
  jobId?: string;
}

export interface TransactionListResponse {
  transactions: Transaction[];
  totalCount: number;
}

export interface TopUpCheckoutSession {
  sessionId: string;
  checkoutUrl: string;
}

function balanceFromDict(data: any): Balance {
  return {
    total: data.total_balance || '0',
    rewards: data.rewards_balance || '0',
    paid: data.balance || '0',
    available: data.available_balance || '0',
    pendingReservations: data.pending_reservations || '0',
    currency: data.currency || 'USD',
    decimals: data.decimals ?? 2,
    userId: data.user_id || '',
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
    updatedAt: data.updated_at || '',
    expiresAt: data.expires_at || null,
    meta: data.meta || null,
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
   * Alias for balance() when callers want the richer shape explicitly.
   */
  async balanceDetails(): Promise<Balance> {
    return this.balance();
  }

  /**
   * List transactions
   */
  async transactions(limit: number = 50, page: number = 1): Promise<Transaction[]> {
    const data = await this.listTransactions({ page, pageSize: limit });
    return data.transactions;
  }

  /**
   * List transactions with filters and pagination metadata.
   */
  async listTransactions(options: ListTransactionsOptions = {}): Promise<TransactionListResponse> {
    const params: Record<string, string> = {
      page: String(options.page ?? 1),
      page_size: String(options.pageSize ?? 50),
    };
    if (options.transactionType) params.transaction_type = options.transactionType;
    if (options.status) params.status = options.status;
    if (options.jobId) params.job_id = options.jobId;

    const data = await this.http.get('/api/tx', params);
    const txList = data.transactions || [];
    return {
      transactions: txList.map(transactionFromDict),
      totalCount: data.total_count || txList.length,
    };
  }

  /**
   * Get a specific transaction
   */
  async getTransaction(transactionId: string): Promise<Transaction> {
    const data = await this.http.get(`/api/tx/${transactionId}`);
    return transactionFromDict(data);
  }

  /**
   * Create a Stripe Checkout session for balance top-ups.
   */
  async createTopUpCheckout(amount: number): Promise<TopUpCheckoutSession> {
    const data = await this.http.post('/api/stripe/top_up', { amount });
    return {
      sessionId: data.session_id || '',
      checkoutUrl: data.checkout_url || '',
    };
  }
}
