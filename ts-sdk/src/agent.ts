/**
 * HyperAgent API client - AI agent inference using OpenAI-compatible API
 *
 * Note: OpenAI client integration is not included in this SDK.
 * Use the OpenAI Node.js SDK directly with HyperClaw endpoints.
 */
import type { HTTPClient } from './http.js';
import { getAgentsApiBaseUrl } from './config.js';

function resolveHyperAgentBaseUrl(agentsApiBaseUrl: string | undefined, dev: boolean): string {
  const raw = (agentsApiBaseUrl || '').replace(/\/+$/, '');
  if (!raw) {
    const fallback = getAgentsApiBaseUrl(dev);
    return resolveHyperAgentBaseUrl(fallback, dev);
  }
  const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
  const host = parsed.host.toLowerCase();
  if (host === 'api.hypercli.com' || host === 'api.hyperclaw.app' || host === 'api.agents.hypercli.com') {
    return 'https://api.agents.hypercli.com/v1';
  }
  if (
    host === 'api.dev.hypercli.com' ||
    host === 'api.dev.hyperclaw.app' ||
    host === 'dev-api.hyperclaw.app' ||
    host === 'api.agents.dev.hypercli.com'
  ) {
    return 'https://api.agents.dev.hypercli.com/v1';
  }
  if (raw.endsWith('/api')) {
    return `${raw.slice(0, -4)}/v1`;
  }
  if (raw.endsWith('/agents')) {
    return `${raw.slice(0, -7)}/v1`;
  }
  return `${raw}/v1`;
}

function resolveHyperAgentControlBaseUrl(
  productApiBaseUrl: string | undefined,
  agentsApiBaseUrl: string | undefined,
  dev: boolean,
): string {
  const rawAgents = (agentsApiBaseUrl || '').replace(/\/+$/, '');
  if (!rawAgents) {
    const fallback = getAgentsApiBaseUrl(dev);
    return resolveHyperAgentControlBaseUrl(undefined, fallback, dev);
  }
  const parsed = new URL(rawAgents.includes('://') ? rawAgents : `https://${rawAgents}`);
  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  const host = parsed.host.toLowerCase();
  if (normalizedPath.endsWith('/agents')) {
    return `${parsed.origin}${normalizedPath}`;
  }
  if (host === 'api.hypercli.com' || host === 'api.hyperclaw.app' || host === 'api.agents.hypercli.com') {
    return 'https://api.hypercli.com/agents';
  }
  if (
    host === 'api.dev.hypercli.com' ||
    host === 'api.dev.hyperclaw.app' ||
    host === 'dev-api.hyperclaw.app' ||
    host === 'api.agents.dev.hypercli.com'
  ) {
    return 'https://api.dev.hypercli.com/agents';
  }
  return `${parsed.origin}/agents`;
}

export interface HyperAgentPlan {
  id: string;
  name: string;
  price: number;
  priceUsd: number;
  aiu: number;
  agents: number;
  features: string[];
  models: string[];
  highlighted?: boolean;
  expiresAt?: Date | null;
  limits: {
    tpd: number;
    tpm: number;
    burstTpm: number;
    rpm: number;
  };
  tpmLimit: number;
  rpmLimit: number;
}

export interface HyperAgentCurrentPlan {
  id: string;
  name: string;
  price: number | string;
  aiu?: number;
  agents?: number;
  tpmLimit: number;
  rpmLimit: number;
  expiresAt: Date | null;
  cancelAtPeriodEnd: boolean;
  provider?: string;
  secondsRemaining?: number | null;
  pooledTpd?: number;
  slotInventory?: Record<string, { granted: number; used: number; available: number }>;
}

export interface HyperAgentSubscription {
  id: string;
  userId: string;
  planId: string;
  planName: string;
  provider: string;
  status: string;
  quantity: number;
  expiresAt: Date | null;
  updatedAt: Date | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  canCancel: boolean;
  isCurrent: boolean;
  meta: Record<string, any> | null;
  planTpmLimit: number;
  planRpmLimit: number;
  planTpd: number;
  planAgentTier: string | null;
  slotGrants: Record<string, number> | null;
  entitlements?: HyperAgentEntitlement[];
}

