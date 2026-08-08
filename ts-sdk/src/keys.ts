/**
 * API Keys management
 */
import { getApiUrl } from './config.js';
import { HTTPClient } from './http.js';

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
  expiresAt: string | null;
  capabilities?: string[];
}

export interface CreateApiKeyOptions {
  duration?: string;
  expiresAt?: string;
}

export interface IssueApiKeyFromJwtOptions extends CreateApiKeyOptions {
  tags: string[];
  name?: string;
  apiUrl?: string;
  timeout?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function firstTimestamp(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric)) return trimmed;
      const milliseconds = Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric;
      const timestamp = new Date(milliseconds);
      if (Number.isFinite(timestamp.getTime())) return timestamp.toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const milliseconds = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
      const timestamp = new Date(milliseconds);
      if (Number.isFinite(timestamp.getTime())) return timestamp.toISOString();
    }
  }
  return null;
}

function apiKeyFromDict(data: any): ApiKey {
  const record = asRecord(data);
  return {
    keyId: firstString(record.key_id, record.keyId, record.id) || '',
    name: firstString(record.name) || '',
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    apiKey: firstString(record.api_key, record.apiKey, record.key, record.secret, record.token, record.value),
    apiKeyPreview: firstString(record.api_key_preview, record.apiKeyPreview, record.preview, record.masked_key, record.maskedKey),
    last4: firstString(record.last4, record.last_4),
    isActive: record.is_active === false || record.isActive === false || record.active === false ? false : true,
    createdAt: firstTimestamp(record.created_at, record.createdAt) || '',
    lastUsedAt: firstTimestamp(record.last_used_at, record.lastUsedAt),
    expiresAt: firstTimestamp(record.expires_at, record.expiresAt),
    capabilities: Array.isArray(record.capabilities)
      ? record.capabilities.filter((capability): capability is string => typeof capability === 'string')
      : undefined,
  };
}

export class KeysAPI {
  constructor(private http: HTTPClient) {}

  /**
   * Create a new API key
   */
  async create(name: string = 'default', tags?: string[], options: CreateApiKeyOptions = {}): Promise<ApiKey> {
    const payload: Record<string, unknown> = { name };
    if (tags !== undefined) {
      payload.tags = tags;
    }
    if (options.duration !== undefined) {
      payload.duration = options.duration;
    }
    if (options.expiresAt !== undefined) {
      payload.expires_at = options.expiresAt;
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

/**
 * Issue a scoped API key for the user represented by an app JWT.
 *
 * The JWT authenticates only this key-creation request. Use the returned
 * `apiKey` for subsequent SDK operations.
 */
export async function issueApiKeyFromJwt(
  jwt: string,
  options: IssueApiKeyFromJwtOptions,
): Promise<ApiKey> {
  const token = jwt.trim();
  if (!token) {
    throw new Error('JWT required');
  }

  const http = new HTTPClient(options.apiUrl ?? getApiUrl(), token, options.timeout ?? 30000);
  const issued = await new KeysAPI(http).create(options.name ?? 'default', options.tags, {
    duration: options.duration,
    expiresAt: options.expiresAt,
  });
  if (!issued.apiKey) {
    throw new Error('API key issue response did not include the key secret');
  }
  return issued;
}
