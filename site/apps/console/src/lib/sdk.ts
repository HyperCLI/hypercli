import { BrowserHyperCLI } from "@hypercli.com/sdk/browser";
import { getAuthBackendUrl } from "@hypercli/shared-ui";

export interface ConsoleUserProfile {
  user_id: string;
  name: string | null;
  email: string | null;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  user_type: string;
  meta: string | null;
}

export interface ConsoleBalance {
  user_id: string;
  balance: string;
  balance_units: number;
  rewards_balance: string;
  rewards_balance_units: number;
  total_balance: string;
  total_balance_units: number;
  available_balance: string;
  available_balance_units: number;
  pending_reservations: string;
  pending_reservations_units: number;
  currency: string;
  decimals: number;
}

export interface ConsoleTransaction {
  id: string;
  user_id: string;
  amount: number;
  amount_usd: string;
  transaction_type: string;
  status: string;
  rewards: boolean;
  expires_at: string | null;
  job_id: string | null;
  meta: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface ConsoleTransactionsResponse {
  transactions: ConsoleTransaction[];
  total_count: number;
}

export interface ConsoleApiKey {
  key_id: string;
  name: string;
  api_key: string | null;
  api_key_preview: string | null;
  last4: string | null;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

function getAuthToken(): string | null {
  if (typeof document === "undefined") return null;
  return (
    document.cookie
      .split("; ")
      .find((row) => row.startsWith("auth_token="))
      ?.split("=")[1] ?? null
  );
}

function getApiBaseUrl(): string {
  const authBackend = getAuthBackendUrl();
  return authBackend.replace(/\/api\/?$/, "");
}

function requireClient(): BrowserHyperCLI {
  const token = getAuthToken();
  if (!token) {
    throw new Error("No auth token found");
  }

  return new BrowserHyperCLI({
    apiUrl: getApiBaseUrl(),
    token,
  });
}

export async function getConsoleUserProfile(): Promise<ConsoleUserProfile> {
  const user = await requireClient().user.get();
  return {
    user_id: user.userId,
    name: user.name,
    email: user.email,
    email_verified: user.emailVerified ?? false,
    created_at: user.createdAt,
    updated_at: user.updatedAt ?? user.createdAt,
    is_active: user.isActive,
    user_type: user.userType ?? "",
    meta: user.meta ?? null,
  };
}

export async function updateConsoleUserProfile(
  updates: { name?: string; email?: string }
): Promise<ConsoleUserProfile> {
  const user = await requireClient().user.update(updates);
  return {
    user_id: user.userId,
    name: user.name,
    email: user.email,
    email_verified: user.emailVerified ?? false,
    created_at: user.createdAt,
    updated_at: user.updatedAt ?? user.createdAt,
    is_active: user.isActive,
    user_type: user.userType ?? "",
    meta: user.meta ?? null,
  };
}

export async function getConsoleBalance(): Promise<ConsoleBalance> {
  const balance = await requireClient().billing.balanceDetails();
  const decimals = balance.decimals ?? 2;
  return {
    user_id: balance.userId ?? "",
    balance: balance.paid,
    balance_units: Math.round(Number(balance.paid || "0") * 10 ** decimals),
    rewards_balance: balance.rewards,
    rewards_balance_units: Math.round(Number(balance.rewards || "0") * 10 ** decimals),
    total_balance: balance.total,
    total_balance_units: Math.round(Number(balance.total || "0") * 10 ** decimals),
    available_balance: balance.available,
    available_balance_units: Math.round(Number(balance.available || "0") * 10 ** decimals),
    pending_reservations: balance.pendingReservations ?? "0",
    pending_reservations_units: Math.round(
      Number(balance.pendingReservations || "0") * 10 ** decimals
    ),
    currency: balance.currency ?? "USD",
    decimals,
  };
}

export async function getConsoleTransactions(options: {
  page?: number;
  pageSize?: number;
  transactionType?: string;
  status?: string;
  jobId?: string;
} = {}): Promise<ConsoleTransactionsResponse> {
  const data = await requireClient().billing.listTransactions(options);
  return {
    transactions: data.transactions.map((tx) => ({
      id: tx.id,
      user_id: tx.userId,
      amount: tx.amount,
      amount_usd: tx.amountUsd,
      transaction_type: tx.transactionType,
      status: tx.status,
      rewards: tx.rewards,
      expires_at: tx.expiresAt,
      job_id: tx.jobId,
      meta: tx.meta,
      created_at: tx.createdAt,
      updated_at: tx.updatedAt,
    })),
    total_count: data.totalCount,
  };
}

export async function getConsoleApiKeys(): Promise<ConsoleApiKey[]> {
  const keys = await requireClient().keys.list();
  return keys.map((key) => ({
    key_id: key.keyId,
    name: key.name,
    api_key: key.apiKey,
    api_key_preview: key.apiKeyPreview,
    last4: key.last4,
    is_active: key.isActive,
    created_at: key.createdAt,
    last_used_at: key.lastUsedAt,
  }));
}

export async function createConsoleApiKey(name: string): Promise<ConsoleApiKey> {
  const key = await requireClient().keys.create(name);
  return {
    key_id: key.keyId,
    name: key.name,
    api_key: key.apiKey,
    api_key_preview: key.apiKeyPreview,
    last4: key.last4,
    is_active: key.isActive,
    created_at: key.createdAt,
    last_used_at: key.lastUsedAt,
  };
}

export async function disableConsoleApiKey(keyId: string): Promise<void> {
  await requireClient().keys.disable(keyId);
}
