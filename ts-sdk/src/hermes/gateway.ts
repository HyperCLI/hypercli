/**
 * Client for the stable Hermes Agent HTTP/SSE gateway surface.
 *
 * Payloads intentionally remain extensible: Hermes owns the OpenAI-compatible
 * schemas and may add session, run, or event fields without an SDK release.
 */
import { APIError } from '../errors.js';

export interface HermesApiClientOptions {
  apiKey?: string | null;
  fetch?: typeof globalThis.fetch;
  headers?: Headers | Record<string, string> | Array<[string, string]>;
}

export interface HermesHealth extends Record<string, unknown> {
  status: string;
  platform: string;
  version: string;
}

export interface HermesDetailedHealth extends HermesHealth {
  readiness?: Record<string, unknown>;
  gateway_state?: string | null;
  gateway_busy?: boolean;
  gateway_drainable?: boolean;
}

export interface HermesCapabilities extends Record<string, unknown> {
  object: 'hermes.api_server.capabilities' | string;
  platform: 'hermes-agent' | string;
  model: string;
  auth: { type: string; required: boolean; [key: string]: unknown };
  features: Record<string, boolean | string | number | null>;
  endpoints: Record<string, { method: string; path: string; [key: string]: unknown }>;
}

export interface HermesModel extends Record<string, unknown> {
  id: string;
  object: 'model' | string;
  created?: number;
  owned_by?: string;
  root?: string;
  parent?: string | null;
}

export interface HermesModelsResponse extends Record<string, unknown> {
  object: 'list' | string;
  data: HermesModel[];
}

export interface HermesSession extends Record<string, unknown> {
  id: string;
  title?: string | null;
  source?: string;
  model?: string | null;
}

export interface HermesSessionResponse extends Record<string, unknown> {
  object: 'hermes.session' | string;
  session: HermesSession;
}

export interface HermesSessionListResponse extends Record<string, unknown> {
  object: 'list' | string;
  data: HermesSession[];
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface HermesListSessionsOptions {
  limit?: number;
  offset?: number;
  source?: string;
  includeChildren?: boolean;
}

export interface HermesCreateSessionRequest extends Record<string, unknown> {
  id?: string;
  session_id?: string;
  title?: string;
  source?: string;
  model?: string;
  provider?: string;
  model_options?: Record<string, unknown>;
  system_prompt?: string;
  require_model_lock?: boolean;
}

export interface HermesUpdateSessionRequest {
  title?: string | null;
  end_reason?: string | null;
}

export interface HermesSessionMessagesResponse extends Record<string, unknown> {
  object?: string;
  session_id?: string;
  data?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
}

export interface HermesForkSessionRequest extends Record<string, unknown> {
  id?: string;
  session_id?: string;
  title?: string;
  message_id?: string;
}

export interface HermesSessionChatRequest extends Record<string, unknown> {
  message: string;
  system_message?: string;
  instructions?: string;
  model?: string;
  provider?: string;
  model_options?: Record<string, unknown>;
  require_model_lock?: boolean;
}

export interface HermesSessionChatResponse extends Record<string, unknown> {
  object?: 'hermes.session.chat.completion' | string;
  session_id?: string;
  message?: { role: string; content: string; [key: string]: unknown };
  messages?: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
}

export interface HermesSessionModelLockRequest extends Record<string, unknown> {
  model: string;
  provider?: string;
  model_options?: Record<string, unknown>;
}

export interface HermesSessionModelLockResponse extends Record<string, unknown> {
  object: 'hermes.session.model_lock' | string;
  session_id: string;
  runtime: Record<string, unknown>;
}

export interface HermesCreateRunRequest extends Record<string, unknown> {
  input: string | Array<Record<string, unknown>>;
  instructions?: string;
  session_id?: string;
  previous_response_id?: string;
  conversation_history?: Array<Record<string, unknown>>;
  model?: string;
  provider?: string;
  model_options?: Record<string, unknown>;
}

export interface HermesCreateRunResponse extends Record<string, unknown> {
  run_id: string;
  status: string;
}

export interface HermesRun extends Record<string, unknown> {
  object?: 'hermes.run' | string;
  run_id: string;
  status: string;
  session_id?: string;
}

export type HermesApprovalChoice = 'once' | 'session' | 'always' | 'deny';

export interface HermesApproveRunRequest {
  choice: HermesApprovalChoice;
  resolveAll?: boolean;
}

export interface HermesApproveRunResponse extends Record<string, unknown> {
  object: 'hermes.run.approval_response' | string;
  run_id: string;
  choice: HermesApprovalChoice;
  resolved: number;
}

/** One decoded SSE frame. Unknown event names and payload fields are preserved. */
export interface HermesSseEvent<T = unknown> {
  event: string;
  data: T;
  id?: string;
  retry?: number;
  /** Original, undecoded data lines joined with newlines. */
  rawData: string;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Hermes API base URL is required');
  return trimmed;
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

async function responseError(response: Response, method: string, url: string): Promise<APIError> {
  const responseText = await response.text();
  let detail = response.statusText || 'Hermes API request failed';
  try {
    const payload = JSON.parse(responseText) as Record<string, unknown>;
    const envelope = payload.error;
    if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) {
      const message = (envelope as Record<string, unknown>).message;
      if (typeof message === 'string' && message) detail = message;
    } else if (typeof payload.detail === 'string' && payload.detail) {
      detail = payload.detail;
    }
  } catch {
    if (responseText) detail = responseText;
  }
  return new APIError(response.status, detail, method, url, responseText);
}

async function* parseSse(response: Response): AsyncGenerator<HermesSseEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const decodeBlock = (block: string): HermesSseEvent | null => {
    let event = 'message';
    let id: string | undefined;
    let retry: number | undefined;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      let value = separator < 0 ? '' : line.slice(separator + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value || 'message';
      else if (field === 'data') dataLines.push(value);
      else if (field === 'id') id = value;
      else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
    }
    if (dataLines.length === 0) return null;
    const rawData = dataLines.join('\n');
    let data: unknown = rawData;
    try {
      data = JSON.parse(rawData);
    } catch {
      // Non-JSON and future event payloads are valid SSE; preserve verbatim.
    }
    return { event, data, rawData, ...(id === undefined ? {} : { id }), ...(retry === undefined ? {} : { retry }) };
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n?/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = decodeBlock(block);
        if (parsed) yield parsed;
      }
      if (done) break;
    }
    const parsed = decodeBlock(buffer);
    if (parsed) yield parsed;
  } finally {
    reader.releaseLock();
  }
}

