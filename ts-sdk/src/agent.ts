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
}

export interface HyperAgentEntitlements {
  effectivePlanId: string;
  pooledTpmLimit: number;
  pooledRpmLimit: number;
  pooledTpd: number;
  slotInventory: Record<string, { granted: number; used: number; available: number }>;
  activeEntitlementCount: number;
}

export interface HyperAgentSubscriptionSummary {
  effectivePlanId: string;
  currentSubscriptionId: string | null;
  currentEntitlementId: string | null;
  pooledTpmLimit: number;
  pooledRpmLimit: number;
  pooledTpd: number;
  slotInventory: Record<string, { granted: number; used: number; available: number }>;
  activeSubscriptionCount: number;
  activeEntitlementCount: number;
  entitlements: HyperAgentEntitlements;
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

export interface HyperAgentModel {
  id: string;
  name: string;
  contextLength: number;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  supportsToolChoice: boolean;
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
  return {
    id: data.id || '',
    userId: data.user_id || '',
    planId: data.plan_id || '',
    planName: data.plan_name || data.plan_id || '',
    provider: data.provider || '',
    status: data.status || '',
    quantity: data.quantity || 1,
    expiresAt: data.expires_at ? new Date(String(data.expires_at).replace('Z', '+00:00')) : null,
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
    activeSubscriptionCount: data.active_subscription_count || 0,
    activeEntitlementCount: data.active_entitlement_count || data.active_subscription_count || 0,
    entitlements: hyperAgentEntitlementsFromDict(data),
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

  async cancelSubscription(subscriptionId: string): Promise<HyperAgentSubscriptionMutationResult> {
    const response = await fetch(`${this.controlBaseUrl}/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to cancel subscription: ${response.statusText}`);
    }

    const data: any = await response.json();
    return {
      ok: Boolean(data.ok),
      message: data.message || '',
      subscription: data.subscription ? hyperAgentSubscriptionFromDict(data.subscription) : undefined,
    };
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
}
