/**
 * HyperClaw agents API - typed agent lifecycle, files, exec, and OpenClaw access.
 */
import { randomFillSync } from 'node:crypto';
import { getAgentsApiBaseUrl, getConfigValue } from './config.js';
import { APIError } from './errors.js';
import { HTTPClient } from './http.js';
import {
  GatewayClient,
  type ChatAttachment,
  type ChatEvent,
  type GatewayOptions,
  type GatewayWaitReadyOptions,
  type OpenClawConfigSchemaResponse,
} from './openclaw/gateway.js';

const AGENTS_API_BASE = 'https://api.hypercli.com/agents';
const DEV_AGENTS_API_BASE = 'https://api.dev.hypercli.com/agents';
const DEPLOYMENTS_API_PREFIX = '/deployments';
const AGENTS_WS_URL = 'wss://api.agents.hypercli.com/ws';
const DEV_AGENTS_WS_URL = 'wss://api.agents.dev.hypercli.com/ws';
export const DEFAULT_OPENCLAW_IMAGE = 'ghcr.io/hypercli/hypercli-openclaw:prod';
const LAUNCH_CONFIG_KEYS = new Set(['image', 'env', 'routes', 'ports', 'command', 'entrypoint', 'sync_root', 'sync_enabled', 'registry_url', 'registry_auth']);
const DEFAULT_OPENCLAW_SYNC_ROOT = '/home/node';

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

export interface AgentGatewayContext {
  agent_id?: string;
  hostname?: string | null;
  gateway_token?: string | null;
}

export interface GatewayContextWaitOptions {
  timeoutMs?: number;
  retryIntervalMs?: number;
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
  syncRoot?: string | null;
  syncEnabled?: boolean | null;
  registryUrl?: string | null;
  registryAuth?: RegistryAuth | null;
  gatewayToken?: string | null;
  heartbeat?: OpenClawHeartbeatConfig | null;
}

export interface OpenClawRouteOptions {
  includeGateway?: boolean;
  includeDesktop?: boolean;
  gatewayPort?: number;
  desktopPort?: number;
  gatewayAuth?: boolean;
  desktopAuth?: boolean;
  gatewayPrefix?: string;
  desktopPrefix?: string;
}

export interface OpenClawHeartbeatConfig {
  every?: string;
  model?: string;
  session?: string;
  target?: string;
  directPolicy?: 'allow' | 'block';
  to?: string;
  accountId?: string;
  prompt?: string;
  includeSystemPromptSection?: boolean;
  ackMaxChars?: number;
  suppressToolErrorWarnings?: boolean;
  timeoutSeconds?: number;
  lightContext?: boolean;
  isolatedSession?: boolean;
  includeReasoning?: boolean;
  activeHours?: Record<string, any>;
  [key: string]: any;
}

export interface AgentUiAvatarMeta {
  image?: string | null;
  icon_index?: number | null;
}

export interface AgentUiMeta {
  avatar?: AgentUiAvatarMeta | null;
  [key: string]: any;
}

export interface AgentMeta {
  ui?: AgentUiMeta | null;
}

export type OpenClawModelApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'openai-codex-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'github-copilot'
  | 'bedrock-converse-stream'
  | 'ollama';

export type OpenClawModelProviderAuthMode = 'api-key' | 'aws-sdk' | 'oauth' | 'token';

export type OpenClawSecretInput =
  | string
  | {
      source?: string;
      provider?: string;
      id?: string;
      [key: string]: any;
    };

export interface OpenClawModelCompatConfig {
  thinkingFormat?: string;
  supportsTools?: boolean;
  toolSchemaProfile?: string;
  nativeWebSearchTool?: boolean;
  toolCallArgumentsEncoding?: string;
  requiresMistralToolIds?: boolean;
  requiresOpenAiAnthropicToolPayload?: boolean;
  [key: string]: any;
}

export interface OpenClawModelDefinitionConfig {
  id: string;
  name?: string;
  api?: OpenClawModelApi;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    [key: string]: any;
  };
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: OpenClawModelCompatConfig;
  [key: string]: any;
}

export interface OpenClawModelProviderConfig {
  baseUrl: string;
  apiKey?: OpenClawSecretInput;
  auth?: OpenClawModelProviderAuthMode;
  api?: OpenClawModelApi;
  injectNumCtxForOpenAICompat?: boolean;
  headers?: Record<string, OpenClawSecretInput>;
  authHeader?: boolean;
  models?: OpenClawModelDefinitionConfig[];
  [key: string]: any;
}

export type OpenClawModelProviderPatch =
  & Partial<Omit<OpenClawModelProviderConfig, 'baseUrl'>>
  & Pick<OpenClawModelProviderConfig, 'baseUrl'>;

export interface CreateAgentOptions extends BuildAgentConfigOptions {
  name?: string;
  size?: string;
  config?: Record<string, any>;
  meta?: AgentMeta | null;
  tags?: string[];
  dryRun?: boolean;
  start?: boolean;
}

export interface StartAgentOptions extends BuildAgentConfigOptions {
  config?: Record<string, any>;
  dryRun?: boolean;
}

export interface UpdateAgentOptions {
  name?: string;
  size?: string;
  refreshFromLagoon?: boolean;
  lastError?: string | null;
}

export interface OpenClawCreateAgentOptions extends CreateAgentOptions {
  openClawRoutes?: OpenClawRouteOptions | null;
  heartbeat?: OpenClawHeartbeatConfig | null;
}

