/**
 * Runners API - self-hosted compute registry (agents backend /runners).
 */
import { requestWithRetry, responseAPIError } from './http.js';
import { getAgentsApiBaseUrl } from './config.js';

function envValue(key: string): string | undefined {
  const maybeProcess = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.[key];
}

export function deriveRunnersApiBase(agentsApiBase?: string): string {
  const configured = envValue('HYPER_RUNNERS_API_BASE');
  const raw = (configured || agentsApiBase || getAgentsApiBaseUrl()).replace(/\/$/, '');
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  const path = url.pathname.replace(/\/$/, '');
  if (path.endsWith('/runners')) {
    return `${url.protocol}//${url.host}${path}`;
  }
  return `${url.protocol}//${url.host}${path}/runners`;
}

/** User-writable cosmetic runner metadata exposed under meta.ui. */
export interface RunnerUiMeta {
  displayName?: string | null;
}

export interface RunnerMeta {
  ui?: RunnerUiMeta | null;
}

export interface Runner {
  runnerId: string;
  ownerUserId: string;
  name: string;
  tags: string[];
  platform: { os: string; arch: string };
  version: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  disconnectedAt: string | null;
  meta?: RunnerMeta | null;
  /** Inventory-only fields; presence state is scoped to the responding backend instance. */
  connected?: boolean;
  ready?: boolean;
  connectionScope?: string;
}

export interface RunnerUpdateOptions {
  /** Merges into meta.ui server-side; null clears the field. */
  ui?: { displayName?: string | null };
}

function runnerUiMetaFromDict(data: any): RunnerUiMeta | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const ui: RunnerUiMeta = {};
  if ('display_name' in data) {
    const value = data.display_name;
    if (typeof value !== 'string' && value !== null) return null;
    ui.displayName = value;
  }
  return ui;
}

function runnerMetaFromDict(data: any): RunnerMeta | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const meta: RunnerMeta = {};
  if ('ui' in data) meta.ui = runnerUiMetaFromDict(data.ui);
  return meta;
}

function runnerFromDict(data: any): Runner {
  const platform = data?.platform && typeof data.platform === 'object' ? data.platform : {};
  return {
    runnerId: String(data?.runner_id || ''),
    ownerUserId: String(data?.owner_user_id || ''),
    name: String(data?.name || ''),
    tags: Array.isArray(data?.tags) ? data.tags.map(String) : [],
    platform: { os: String(platform.os || ''), arch: String(platform.arch || '') },
    version: String(data?.version || ''),
    createdAt: data?.created_at ?? null,
    lastSeenAt: data?.last_seen_at ?? null,
    disconnectedAt: data?.disconnected_at ?? null,
    meta: runnerMetaFromDict(data?.meta),
    ...(data?.connected !== undefined ? { connected: Boolean(data.connected) } : {}),
    ...(data?.ready !== undefined ? { ready: Boolean(data.ready) } : {}),
    ...(data?.connection_scope !== undefined ? { connectionScope: String(data.connection_scope) } : {}),
  };
}

async function handleResponse<T = any>(response: Response, method?: string): Promise<T> {
  if (response.status >= 400) {
    throw await responseAPIError(response, method);
  }
  if (response.status === 204 || response.status === 205) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function encodeRef(value: string): string {
  return encodeURIComponent(value);
}

export class RunnersAPI {
  private apiBase: string;
  private apiKey: string;
  private timeout: number;

  constructor(apiKey: string, options: { apiBase?: string; agentsApiBase?: string; timeout?: number } = {}) {
    if (!apiKey) {
      throw new Error('API key required for runners');
    }
    this.apiKey = apiKey;
    this.apiBase = (options.apiBase || deriveRunnersApiBase(options.agentsApiBase)).replace(/\/$/, '');
    this.timeout = options.timeout ?? 30000;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T = any>(method: string, path: string, body?: any): Promise<T> {
    const response = await requestWithRetry({
      method,
      url: `${this.apiBase}${path}`,
      headers: this.headers(),
      body,
      retries: method === 'GET' ? 3 : 1,
      timeout: this.timeout,
    });
    return handleResponse<T>(response, method);
  }

  async list(): Promise<Runner[]> {
    const data = await this.request<any>('GET', '');
    const items = Array.isArray(data) ? data : Array.isArray(data?.runners) ? data.runners : null;
    if (!items) {
      throw new Error('Runners response must be an array.');
    }
    return items.map(runnerFromDict);
  }

  async get(runnerId: string): Promise<Runner> {
    const data = await this.request('GET', `/${encodeRef(runnerId)}`);
    return runnerFromDict(data);
  }

  async update(runnerId: string, body: RunnerUpdateOptions): Promise<Runner> {
    const payload: Record<string, unknown> = {};
    if (body.ui !== undefined) {
      const ui: Record<string, unknown> = {};
      if (body.ui.displayName !== undefined) ui.display_name = body.ui.displayName;
      payload.ui = ui;
    }
    const data = await this.request('PATCH', `/${encodeRef(runnerId)}`, payload);
    return runnerFromDict(data);
  }
}
