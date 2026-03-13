/**
 * HyperClaw agents API - typed agent lifecycle, files, exec, and OpenClaw access.
 */
import type { HTTPClient } from './http.js';
import {
  GatewayClient,
  type ChatEvent,
  type GatewayOptions,
  type OpenClawConfigSchemaResponse,
} from './gateway.js';

const AGENTS_API_BASE = 'https://api.hypercli.com/agents';
const DEV_AGENTS_API_BASE = 'https://api.dev.hypercli.com/agents';
const DEPLOYMENTS_API_PREFIX = '/deployments';
const AGENTS_WS_URL = 'wss://api.agents.hypercli.com/ws';
const DEV_AGENTS_WS_URL = 'wss://api.agents.dev.hypercli.com/ws';

export interface AgentExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AgentTokenResponse {
  agent_id?: string;
  pod_id?: string;
  token?: string;
  jwt?: string;
  expires_at?: string | null;
}

export interface AgentShellTokenResponse {
  agent_id?: string;
  jwt: string;
  expires_at?: string | null;
  ws_url?: string;
  shell?: string | null;
  dry_run?: boolean;
}

export interface AgentLogsTokenResponse {
  agent_id?: string;
  jwt: string;
  expires_at?: string | null;
  ws_url?: string;
}

export interface AgentListResponse {
  items: Agent[];
  budget?: Record<string, any>;
}

export interface AgentRouteConfig {
  port: number;
  prefix?: string;
  auth?: boolean;
  strip_prefix?: boolean;
  [key: string]: any;
}

export interface RegistryAuth {
  username?: string;
  password?: string;
  token?: string;
  [key: string]: any;
}

export interface BuildAgentConfigOptions {
  env?: Record<string, string>;
  ports?: Record<string, any>[] | null;
  routes?: Record<string, AgentRouteConfig> | null;
  command?: string[] | null;
  entrypoint?: string[] | null;
  image?: string | null;
  registryUrl?: string | null;
  registryAuth?: RegistryAuth | null;
  gatewayToken?: string | null;
}

export interface CreateAgentOptions extends BuildAgentConfigOptions {
  name?: string;
  size?: string;
  cpu?: number;
  memory?: number;
  config?: Record<string, any>;
  dryRun?: boolean;
  start?: boolean;
}

export interface StartAgentOptions extends BuildAgentConfigOptions {
  config?: Record<string, any>;
  dryRun?: boolean;
}

export interface AgentExecOptions {
  timeout?: number;
  dryRun?: boolean;
}

export interface AgentStateFields {
  id: string;
  userId: string;
  podId: string;
  podName: string;
  state: string;
  name?: string | null;
  cpu: number;
  memory: number;
  hostname?: string | null;
  jwtToken?: string | null;
  jwtExpiresAt?: Date | null;
  startedAt?: Date | null;
  stoppedAt?: Date | null;
  lastError?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  launchConfig?: Record<string, any> | null;
  routes: Record<string, AgentRouteConfig>;
  command: string[];
  entrypoint: string[];
  ports: Record<string, any>[];
  dryRun: boolean;
}

export interface AgentHydrationData {
  id?: string;
  user_id?: string;
  pod_id?: string;
  pod_name?: string;
  state?: string;
  name?: string | null;
  cpu?: number;
  memory?: number;
  hostname?: string | null;
  jwt_token?: string | null;
  jwt_expires_at?: string | null;
  started_at?: string | null;
  stopped_at?: string | null;
  last_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  launch_config?: Record<string, any> | null;
  routes?: Record<string, AgentRouteConfig> | null;
  command?: string[] | null;
  entrypoint?: string[] | null;
  ports?: Record<string, any>[] | null;
  dry_run?: boolean;
  openclaw_url?: string | null;
  gateway_url?: string | null;
  gateway_token?: string | null;
  [key: string]: any;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  return new Date(value.replace('Z', '+00:00'));
}

function toWsBaseUrl(baseUrl: string): string {
  const base = (baseUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}`;
  if (base.startsWith('http://')) return `ws://${base.slice('http://'.length)}`;
  return base;
}

function normalizeAgentsWsUrl(url: string): string {
  const base = toWsBaseUrl(url);
  if (!base) return '';
  return base.endsWith('/ws') ? base : `${base}/ws`;
}