export interface OpenClawStartAgentOptions extends StartAgentOptions {
  openClawRoutes?: OpenClawRouteOptions | null;
  heartbeat?: OpenClawHeartbeatConfig | null;
}

export interface AgentExecOptions {
  timeout?: number;
  dryRun?: boolean;
}

export interface AgentFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  size_formatted?: string;
  last_modified?: string;
  [key: string]: any;
}

export interface AgentDirectoryListing {
  type: 'directory';
  prefix: string;
  directories: AgentFileEntry[];
  files: AgentFileEntry[];
  truncated?: boolean;
  [key: string]: any;
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
  tags?: string[];
  jwtToken?: string | null;
  jwtExpiresAt?: Date | null;
  startedAt?: Date | null;
  stoppedAt?: Date | null;
  lastError?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  launchConfig?: Record<string, any> | null;
  meta?: AgentMeta | null;
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
  tags?: string[] | null;
  jwt_token?: string | null;
  jwt_expires_at?: string | null;
  started_at?: string | null;
  stopped_at?: string | null;
  last_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  launch_config?: Record<string, any> | null;
  meta?: { ui?: AgentUiMeta | null } | null;
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

function deepMergeConfig(base: Record<string, any>, patch: Record<string, any>): Record<string, any> {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === 'object' &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = deepMergeConfig(merged[key], value as Record<string, any>);
    } else {
      merged[key] = structuredClone(value);
    }
  }
  return merged;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOpenClawHydrationData(data: AgentHydrationData): boolean {
  const routes = data.routes;
  if (routes && typeof routes === 'object' && !Array.isArray(routes) && routes.openclaw) {
    return true;
  }
  const launchRoutes = data.launch_config?.routes;
  return !!(launchRoutes && typeof launchRoutes === 'object' && !Array.isArray(launchRoutes) && launchRoutes.openclaw);
}

function isDirectoryListingPayload(value: unknown): value is AgentDirectoryListing {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.type === 'directory' &&
    Array.isArray(payload.directories) &&
    Array.isArray(payload.files)
  );
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
  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  const host = parsed.host.toLowerCase();
  if (normalizedPath.endsWith('/agents')) {
    return `${parsed.origin}${normalizedPath}`;
  }
  if (normalizedPath.endsWith('/api')) {
    if (host === 'api.agents.hypercli.com') {
      return AGENTS_API_BASE;
    }
    if (host === 'api.agents.dev.hypercli.com') {
      return DEV_AGENTS_API_BASE;
    }
    return `${parsed.origin}${normalizedPath.slice(0, -4)}/agents`;
  }
  if (host === 'api.agents.hypercli.com' || host === 'api.hypercli.com' || host === 'api.hyperclaw.app') {
    return AGENTS_API_BASE;
  }
  if (
    host === 'api.agents.dev.hypercli.com' ||
    host === 'api.dev.hypercli.com' ||
    host === 'api.dev.hyperclaw.app' ||
    host === 'dev-api.hyperclaw.app'
  ) {
    return DEV_AGENTS_API_BASE;
  }
  const normalized = raw.replace(/\/$/, '');
  return `${normalized}/agents`;
}

function defaultAgentsWsUrl(apiBase: string): string {
  const resolvedApiBase = resolveAgentsApiBase(apiBase);
  const parsed = new URL(resolvedApiBase.includes('://') ? resolvedApiBase : `https://${resolvedApiBase}`);
  const host = parsed.host.toLowerCase();
  if (host === 'api.agents.hypercli.com' || host === 'api.hypercli.com' || host === 'api.hyperclaw.app') return AGENTS_WS_URL;
  if (
    host === 'api.agents.dev.hypercli.com' ||
    host === 'api.dev.hypercli.com' ||
    host === 'api.dev.hyperclaw.app' ||
    host === 'dev-api.hyperclaw.app'
  ) {
    return DEV_AGENTS_WS_URL;
  }
  return normalizeAgentsWsUrl(resolvedApiBase);
}

function randomHexToken(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(buffer);
  } else {
    randomFillSync(buffer);
  }
  return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('');
}

