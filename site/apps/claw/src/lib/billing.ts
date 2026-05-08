import type {
  HyperAgent,
  HyperAgentBillingProfileFields,
  HyperAgentBillingProfileResponse,
  HyperAgentPayment,
} from "@hypercli.com/sdk/agent";

export interface AgentBillingUser {
  id: string;
  email: string | null;
  wallet_address: string | null;
  team_id: string | null;
  plan_id: string | null;
  billing_name?: string | null;
  billing_company?: string | null;
  billing_tax_id?: string | null;
  billing_line1?: string | null;
  billing_line2?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_postal_code?: string | null;
  billing_country?: string | null;
}

export interface AgentBillingSubscription {
  id: string;
  plan_id: string;
  provider: string;
  status: string;
  current_period_end?: string | null;
  expires_at?: string | null;
  stripe_subscription_id: string | null;
}

export interface AgentBillingEntitlement {
  id: string;
  plan_id: string;
  provider: string;
  status: string;
  expires_at: string | null;
  agent_tier: string | null;
  features: Record<string, boolean>;
  tags: string[];
}

export interface AgentPayment {
  id: string;
  user_id: string;
  subscription_id: string | null;
  entitlement_id: string | null;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  external_payment_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  user: AgentBillingUser | null;
  subscription: AgentBillingSubscription | null;
  entitlement: AgentBillingEntitlement | null;
}

export interface AgentPaymentsResponse {
  items: AgentPayment[];
}

export interface AgentBillingProfileFields {
  billing_name: string | null;
  billing_company: string | null;
  billing_tax_id: string | null;
  billing_line1: string | null;
  billing_line2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_postal_code: string | null;
  billing_country: string | null;
}

export interface AgentBillingProfileResponse {
  company_billing: {
    address: string[];
    email: string;
  };
  profile: AgentBillingProfileFields | null;
  synced_stripe_customer_ids?: string[];
}

function isoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function fromSdkProfileFields(profile: HyperAgentBillingProfileFields): AgentBillingProfileFields {
  return {
    billing_name: profile.billingName,
    billing_company: profile.billingCompany,
    billing_tax_id: profile.billingTaxId,
    billing_line1: profile.billingLine1,
    billing_line2: profile.billingLine2,
    billing_city: profile.billingCity,
    billing_state: profile.billingState,
    billing_postal_code: profile.billingPostalCode,
    billing_country: profile.billingCountry,
  };
}

function toSdkProfileFields(profile: AgentBillingProfileFields): HyperAgentBillingProfileFields {
  return {
    billingName: profile.billing_name,
    billingCompany: profile.billing_company,
    billingTaxId: profile.billing_tax_id,
    billingLine1: profile.billing_line1,
    billingLine2: profile.billing_line2,
    billingCity: profile.billing_city,
    billingState: profile.billing_state,
    billingPostalCode: profile.billing_postal_code,
    billingCountry: profile.billing_country,
  };
}

function fromSdkBillingProfile(response: HyperAgentBillingProfileResponse): AgentBillingProfileResponse {
  return {
    company_billing: {
      address: response.companyBilling.address,
      email: response.companyBilling.email,
    },
    profile: response.profile ? fromSdkProfileFields(response.profile) : null,
    synced_stripe_customer_ids: response.syncedStripeCustomerIds,
  };
}

function fromSdkPayment(payment: HyperAgentPayment): AgentPayment {
  return {
    id: payment.id,
    user_id: payment.userId,
    subscription_id: payment.subscriptionId,
    entitlement_id: payment.entitlementId,
    provider: payment.provider,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    external_payment_id: payment.externalPaymentId,
    created_at: isoDate(payment.createdAt),
    updated_at: isoDate(payment.updatedAt),
    user: payment.user
      ? {
          id: payment.user.id,
          email: payment.user.email,
          wallet_address: payment.user.walletAddress,
          team_id: payment.user.teamId,
          plan_id: payment.user.planId,
          billing_name: payment.user.billingName,
          billing_company: payment.user.billingCompany,
          billing_tax_id: payment.user.billingTaxId,
          billing_line1: payment.user.billingLine1,
          billing_line2: payment.user.billingLine2,
          billing_city: payment.user.billingCity,
          billing_state: payment.user.billingState,
          billing_postal_code: payment.user.billingPostalCode,
          billing_country: payment.user.billingCountry,
        }
      : null,
    subscription: payment.subscription
      ? {
          id: payment.subscription.id,
          plan_id: payment.subscription.planId,
          provider: payment.subscription.provider,
          status: payment.subscription.status,
          current_period_end: isoDate(payment.subscription.currentPeriodEnd),
          expires_at: isoDate(payment.subscription.currentPeriodEnd),
          stripe_subscription_id: payment.subscription.stripeSubscriptionId,
        }
      : null,
    entitlement: payment.entitlement
      ? {
          id: payment.entitlement.id,
          plan_id: payment.entitlement.planId,
          provider: payment.entitlement.provider,
          status: payment.entitlement.status,
          expires_at: isoDate(payment.entitlement.expiresAt),
          agent_tier: payment.entitlement.agentTier,
          features: payment.entitlement.features,
          tags: payment.entitlement.tags,
        }
      : null,
  };
}

export async function getAgentPayments(hyperAgent: HyperAgent): Promise<AgentPaymentsResponse> {
  const response = await hyperAgent.payments();
  return { items: response.items.map(fromSdkPayment) };
}

export async function getAgentPayment(hyperAgent: HyperAgent, paymentId: string): Promise<AgentPayment> {
  return fromSdkPayment(await hyperAgent.payment(paymentId));
}

export async function getAgentBillingProfile(hyperAgent: HyperAgent): Promise<AgentBillingProfileResponse> {
  return fromSdkBillingProfile(await hyperAgent.billingProfile());
}

export async function updateAgentBillingProfile(
  hyperAgent: HyperAgent,
  profile: AgentBillingProfileFields,
): Promise<AgentBillingProfileResponse> {
  return fromSdkBillingProfile(await hyperAgent.updateBillingProfile(toSdkProfileFields(profile)));
}

export function resolveAgentPaymentPlanId(payment: AgentPayment): string | null {
  return payment.subscription?.plan_id ?? payment.entitlement?.plan_id ?? payment.user?.plan_id ?? null;
}