export interface HyperAgentEntitlement {
  id: string;
  userId: string;
  subscriptionId: string | null;
  planId: string;
  planName: string;
  provider: string;
  status: string;
  expiresAt: Date | null;
  updatedAt: Date | null;
  tpmLimit: number;
  rpmLimit: number;
  tpdLimit: number;
  agentTier: string | null;
  features: Record<string, boolean>;
  tags: string[];
  meta: Record<string, any> | null;
  slotGrants: Record<string, number> | null;
  activeAgentCount: number;
  activeAgentIds: string[];
}

export interface HyperAgentEntitlements {
  effectivePlanId: string;
  pooledTpmLimit: number;
  pooledRpmLimit: number;
  pooledTpd: number;
  slotInventory: Record<string, { granted: number; used: number; available: number }>;
  activeEntitlementCount: number;
  billingResetAt: Date | null;
}

export interface HyperAgentSubscriptionSummary {
  effectivePlanId: string;
  currentSubscriptionId: string | null;
  currentEntitlementId: string | null;
  pooledTpmLimit: number;
  pooledRpmLimit: number;
  pooledTpd: number;
  slotInventory: Record<string, { granted: number; used: number; available: number }>;
  billingResetAt: Date | null;
  activeSubscriptionCount: number;
  activeEntitlementCount: number;
  entitlements: HyperAgentEntitlements;
  entitlementItems: HyperAgentEntitlement[];
  activeSubscriptions: HyperAgentSubscription[];
  subscriptions: HyperAgentSubscription[];
  user: Record<string, any>;
}

export type HyperAgentEntitlementsSummary = HyperAgentSubscriptionSummary;

export interface HyperAgentSubscriptionMutationResult {
  ok: boolean;
  message: string;
  subscription?: HyperAgentSubscription;
}

export interface HyperAgentSubscriptionUpdateRequest {
  bundle?: Record<string, number>;
}

export interface HyperAgentModel {
  id: string;
  name: string;
  contextLength: number;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  supportsToolChoice: boolean;
}

export interface HyperAgentUsageSummary {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
  activeKeys: number;
  currentTpm: number;
  currentRpm: number;
  period: string;
}

export interface HyperAgentUsageHistoryEntry {
  date: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requests: number;
}

export interface HyperAgentUsageHistory {
  history: HyperAgentUsageHistoryEntry[];
  days: number;
}

export interface HyperAgentKeyUsageEntry {
  keyHash: string;
  name: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requests: number;
}

export interface HyperAgentKeyUsage {
  keys: HyperAgentKeyUsageEntry[];
  days: number;
}

export interface HyperAgentTypePreset {
  id: string;
  name: string;
  cpu: number;
  memory: number;
  cpuLimit: number;
  memoryLimit: number;
}

export interface HyperAgentTypePlan {
  id: string;
  name: string;
  price: number;
  agents: number;
  agentType: string;
  highlighted: boolean;
}

export interface HyperAgentTypeCatalog {
  types: HyperAgentTypePreset[];
  plans: HyperAgentTypePlan[];
}

export interface HyperAgentBillingProfileFields {
  billingName: string | null;
  billingCompany: string | null;
  billingTaxId: string | null;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingPostalCode: string | null;
  billingCountry: string | null;
}

export interface HyperAgentBillingInfo {
  address: string[];
  email: string;
}

export interface HyperAgentBillingProfileResponse {
  companyBilling: HyperAgentBillingInfo;
  profile: HyperAgentBillingProfileFields | null;
  syncedStripeCustomerIds?: string[];
}

export interface HyperAgentBillingUser {
  id: string;
  email: string | null;
  walletAddress: string | null;
  teamId: string | null;
  planId: string | null;
  billingName?: string | null;
  billingCompany?: string | null;
  billingTaxId?: string | null;
  billingLine1?: string | null;
  billingLine2?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingPostalCode?: string | null;
  billingCountry?: string | null;
}

export interface HyperAgentPaymentSubscription {
  id: string;
  planId: string;
  provider: string;
  status: string;
  currentPeriodEnd: Date | null;
  stripeSubscriptionId: string | null;
}