function defaultControlUiAllowedOrigin(): string | null {
  const locationOrigin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return typeof locationOrigin === 'string' && locationOrigin.trim() ? locationOrigin : null;
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
    tags: Array.isArray(data.tags) ? data.tags : [],
    jwtToken: data.jwt_token ?? null,
    jwtExpiresAt: parseDate(data.jwt_expires_at),
    startedAt: parseDate(data.started_at),
    stoppedAt: parseDate(data.stopped_at),
    lastError: data.last_error ?? null,
    createdAt: parseDate(data.created_at),
    updatedAt: parseDate(data.updated_at),
    launchConfig: data.launch_config ?? null,
    meta: data.meta?.ui ? { ui: structuredClone(data.meta.ui) } : null,
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
  const preparedConfig = structuredClone(config);
  const nestedLaunchKeys = Object.keys(preparedConfig).filter((key) => LAUNCH_CONFIG_KEYS.has(key));
  if (nestedLaunchKeys.length) {
    throw new Error(`Launch settings must be top-level fields, not nested under config: ${nestedLaunchKeys.join(', ')}`);
  }
  if (options.heartbeat) {
    const agentsConfig = typeof preparedConfig.agents === 'object' && preparedConfig.agents !== null
      ? { ...preparedConfig.agents }
      : {};
    const defaultsConfig = typeof agentsConfig.defaults === 'object' && agentsConfig.defaults !== null
      ? { ...agentsConfig.defaults }
      : {};
    const heartbeatConfig = typeof defaultsConfig.heartbeat === 'object' && defaultsConfig.heartbeat !== null
      ? { ...defaultsConfig.heartbeat }
      : {};
    defaultsConfig.heartbeat = { ...heartbeatConfig, ...options.heartbeat };
    agentsConfig.defaults = defaultsConfig;
    preparedConfig.agents = agentsConfig;
  }
  const env = { ...(options.env ?? {}) } as Record<string, string>;

  let gatewayToken = options.gatewayToken?.trim() || env.OPENCLAW_GATEWAY_TOKEN?.trim() || '';
  if (!gatewayToken) {
    gatewayToken = randomHexToken(32);
  }

  env.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
  if (!env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN?.trim()) {
    const controlUiOrigin = defaultControlUiAllowedOrigin();
    if (controlUiOrigin) {
      env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN = controlUiOrigin;
    }
  }

  const prepared: Record<string, any> = {};
  if (Object.keys(preparedConfig).length > 0) prepared.config = preparedConfig;
  if (Object.keys(env).length > 0) prepared.env = env;
  if (options.ports !== undefined && options.ports !== null) prepared.ports = options.ports;
  if (options.routes !== undefined && options.routes !== null) prepared.routes = options.routes;
  if (options.command !== undefined && options.command !== null) prepared.command = options.command;
  if (options.entrypoint !== undefined && options.entrypoint !== null) prepared.entrypoint = options.entrypoint;
  if (options.image !== undefined && options.image !== null) prepared.image = options.image;
  if (options.syncRoot !== undefined && options.syncRoot !== null) prepared.sync_root = options.syncRoot;
  if (options.syncEnabled !== undefined && options.syncEnabled !== null) prepared.sync_enabled = options.syncEnabled;
  if (options.registryUrl !== undefined && options.registryUrl !== null) prepared.registry_url = options.registryUrl;
  if (options.registryAuth !== undefined && options.registryAuth !== null) prepared.registry_auth = options.registryAuth;

  return { config: prepared, gatewayToken };
}

function defaultOpenClawImage(
  image: string | null | undefined,
): string {
  if (image !== undefined && image !== null) return image;
  return DEFAULT_OPENCLAW_IMAGE;
}

