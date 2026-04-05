/**
 * API Keys management
 */
import type { HTTPClient } from './http.js';

export type ApiKeyBaselineValue = 'none' | 'self' | '*';

export interface ApiKeyBaselineFamily {
  key: string;
  label: string;
  allowed: readonly ApiKeyBaselineValue[];
}

export const API_KEY_BASELINE_FAMILIES = [
  { key: 'api', label: 'API Keys', allowed: ['none', 'self', '*'] },
  { key: 'user', label: 'Profile', allowed: ['none', 'self', '*'] },
  { key: 'jobs', label: 'Jobs', allowed: ['none', 'self', '*'] },
  { key: 'renders', label: 'Renders', allowed: ['none', 'self', '*'] },
  { key: 'files', label: 'Files', allowed: ['none', 'self', '*'] },
  { key: 'agents', label: 'Agents', allowed: ['none', 'self', '*'] },
  { key: 'models', label: 'Models', allowed: ['none', '*'] },
  { key: 'voice', label: 'Voice', allowed: ['none', '*'] },
  { key: 'flow', label: 'Flows', allowed: ['none', '*'] },
] as const satisfies readonly ApiKeyBaselineFamily[];

export interface ApiKey {
  keyId: string;
  name: string;
  tags: string[];
  apiKey: string | null; // Full key only on create
  apiKeyPreview: string | null; // Masked key on list
  last4: string | null;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

function apiKeyFromDict(data: any): ApiKey {
  return {
    keyId: data.key_id || '',
    name: data.name || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    apiKey: data.api_key || null,
    apiKeyPreview: data.api_key_preview || null,
    last4: data.last4 || null,
    isActive: data.is_active !== false,
    createdAt: data.created_at || '',
    lastUsedAt: data.last_used_at || null,
  };
}

export class KeysAPI {
  constructor(private http: HTTPClient) {}

  /**
   * Create a new API key
   */
  async create(name: string = 'default', tags?: string[]): Promise<ApiKey> {
    const payload: Record<string, unknown> = { name };
    if (tags !== undefined) {
      payload.tags = tags;
    }
    const data = await this.http.post('/api/keys', payload);
    return apiKeyFromDict(data);
  }

  /**
   * List all API keys (masked)
   */
  async list(): Promise<ApiKey[]> {
    const data = await this.http.get('/api/keys');
    return (data || []).map(apiKeyFromDict);
  }

  /**
   * Get a specific API key (masked)
   */
  async get(keyId: string): Promise<ApiKey> {
    const data = await this.http.get(`/api/keys/${keyId}`);
    return apiKeyFromDict(data);
  }

  /**
   * Deactivate an API key (irreversible)
   */
  async disable(keyId: string): Promise<any> {
    return await this.http.delete(`/api/keys/${keyId}`);
  }

  /**
   * Rename an API key
   */
  async rename(keyId: string, name: string): Promise<ApiKey> {
    const data = await this.http.patch(`/api/keys/${keyId}`, { name });
    return apiKeyFromDict(data);
  }
}