export class HermesApiClient {
  public readonly baseUrl: string;
  public readonly openaiBaseUrl: string;
  private readonly apiKey: string | null;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly defaultHeaders: Headers;

  constructor(baseUrl: string, options: HermesApiClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.openaiBaseUrl = `${this.baseUrl}/v1`;
    this.apiKey = options.apiKey?.trim() || null;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.defaultHeaders = new Headers(options.headers);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.requestRaw(method, path, body);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private async requestRaw(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(this.defaultHeaders);
    if (this.apiKey) headers.set('Authorization', `Bearer ${this.apiKey}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await this.fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw await responseError(response, method, url);
    return response;
  }

  health(): Promise<HermesHealth> {
    return this.request('GET', '/health');
  }

  healthDetailed(): Promise<HermesDetailedHealth> {
    return this.request('GET', '/health/detailed');
  }

  capabilities(): Promise<HermesCapabilities> {
    return this.request('GET', '/v1/capabilities');
  }

  models(): Promise<HermesModelsResponse> {
    return this.request('GET', '/v1/models');
  }

  listSessions(options: HermesListSessionsOptions = {}): Promise<HermesSessionListResponse> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    if (options.source) query.set('source', options.source);
    if (options.includeChildren !== undefined) query.set('include_children', String(options.includeChildren));
    const suffix = query.size ? `?${query}` : '';
    return this.request('GET', `/api/sessions${suffix}`);
  }

  createSession(request: HermesCreateSessionRequest = {}): Promise<HermesSessionResponse> {
    return this.request('POST', '/api/sessions', request);
  }

  getSession(sessionId: string): Promise<HermesSessionResponse> {
    return this.request('GET', `/api/sessions/${encodePath(sessionId)}`);
  }

  updateSession(sessionId: string, request: HermesUpdateSessionRequest): Promise<HermesSessionResponse> {
    return this.request('PATCH', `/api/sessions/${encodePath(sessionId)}`, request);
  }

  deleteSession(sessionId: string): Promise<Record<string, unknown>> {
    return this.request('DELETE', `/api/sessions/${encodePath(sessionId)}`);
  }

  sessionMessages(sessionId: string): Promise<HermesSessionMessagesResponse> {
    return this.request('GET', `/api/sessions/${encodePath(sessionId)}/messages`);
  }

  forkSession(sessionId: string, request: HermesForkSessionRequest = {}): Promise<HermesSessionResponse> {
    return this.request('POST', `/api/sessions/${encodePath(sessionId)}/fork`, request);
  }

  chatSession(sessionId: string, request: HermesSessionChatRequest): Promise<HermesSessionChatResponse> {
    return this.request('POST', `/api/sessions/${encodePath(sessionId)}/chat`, request);
  }

  async *streamSessionChat(
    sessionId: string,
    request: HermesSessionChatRequest,
  ): AsyncGenerator<HermesSseEvent> {
    const response = await this.requestRaw('POST', `/api/sessions/${encodePath(sessionId)}/chat/stream`, request);
    yield* parseSse(response);
  }

  lockSessionModel(
    sessionId: string,
    request: HermesSessionModelLockRequest,
  ): Promise<HermesSessionModelLockResponse> {
    return this.request('POST', `/api/sessions/${encodePath(sessionId)}/model`, request);
  }

  createRun(request: HermesCreateRunRequest): Promise<HermesCreateRunResponse> {
    return this.request('POST', '/v1/runs', request);
  }

  getRun(runId: string): Promise<HermesRun> {
    return this.request('GET', `/v1/runs/${encodePath(runId)}`);
  }

  async *runEvents(runId: string): AsyncGenerator<HermesSseEvent> {
    const response = await this.requestRaw('GET', `/v1/runs/${encodePath(runId)}/events`);
    yield* parseSse(response);
  }

  approveRun(runId: string, request: HermesApproveRunRequest): Promise<HermesApproveRunResponse> {
    return this.request('POST', `/v1/runs/${encodePath(runId)}/approval`, {
      choice: request.choice,
      ...(request.resolveAll === undefined ? {} : { resolve_all: request.resolveAll }),
    });
  }

  stopRun(runId: string): Promise<HermesRun> {
    return this.request('POST', `/v1/runs/${encodePath(runId)}/stop`, {});
  }
}
