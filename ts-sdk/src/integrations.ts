/**
 * Integrations facade API - OAuth-backed third-party provider connections
 * (GitHub, Slack, ...) fronted by the /integrations FastAPI service.
 */
import { requestWithRetry, responseAPIError } from './http.js';
import { getAgentsApiBaseUrl } from './config.js';

function envValue(key: string): string | undefined {
  const maybeProcess = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.[key];
}

export function deriveIntegrationsApiBase(agentsApiBase?: string): string {
  const configured = envValue('HYPER_INTEGRATIONS_API_BASE');
  const raw = (configured || agentsApiBase || getAgentsApiBaseUrl()).replace(/\/$/, '');
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  let path = url.pathname.replace(/\/$/, '');
  if (path.endsWith('/integrations')) {
    return `${url.protocol}//${url.host}${path}`;
  }
  if (path.endsWith('/agents')) {
    path = path.slice(0, -'/agents'.length);
  }
  return `${url.protocol}//${url.host}${path}/integrations`;
}

export interface Provider {
  name: string;
  providerId: string;
  displayName: string;
  auth: string;
  modes: string[];
  backend: string;
  iconUrl: string;
  categories: string[] | null;
  docsUrl: string | null;
  description: string | null;
  connectFlow?: string;
}

export interface ConnectionInfo {
  id: string;
  errors: string[];
  hyperEnabled: boolean | null;
  createdAt: string | null;
}

export interface ConnectionEntry extends Provider {
  connected: boolean;
  backendAvailable: boolean;
  connection: ConnectionInfo | null;
  connections?: ConnectionInfo[];
}

export interface ConnectSession {
  provider: string;
  authorizeUrl: string;
  expiresAt: string | null;
  stack: string;
}

export interface TokenResponse {
  provider: string;
  accessToken: string;
  expiresAt: string | null;
  stack: string;
}

export interface CredentialsResponse {
  provider: string;
  connectionId: string;
  credentials: Record<string, unknown>;
  stack: string;
}

export interface ProxyOptions {
  method?: string;
  body?: any;
  query?: Record<string, string | number | Array<string | number>>;
  connectionId?: string;
  headers?: Record<string, string>;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : value === null ? null : value === undefined ? null : String(value);
}

function providerFromDict(data: any): Provider {
  return {
    name: data?.name || '',
    providerId: data?.provider_id ?? data?.providerId ?? '',
    displayName: data?.display_name ?? data?.displayName ?? data?.name ?? '',
    auth: data?.auth || '',
    modes: Array.isArray(data?.modes) ? data.modes.map(String) : [],
    backend: data?.backend || '',
    iconUrl: data?.icon_url ?? data?.iconUrl ?? '',
    categories: Array.isArray(data?.categories) ? data.categories.map(String) : null,
    docsUrl: stringOrNull(data?.docs_url ?? data?.docsUrl),
    description: stringOrNull(data?.description),
    connectFlow: data?.connect_flow,
  };
}

function connectionInfoFromDict(data: any): ConnectionInfo {
  return {
    id: String(data?.id ?? data?.connection_id ?? ''),
    errors: Array.isArray(data?.errors) ? data.errors.map(String) : [],
    hyperEnabled: data?.hyper_enabled ?? data?.hyperEnabled ?? (typeof data?.enabled === 'boolean' ? data.enabled : null),
    createdAt: stringOrNull(data?.created_at ?? data?.createdAt),
  };
}

function connectionEntryFromDict(name: string, data: any): ConnectionEntry {
  return {
    ...providerFromDict({ name, ...data }),
    connected: Boolean(data?.connected),
    backendAvailable: data?.backend_available !== undefined ? Boolean(data.backend_available) : true,
    connection: data?.connection ? connectionInfoFromDict(data.connection) : null,
    connections: Array.isArray(data?.connections) ? data.connections.map(connectionInfoFromDict) : undefined,
  };
}

function connectSessionFromDict(data: any): ConnectSession {
  return {
    provider: data?.provider || '',
    authorizeUrl: data?.authorize_url ?? data?.authorizeUrl ?? '',
    expiresAt: stringOrNull(data?.expires_at ?? data?.expiresAt),
    stack: data?.stack || '',
  };
}

function tokenResponseFromDict(data: any): TokenResponse {
  return {
    provider: data?.provider || '',
    accessToken: data?.access_token ?? data?.accessToken ?? '',
    expiresAt: stringOrNull(data?.expires_at ?? data?.expiresAt),
    stack: data?.stack || '',
  };
}

