import { agentApiFetch } from "@/lib/api";

export interface AgentBillingUser {
  id: string;
  email: string | null;
  wallet_address: string | null;
  team_id: string | null;
  plan_id: string | null;
}

export interface AgentBillingSubscription {
  id: string;
  plan_id: string;
  provider: string;
  status: string;
  expires_at: string | null;
  stripe_subscription_id: string | null;
}

export interface AgentPayment {
  id: string;
  user_id: string;
  subscription_id: string | null;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  external_payment_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  user: AgentBillingUser | null;
  subscription: AgentBillingSubscription | null;
}

export interface AgentPaymentsResponse {
  items: AgentPayment[];
}

export async function getAgentPayments(token: string): Promise<AgentPaymentsResponse> {
  return agentApiFetch<AgentPaymentsResponse>("/billing/payments", token);
}

export async function getAgentPayment(token: string, paymentId: string): Promise<AgentPayment> {
  return agentApiFetch<AgentPayment>(`/billing/payments/${paymentId}`, token);
}