export function resolveAgentsApiBase(apiBase: string): string {
  const raw = (apiBase || '').trim();
  if (!raw) return AGENTS_API_BASE;
  const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
  const host = parsed.host.toLowerCase();
  if (host === 'api.hypercli.com' || host === 'api.hyperclaw.app') return AGENTS_API_BASE;
  if (host === 'api.dev.hypercli.com' || host === 'api.dev.hyperclaw.app' || host === 'dev-api.hyperclaw.app') {
    return DEV_AGENTS_API_BASE;
  }
  return raw.replace(/\/$/, '');
}

function defaultAgentsWsUrl(apiBase: string): string {
  const resolvedApiBase = resolveAgentsApiBase(apiBase);
  const parsed = new URL(resolvedApiBase.includes('://') ? resolvedApiBase : `https://${resolvedApiBase}`);
  const host = parsed.host.toLowerCase();
  if (host === 'api.hypercli.com' || host === 'api.hyperclaw.app') return AGENTS_WS_URL;
  if (host === 'api.dev.hypercli.com' || host === 'api.dev.hyperclaw.app' || host === 'dev-api.hyperclaw.app') {
    return DEV_AGENTS_WS_URL;
  }
  return normalizeAgentsWsUrl(resolvedApiBase);
}

function randomHexToken(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('');
}