async function handleResponse<T = any>(response: Response, method?: string): Promise<T> {
  if (response.status >= 400) {
    throw await responseAPIError(response, method);
  }
  if (response.status === 204 || response.status === 205) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

function encodeRef(value: string): string {
  return encodeURIComponent(value);
}

function encodePath(value: string): string {
  return value
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

export class IntegrationsAPI {
  private apiBase: string;
  private apiKey: string;
  private timeout: number;

  constructor(apiKey: string, options: { apiBase?: string; agentsApiBase?: string; timeout?: number } = {}) {
    if (!apiKey) {
      throw new Error('API key required for integrations');
    }
    this.apiKey = apiKey;
    this.apiBase = (options.apiBase || deriveIntegrationsApiBase(options.agentsApiBase)).replace(/\/$/, '');
    this.timeout = options.timeout ?? 90000;
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
    query?: Record<string, string | number | Array<string | number>>,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const response = await requestWithRetry({
      method,
      url: `${this.apiBase}${path}`,
      headers: { ...this.headers(), ...extraHeaders },
      body,
      params: query,
      retries: method === 'GET' ? 3 : 1,
      timeout: this.timeout,
    });
    return handleResponse<T>(response, method);
  }

  /** GET /providers — catalog of configured integration providers. */
  async listProviders(): Promise<Provider[]> {
    const data = await this.request<any>('GET', '/providers');
    const providers = Array.isArray(data?.providers) ? data.providers : [];
    return providers.map(providerFromDict);
  }

  /** GET /connections — per-provider connection state for the caller. */
  async listConnections(): Promise<ConnectionEntry[]> {
    const data = await this.request<any>('GET', '/connections');
    const connections = data?.connections && typeof data.connections === 'object' ? data.connections : {};
    return Object.entries(connections).map(([name, entry]) => connectionEntryFromDict(name, entry));
  }

  /** POST /connections/{provider}/start — begin an OAuth connect session. */
  async startConnection(provider: string, connectionId?: string, newConnection = false): Promise<ConnectSession> {
    const query: Record<string, string> = {};
    if (connectionId) query.connection_id = connectionId;
    if (newConnection) query.new_connection = 'true';
    const data = await this.request('POST', `/connections/${encodeRef(provider)}/start`, undefined, query);
    return connectSessionFromDict(data);
  }

  /**
   * POST /connections/{provider}/complete — verify and enable the connection.
   * Throws APIError 409 while the OAuth flow is still unfinished (pollable).
   */
  async completeConnection(provider: string, connectionId?: string): Promise<{ provider: string; connected: boolean; connection: ConnectionInfo | null; stack: string }> {
    const data = await this.request<any>('POST', `/connections/${encodeRef(provider)}/complete`, undefined, connectionId ? { connection_id: connectionId } : undefined);
    return {
      provider: data?.provider || '',
      connected: Boolean(data?.connected),
      connection: data?.connection ? connectionInfoFromDict(data.connection) : null,
      stack: data?.stack || '',
    };
  }

  /** PATCH /connections/{provider} — enable/disable without disconnecting. */
  async setConnectionEnabled(provider: string, enabled: boolean, connectionId?: string): Promise<{ provider: string; enabled: boolean }> {
    return this.request('PATCH', `/connections/${encodeRef(provider)}`, { enabled }, connectionId ? { connection_id: connectionId } : undefined);
  }

  /** DELETE /connections/{provider}. */
  async disconnect(provider: string, connectionId?: string): Promise<{ provider: string; deleted: boolean }> {
    return this.request('DELETE', `/connections/${encodeRef(provider)}`, undefined, connectionId ? { connection_id: connectionId } : undefined);
  }

  /** POST /token/{provider} — mint a fresh access token for the connection. */
  async mintToken(provider: string, connectionId?: string): Promise<TokenResponse> {
    const data = await this.request('POST', `/token/${encodeRef(provider)}`, undefined, connectionId ? { connection_id: connectionId } : undefined);
    return tokenResponseFromDict(data);
  }

  /** Native Nango credentials; can include long-lived secrets. Requires credentials mode. */
  async credentials(provider: string, connectionId?: string): Promise<CredentialsResponse> {
    const data = await this.request('POST', `/credentials/${encodeRef(provider)}`, undefined, connectionId ? { connection_id: connectionId } : undefined);
    return { provider: data.provider, connectionId: data.connection_id, credentials: data.credentials, stack: data.stack };
  }

  /** Import native Nango credentials. Existing connection IDs must belong to the caller. */
  async importConnection(provider: string, credentials: Record<string, unknown>, options: { connectionId?: string; connectionConfig?: Record<string, unknown> } = {}): Promise<ConnectionInfo> {
    const data = await this.request('POST', `/connections/${encodeRef(provider)}/import`,
      { credentials, connection_config: options.connectionConfig ?? {} }, options.connectionId ? { connection_id: options.connectionId } : undefined);
    return connectionInfoFromDict(data.connection);
  }

  /**
   * ANY /proxy/{provider}/{path} — authenticated passthrough to the provider's
   * upstream API with the connection's credentials attached server-side.
   */
  async proxy(provider: string, path: string, options: ProxyOptions = {}): Promise<any> {
    const method = (options.method || 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    if (options.connectionId) headers['X-HyperCLI-Connection-Id'] = options.connectionId;
    for (const [key, value] of Object.entries(options.headers ?? {})) headers[`Nango-Proxy-${key}`] = value;
    const [pathname, queryString] = path.split('?', 2);
    const query = { ...Object.fromEntries(new URLSearchParams(queryString)), ...options.query };
    return this.request(method, `/proxy/${encodeRef(provider)}/${encodePath(pathname)}`, options.body, query, headers);
  }
}