export interface HyperAgentPaymentEntitlement {
  id: string;
  planId: string;
  provider: string;
  status: string;
  expiresAt: Date | null;
  agentTier: string | null;
  features: Record<string, boolean>;
  tags: string[];
}

export interface HyperAgentPayment {
  id: string;
  userId: string;
  subscriptionId: string | null;
  entitlementId: string | null;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  externalPaymentId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  user: HyperAgentBillingUser | null;
  subscription: HyperAgentPaymentSubscription | null;
  entitlement: HyperAgentPaymentEntitlement | null;
}

export interface HyperAgentPaymentsResponse {
  items: HyperAgentPayment[];
}

export interface HyperAgentPaymentsOptions {
  limit?: number;
  provider?: string;
  status?: string;
}

export interface HyperAgentStripeCheckoutRequest {
  successUrl?: string;
  cancelUrl?: string;
  quantity?: number;
  bundle?: Record<string, number>;
}

export interface HyperAgentStripeCheckoutResponse {
  checkoutUrl: string;
}

export interface HyperAgentX402CheckoutRequest {
  quantity?: number;
  bundle?: Record<string, number>;
}

export interface HyperAgentX402CheckoutResponse {
  ok: boolean;
  key: string;
  planId: string;
  quantity: number;
  bundle: Record<string, number>;
  amountPaid: string;
  durationDays: number;
  expiresAt: Date | null;
  tpmLimit: number;
  rpmLimit: number;
}

function hyperAgentPlanFromDict(data: any): HyperAgentPlan {
  return {
    id: data.id,
    name: data.name,
    price: data.price ?? data.price_usd ?? 0,
    priceUsd: data.price_usd ?? data.price ?? 0,
    aiu: data.aiu ?? 0,
    agents: data.agents ?? 0,
    features: data.features || [],
    models: data.models || [],
    highlighted: Boolean(data.highlighted),
    expiresAt: data.expires_at ? new Date(String(data.expires_at).replace('Z', '+00:00')) : null,
    limits: {
      tpd: data.limits?.tpd || 0,
      tpm: data.limits?.tpm || 0,
      burstTpm: data.limits?.burst_tpm || 0,
      rpm: data.limits?.rpm || 0,
    },
    tpmLimit: data.tpm_limit || data.limits?.tpm || 0,
    rpmLimit: data.rpm_limit || data.limits?.rpm || 0,
  };
}

function hyperAgentCurrentPlanFromDict(data: any): HyperAgentCurrentPlan {
  return {
    id: data.id,
    name: data.name,
    price: data.price,
    aiu: data.aiu,
    agents: data.agents,
    tpmLimit: data.tpm_limit || 0,
    rpmLimit: data.rpm_limit || 0,
    expiresAt: data.expires_at ? new Date(String(data.expires_at).replace('Z', '+00:00')) : null,
    cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
    provider: data.provider || undefined,
    secondsRemaining: data.seconds_remaining ?? null,
    pooledTpd: data.pooled_tpd || 0,
    slotInventory: data.slot_inventory || undefined,
  };
}

function hyperAgentSubscriptionFromDict(data: any): HyperAgentSubscription {
  const periodEnd = data.current_period_end || data.expires_at || null;
  return {
    id: data.id || '',
    userId: data.user_id || '',
    planId: data.plan_id || '',
    planName: data.plan_name || data.plan_id || '',
    provider: data.provider || '',
    status: data.status || '',
    quantity: data.quantity || 1,
    expiresAt: periodEnd ? new Date(String(periodEnd).replace('Z', '+00:00')) : null,
    updatedAt: data.updated_at ? new Date(String(data.updated_at).replace('Z', '+00:00')) : null,
    stripeSubscriptionId: data.stripe_subscription_id || null,
    cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
    canCancel: Boolean(data.can_cancel),
    isCurrent: Boolean(data.is_current),
    meta: data.meta || null,
    planTpmLimit: data.plan_tpm_limit || 0,
    planRpmLimit: data.plan_rpm_limit || 0,
    planTpd: data.plan_tpd || 0,
    planAgentTier: data.plan_agent_tier || null,
    slotGrants: data.slot_grants || null,
    entitlements: (data.entitlements || []).map(hyperAgentEntitlementFromDict),
  };
}

