/**
 * HyperClaw API client - AI agent inference using OpenAI-compatible API
 * 
 * Note: OpenAI client integration is not included in this SDK.
 * Use the OpenAI Node.js SDK directly with HyperClaw endpoints.
 */
import type { HTTPClient } from './http.js';

export interface ClawKey {
  key: string;
  planId: string;
  expiresAt: Date;
  tpmLimit: number;
  rpmLimit: number;
  userId: string | null;
}

export interface ClawPlan {
  id: string;
  name: string;
  priceUsd: number;
  tpmLimit: number;
  rpmLimit: number;
}

export interface ClawModel {
  id: string;
  name: string;
  contextLength: number;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  supportsToolChoice: boolean;
}

function clawKeyFromDict(data: any): ClawKey {
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

function clawPlanFromDict(data: any): ClawPlan {
  return {
    id: data.id,
    name: data.name,
    priceUsd: data.price_usd,
    tpmLimit: data.tpm_limit,
    rpmLimit: data.rpm_limit,
  };
}

function clawModelFromDict(data: any): ClawModel {
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
 * HyperClaw API Client
 * 
 * For chat completions, use the OpenAI Node.js SDK directly:
 * 
 * ```typescript
 * import OpenAI from 'openai';
 * 
 * const openai = new OpenAI({
 *   apiKey: client.claw.apiKey,
 *   baseURL: client.claw.baseUrl,
 * });
 * 
 * const response = await openai.chat.completions.create({
 *   model: 'kimi-k2.5',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * ```
 */
export class Claw {
  static readonly CLAW_API_BASE = 'https://api.hyperclaw.app/v1';
  static readonly DEV_API_BASE = 'https://dev-api.hyperclaw.app/v1';

  public readonly apiKey: string;
  public readonly baseUrl: string;

  constructor(
    private http: HTTPClient,
    clawApiKey?: string,
    dev: boolean = false
  ) {
    this.apiKey = clawApiKey || http['apiKey'];
    this.baseUrl = dev ? Claw.DEV_API_BASE : Claw.CLAW_API_BASE;
  }

  private get baseUrlWithoutV1(): string {
    return this.baseUrl.replace('/v1', '');
  }

  /**
   * Get current API key status and subscription details
   */
  async keyStatus(): Promise<ClawKey> {
    const response = await fetch(`${this.baseUrlWithoutV1}/api/keys/status`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get key status: ${response.statusText}`);
    }

    const data = await response.json();
    return clawKeyFromDict(data);
  }

  /**
   * List available subscription plans
   */
  async plans(): Promise<ClawPlan[]> {
    const response = await fetch(`${this.baseUrlWithoutV1}/api/plans`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get plans: ${response.statusText}`);
    }

    const data: any = await response.json();
    return (data.plans || []).map(clawPlanFromDict);
  }

  /**
   * List available models
   */
  async models(): Promise<ClawModel[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get models: ${response.statusText}`);
    }

    const data: any = await response.json();
    return (data.data || []).map((m: any) => clawModelFromDict({
      id: m.id,
      name: m.name || m.id,
      context_length: m.context_length || 0,
      capabilities: m.capabilities || {},
    }));
  }

  /**
   * Get discovery service health status
   */
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

  /**
   * Get discovery service configuration (requires API key)
   */
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
