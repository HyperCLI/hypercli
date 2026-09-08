/**
 * Routines API - scheduled prompts for agents.
 */
import { requestWithRetry, responseAPIError } from './http.js';
import { getAgentsApiBaseUrl } from './config.js';

function envValue(key: string): string | undefined {
  const maybeProcess = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.[key];
}

export function deriveRoutinesApiBase(agentsApiBase?: string): string {
  const configured = envValue('HYPER_ROUTINES_API_BASE');
  const raw = (configured || agentsApiBase || getAgentsApiBaseUrl()).replace(/\/$/, '');
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  let path = url.pathname.replace(/\/$/, '');
  if (path.endsWith('/routines')) {
    return `${url.protocol}//${url.host}${path}`;
  }
  if (path.endsWith('/agents')) {
    path = path.slice(0, -'/agents'.length);
  }
  return `${url.protocol}//${url.host}${path}/routines`;
}

export interface Routine {
  id: string;
  userId: string;
  agentId: string;
  cron: string | null;
  prompt: string;
  enabled: boolean;
  name: string | null;
  runAt: string | null;
  nextRunAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RoutineCreateOptions {
  agentId: string;
  prompt: string;
  cron?: string;
  runAt?: string;
  name?: string;
  enabled?: boolean;
}

export interface RoutineUpdateOptions {
  agentId?: string;
  cron?: string;
  prompt?: string;
  enabled?: boolean;
  name?: string;
}

function routineFromDict(data: any): Routine {
  return {
    id: String(data?.id || ''),
    userId: String(data?.user_id || data?.userId || ''),
    agentId: String(data?.agent_id || data?.agentId || ''),
    cron: data?.cron ?? null,
    prompt: data?.prompt || '',
    enabled: Boolean(data?.enabled ?? false),
    name: data?.name ?? null,
    runAt: data?.run_at ?? data?.runAt ?? null,
    nextRunAt: data?.next_run_at ?? data?.nextRunAt ?? null,
    createdAt: data?.created_at ?? data?.createdAt ?? null,
    updatedAt: data?.updated_at ?? data?.updatedAt ?? null,
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

export class RoutinesAPI {
  private apiBase: string;
  private apiKey: string;
  private timeout: number;

  constructor(apiKey: string, options: { apiBase?: string; agentsApiBase?: string; timeout?: number } = {}) {
    if (!apiKey) {
      throw new Error('API key required for routines');
    }
    this.apiKey = apiKey;
    this.apiBase = (options.apiBase || deriveRoutinesApiBase(options.agentsApiBase)).replace(/\/$/, '');
    this.timeout = options.timeout ?? 30000;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: any,
    params?: Record<string, string>,
  ): Promise<T> {
    let url = `${this.apiBase}${path}`;
    if (params) {
      const query = new URLSearchParams(params).toString();
      if (query) url = `${url}?${query}`;
    }
    const response = await requestWithRetry({
      method,
      url,
      headers: this.headers(),
      body,
      retries: method === 'GET' ? 3 : 1,
      timeout: this.timeout,
    });
    return handleResponse<T>(response, method);
  }

  async list(options: { agentId?: string } = {}): Promise<Routine[]> {
    const params = options.agentId !== undefined ? { agent_id: options.agentId } : undefined;
    const data = await this.request<any[]>('GET', '', undefined, params);
    if (!Array.isArray(data)) {
      throw new Error('Routines response must be an array.');
    }
    return data.map(routineFromDict);
  }

  async get(routineId: string): Promise<Routine> {
    const data = await this.request('GET', `/${encodeRef(routineId)}`);
    return routineFromDict(data);
  }

  async create(body: RoutineCreateOptions): Promise<Routine> {
    const payload: Record<string, unknown> = { agent_id: body.agentId };
    if (body.cron !== undefined) payload.cron = body.cron;
    payload.prompt = body.prompt;
    payload.enabled = body.enabled ?? true;
    if (body.runAt !== undefined) payload.run_at = body.runAt;
    if (body.name !== undefined) payload.name = body.name;
    const data = await this.request('POST', '', payload);
    return routineFromDict(data);
  }

  async update(routineId: string, body: RoutineUpdateOptions): Promise<Routine> {
    const payload: Record<string, unknown> = {};
    if (body.agentId !== undefined) payload.agent_id = body.agentId;
    if (body.cron !== undefined) payload.cron = body.cron;
    if (body.prompt !== undefined) payload.prompt = body.prompt;
    if (body.enabled !== undefined) payload.enabled = body.enabled;
    if (body.name !== undefined) payload.name = body.name;
    const data = await this.request('PATCH', `/${encodeRef(routineId)}`, payload);
    return routineFromDict(data);
  }

  async delete(routineId: string): Promise<void> {
    await this.request('DELETE', `/${encodeRef(routineId)}`);
  }
}