function hyperAgentEntitlementFromDict(data: any): HyperAgentEntitlement {
  return {
    id: data.id || '',
    userId: data.user_id || '',
    subscriptionId: data.subscription_id || null,
    planId: data.plan_id || '',
    planName: data.plan_name || data.plan_id || '',
    provider: data.provider || '',
    status: data.status || '',
    expiresAt: data.expires_at ? new Date(String(data.expires_at).replace('Z', '+00:00')) : null,
    updatedAt: data.updated_at ? new Date(String(data.updated_at).replace('Z', '+00:00')) : null,
    tpmLimit: data.tpm_limit || 0,
    rpmLimit: data.rpm_limit || 0,
    tpdLimit: data.tpd_limit || 0,
    agentTier: data.agent_tier || null,
    features: data.features || {},
    tags: data.tags || [],
    meta: data.meta || null,
    slotGrants: data.slot_grants || null,
    activeAgentCount: data.active_agent_count || 0,
    activeAgentIds: data.active_agent_ids || [],
  };
}

function hyperAgentEntitlementsFromDict(data: any): HyperAgentEntitlements {
  const payload = data?.entitlements && typeof data.entitlements === 'object' ? data.entitlements : data;
  return {
    effectivePlanId: payload?.effective_plan_id || data?.effective_plan_id || '',
    pooledTpmLimit: payload?.pooled_tpm_limit || data?.pooled_tpm_limit || 0,
    pooledRpmLimit: payload?.pooled_rpm_limit || data?.pooled_rpm_limit || 0,
    pooledTpd: payload?.pooled_tpd || data?.pooled_tpd || 0,
    slotInventory: payload?.slot_inventory || data?.slot_inventory || {},
    activeEntitlementCount: payload?.active_entitlement_count || data?.active_entitlement_count || data?.active_subscription_count || 0,
    billingResetAt: payload?.billing_reset_at ? new Date(String(payload.billing_reset_at).replace('Z', '+00:00')) : null,
  };
}

function hyperAgentSubscriptionSummaryFromDict(data: any): HyperAgentSubscriptionSummary {
  return {
    effectivePlanId: data.effective_plan_id || '',
    currentSubscriptionId: data.current_subscription_id || null,
    currentEntitlementId: data.current_entitlement_id || data.current_subscription_id || null,
    pooledTpmLimit: data.pooled_tpm_limit || 0,
    pooledRpmLimit: data.pooled_rpm_limit || 0,
    pooledTpd: data.pooled_tpd || 0,
    slotInventory: data.slot_inventory || {},
    billingResetAt: data.billing_reset_at ? new Date(String(data.billing_reset_at).replace('Z', '+00:00')) : null,
    activeSubscriptionCount: data.active_subscription_count || 0,
    activeEntitlementCount: data.active_entitlement_count || data.active_subscription_count || 0,
    entitlements: hyperAgentEntitlementsFromDict(data),
    entitlementItems: (data.entitlement_items || []).map(hyperAgentEntitlementFromDict),
    activeSubscriptions: (data.active_subscriptions || []).map(hyperAgentSubscriptionFromDict),
    subscriptions: (data.subscriptions || []).map(hyperAgentSubscriptionFromDict),
    user: data.user || {},
  };
}

function hyperAgentModelFromDict(data: any): HyperAgentModel {
  const caps = data.capabilities || {};
  return {
    id: data.id,
    name: data.name || data.id,
    contextLength: data.context_length || 0,
    supportsVision: caps.supports_vision || false,
    supportsFunctionCalling: caps.supports_function_calling || false,
    supportsToolChoice: caps.supports_tool_choice || false,
  };
}

function dateFromDict(value: unknown): Date | null {
  return value ? new Date(String(value).replace('Z', '+00:00')) : null;
}