function encodeFilePath(path: string): string {
  return path
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function decodeUtf8(content: Uint8Array): string {
  return new TextDecoder().decode(content);
}

function encodeUtf8(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

function toUint8Array(content: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof content === 'string') return encodeUtf8(content);
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(content);
}

function execResultFromDict(data: any): AgentExecResult {
  return {
    exitCode: data.exit_code ?? -1,
    stdout: data.stdout || '',
    stderr: data.stderr || '',
  };
}

function agentStateFromDict(data: AgentHydrationData): AgentStateFields {
  return {
    id: data.id ?? '',
    userId: data.user_id ?? '',
    podId: data.pod_id ?? '',
    podName: data.pod_name ?? '',
    state: data.state ?? 'unknown',
    name: data.name ?? null,
    cpu: data.cpu ?? 0,
    memory: data.memory ?? 0,
    hostname: data.hostname ?? null,
    jwtToken: data.jwt_token ?? null,
    jwtExpiresAt: parseDate(data.jwt_expires_at),
    startedAt: parseDate(data.started_at),
    stoppedAt: parseDate(data.stopped_at),
    lastError: data.last_error ?? null,
    createdAt: parseDate(data.created_at),
    updatedAt: parseDate(data.updated_at),
    launchConfig: data.launch_config ?? null,
    routes: data.routes ?? {},
    command: data.command ?? [],
    entrypoint: data.entrypoint ?? [],
    ports: data.ports ?? [],
    dryRun: Boolean(data.dry_run),
  };
}

export function buildAgentConfig(
  config: Record<string, any> = {},
  options: BuildAgentConfigOptions = {},
): { config: Record<string, any>; gatewayToken: string } {
  const prepared = { ...config };
  const env = { ...(prepared.env ?? {}) } as Record<string, string>;
  if (options.env) Object.assign(env, options.env);

  let gatewayToken = options.gatewayToken?.trim() || env.OPENCLAW_GATEWAY_TOKEN?.trim() || '';
  if (!gatewayToken) {
    gatewayToken = randomHexToken(32);
  }

  env.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
  prepared.env = env;

  if (options.ports !== undefined && options.ports !== null) prepared.ports = options.ports;
  if (options.routes !== undefined && options.routes !== null) prepared.routes = options.routes;
  if (options.command !== undefined && options.command !== null) prepared.command = options.command;
  if (options.entrypoint !== undefined && options.entrypoint !== null) prepared.entrypoint = options.entrypoint;
  if (options.image !== undefined && options.image !== null) prepared.image = options.image;
  if (options.registryUrl !== undefined && options.registryUrl !== null) prepared.registry_url = options.registryUrl;
  if (options.registryAuth !== undefined && options.registryAuth !== null) prepared.registry_auth = options.registryAuth;

  return { config: prepared, gatewayToken };
}

async function getFsPromises() {
  return import('node:fs/promises');
}

function bindAgent<T extends Agent>(agent: T, deployments: Deployments): T {
  agent._deployments = deployments;
  return agent;
}

export class Agent {
  public readonly id: string;
  public readonly userId: string;
  public readonly podId: string;
  public readonly podName: string;
  public readonly state: string;
  public readonly name: string | null;
  public readonly cpu: number;
  public readonly memory: number;
  public readonly hostname: string | null;
  public jwtToken: string | null;
  public jwtExpiresAt: Date | null;
  public readonly startedAt: Date | null;
  public readonly stoppedAt: Date | null;
  public readonly lastError: string | null;
  public readonly createdAt: Date | null;
  public readonly updatedAt: Date | null;
  public launchConfig: Record<string, any> | null;
  public routes: Record<string, AgentRouteConfig>;
  public command: string[];
  public entrypoint: string[];
  public ports: Record<string, any>[];
  public readonly dryRun: boolean;
  _deployments: Deployments | null = null;

  constructor(fields: AgentStateFields) {
    this.id = fields.id;
    this.userId = fields.userId;
    this.podId = fields.podId;
    this.podName = fields.podName;
    this.state = fields.state;
    this.name = fields.name ?? null;
    this.cpu = fields.cpu;
    this.memory = fields.memory;
    this.hostname = fields.hostname ?? null;
    this.jwtToken = fields.jwtToken ?? null;
    this.jwtExpiresAt = fields.jwtExpiresAt ?? null;
    this.startedAt = fields.startedAt ?? null;
    this.stoppedAt = fields.stoppedAt ?? null;
    this.lastError = fields.lastError ?? null;
    this.createdAt = fields.createdAt ?? null;
    this.updatedAt = fields.updatedAt ?? null;
    this.launchConfig = fields.launchConfig ?? null;
    this.routes = { ...fields.routes };
    this.command = [...fields.command];
    this.entrypoint = [...fields.entrypoint];
    this.ports = [...fields.ports];
    this.dryRun = fields.dryRun;
  }

  static fromDict(data: AgentHydrationData): Agent {
    return new Agent(agentStateFromDict(data));
  }

  get publicUrl(): string | null {
    return this.hostname ? `https://${this.hostname}` : null;
  }

  get vncUrl(): string | null {
    return this.publicUrl;
  }

  get shellUrl(): string | null {
    return this.hostname ? `https://shell-${this.hostname}` : null;
  }

  get executorUrl(): string | null {
    return this.shellUrl;
  }

  get isRunning(): boolean {
    return this.state.toLowerCase() === 'running';
  }

  protected requireDeployments(): Deployments {
    if (!this._deployments) {
      throw new Error('Agent is not bound to a Deployments client');
    }
    return this._deployments;
  }

  async refreshToken(): Promise<AgentTokenResponse> {
    const data = await this.requireDeployments().refreshToken(this.id);
    this.jwtToken = data.token ?? data.jwt ?? null;
    this.jwtExpiresAt = parseDate(data.expires_at);
    return data;
  }

  async env(): Promise<Record<string, string>> {
    const data = await this.requireDeployments().env(this.id);
    return data.env ?? {};
  }

  async exec(command: string, options: AgentExecOptions = {}): Promise<AgentExecResult> {
    return this.requireDeployments().exec(this, command, options);
  }

  async health(): Promise<Record<string, any>> {
    return this.requireDeployments().health(this);
  }

  async filesList(path: string = ''): Promise<any[]> {
    return this.requireDeployments().filesList(this, path);
  }

  async fileReadBytes(path: string): Promise<Uint8Array> {
    return this.requireDeployments().fileReadBytes(this, path);
  }

  async fileRead(path: string): Promise<string> {
    return decodeUtf8(await this.fileReadBytes(path));
  }

  async fileWriteBytes(path: string, content: Uint8Array | ArrayBuffer | string): Promise<Record<string, any>> {
    return this.requireDeployments().fileWriteBytes(this, path, content);
  }

  async fileWrite(path: string, content: string): Promise<Record<string, any>> {
    return this.requireDeployments().fileWrite(this, path, content);
  }

  async fileDelete(path: string, options: { recursive?: boolean } = {}): Promise<Record<string, any>> {
    return this.requireDeployments().fileDelete(this, path, options);
  }

  async cpTo(localPath: string, remotePath: string): Promise<Record<string, any>> {
    return this.requireDeployments().cpTo(this, localPath, remotePath);
  }

  async cpFrom(remotePath: string, localPath: string): Promise<string> {
    return this.requireDeployments().cpFrom(this, remotePath, localPath);
  }

  async shellConnect(shell?: string): Promise<WebSocket> {
    return this.requireDeployments().shellConnect(this.id, shell);
  }
}

export class OpenClawAgent extends Agent {
  public gatewayUrl: string | null;
  public gatewayToken: string | null;

  constructor(fields: AgentStateFields & { gatewayUrl?: string | null; gatewayToken?: string | null }) {
    super(fields);
    this.gatewayUrl = fields.gatewayUrl ?? null;
    this.gatewayToken = fields.gatewayToken ?? null;
  }

  static override fromDict(data: AgentHydrationData): OpenClawAgent {
    return new OpenClawAgent({
      ...agentStateFromDict(data),
      gatewayUrl: data.openclaw_url ?? data.gateway_url ?? null,
      gatewayToken: data.gateway_token ?? null,
    });
  }

  /**
   * Resolve the gateway token. If not set locally (e.g. page refresh),
   * fetches from the pod's runtime env via the backend.
   */
  async resolveGatewayToken(): Promise<string | null> {
    if (this.gatewayToken) return this.gatewayToken;
    const envData = await this.env();
    this.gatewayToken = envData.OPENCLAW_GATEWAY_TOKEN ?? null;
    return this.gatewayToken;
  }

  gateway(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): GatewayClient {
    if (!this.gatewayUrl) {
      throw new Error('Agent has no OpenClaw gateway URL');
    }
    if (!this.jwtToken) {
      throw new Error('Agent has no JWT token');
    }

    return new GatewayClient({
      url: this.gatewayUrl,
      token: this.jwtToken,
      gatewayToken: options.gatewayToken ?? this.gatewayToken ?? undefined,
      clientId: options.clientId,
      clientMode: options.clientMode,
      origin: options.origin,
      timeout: options.timeout,
    });
  }

  async connect(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<GatewayClient> {
    // Auto-resolve gateway token if missing
    if (!this.gatewayToken && !options.gatewayToken) {
      await this.resolveGatewayToken();
    }
    const client = this.gateway(options);
    await client.connect();
    return client;
  }

  async gatewayStatus(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<Record<string, any>> {
    const client = await this.connect(options);
    try {
      return await client.status();
    } finally {
      client.close();
    }
  }

  async configGet(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<Record<string, any>> {
    const client = await this.connect(options);
    try {
      return await client.configGet();
    } finally {
      client.close();
    }
  }

  async configSchema(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<OpenClawConfigSchemaResponse> {
    const client = await this.connect(options);
    try {
      return await client.configSchema();
    } finally {
      client.close();
    }
  }

  async sessionsList(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<any[]> {
    const client = await this.connect(options);
    try {
      return await client.sessionsList();
    } finally {
      client.close();
    }
  }

  async *chatSend(
    message: string,
    sessionKey: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): AsyncGenerator<ChatEvent> {
    const client = await this.connect(options);
    try {
      for await (const event of client.chatSend(message, sessionKey)) {
        yield event;
      }
    } finally {
      client.close();
    }
  }
}

export class Deployments {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly agentsWsUrl: string;

  constructor(
    private readonly http: HTTPClient,
    agentApiKey?: string,
    agentApiBase?: string,
    agentsWsUrl?: string,
  ) {
    this.apiKey = agentApiKey || (http as any).apiKey;
    this.apiBase = resolveAgentsApiBase(agentApiBase || process.env.HYPERCLI_API_URL || AGENTS_API_BASE);
    this.agentsWsUrl = agentsWsUrl ? normalizeAgentsWsUrl(agentsWsUrl) : defaultAgentsWsUrl(this.apiBase);
  }

  private hydrateAgent(data: AgentHydrationData): Agent {
    const agent =
      data.openclaw_url || data.gateway_url
        ? OpenClawAgent.fromDict(data)
        : Agent.fromDict(data);
    return bindAgent(agent, this);
  }

  private agentIdFor(target: Agent | string): string {
    return typeof target === 'string' ? target : target.id;
  }

  private async fetchRaw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    headers.set('Authorization', `Bearer ${this.apiKey}`);
    const response = await fetch(`${this.apiBase}${path}`, { ...init, headers });
    if (!response.ok) {
      throw new Error(`Agent request failed: ${response.status} ${response.statusText}`);
    }
    return response;
  }

  async create(options: CreateAgentOptions = {}): Promise<Agent> {
    const { config, gatewayToken } = buildAgentConfig(options.config ?? {}, options);
    const body: Record<string, any> = { config, start: options.start ?? true };
    if (options.dryRun) body.dry_run = true;
    if (options.name) body.name = options.name;
    if (options.size) body.size = options.size;
    if (options.cpu !== undefined) body.cpu = options.cpu;
    if (options.memory !== undefined) body.memory = options.memory;

    const data = await this.http.post<AgentHydrationData>(DEPLOYMENTS_API_PREFIX, body);
    const agent = this.hydrateAgent(data);
    if (agent instanceof OpenClawAgent) {
      agent.gatewayToken = gatewayToken;
    }
    agent.launchConfig = config;
    agent.command = [...(config.command ?? [])];
    agent.entrypoint = [...(config.entrypoint ?? [])];
    return agent;
  }

  async budget(): Promise<Record<string, any>> {
    return this.http.get(`${DEPLOYMENTS_API_PREFIX}/budget`);
  }

  async metrics(agentId: string): Promise<Record<string, any>> {
    return this.http.get(`${DEPLOYMENTS_API_PREFIX}/${agentId}/metrics`);
  }

  async list(): Promise<AgentListResponse> {
    const data = await this.http.get<any>(DEPLOYMENTS_API_PREFIX);
    const items = Array.isArray(data) ? data : data.items ?? [];
    return {
      items: items.map((item: AgentHydrationData) => this.hydrateAgent(item)),
      budget: Array.isArray(data) ? undefined : data.budget,
    };
  }

  async get(agentId: string): Promise<Agent> {
    const data = await this.http.get<AgentHydrationData>(`${DEPLOYMENTS_API_PREFIX}/${agentId}`);
    return this.hydrateAgent(data);
  }

  async start(agentId: string, options: StartAgentOptions = {}): Promise<Agent> {
    const { config, gatewayToken } = buildAgentConfig(options.config ?? {}, options);
    const body: Record<string, any> = { config };
    if (options.dryRun) body.dry_run = true;
    const data = await this.http.post<AgentHydrationData>(`${DEPLOYMENTS_API_PREFIX}/${agentId}/start`, body);
    const agent = this.hydrateAgent(data);
    if (agent instanceof OpenClawAgent) {
      agent.gatewayToken = gatewayToken;
    }
    agent.launchConfig = config;
    agent.command = [...(config.command ?? [])];
    agent.entrypoint = [...(config.entrypoint ?? [])];
    return agent;
  }

  async stop(agentId: string): Promise<Agent> {
    const data = await this.http.post<AgentHydrationData>(`${DEPLOYMENTS_API_PREFIX}/${agentId}/stop`);
    return this.hydrateAgent(data);
  }

  async delete(agentId: string): Promise<Record<string, any>> {
    return this.http.delete(`${DEPLOYMENTS_API_PREFIX}/${agentId}`);
  }

  async refreshToken(agentId: string): Promise<AgentTokenResponse> {
    return this.http.get(`${DEPLOYMENTS_API_PREFIX}/${agentId}/token`);
  }

  async logsToken(agentId: string): Promise<AgentLogsTokenResponse> {
    return this.http.post(`${DEPLOYMENTS_API_PREFIX}/${agentId}/logs/token`);
  }

  async env(agentId: string): Promise<{ agent_id: string; env: Record<string, string> }> {
    return this.http.get(`${DEPLOYMENTS_API_PREFIX}/${agentId}/env`);
  }

  async exec(target: Agent | string, command: string, options: AgentExecOptions = {}): Promise<AgentExecResult> {
    const agentId = this.agentIdFor(target);
    const payload: Record<string, any> = {
      command,
      timeout: options.timeout ?? 30,
    };
    if (options.dryRun) payload.dry_run = true;
    const data = await this.http.post(`${DEPLOYMENTS_API_PREFIX}/${agentId}/exec`, payload);
    return execResultFromDict(data);
  }

  async health(target: Agent): Promise<Record<string, any>> {
    if (!target.executorUrl) {
      throw new Error('Agent has no executor URL');
    }

    const headers: Record<string, string> = {};
    if (target.jwtToken) {
      headers.Authorization = `Bearer ${target.jwtToken}`;
      headers.Cookie = `${target.podName}-token=${target.jwtToken}`;
    }

    const response = await fetch(`${target.executorUrl}/health`, { headers });
    if (!response.ok) {
      throw new Error(`Agent health failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as Record<string, any>;
  }

  async filesList(target: Agent | string, path: string = ''): Promise<any[]> {
    const encodedPath = encodeFilePath(path);
    const suffix = encodedPath ? `/${encodedPath}` : '';
    const response = await this.fetchRaw(`${DEPLOYMENTS_API_PREFIX}/${this.agentIdFor(target)}/files${suffix}`);
    const payload = (await response.json()) as { directories?: any[]; files?: any[] };
    return [...(payload.directories ?? []), ...(payload.files ?? [])];
  }

  async fileReadBytes(target: Agent | string, path: string): Promise<Uint8Array> {
    const encodedPath = encodeFilePath(path);
    const response = await this.fetchRaw(`${DEPLOYMENTS_API_PREFIX}/${this.agentIdFor(target)}/files/${encodedPath}`, {
      redirect: 'follow',
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  async fileRead(target: Agent | string, path: string): Promise<string> {
    return decodeUtf8(await this.fileReadBytes(target, path));
  }

  async fileWriteBytes(
    target: Agent | string,
    path: string,
    content: Uint8Array | ArrayBuffer | string,
  ): Promise<Record<string, any>> {
    const response = await this.fetchRaw(`${DEPLOYMENTS_API_PREFIX}/${this.agentIdFor(target)}/files/${encodeFilePath(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: toUint8Array(content),
    });
    return (await response.json()) as Record<string, any>;
  }

  async fileWrite(target: Agent | string, path: string, content: string): Promise<Record<string, any>> {
    return this.fileWriteBytes(target, path, content);
  }

  async fileDelete(
    target: Agent | string,
    path: string,
    options: { recursive?: boolean } = {},
  ): Promise<Record<string, any>> {
    const encodedPath = encodeFilePath(path);
    const params = new URLSearchParams();
    if (options.recursive) params.set('recursive', 'true');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await this.fetchRaw(
      `${DEPLOYMENTS_API_PREFIX}/${this.agentIdFor(target)}/files/${encodedPath}${suffix}`,
      { method: 'DELETE' },
    );
    return (await response.json()) as Record<string, any>;
  }

  async cpTo(target: Agent | string, localPath: string, remotePath: string): Promise<Record<string, any>> {
    const fs = await getFsPromises();
    const content = await fs.readFile(localPath);
    return this.fileWriteBytes(target, remotePath, new Uint8Array(content));
  }

  async cpFrom(target: Agent | string, remotePath: string, localPath: string): Promise<string> {
    const fs = await getFsPromises();
    const content = await this.fileReadBytes(target, remotePath);
    const destination = new URL(`file://${localPath}`).pathname;
    const parts = destination.split('/');
    parts.pop();
    const parent = parts.join('/') || '/';
    await fs.mkdir(parent, { recursive: true });
    await fs.writeFile(destination, content);
    return destination;
  }

  async logsConnect(
    agentId: string,
    options: { tailLines?: number; container?: string } = {},
  ): Promise<WebSocket> {
    const tokenData = await this.logsToken(agentId);
    const container = options.container ?? 'reef';
    const tailLines = options.tailLines ?? 100;
    const wsUrl =
      `${this.agentsWsUrl}/logs/${agentId}` +
      `?jwt=${encodeURIComponent(tokenData.jwt)}` +
      `&container=${encodeURIComponent(container)}` +
      `&tail_lines=${encodeURIComponent(String(tailLines))}`;
    const ws = new WebSocket(wsUrl);
    return await new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      ws.onopen = () => {
        settled = true;
        resolve(ws);
      };
      ws.onerror = () => {
        if (!settled) {
          reject(new Error('WebSocket connection failed'));
        }
      };
    });
  }

  async shellToken(agentId: string, shell?: string, dryRun: boolean = false): Promise<AgentShellTokenResponse> {
    const selectedShell = shell ?? '/bin/bash';
    const payload: Record<string, any> = { shell: selectedShell };
    if (dryRun) payload.dry_run = true;
    return this.http.post(`${DEPLOYMENTS_API_PREFIX}/${agentId}/shell/token`, payload);
  }

  async shellConnect(agentId: string, shell?: string): Promise<WebSocket> {
    const connectWithShell = async (requestedShell: string): Promise<WebSocket> => {
      const tokenData = await this.shellToken(agentId, requestedShell);
      const baseUrl = `${this.agentsWsUrl}/shell/${agentId}`;
      const separator = baseUrl.includes("?") ? "&" : "?";
      const wsUrl =
        `${baseUrl}${separator}jwt=${encodeURIComponent(tokenData.jwt)}` +
        `&shell=${encodeURIComponent(tokenData.shell || requestedShell)}`;
      const ws = new WebSocket(wsUrl);
      return await new Promise<WebSocket>((resolve, reject) => {
        let settled = false;
        ws.onopen = () => {
          settled = true;
          resolve(ws);
        };
        ws.onerror = () => {
          if (!settled) {
            reject(new Error('WebSocket connection failed'));
          }
        };
      });
    };

    if (shell) {
      return connectWithShell(shell);
    }

    try {
      return await connectWithShell('/bin/bash');
    } catch {
      return connectWithShell('/bin/sh');
    }
  }
}