export function buildOpenClawRoutes(options: OpenClawRouteOptions = {}): Record<string, AgentRouteConfig> {
  const routes: Record<string, AgentRouteConfig> = {};
  if (options.includeGateway ?? true) {
    routes.openclaw = {
      port: options.gatewayPort ?? 18789,
      auth: options.gatewayAuth ?? false,
      prefix: options.gatewayPrefix ?? '',
    };
  }
  if (options.includeDesktop ?? true) {
    routes.desktop = {
      port: options.desktopPort ?? 3000,
      auth: options.desktopAuth ?? true,
      prefix: options.desktopPrefix ?? 'desktop',
    };
  }
  return routes;
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
  public readonly tags: string[];
  public jwtToken: string | null;
  public jwtExpiresAt: Date | null;
  public readonly startedAt: Date | null;
  public readonly stoppedAt: Date | null;
  public readonly lastError: string | null;
  public readonly createdAt: Date | null;
  public readonly updatedAt: Date | null;
  public launchConfig: Record<string, any> | null;
  public readonly meta: AgentMeta | null;
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
    this.tags = [...(fields.tags ?? [])];
    this.jwtToken = fields.jwtToken ?? null;
    this.jwtExpiresAt = fields.jwtExpiresAt ?? null;
    this.startedAt = fields.startedAt ?? null;
    this.stoppedAt = fields.stoppedAt ?? null;
    this.lastError = fields.lastError ?? null;
    this.createdAt = fields.createdAt ?? null;
    this.updatedAt = fields.updatedAt ?? null;
    this.launchConfig = fields.launchConfig ?? null;
    this.meta = fields.meta ? structuredClone(fields.meta) : null;
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

  protected routePrefix(routeName: string, defaultPrefix: string | null = null): string | null {
    const route = this.routes[routeName] ?? {};
    const prefix = route.prefix;
    if (typeof prefix === 'undefined' || prefix === null) {
      return defaultPrefix;
    }
    return String(prefix);
  }

  routeUrl(routeName: string, defaultPrefix: string | null = null): string | null {
    if (!this.hostname) return null;
    const prefix = this.routePrefix(routeName, defaultPrefix);
    if (prefix === null) return null;
    return prefix === '' ? `https://${this.hostname}` : `https://${prefix}-${this.hostname}`;
  }

  get desktopUrl(): string | null {
    return this.routeUrl('desktop', 'desktop');
  }

  get vncUrl(): string | null {
    return this.desktopUrl;
  }

  get shellUrl(): string | null {
    return this.routeUrl('shell');
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

  routeRequiresAuth(routeName: string, defaultValue = true): boolean {
    const route = this.routes[routeName];
    if (!route || typeof route.auth === 'undefined') {
      return defaultValue;
    }
    return Boolean(route.auth);
  }

  async refreshToken(): Promise<AgentTokenResponse> {
    const data = await this.requireDeployments().refreshToken(this.id);
    this.jwtToken = data.token ?? data.jwt ?? null;
    this.jwtExpiresAt = parseDate(data.expires_at);
    return data;
  }

  async waitRunning(timeoutMs = 300_000, pollIntervalMs = 5_000): Promise<Agent> {
    return this.requireDeployments().waitRunning(this.id, timeoutMs, pollIntervalMs);
  }

  async update(options: UpdateAgentOptions): Promise<Agent> {
    return this.requireDeployments().update(this.id, options);
  }

  async resize(options: Pick<UpdateAgentOptions, 'size'>): Promise<Agent> {
    return this.requireDeployments().resize(this.id, options);
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

  async filesList(path: string = '', source: 'auto' | 'pod' | 's3' = 'auto'): Promise<AgentFileEntry[]> {
    return this.requireDeployments().filesList(this, path, source);
  }

  async fileReadBytes(path: string, source: 'auto' | 'pod' | 's3' = 'auto'): Promise<Uint8Array> {
    return this.requireDeployments().fileReadBytes(this, path, source);
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
      gatewayUrl: null,
      gatewayToken: data.gateway_token ?? null,
    });
  }

  private static gatewayUrlFromHostname(hostname: string | null | undefined): string | null {
    const trimmed = String(hostname ?? '').trim();
    return trimmed ? `wss://${trimmed}` : null;
  }

  private currentGatewayHostname(): string | null {
    if (this.hostname) return this.hostname;
    if (!this.gatewayUrl) return null;
    try {
      return new URL(this.gatewayUrl).hostname || null;
    } catch {
      return this.gatewayUrl.replace(/^wss?:\/\//, '').split('/')[0] || null;
    }
  }

  /**
   * Resolve gateway context through the deployment record plus `/env`.
   *
   * Agent startup is eventually consistent: the deployment record may lag
   * behind hostname attachment, and runtime env can lag behind both. The SDK
   * derives the gateway URL from the attached hostname and reads the gateway
   * token from `OPENCLAW_GATEWAY_TOKEN` in the agent env route.
   */
  async waitForGatewayContext(options: GatewayContextWaitOptions = {}): Promise<AgentGatewayContext> {
    if (this.gatewayToken && this.gatewayUrl) {
      return {
        agent_id: this.id,
        hostname: this.currentGatewayHostname(),
        gateway_token: this.gatewayToken,
      };
    }
    const timeoutMs = options.timeoutMs ?? 30_000;
    const retryIntervalMs = options.retryIntervalMs ?? 1_000;
    const deployments = this.requireDeployments();
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;
    while (true) {
      try {
        const refreshed = await deployments.get(this.id);
        const hostname = refreshed.hostname ?? null;
        const gatewayUrl = OpenClawAgent.gatewayUrlFromHostname(hostname);
        const envData = await deployments.env(this.id);
        const gatewayToken = envData.env?.OPENCLAW_GATEWAY_TOKEN?.trim() || null;
        if (gatewayToken && gatewayUrl) {
          this.gatewayToken = gatewayToken;
          this.gatewayUrl = gatewayUrl;
          return { agent_id: this.id, gateway_token: gatewayToken, hostname };
        }
        lastError = new Error('missing gateway context');
      } catch (error) {
        lastError = error;
      }
      if (Date.now() >= deadline) {
        if (lastError instanceof Error) throw lastError;
        throw new Error('Timed out waiting for OpenClaw gateway context');
      }
      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
  }

  async resolveGatewayToken(): Promise<string | null> {
    const context = await this.waitForGatewayContext();
    return context.gateway_token ?? null;
  }

  gateway(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): GatewayClient {
    if (!this.gatewayUrl) {
      throw new Error('Agent has no OpenClaw gateway URL');
    }
    const deployments = this.requireDeployments();

    return new GatewayClient({
      url: this.gatewayUrl,
      token: undefined,
      gatewayToken: options.gatewayToken ?? this.gatewayToken ?? undefined,
      deploymentId: options.deploymentId ?? this.id,
      apiKey: options.apiKey ?? deployments.agentApiKey,
      apiBase: options.apiBase ?? deployments.agentApiBase,
      autoApprovePairing: options.autoApprovePairing ?? true,
      clientId: options.clientId,
      clientMode: options.clientMode,
      clientDisplayName: options.clientDisplayName,
      clientVersion: options.clientVersion,
      platform: options.platform,
      instanceId: options.instanceId,
      caps: options.caps,
      origin: options.origin,
      timeout: options.timeout,
      onHello: options.onHello,
      onClose: options.onClose,
      onGap: options.onGap,
      onPairing: options.onPairing,
    });
  }

  async connect(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<GatewayClient> {
    if (!this.gatewayUrl || (!this.gatewayToken && !options.gatewayToken)) {
      await this.waitForGatewayContext();
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

  async waitReady(
    timeoutMs = 300_000,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & GatewayWaitReadyOptions = {},
  ): Promise<Record<string, any>> {
    if (!this.gatewayUrl || (!this.gatewayToken && !options.gatewayToken)) {
      await this.waitForGatewayContext();
    }
    const client = this.gateway(options);
    try {
      return await client.waitReady(timeoutMs, {
        retryIntervalMs: options.retryIntervalMs,
        probe: options.probe,
      });
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

  async configPatch(
    patch: Record<string, any>,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<void> {
    const client = await this.connect(options);
    try {
      await client.configPatch(patch);
    } finally {
      client.close();
    }
  }

  async configApply(
    config: Record<string, any>,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<void> {
    const client = await this.connect(options);
    try {
      await client.configApply(config);
    } finally {
      client.close();
    }
  }

  async modelsList(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<any[]> {
    const client = await this.connect(options);
    try {
      return await client.modelsList();
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
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      attachments?: ChatAttachment[];
    } = {},
  ): AsyncGenerator<ChatEvent> {
    const client = await this.connect(options);
    try {
      for await (const event of client.chatSend(message, sessionKey, options.attachments)) {
        yield event;
      }
    } finally {
      client.close();
    }
  }

  async channelsStatus(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      probe?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<Record<string, any>> {
    const client = await this.connect(options);
    try {
      return await client.channelsStatus(options.probe ?? false, options.timeoutMs);
    } finally {
      client.close();
    }
  }

  async channelsLogout(
    channel: string,
    accountId?: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<Record<string, any>> {
    const client = await this.connect(options);
    try {
      return await client.channelsLogout(channel, accountId);
    } finally {
      client.close();
    }
  }

  async webLoginStart(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      force?: boolean;
      timeoutMs?: number;
      verbose?: boolean;
      accountId?: string;
    } = {},
  ): Promise<Record<string, any>> {
    const client = await this.connect(options);
    try {
      return await client.webLoginStart({
        force: options.force,
        timeoutMs: options.timeoutMs,
        verbose: options.verbose,
        accountId: options.accountId,
      });
    } finally {
      client.close();
    }
  }

  async webLoginWait(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      timeoutMs?: number;
      accountId?: string;
    } = {},
  ): Promise<Record<string, any>> {
    const client = await this.connect(options);
    try {
      return await client.webLoginWait({
        timeoutMs: options.timeoutMs,
        accountId: options.accountId,
      });
    } finally {
      client.close();
    }
  }

  async workspaceFiles(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<{ agentId: string; files: any[] }> {
    const client = await this.connect(options);
    try {
      const agents = await client.agentsList();
      const agentId = agents[0]?.id ?? 'main';
      const files = await client.filesList(agentId);
      return { agentId, files };
    } finally {
      client.close();
    }
  }

  async fileGet(
    name: string,
    agentId?: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<string> {
    const client = await this.connect(options);
    try {
      let resolvedAgentId: string;
      if (agentId) {
        resolvedAgentId = agentId;
      } else {
        const agents = await client.agentsList();
        resolvedAgentId = agents[0]?.id ?? 'main';
      }
      return await client.fileGet(resolvedAgentId, name);
    } finally {
      client.close();
    }
  }

  async fileSet(
    name: string,
    content: string,
    agentId?: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<void> {
    const client = await this.connect(options);
    try {
      let resolvedAgentId: string;
      if (agentId) {
        resolvedAgentId = agentId;
      } else {
        const agents = await client.agentsList();
        resolvedAgentId = agents[0]?.id ?? 'main';
      }
      await client.fileSet(resolvedAgentId, name, content);
    } finally {
      client.close();
    }
  }

  async chatHistory(
    sessionKey?: string,
    limit = 50,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<any[]> {
    const client = await this.connect(options);
    try {
      return await client.chatHistory(sessionKey, limit);
    } finally {
      client.close();
    }
  }

  async chatSendMessage(
    message: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      sessionKey?: string;
      agentId?: string;
      attachments?: ChatAttachment[];
    } = {},
  ): Promise<any> {
    const client = await this.connect(options);
    try {
      return await client.sendChat(
        message,
        options.sessionKey ?? 'main',
        options.agentId,
        options.attachments,
      );
    } finally {
      client.close();
    }
  }

  private async mutateConfig(
    mutator: (config: Record<string, any>) => void | Promise<void>,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<Record<string, any>> {
    const config = structuredClone(await this.configGet(options));
    await mutator(config);
    await this.configApply(config, options);
    return config;
  }

  async providerUpsert(
    providerId: string,
    providerConfig: OpenClawModelProviderPatch,
    gatewayOptions: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<Record<string, any>> {
    const { api, baseUrl, apiKey, models, ...extra } = providerConfig;
    const config = await this.mutateConfig((next) => {
      const modelsCfg = (next.models ??= {});
      const providers = (modelsCfg.providers ??= {});
      const provider = { ...(providers[providerId] ?? {}) };
      provider.api = api;
      provider.baseUrl = baseUrl;
      if (apiKey !== undefined) provider.apiKey = apiKey;
      if (models !== undefined) provider.models = structuredClone(models);
      Object.assign(provider, extra);
      providers[providerId] = provider;
    }, gatewayOptions);
    return config.models?.providers?.[providerId] ?? {};
  }

  async providerRemove(
    providerId: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<Record<string, any>> {
    const config = await this.mutateConfig((next) => {
      if (next.models?.providers) {
        delete next.models.providers[providerId];
      }
    }, options);
    return config.models?.providers ?? {};
  }

  async modelUpsert(
    providerId: string,
    modelId: string,
    modelConfig: Omit<Partial<OpenClawModelDefinitionConfig>, 'id'> = {},
    gatewayOptions: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<Record<string, any>> {
    const config = await this.mutateConfig((next) => {
      const providers = ((next.models ??= {}).providers ??= {});
      const provider = { ...(providers[providerId] ?? {}) };
      const models = Array.isArray(provider.models)
        ? provider.models.map((entry: Record<string, any>) => ({ ...entry }))
        : [];
      let model = models.find((entry: Record<string, any>) => entry.id === modelId);
      if (!model) {
        model = { id: modelId };
        models.push(model);
      }
      Object.assign(model, modelConfig);
      provider.models = models;
      providers[providerId] = provider;
    }, gatewayOptions);
    return (
      config.models?.providers?.[providerId]?.models?.find((entry: Record<string, any>) => entry.id === modelId) ??
      {}
    );
  }

  async modelRemove(
    providerId: string,
    modelId: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<Array<Record<string, any>>> {
    const config = await this.mutateConfig((next) => {
      const providers = ((next.models ??= {}).providers ??= {});
      const provider = { ...(providers[providerId] ?? {}) };
      provider.models = Array.isArray(provider.models)
        ? provider.models.filter((entry: Record<string, any>) => entry.id !== modelId)
        : [];
      providers[providerId] = provider;
    }, options);
    return config.models?.providers?.[providerId]?.models ?? [];
  }

  async setDefaultModel(
    providerId: string,
    modelId: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<string> {
    const primary = `${providerId}/${modelId}`;
    await this.mutateConfig((next) => {
      const defaults = ((next.agents ??= {}).defaults ??= {});
      const model = (defaults.model ??= {});
      model.primary = primary;
    }, options);
    return primary;
  }

  async setMemorySearch(
    memorySearchConfig: {
      provider: string;
      model: string;
      baseUrl?: string;
      apiKey?: string;
      [key: string]: any;
    },
    gatewayOptions: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<Record<string, any>> {
    const { provider, model, baseUrl, apiKey, ...extra } = memorySearchConfig;
    const config = await this.mutateConfig((next) => {
      const defaults = ((next.agents ??= {}).defaults ??= {});
      const memorySearch = { ...(defaults.memorySearch ?? {}) };
      memorySearch.provider = provider;
      memorySearch.model = model;
      const remote = { ...(memorySearch.remote ?? {}) };
      if (baseUrl !== undefined) remote.baseUrl = baseUrl;
      if (apiKey !== undefined) remote.apiKey = apiKey;
      if (Object.keys(remote).length > 0) memorySearch.remote = remote;
      Object.assign(memorySearch, extra);
      defaults.memorySearch = memorySearch;
    }, gatewayOptions);
    return config.agents?.defaults?.memorySearch ?? {};
  }

  async channelUpsert(
    channelId: string,
    channelConfig: Record<string, any>,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      accountId?: string;
    } = {},
  ): Promise<Record<string, any>> {
    const { accountId, ...gatewayOptions } = options;
    const config = await this.mutateConfig((next) => {
      const channels = (next.channels ??= {});
      const current =
        channels[channelId] && typeof channels[channelId] === 'object'
          ? structuredClone(channels[channelId] as Record<string, any>)
          : {};
      if (accountId) {
        const accounts =
          current.accounts && typeof current.accounts === 'object'
            ? structuredClone(current.accounts as Record<string, any>)
            : {};
        const currentAccount =
          accounts[accountId] && typeof accounts[accountId] === 'object'
            ? accounts[accountId] as Record<string, any>
            : {};
        accounts[accountId] = deepMergeConfig(currentAccount, channelConfig);
        current.accounts = accounts;
        channels[channelId] = current;
        return;
      }
      channels[channelId] = deepMergeConfig(current, channelConfig);
    }, gatewayOptions);
    const channel = config.channels?.[channelId] ?? {};
    if (accountId) {
      return channel.accounts?.[accountId] ?? {};
    }
    return channel;
  }

  async channelPatch(
    channelId: string,
    patch: Record<string, any>,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      accountId?: string;
    } = {},
  ): Promise<Record<string, any>> {
    return await this.channelUpsert(channelId, patch, options);
  }

  async telegramUpsert(
    channelConfig: Record<string, any>,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      accountId?: string;
    } = {},
  ): Promise<Record<string, any>> {
    return await this.channelUpsert('telegram', channelConfig, options);
  }

  async slackUpsert(
    channelConfig: Record<string, any>,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      accountId?: string;
    } = {},
  ): Promise<Record<string, any>> {
    return await this.channelUpsert('slack', channelConfig, options);
  }

  async discordUpsert(
    channelConfig: Record<string, any>,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      accountId?: string;
    } = {},
  ): Promise<Record<string, any>> {
    return await this.channelUpsert('discord', channelConfig, options);
  }

  async cronList(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<any[]> {
    const client = await this.connect(options);
    try {
      return await client.cronList();
    } finally {
      client.close();
    }
  }
}

export class Deployments {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly agentsWsUrl: string;
  private readonly agentHttp: Pick<HTTPClient, 'get' | 'post' | 'patch' | 'delete'>;

  constructor(
    private readonly http: HTTPClient,
    agentApiKey?: string,
    agentApiBase?: string,
    agentsWsUrl?: string,
  ) {
    this.apiKey = agentApiKey || (http as any).apiKey;
    this.apiBase = resolveAgentsApiBase(agentApiBase || getAgentsApiBaseUrl());
    this.agentsWsUrl = normalizeAgentsWsUrl(agentsWsUrl || getConfigValue('AGENTS_WS_URL') || defaultAgentsWsUrl(this.apiBase));
    this.agentHttp = http instanceof HTTPClient ? new HTTPClient(this.apiBase, this.apiKey) : http;
  }

  get agentApiKey(): string {
    return this.apiKey;
  }

  get agentApiBase(): string {
    return this.apiBase;
  }

  private hydrateAgent(data: AgentHydrationData): Agent {
    const agent =
      isOpenClawHydrationData(data)
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
    const contentType = headers.get('Content-Type');
    const body =
      init.body && contentType?.includes('application/json') && typeof init.body !== 'string'
        ? JSON.stringify(init.body)
        : init.body;
    const response = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers,
      body,
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const payload = await response.clone().json() as Record<string, unknown>;
        detail = typeof payload.detail === 'string' ? payload.detail : response.statusText;
      } catch {
        const text = await response.text();
        detail = text || response.statusText;
      }
      throw new APIError(response.status, detail);
    }
    return response;
  }

  async create(options: CreateAgentOptions = {}): Promise<Agent> {
    const { config, gatewayToken } = buildAgentConfig(options.config ?? {}, options);
    const body: Record<string, any> = { ...config, start: options.start ?? true };
    if (options.dryRun) body.dry_run = true;
    if (options.name) body.name = options.name;
    if (options.size) body.size = options.size;
    if (options.meta?.ui) body.meta = { ui: structuredClone(options.meta.ui) };
    if (options.tags?.length) body.tags = [...options.tags];

    const data = await this.agentHttp.post<AgentHydrationData>(DEPLOYMENTS_API_PREFIX, body);
    const agent = this.hydrateAgent(data);
    if (agent instanceof OpenClawAgent) {
      agent.gatewayToken = gatewayToken;
    }
    agent.launchConfig = config;
    agent.command = [...(config.command ?? [])];
    agent.entrypoint = [...(config.entrypoint ?? [])];
    return agent;
  }

  async createOpenClaw(options: OpenClawCreateAgentOptions = {}): Promise<Agent> {
    const effectiveOptions: CreateAgentOptions = { ...options };
    effectiveOptions.env = { ...(options.env ?? {}) };
    if (options.routes === undefined) {
      effectiveOptions.routes = buildOpenClawRoutes(options.openClawRoutes ?? {});
    }
    effectiveOptions.image = defaultOpenClawImage(options.image);
    if (effectiveOptions.syncRoot === undefined) effectiveOptions.syncRoot = DEFAULT_OPENCLAW_SYNC_ROOT;
    if (effectiveOptions.syncEnabled === undefined) effectiveOptions.syncEnabled = true;
    return this.create(effectiveOptions);
  }

  async budget(): Promise<Record<string, any>> {
    return this.agentHttp.get(`${DEPLOYMENTS_API_PREFIX}/budget`);
  }

  async metrics(agentId: string): Promise<Record<string, any>> {
    return this.agentHttp.get(`${DEPLOYMENTS_API_PREFIX}/${agentId}/metrics`);
  }

  async list(): Promise<Agent[]> {
    const data = await this.agentHttp.get<any>(DEPLOYMENTS_API_PREFIX);
    const items = Array.isArray(data) ? data : data.items ?? [];
    return items.map((item: AgentHydrationData) => this.hydrateAgent(item));
  }

  async get(agentId: string): Promise<Agent> {
    const data = await this.agentHttp.get<AgentHydrationData>(`${DEPLOYMENTS_API_PREFIX}/${agentId}`);
    return this.hydrateAgent(data);
  }

  async waitRunning(agentId: string, timeoutMs = 300_000, pollIntervalMs = 5_000): Promise<Agent> {
    const deadline = Date.now() + timeoutMs;
    let lastState = '';
    while (Date.now() < deadline) {
      const agent = await this.get(agentId);
      lastState = String(agent.state || '');
      if (lastState.toLowerCase() === 'running') {
        return agent;
      }
      if (lastState.toLowerCase() === 'failed' || lastState.toLowerCase() === 'error') {
        throw new Error(`Agent entered ${lastState} while waiting for RUNNING`);
      }
      await sleep(pollIntervalMs);
    }
    throw new Error(`Timed out waiting for agent ${agentId} to reach RUNNING (last=${lastState})`);
  }

  async start(agentId: string, options: StartAgentOptions = {}): Promise<Agent> {
    const { config, gatewayToken } = buildAgentConfig(options.config ?? {}, options);
    const body: Record<string, any> = { ...config };
    if (options.dryRun) body.dry_run = true;
    const data = await this.agentHttp.post<AgentHydrationData>(`${DEPLOYMENTS_API_PREFIX}/${agentId}/start`, body);
    const agent = this.hydrateAgent(data);
    if (agent instanceof OpenClawAgent) {
      agent.gatewayToken = gatewayToken;
    }
    agent.launchConfig = config;
    agent.command = [...(config.command ?? [])];
    agent.entrypoint = [...(config.entrypoint ?? [])];
    return agent;
  }

  async startOpenClaw(agentId: string, options: OpenClawStartAgentOptions = {}): Promise<Agent> {
    const effectiveOptions: StartAgentOptions = { ...options };
    effectiveOptions.env = { ...(options.env ?? {}) };
    if (options.routes === undefined) {
      effectiveOptions.routes = buildOpenClawRoutes(options.openClawRoutes ?? {});
    }
    effectiveOptions.image = defaultOpenClawImage(options.image);
    if (effectiveOptions.syncRoot === undefined) effectiveOptions.syncRoot = DEFAULT_OPENCLAW_SYNC_ROOT;
    if (effectiveOptions.syncEnabled === undefined) effectiveOptions.syncEnabled = true;
    return this.start(agentId, effectiveOptions);
  }

  async update(agentId: string, options: UpdateAgentOptions = {}): Promise<Agent> {
    const body: Record<string, any> = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.size !== undefined) body.size = options.size;
    if (options.refreshFromLagoon !== undefined) body.refresh_from_lagoon = options.refreshFromLagoon;
    if (options.lastError !== undefined) body.last_error = options.lastError;
    const data = await this.agentHttp.patch<AgentHydrationData>(`${DEPLOYMENTS_API_PREFIX}/${agentId}`, body);
    return this.hydrateAgent(data);
  }

  async resize(
    agentId: string,
    options: Pick<UpdateAgentOptions, 'size'>,
  ): Promise<Agent> {
    return this.update(agentId, options);
  }

  async stop(agentId: string): Promise<Agent> {
    const data = await this.agentHttp.post<AgentHydrationData>(`${DEPLOYMENTS_API_PREFIX}/${agentId}/stop`);
    return this.hydrateAgent(data);
  }

  async delete(agentId: string): Promise<Record<string, any>> {
    return this.agentHttp.delete(`${DEPLOYMENTS_API_PREFIX}/${agentId}`);
  }

  async refreshToken(agentId: string): Promise<AgentTokenResponse> {
    return this.agentHttp.get(`${DEPLOYMENTS_API_PREFIX}/${agentId}/token`);
  }

  async createScopedKey(agentId: string, name?: string): Promise<Record<string, any>> {
    const payload: Record<string, string> = {};
    if (name) payload.name = name;
    return this.agentHttp.post(`${DEPLOYMENTS_API_PREFIX}/${agentId}/keys`, Object.keys(payload).length ? payload : undefined);
  }

  async logsToken(agentId: string): Promise<AgentLogsTokenResponse> {
    return this.agentHttp.post(`${DEPLOYMENTS_API_PREFIX}/${agentId}/logs/token`);
  }

  async env(agentId: string): Promise<{ agent_id: string; env: Record<string, string> }> {
    return this.agentHttp.get(`${DEPLOYMENTS_API_PREFIX}/${agentId}/env`);
  }

  async exec(target: Agent | string, command: string, options: AgentExecOptions = {}): Promise<AgentExecResult> {
    const agentId = this.agentIdFor(target);
    const payload: Record<string, any> = {
      command,
      timeout: options.timeout ?? 30,
    };
    if (options.dryRun) payload.dry_run = true;
    const data = await this.agentHttp.post(`${DEPLOYMENTS_API_PREFIX}/${agentId}/exec`, payload);
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

  async filesList(target: Agent | string, path: string = '', source: 'auto' | 'pod' | 's3' = 'auto'): Promise<AgentFileEntry[]> {
    const encodedPath = encodeFilePath(path);
    const suffix = encodedPath ? `/${encodedPath}` : '';
    const params = new URLSearchParams({ source });
    const response = await this.fetchRaw(`${DEPLOYMENTS_API_PREFIX}/${this.agentIdFor(target)}/files${suffix}?${params.toString()}`);
    const payload = (await response.json()) as AgentDirectoryListing;
    return [...(payload.directories ?? []), ...(payload.files ?? [])];
  }

  async fileReadBytes(target: Agent | string, path: string, source: 'auto' | 'pod' | 's3' = 'auto'): Promise<Uint8Array> {
    const encodedPath = encodeFilePath(path);
    const params = new URLSearchParams({ source });
    const response = await this.fetchRaw(`${DEPLOYMENTS_API_PREFIX}/${this.agentIdFor(target)}/files/${encodedPath}?${params.toString()}`, {
      redirect: 'follow',
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const payload = JSON.parse(decodeUtf8(bytes));
        if (isDirectoryListingPayload(payload)) {
          throw new Error(`Path is a directory: ${path}. Use filesList(path) instead.`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Path is a directory:')) {
          throw error;
        }
      }
    }
    return bytes;
  }

  async fileRead(target: Agent | string, path: string, source: 'auto' | 'pod' | 's3' = 'auto'): Promise<string> {
    return decodeUtf8(await this.fileReadBytes(target, path, source));
  }

  async fileWriteBytes(
    target: Agent | string,
    path: string,
    content: Uint8Array | ArrayBuffer | string,
    destination: 'auto' | 'pod' | 's3' = 'auto',
  ): Promise<Record<string, any>> {
    const encodedPath = encodeFilePath(path);
    const params = new URLSearchParams({ destination });
    const response = await this.fetchRaw(`${DEPLOYMENTS_API_PREFIX}/${this.agentIdFor(target)}/files/${encodedPath}?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: toUint8Array(content),
    });
    return (await response.json()) as Record<string, any>;
  }

  async fileWrite(target: Agent | string, path: string, content: string, destination: 'auto' | 'pod' | 's3' = 'auto'): Promise<Record<string, any>> {
    return this.fileWriteBytes(target, path, content, destination);
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
    return this.agentHttp.post(`${DEPLOYMENTS_API_PREFIX}/${agentId}/shell/token`, payload);
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