function hyperAgentUsageSummaryFromDict(data: any): HyperAgentUsageSummary {
  return {
    totalTokens: Number(data?.total_tokens || 0),
    promptTokens: Number(data?.prompt_tokens || 0),
    completionTokens: Number(data?.completion_tokens || 0),
    requestCount: Number(data?.request_count || 0),
    activeKeys: Number(data?.active_keys || 0),
    currentTpm: Number(data?.current_tpm || 0),
    currentRpm: Number(data?.current_rpm || 0),
    period: String(data?.period || ''),
  };
}

function hyperAgentUsageHistoryEntryFromDict(data: any): HyperAgentUsageHistoryEntry {
  return {
    date: String(data?.date || ''),
    totalTokens: Number(data?.total_tokens || 0),
    promptTokens: Number(data?.prompt_tokens || 0),
    completionTokens: Number(data?.completion_tokens || 0),
    requests: Number(data?.requests || 0),
  };
}

function hyperAgentUsageHistoryFromDict(data: any): HyperAgentUsageHistory {
  return {
    history: (data?.history || []).map(hyperAgentUsageHistoryEntryFromDict),
    days: Number(data?.days || 0),
  };
}

function hyperAgentKeyUsageEntryFromDict(data: any): HyperAgentKeyUsageEntry {
  return {
    keyHash: String(data?.key_hash || ''),
    name: String(data?.name || ''),
    totalTokens: Number(data?.total_tokens || 0),
    promptTokens: Number(data?.prompt_tokens || 0),
    completionTokens: Number(data?.completion_tokens || 0),
    requests: Number(data?.requests || 0),
  };
}

function hyperAgentKeyUsageFromDict(data: any): HyperAgentKeyUsage {
  return {
    keys: (data?.keys || []).map(hyperAgentKeyUsageEntryFromDict),
    days: Number(data?.days || 0),
  };
}

function hyperAgentTypeCatalogFromDict(data: any): HyperAgentTypeCatalog {
  return {
    types: (data?.types || []).map((item: any) => ({
      id: String(item?.id || ''),
      name: String(item?.name || ''),
      cpu: Number(item?.cpu || 0),
      memory: Number(item?.memory || 0),
      cpuLimit: Number(item?.cpu_limit || 0),
      memoryLimit: Number(item?.memory_limit || 0),
    })),
    plans: (data?.plans || []).map((item: any) => ({
      id: String(item?.id || ''),
      name: String(item?.name || ''),
      price: Number(item?.price || 0),
      agents: Number(item?.agents || 0),
      agentType: String(item?.agent_type || ''),
      highlighted: Boolean(item?.highlighted),
    })),
  };
}

function hyperAgentBillingProfileFieldsFromDict(data: any): HyperAgentBillingProfileFields {
  return {
    billingName: data?.billing_name ?? null,
    billingCompany: data?.billing_company ?? null,
    billingTaxId: data?.billing_tax_id ?? null,
    billingLine1: data?.billing_line1 ?? null,
    billingLine2: data?.billing_line2 ?? null,
    billingCity: data?.billing_city ?? null,
    billingState: data?.billing_state ?? null,
    billingPostalCode: data?.billing_postal_code ?? null,
    billingCountry: data?.billing_country ?? null,
  };
}

function hyperAgentBillingProfileFieldsToDict(data: HyperAgentBillingProfileFields): Record<string, string | null> {
  return {
    billing_name: data.billingName,
    billing_company: data.billingCompany,
    billing_tax_id: data.billingTaxId,
    billing_line1: data.billingLine1,
    billing_line2: data.billingLine2,
    billing_city: data.billingCity,
    billing_state: data.billingState,
    billing_postal_code: data.billingPostalCode,
    billing_country: data.billingCountry,
  };
}

function hyperAgentBillingInfoFromDict(data: any): HyperAgentBillingInfo {
  return {
    address: Array.isArray(data?.address) ? data.address.map(String) : [],
    email: String(data?.email || ''),
  };
}

function hyperAgentBillingProfileResponseFromDict(data: any): HyperAgentBillingProfileResponse {
  return {
    companyBilling: hyperAgentBillingInfoFromDict(data?.company_billing || {}),
    profile: data?.profile ? hyperAgentBillingProfileFieldsFromDict(data.profile) : null,
    syncedStripeCustomerIds: Array.isArray(data?.synced_stripe_customer_ids) ? data.synced_stripe_customer_ids.map(String) : undefined,
  };
}

