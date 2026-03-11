/**
 * HyperAgent API client - AI agent inference using OpenAI-compatible API
 *
 * Note: OpenAI client integration is not included in this SDK.
 * Use the OpenAI Node.js SDK directly with HyperClaw endpoints.
 */
import type { HTTPClient } from './http.js';

export interface HyperAgentKey {
  key: string;
  planId: string;
  expiresAt: Date;
  tpmLimit: number;
  rpmLimit: number;
  userId: string | null;
}

export interface HyperAgentPlan {
  id: string;
  name: string;
  priceUsd: number;
  tpmLimit: number;
  rpmLimit: number;
}

export interface HyperAgentModel {
  id: string;
  name: string;
  contextLength: number;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  supportsToolChoice: boolean;
}

function hyperAgentKeyFromDict(data: any): HyperAgentKey {
  let expiresAt: Date;
  if (typeof data.expires_at === 'string') {
    expiresAt = new Date(data.expires_at.replace('Z', '+00:00'));
  } else {
    expiresAt = new Date(data.expires_at);
  }

  return {
    key: data.key,
    planId: data.plan_id,
    expiresAt,
    tpmLimit: data.tpm_limit || 0,
    rpmLimit: data.rpm_limit || 0,
    userId: data.user_id || null,
  };
}

function hyperAgentPlanFromDict(data: any): HyperAgentPlan {
  return {
    id: data.id,
    name: data.name,
    priceUsd: data.price_usd,
    tpmLimit: data.tpm_limit,
    rpmLimit: data.rpm_limit,
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

  constructor(
    private http: HTTPClient,
    agentApiKey?: string,
    dev: boolean = false
  ) {
    this.apiKey = agentApiKey || http['apiKey'];
    this.baseUrl = dev ? HyperAgent.DEV_API_BASE : HyperAgent.AGENT_API_BASE;
  }

  private get baseUrlWithoutV1(): string {
    return this.baseUrl.replace('/v1', '');
  }

  async keyStatus(): Promise<HyperAgentKey> {
    const response = await fetch(`${this.baseUrlWithoutV1}/api/keys/status`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get key status: ${response.statusText}`);
    }

    const data = await response.json();
    return hyperAgentKeyFromDict(data);
  }

  async plans(): Promise<HyperAgentPlan[]> {
    const response = await fetch(`${this.baseUrlWithoutV1}/api/plans`, {
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