function hyperAgentPaymentFromDict(data: any): HyperAgentPayment {
  return {
    id: String(data?.id || ''),
    userId: String(data?.user_id || ''),
    subscriptionId: data?.subscription_id ?? null,
    entitlementId: data?.entitlement_id ?? null,
    provider: String(data?.provider || ''),
    status: String(data?.status || ''),
    amount: String(data?.amount || ''),
    currency: String(data?.currency || ''),
    externalPaymentId: data?.external_payment_id ?? null,
    createdAt: dateFromDict(data?.created_at),
    updatedAt: dateFromDict(data?.updated_at),
    user: data?.user ? {
      id: String(data.user.id || ''),
      email: data.user.email ?? null,
      walletAddress: data.user.wallet_address ?? null,
      teamId: data.user.team_id ?? null,
      planId: data.user.plan_id ?? null,
      billingName: data.user.billing_name ?? null,
      billingCompany: data.user.billing_company ?? null,
      billingTaxId: data.user.billing_tax_id ?? null,
      billingLine1: data.user.billing_line1 ?? null,
      billingLine2: data.user.billing_line2 ?? null,
      billingCity: data.user.billing_city ?? null,
      billingState: data.user.billing_state ?? null,
      billingPostalCode: data.user.billing_postal_code ?? null,
      billingCountry: data.user.billing_country ?? null,
    } : null,
    subscription: data?.subscription ? {
      id: String(data.subscription.id || ''),
      planId: String(data.subscription.plan_id || ''),
      provider: String(data.subscription.provider || ''),
      status: String(data.subscription.status || ''),
      currentPeriodEnd: dateFromDict(data.subscription.current_period_end),
      stripeSubscriptionId: data.subscription.stripe_subscription_id ?? null,
    } : null,
    entitlement: data?.entitlement ? {
      id: String(data.entitlement.id || ''),
      planId: String(data.entitlement.plan_id || ''),
      provider: String(data.entitlement.provider || ''),
      status: String(data.entitlement.status || ''),
      expiresAt: dateFromDict(data.entitlement.expires_at),
      agentTier: data.entitlement.agent_tier ?? null,
      features: data.entitlement.features || {},
      tags: Array.isArray(data.entitlement.tags) ? data.entitlement.tags.map(String) : [],
    } : null,
  };
}

function hyperAgentPaymentsResponseFromDict(data: any): HyperAgentPaymentsResponse {
  return {
    items: (data?.items || []).map(hyperAgentPaymentFromDict),
  };
}

function hyperAgentStripeCheckoutResponseFromDict(data: any): HyperAgentStripeCheckoutResponse {
  return {
    checkoutUrl: String(data?.checkout_url || ''),
  };
}

function hyperAgentX402CheckoutResponseFromDict(data: any): HyperAgentX402CheckoutResponse {
  return {
    ok: Boolean(data?.ok),
    key: String(data?.key || ''),
    planId: String(data?.plan_id || ''),
    quantity: Number(data?.quantity || 0),
    bundle: data?.bundle || {},
    amountPaid: String(data?.amount_paid || ''),
    durationDays: Number(data?.duration_days || 0),
    expiresAt: dateFromDict(data?.expires_at),
    tpmLimit: Number(data?.tpm_limit || 0),
    rpmLimit: Number(data?.rpm_limit || 0),
  };
}

/**
 * HyperAgent API Client
 *
 * For chat completions, use the OpenAI Node.js SDK directly:
 *
 * ```typescript
 * import OpenAI from 'openai';
 *
 * const openai = new OpenAI({
 *   apiKey: client.agent.apiKey,
 *   baseURL: client.agent.baseUrl,
 * });
 * ```
 */
export class HyperAgent {
  static readonly AGENT_API_BASE = 'https://api.hypercli.com/v1';
  static readonly DEV_API_BASE = 'https://api.dev.hypercli.com/v1';

  public readonly apiKey: string;
  public readonly baseUrl: string;
  public readonly controlBaseUrl: string;

  constructor(
    private http: HTTPClient,
    agentApiKey?: string,
    dev: boolean = false,
    agentsApiBaseUrl?: string,
  ) {
    this.apiKey = agentApiKey || http['apiKey'];
    const fallbackBaseUrl = typeof http['baseUrl'] === 'string' ? http['baseUrl'] : (dev ? HyperAgent.DEV_API_BASE : HyperAgent.AGENT_API_BASE);
    const configuredBaseUrl = agentsApiBaseUrl || getAgentsApiBaseUrl(dev) || fallbackBaseUrl;
    this.baseUrl = resolveHyperAgentBaseUrl(configuredBaseUrl, dev);
    this.controlBaseUrl = resolveHyperAgentControlBaseUrl(http['baseUrl'], configuredBaseUrl, dev);
  }

  private get baseUrlWithoutV1(): string {
    return this.baseUrl.replace(/\/v1$/, '');
  }

  private async controlGet<T = any>(path: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.controlBaseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to GET ${path}: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  private async controlPost<T = any>(path: string, body?: any): Promise<T> {
    const response = await fetch(`${this.controlBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
    });

    if (!response.ok) {
      throw new Error(`Failed to POST ${path}: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  private async controlPut<T = any>(path: string, body?: any): Promise<T> {
    const response = await fetch(`${this.controlBaseUrl}${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
    });

    if (!response.ok) {
      throw new Error(`Failed to PUT ${path}: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async plans(): Promise<HyperAgentPlan[]> {
    const response = await fetch(`${this.controlBaseUrl}/plans`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get plans: ${response.statusText}`);
    }

    const data: any = await response.json();
    return (data.plans || []).map(hyperAgentPlanFromDict);
  }

  async currentPlan(): Promise<HyperAgentCurrentPlan> {
    const response = await fetch(`${this.controlBaseUrl}/plans/current`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get current plan: ${response.statusText}`);
    }

    const data: any = await response.json();
    return hyperAgentCurrentPlanFromDict(data);
  }

  async subscriptions(): Promise<HyperAgentSubscription[]> {
    const response = await fetch(`${this.controlBaseUrl}/subscriptions`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get subscriptions: ${response.statusText}`);
    }

    const data: any = await response.json();
    return (data.items || []).map(hyperAgentSubscriptionFromDict);
  }

  async subscriptionSummary(): Promise<HyperAgentSubscriptionSummary> {
    const response = await fetch(`${this.controlBaseUrl}/subscriptions/summary`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get subscription summary: ${response.statusText}`);
    }

    const data: any = await response.json();
    return hyperAgentSubscriptionSummaryFromDict(data);
  }

  async entitlements(): Promise<HyperAgentEntitlementsSummary> {
    const response = await fetch(`${this.controlBaseUrl}/entitlements`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get entitlements: ${response.statusText}`);
    }

    const data: any = await response.json();
    return hyperAgentSubscriptionSummaryFromDict(data);
  }

  async entitlementInstances(): Promise<HyperAgentEntitlement[]> {
    const response = await fetch(`${this.controlBaseUrl}/entitlements/instances`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get entitlement instances: ${response.statusText}`);
    }

    const data: any = await response.json();
    return (data.items || []).map(hyperAgentEntitlementFromDict);
  }

  async updateSubscription(
    subscriptionId: string,
    request: HyperAgentSubscriptionUpdateRequest,
  ): Promise<HyperAgentSubscriptionMutationResult> {
    const response = await fetch(`${this.controlBaseUrl}/subscriptions/${subscriptionId}/update`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bundle: request.bundle || {} }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update subscription: ${response.statusText}`);
    }

    const data: any = await response.json();
    return {
      ok: Boolean(data.ok),
      message: data.message || '',
      subscription: data.subscription ? hyperAgentSubscriptionFromDict(data.subscription) : undefined,
    };
  }

  async cancelSubscription(subscriptionId: string): Promise<HyperAgentSubscriptionMutationResult> {
    return this.updateSubscription(subscriptionId, { bundle: {} });
  }

  async models(): Promise<HyperAgentModel[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get models: ${response.statusText}`);
    }

    const data: any = await response.json();
    return (data.data || []).map((model: any) =>
      hyperAgentModelFromDict({
        id: model.id,
        name: model.name || model.id,
        context_length: model.context_length || 0,
        capabilities: model.capabilities || {},
      }),
    );
  }

  async discoveryHealth(): Promise<{
    hostsTotal: number;
    hostsHealthy: number;
    fallbacksActive: number;
  }> {
    const response = await fetch(`${this.baseUrlWithoutV1}/discovery/health`);

    if (!response.ok) {
      throw new Error(`Failed to get discovery health: ${response.statusText}`);
    }

    return (await response.json()) as any;
  }

  async discoveryConfig(apiKey?: string): Promise<any> {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['X-API-KEY'] = apiKey;
    }

    const response = await fetch(`${this.baseUrlWithoutV1}/discovery/config`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to get discovery config: ${response.statusText}`);
    }

    return await response.json();
  }

  async usageSummary(): Promise<HyperAgentUsageSummary> {
    return hyperAgentUsageSummaryFromDict(await this.controlGet('/usage'));
  }

  async usageHistory(days: number = 7): Promise<HyperAgentUsageHistory> {
    return hyperAgentUsageHistoryFromDict(await this.controlGet('/usage/history', { days }));
  }

  async keyUsage(days: number = 7): Promise<HyperAgentKeyUsage> {
    return hyperAgentKeyUsageFromDict(await this.controlGet('/usage/keys', { days }));
  }

  async agentTypes(): Promise<HyperAgentTypeCatalog> {
    return hyperAgentTypeCatalogFromDict(await this.controlGet('/types'));
  }

  async billingInfo(): Promise<HyperAgentBillingInfo> {
    const data = await this.controlGet('/billing/info');
    return hyperAgentBillingInfoFromDict(data?.company_billing || {});
  }

  async billingProfile(): Promise<HyperAgentBillingProfileResponse> {
    return hyperAgentBillingProfileResponseFromDict(await this.controlGet('/billing/profile'));
  }

  async updateBillingProfile(profile: HyperAgentBillingProfileFields): Promise<HyperAgentBillingProfileResponse> {
    return hyperAgentBillingProfileResponseFromDict(
      await this.controlPut('/billing/profile', hyperAgentBillingProfileFieldsToDict(profile)),
    );
  }

  async payments(options: HyperAgentPaymentsOptions = {}): Promise<HyperAgentPaymentsResponse> {
    const params: Record<string, string | number> = {};
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.provider) params.provider = options.provider;
    if (options.status) params.status = options.status;
    return hyperAgentPaymentsResponseFromDict(await this.controlGet('/billing/payments', params));
  }

  async payment(paymentId: string): Promise<HyperAgentPayment> {
    return hyperAgentPaymentFromDict(await this.controlGet(`/billing/payments/${encodeURIComponent(paymentId)}`));
  }

  async createStripeCheckout(
    request: HyperAgentStripeCheckoutRequest = {},
    planId?: string,
  ): Promise<HyperAgentStripeCheckoutResponse> {
    const payload = {
      ...(request.successUrl ? { success_url: request.successUrl } : {}),
      ...(request.cancelUrl ? { cancel_url: request.cancelUrl } : {}),
      ...(request.quantity !== undefined ? { quantity: request.quantity } : {}),
      ...(request.bundle ? { bundle: request.bundle } : {}),
    };
    const path = planId ? `/stripe/${encodeURIComponent(planId)}` : '/stripe/checkout';
    return hyperAgentStripeCheckoutResponseFromDict(await this.controlPost(path, payload));
  }

  async createX402Checkout(request: HyperAgentX402CheckoutRequest = {}): Promise<HyperAgentX402CheckoutResponse> {
    const payload = {
      ...(request.quantity !== undefined ? { quantity: request.quantity } : {}),
      ...(request.bundle ? { bundle: request.bundle } : {}),
    };
    return hyperAgentX402CheckoutResponseFromDict(await this.controlPost('/x402/checkout', payload));
  }
}
