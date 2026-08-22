/**
 * HyperClaw agents API - typed agent lifecycle, files, exec, and OpenClaw access.
 */
import { randomFillSync } from 'node:crypto';
import NodeWebSocket from 'ws';
import {
  agentSlotFromDict,
  parseAgentSlotSize,
  type AgentSlot,
  type AgentSlotInventory,
  type AgentSlotSize,
} from './agent-slots.js';
export {
  agentSlotFromDict,
  parseAgentSlotSize,
  type AgentSlot,
  type AgentSlotInventory,
  type AgentSlotSize,
} from './agent-slots.js';
import { getAgentsApiBaseUrl, getConfigValue } from './config.js';
import { APIError } from './errors.js';
import { HTTPClient, type RequestOverrides } from './http.js';
import {
  GatewayClient,
  type ChatAttachment,
  type ChatEvent,
  type GatewayIntegrationAuthStartParams,
  type GatewayIntegrationAuthStartResult,
  type GatewayIntegrationAuthStatusParams,
  type GatewayIntegrationAuthStatusResult,
  type GatewayIntegrationDisconnectParams,
  type GatewayIntegrationDisconnectResult,
  type GatewayIntegrationStatusParams,
  type GatewayIntegrationStatusResult,
  type GatewayOptions,
  type GatewaySessionsListResult,
  type GatewayWebLoginStartOptions,
  type GatewayWebLoginStartResult,
  type GatewayWebLoginWaitOptions,
  type GatewayWebLoginWaitResult,
  type GatewayWaitReadyOptions,
  type OpenClawConfigSchemaResponse,
  type OpenClawSlackRelayOptions,
} from './openclaw/gateway.js';
import {
  OpenClawGatewayConnectionManager,
  type OpenClawGatewayConnectionManagerOptions,
  type OpenClawGatewayLease,
} from './openclaw/connection-manager.js';
export {
  DEFAULT_OPENCLAW_GATEWAY_IDLE_TIMEOUT_MS,
  DEFAULT_OPENCLAW_GATEWAY_MAX_CONNECTIONS,
  OpenClawGatewayConnectionManager,
  type OpenClawGatewayConnectionManagerOptions,
  type OpenClawGatewayLease,
} from './openclaw/connection-manager.js';
import type {
  OpenClawTelegramConfigPatch,
  OpenClawWhatsAppConfigPatch,
} from './openclaw/channels.js';
import {
  buildHostedSlackRelayChannelConfig,
  HOSTED_SLACK_GATEWAY_ID_ENV,
  HOSTED_SLACK_LAUNCH_ENV_KEYS,
  HostedSlackLaunchEnv,
  normalizeSlackRelayBaseUrl,
} from './channels.js';
import type {
  OpenClawSlackHttpConfiguration,
  OpenClawSlackRelayConfiguration,
  OpenClawSlackSocketConfiguration,
} from './openclaw/slack.js';
import { HermesApiClient } from './hermes/gateway.js';
import {
  HermesSessionClient,
  OpenClawSessionClient,
  type AgentSessionConnectOptions,
} from './session.js';

const AGENT_HOSTED_SLACK_PATCH_TIMEOUT_MS = 300_000;
const AGENTS_API_BASE = 'https://api.hypercli.com/agents';
const DEV_AGENTS_API_BASE = 'https://api.dev.hypercli.com/agents';
const DEPLOYMENTS_API_PREFIX = '/deployments';
const AGENTS_WS_URL = 'wss://api.agents.hypercli.com/ws';
const DEV_AGENTS_WS_URL = 'wss://api.agents.dev.hypercli.com/ws';
export const DEFAULT_OPENCLAW_IMAGE = 'ghcr.io/hypercli/hypercli-openclaw:prod';
export const DEFAULT_OPENCLAW_PRO_IMAGE = 'ghcr.io/hypercli/hypercli-openclaw:pro-prod';
const STALE_OPENCLAW_IMAGES = new Set([
  'ghcr.io/hypercli/hypercli-openclaw:latest',
  'ghcr.io/hypercli/hypercli-openclaw:pro-latest',
  DEFAULT_OPENCLAW_IMAGE,
  DEFAULT_OPENCLAW_PRO_IMAGE,
]);
export const DEFAULT_HERMES_AGENT_IMAGE = 'ghcr.io/hypercli/hypercli-hermes-agent:latest';
export const DEFAULT_OPENCODE_IMAGE = 'ghcr.io/hypercli/hypercli-opencode:latest';
export const DEFAULT_CODEX_IMAGE = 'ghcr.io/hypercli/hypercli-codex:latest';
export const DEFAULT_CLAUDE_CODE_IMAGE = 'ghcr.io/hypercli/hypercli-claude-code:latest';
export const DEFAULT_GOOSE_IMAGE = 'ghcr.io/hypercli/hypercli-goose:latest';
export const DEFAULT_KIMI_CODE_IMAGE = 'ghcr.io/hypercli/hypercli-kimi-code:latest';
export const DEFAULT_BUZZ_AGENT_IMAGE = 'ghcr.io/hypercli/hypercli-buzz-agent:latest';
export const DEFAULT_BUZZ_OPENCODE_IMAGE = 'ghcr.io/hypercli/hypercli-buzz-opencode:latest';
export const DEFAULT_BUZZ_CODEX_IMAGE = 'ghcr.io/hypercli/hypercli-buzz-codex:latest';
export const DEFAULT_BUZZ_CLAUDE_CODE_IMAGE = 'ghcr.io/hypercli/hypercli-buzz-claude:latest';
export const DEFAULT_BUZZ_GOOSE_IMAGE = 'ghcr.io/hypercli/hypercli-buzz-goose:latest';
export const DEFAULT_BUZZ_KIMI_CODE_IMAGE = 'ghcr.io/hypercli/hypercli-buzz-kimi-code:latest';
export const DEFAULT_AGENT_RUNTIME_SCOPES = Object.freeze([
  'agents:none',
  'files:*',
  'flows:*',
  'models:*',
  'voice:*',
  'web:*',
  'workspaces:*',
]) as readonly string[];
export const DEFAULT_CODING_AGENT_SYNC_ROOT = '/home/node';
export type ManagedAgentRuntime =
  | 'generic'
  | 'openclaw'
  | 'openclaw-pro'
  | 'hermes-agent'
  | 'buzz-agent'
  | 'opencode'
  | 'codex'
  | 'claude-code'
  | 'goose'
  | 'kimi-code';
export type CodingAgentRuntime = Extract<ManagedAgentRuntime, 'buzz-agent' | 'opencode' | 'codex' | 'claude-code' | 'goose' | 'kimi-code'>;
export const DEFAULT_CODING_AGENT_IMAGES: Readonly<Record<CodingAgentRuntime, string>> = {
  'buzz-agent': DEFAULT_BUZZ_AGENT_IMAGE,
  opencode: DEFAULT_OPENCODE_IMAGE,
  codex: DEFAULT_CODEX_IMAGE,
  'claude-code': DEFAULT_CLAUDE_CODE_IMAGE,
  goose: DEFAULT_GOOSE_IMAGE,
  'kimi-code': DEFAULT_KIMI_CODE_IMAGE,
};
export const DEFAULT_CODING_AGENT_SYNC_INCLUDES: Readonly<Record<CodingAgentRuntime, readonly string[] | null>> = {
  'buzz-agent': null,
  opencode: [
    '.config/opencode',
    '.local/share/opencode',
    '.local/state/opencode',
    '.cache/opencode',
  ],
  codex: ['.codex'],
  'claude-code': ['.claude', '.claude.json'],
  goose: ['.goose'],
  'kimi-code': ['.kimi-code'],
};
export const DEFAULT_BUZZ_CODING_AGENT_IMAGES: Readonly<Record<CodingAgentRuntime, string>> = {
  'buzz-agent': DEFAULT_BUZZ_AGENT_IMAGE,
  opencode: DEFAULT_BUZZ_OPENCODE_IMAGE,
  codex: DEFAULT_BUZZ_CODEX_IMAGE,
  'claude-code': DEFAULT_BUZZ_CLAUDE_CODE_IMAGE,
  goose: DEFAULT_BUZZ_GOOSE_IMAGE,
  'kimi-code': DEFAULT_BUZZ_KIMI_CODE_IMAGE,
};
const BUZZ_RUNTIME_COMMANDS: Record<CodingAgentRuntime, {
  command: string;
  args: string[];
  mcpCommand: string;
}> = {
  'buzz-agent': {
    command: '/usr/local/bin/buzz-agent',
    args: [],
    mcpCommand: '/usr/local/bin/buzz-dev-mcp',
  },
  opencode: {
    command: '/usr/local/bin/opencode',
    args: ['acp'],
    mcpCommand: '',
  },
  codex: {
    command: '/usr/local/bin/codex-acp',
    args: [],
    mcpCommand: '/usr/local/bin/buzz-dev-mcp',
  },
  'claude-code': {
    command: '/usr/local/bin/claude-agent-acp',
    args: [],
    mcpCommand: '',
  },
  goose: {
    command: '/usr/local/bin/goose',
    args: ['acp'],
    mcpCommand: '',
  },
  'kimi-code': {
    command: '/usr/local/bin/kimi',
    args: ['acp'],
    mcpCommand: '',
  },
};
export const DEFAULT_BUZZ_RUST_LOG =
  'buzz_acp=info,hypercli_buzz_acp=info,pool::prompt=info,acp::stream=off';
const BUZZ_RESERVED_ENV_KEYS = new Set([
  'BUZZ_PRIVATE_KEY',
  'NOSTR_PRIVATE_KEY',
  'BUZZ_AUTH_TAG',
  'BUZZ_API_TOKEN',
  'BUZZ_ACP_PRIVATE_KEY',
  'BUZZ_ACP_API_TOKEN',
  'BUZZ_RELAY_URL',
  'BUZZ_ACP_AGENT_OWNER',
  'BUZZ_ACP_AGENT_COMMAND',
  'BUZZ_ACP_AGENT_ARGS',
  'BUZZ_ACP_MCP_COMMAND',
  'BUZZ_ACP_LAZY_POOL',
  'BUZZ_ACP_RELAY_OBSERVER',
  'BUZZ_ACP_DISPLAY_NAME',
  'BUZZ_ACP_TEXT_MENTIONS',
  'BUZZ_ACP_REQUIRE_REPLY',
  'CLAUDE_CODE_EXECUTABLE',
  'BUZZ_ACP_SESSION_TITLE',
  'BUZZ_ACP_SYSTEM_PROMPT',
  'BUZZ_ACP_MODEL',
  'BUZZ_ACP_IDLE_TIMEOUT',
  'BUZZ_ACP_MAX_TURN_DURATION',
  'BUZZ_ACP_AGENTS',
  'BUZZ_ACP_RESPOND_TO',
  'BUZZ_ACP_RESPOND_TO_ALLOWLIST',
  'BUZZ_ACP_MULTIPLE_EVENT_HANDLING',
  'BUZZ_ACP_DEDUP',
  'BUZZ_ACP_SETUP_PAYLOAD',
  'BUZZ_MANAGED_AGENT',
  // No longer minted by the SDK; kept listed so caller-supplied values are stripped.
  'BUZZ_MANAGED_AGENT_START_NONCE',
]);
export const OPENCLAW_MEMORY_SEARCH_ENV_DEFAULTS = {
  OPENCLAW_MEMORY_SEARCH_ENABLED: '1',
  OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START: '0',
  OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH: '0',
  OPENCLAW_MEMORY_SEARCH_SYNC_WATCH: '0',
  OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS: '30000',
  OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: '0',
} as const;
export const OPENCLAW_WORKSPACES_SYNC_ENV_DEFAULTS = {
  HYPER_WORKSPACES_BOOT_SYNC: '1',
  HYPER_WORKSPACES_DIR: '/home/node/shared',
  HYPER_WORKSPACES_SYNC_READY_ONLY: '1',
} as const;
const DEFAULT_OPENCLAW_SYNC_EXCLUDE = [
  'shared/**',
  '.openclaw/npm/**/node_modules/**',
  '.openclaw/agents/**/agent/*.sqlite.memory-reindex-*',
  '.openclaw/agents/**/agent/*.sqlite.reindex-lock.sqlite*',
  '.openclaw/browser/**/Code Cache/**',
  '.openclaw/browser/**/GPUCache/**',
  '.openclaw/browser/**/ShaderCache/**',
  '.openclaw/browser/**/GrShaderCache/**',
  '.openclaw/browser/**/optimization_guide_model_store/**',
] as const;
const LAUNCH_CONFIG_KEYS = new Set([
  'image',
  'env',
  'secrets',
  'routes',
  'command',
  'entrypoint',
  'sync_root',
  'sync_include',
  'sync_exclude',
  'sync_uid',
  'sync_gid',
  'registry_url',
  'registry_auth',
  'restart',
  'runtime_scopes',
]);
const DEFAULT_OPENCLAW_SYNC_ROOT = '/home/node';
export const DEFAULT_HERMES_AGENT_SYNC_ROOT = '/opt/data';
export const DEFAULT_HERMES_AGENT_SYNC_UID = 10000;
export const DEFAULT_HERMES_AGENT_SYNC_GID = 10000;
export const AGENT_FILE_MAX_BYTES = 250 * 1024 * 1024;
// Reef file writes traverse the Cloudflare-proxied agent hostname
// (https://<agent>.hypercli.app/_reef/...), whose edge rejects request bodies
// above 100 MB. Enforced client-side so oversized writes fail fast with a
// clear error instead of an opaque edge `413 Payload Too Large`.
export const AGENT_FILE_WRITE_MAX_BYTES = 100 * 1024 * 1024;
export const AGENT_FILE_TRANSFER_CHUNK_BYTES = 64 * 1024;
export const AGENT_FILE_OPERATION_TIMEOUT_MS = 300_000;

export interface AgentExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AgentMetricsResult {
  event: 'agent_metrics_result';
  ok: true;
  cpu: string;
  memory: string;
  timestamp: number;
}

export interface AgentOperationTokenResponse {
  agent_id: string;
  jwt: string;
  expires_at: string;
  ws_url: string;
}

export interface AgentTokenResponse {
  agent_id?: string;
  token?: string;
  jwt?: string;
  expires_at?: string | null;
}

export interface BrowserDesktopUrlOptions {
  redirect?: string | null;
  resize?: string | null;
}

export interface AgentGatewayContext {
  agent_id: string;
  gateway_url: string;
  gateway_token: string;
  launch_epoch: number;
}

export interface AgentEnvResponse {
  agent_id: string;
  env: Record<string, string>;
  launch_epoch: number;
}

/** Minimal response from mutating one stored launch-environment key. */
export interface AgentEnvMutationResponse {
  agent_id: string;
  key: string;
  present: boolean;
  launch_epoch: number;
}

/** Minimal response from mutating one stored launch secret; values are never returned. */
export type AgentSecretMutationResponse = AgentEnvMutationResponse;

export interface AgentSecretNamesResponse {
  agent_id: string;
  names: string[];
  launch_epoch: number;
}

export interface AgentSecretResponse {
  agent_id: string;
  key: string;
  value: string;
  launch_epoch: number;
}

export interface GatewayContextWaitOptions {
  timeoutMs?: number;
  retryIntervalMs?: number;
  signal?: AbortSignal;
}

interface OpenClawGatewayContextFlight {
  deploymentId: string;
  controller: AbortController;
  promise: Promise<AgentGatewayContext>;
  waiters: number;
  settled: boolean;
}

class OpenClawRouteContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenClawRouteContractError';
  }
}

class OpenClawLifecycleTerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenClawLifecycleTerminalError';
  }
}

const OPENCLAW_GATEWAY_TERMINAL_STATES = new Set([
  'STOPPING',
  'STOPPED',
  'ARCHIVING',
  'ARCHIVED',
  'FAILED',
  'DELETED',
]);

const OPENCLAW_GATEWAY_CONTEXT_FLIGHT_TIMEOUT_MS = 300_000;
const OPENCLAW_GATEWAY_CONTEXT_FLIGHT_RETRY_INTERVAL_MS = 1_000;

export interface OpenClawOperationsSnapshot {
  sessions: GatewaySessionsListResult | null;
  cronJobs: any[] | null;
  failures: Partial<Record<'sessions' | 'cron', string>>;
  capturedAt: number;
}

function stringifyOpenClawOperationsFailure(reason: unknown): string {
  if (reason instanceof Error) return reason.message || reason.name || 'Error';
  if (typeof reason === 'string') return reason;
  try {
    const serialized = JSON.stringify(reason);
    if (serialized !== undefined) return serialized;
  } catch {
    // Fall back to String for non-serializable rejection values.
  }
  try {
    return String(reason);
  } catch {
    return 'Unknown error';
  }
}

export interface AgentShellTokenResponse {
  agent_id: string;
  jwt: string;
  expires_at: string;
  ws_url: string;
  shell: string;
}

export interface AgentShellConnectOptions {
  signal?: AbortSignal;
  tokenTimeoutMs?: number;
  openTimeoutMs?: number;
}

function shellAbortError(): Error {
  const error = new Error('Shell connection cancelled');
  error.name = 'AbortError';
  return error;
}

function runShellOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortOperation);
    };
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value as T);
    };
    const abortOperation = () => {
      controller.abort(signal?.reason);
      finish(shellAbortError());
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(new Error(timeoutMessage));
    }, timeoutMs);

    if (signal?.aborted) {
      abortOperation();
      return;
    }
    signal?.addEventListener('abort', abortOperation, { once: true });
    void operation(controller.signal).then(
      (value) => finish(undefined, value),
      (error) => {
        if (error instanceof Error && error.name === 'AbortError' && !signal?.aborted) {
          finish(new Error(timeoutMessage));
        } else {
          finish(error);
        }
      },
    );
  });
}

export interface AgentLogsTokenResponse {
  agent_id?: string;
  jwt: string;
  expires_at?: string | null;
  ws_url?: string;
}

/**
 * One decoded frame from the agent logs WebSocket.
 *
 * The socket opens with the replayed history as `log` frames, sends
 * `history_end` once replay is complete, then streams live `log` frames. A
 * frame that is not a recognisable envelope degrades to a log line rather than
 * vanishing, so a pre-envelope or plain-text server stays readable. Unknown
 * envelope events are ignored so future control frames never reach the log view.
 */
export type AgentLogFrame =
  | { kind: 'log'; line: string }
  | { kind: 'historyEnd' }
  | { kind: 'error'; detail: string }
  | { kind: 'ignore' };

export function parseAgentLogFrame(raw: string): AgentLogFrame {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { kind: 'log', line: raw };
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { kind: 'log', line: raw };
  }
  const frame = payload as { event?: unknown; log?: unknown; detail?: unknown };
  if (typeof frame.event !== 'string') return { kind: 'log', line: raw };
  switch (frame.event) {
    case 'log':
      return {
        kind: 'log',
        line: typeof frame.log === 'string' ? frame.log : String(frame.log ?? ''),
      };
    case 'history_end':
      return { kind: 'historyEnd' };
    case 'error':
      return {
        kind: 'error',
        detail:
          typeof frame.detail === 'string' && frame.detail
            ? frame.detail
            : 'Log stream failed',
      };
    default:
      return { kind: 'ignore' };
  }
}

export interface AgentLogsSubscribeOptions {
  /** Historical lines to replay before live frames. 0 replays the whole buffer. */
  tailLines?: number;
  container?: string;
  signal?: AbortSignal;
  /** Runs after socket authentication and before any frame is read. */
  onReady?: () => void | Promise<void>;
  /** Runs once replay is complete, before any live frame is delivered. */
  onHistoryEnd?: () => void | Promise<void>;
  /**
   * Runs when the peer closes the socket, carrying the close code. Reconnect
   * policy lives with the caller, so the caller needs the code that decides it:
   * an auth-scoped close must not be retried, a transport drop may be.
   */
  onClose?: (event: { code: number; reason: string }) => void;
  /**
   * Keep the socket open after replay. With `follow: false` the returned
   * promise resolves at `history_end`, which is what a stopped agent needs:
   * its socket is snapshot-then-silence and would otherwise hang.
   */
  follow?: boolean;
}

export interface AgentRelayKey {
  key_id?: string | null;
  key_name?: string | null;
  tags?: string[];
  api_key?: string | null;
  api_key_preview?: string | null;
  last4?: string | null;
  [key: string]: any;
}

export interface AgentProfileImageUploadResult {
  id: string;
  avatar_url: string | null;
  s3_key: string | null;
}

export interface BootstrapInferenceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface BootstrapInferenceResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  json_schema?: {
    name: string;
    description?: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
}

export interface BootstrapInferenceResult {
  model: string;
  content: string;
  finish_reason: string | null;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ListAgentsOptions extends RequestOverrides {
  state?: string | null;
  handle?: string | null;
  name?: string | null;
  query?: string | null;
  includeDeleted?: boolean | null;
}

export interface AgentCapacity {
  items: Agent[];
  totalAgents: number;
  maxAgentsPerAccount: number;
  runningAgents: number;
  slots: Record<string, AgentSlotInventory>;
  agentSlots: AgentSlot[];
  pooledTpd: number;
}

export interface SlackOAuthStartOptions {
  relayBaseUrl: string;
  token: string;
}

export interface SlackOAuthStartResult {
  authorizeUrl: string;
  expiresAt?: string | null;
}

export interface SlackInstallStatusOptions {
  relayBaseUrl: string;
  token: string;
}

export interface SlackInstallStatus {
  connected: boolean;
  teamId?: string | null;
  teamName?: string | null;
  botUserId?: string | null;
  installerUserId?: string | null;
  updatedAt?: string | null;
}

export interface SlackDirectoryOptions {
  relayBaseUrl: string;
  token: string;
  cursor?: string | null;
  limit?: number | null;
}

export interface SlackDirectoryConversationsOptions extends SlackDirectoryOptions {
  types?: string | null;
}

export interface SlackDirectoryConversation {
  id: string;
  name?: string | null;
  isChannel?: boolean | null;
  isGroup?: boolean | null;
  isIm?: boolean | null;
  isMpim?: boolean | null;
  isMember?: boolean | null;
  isPrivate?: boolean | null;
}

export interface SlackDirectoryUser {
  id: string;
  name?: string | null;
  realName?: string | null;
  teamId?: string | null;
  isBot?: boolean | null;
  deleted?: boolean | null;
}

export interface SlackDirectoryConversationsResult {
  conversations: SlackDirectoryConversation[];
  nextCursor?: string | null;
}

export interface SlackDirectoryUsersResult {
  users: SlackDirectoryUser[];
  nextCursor?: string | null;
}

export interface AttachSlackRelayAgentOptions {
  relayBaseUrl: string;
  token: string;
  agentId: string;
}

export interface AttachSlackRelayAgentResult {
  connected: boolean;
  agentId: string;
  gatewayId: string;
  config: Record<string, unknown>;
  restartRequired: boolean;
  teamId?: string | null;
  teamName?: string | null;
  botUserId?: string | null;
}

export interface AttachDeploymentSlackRelayAgentOptions {
  relayBaseUrl: string;
  token?: string;
}

export interface BraveWebSearchOptions {
  count?: number;
  country?: string;
  searchLang?: string;
  uiLang?: string;
  freshness?: string;
}

export interface BraveWebSearchResponse {
  query?: Record<string, any>;
  web?: {
    results?: Array<Record<string, any>>;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface AgentRouteConfig {
  port: number;
  prefix?: string;
  auth?: boolean;
}

export interface AgentCorsConfig {
  allowed_origins: string[];
  allow_credentials?: boolean;
  allowed_headers?: string[];
  allowed_methods?: string[];
  max_age?: number;
}

export interface AgentRoutesState {
  agentId: string;
  routes: Record<string, AgentRouteConfig>;
  cors: AgentCorsConfig | null;
  routeStatuses: Record<string, Record<string, unknown>>;
}

interface AgentRoutesHydrationData {
  agent_id?: string;
  routes?: Record<string, AgentRouteConfig> | null;
  cors?: AgentCorsConfig | null;
  route_statuses?: Record<string, Record<string, unknown>> | null;
}

export interface SetRoutesOptions {
  cors?: AgentCorsConfig | null;
}

/**
 * What the presented credential is, as the Backend resolves it.
 *
 * `agentId` is set only for an Agent runtime key, which speaks for exactly one
 * Agent; it is null for an owner user credential or any other key.
 */
export interface AgentAccessIdentity {
  userId: string;
  authType: string;
  /** The one Agent a runtime key speaks for; null for every other credential. */
  agentId: string | null;
  tags: string[];
  capabilities: string[];
  keyId: string | null;
  keyName: string | null;
  teamId: string | null;
  planId: string | null;
  /** True when this credential is one Agent's own runtime key. */
  isAgentRuntimeKey: boolean;
}

interface AgentAccessIdentityHydrationData {
  user_id?: string | null;
  auth_type?: string | null;
  agent_id?: string | null;
  tags?: string[] | null;
  capabilities?: string[] | null;
  key_id?: string | null;
  key_name?: string | null;
  team_id?: string | null;
  plan_id?: string | null;
}

export type LaunchConfigFlatMap = Record<string, unknown>;

export interface AgentDesktopConfigSource {
  launchConfig?: unknown;
  launch_config?: unknown;
  routes?: unknown;
}

export interface RegistryAuth {
  username: string;
  password: string;
}

/** Complete Backend START replacement contract. */
export interface AgentLaunchConfig {
  config: Record<string, any>;
  image: string | null;
  env: Record<string, string>;
  secrets: Record<string, string>;
  routes: Record<string, AgentRouteConfig>;
  cors?: AgentCorsConfig | null;
  command: string[];
  entrypoint: string[];
  restart: boolean;
  sync_root: string | null;
  sync_include?: string[] | null;
  sync_exclude?: string[] | null;
  sync_uid: number | null;
  sync_gid: number | null;
  registry_url: string | null;
  registry_auth: RegistryAuth | Record<string, never>;
  runtime_scopes: string[];
}

const REQUIRED_START_LAUNCH_CONFIG_KEYS: ReadonlyArray<keyof AgentLaunchConfig> = [
  'config',
  'image',
  'env',
  'secrets',
  'routes',
  'command',
  'entrypoint',
  'restart',
  'sync_root',
  'sync_uid',
  'sync_gid',
  'registry_url',
  'registry_auth',
  'runtime_scopes',
];

function cloneCompleteLaunchConfig(value: AgentLaunchConfig): AgentLaunchConfig {
  if (!isPlainRecord(value)) throw new Error('launchConfig must be a complete object');
  const missing = REQUIRED_START_LAUNCH_CONFIG_KEYS.filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  if (missing.length > 0) {
    throw new Error(`launchConfig is incomplete; missing: ${missing.join(', ')}`);
  }
  if (
    Object.prototype.hasOwnProperty.call(value, 'sync_include')
    && Object.prototype.hasOwnProperty.call(value, 'sync_exclude')
  ) {
    throw new Error('launchConfig cannot carry both sync policies');
  }
  if (Array.isArray(value.sync_include) && value.sync_include.length === 0) {
    throw new Error('syncInclude must contain at least one path; omit it to sync all');
  }
  if (Array.isArray(value.sync_exclude) && (value.sync_exclude.includes('*') || value.sync_exclude.includes('**'))) {
    throw new Error('syncExclude cannot exclude the entire sync root; omit it to sync all');
  }
  if (typeof value.restart !== 'boolean') {
    throw new Error('launchConfig restart must be a boolean');
  }
  return structuredClone(value) as AgentLaunchConfig;
}

export interface BuildAgentConfigOptions {
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  routes?: Record<string, AgentRouteConfig> | null;
  command?: string[] | null;
  entrypoint?: string[] | null;
  image?: string | null;
  /** Absolute runtime mount path for retained PVC storage. */
  syncRoot?: string | null;
  /**
   * Relative paths selected for steady upload and cold restore. Must contain at
   * least one path when supplied; null selects the whole sync root.
   */
  syncInclude?: readonly string[] | null;
  /**
   * Relative patterns excluded from whole-root mode. An empty array excludes
   * nothing. Ignored when a non-null include policy is supplied.
   */
  syncExclude?: readonly string[] | null;
  syncUid?: number | null;
  syncGid?: number | null;
  registryUrl?: string | null;
  registryAuth?: RegistryAuth | null;
  /** Route-plane CORS policy reconciled onto the agent's public routes. */
  cors?: AgentCorsConfig | null;
  restart?: boolean;
  runtimeScopes?: readonly string[] | null;
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

export interface HermesAgentRouteOptions {
  port?: number;
  auth?: boolean;
  prefix?: string;
}

export interface OpenClawMemoryIndexOptions {
  enabled?: boolean | null;
  onSessionStart?: boolean | null;
  onSearch?: boolean | null;
  watch?: boolean | null;
  watchDebounceMs?: number | null;
  intervalMinutes?: number | null;
}

export interface OpenClawWorkspacesSyncOptions {
  enabled?: boolean | null;
  readyOnly?: boolean | null;
  workspace?: string | null;
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
}

export interface AgentMeta {
  ui?: AgentUiMeta | null;
  status?: DeploymentMetaStatus | null;
  [key: string]: any;
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
  handle?: string | null;
  size?: string;
  config?: Record<string, any>;
  meta?: AgentMeta | null;
  tags?: string[];
  dryRun?: boolean;
  runtime?: ManagedAgentRuntime;
}

export interface CreateExternalAgentOptions {
  name: string;
  displayName?: string | null;
  handle?: string | null;
  runtime?: string;
  status?: string;
  meta?: Record<string, any> | null;
}

export interface UpdateExternalAgentOptions {
  name?: string | null;
  displayName?: string | null;
  handle?: string | null;
  runtime?: 'openclaw' | null;
  status?: 'active' | 'inactive' | 'error' | null;
  meta?: Record<string, any> | null;
}

export interface StartAgentOptions {
  /**
   * Complete replacement launch configuration. The two keys the owner-facing
   * projection redacts (`secrets`, `registry_auth`) are repaired in place, so
   * an `Agent.launchConfig` read straight back from {@link Deployments.get}
   * is accepted. When omitted entirely, the stored launch config is rebuilt
   * via {@link Deployments.storedLaunchConfig}.
   */
  launchConfig?: AgentLaunchConfig;
  /** Caller-held registry credentials for stored configs with a registry_url. */
  registryAuth?: RegistryAuth;
  dryRun?: boolean;
}

export interface UpdateAgentOptions {
  name?: string;
  handle?: string | null;
  size?: string;
  launchConfig?: Record<string, any> | null;
  refreshFromLagoon?: boolean;
  error?: string | null;
}

export interface OpenClawSlackOptions {
  /**
   * Hosted Slack relay base URL. Resolved from `HYPER_SLACK_RELAY_BASE_URL`,
   * `SLACK_RELAY_BASE_URL`, or the client's agents API base when omitted.
   */
  relayBaseUrl?: string | null;
  /**
   * Gateway id override. Normally left unset: the Backend assigns the Agent id
   * at create time and the gateway id is derived from it.
   */
  gatewayId?: string | null;
}

export interface OpenClawCreateAgentOptions extends CreateAgentOptions {
  gatewayToken?: string | null;
  /**
   * Enable hosted Slack. Pass `true` (or relay overrides) to state the intent;
   * the SDK owns the complete `HYPER_SLACK_*` launch env, including the gateway
   * id, which it can only know once the Agent record exists.
   */
  slack?: OpenClawSlackOptions | boolean | null;
  openClawRoutes?: OpenClawRouteOptions | null;
  heartbeat?: OpenClawHeartbeatConfig | null;
  /** Disable to avoid automatically locking browser control UI access to globalThis.location.origin. */
  controlUiOriginLock?: boolean | null;
  memoryIndex?: OpenClawMemoryIndexOptions | null;
  workspacesSync?: OpenClawWorkspacesSyncOptions | boolean | null;
}

export interface OpenClawStartAgentOptions extends StartAgentOptions {
  launchConfig: AgentLaunchConfig;
  gatewayToken?: string | null;
}

interface PreparedHostedSlack {
  enabled: boolean;
  relayBaseUrl: string | null;
  gatewayId: string | null;
}

export interface HermesAgentCreateOptions extends CreateAgentOptions {
  hermesRoute?: HermesAgentRouteOptions | null;
  /** Explicit inbound Hermes API credential; a fresh 32-byte key is generated when omitted. */
  apiServerKey?: string | null;
  /** Browser origins allowed to call the Hermes API; mapped to API_SERVER_CORS_ORIGINS. */
  corsOrigins?: string[] | null;
}

export interface HermesAgentStartOptions extends StartAgentOptions {
  launchConfig: AgentLaunchConfig;
  /** Caller-known inbound Hermes API credential; never recovered from Backend state. */
  apiServerKey?: string | null;
}

export interface CodingAgentCreateOptions extends Omit<CreateAgentOptions, 'runtime'> {
  workspacesSync?: OpenClawWorkspacesSyncOptions | boolean | null;
  /** @deprecated Use the typed `buzz` launch contract. */
  buzzEnabled?: boolean;
  /** Launch Buzz ACP with runtime-specific harness and MCP defaults. */
  buzz?: BuzzLaunchConfig | null;
}

export interface BuzzLaunchConfig {
  privateKeyNsec: string;
  relayUrl: string;
  authTag?: string | null;
  systemPrompt?: string | null;
  model?: string | null;
  idleTimeoutSeconds?: number | null;
  maxTurnDurationSeconds?: number | null;
  parallelism?: number;
  respondTo?: string | null;
  respondToAllowlist?: string[];
  displayName?: string | null;
  textMentions?: boolean;
  requireReply?: boolean;
  sessionTitle?: string | null;
  rustLog?: string;
}

function buildBuzzLaunchEnv(
  runtime: CodingAgentRuntime,
  buzz: BuzzLaunchConfig,
  defaultSessionTitle?: string,
): Record<string, string> {
  if (!buzz.privateKeyNsec.trim()) throw new Error('buzz.privateKeyNsec is required');
  if (!buzz.relayUrl.trim()) throw new Error('buzz.relayUrl is required');
  const parallelism = buzz.parallelism ?? 1;
  if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > 32) {
    throw new Error('buzz.parallelism must be between 1 and 32');
  }

  const harness = BUZZ_RUNTIME_COMMANDS[runtime];
  const env: Record<string, string> = {
    BUZZ_RELAY_URL: buzz.relayUrl,
    BUZZ_ACP_AGENT_COMMAND: harness.command,
    BUZZ_ACP_AGENT_ARGS: harness.args.join(','),
    BUZZ_ACP_MCP_COMMAND: harness.mcpCommand,
    BUZZ_ACP_LAZY_POOL: 'true',
    BUZZ_ACP_RELAY_OBSERVER: 'true',
    BUZZ_ACP_AGENTS: String(parallelism),
    BUZZ_ACP_MULTIPLE_EVENT_HANDLING: 'steer',
    BUZZ_ACP_DEDUP: 'queue',
  };
  if (runtime === 'claude-code') {
    env.CLAUDE_CODE_EXECUTABLE = '/usr/local/bin/claude';
  }
  if (buzz.rustLog) env.RUST_LOG = buzz.rustLog;
  const optional: Record<string, string | undefined | null> = {
    BUZZ_AUTH_TAG: buzz.authTag,
    BUZZ_ACP_DISPLAY_NAME: buzz.displayName,
    BUZZ_ACP_SESSION_TITLE: buzz.sessionTitle || defaultSessionTitle,
    BUZZ_ACP_SYSTEM_PROMPT: buzz.systemPrompt,
    BUZZ_ACP_MODEL: buzz.model,
    BUZZ_ACP_IDLE_TIMEOUT: buzz.idleTimeoutSeconds == null
      ? undefined
      : String(buzz.idleTimeoutSeconds),
    BUZZ_ACP_MAX_TURN_DURATION: buzz.maxTurnDurationSeconds == null
      ? undefined
      : String(buzz.maxTurnDurationSeconds),
    BUZZ_ACP_RESPOND_TO: buzz.respondTo,
    BUZZ_ACP_RESPOND_TO_ALLOWLIST: buzz.respondToAllowlist?.length
      ? buzz.respondToAllowlist.join(',')
      : undefined,
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value) env[key] = value;
  }
  if (buzz.textMentions) env.BUZZ_ACP_TEXT_MENTIONS = 'true';
  if (buzz.requireReply !== false) env.BUZZ_ACP_REQUIRE_REPLY = 'true';
  return env;
}

function buildBuzzLaunchSecrets(buzz: BuzzLaunchConfig): Record<string, string> {
  if (!buzz.privateKeyNsec.trim()) throw new Error('buzz.privateKeyNsec is required');
  return {
    BUZZ_PRIVATE_KEY: buzz.privateKeyNsec,
    NOSTR_PRIVATE_KEY: buzz.privateKeyNsec,
  };
}

export interface RuntimeAuthMethod {
  id: string;
  name: string;
  description: string;
  kind: string;
  command: string[];
  metadata: Record<string, unknown>;
}

export interface RuntimeAuthStatus {
  authenticated: boolean;
  provider?: string | null;
  account?: string | null;
  method?: string | null;
  detail: Record<string, unknown>;
}

export interface RuntimeAuthLoginOptions {
  method?: string;
  provider?: string;
  providerMethod?: string;
  email?: string;
  challengeTimeoutMs?: number;
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
  mime_type?: string;
  mimeType?: string;
  content_type?: string;
  contentType?: string;
  last_modified?: string;
  checksum?: string;
  checksum_algorithm?: string;
  checksumAlgorithm?: string;
  hash?: string;
  hash_algorithm?: string;
  hashAlgorithm?: string;
  sha256?: string;
  sha_256?: string;
  md5?: string;
  etag?: string;
  version_id?: string;
  versionId?: string;
  [key: string]: any;
}

export interface AgentFileReadOptions {
  maxBytes?: number;
  signal?: AbortSignal;
}

/** Tuning for {@link Deployments.waitForFileApiReady}. */
export interface AgentFileApiReadyOptions {
  /** Give up after this long. Default 90s. */
  timeoutMs?: number;
  /** Successful reads required in a row before declaring ready. Default 2. */
  consecutive?: number;
  /** Delay between attempts. Default 1s. */
  pollMs?: number;
}

export interface AgentFileReadBytesResult {
  content: Uint8Array;
  mimeType?: string;
}

export interface AgentFileTokenResponse {
  url: string;
  token: string;
  expires_at: string;
}

/** Public file access is Reef-backed and scoped to the agent's configured sync root. */
export const OPENCLAW_SYNC_ROOT = '/home/node';
/** Convenience path for callers that explicitly want the conventional OpenClaw workspace. */
export const OPENCLAW_WORKSPACE_PREFIX = '.openclaw/workspace';

function resolveSyncRootFilePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/')) {
    throw new Error('agent file paths must be relative to the sync root');
  }
  const rel = stripRelPrefix(normalized);
  if (rel.split('/').includes('..')) {
    throw new Error('agent file paths must stay within the sync root');
  }
  return rel === '.' ? '' : rel;
}

function normalizeWritableBackendFilePath(path: string): string {
  return resolveSyncRootFilePath(path);
}

/** Strip leading `./` segments and slashes without eating a dotfile's dot. */
function stripRelPrefix(path: string): string {
  return path.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
}

function isUuidRef(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function isDirectAgentIdRef(value: string): boolean {
  const raw = value.trim();
  return isUuidRef(raw) || /^[0-9a-f]{6,}$/i.test(raw) || /^(agent|external)[-_:]/i.test(raw);
}

function isSelfAgentRef(value: string): boolean {
  return value.trim().toLowerCase() === 'self';
}

function agentRoutesStateFromData(data: AgentRoutesHydrationData): AgentRoutesState {
  return {
    agentId: String(data.agent_id ?? ''),
    routes: structuredClone(data.routes ?? {}),
    cors: data.cors === null || data.cors === undefined ? null : structuredClone(data.cors),
    routeStatuses: structuredClone(data.route_statuses ?? {}),
  };
}

function agentAccessIdentityFromData(
  data: AgentAccessIdentityHydrationData,
): AgentAccessIdentity {
  const payload = data ?? {};
  const agentId = payload.agent_id ? String(payload.agent_id) : null;
  return {
    userId: String(payload.user_id ?? ''),
    authType: String(payload.auth_type ?? ''),
    agentId,
    tags: (payload.tags ?? []).map((tag) => String(tag)),
    capabilities: (payload.capabilities ?? []).map((item) => String(item)),
    keyId: payload.key_id ? String(payload.key_id) : null,
    keyName: payload.key_name ? String(payload.key_name) : null,
    teamId: payload.team_id ? String(payload.team_id) : null,
    planId: payload.plan_id ? String(payload.plan_id) : null,
    isAgentRuntimeKey: Boolean(agentId),
  };
}

/** Reef-backed file access scoped to an agent's configured sync root. */
export class AgentFiles {
  constructor(
    private readonly agent: Agent,
    private readonly deployments: Deployments,
  ) {}

  async list(path = ''): Promise<AgentFileEntry[]> {
    return this.deployments.filesList(this.agent, path);
  }

  async readBytes(path: string, options?: AgentFileReadOptions): Promise<Uint8Array> {
    return this.deployments.fileReadBytes(this.agent, path, options);
  }

  async readBytesWithMetadata(path: string, options?: AgentFileReadOptions): Promise<AgentFileReadBytesResult> {
    return this.deployments.fileReadBytesWithMetadata(this.agent, path, options);
  }

  async read(path: string, options?: AgentFileReadOptions): Promise<string> {
    return this.deployments.fileRead(this.agent, path, options);
  }

  async writeBytes(path: string, content: Uint8Array | ArrayBuffer | string): Promise<Record<string, any>> {
    return this.deployments.fileWriteBytes(this.agent, path, content);
  }

  async write(path: string, content: string): Promise<Record<string, any>> {
    return this.deployments.fileWrite(this.agent, path, content);
  }

  async delete(path: string, options: { recursive?: boolean } = {}): Promise<Record<string, any>> {
    return this.deployments.fileDelete(this.agent, path, options);
  }
}

export interface AgentDirectoryListing {
  type: 'directory';
  prefix: string;
  directories: AgentFileEntry[];
  files: AgentFileEntry[];
  truncated?: boolean;
  [key: string]: any;
}

export type AgentState =
  | 'CREATING'
  | 'STARTING'
  | 'RESTORING'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'ARCHIVING'
  | 'ARCHIVED'
  | 'FAILED'
  | 'DELETED'
  | (string & {});

/** Canonical states understood by this SDK. AgentState remains forward-open. */
export const CANONICAL_AGENT_STATES = [
  'CREATING',
  'STARTING',
  'RESTORING',
  'RUNNING',
  'STOPPING',
  'STOPPED',
  'ARCHIVING',
  'ARCHIVED',
  'FAILED',
  'DELETED',
] as const satisfies readonly AgentState[];

export const AGENT_TRANSITIONAL_STATES: ReadonlySet<AgentState> = new Set([
  'CREATING',
  'STARTING',
  'RESTORING',
  'STOPPING',
  'ARCHIVING',
]);

export const AGENT_RUNTIME_INACTIVE_STATES: ReadonlySet<AgentState> = new Set([
  'STOPPED',
  'ARCHIVING',
  'ARCHIVED',
  'FAILED',
  'DELETED',
]);

export function isAgentTransitionalState(state: string): boolean {
  return AGENT_TRANSITIONAL_STATES.has(state.toUpperCase());
}

export function isAgentRuntimeInactiveState(state: string): boolean {
  return AGENT_RUNTIME_INACTIVE_STATES.has(state.toUpperCase());
}

export type DeploymentMetaObservedState = 'RUNNING' | 'STOPPED';

export interface DeploymentMetaStatus {
  status: 'ok' | 'error' | string;
  clusterId: string | null;
  namespace: string | null;
  observedState: DeploymentMetaObservedState | null;
  reason: string | null;
  message: string | null;
  observedAt: string | null;
}

export interface DeploymentTransitionEvent {
  type: 'deployment.transition';
  agent_id: string;
  state?: AgentState;
  reason?: string | null;
  error?: string | null;
  message?: string | null;
}

export interface DeploymentImportStatusEvent {
  type: 'deployment.import_status';
  agent_id: string;
  status: 'ok' | 'error' | string;
  namespace: string;
  observed_state?: AgentState | null;
  reason?: string | null;
  message?: string | null;
  observed_at: string;
}

export type DeploymentEvent = DeploymentTransitionEvent | DeploymentImportStatusEvent;

export interface DeploymentSubscribeOptions {
  signal?: AbortSignal;
  /** Runs after socket authentication and before transition frames are read. */
  onReady?: () => void | Promise<void>;
}

export interface AgentStateFields {
  id: string;
  userId: string;
  state: AgentState;
  name?: string | null;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  displayIdentity?: Record<string, any> | null;
  runtime?: string | null;
  managed?: boolean | null;
  isLaunchable?: boolean;
  gatewayId?: string | null;
  runtimeKeyAlias?: string | null;
  relayKey?: AgentRelayKey | null;
  cpu: number;
  memory: number;
  requestedSize?: AgentSlotSize | null;
  hostname?: string | null;
  tags?: string[];
  jwtToken?: string | null;
  jwtExpiresAt?: Date | null;
  startedAt?: Date | null;
  stoppedAt?: Date | null;
  archivedAt?: Date | null;
  archivePrefix?: string | null;
  deletedAt?: Date | null;
  disconnectedAt?: Date | null;
  agentSlotId?: string | null;
  clusterId?: string | null;
  launchEpoch?: number;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  launchConfig?: Record<string, any> | null;
  meta?: AgentMeta | null;
  routes: Record<string, AgentRouteConfig>;
  command: string[];
  entrypoint: string[];
  dryRun: boolean;
}

export interface AgentHydrationData {
  id?: string;
  user_id?: string;
  state?: AgentState;
  name?: string | null;
  handle?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  display_identity?: Record<string, any> | null;
  runtime?: string | null;
  managed?: boolean | null;
  is_launchable?: boolean;
  gateway_id?: string | null;
  runtime_key_alias?: string | null;
  relay_key?: AgentRelayKey | null;
  cpu?: number;
  memory?: number;
  requested_size?: unknown;
  hostname?: string | null;
  tags?: string[] | null;
  jwt_token?: string | null;
  jwt_expires_at?: string | null;
  started_at?: string | null;
  stopped_at?: string | null;
  archived_at?: string | null;
  archive_prefix?: string | null;
  deleted_at?: string | null;
  disconnected_at?: string | null;
  agent_slot_id?: string | null;
  cluster_id?: string | null;
  launch_epoch?: number;
  created_at?: string | null;
  updated_at?: string | null;
  launch_config?: Record<string, any> | null;
  meta?: Record<string, any> | null;
  routes?: Record<string, AgentRouteConfig> | null;
  command?: string[] | null;
  entrypoint?: string[] | null;
  dry_run?: boolean;
  openclaw_url?: string | null;
  gateway_url?: string | null;
  [key: string]: any;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  return new Date(value.replace('Z', '+00:00'));
}

function metaStatusFromDict(data: unknown): DeploymentMetaStatus | null {
  if (!isPlainRecord(data)) return null;
  const observed = data.observed_state === 'RUNNING' || data.observed_state === 'STOPPED'
    ? data.observed_state
    : null;
  return {
    status: typeof data.status === 'string' ? data.status : '',
    clusterId: typeof data.cluster_id === 'string' ? data.cluster_id : null,
    namespace: typeof data.namespace === 'string' ? data.namespace : null,
    observedState: observed,
    reason: typeof data.reason === 'string' ? data.reason : null,
    message: typeof data.message === 'string' ? data.message : null,
    observedAt: typeof data.observed_at === 'string' ? data.observed_at : null,
  };
}

function agentMetaFromDict(data: unknown): AgentMeta | null {
  if (!isPlainRecord(data)) return null;
  const meta = structuredClone(data) as AgentMeta;
  if (Object.prototype.hasOwnProperty.call(data, 'status')) {
    meta.status = metaStatusFromDict(data.status);
  }
  return meta;
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
  if (data.runtime === 'openclaw' || data.runtime === 'openclaw-pro') return true;
  const routes = data.routes;
  if (routes && typeof routes === 'object' && !Array.isArray(routes) && routes.openclaw) {
    return true;
  }
  const launchRoutes = data.launch_config?.routes;
  return !!(launchRoutes && typeof launchRoutes === 'object' && !Array.isArray(launchRoutes) && launchRoutes.openclaw);
}

function isTruthyEnv(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value ?? '').trim().toLowerCase());
}

function isFalseyEnv(value: unknown): boolean {
  return ['0', 'false', 'no', 'off', 'disabled'].includes(String(value ?? '').trim().toLowerCase());
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function flattenConfigValue(value: unknown, prefix: string, out: LaunchConfigFlatMap): void {
  if (!prefix) {
    if (isPlainRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        flattenConfigValue(child, key, out);
      }
      return;
    }
    out[''] = value;
    return;
  }

  out[prefix] = value;
  if (Array.isArray(value)) {
    value.forEach((child, index) => flattenConfigValue(child, `${prefix}[${index}]`, out));
    return;
  }
  if (isPlainRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenConfigValue(child, `${prefix}.${key}`, out);
    }
  }
}

export function flattenLaunchConfig(launchConfig: unknown): LaunchConfigFlatMap {
  const flat: LaunchConfigFlatMap = {};
  if (!isPlainRecord(launchConfig)) return flat;
  flattenConfigValue(launchConfig, '', flat);
  return flat;
}

function pathParts(path: string | Array<string | number>): Array<string | number> {
  if (Array.isArray(path)) return path;
  const parts: Array<string | number> = [];
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (!part) continue;
    parts.push(/^\d+$/.test(part) ? Number(part) : part);
  }
  return parts;
}

export function getLaunchConfigValue(launchConfig: unknown, path: string | Array<string | number>): unknown {
  let current = launchConfig;
  for (const part of pathParts(path)) {
    if (typeof part === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[part];
      continue;
    }
    if (!isPlainRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

export function routesHaveDesktop(routes: unknown): boolean {
  if (!isPlainRecord(routes)) return false;
  if (isPlainRecord(routes.desktop)) return true;
  return Object.values(routes).some((route) => isPlainRecord(route) && route.prefix === 'desktop');
}

export function launchConfigHasDesktop(launchConfig: unknown): boolean {
  if (!isPlainRecord(launchConfig)) return false;
  const desktopEnabled = getLaunchConfigValue(launchConfig, 'env.OPENCLAW_DESKTOP_ENABLED');
  if (isFalseyEnv(desktopEnabled)) return false;
  if (isTruthyEnv(desktopEnabled)) return true;
  return routesHaveDesktop(getLaunchConfigValue(launchConfig, 'routes'));
}

export function agentConfigHasDesktop(source: AgentDesktopConfigSource | null | undefined): boolean {
  if (!source) return false;
  const launchConfig = source.launchConfig ?? source.launch_config;
  const desktopEnabled = getLaunchConfigValue(launchConfig, 'env.OPENCLAW_DESKTOP_ENABLED');
  if (isFalseyEnv(desktopEnabled)) return false;
  return (
    launchConfigHasDesktop(launchConfig) ||
    routesHaveDesktop(source.routes)
  );
}

function browserDesktopRedirectPath(options: BrowserDesktopUrlOptions = {}): string {
  const redirect = (options.redirect ?? 'vnc.html').trim() || 'vnc.html';
  if (redirect.includes('\\')) {
    throw new Error('Desktop redirect must be a relative path');
  }

  const base = 'https://desktop.local';
  const parsed = new URL(redirect, `${base}/`);
  if (parsed.origin !== base) {
    throw new Error('Desktop redirect must be a relative path');
  }

  if (options.resize !== null) {
    const resize = options.resize ?? 'scale';
    if (resize.trim()) parsed.searchParams.set('resize', resize);
  }

  const pathname = parsed.pathname.replace(/^\/+/, '') || 'vnc.html';
  return `${pathname}${parsed.search}${parsed.hash}`;
}

export function buildBrowserDesktopUrl(
  desktopBaseUrl: string,
  token: string,
  options: BrowserDesktopUrlOptions = {},
): string {
  const jwt = token.trim();
  if (!jwt) throw new Error('Desktop token is required');

  const url = new URL('/_jwt_auth', desktopBaseUrl);
  url.searchParams.set('jwt', jwt);
  url.searchParams.set('redirect', browserDesktopRedirectPath(options));
  return url.toString();
}

function isOpenClawProHydrationData(data: AgentHydrationData): boolean {
  const launchConfig = data.launch_config;
  if (!launchConfig || typeof launchConfig !== 'object' || Array.isArray(launchConfig)) return false;
  if (launchConfigHasDesktop(launchConfig)) {
    return true;
  }
  const image = String(launchConfig.image ?? '');
  return image.includes('hypercli-openclaw:pro') || image.endsWith('-pro');
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

function fileReadLimitError(path: string, maxBytes: number): Error {
  return new Error(`File ${path} exceeds the ${maxBytes / 1024 / 1024} MiB read limit`);
}

async function readResponseBytes(response: Response, path: string, maxBytes?: number): Promise<Uint8Array> {
  if (maxBytes === undefined) return new Uint8Array(await response.arrayBuffer());
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('maxBytes must be a non-negative safe integer');
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw fileReadLimitError(path, maxBytes);
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw fileReadLimitError(path, maxBytes);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw fileReadLimitError(path, maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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

function ownKeysEqual(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === [...expected].sort()[index]);
}

function validateAgentWsToken(
  value: unknown,
  agentId: string,
  purpose: 'metrics' | 'exec' | 'shell',
  shell?: string,
): AgentOperationTokenResponse | AgentShellTokenResponse {
  const expected = purpose === 'shell'
    ? ['agent_id', 'expires_at', 'jwt', 'shell', 'ws_url']
    : ['agent_id', 'expires_at', 'jwt', 'ws_url'];
  const invalid = () => new Error(`Backend returned an invalid Agent ${purpose} token response`);
  if (!isPlainRecord(value) || !ownKeysEqual(value, expected)) throw invalid();
  if (
    value.agent_id !== agentId
    || typeof value.jwt !== 'string'
    || !value.jwt
    || typeof value.expires_at !== 'string'
    || !value.expires_at
    || typeof value.ws_url !== 'string'
    || !value.ws_url
    || (purpose === 'shell' && value.shell !== shell)
  ) {
    throw invalid();
  }
  let parsed: URL;
  try {
    parsed = new URL(value.ws_url);
  } catch {
    throw invalid();
  }
  if (
    !['ws:', 'wss:'].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !parsed.pathname.endsWith(`/ws/${purpose}/${agentId}`)
  ) {
    throw invalid();
  }
  return value as unknown as AgentOperationTokenResponse | AgentShellTokenResponse;
}

function validateAgentMetricsResult(value: unknown): AgentMetricsResult {
  if (!isPlainRecord(value) || value.event !== 'agent_metrics_result') {
    throw new Error('Agent metrics WebSocket returned an invalid result frame');
  }
  if (value.ok === false && ownKeysEqual(value, ['error', 'event', 'ok'])
    && typeof value.error === 'string' && value.error) {
    throw new Error(value.error);
  }
  if (
    value.ok !== true
    || !ownKeysEqual(value, ['cpu', 'event', 'memory', 'ok', 'timestamp'])
    || typeof value.cpu !== 'string'
    || typeof value.memory !== 'string'
    || !Number.isInteger(value.timestamp)
  ) {
    throw new Error('Agent metrics WebSocket returned an invalid result frame');
  }
  return value as unknown as AgentMetricsResult;
}

function validateAgentExecResult(value: unknown): AgentExecResult {
  if (!isPlainRecord(value) || value.event !== 'agent_exec_result') {
    throw new Error('Agent exec WebSocket returned an invalid result frame');
  }
  if (value.ok === false && ownKeysEqual(value, ['error', 'event', 'ok'])
    && typeof value.error === 'string' && value.error) {
    throw new Error(value.error);
  }
  if (
    value.ok !== true
    || !ownKeysEqual(value, ['event', 'exit_code', 'ok', 'stderr', 'stdout'])
    || !Number.isInteger(value.exit_code)
    || typeof value.stdout !== 'string'
    || typeof value.stderr !== 'string'
  ) {
    throw new Error('Agent exec WebSocket returned an invalid result frame');
  }
  return execResultFromDict(value);
}

function agentStateFromDict(data: AgentHydrationData): AgentStateFields {
  const launchConfig = isPlainRecord(data.launch_config) ? structuredClone(data.launch_config) : null;
  if (launchConfig) {
    delete launchConfig.secrets;
  }
  return {
    id: data.id ?? '',
    userId: data.user_id ?? '',
    state: data.state ?? 'unknown',
    name: data.name ?? null,
    handle: data.handle ?? null,
    displayName: data.display_name ?? data.name ?? null,
    avatarUrl: data.avatar_url ?? null,
    displayIdentity: data.display_identity ? structuredClone(data.display_identity) : null,
    runtime: data.runtime ?? null,
    managed: data.managed ?? null,
    isLaunchable: data.is_launchable ?? data.managed !== false,
    gatewayId: data.gateway_id ?? null,
    runtimeKeyAlias: data.runtime_key_alias ?? null,
    relayKey: data.relay_key ?? null,
    cpu: data.cpu ?? 0,
    memory: data.memory ?? 0,
    requestedSize: data.requested_size == null
      ? null
      : parseAgentSlotSize(data.requested_size, 'Agent requested_size'),
    hostname: data.hostname ?? null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    jwtToken: data.jwt_token ?? null,
    jwtExpiresAt: parseDate(data.jwt_expires_at),
    startedAt: parseDate(data.started_at),
    stoppedAt: parseDate(data.stopped_at),
    archivedAt: parseDate(data.archived_at),
    // Independently nullable from archivedAt: SPEC has a new Agent with
    // neither, an ARCHIVED Agent with both, and a restored Agent with a
    // prefix but no archivedAt. Dropping it made that tri-state unreadable.
    archivePrefix: typeof data.archive_prefix === 'string' ? data.archive_prefix : null,
    deletedAt: parseDate(data.deleted_at),
    disconnectedAt: parseDate(data.disconnected_at),
    agentSlotId: typeof data.agent_slot_id === 'string' ? data.agent_slot_id : null,
    clusterId: data.cluster_id ?? null,
    launchEpoch: data.launch_epoch ?? 0,
    createdAt: parseDate(data.created_at),
    updatedAt: parseDate(data.updated_at),
    launchConfig,
    meta: agentMetaFromDict(data.meta),
    routes: data.routes ?? (
      isPlainRecord(launchConfig?.routes)
        ? launchConfig.routes as Record<string, AgentRouteConfig>
        : {}
    ),
    command: data.command ?? (
      Array.isArray(launchConfig?.command) ? launchConfig.command as string[] : []
    ),
    entrypoint: data.entrypoint ?? (
      Array.isArray(launchConfig?.entrypoint) ? launchConfig.entrypoint as string[] : []
    ),
    dryRun: Boolean(data.dry_run),
  };
}

export function buildAgentConfig(
  config: Record<string, any> = {},
  options: BuildAgentConfigOptions = {},
): { config: AgentLaunchConfig } {
  const preparedConfig = structuredClone(config);
  const nestedLaunchKeys = Object.keys(preparedConfig).filter((key) => LAUNCH_CONFIG_KEYS.has(key));
  if (nestedLaunchKeys.length) {
    throw new Error(`Launch settings must be top-level fields, not nested under config: ${nestedLaunchKeys.join(', ')}`);
  }
  const env = { ...(options.env ?? {}) } as Record<string, string>;
  const secrets = { ...(options.secrets ?? {}) } as Record<string, string>;
  const collidingKeys = Object.keys(env).filter((key) => Object.prototype.hasOwnProperty.call(secrets, key));
  if (collidingKeys.length > 0) {
    throw new Error(`Launch keys cannot appear in both env and secrets: ${collidingKeys.join(', ')}`);
  }

  const normalizeSyncOwner = (value: number | null | undefined, field: string): number | undefined => {
    if (value === undefined || value === null) return undefined;
    if (!Number.isSafeInteger(value) || value < 0 || value > 4_294_967_294) {
      throw new Error(`${field} must be an integer between 0 and 4294967294`);
    }
    return value;
  };
  const syncUid = normalizeSyncOwner(options.syncUid, 'syncUid');
  const syncGid = normalizeSyncOwner(options.syncGid, 'syncGid');

  let registryAuth: RegistryAuth | Record<string, never> = {};
  if (options.registryAuth !== undefined && options.registryAuth !== null) {
    const keys = Object.keys(options.registryAuth).sort();
    if (keys.length !== 2 || keys[0] !== 'password' || keys[1] !== 'username') {
      throw new Error('registryAuth requires exactly username and password');
    }
    const username = options.registryAuth.username.trim();
    if (!username) throw new Error('registryAuth username must be non-empty');
    if (!options.registryAuth.password) throw new Error('registryAuth password must be non-empty');
    registryAuth = { username, password: options.registryAuth.password };
  }

  const prepared: AgentLaunchConfig = {
    config: preparedConfig,
    image: options.image ?? null,
    env,
    secrets,
    routes: structuredClone(options.routes ?? {}),
    command: [...(options.command ?? [])],
    entrypoint: [...(options.entrypoint ?? [])],
    restart: options.restart ?? false,
    sync_root: options.syncRoot ?? null,
    sync_uid: syncUid ?? null,
    sync_gid: syncGid ?? null,
    registry_url: options.registryUrl ?? null,
    registry_auth: registryAuth,
    runtime_scopes: [...(options.runtimeScopes ?? DEFAULT_AGENT_RUNTIME_SCOPES)],
  };
  if (options.cors !== undefined) prepared.cors = options.cors === null ? null : structuredClone(options.cors);
  if (options.syncInclude !== undefined) {
    if (options.syncInclude !== null && options.syncInclude.length === 0) {
      throw new Error('syncInclude must contain at least one path; omit it to sync all');
    }
    prepared.sync_include = options.syncInclude === null ? null : [...options.syncInclude];
  }
  if (options.syncInclude === undefined && options.syncExclude !== undefined) {
    if (options.syncExclude !== null && (options.syncExclude.includes('*') || options.syncExclude.includes('**'))) {
      throw new Error('syncExclude cannot exclude the entire sync root; omit it to sync all');
    }
    prepared.sync_exclude = options.syncExclude === null ? null : [...options.syncExclude];
  }
  return { config: prepared };
}

function buildAgentCreateConfig(
  config: Record<string, any>,
  options: BuildAgentConfigOptions,
): Record<string, any> {
  const complete = buildAgentConfig(config, options).config;
  const prepared: Record<string, any> = {};
  if (Object.keys(complete.config).length > 0) prepared.config = complete.config;
  if (Object.keys(complete.env).length > 0) prepared.env = complete.env;
  if (Object.keys(complete.secrets).length > 0) prepared.secrets = complete.secrets;
  if (options.routes !== undefined && options.routes !== null) prepared.routes = complete.routes;
  if (options.command !== undefined && options.command !== null) prepared.command = complete.command;
  if (options.entrypoint !== undefined && options.entrypoint !== null) prepared.entrypoint = complete.entrypoint;
  if (options.image !== undefined && options.image !== null) prepared.image = complete.image;
  if (options.syncRoot !== undefined && options.syncRoot !== null) prepared.sync_root = complete.sync_root;
  if (Object.prototype.hasOwnProperty.call(complete, 'sync_include')) {
    prepared.sync_include = complete.sync_include;
  } else if (Object.prototype.hasOwnProperty.call(complete, 'sync_exclude')) {
    prepared.sync_exclude = complete.sync_exclude;
  }
  if (options.syncUid !== undefined && options.syncUid !== null) prepared.sync_uid = complete.sync_uid;
  if (options.syncGid !== undefined && options.syncGid !== null) prepared.sync_gid = complete.sync_gid;
  if (options.registryUrl !== undefined && options.registryUrl !== null) prepared.registry_url = complete.registry_url;
  if (options.registryAuth !== undefined && options.registryAuth !== null) prepared.registry_auth = complete.registry_auth;
  if (Object.prototype.hasOwnProperty.call(complete, 'cors') && complete.cors != null) {
    prepared.cors = complete.cors;
  }
  prepared.restart = complete.restart;
  if (options.runtimeScopes !== undefined && options.runtimeScopes !== null) prepared.runtime_scopes = complete.runtime_scopes;
  return prepared;
}

function defaultOpenClawImage(
  image: string | null | undefined,
): string {
  if (image !== undefined && image !== null) return image;
  return DEFAULT_OPENCLAW_IMAGE;
}

function defaultOpenClawProImage(
  image: string | null | undefined,
): string {
  if (image !== undefined && image !== null) return image;
  return DEFAULT_OPENCLAW_PRO_IMAGE;
}

function defaultOpenClawStartImage(
  image: unknown,
  desktopEnabled: boolean,
): string {
  const raw = String(image ?? '').trim();
  if (!raw || STALE_OPENCLAW_IMAGES.has(raw)) {
    return desktopEnabled ? DEFAULT_OPENCLAW_PRO_IMAGE : DEFAULT_OPENCLAW_IMAGE;
  }
  return raw;
}

function canonicalOpenClawGatewayRoute(): AgentRouteConfig {
  return { port: 18789, auth: false, prefix: '' };
}

function withOpenClawGatewayRoute(
  routes: Record<string, AgentRouteConfig> | null | undefined,
): Record<string, AgentRouteConfig> {
  return {
    ...(routes ? structuredClone(routes) : {}),
    openclaw: canonicalOpenClawGatewayRoute(),
  };
}

function repairOpenClawStartLaunchConfig(
  launchConfig: AgentLaunchConfig,
  desktop: boolean | null = null,
): AgentLaunchConfig {
  const prepared = structuredClone(launchConfig);
  const desktopEnabled = desktop ?? launchConfigHasDesktop(prepared);
  prepared.image = defaultOpenClawStartImage(prepared.image, desktopEnabled);
  prepared.routes = withOpenClawGatewayRoute(prepared.routes);
  if (desktop !== null) {
    prepared.env = {
      ...(isPlainRecord(prepared.env) ? prepared.env : {}),
      OPENCLAW_DESKTOP_ENABLED: desktopEnabled ? '1' : '0',
    };
  }
  return prepared;
}

function defaultHermesAgentImage(image: string | null | undefined): string {
  if (image !== undefined && image !== null) return image;
  return DEFAULT_HERMES_AGENT_IMAGE;
}

function resolveHermesApiServerKey(
  explicit: string | null | undefined,
  env: Record<string, string> | undefined,
  secrets: Record<string, string> | undefined,
): string {
  const supplied = [explicit, secrets?.API_SERVER_KEY, env?.API_SERVER_KEY]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean);
  if (new Set(supplied).size > 1) {
    throw new Error('Hermes API_SERVER_KEY conflicts between inputs');
  }
  const key = supplied[0] || randomHexToken(32);
  return key;
}

function normalizeHostedSlackOption(
  slack: OpenClawCreateAgentOptions['slack'],
): OpenClawSlackOptions | null {
  if (slack === undefined || slack === null || slack === false) return null;
  if (slack === true) return {};
  return slack;
}

/**
 * Resolve the hosted Slack relay base.
 *
 * An SDK caller has no dashboard module constant, so the base comes from an
 * explicit option, the same config keys the CLI reads, or the client's agents
 * API base (`normalizeSlackRelayBaseUrl` maps `api.agents.*` onto the relay
 * host). Anything unusable throws rather than shipping a half-built env.
 */
function resolveHostedSlackRelayBaseUrl(
  explicit: string | null | undefined,
  fallbackBaseUrl: string | null | undefined,
): string {
  const candidate = explicit?.trim()
    || getConfigValue('HYPER_SLACK_RELAY_BASE_URL')
    || getConfigValue('SLACK_RELAY_BASE_URL')
    || fallbackBaseUrl?.trim()
    || '';
  if (!candidate) {
    throw new Error(
      'Hosted Slack requires a relay base URL; pass slack.relayBaseUrl or set HYPER_SLACK_RELAY_BASE_URL',
    );
  }
  return normalizeSlackRelayBaseUrl(candidate);
}

/** Merge the hosted Slack relay channel into an OpenClaw runtime config. */
function withHostedSlackRelayChannelConfig(
  config: unknown,
  options: { relayBaseUrl: string; gatewayId: string },
): Record<string, any> {
  const next: Record<string, any> = isPlainRecord(config) ? { ...config } : {};
  const built = buildHostedSlackRelayChannelConfig(options);
  const channels: Record<string, any> = isPlainRecord(next.channels) ? { ...next.channels } : {};
  const existingSlack: Record<string, any> = isPlainRecord(channels.slack) ? channels.slack : {};
  const existingRelay: Record<string, any> = isPlainRecord(existingSlack.relay) ? existingSlack.relay : {};
  channels.slack = {
    ...existingSlack,
    ...built,
    relay: { ...existingRelay, ...built.relay },
  };
  next.channels = channels;
  const messages: Record<string, any> = isPlainRecord(next.messages) ? { ...next.messages } : {};
  const statusReactions: Record<string, any> = isPlainRecord(messages.statusReactions)
    ? { ...messages.statusReactions }
    : {};
  messages.statusReactions = { ...statusReactions, enabled: true };
  next.messages = messages;
  return next;
}

function prepareOpenClawLaunch(
  options: OpenClawCreateAgentOptions,
  generateGatewayToken: true,
  defaultSlackRelayBaseUrl?: string | null,
): {
  config: Record<string, any>;
  env: Record<string, string>;
  secrets: Record<string, string>;
  gatewayToken: string | null;
  slack: PreparedHostedSlack;
} {
  const env = { ...(options.env ?? {}) };
  if (Object.prototype.hasOwnProperty.call(env, 'OPENCLAW_GATEWAY_TOKEN')) {
    throw new Error(
      'OPENCLAW_GATEWAY_TOKEN is a Secret; pass it through secrets or gatewayToken, not env',
    );
  }
  const secrets = { ...(options.secrets ?? {}) };
  const explicitGatewayToken = options.gatewayToken?.trim() || null;
  const secretGatewayToken = secrets.OPENCLAW_GATEWAY_TOKEN?.trim() || null;
  if (options.gatewayToken !== undefined && options.gatewayToken !== null && !explicitGatewayToken) {
    throw new Error('gatewayToken must not be blank');
  }
  if (explicitGatewayToken && secretGatewayToken && explicitGatewayToken !== secretGatewayToken) {
    throw new Error('gatewayToken conflicts with secrets.OPENCLAW_GATEWAY_TOKEN');
  }
  const gatewayToken = explicitGatewayToken
    ?? secretGatewayToken
    ?? (generateGatewayToken ? randomHexToken(32) : null);
  if (gatewayToken) secrets.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
  if (options.controlUiOriginLock !== false && !env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN?.trim()) {
    const controlUiOrigin = defaultControlUiAllowedOrigin();
    if (controlUiOrigin) env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN = controlUiOrigin;
  }

  const config = structuredClone(options.config ?? {});
  if (options.heartbeat) {
    const agentsConfig = isPlainRecord(config.agents) ? { ...config.agents } : {};
    const defaultsConfig = isPlainRecord(agentsConfig.defaults)
      ? { ...agentsConfig.defaults }
      : {};
    const heartbeatConfig = isPlainRecord(defaultsConfig.heartbeat)
      ? { ...defaultsConfig.heartbeat }
      : {};
    defaultsConfig.heartbeat = { ...heartbeatConfig, ...options.heartbeat };
    agentsConfig.defaults = defaultsConfig;
    config.agents = agentsConfig;
  }
  const slackOption = normalizeHostedSlackOption(options.slack);
  for (const key of HOSTED_SLACK_LAUNCH_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(secrets, key)) {
      throw new Error(
        `${key} is launch env, not a Secret; hosted Slack env holds URLs and identifiers, `
        + 'and the credential that flow uses (HYPER_AGENTS_API_KEY) is injected by the platform',
      );
    }
  }
  const explicitSlackEnvKeys = HOSTED_SLACK_LAUNCH_ENV_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(env, key));
  let slack: PreparedHostedSlack = { enabled: false, relayBaseUrl: null, gatewayId: null };
  if (slackOption) {
    if (explicitSlackEnvKeys.length) {
      throw new Error(
        `slack conflicts with ${explicitSlackEnvKeys.join(', ')} in env; `
        + 'state the intent with slack and let the SDK build the launch env',
      );
    }
    const relayBaseUrl = resolveHostedSlackRelayBaseUrl(slackOption.relayBaseUrl, defaultSlackRelayBaseUrl);
    const gatewayId = slackOption.gatewayId?.trim() || null;
    if (slackOption.gatewayId !== undefined && slackOption.gatewayId !== null && !gatewayId) {
      throw new Error('slack.gatewayId must not be blank');
    }
    if (!gatewayId && options.dryRun) {
      throw new Error(
        'createOpenClaw dry runs cannot preview hosted Slack: HYPER_SLACK_GATEWAY_ID is derived '
        + 'from the Agent id the Backend assigns at create time. Pass slack.gatewayId to preview it.',
      );
    }
    // With no gateway id the set stays absent entirely: a stored launch env
    // that enables Slack without one is exactly the state that kills the pod.
    if (gatewayId) Object.assign(env, HostedSlackLaunchEnv.build({ relayBaseUrl, gatewayId }));
    slack = { enabled: true, relayBaseUrl, gatewayId };
  } else {
    HostedSlackLaunchEnv.assertComplete(env, 'createOpenClaw env');
    slack = {
      enabled: HostedSlackLaunchEnv.isEnabled(env),
      relayBaseUrl: null,
      gatewayId: env[HOSTED_SLACK_GATEWAY_ID_ENV]?.trim() || null,
    };
  }
  return { config, env, secrets, gatewayToken, slack };
}

export async function startSlackOAuth(options: SlackOAuthStartOptions): Promise<SlackOAuthStartResult> {
  const relayBaseUrl = normalizeSlackRelayBaseUrl(options.relayBaseUrl);
  if (!relayBaseUrl) throw new Error('Slack relay base URL is required');
  if (!options.token) throw new Error('Slack OAuth requires an app token');
  const response = await fetch(`${relayBaseUrl}/slack/oauth/start`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${options.token}`,
    },
  });
  if (!response.ok) {
    let detail = response.statusText || 'Slack OAuth start failed';
    try {
      const payload = await response.json() as { detail?: unknown };
      if (typeof payload.detail === 'string' && payload.detail) detail = payload.detail;
    } catch {
      // Keep the HTTP status text when the error body is not JSON.
    }
    throw new APIError(response.status, detail);
  }
  const payload = await response.json() as { authorize_url?: unknown; expires_at?: unknown };
  const authorizeUrl = typeof payload.authorize_url === 'string' ? payload.authorize_url : '';
  if (!authorizeUrl) throw new Error('Slack OAuth start did not return an authorization URL');
  return {
    authorizeUrl,
    expiresAt: typeof payload.expires_at === 'string' ? payload.expires_at : null,
  };
}

export async function getSlackInstallStatus(options: SlackInstallStatusOptions): Promise<SlackInstallStatus> {
  const relayBaseUrl = normalizeSlackRelayBaseUrl(options.relayBaseUrl);
  if (!relayBaseUrl) throw new Error('Slack relay base URL is required');
  if (!options.token) throw new Error('Slack install status requires an app token');
  const response = await fetch(`${relayBaseUrl}/slack/install`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${options.token}` },
  });
  if (!response.ok) {
    let detail = response.statusText || 'Slack install status failed';
    try {
      const payload = await response.json() as { detail?: unknown };
      if (typeof payload.detail === 'string' && payload.detail) detail = payload.detail;
    } catch {
      // Keep the HTTP status text when the error body is not JSON.
    }
    throw new APIError(response.status, detail);
  }
  const payload = await response.json() as Record<string, unknown>;
  return {
    connected: payload.connected === true,
    teamId: typeof payload.team_id === 'string' ? payload.team_id : null,
    teamName: typeof payload.team_name === 'string' ? payload.team_name : null,
    botUserId: typeof payload.bot_user_id === 'string' ? payload.bot_user_id : null,
    installerUserId: typeof payload.installer_user_id === 'string' ? payload.installer_user_id : null,
    updatedAt: typeof payload.updated_at === 'string' ? payload.updated_at : null,
  };
}

function slackRelayAuthorizedUrl(path: string, options: SlackDirectoryOptions): URL {
  const relayBaseUrl = normalizeSlackRelayBaseUrl(options.relayBaseUrl);
  if (!relayBaseUrl) throw new Error('Slack relay base URL is required');
  if (!options.token) throw new Error('Slack directory lookup requires an app token');
  const url = new URL(path, `${relayBaseUrl}/`);
  if (options.cursor) url.searchParams.set('cursor', options.cursor);
  if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    url.searchParams.set('limit', String(Math.trunc(options.limit)));
  }
  return url;
}

export async function listSlackDirectoryConversations(
  options: SlackDirectoryConversationsOptions,
): Promise<SlackDirectoryConversationsResult> {
  const url = slackRelayAuthorizedUrl('/slack/directory/conversations', options);
  if (options.types) url.searchParams.set('types', options.types);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${options.token}` },
  });
  if (!response.ok) {
    let detail = response.statusText || 'Slack conversation lookup failed';
    try {
      const payload = await response.json() as { detail?: unknown };
      if (typeof payload.detail === 'string' && payload.detail) detail = payload.detail;
    } catch {
      // Keep the HTTP status text when the error body is not JSON.
    }
    throw new APIError(response.status, detail);
  }
  const payload = await response.json() as Record<string, unknown>;
  const conversations = Array.isArray(payload.conversations) ? payload.conversations : [];
  return {
    conversations: conversations
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === 'string'))
      .map((item) => ({
        id: item.id as string,
        name: typeof item.name === 'string' ? item.name : null,
        isChannel: typeof item.is_channel === 'boolean' ? item.is_channel : null,
        isGroup: typeof item.is_group === 'boolean' ? item.is_group : null,
        isIm: typeof item.is_im === 'boolean' ? item.is_im : null,
        isMpim: typeof item.is_mpim === 'boolean' ? item.is_mpim : null,
        isMember: typeof item.is_member === 'boolean' ? item.is_member : null,
        isPrivate: typeof item.is_private === 'boolean' ? item.is_private : null,
      })),
    nextCursor: typeof payload.next_cursor === 'string' ? payload.next_cursor : null,
  };
}

export async function listSlackDirectoryUsers(options: SlackDirectoryOptions): Promise<SlackDirectoryUsersResult> {
  const url = slackRelayAuthorizedUrl('/slack/directory/users', options);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${options.token}` },
  });
  if (!response.ok) {
    let detail = response.statusText || 'Slack user lookup failed';
    try {
      const payload = await response.json() as { detail?: unknown };
      if (typeof payload.detail === 'string' && payload.detail) detail = payload.detail;
    } catch {
      // Keep the HTTP status text when the error body is not JSON.
    }
    throw new APIError(response.status, detail);
  }
  const payload = await response.json() as Record<string, unknown>;
  const users = Array.isArray(payload.users) ? payload.users : [];
  return {
    users: users
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === 'string'))
      .map((item) => ({
        id: item.id as string,
        name: typeof item.name === 'string' ? item.name : null,
        realName: typeof item.real_name === 'string' ? item.real_name : null,
        teamId: typeof item.team_id === 'string' ? item.team_id : null,
        isBot: typeof item.is_bot === 'boolean' ? item.is_bot : null,
        deleted: typeof item.deleted === 'boolean' ? item.deleted : null,
      })),
    nextCursor: typeof payload.next_cursor === 'string' ? payload.next_cursor : null,
  };
}

export async function attachSlackRelayAgent(options: AttachSlackRelayAgentOptions): Promise<AttachSlackRelayAgentResult> {
  const relayBaseUrl = normalizeSlackRelayBaseUrl(options.relayBaseUrl);
  const agentId = options.agentId.trim();
  if (!relayBaseUrl) throw new Error('Slack relay base URL is required');
  if (!options.token) throw new Error('Slack relay attach requires an app token');
  if (!agentId) throw new Error('Slack relay attach requires an agent id');
  const response = await fetch(`${relayBaseUrl}/slack/agents/${encodeURIComponent(agentId)}/relay`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${options.token}` },
  });
  if (!response.ok) {
    let detail = response.statusText || 'Slack relay attach failed';
    try {
      const payload = await response.json() as { detail?: unknown };
      if (typeof payload.detail === 'string' && payload.detail) detail = payload.detail;
    } catch {
      // Keep the HTTP status text when the error body is not JSON.
    }
    throw new APIError(response.status, detail);
  }
  const payload = await response.json() as Record<string, unknown>;
  const agentIdValue = typeof payload.agent_id === 'string' ? payload.agent_id : '';
  const gatewayIdValue = typeof payload.gateway_id === 'string' ? payload.gateway_id : '';
  if (!agentIdValue || !gatewayIdValue) throw new Error('Slack relay attach response is missing agent identity');
  return {
    connected: payload.connected === true,
    agentId: agentIdValue,
    gatewayId: gatewayIdValue,
    config: payload.config && typeof payload.config === 'object' && !Array.isArray(payload.config) ? payload.config as Record<string, unknown> : {},
    restartRequired: payload.restart_required !== false,
    teamId: typeof payload.team_id === 'string' ? payload.team_id : null,
    teamName: typeof payload.team_name === 'string' ? payload.team_name : null,
    botUserId: typeof payload.bot_user_id === 'string' ? payload.bot_user_id : null,
  };
}

export function buildOpenClawRoutes(options: OpenClawRouteOptions = {}): Record<string, AgentRouteConfig> {
  const routes: Record<string, AgentRouteConfig> = {
    openclaw: canonicalOpenClawGatewayRoute(),
  };
  if (options.includeDesktop ?? false) {
    routes.desktop = {
      port: options.desktopPort ?? 3000,
      auth: options.desktopAuth ?? true,
      prefix: options.desktopPrefix ?? 'desktop',
    };
  }
  return routes;
}

export function buildHermesAgentRoutes(options: HermesAgentRouteOptions = {}): Record<string, AgentRouteConfig> {
  return {
    hermes: {
      port: options.port ?? 8642,
      auth: options.auth ?? false,
      prefix: options.prefix ?? '',
    },
  };
}

function envBool(value: unknown): string {
  return value ? '1' : '0';
}

function envNonNegativeInteger(name: string, value: unknown): string {
  const integer = Number(value);
  if (!Number.isInteger(integer) || integer < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return String(integer);
}

export function buildOpenClawMemoryIndexEnv(memoryIndex: OpenClawMemoryIndexOptions | null = null): Record<string, string> {
  if (!memoryIndex) return {};
  const env: Record<string, string> = { ...OPENCLAW_MEMORY_SEARCH_ENV_DEFAULTS };
  if (memoryIndex.enabled !== undefined && memoryIndex.enabled !== null) {
    env.OPENCLAW_MEMORY_SEARCH_ENABLED = envBool(memoryIndex.enabled);
  }
  if (memoryIndex.onSessionStart !== undefined && memoryIndex.onSessionStart !== null) {
    env.OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START = envBool(memoryIndex.onSessionStart);
  }
  if (memoryIndex.onSearch !== undefined && memoryIndex.onSearch !== null) {
    env.OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH = envBool(memoryIndex.onSearch);
  }
  if (memoryIndex.watch !== undefined && memoryIndex.watch !== null) {
    env.OPENCLAW_MEMORY_SEARCH_SYNC_WATCH = envBool(memoryIndex.watch);
  }
  if (memoryIndex.watchDebounceMs !== undefined && memoryIndex.watchDebounceMs !== null) {
    env.OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS = envNonNegativeInteger(
      'watchDebounceMs',
      memoryIndex.watchDebounceMs,
    );
  }
  if (memoryIndex.intervalMinutes !== undefined && memoryIndex.intervalMinutes !== null) {
    env.OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES = envNonNegativeInteger(
      'intervalMinutes',
      memoryIndex.intervalMinutes,
    );
  }
  return env;
}

export function buildOpenClawWorkspacesSyncEnv(
  workspacesSync: OpenClawWorkspacesSyncOptions | boolean | null = null,
): Record<string, string> {
  if (workspacesSync === false) return { HYPER_WORKSPACES_BOOT_SYNC: '0' };
  const options = typeof workspacesSync === 'object' && workspacesSync !== null ? workspacesSync : {};
  if (options.enabled === false) return { HYPER_WORKSPACES_BOOT_SYNC: '0' };
  const env: Record<string, string> = { ...OPENCLAW_WORKSPACES_SYNC_ENV_DEFAULTS };
  if (options.enabled !== undefined && options.enabled !== null) {
    env.HYPER_WORKSPACES_BOOT_SYNC = envBool(options.enabled);
  }
  if (options.readyOnly !== undefined && options.readyOnly !== null) {
    env.HYPER_WORKSPACES_SYNC_READY_ONLY = envBool(options.readyOnly);
  }
  if (options.workspace) {
    env.HYPER_WORKSPACES_SYNC_WORKSPACE = options.workspace;
  }
  return env;
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
  public readonly state: string;
  public readonly name: string | null;
  public readonly handle: string | null;
  public readonly displayName: string | null;
  public readonly avatarUrl: string | null;
  public readonly displayIdentity: Record<string, any> | null;
  public readonly runtime: string | null;
  public readonly managed: boolean | null;
  public readonly isLaunchable: boolean;
  public readonly gatewayId: string | null;
  public readonly runtimeKeyAlias: string | null;
  public readonly relayKey: AgentRelayKey | null;
  public readonly cpu: number;
  public readonly memory: number;
  public readonly requestedSize: AgentSlotSize | null;
  public readonly hostname: string | null;
  public readonly tags: string[];
  public jwtToken: string | null;
  public jwtExpiresAt: Date | null;
  public readonly startedAt: Date | null;
  public readonly stoppedAt: Date | null;
  public readonly archivedAt: Date | null;
  public readonly archivePrefix: string | null;
  public readonly deletedAt: Date | null;
  public readonly disconnectedAt: Date | null;
  public readonly agentSlotId: string | null;
  public readonly clusterId: string | null;
  public readonly launchEpoch: number;
  public readonly createdAt: Date | null;
  public readonly updatedAt: Date | null;
  public launchConfig: Record<string, any> | null;
  public readonly meta: AgentMeta | null;
  public routes: Record<string, AgentRouteConfig>;
  public command: string[];
  public entrypoint: string[];
  public readonly dryRun: boolean;
  _deployments: Deployments | null = null;

  constructor(fields: AgentStateFields) {
    this.id = fields.id;
    this.userId = fields.userId;
    this.state = fields.state;
    this.name = fields.name ?? null;
    this.handle = fields.handle ?? null;
    this.displayName = fields.displayName ?? this.name;
    this.avatarUrl = fields.avatarUrl ?? null;
    this.displayIdentity = fields.displayIdentity ? structuredClone(fields.displayIdentity) : null;
    this.runtime = fields.runtime ?? null;
    this.managed = fields.managed ?? null;
    this.isLaunchable = fields.isLaunchable ?? true;
    this.gatewayId = fields.gatewayId ?? null;
    this.runtimeKeyAlias = fields.runtimeKeyAlias ?? null;
    this.relayKey = fields.relayKey ? structuredClone(fields.relayKey) : null;
    this.cpu = fields.cpu;
    this.memory = fields.memory;
    this.requestedSize = fields.requestedSize ?? null;
    this.hostname = fields.hostname ?? null;
    this.tags = [...(fields.tags ?? [])];
    this.jwtToken = fields.jwtToken ?? null;
    this.jwtExpiresAt = fields.jwtExpiresAt ?? null;
    this.startedAt = fields.startedAt ?? null;
    this.stoppedAt = fields.stoppedAt ?? null;
    this.archivedAt = fields.archivedAt ?? null;
    this.archivePrefix = fields.archivePrefix ?? null;
    this.deletedAt = fields.deletedAt ?? null;
    this.disconnectedAt = fields.disconnectedAt ?? null;
    this.agentSlotId = fields.agentSlotId ?? null;
    this.clusterId = fields.clusterId ?? null;
    this.launchEpoch = fields.launchEpoch ?? 0;
    this.createdAt = fields.createdAt ?? null;
    this.updatedAt = fields.updatedAt ?? null;
    this.launchConfig = fields.launchConfig ?? null;
    this.meta = fields.meta ? structuredClone(fields.meta) : null;
    this.routes = { ...fields.routes };
    this.command = [...fields.command];
    this.entrypoint = [...fields.entrypoint];
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

  browserDesktopUrl(token: string, options: BrowserDesktopUrlOptions = {}): string | null {
    if (!this.desktopUrl) return null;
    return buildBrowserDesktopUrl(this.desktopUrl, token, options);
  }

  get shellUrl(): string | null {
    return this.routeUrl('shell');
  }

  get isRunning(): boolean {
    return this.state.toLowerCase() === 'running';
  }

  get isTransitioning(): boolean {
    return isAgentTransitionalState(this.state);
  }

  /** True when the agent is cold-restorable from its verified archive. */
  get isArchived(): boolean {
    return this.state.toUpperCase() === 'ARCHIVED';
  }

  /** True only for an explicitly included deletion tombstone. */
  get isDeleted(): boolean {
    return this.state.toUpperCase() === 'DELETED';
  }

  get hasDesktop(): boolean {
    return agentConfigHasDesktop({
      launchConfig: this.launchConfig,
      routes: this.routes,
    });
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
    return this.requireDeployments().waitRunning(
      this.id,
      timeoutMs,
      pollIntervalMs,
      this.launchEpoch > 0 ? this.launchEpoch : undefined,
    );
  }

  async update(options: UpdateAgentOptions): Promise<Agent> {
    return this.requireDeployments().update(this.id, options);
  }

  async resize(options: Pick<UpdateAgentOptions, 'size'>): Promise<Agent> {
    return this.requireDeployments().resize(this.id, options);
  }

  /** Accept background archival and return its transitional Agent projection. */
  async archive(): Promise<Agent> {
    return this.requireDeployments().archive(this.id);
  }

  async env(): Promise<Record<string, string>> {
    const response = await this.requireDeployments().env(this.id);
    if (response.launch_epoch < this.launchEpoch) {
      throw new Error('agent env belongs to an older launch epoch');
    }
    return response.env;
  }

  async setEnv(key: string, value: string): Promise<AgentEnvMutationResponse> {
    return this.requireDeployments().setEnv(this.id, key, value);
  }

  async deleteEnv(key: string): Promise<AgentEnvMutationResponse> {
    return this.requireDeployments().deleteEnv(this.id, key);
  }

  async secretNames(): Promise<string[]> {
    const response = await this.requireDeployments().secretNames(this.id);
    if (response.launch_epoch < this.launchEpoch) {
      throw new Error('agent Secret names belong to an older launch epoch');
    }
    return response.names;
  }

  async secret(key: string): Promise<string> {
    const response = await this.requireDeployments().secret(this.id, key);
    if (response.launch_epoch < this.launchEpoch) {
      throw new Error('agent Secret belongs to an older launch epoch');
    }
    return response.value;
  }

  async setSecret(key: string, value: string): Promise<AgentSecretMutationResponse> {
    return this.requireDeployments().setSecret(this.id, key, value);
  }

  async deleteSecret(key: string): Promise<AgentSecretMutationResponse> {
    return this.requireDeployments().deleteSecret(this.id, key);
  }

  async exec(command: string[], options: AgentExecOptions = {}): Promise<AgentExecResult> {
    return this.requireDeployments().exec(this, command, options);
  }

  /** Reef-backed files scoped to this agent's configured sync root. */
  get files(): AgentFiles {
    return new AgentFiles(this, this.requireDeployments());
  }

  async filesList(path: string = ''): Promise<AgentFileEntry[]> {
    return this.files.list(path);
  }

  async fileReadBytes(path: string, options?: AgentFileReadOptions): Promise<Uint8Array> {
    return this.files.readBytes(path, options);
  }

  async fileReadBytesWithMetadata(
    path: string,
    options?: AgentFileReadOptions,
  ): Promise<AgentFileReadBytesResult> {
    return this.files.readBytesWithMetadata(path, options);
  }

  async fileRead(path: string, options?: AgentFileReadOptions): Promise<string> {
    return this.files.read(path, options);
  }

  async fileWriteBytes(path: string, content: Uint8Array | ArrayBuffer | string): Promise<Record<string, any>> {
    return this.files.writeBytes(path, content);
  }

  async fileWrite(path: string, content: string): Promise<Record<string, any>> {
    return this.files.write(path, content);
  }

  async fileDelete(path: string, options: { recursive?: boolean } = {}): Promise<Record<string, any>> {
    return this.files.delete(path, options);
  }

  async cpTo(localPath: string, remotePath: string): Promise<Record<string, any>> {
    return this.requireDeployments().cpTo(this, localPath, remotePath);
  }

  async cpFrom(remotePath: string, localPath: string): Promise<string> {
    return this.requireDeployments().cpFrom(this, remotePath, localPath);
  }

  async shellConnect(shell?: string, options?: AgentShellConnectOptions): Promise<WebSocket> {
    return this.requireDeployments().shellConnect(this.id, shell, options);
  }
}

type RuntimeAuthConfig = {
  agentCommand: string[];
  statusCommand: string[];
  logoutCommand: string[] | null;
  nativeMethods: RuntimeAuthMethod[];
};

const RUNTIME_AUTH_CONFIG: Record<CodingAgentRuntime, RuntimeAuthConfig> = {
  'buzz-agent': {
    agentCommand: ['buzz-agent'],
    statusCommand: ['buzz-acp', 'models', '--agent-command', 'buzz-agent', '--json'],
    logoutCommand: null,
    nativeMethods: [],
  },
  opencode: {
    agentCommand: ['opencode', 'acp'],
    statusCommand: ['buzz-acp', 'models', '--agent-command', 'opencode', '--agent-args', 'acp', '--json'],
    logoutCommand: ['opencode', 'auth', 'logout'],
    nativeMethods: [],
  },
  codex: {
    agentCommand: ['codex-acp'],
    statusCommand: ['codex', 'login', 'status'],
    logoutCommand: ['codex', 'logout'],
    nativeMethods: [{
      id: 'device',
      name: 'Device authentication',
      description: 'Authenticate Codex with a device code.',
      kind: 'native',
      command: ['codex', 'login', '--device-auth'],
      metadata: {},
    }],
  },
  'claude-code': {
    agentCommand: ['claude-agent-acp'],
    statusCommand: ['claude', 'auth', 'status', '--json'],
    logoutCommand: ['claude', 'auth', 'logout'],
    nativeMethods: [
      { id: 'claude-ai', name: 'Claude.ai', description: '', kind: 'native', command: ['claude', 'auth', 'login', '--claudeai'], metadata: {} },
      { id: 'console', name: 'Anthropic Console', description: '', kind: 'native', command: ['claude', 'auth', 'login', '--console'], metadata: {} },
      { id: 'sso', name: 'Enterprise SSO', description: '', kind: 'native', command: ['claude', 'auth', 'login', '--sso'], metadata: {} },
    ],
  },
  goose: {
    agentCommand: ['goose', 'acp'],
    statusCommand: ['buzz-acp', 'models', '--agent-command', 'goose', '--agent-args', 'acp', '--json'],
    logoutCommand: null,
    nativeMethods: [],
  },
  'kimi-code': {
    agentCommand: ['kimi', 'acp'],
    statusCommand: ['buzz-acp', 'models', '--agent-command', 'kimi', '--agent-args', 'acp', '--json'],
    logoutCommand: null,
    nativeMethods: [],
  },
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function commandString(command: string[]): string {
  return command.map(shellQuote).join(' ');
}

// Terminal control-sequence matching intentionally includes ESC and BEL.
/* eslint-disable no-control-regex */
const TERMINAL_ESCAPE_PATTERN = new RegExp(
  '\\x1B(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\x07]*(?:\\x07|\\x1B\\\\))',
  'g',
);
/* eslint-enable no-control-regex */

function stripTerminalCodes(value: string): string {
  return value.replace(TERMINAL_ESCAPE_PATTERN, '').replace(/\r/g, '');
}

function authMethodFromPayload(value: unknown): RuntimeAuthMethod | null {
  if (!isPlainRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : '';
  if (!id) return null;
  const metadata = isPlainRecord(value._meta) ? { ...value._meta } : {};
  let command: string[] = [];
  const terminal = isPlainRecord(metadata['terminal-auth']) ? metadata['terminal-auth'] : null;
  const source = terminal ?? value;
  if (Array.isArray(source.command) && source.command.every((part) => typeof part === 'string')) {
    command = [...source.command];
  } else if (typeof source.command === 'string') {
    const args = Array.isArray(source.args) ? source.args.filter((part): part is string => typeof part === 'string') : [];
    command = [source.command, ...args];
  }
  if (id === 'claude-login' && command.length > 0 && !command.includes('login')) {
    command.push('auth', 'login');
  }
  return {
    id,
    name: typeof value.name === 'string' ? value.name : id,
    description: typeof value.description === 'string' ? value.description : '',
    kind: typeof value.kind === 'string' ? value.kind : 'acp',
    command,
    metadata,
  };
}

async function websocketMessageText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return decodeUtf8(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return decodeUtf8(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  return String(data ?? '');
}

export class RuntimeLoginSession {
  public output = '';
  public verificationUrl: string | null = null;
  public userCode: string | null = null;
  public interactiveRequired = false;
  private rawOutput = '';
  private exitCode: number | null = null;
  private readonly marker: string;
  private readonly completion: Promise<void>;
  private readonly ready: Promise<void>;
  private complete!: () => void;
  private markReady!: () => void;

  private constructor(
    private readonly authClient: RuntimeAuthClient,
    public readonly socket: WebSocket,
    command: string[],
    private readonly requiresDeviceChallenge: boolean,
  ) {
    this.marker = `__HYPERCLI_AUTH_EXIT_${randomHexToken(12)}__=`;
    this.completion = new Promise((resolve) => { this.complete = resolve; });
    this.ready = new Promise((resolve) => { this.markReady = resolve; });
    socket.onmessage = (event) => {
      void websocketMessageText(event.data).then((chunk) => this.consume(chunk));
    };
    socket.onclose = () => {
      this.markReady();
      this.complete();
    };
    socket.send(`${commandString(command)}; _hypercli_auth_rc=$?; printf '\\n${this.marker}%s\\n' "$_hypercli_auth_rc"\n`);
  }

  static async start(
    authClient: RuntimeAuthClient,
    command: string[],
    challengeTimeoutMs = 45_000,
    requiresDeviceChallenge = false,
  ): Promise<RuntimeLoginSession> {
    const socket = await authClient.agent.shellConnect();
    const session = new RuntimeLoginSession(authClient, socket, command, requiresDeviceChallenge);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        session.ready,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Timed out waiting for runtime login instructions')), challengeTimeoutMs);
        }),
      ]);
      return session;
    } catch (error) {
      session.cancel();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private consume(chunk: string): void {
    this.rawOutput += chunk;
    this.output = stripTerminalCodes(this.rawOutput);
    const markerIndex = this.output.lastIndexOf(this.marker);
    if (markerIndex >= 0) {
      const match = this.output.slice(markerIndex + this.marker.length).match(/^(-?\d+)/);
      if (match) {
        this.exitCode = Number(match[1]);
        this.markReady();
        this.complete();
      }
    }
    this.verificationUrl ??= this.output.match(/https?:\/\/[^\s"'<>]+(?=[\s"'<>])/)?.[0] ?? null;
    this.userCode ??= this.output.match(/\b(?:user|device|verification|one[- ]time)\s+code\b\s*(?:is|:)?\s*(?:\([^\r\n)]*\)\s*)*((?!authorization\b)[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)(?=[\s.,;:)\]])/i)?.[1] ?? null;
    this.interactiveRequired ||= /\b(select|choose)\b.*\b(provider|login method)\b/i.test(this.output);
    const challengeReady = this.requiresDeviceChallenge
      ? Boolean(this.verificationUrl && this.userCode)
      : Boolean(this.verificationUrl || this.userCode);
    if (challengeReady || this.interactiveRequired) this.markReady();
  }

  send(text: string): void {
    this.socket.send(text.endsWith('\n') ? text : `${text}\n`);
  }

  async wait(timeoutMs = 600_000): Promise<RuntimeAuthStatus> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.completion,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Runtime authentication timed out')), timeoutMs);
        }),
      ]);
    } catch (error) {
      this.cancel();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (this.exitCode !== null && this.exitCode !== 0) {
      throw new Error(`Runtime authentication failed (${this.exitCode}): ${this.output.trim()}`);
    }
    return this.authClient.status();
  }

  cancel(): void {
    // The SDK supports Node runtimes where the socket is supplied by `ws` and
    // no global WebSocket constructor exists. OPEN is the protocol state 1.
    if (this.socket.readyState === 1) this.socket.send('\x03');
    this.socket.close();
  }
}

export class RuntimeAuthClient {
  private readonly config: RuntimeAuthConfig;

  constructor(public readonly agent: CodingAgent) {
    this.config = RUNTIME_AUTH_CONFIG[agent.runtime];
  }

  async methods(): Promise<RuntimeAuthMethod[]> {
    const [agentCommand, ...agentArgs] = this.config.agentCommand;
    const command = ['buzz-acp', 'auth-methods', '--agent-command', agentCommand];
    if (agentArgs.length) command.push('--agent-args', agentArgs.join(','));
    command.push('--json');
    const result = await this.agent.exec(command);
    const discovered: RuntimeAuthMethod[] = [];
    if (result.exitCode === 0) {
      try {
        const payload = JSON.parse(stripTerminalCodes(result.stdout)) as unknown;
        const values = isPlainRecord(payload) && Array.isArray(payload.methods) ? payload.methods : [];
        for (const value of values) {
          const method = authMethodFromPayload(value);
          if (method) discovered.push(method);
        }
      } catch {
        // Native fallbacks still make authentication available.
      }
    }
    if (this.agent.runtime === 'opencode' && discovered.length === 0) {
      discovered.push({
        id: 'provider',
        name: 'Provider login',
        description: '',
        kind: 'native',
        command: ['opencode', 'auth', 'login'],
        metadata: {},
      });
    }
    const seen = new Set(discovered.map((method) => method.id));
    for (const method of this.config.nativeMethods) {
      if (!seen.has(method.id)) discovered.push({ ...method, command: [...method.command], metadata: { ...method.metadata } });
    }
    return discovered;
  }

  async status(): Promise<RuntimeAuthStatus> {
    const result = await this.agent.exec([...this.config.statusCommand]);
    const output = stripTerminalCodes([result.stdout, result.stderr].filter(Boolean).join('\n')).trim();
    const detail: Record<string, unknown> = { exitCode: result.exitCode, output };
    if (this.agent.runtime === 'claude-code') {
      try {
        const payload = JSON.parse(stripTerminalCodes(result.stdout)) as Record<string, unknown>;
        Object.assign(detail, payload);
        const loginMethod = payload.loginMethod ?? payload.authMethod;
        return {
          authenticated: payload.loggedIn === true || payload.authenticated === true ||
            (typeof loginMethod === 'string' && loginMethod.toLowerCase() !== 'none'),
          provider: typeof (payload.subscriptionType ?? payload.provider ?? payload.apiProvider) === 'string'
            ? String(payload.subscriptionType ?? payload.provider ?? payload.apiProvider) : null,
          account: typeof payload.email === 'string' ? payload.email : null,
          method: typeof loginMethod === 'string' ? loginMethod : null,
          detail,
        };
      } catch {
        // Fall through to the generic status parser.
      }
    }
    const negative = /\b(not logged|not authenticated|unauthenticated|no credentials|0 credentials)\b/i.test(output);
    return { authenticated: result.exitCode === 0 && !negative, detail };
  }

  async login(options: RuntimeAuthLoginOptions = {}): Promise<RuntimeLoginSession> {
    const methods = await this.methods();
    const method = options.method
      ? methods.find((candidate) => candidate.id === options.method)
      : methods.find((candidate) => candidate.command.length > 0) ?? methods[0];
    if (!method) {
      throw new Error(options.method
        ? `Unknown authentication method: ${options.method}`
        : 'No authentication methods are available');
    }
    let command = [...method.command];
    if (!command.length) {
      const [agentCommand, ...agentArgs] = this.config.agentCommand;
      command = ['buzz-acp', 'authenticate', '--agent-command', agentCommand];
      if (agentArgs.length) command.push('--agent-args', agentArgs.join(','));
      command.push('--method-id', method.id);
    }
    if (this.agent.runtime === 'opencode') {
      if (options.provider) command.push('--provider', options.provider);
      if (options.providerMethod) command.push('--method', options.providerMethod);
    }
    if (this.agent.runtime === 'claude-code' && options.email) command.push('--email', options.email);
    const requiresDeviceChallenge = method.kind === 'device'
      || method.id === 'device'
      || command.some((part) => part.toLowerCase().includes('device-auth'));
    return RuntimeLoginSession.start(
      this,
      command,
      options.challengeTimeoutMs,
      requiresDeviceChallenge,
    );
  }

  async logout(provider?: string): Promise<RuntimeAuthStatus> {
    if (this.config.logoutCommand === null) {
      const reason = this.agent.runtime === 'goose'
        ? 'uses its injected deployment credential'
        : 'does not expose a noninteractive logout command';
      throw new Error(`${this.agent.runtime} ${reason} and cannot log out`);
    }
    const command = [...this.config.logoutCommand];
    if (this.agent.runtime === 'opencode' && provider) command.push(provider);
    const result = await this.agent.exec(command);
    if (result.exitCode !== 0) {
      throw new Error(`Runtime logout failed (${result.exitCode}): ${stripTerminalCodes(result.stderr || result.stdout).trim()}`);
    }
    return this.status();
  }
}

export class CodingAgent extends Agent {
  declare public readonly runtime: CodingAgentRuntime;
  static readonly defaultSyncInclude: readonly string[] | null = null;

  get auth(): RuntimeAuthClient {
    return new RuntimeAuthClient(this);
  }
}

export class BuzzAgent extends CodingAgent {
  declare public readonly runtime: 'buzz-agent';
  static override readonly defaultSyncInclude = DEFAULT_CODING_AGENT_SYNC_INCLUDES['buzz-agent'];
  static override fromDict(data: AgentHydrationData): BuzzAgent {
    return new BuzzAgent(agentStateFromDict(data));
  }
}

export class OpenCodeAgent extends CodingAgent {
  declare public readonly runtime: 'opencode';
  static override readonly defaultSyncInclude = DEFAULT_CODING_AGENT_SYNC_INCLUDES.opencode;
  static override fromDict(data: AgentHydrationData): OpenCodeAgent {
    return new OpenCodeAgent(agentStateFromDict(data));
  }
}

export class CodexAgent extends CodingAgent {
  declare public readonly runtime: 'codex';
  static override readonly defaultSyncInclude = DEFAULT_CODING_AGENT_SYNC_INCLUDES.codex;
  static override fromDict(data: AgentHydrationData): CodexAgent {
    return new CodexAgent(agentStateFromDict(data));
  }
}

export class ClaudeCodeAgent extends CodingAgent {
  declare public readonly runtime: 'claude-code';
  static override readonly defaultSyncInclude = DEFAULT_CODING_AGENT_SYNC_INCLUDES['claude-code'];
  static override fromDict(data: AgentHydrationData): ClaudeCodeAgent {
    return new ClaudeCodeAgent(agentStateFromDict(data));
  }
}

export class GooseAgent extends CodingAgent {
  declare public readonly runtime: 'goose';
  static override readonly defaultSyncInclude = DEFAULT_CODING_AGENT_SYNC_INCLUDES.goose;
  static override fromDict(data: AgentHydrationData): GooseAgent {
    return new GooseAgent(agentStateFromDict(data));
  }
}

export class KimiCodeAgent extends CodingAgent {
  declare public readonly runtime: 'kimi-code';
  static override readonly defaultSyncInclude = DEFAULT_CODING_AGENT_SYNC_INCLUDES['kimi-code'];
  static override fromDict(data: AgentHydrationData): KimiCodeAgent {
    return new KimiCodeAgent(agentStateFromDict(data));
  }
}

const CODING_AGENT_CLASSES = {
  'buzz-agent': BuzzAgent,
  opencode: OpenCodeAgent,
  codex: CodexAgent,
  'claude-code': ClaudeCodeAgent,
  goose: GooseAgent,
  'kimi-code': KimiCodeAgent,
} as const;

export class HermesAgent extends Agent {
  declare public readonly runtime: 'hermes-agent';
  public readonly apiUrl: string | null;
  public readonly openaiBaseUrl: string | null;
  /** Available only on the instance returned by createHermesAgent/startHermesAgent. */
  public apiServerKey: string | null;

  constructor(fields: AgentStateFields & { apiUrl?: string | null; apiServerKey?: string | null }) {
    super(fields);
    this.apiUrl = fields.apiUrl ?? this.routeUrl('hermes', '');
    this.openaiBaseUrl = this.apiUrl ? `${this.apiUrl.replace(/\/+$/, '')}/v1` : null;
    this.apiServerKey = fields.apiServerKey ?? null;
  }

  static override fromDict(data: AgentHydrationData): HermesAgent {
    const fields = agentStateFromDict(data);
    if (fields.launchConfig?.env && typeof fields.launchConfig.env === 'object') {
      fields.launchConfig = structuredClone(fields.launchConfig);
      delete fields.launchConfig.env.API_SERVER_KEY;
    }
    return new HermesAgent({
      ...fields,
      // Never recover API_SERVER_KEY from launch_config or process env.
      apiServerKey: null,
    });
  }

  /** Create a client for this agent's authenticated Hermes API. */
  get api(): HermesApiClient | null {
    if (!this.apiUrl || !this.apiServerKey) return null;
    return new HermesApiClient(this.apiUrl, { apiKey: this.apiServerKey });
  }

  /** Require a ready URL and the one-time SDK-retained API server key. */
  apiClient(): HermesApiClient {
    const client = this.api;
    if (!client) {
      throw new Error('Hermes API context is unavailable; use the HermesAgent returned by createHermesAgent/startHermesAgent after its hostname is attached');
    }
    return client;
  }

  override async waitRunning(timeoutMs = 300_000, pollIntervalMs = 5_000): Promise<HermesAgent> {
    const ready = await super.waitRunning(timeoutMs, pollIntervalMs);
    if (!(ready instanceof HermesAgent)) {
      throw new Error("Running deployment did not identify runtime 'hermes-agent'");
    }
    ready.apiServerKey = this.apiServerKey;
    return ready;
  }

  /**
   * Connect to this agent's Hermes session API and return the canonical
   * session client. Waits for the agent to be RUNNING with its route live,
   * then resolves API_SERVER_KEY from the SDK-retained key or the deployment
   * Secret (so a fresh page can reconnect), and verifies reachability plus
   * authorization before resolving.
   */
  async connect(options: AgentSessionConnectOptions = {}): Promise<HermesSessionClient> {
    const deployments = this.requireDeployments();
    const timeoutMs = options.timeoutMs ?? 60_000;
    const deadline = Date.now() + timeoutMs;
    const callerAbortError = (): Error => {
      if (options.signal?.reason instanceof Error) return options.signal.reason;
      const error = new Error('Hermes session connect cancelled');
      error.name = 'AbortError';
      return error;
    };

    let apiUrl = this.apiUrl;
    let current: Agent = this;
    while (true) {
      if (options.signal?.aborted) throw callerAbortError();
      if (current.state.toUpperCase() !== 'RUNNING' || !apiUrl) {
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for Hermes agent ${this.id} to become reachable`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        current = await deployments.get(this.id);
        apiUrl = apiUrl ?? (current instanceof HermesAgent ? current.apiUrl : null);
        continue;
      }
      break;
    }

    let apiServerKey = this.apiServerKey;
    if (!apiServerKey) {
      // Rehydrate the redacted Secret through the explicit per-secret
      // retrieval endpoint; never read launch_config.env for it.
      const secretData = await deployments.secret(this.id, 'API_SERVER_KEY');
      apiServerKey = secretData.value;
      this.apiServerKey = apiServerKey;
    }

    const client = new HermesSessionClient(apiUrl, {
      apiKey: apiServerKey,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    await client.connect(options);
    return client;
  }
}

export class OpenClawAgent extends Agent {
  public gatewayUrl: string | null;
  public gatewayToken: string | null;
  private gatewayLaunchEpoch: number | null = null;

  get gatewayConnectionKey(): string {
    return `${this.id}:${this.gatewayLaunchEpoch ?? this.launchEpoch}:${this.gatewayUrl ?? ''}`;
  }

  get gatewayConnectionScope(): OpenClawGatewayConnectionManager | null {
    return this._deployments?.openClawGateways ?? null;
  }

  constructor(fields: AgentStateFields & { gatewayUrl?: string | null; gatewayToken?: string | null }) {
    super(fields);
    this.gatewayUrl = fields.gatewayUrl ?? null;
    this.gatewayToken = fields.gatewayToken ?? null;
  }

  static override fromDict(data: AgentHydrationData): OpenClawAgent {
    return new OpenClawAgent({
      ...agentStateFromDict(data),
      gatewayUrl: this.gatewayUrlFromHostname(data.hostname),
      gatewayToken: null,
    });
  }

  protected static gatewayUrlFromHostname(hostname: string | null | undefined): string | null {
    const trimmed = String(hostname ?? '').trim();
    return trimmed ? `wss://${trimmed}` : null;
  }

  protected static gatewayUrlFromRouteStatus(status: Record<string, unknown> | undefined): string | null {
    if (String(status?.dns_state ?? '').trim().toLowerCase() !== 'active') return null;
    const rawUrl = String(status?.url ?? '').trim();
    if (!rawUrl) return null;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new OpenClawRouteContractError('OpenClaw route status contains an invalid URL');
    }
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase());
    if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
    else if (parsed.protocol === 'http:' && loopback) parsed.protocol = 'ws:';
    else if (parsed.protocol !== 'wss:' && !(parsed.protocol === 'ws:' && loopback)) {
      throw new OpenClawRouteContractError('OpenClaw route status must use HTTPS or WSS');
    }
    const expectedHostname = String(status?.hostname ?? '').trim().toLowerCase().replace(/\.$/, '');
    const actualHostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (
      !actualHostname
      || (expectedHostname && actualHostname !== expectedHostname)
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) {
      throw new OpenClawRouteContractError('OpenClaw route status contains an invalid public URL');
    }
    return parsed.toString().replace(/\/$/, '');
  }

  /** Resolve OpenClaw connection context while retaining caller-known credentials. */
  async waitForGatewayContext(options: GatewayContextWaitOptions = {}): Promise<AgentGatewayContext> {
    const callerAbortError = (): Error => {
      if (options.signal?.reason instanceof Error) return options.signal.reason;
      const error = new Error('OpenClaw gateway context wait cancelled');
      error.name = 'AbortError';
      return error;
    };
    if (options.signal?.aborted) throw callerAbortError();
    const timeoutMs = options.timeoutMs ?? 30_000;
    const retryIntervalMs = options.retryIntervalMs ?? 1_000;
    const deployments = this.requireDeployments();
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;
    const timeoutError = (): Error => {
      return lastError instanceof Error
        ? lastError
        : new Error('Timed out waiting for OpenClaw gateway context');
    };
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(callerAbortError());
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
    const timeoutId = setTimeout(() => controller.abort(timeoutError()), Math.max(0, timeoutMs));
    const waitAbortError = (): Error => {
      return controller.signal.reason instanceof Error ? controller.signal.reason : callerAbortError();
    };
    const runWithAbort = <T>(operation: Promise<T>): Promise<T> => {
      if (controller.signal.aborted) return Promise.reject(waitAbortError());
      return new Promise<T>((resolve, reject) => {
        const abortOperation = () => {
          cleanup();
          reject(waitAbortError());
        };
        const cleanup = () => controller.signal.removeEventListener('abort', abortOperation);
        controller.signal.addEventListener('abort', abortOperation, { once: true });
        operation.then(
          (value) => {
            cleanup();
            resolve(value);
          },
          (error) => {
            cleanup();
            reject(error);
          },
        );
      });
    };
    const waitForRetry = (delayMs: number): Promise<void> => {
      if (controller.signal.aborted) return Promise.reject(waitAbortError());
      return new Promise<void>((resolve, reject) => {
        const finish = () => {
          controller.signal.removeEventListener('abort', abortWait);
          resolve();
        };
        const timer = setTimeout(finish, delayMs);
        const abortWait = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', abortWait);
          reject(waitAbortError());
        };
        controller.signal.addEventListener('abort', abortWait, { once: true });
      });
    };

    try {
      while (true) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw timeoutError();
        const requestOptions: RequestOverrides = {
          signal: controller.signal,
          timeout: Math.max(1, remainingMs),
        };
        let refreshed: Agent;
        let resolvedGatewayUrl: string | null = null;
        let resolvedFromRouteStatus = false;
        try {
          refreshed = await runWithAbort(deployments.get(this.id, requestOptions));
          if (refreshed.launchEpoch < this.launchEpoch) {
            throw new Error('gateway Agent belongs to an older launch epoch');
          }
          const refreshedState = refreshed.state.toUpperCase();
          if (refreshedState !== 'RUNNING') {
            const message = `gateway Agent is ${refreshed.state}, not RUNNING`;
            if (OPENCLAW_GATEWAY_TERMINAL_STATES.has(refreshedState)) {
              throw new OpenClawLifecycleTerminalError(message);
            }
            throw new Error(message);
          }
          const routeState = await runWithAbort(deployments.getRoutes(this.id, requestOptions));
          const routeStatus = routeState.routeStatuses.openclaw;
          resolvedGatewayUrl = OpenClawAgent.gatewayUrlFromRouteStatus(routeStatus);
          if (!resolvedGatewayUrl) {
            const dnsState = String(routeStatus?.dns_state ?? 'pending_create').trim() || 'pending_create';
            const lastRouteError = String(routeStatus?.last_error ?? '').trim();
            throw new Error(
              `OpenClaw gateway route is ${dnsState}${lastRouteError ? `: ${lastRouteError}` : ''}`,
            );
          }
          resolvedFromRouteStatus = true;
        } catch (error) {
          if (
            error instanceof OpenClawRouteContractError
            || error instanceof OpenClawLifecycleTerminalError
          ) throw error;
          if (error instanceof APIError && [401, 403, 404].includes(error.statusCode)) {
            throw error;
          }
          lastError = error;
          const remainingAfterRequestMs = deadline - Date.now();
          if (remainingAfterRequestMs <= 0) throw timeoutError();
          const retryDelayMs = Math.min(Math.max(0, retryIntervalMs), remainingAfterRequestMs);
          await waitForRetry(retryDelayMs);
          continue;
        }

        // Prefer the caller-retained token; otherwise rehydrate the redacted
        // Secret through the explicit per-secret retrieval endpoint so a fresh
        // page (or fresh Agent hydration) can still reconnect.
        let gatewayToken = this.gatewayToken;
        if (!gatewayToken) {
          try {
            const secretData = await runWithAbort(
              deployments.secret(this.id, 'OPENCLAW_GATEWAY_TOKEN', requestOptions),
            );
            if (Number(secretData.launch_epoch ?? 0) < refreshed.launchEpoch) {
              throw new Error('gateway Secret belongs to an older launch epoch');
            }
            gatewayToken = String(secretData.value ?? '').trim() || null;
          } catch (error) {
            if (error instanceof APIError && [401, 403, 404].includes(error.statusCode)) {
              throw new Error(
                'OpenClaw gateway token is unavailable; retain the object returned by createOpenClaw or pass gatewayToken explicitly',
              );
            }
            throw error;
          }
          if (!gatewayToken) {
            throw new Error('OpenClaw gateway token secret is empty');
          }
        }
        const confirmed = await runWithAbort(deployments.get(this.id, requestOptions));
        if (
          confirmed.launchEpoch !== refreshed.launchEpoch
          || confirmed.state.toUpperCase() !== 'RUNNING'
        ) {
          throw new Error('gateway Agent changed while its Secret was resolved');
        }
        let gatewayUrl: string | null = null;
        if (resolvedFromRouteStatus) {
          const confirmedRoutes = await runWithAbort(deployments.getRoutes(this.id, requestOptions));
          const confirmedRouteUrl = OpenClawAgent.gatewayUrlFromRouteStatus(
            confirmedRoutes.routeStatuses.openclaw,
          );
          if (!confirmedRouteUrl || confirmedRouteUrl !== resolvedGatewayUrl) {
            throw new Error('OpenClaw gateway route changed while its Secret was resolved');
          }
          gatewayUrl = confirmedRouteUrl;
        }
        gatewayUrl ??= confirmed instanceof OpenClawAgent
          ? confirmed.gatewayUrl
          : OpenClawAgent.gatewayUrlFromHostname(confirmed.hostname);
        if (!gatewayUrl) throw new Error('OpenClaw gateway route disappeared during Secret resolution');
        this.gatewayUrl = gatewayUrl;
        this.gatewayToken = gatewayToken;
        this.gatewayLaunchEpoch = refreshed.launchEpoch;
        return {
          agent_id: this.id,
          gateway_url: gatewayUrl,
          gateway_token: gatewayToken,
          launch_epoch: refreshed.launchEpoch,
        };
      }
    } finally {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  gateway(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): GatewayClient {
    if (!this.gatewayUrl) {
      throw new Error('Agent has no OpenClaw gateway URL');
    }
    return new GatewayClient(this.gatewayOptions(this.gatewayUrl, this.gatewayToken, options));
  }

  async acquireGateway(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
    contextOptions: GatewayContextWaitOptions = {},
  ): Promise<OpenClawGatewayLease> {
    const deployments = this.requireDeployments();
    const generation = deployments.openClawGateways.generation(this.id);
    const knownLaunchEpoch = this.gatewayLaunchEpoch ?? this.launchEpoch;
    if (this.gatewayUrl && knownLaunchEpoch > 0) {
      const existing = deployments.openClawGateways.acquireExisting({
        deploymentId: this.id,
        launchEpoch: knownLaunchEpoch,
        generation,
        options: this.gatewayOptions(this.gatewayUrl, this.gatewayToken, options),
      });
      if (existing) return existing;
    }

    const context = await deployments.resolveOpenClawGatewayContext(this, contextOptions);
    this.gatewayUrl = context.gateway_url;
    this.gatewayToken = context.gateway_token;
    this.gatewayLaunchEpoch = context.launch_epoch;
    return deployments.openClawGateways.acquire({
      deploymentId: this.id,
      launchEpoch: context.launch_epoch,
      generation,
      options: this.gatewayOptions(context.gateway_url, context.gateway_token, options),
    });
  }

  /** Acquire the deployment-scoped gateway and wait for its authenticated hello. */
  async acquireConnectedGateway(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
    contextOptions: GatewayContextWaitOptions = {},
  ): Promise<OpenClawGatewayLease> {
    const deployments = this.requireDeployments();
    const generation = deployments.openClawGateways.generation(this.id);
    const lease = await this.acquireGateway(options, contextOptions);
    try {
      await lease.client.connect({
        signal: contextOptions.signal,
      });
      if (deployments.openClawGateways.generation(this.id) !== generation) {
        throw new Error(`OpenClaw gateway connection for ${this.id} was invalidated`);
      }
      return lease;
    } catch (error) {
      lease.release({ retain: false });
      throw error;
    }
  }

  invalidateGatewayConnection(): void {
    this.requireDeployments().invalidateOpenClawGateway(this.id);
    this.gatewayToken = null;
    this.gatewayLaunchEpoch = null;
  }

  private gatewayOptions(
    gatewayUrl: string,
    gatewayToken: string | null,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'>,
  ): GatewayOptions {
    const deployments = this.requireDeployments();
    return {
      ...options,
      url: gatewayUrl,
      token: undefined,
      gatewayToken: options.gatewayToken ?? gatewayToken ?? undefined,
      deploymentId: options.deploymentId ?? this.id,
      apiKey: options.apiKey ?? deployments.agentApiKey,
      apiBase: options.apiBase ?? deployments.agentApiBase,
      autoApprovePairing: options.autoApprovePairing ?? true,
    };
  }

  async connect(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<GatewayClient> {
    if (!this.gatewayUrl || (!this.gatewayToken && !options.gatewayToken)) {
      await this.waitForGatewayContext();
    }
    const client = this.gateway(options);
    await client.connect();
    return client;
  }

  /** Connect and return the canonical runtime-neutral session client view. */
  async connectSession(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<OpenClawSessionClient> {
    return new OpenClawSessionClient(await this.connect(options));
  }

  /** Run one operation against the deployment-scoped managed gateway. */
  private async withGateway<T>(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'>,
    fn: (client: GatewayClient) => Promise<T>,
    contextOptions: GatewayContextWaitOptions = {},
  ): Promise<T> {
    const lease = await this.acquireConnectedGateway(options, contextOptions);
    try {
      return await fn(lease.client);
    } finally {
      lease.release();
    }
  }

  async gatewayStatus(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<Record<string, any>> {
    return this.withGateway(options, (client) => client.status());
  }

  async waitReady(
    timeoutMs = 300_000,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & GatewayWaitReadyOptions = {},
  ): Promise<Record<string, any>> {
    return this.withGateway(options, (client) => (
      client.waitReady(timeoutMs, {
        retryIntervalMs: options.retryIntervalMs,
        probe: options.probe,
      })
    ), { timeoutMs: options.timeout });
  }

  async configGet(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<Record<string, any>> {
    return this.withGateway(options, (client) => client.configGet());
  }

  async configSchema(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<OpenClawConfigSchemaResponse> {
    return this.withGateway(options, (client) => client.configSchema());
  }

  async configPatch(
    patch: Record<string, any>,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<void> {
    await this.withGateway(options, (client) => client.configPatch(patch));
  }

  async configureSlackRelay(
    options: (Omit<OpenClawSlackRelayOptions, 'gatewayId'> & { gatewayId?: string }) | OpenClawSlackRelayConfiguration,
    gatewayOptions: Omit<Partial<GatewayOptions>, 'url' | 'token'> & { accountId?: string } = {},
  ): Promise<void> {
    const { accountId, ...connectOptions } = gatewayOptions;
    await this.withGateway(connectOptions, async (client) => {
      if ('relay' in options) {
        await client.configureSlackRelay(options, accountId);
      } else {
        await client.configureSlackRelay({
          ...options,
          gatewayId: options.gatewayId ?? this.gatewayId ?? `agent:${this.id}`,
        });
      }
    });
  }

  async configureSlackSocket(
    config: OpenClawSlackSocketConfiguration,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & { accountId?: string } = {},
  ): Promise<void> {
    const { accountId, ...gatewayOptions } = options;
    await this.withGateway(gatewayOptions, (client) => client.configureSlackSocket(config, accountId));
  }

  async configureSlackHttp(
    config: OpenClawSlackHttpConfiguration,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & { accountId?: string } = {},
  ): Promise<void> {
    const { accountId, ...gatewayOptions } = options;
    await this.withGateway(gatewayOptions, (client) => client.configureSlackHttp(config, accountId));
  }

  async configureTelegram(
    config: OpenClawTelegramConfigPatch,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & { accountId?: string } = {},
  ): Promise<void> {
    const { accountId, ...gatewayOptions } = options;
    await this.withGateway(gatewayOptions, (client) => client.configureTelegram(config, accountId));
  }

  async configureWhatsapp(
    config: OpenClawWhatsAppConfigPatch,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & { accountId?: string } = {},
  ): Promise<void> {
    const { accountId, ...gatewayOptions } = options;
    await this.withGateway(gatewayOptions, (client) => client.configureWhatsapp(config, accountId));
  }

  async configApply(
    config: Record<string, any>,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<void> {
    await this.withGateway(options, (client) => client.configApply(config));
  }

  async modelsList(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<any[]> {
    return this.withGateway(options, (client) => client.modelsList());
  }

  async sessionsList(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<any[]> {
    return this.withGateway(options, (client) => client.sessionsList());
  }

  async sessionsListResult(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<GatewaySessionsListResult> {
    return this.withGateway(options, (client) => client.sessionsListResult());
  }

  async operationsSnapshot(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<OpenClawOperationsSnapshot> {
    return this.withGateway(options, async (client) => {
      const [sessionsResult, cronResult] = await Promise.allSettled([
        client.sessionsListResult(),
        client.cronList(),
      ] as const);
      const failures: OpenClawOperationsSnapshot['failures'] = {};
      if (sessionsResult.status === 'rejected') {
        failures.sessions = stringifyOpenClawOperationsFailure(sessionsResult.reason);
      }
      if (cronResult.status === 'rejected') {
        failures.cron = stringifyOpenClawOperationsFailure(cronResult.reason);
      }
      return {
        sessions: sessionsResult.status === 'fulfilled' ? sessionsResult.value : null,
        cronJobs: cronResult.status === 'fulfilled' ? cronResult.value : null,
        failures,
        capturedAt: Date.now(),
      };
    }, { timeoutMs: options.timeout });
  }

  async *chatSend(
    message: string,
    sessionKey: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      attachments?: ChatAttachment[];
    } = {},
  ): AsyncGenerator<ChatEvent> {
    const lease = await this.acquireConnectedGateway(options);
    try {
      for await (const event of lease.client.chatSend(message, sessionKey, options.attachments)) {
        yield event;
      }
    } finally {
      lease.release();
    }
  }

  async channelsStatus(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      probe?: boolean;
      timeoutMs?: number;
      channel?: string;
    } = {},
  ): Promise<Record<string, any>> {
    return this.withGateway(options, (client) => (
      client.channelsStatus(options.probe ?? false, options.timeoutMs, options.channel)
    ));
  }

  async channelsStart(
    channel: string,
    accountId?: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<Record<string, any>> {
    return this.withGateway(options, (client) => client.channelsStart(channel, accountId));
  }

  async channelsStop(
    channel: string,
    accountId?: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<Record<string, any>> {
    return this.withGateway(options, (client) => client.channelsStop(channel, accountId));
  }

  async channelsLogout(
    channel: string,
    accountId?: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<Record<string, any>> {
    return this.withGateway(options, (client) => client.channelsLogout(channel, accountId));
  }

  async webLoginStart(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & GatewayWebLoginStartOptions = {},
  ): Promise<GatewayWebLoginStartResult> {
    return this.withGateway(options, (client) => (
      client.webLoginStart({
        force: options.force,
        timeoutMs: options.timeoutMs,
        verbose: options.verbose,
        accountId: options.accountId,
      })
    ));
  }

  async webLoginWait(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & GatewayWebLoginWaitOptions = {},
  ): Promise<GatewayWebLoginWaitResult> {
    return this.withGateway(options, (client) => (
      client.webLoginWait({
        timeoutMs: options.timeoutMs,
        accountId: options.accountId,
        currentQrDataUrl: options.currentQrDataUrl,
      })
    ));
  }

  async integrationsAuthStart(
    params: GatewayIntegrationAuthStartParams,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<GatewayIntegrationAuthStartResult> {
    return this.withGateway(options, (client) => client.integrationsAuthStart(params));
  }

  async integrationsAuthStatus(
    params: GatewayIntegrationAuthStatusParams,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<GatewayIntegrationAuthStatusResult> {
    return this.withGateway(options, (client) => client.integrationsAuthStatus(params));
  }

  async integrationsStatus(
    params: GatewayIntegrationStatusParams = {},
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<GatewayIntegrationStatusResult> {
    return this.withGateway(options, (client) => client.integrationsStatus(params));
  }

  async integrationsDisconnect(
    params: GatewayIntegrationDisconnectParams,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<GatewayIntegrationDisconnectResult> {
    return this.withGateway(options, (client) => client.integrationsDisconnect(params));
  }

  async workspaceFiles(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<{ agentId: string; files: any[] }> {
    return this.withGateway(options, async (client) => {
      const agents = await client.agentsList();
      const agentId = agents[0]?.id ?? 'main';
      const files = await client.filesList(agentId);
      return { agentId, files };
    });
  }

  async fileGet(
    name: string,
    agentId?: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<string> {
    return this.withGateway(options, async (client) => {
      let resolvedAgentId: string;
      if (agentId) {
        resolvedAgentId = agentId;
      } else {
        const agents = await client.agentsList();
        resolvedAgentId = agents[0]?.id ?? 'main';
      }
      return await client.fileGet(resolvedAgentId, name);
    });
  }

  async fileSet(
    name: string,
    content: string,
    agentId?: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<void> {
    await this.withGateway(options, async (client) => {
      let resolvedAgentId: string;
      if (agentId) {
        resolvedAgentId = agentId;
      } else {
        const agents = await client.agentsList();
        resolvedAgentId = agents[0]?.id ?? 'main';
      }
      await client.fileSet(resolvedAgentId, name, content);
    });
  }

  async chatHistory(
    sessionKey?: string,
    limit = 50,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<any[]> {
    return this.withGateway(options, (client) => client.chatHistory(sessionKey, limit));
  }

  async chatSendMessage(
    message: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & {
      sessionKey?: string;
      agentId?: string;
      attachments?: ChatAttachment[];
    } = {},
  ): Promise<any> {
    return this.withGateway(options, (client) => (
      client.sendChat(
        message,
        options.sessionKey,
        options.agentId,
        options.attachments,
      )
    ));
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
    return this.withGateway(options, (client) => client.cronList());
  }

  async cronAdd(
    job: Record<string, any>,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<any> {
    return this.withGateway(options, (client) => client.cronAdd(job));
  }

  async cronRemove(
    jobId: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<void> {
    await this.withGateway(options, (client) => client.cronRemove(jobId));
  }

  async cronRun(
    jobId: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<any> {
    return this.withGateway(options, (client) => client.cronRun(jobId));
  }
}

export class OpenClawProAgent extends OpenClawAgent {
  static override fromDict(data: AgentHydrationData): OpenClawProAgent {
    return new OpenClawProAgent({
      ...agentStateFromDict(data),
      gatewayUrl: this.gatewayUrlFromHostname(data.hostname),
      gatewayToken: null,
    });
  }
}

export class Deployments {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly agentsWsUrl: string;
  private readonly agentHttp: Pick<HTTPClient, 'get' | 'post' | 'postRaw' | 'put' | 'patch' | 'delete'>;
  public readonly openClawGateways: OpenClawGatewayConnectionManager;
  private readonly openClawGatewayContextFlights = new Map<string, OpenClawGatewayContextFlight>();

  constructor(
    private readonly http: HTTPClient,
    agentApiKey?: string,
    agentApiBase?: string,
    agentsWsUrl?: string,
    requestTimeout?: number,
    openClawGatewayOptions: OpenClawGatewayConnectionManagerOptions = {},
  ) {
    this.apiKey = agentApiKey || (http as any).apiKey;
    this.apiBase = resolveAgentsApiBase(agentApiBase || getAgentsApiBaseUrl());
    this.agentsWsUrl = normalizeAgentsWsUrl(agentsWsUrl || getConfigValue('AGENTS_WS_URL') || defaultAgentsWsUrl(this.apiBase));
    const agentTimeout = requestTimeout ?? (http instanceof HTTPClient ? (http as any).timeout : undefined);
    this.agentHttp = http instanceof HTTPClient ? new HTTPClient(this.apiBase, this.apiKey, agentTimeout) : http;
    this.openClawGateways = new OpenClawGatewayConnectionManager(openClawGatewayOptions);
  }

  dispose(): void {
    for (const flight of this.openClawGatewayContextFlights.values()) {
      flight.controller.abort(new Error('Agent deployments client disposed'));
    }
    this.openClawGatewayContextFlights.clear();
    this.openClawGateways.dispose();
  }

  async resolveOpenClawGatewayContext(
    agent: OpenClawAgent,
    options: GatewayContextWaitOptions = {},
  ): Promise<AgentGatewayContext> {
    if (options.signal?.aborted) {
      if (options.signal.reason instanceof Error) throw options.signal.reason;
      const error = new Error('OpenClaw gateway context wait cancelled');
      error.name = 'AbortError';
      throw error;
    }
    const generation = this.openClawGateways.generation(agent.id);
    const key = `${agent.id}:${generation}:${agent.launchEpoch}`;
    let flight = this.openClawGatewayContextFlights.get(key);
    if (!flight) {
      const controller = new AbortController();
      flight = {
        deploymentId: agent.id,
        controller,
        promise: agent.waitForGatewayContext({
          timeoutMs: OPENCLAW_GATEWAY_CONTEXT_FLIGHT_TIMEOUT_MS,
          retryIntervalMs: OPENCLAW_GATEWAY_CONTEXT_FLIGHT_RETRY_INTERVAL_MS,
          signal: controller.signal,
        }),
        waiters: 0,
        settled: false,
      };
      this.openClawGatewayContextFlights.set(key, flight);
      const settledFlight = flight;
      flight.promise.then(
        () => {
          settledFlight.settled = true;
          if (this.openClawGatewayContextFlights.get(key) === settledFlight) {
            this.openClawGatewayContextFlights.delete(key);
          }
        },
        () => {
          settledFlight.settled = true;
          if (this.openClawGatewayContextFlights.get(key) === settledFlight) {
            this.openClawGatewayContextFlights.delete(key);
          }
        },
      );
    }

    flight.waiters += 1;
    const timeoutMs = options.timeoutMs ?? 30_000;
    try {
      return await new Promise<AgentGatewayContext>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', abort);
          callback();
        };
        const abort = () => finish(() => {
          if (options.signal?.reason instanceof Error) reject(options.signal.reason);
          else {
            const error = new Error('OpenClaw gateway context wait cancelled');
            error.name = 'AbortError';
            reject(error);
          }
        });
        const timer = setTimeout(() => {
          finish(() => reject(new Error('Timed out waiting for OpenClaw gateway context')));
        }, Math.max(0, timeoutMs));
        options.signal?.addEventListener('abort', abort, { once: true });
        flight?.promise.then(
          (context) => finish(() => resolve(context)),
          (error) => finish(() => reject(error)),
        );
      });
    } finally {
      flight.waiters = Math.max(0, flight.waiters - 1);
      if (flight.waiters === 0 && !flight.settled) {
        if (this.openClawGatewayContextFlights.get(key) === flight) {
          this.openClawGatewayContextFlights.delete(key);
        }
        flight.controller.abort(new Error('OpenClaw gateway context has no waiters'));
      }
    }
  }

  invalidateOpenClawGateway(agentId: string): void {
    for (const [key, flight] of this.openClawGatewayContextFlights) {
      if (flight.deploymentId !== agentId) continue;
      flight.controller.abort(new Error(`OpenClaw gateway context for ${agentId} was invalidated`));
      this.openClawGatewayContextFlights.delete(key);
    }
    this.openClawGateways.invalidate(agentId);
  }

  get agentApiKey(): string {
    return this.apiKey;
  }

  get agentApiBase(): string {
    return this.apiBase;
  }

  private hydrateAgent(data: AgentHydrationData): Agent {
    let agent: Agent;
    if (data.runtime === 'hermes-agent') {
      agent = HermesAgent.fromDict(data);
    } else if (data.runtime === 'buzz-agent') {
      agent = BuzzAgent.fromDict(data);
    } else if (data.runtime === 'opencode') {
      agent = OpenCodeAgent.fromDict(data);
    } else if (data.runtime === 'codex') {
      agent = CodexAgent.fromDict(data);
    } else if (data.runtime === 'claude-code') {
      agent = ClaudeCodeAgent.fromDict(data);
    } else if (data.runtime === 'goose') {
      agent = GooseAgent.fromDict(data);
    } else if (data.runtime === 'kimi-code') {
      agent = KimiCodeAgent.fromDict(data);
    } else if (data.runtime === 'openclaw-pro' || isOpenClawProHydrationData(data)) {
      agent = OpenClawProAgent.fromDict(data);
    } else if (isOpenClawHydrationData(data)) {
      agent = OpenClawAgent.fromDict(data);
    } else {
      agent = Agent.fromDict(data);
    }
    return bindAgent(agent, this);
  }

  private async getById(agentId: string, requestOptions: RequestOverrides = {}): Promise<Agent> {
    const path = `${DEPLOYMENTS_API_PREFIX}/${agentId}`;
    const data = Object.keys(requestOptions).length === 0
      ? await this.agentHttp.get<AgentHydrationData>(path)
      : await this.agentHttp.get<AgentHydrationData>(path, undefined, requestOptions);
    return this.hydrateAgent(data);
  }

  async resolveAgent(agentIdOrName: string, requestOptions: RequestOverrides = {}): Promise<Agent> {
    const raw = String(agentIdOrName || '').trim();
    if (!raw) {
      throw new Error('agentIdOrName is required');
    }
    if (isUuidRef(raw)) {
      return this.getById(raw, requestOptions);
    }

    const matches: Agent[] = [];
    for (const agent of await this.list(requestOptions)) {
      const values = [agent.id, agent.name, agent.handle, agent.hostname];
      if (values.some((value) => String(value || '') === raw)) {
        matches.push(agent);
        continue;
      }
      if (values.some((value) => String(value || '').startsWith(raw))) {
        matches.push(agent);
      }
    }

    if (matches.length === 0) {
      throw new Error(`Agent not found: ${raw}`);
    }
    if (matches.length > 1) {
      throw new Error(`Agent reference is ambiguous: ${raw} (${matches.slice(0, 5).map((agent) => agent.id).join(', ')})`);
    }
    return this.getById(matches[0].id, requestOptions);
  }

  async resolveAgentId(
    agentIdOrName: string,
    requestOptions: RequestOverrides = {},
  ): Promise<string> {
    const raw = String(agentIdOrName || '').trim();
    if (!raw) {
      throw new Error('agentIdOrName is required');
    }
    if (isSelfAgentRef(raw)) {
      // An Agent introspects itself; it does not start, stop, or edit its own
      // routes. Status is the only self operation, and it is served directly
      // by GET /deployments/self -- nothing resolves a self reference to an id
      // any more.
      throw new Error('self is only supported for status');
    }
    if (isDirectAgentIdRef(raw)) {
      return raw;
    }
    return (await this.resolveAgent(raw, requestOptions)).id;
  }

  private async agentIdFor(target: Agent | string): Promise<string> {
    return typeof target === 'string' ? this.resolveAgentId(target) : target.id;
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

  private async reefFileAccess(agentId: string): Promise<{ url: string; token: string }> {
    const payload = await this.agentHttp.post<AgentFileTokenResponse>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/files/token`,
    );
    const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
    const expiresAt = typeof payload?.expires_at === 'string' ? payload.expires_at.trim() : '';
    let url: URL;
    try {
      url = new URL(typeof payload?.url === 'string' ? payload.url : '');
    } catch {
      throw new Error('Backend returned an invalid Agent file token response');
    }
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/_reef' ||
      !token ||
      !expiresAt
    ) {
      throw new Error('Backend returned an invalid Agent file token response');
    }
    return { url: url.toString().replace(/\/+$/, ''), token };
  }

  private async fetchReef(
    access: { url: string; token: string },
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    headers.set('Authorization', `Bearer ${access.token}`);
    const response = await fetch(`${access.url}${path}`, {
      ...init,
      headers,
      redirect: 'error',
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
    const config = buildAgentCreateConfig(options.config ?? {}, options);
    const body: Record<string, any> = { ...config };
    if (options.dryRun) body.dry_run = true;
    if (options.name) body.name = options.name;
    if (options.handle !== undefined) body.handle = options.handle;
    if (options.size) body.size = options.size;
    if (options.meta?.ui) body.meta = { ui: structuredClone(options.meta.ui) };
    if (options.tags?.length) body.tags = [...options.tags];
    if (options.runtime) body.runtime = options.runtime;

    const data = await this.agentHttp.post<AgentHydrationData>(
      DEPLOYMENTS_API_PREFIX,
      body,
      { retries: 1 },
    );
    return this.hydrateAgent(data);
  }

  /**
   * Create a hosted OpenClaw Agent.
   *
   * With `slack` enabled the call also owns the hosted Slack launch env. The
   * gateway id is `agent:<agent id>` and the Backend assigns that id at create
   * time, so the complete set is written in a launch-config patch immediately
   * after the record exists (and after it leaves CREATING, which rejects launch
   * updates). The Agent is not started by create, so nothing boots on the
   * incomplete env in between; the returned Agent carries the complete set.
   */
  async createOpenClaw(options: OpenClawCreateAgentOptions = {}): Promise<Agent> {
    const prepared = prepareOpenClawLaunch(options, true, this.agentApiBase);
    const effectiveOptions: CreateAgentOptions = {
      ...options,
      runtime: options.runtime ?? 'openclaw',
      config: prepared.config,
      secrets: prepared.secrets,
    };
    delete (effectiveOptions as { slack?: unknown }).slack;
    effectiveOptions.env = {
      ...buildOpenClawWorkspacesSyncEnv(options.workspacesSync ?? null),
      ...buildOpenClawMemoryIndexEnv(options.memoryIndex),
      ...prepared.env,
    };
    effectiveOptions.routes = options.routes === undefined
      ? buildOpenClawRoutes(options.openClawRoutes ?? {})
      : withOpenClawGatewayRoute(options.routes);
    effectiveOptions.image = defaultOpenClawImage(options.image);
    if (effectiveOptions.syncRoot === undefined) effectiveOptions.syncRoot = DEFAULT_OPENCLAW_SYNC_ROOT;
    if (options.syncInclude === undefined && options.syncExclude === undefined) {
      effectiveOptions.syncExclude = DEFAULT_OPENCLAW_SYNC_EXCLUDE;
    }
    const agent = await this.create(effectiveOptions);
    if (agent instanceof OpenClawAgent) agent.gatewayToken = prepared.gatewayToken;
    if (!prepared.slack.enabled || prepared.slack.gatewayId || !prepared.slack.relayBaseUrl) return agent;
    return this.applyHostedSlackLaunchConfig(agent, prepared.slack.relayBaseUrl, prepared.gatewayToken);
  }

  /**
   * Write the complete hosted Slack launch env onto a freshly created Agent.
   *
   * The gateway id comes from the Agent projection when the endpoint carries
   * one, and otherwise from the Backend's own derivation for that Agent id
   * (`gateway_id_for_agent`, `agent:<id>`); the deployments projection does not
   * currently include `gateway_id`.
   */
  private async applyHostedSlackLaunchConfig(
    agent: Agent,
    relayBaseUrl: string,
    gatewayToken: string | null,
  ): Promise<Agent> {
    // Launch updates are rejected while the Agent is CREATING.
    const ready = agent.state === 'STOPPED'
      ? agent
      : await this.waitForState(
        agent.id,
        ['STOPPED'],
        AGENT_HOSTED_SLACK_PATCH_TIMEOUT_MS,
        ['FAILED', 'DELETED'],
        agent.launchEpoch > 0 ? agent.launchEpoch : undefined,
      );
    const gatewayId = ready.gatewayId?.trim()
      || agent.gatewayId?.trim()
      || HostedSlackLaunchEnv.gatewayIdForAgent(ready.id || agent.id);
    const launchConfig: Record<string, any> = { ...(ready.launchConfig ?? {}) };
    launchConfig.env = {
      ...(isPlainRecord(launchConfig.env) ? launchConfig.env : {}),
      ...HostedSlackLaunchEnv.build({ relayBaseUrl, gatewayId }),
    };
    launchConfig.config = withHostedSlackRelayChannelConfig(launchConfig.config, { relayBaseUrl, gatewayId });
    const updated = await this.update(ready.id, { launchConfig });
    const storedEnv: Record<string, string | undefined> = isPlainRecord(updated.launchConfig?.env)
      ? updated.launchConfig.env as Record<string, string | undefined>
      : {};
    HostedSlackLaunchEnv.assertComplete(storedEnv, 'createOpenClaw stored launch env');
    const missing = HOSTED_SLACK_LAUNCH_ENV_KEYS.filter((key) => !String(storedEnv[key] ?? '').trim());
    if (missing.length) {
      throw new Error(
        `Agent ${updated.id} did not store the hosted Slack launch env (missing ${missing.join(', ')})`,
      );
    }
    if (updated instanceof OpenClawAgent) updated.gatewayToken = gatewayToken;
    return updated;
  }

  async createHermesAgent(options: HermesAgentCreateOptions = {}): Promise<HermesAgent> {
    const apiServerKey = resolveHermesApiServerKey(options.apiServerKey, options.env, options.secrets);
    const env: Record<string, string> = { ...(options.env ?? {}) };
    delete env.API_SERVER_KEY;
    const corsOrigins = [
      ...(env.API_SERVER_CORS_ORIGINS ?? '').split(','),
      ...(options.corsOrigins ?? []),
    ]
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
    if (corsOrigins.length > 0) {
      env.API_SERVER_CORS_ORIGINS = [...new Set(corsOrigins)].join(',');
    }
    const secrets = { ...(options.secrets ?? {}), API_SERVER_KEY: apiServerKey };
    const effectiveOptions: CreateAgentOptions = {
      ...options,
      runtime: 'hermes-agent',
      env,
      secrets,
      // Both layers: the pod env gates origins inside the Hermes API server,
      // the launch-config cors drives the route-plane middleware (which alone
      // can stamp CORS headers on SSE responses).
      cors: options.cors !== undefined
        ? options.cors
        : corsOrigins.length > 0
          ? { allowed_origins: [...new Set(corsOrigins)] }
          : undefined,
      image: defaultHermesAgentImage(options.image),
      runtimeScopes: options.runtimeScopes ?? DEFAULT_AGENT_RUNTIME_SCOPES,
      syncRoot: options.syncRoot ?? DEFAULT_HERMES_AGENT_SYNC_ROOT,
      syncUid: options.syncUid ?? DEFAULT_HERMES_AGENT_SYNC_UID,
      syncGid: options.syncGid ?? DEFAULT_HERMES_AGENT_SYNC_GID,
      routes: options.routes === undefined
        ? buildHermesAgentRoutes(options.hermesRoute ?? {})
        : options.routes,
    };
    const agent = await this.create(effectiveOptions);
    if (!(agent instanceof HermesAgent)) {
      throw new Error("Hermes deployment response did not identify runtime 'hermes-agent'");
    }
    agent.apiServerKey = apiServerKey;
    if (agent.launchConfig?.env && typeof agent.launchConfig.env === 'object') {
      agent.launchConfig = structuredClone(agent.launchConfig);
      delete agent.launchConfig.env.API_SERVER_KEY;
    }
    return agent;
  }

  async createOpenClawPro(options: OpenClawCreateAgentOptions = {}): Promise<Agent> {
    return this.createOpenClaw({
      ...options,
      runtime: 'openclaw-pro',
      env: { OPENCLAW_DESKTOP_ENABLED: '1', ...(options.env ?? {}) },
      image: defaultOpenClawProImage(options.image),
      runtimeScopes: options.runtimeScopes ?? DEFAULT_AGENT_RUNTIME_SCOPES,
      openClawRoutes: { includeDesktop: true, ...(options.openClawRoutes ?? {}) },
    });
  }

  private async createCodingAgent(
    runtime: CodingAgentRuntime,
    options: CodingAgentCreateOptions,
  ): Promise<CodingAgent> {
    if (options.buzzEnabled && options.buzz) {
      throw new Error('buzzEnabled cannot be combined with buzz');
    }
    if ((options.buzzEnabled || options.buzz) && options.command !== undefined && options.command !== null) {
      throw new Error('Buzz launch cannot be combined with an explicit command');
    }
    const buzzLaunch = options.buzzEnabled || options.buzz !== undefined && options.buzz !== null;
    if (buzzLaunch && options.size !== undefined && options.size !== 'large') {
      throw new Error("Buzz coding agents require size='large'");
    }
    const effectiveEnv: Record<string, string> = {
      ...buildOpenClawWorkspacesSyncEnv(options.workspacesSync ?? null),
      ...(options.env ?? {}),
    };
    const effectiveSecrets: Record<string, string> = { ...(options.secrets ?? {}) };
    for (const key of ['BUZZ_PRIVATE_KEY', 'NOSTR_PRIVATE_KEY']) {
      const value = effectiveEnv[key];
      if (value === undefined) continue;
      delete effectiveEnv[key];
      if (effectiveSecrets[key] !== undefined && effectiveSecrets[key] !== value) {
        throw new Error(`${key} conflicts between env and secrets`);
      }
      effectiveSecrets[key] = value;
    }
    if (options.buzz) {
      for (const key of BUZZ_RESERVED_ENV_KEYS) delete effectiveEnv[key];
      Object.assign(
        effectiveEnv,
        buildBuzzLaunchEnv(runtime, options.buzz, options.name),
      );
      Object.assign(effectiveSecrets, buildBuzzLaunchSecrets(options.buzz));
    }
    if (buzzLaunch) {
      effectiveEnv.RUST_LOG ??= DEFAULT_BUZZ_RUST_LOG;
    }
    let syncInclude: readonly string[] | undefined;
    let syncExclude: readonly string[] | undefined;
    if (options.syncInclude !== undefined && options.syncInclude !== null) {
      syncInclude = options.syncInclude;
      syncExclude = undefined;
    } else if (options.syncExclude !== undefined) {
      syncInclude = undefined;
      syncExclude = options.syncExclude ?? undefined;
    } else if (options.syncInclude === null) {
      syncInclude = undefined;
      syncExclude = undefined;
    } else {
      const defaultInclude = CODING_AGENT_CLASSES[runtime].defaultSyncInclude;
      syncInclude = defaultInclude ?? undefined;
      syncExclude = defaultInclude === null ? [] : undefined;
    }
    const effectiveOptions: CreateAgentOptions = {
      ...options,
      runtime,
      size: buzzLaunch ? 'large' : options.size,
      env: effectiveEnv,
      secrets: effectiveSecrets,
      routes: options.routes ?? {},
      image: options.image ?? (
        buzzLaunch
          ? DEFAULT_BUZZ_CODING_AGENT_IMAGES[runtime]
          : DEFAULT_CODING_AGENT_IMAGES[runtime]
      ),
      command: options.buzzEnabled || options.buzz
        ? ['/usr/local/bin/buzz-acp']
        : options.command,
      syncRoot: options.syncRoot ?? DEFAULT_CODING_AGENT_SYNC_ROOT,
      syncInclude,
      syncExclude,
      syncUid: options.syncUid ?? 1000,
      syncGid: options.syncGid ?? 1000,
      // Hosted Buzz shutdown is process-driven; generic launch options cannot
      // opt it back into automatic restart.
      restart: buzzLaunch ? false : options.restart,
      runtimeScopes: options.runtimeScopes ?? DEFAULT_AGENT_RUNTIME_SCOPES,
    };
    return await this.create(effectiveOptions) as CodingAgent;
  }

  async createOpenCode(options: CodingAgentCreateOptions = {}): Promise<OpenCodeAgent> {
    return await this.createCodingAgent('opencode', options) as OpenCodeAgent;
  }

  async createBuzzAgent(options: CodingAgentCreateOptions = {}): Promise<BuzzAgent> {
    return await this.createCodingAgent('buzz-agent', options) as BuzzAgent;
  }

  async createCodex(options: CodingAgentCreateOptions = {}): Promise<CodexAgent> {
    return await this.createCodingAgent('codex', options) as CodexAgent;
  }

  async createClaudeCode(options: CodingAgentCreateOptions = {}): Promise<ClaudeCodeAgent> {
    return await this.createCodingAgent('claude-code', options) as ClaudeCodeAgent;
  }

  async createGoose(options: CodingAgentCreateOptions = {}): Promise<GooseAgent> {
    return await this.createCodingAgent('goose', options) as GooseAgent;
  }

  async createKimiCode(options: CodingAgentCreateOptions = {}): Promise<KimiCodeAgent> {
    return await this.createCodingAgent('kimi-code', options) as KimiCodeAgent;
  }

  async budget(): Promise<Record<string, any>> {
    return this.agentHttp.get(`${DEPLOYMENTS_API_PREFIX}/budget`);
  }

  async bootstrapInference(
    messages: BootstrapInferenceMessage[],
    responseFormat: BootstrapInferenceResponseFormat = { type: 'json_object' },
    requestOptions: RequestOverrides = {},
  ): Promise<BootstrapInferenceResult> {
    return this.agentHttp.post<BootstrapInferenceResult>(
      '/bootstrap',
      {
        messages,
        response_format: responseFormat,
      },
      requestOptions,
    );
  }

  private async oneShotAgentWebSocket(
    agentId: string,
    purpose: 'metrics' | 'exec',
    request?: Record<string, unknown>,
    timeoutMs = 45_000,
  ): Promise<unknown> {
    const rawToken = await this.agentHttp.post<AgentOperationTokenResponse>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/${purpose}/token`,
    );
    const token = validateAgentWsToken(rawToken, agentId, purpose) as AgentOperationTokenResponse;
    const parsed = new URL(token.ws_url);
    parsed.searchParams.set('jwt', token.jwt);
    const WebSocketImpl = globalThis.WebSocket ?? NodeWebSocket;
    let ws: WebSocket;
    try {
      ws = new WebSocketImpl(parsed.toString());
    } catch (error) {
      throw new Error(`Agent ${purpose} WebSocket connection failed`, { cause: error });
    }

    return await new Promise<unknown>((resolve, reject) => {
      let opened = false;
      let settled = false;
      let socketError: Error | undefined;
      let result: unknown;
      let resultCount = 0;
      const timer = setTimeout(() => {
        finish(new Error(`Agent ${purpose} WebSocket timed out`));
        ws.close(1000, 'Client timeout');
      }, timeoutMs);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result);
      };
      ws.onopen = () => {
        opened = true;
        if (request !== undefined) ws.send(JSON.stringify(request));
      };
      ws.onmessage = (event: MessageEvent) => {
        const rejectFrame = (message: string, reason: string) => {
          const error = new Error(message);
          try {
            ws.close(1008, reason);
          } finally {
            finish(error);
          }
        };
        if (typeof event.data !== 'string') {
          rejectFrame(
            `Agent ${purpose} WebSocket returned a non-text result frame`,
            'Invalid result frame',
          );
          return;
        }
        resultCount += 1;
        if (resultCount !== 1) {
          rejectFrame(
            `Agent ${purpose} WebSocket returned more than one result frame`,
            'Too many result frames',
          );
          return;
        }
        try {
          result = JSON.parse(event.data);
        } catch {
          rejectFrame(
            `Agent ${purpose} WebSocket returned invalid JSON`,
            'Invalid result frame',
          );
        }
      };
      ws.onerror = (event: unknown) => {
        const socketEvent = event as unknown as { error?: unknown };
        const error = typeof socketEvent.error === 'object'
          && socketEvent.error instanceof Error
          ? socketEvent.error
          : undefined;
        socketError = new Error(`Agent ${purpose} WebSocket connection failed`, { cause: error });
      };
      ws.onclose = (event: { code: number; reason: string }) => {
        if (socketError) {
          finish(socketError);
          return;
        }
        if (event.code !== 1000) {
          const reason = event.reason ? `: ${event.reason}` : '';
          finish(new Error(`Agent ${purpose} WebSocket closed with code ${event.code}${reason}`));
          return;
        }
        if (!opened || resultCount !== 1) {
          finish(new Error(`Agent ${purpose} WebSocket closed without one result frame`));
          return;
        }
        finish();
      };
    });
  }

  async metrics(agentIdOrName: string): Promise<AgentMetricsResult> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    return validateAgentMetricsResult(
      await this.oneShotAgentWebSocket(agentId, 'metrics'),
    );
  }

  async list(options: ListAgentsOptions = {}): Promise<Agent[]> {
    return (await this.listWithCapacity(options)).items;
  }

  async listWithCapacity(options: ListAgentsOptions = {}): Promise<AgentCapacity> {
    const params: Record<string, string | number> = {};
    if (options.state) params.state = options.state;
    if (options.handle) params.handle = options.handle;
    if (options.name) params.name = options.name;
    if (options.query) params.q = options.query;
    if (options.includeDeleted !== undefined && options.includeDeleted !== null) {
      params.include_deleted = options.includeDeleted ? 'true' : 'false';
    }
    const requestOptions: RequestOverrides = {
      retries: options.retries,
      backoff: options.backoff,
      timeout: options.timeout,
      signal: options.signal,
      retryStatuses: options.retryStatuses,
    };
    const cleanRequestOptions: RequestOverrides = {};
    for (const key of Object.keys(requestOptions) as Array<keyof RequestOverrides>) {
      const value = requestOptions[key];
      if (value !== undefined) {
        (cleanRequestOptions as Record<keyof RequestOverrides, unknown>)[key] = value;
      }
    }
    const data = await this.agentHttp.get<any>(
      DEPLOYMENTS_API_PREFIX,
      Object.keys(params).length ? params : undefined,
      Object.keys(cleanRequestOptions).length ? cleanRequestOptions : undefined,
    );
    const payload = Array.isArray(data) ? { items: data } : data;
    const items = (payload.items ?? []).map((item: AgentHydrationData) => this.hydrateAgent(item));
    const runningFallback = items.filter(
      (agent: Agent) => !isAgentRuntimeInactiveState(agent.state),
    ).length;
    return {
      items,
      totalAgents: Number(payload.total_agents ?? items.length),
      maxAgentsPerAccount: Number(payload.max_agents_per_account ?? 0),
      runningAgents: Number(payload.running_agents ?? runningFallback),
      slots: Object.fromEntries(
        Object.entries(payload.slots ?? {}).map(([size, raw]) => {
          const inventory = raw as Record<string, any>;
          return [size, {
            granted: Number(inventory.granted ?? 0),
            used: Number(inventory.used ?? inventory.occupied ?? 0),
            available: Number(inventory.available ?? 0),
          }];
        }),
      ),
      agentSlots: (payload.agent_slots ?? []).map(agentSlotFromDict),
      pooledTpd: Number(payload.pooled_tpd ?? 0),
    };
  }

  async get(agentIdOrName: string, requestOptions: RequestOverrides = {}): Promise<Agent> {
    const raw = String(agentIdOrName || '').trim();
    if (!raw) throw new Error('agentIdOrName is required');
    if (isSelfAgentRef(raw)) {
      return this.getById('self', requestOptions);
    }
    if (!isDirectAgentIdRef(raw)) {
      return this.resolveAgent(raw, requestOptions);
    }
    try {
      return await this.getById(raw, requestOptions);
    } catch (error) {
      if (!(error instanceof APIError) || ![404, 422].includes(error.statusCode) || isUuidRef(raw)) {
        throw error;
      }
      return this.resolveAgent(raw, requestOptions);
    }
  }

  async createExternalAgent(options: CreateExternalAgentOptions): Promise<Agent> {
    const body: Record<string, any> = {
      name: options.name,
      runtime: options.runtime ?? 'openclaw',
      status: options.status ?? 'active',
    };
    if (options.displayName !== undefined) body.display_name = options.displayName;
    if (options.handle !== undefined) body.handle = options.handle;
    if (options.meta !== undefined) body.meta = options.meta;
    const data = await this.agentHttp.post<AgentHydrationData>('/external-agents', body);
    return this.hydrateAgent(data);
  }

  async updateExternalAgent(externalAgentId: string, options: UpdateExternalAgentOptions): Promise<Agent> {
    const body: Record<string, any> = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.displayName !== undefined) body.display_name = options.displayName;
    if (options.handle !== undefined) body.handle = options.handle;
    if (options.runtime !== undefined) body.runtime = options.runtime;
    if (options.status !== undefined) body.status = options.status;
    if (options.meta !== undefined) body.meta = options.meta;
    const data = await this.agentHttp.patch<AgentHydrationData>(`/external-agents/${externalAgentId}`, body);
    return this.hydrateAgent(data);
  }

  async getExternalAgent(externalAgentId: string): Promise<Agent> {
    const data = await this.agentHttp.get<AgentHydrationData>(`/external-agents/${externalAgentId}`);
    return this.hydrateAgent(data);
  }

  async uploadExternalAgentProfileImage(
    externalAgentId: string,
    content: Blob | ArrayBuffer | ArrayBufferView,
    contentType?: string,
  ): Promise<AgentProfileImageUploadResult> {
    const resolvedContentType = contentType || (content instanceof Blob ? content.type : '') || 'image/png';
    return this.agentHttp.postRaw<AgentProfileImageUploadResult>(
      `/external-agents/${externalAgentId}/profile-image`,
      content,
      resolvedContentType,
    );
  }

  async deleteExternalAgentProfileImage(externalAgentId: string): Promise<AgentProfileImageUploadResult> {
    return this.agentHttp.delete<AgentProfileImageUploadResult>(`/external-agents/${externalAgentId}/profile-image`);
  }

  async rotateExternalAgentKey(agentIdOrName: string): Promise<Record<string, any>> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    return this.agentHttp.post(`/external-agents/${agentId}/keys/rotate`);
  }

  async attachSlackRelayAgent(
    agentIdOrName: string,
    options: AttachDeploymentSlackRelayAgentOptions,
  ): Promise<AttachSlackRelayAgentResult> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    return attachSlackRelayAgent({
      relayBaseUrl: options.relayBaseUrl,
      token: options.token || this.apiKey,
      agentId,
    });
  }

  async subscribe(
    handler: (event: DeploymentEvent) => void | Promise<void>,
    options: DeploymentSubscribeOptions = {},
  ): Promise<void> {
    const stableConnectionMs = 10_000;
    let retryDelay = 250;
    const waitBeforeReconnect = async () => {
      let abortRetry: () => void = () => {};
      const aborted = new Promise<void>((resolve) => {
        if (options.signal?.aborted) resolve();
        else {
          abortRetry = resolve;
          options.signal?.addEventListener('abort', abortRetry, { once: true });
        }
      });
      try {
        await Promise.race([sleep(retryDelay), aborted]);
      } finally {
        options.signal?.removeEventListener('abort', abortRetry);
      }
      retryDelay = Math.min(retryDelay * 2, 5_000);
    };
    while (!options.signal?.aborted) {
      try {
        const token = await this.agentHttp.post<{
          token: string;
          ws_url: string;
        }>(`${DEPLOYMENTS_API_PREFIX}/events/token`, undefined, { signal: options.signal });
        const WebSocketImpl = globalThis.WebSocket ?? NodeWebSocket;
        const ws = new WebSocketImpl(token.ws_url);
        let readyAt: number | null = null;
        let closedAt: number | null = null;
        await new Promise<void>((resolve, reject) => {
          let opened = false;
          let ready = false;
          let processing = Promise.resolve();
          const readyTimer = setTimeout(() => {
            ws.close(4002, 'Deployment event ready timed out');
            reject(new Error('Deployment event ready timed out'));
          }, 10_000);
          const abort = () => ws.close(1000, 'Subscription cancelled');
          options.signal?.addEventListener('abort', abort, { once: true });
          ws.addEventListener('open', () => {
            opened = true;
            ws.send(JSON.stringify({ type: 'auth', token: token.token }));
          });
          ws.addEventListener('message', (message) => {
            processing = processing.then(async () => {
              const frame = JSON.parse(await websocketMessageText(message.data)) as Record<string, unknown>;
              if (!ready) {
                if (frame.type !== 'ready') {
                  throw new Error('Deployment event socket did not send ready');
                }
                ready = true;
                readyAt = Date.now();
                clearTimeout(readyTimer);
                await options.onReady?.();
                return;
              }
              if (
                (frame.type === 'deployment.transition' || frame.type === 'deployment.import_status')
                && typeof frame.agent_id === 'string'
                && frame.agent_id.length > 0
              ) {
                await handler(frame as unknown as DeploymentEvent);
              }
            }).catch((error) => {
              ws.close(4002, 'Invalid deployment event');
              reject(error);
            });
          });
          ws.addEventListener('error', () => reject(new Error('Deployment event WebSocket failed')));
          ws.addEventListener('close', () => {
            closedAt = Date.now();
            clearTimeout(readyTimer);
            options.signal?.removeEventListener('abort', abort);
            processing.then(resolve, reject);
          });
          if (options.signal?.aborted) abort();
          void opened;
        });
        if (!options.signal?.aborted) {
          // A `ready` frame followed by an immediate close is not a healthy
          // stream. Reset only after a useful stable interval so reconnects
          // and their authoritative REST resyncs retain exponential backoff.
          if (
            readyAt !== null
            && closedAt !== null
            && closedAt - readyAt >= stableConnectionMs
          ) {
            retryDelay = 250;
          }
          await waitBeforeReconnect();
        }
      } catch (error) {
        if (options.signal?.aborted) break;
        if (error instanceof APIError && [401, 403].includes(error.statusCode)) throw error;
        await waitBeforeReconnect();
        void error;
      }
    }
  }

  async waitForState(
    agentIdOrName: string,
    states: readonly AgentState[],
    timeoutMs = 300_000,
    failureStates: readonly AgentState[] = [],
    minimumLaunchEpoch?: number,
    pollIntervalMs = 5_000,
  ): Promise<Agent> {
    if (!states.length) throw new Error('states must not be empty');
    if (minimumLaunchEpoch !== undefined && minimumLaunchEpoch < 0) {
      throw new Error('minimumLaunchEpoch must be non-negative');
    }
    const agentId = await this.resolveAgentId(agentIdOrName);
    const deadline = Date.now() + timeoutMs;
    let lastState = '';
    let wakePending = true;
    let wake: (() => void) | null = null;
    const controller = new AbortController();
    const desired = new Set(states.map((state) => state.toLowerCase()));
    const failures = new Set(failureStates.map((state) => state.toLowerCase()));
    const effectivePollIntervalMs = Math.max(1, pollIntervalMs);
    const stateLabel = states.join(', ');
    let pendingFailureState: string | null = null;
    const refresh = async (confirmFailure = false): Promise<Agent | null> => {
      const agent = await this.get(agentId);
      lastState = String(agent.state || '');
      if (
        minimumLaunchEpoch !== undefined
        && agent.launchEpoch < minimumLaunchEpoch
      ) return null;
      const normalizedState = lastState.toLowerCase();
      if (desired.has(normalizedState)) return agent;
      if (failures.has(normalizedState)) {
        // Accepting a lifecycle request publishes the new launch epoch a beat
        // before the state leaves the previous terminal value, so a single
        // terminal read under the accepted epoch is not proof of a terminal
        // launch. Require it to survive one more observation.
        if (!confirmFailure && pendingFailureState !== normalizedState) {
          pendingFailureState = normalizedState;
          return null;
        }
        throw new Error(`Agent entered ${lastState} while waiting for ${stateLabel}`);
      }
      pendingFailureState = null;
      return null;
    };
    const subscription = this.subscribe((event) => {
      if (event.type === 'deployment.transition' && event.agent_id === agentId) {
        wakePending = true;
        wake?.();
      }
    }, {
      signal: controller.signal,
      onReady: () => {
        wakePending = true;
        wake?.();
      },
    }).catch(() => {
      // Lifecycle events reduce latency, but REST polling remains authoritative.
      wakePending = true;
      wake?.();
    });
    try {
      while (Date.now() < deadline) {
        if (wakePending) {
          wakePending = false;
          const agent = await refresh();
          if (agent) return agent;
          continue;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await Promise.race([
          new Promise<void>((resolve) => { wake = resolve; }),
          sleep(Math.min(remaining, effectivePollIntervalMs)).then(() => {
            wakePending = true;
          }),
        ]);
        wake = null;
      }
      const finalAgent = await refresh(true);
      if (finalAgent) return finalAgent;
    } finally {
      controller.abort();
      await subscription;
    }
    throw new Error(
      `Timed out waiting for agent ${agentId} to reach ${stateLabel} (last=${lastState || 'unknown'})`,
    );
  }

  async waitRunning(
    agentIdOrName: string,
    timeoutMs = 300_000,
    pollIntervalMs = 5_000,
    minimumLaunchEpoch?: number,
  ): Promise<Agent> {
    return this.waitForState(
      agentIdOrName,
      ['RUNNING'],
      timeoutMs,
      ['STOPPED', 'ARCHIVED', 'DELETED', 'FAILED'],
      minimumLaunchEpoch,
      pollIntervalMs,
    );
  }

  /**
   * Read back every launch secret value the projection refuses to return.
   *
   * Agent projections list secret *names* and expose values only through the
   * per-secret retrieval endpoint, so a complete `secrets` mapping has to be
   * reassembled one key at a time. Every response is checked against
   * `launchEpoch` so a rebuild never silently mixes values from an older
   * launch generation into a new one.
   */
  private async recoverRedactedSecrets(
    agentId: string,
    launchEpoch: number,
  ): Promise<Record<string, string>> {
    const namesData = await this.secretNames(agentId);
    if (Number(namesData.launch_epoch ?? 0) < launchEpoch) {
      throw new Error('agent secret names belong to an older launch epoch');
    }
    const secrets: Record<string, string> = {};
    for (const name of namesData.names ?? []) {
      const secretData = await this.secret(agentId, String(name));
      if (Number(secretData.launch_epoch ?? 0) < launchEpoch) {
        throw new Error('agent secret belongs to an older launch epoch');
      }
      secrets[String(name)] = String(secretData.value ?? '');
    }
    return secrets;
  }

  /**
   * Restore the two launch_config keys an Agent projection redacts.
   *
   * WHY THIS EXISTS — do not delete it as redundant validation sugar. The
   * Backend's owner-facing Agent projection deliberately strips `secrets` and
   * `registry_auth` before returning an Agent to a user-scoped caller
   * (`hydrate_managed_agent` pops both), and this SDK's own hydrator drops
   * `secrets` again. START, by contrast, is a *full replacement* and demands
   * every key in REQUIRED_START_LAUNCH_CONFIG_KEYS. Without this step the
   * obvious round trip can never succeed, because the read side is
   * structurally incapable of returning what the write side requires:
   *
   * ```ts
   * const agent = await client.deployments.get(agentId);
   * await client.deployments.start(agentId, { launchConfig: agent.launchConfig });
   * // Error: launchConfig is incomplete; missing: secrets, registry_auth
   * ```
   *
   * The fix is to complete the object honestly, never to weaken the
   * completeness contract — START must stay a replacement, not a merge.
   *
   * Only keys that are genuinely ABSENT are rebuilt. A caller-supplied
   * `secrets` or `registry_auth` is honoured verbatim, including an explicit
   * empty object, so "redacted by the projection" and "deliberately empty"
   * remain distinguishable.
   *
   * `secrets` is recoverable because values can be read back one name at a
   * time. `registry_auth` is NOT: it is caller-held, write-only, and never
   * stored server-side. It therefore falls back to an explicitly supplied
   * `registryAuth`, then to `{}` only when the configuration pulls from no
   * `registry_url`; when a registry is configured an empty credential would
   * silently break the image pull, so the caller is told to supply it instead.
   */
  private async rehydrateRedactedLaunchConfig(
    resolvedAgentId: string,
    launchConfig: AgentLaunchConfig,
    registryAuth?: RegistryAuth,
  ): Promise<AgentLaunchConfig> {
    if (!isPlainRecord(launchConfig)) {
      throw new Error('launchConfig must be a complete object');
    }
    const absent = REQUIRED_START_LAUNCH_CONFIG_KEYS.filter(
      (key) => !Object.prototype.hasOwnProperty.call(launchConfig, key),
    );
    // Nothing missing, or missing more than the projection ever redacts: in
    // both cases hand the object straight to the completeness gatekeeper. Only
    // a config whose *sole* gaps are the two redacted keys is a projection
    // round trip worth spending API calls to repair.
    if (absent.length === 0 || absent.some((key) => key !== 'secrets' && key !== 'registry_auth')) {
      return launchConfig;
    }

    const prepared: Record<string, any> = structuredClone(launchConfig);
    if (absent.includes('secrets')) {
      const agent = await this.getById(resolvedAgentId);
      prepared.secrets = await this.recoverRedactedSecrets(resolvedAgentId, agent.launchEpoch);
    }
    if (absent.includes('registry_auth')) {
      const registryUrl = String(prepared.registry_url ?? '').trim();
      if (registryAuth) {
        prepared.registry_auth = structuredClone(registryAuth);
      } else if (registryUrl) {
        throw new Error(
          `Agent ${resolvedAgentId} pulls from registry_url ${JSON.stringify(registryUrl)} but `
          + 'launchConfig carries no registry_auth; registry_auth is caller-held and write-only, '
          + 'so the owner-facing projection can never return it and the SDK will not substitute '
          + 'an empty credential that would break the private-registry pull — pass registryAuth '
          + 'explicitly to START',
        );
      } else {
        prepared.registry_auth = {};
      }
    }
    return prepared as AgentLaunchConfig;
  }

  /**
   * Rebuild the complete replacement launch_config that START requires, from
   * nothing but the Agent's stored projection.
   *
   * DELIBERATELY RETAINED where the Python SDK dropped `stored_launch_config`.
   * Python's `start()` always takes a launch_config, so once it rehydrated the
   * redacted keys inline the stored rebuild became a pure duplicate. This SDK
   * additionally supports `start(id)` with no config at all, and this is the
   * only thing that can produce one; it is also the only place that
   * canonicalizes the two legacy projection shapes the inline repair never
   * sees, because the repair fills absent keys and touches nothing else:
   * nullable `restart`, and a projection carrying both or neither sync policy.
   *
   * Reads the stored Agent projection, rehydrates redacted secrets through the
   * per-secret retrieval endpoint, requires caller-held registry_auth whenever
   * the stored config references a registry_url, normalizes those legacy
   * shapes, and self-checks through the completeness gatekeeper.
   */
  async storedLaunchConfig(
    agentIdOrName: string,
    options: { registryAuth?: RegistryAuth } = {},
  ): Promise<AgentLaunchConfig> {
    const agent = await this.get(agentIdOrName);
    if (!isPlainRecord(agent.launchConfig)) {
      throw new Error(`Agent ${agent.id} has no stored launch_config projection`);
    }
    const launchConfig: Record<string, any> = structuredClone(agent.launchConfig);

    // Legacy projections may still carry the old nullable restart
    // representation; START receives one explicit boolean.
    if ('restart' in launchConfig && launchConfig.restart === null) {
      launchConfig.restart = false;
    }

    launchConfig.secrets = await this.recoverRedactedSecrets(agent.id, agent.launchEpoch);

    const registryUrl = String(launchConfig.registry_url ?? '').trim();
    if (registryUrl && !options.registryAuth) {
      throw new Error(
        `Agent ${agent.id} pulls from registry_url ${JSON.stringify(registryUrl)}; `
        + 'registry_auth is caller-held and never stored server-side, so it must '
        + 'be supplied to rebuild a complete START configuration',
      );
    }
    launchConfig.registry_auth = options.registryAuth ? structuredClone(options.registryAuth) : {};

    // START requires exactly one sync policy. Includes win when a legacy
    // projection carries both; carrying neither canonicalizes to the
    // explicit sync-everything exclusion list.
    if (Object.prototype.hasOwnProperty.call(launchConfig, 'sync_include')) {
      delete launchConfig.sync_exclude;
    } else if (!Object.prototype.hasOwnProperty.call(launchConfig, 'sync_exclude')) {
      launchConfig.sync_exclude = [];
    }

    return cloneCompleteLaunchConfig(launchConfig as AgentLaunchConfig);
  }

  async start(agentIdOrName: string, options?: StartAgentOptions): Promise<Agent> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    // START requires one complete replacement launch_config. A caller-supplied
    // config is first repaired for the two keys the owner-facing projection
    // redacts, so the natural get() -> start() round trip works. When the
    // caller supplies nothing, rebuild the config from the stored projection.
    const launchConfig = options?.launchConfig
      ? cloneCompleteLaunchConfig(
        await this.rehydrateRedactedLaunchConfig(
          agentId,
          options.launchConfig,
          options.registryAuth,
        ),
      )
      : await this.storedLaunchConfig(agentId, { registryAuth: options?.registryAuth });
    const body: Record<string, any> = { launch_config: launchConfig };
    if (options?.dryRun) body.dry_run = true;
    const data = await this.agentHttp.post<AgentHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/start`,
      body,
      { retries: 1 },
    );
    if (!options?.dryRun) this.invalidateOpenClawGateway(agentId);
    return this.hydrateAgent(data);
  }

  private async startOpenClawInternal(
    agentIdOrName: string,
    options: OpenClawStartAgentOptions,
    desktop: boolean | null,
  ): Promise<Agent> {
    // Resolve first: the gateway-token injection below reads launchConfig.env
    // and launchConfig.secrets, so a redacted projection has to be repaired
    // before it is inspected, not after.
    const agentId = await this.resolveAgentId(agentIdOrName);
    const launchConfig = repairOpenClawStartLaunchConfig(
      cloneCompleteLaunchConfig(
        await this.rehydrateRedactedLaunchConfig(agentId, options.launchConfig, options.registryAuth),
      ),
      desktop,
    );
    if (Object.prototype.hasOwnProperty.call(launchConfig.env, 'OPENCLAW_GATEWAY_TOKEN')) {
      throw new Error('OPENCLAW_GATEWAY_TOKEN must be supplied through launchConfig.secrets or gatewayToken');
    }
    const explicitToken = options.gatewayToken?.trim() || null;
    const configuredToken = launchConfig.secrets.OPENCLAW_GATEWAY_TOKEN?.trim() || null;
    if (options.gatewayToken !== undefined && options.gatewayToken !== null && !explicitToken) {
      throw new Error('gatewayToken must not be blank');
    }
    if (explicitToken && configuredToken && explicitToken !== configuredToken) {
      throw new Error('gatewayToken conflicts with launchConfig.secrets.OPENCLAW_GATEWAY_TOKEN');
    }
    const gatewayToken = explicitToken ?? configuredToken;
    if (gatewayToken) launchConfig.secrets.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
    // Repair records written before the SDK owned this set: the gateway id is
    // the Backend's own derivation from the Agent id, known here.
    HostedSlackLaunchEnv.repairForAgent(launchConfig.env, { agentId });
    HostedSlackLaunchEnv.assertComplete(launchConfig.env, 'startOpenClaw launch env');
    const agent = await this.start(agentId, {
      launchConfig,
      dryRun: options.dryRun,
    });
    if (agent instanceof OpenClawAgent) agent.gatewayToken = gatewayToken;
    return agent;
  }

  async startOpenClaw(agentIdOrName: string, options: OpenClawStartAgentOptions): Promise<Agent> {
    return this.startOpenClawInternal(agentIdOrName, options, null);
  }

  async startHermesAgent(agentIdOrName: string, options: HermesAgentStartOptions): Promise<HermesAgent> {
    // Resolve first: the API_SERVER_KEY reconciliation below reads
    // launchConfig.env and launchConfig.secrets, so a redacted projection has
    // to be repaired before it is inspected, not after.
    const agentId = await this.resolveAgentId(agentIdOrName);
    const launchConfig = cloneCompleteLaunchConfig(
      await this.rehydrateRedactedLaunchConfig(agentId, options.launchConfig, options.registryAuth),
    );
    const suppliedApiServerKey = options.apiServerKey
      ?? launchConfig.secrets.API_SERVER_KEY
      ?? launchConfig.env.API_SERVER_KEY;
    const apiServerKey = suppliedApiServerKey === undefined
      ? null
      : resolveHermesApiServerKey(options.apiServerKey, launchConfig.env, launchConfig.secrets);
    if (apiServerKey) {
      delete launchConfig.env.API_SERVER_KEY;
      launchConfig.secrets.API_SERVER_KEY = apiServerKey;
    }
    const agent = await this.start(agentId, {
      launchConfig,
      dryRun: options.dryRun,
    });
    if (!(agent instanceof HermesAgent)) {
      throw new Error("Hermes deployment response did not identify runtime 'hermes-agent'");
    }
    agent.apiServerKey = apiServerKey;
    return agent;
  }

  async startOpenClawPro(agentIdOrName: string, options: OpenClawStartAgentOptions): Promise<Agent> {
    return this.startOpenClawInternal(agentIdOrName, options, true);
  }

  async update(agentIdOrName: string, options: UpdateAgentOptions = {}): Promise<Agent> {
    const body: Record<string, any> = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.handle !== undefined) body.handle = options.handle;
    if (options.size !== undefined) body.size = options.size;
    if (options.launchConfig !== undefined) body.launch_config = options.launchConfig;
    if (options.refreshFromLagoon !== undefined) body.refresh_from_lagoon = options.refreshFromLagoon;
    if (options.error !== undefined) body.error = options.error;
    const agentId = await this.resolveAgentId(agentIdOrName);
    const data = await this.agentHttp.patch<AgentHydrationData>(`${DEPLOYMENTS_API_PREFIX}/${agentId}`, body);
    return this.hydrateAgent(data);
  }

  async uploadProfileImage(
    agentId: string,
    content: Blob | ArrayBuffer | ArrayBufferView,
    contentType?: string,
  ): Promise<AgentProfileImageUploadResult> {
    const resolvedAgentId = await this.resolveAgentId(agentId);
    const resolvedContentType = contentType || (content instanceof Blob ? content.type : '') || 'image/png';
    return this.agentHttp.postRaw<AgentProfileImageUploadResult>(
      `${DEPLOYMENTS_API_PREFIX}/${resolvedAgentId}/profile-image`,
      content,
      resolvedContentType,
    );
  }

  async deleteProfileImage(agentId: string): Promise<AgentProfileImageUploadResult> {
    const resolvedAgentId = await this.resolveAgentId(agentId);
    return this.agentHttp.delete<AgentProfileImageUploadResult>(`${DEPLOYMENTS_API_PREFIX}/${resolvedAgentId}/profile-image`);
  }

  async resize(
    agentId: string,
    options: Pick<UpdateAgentOptions, 'size'>,
  ): Promise<Agent> {
    return this.update(agentId, options);
  }

  /**
   * Request an agent stop.
   *
   * The returned agent remains `STOPPING` while runtime cleanup is in
   * progress. Fetch it again until it becomes `STOPPED` before treating its
   * deployment slot as released.
   */
  async stop(agentIdOrName: string): Promise<Agent> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const data = await this.agentHttp.post<AgentHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/stop`,
      undefined,
      { retries: 1 },
    );
    this.invalidateOpenClawGateway(agentId);
    return this.hydrateAgent(data);
  }

  /** Archive durable storage without launching the agent. */
  async archive(agentIdOrName: string): Promise<Agent> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const data = await this.agentHttp.post<AgentHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/archive`,
      undefined,
      { retries: 1 },
    );
    this.invalidateOpenClawGateway(agentId);
    return this.hydrateAgent(data);
  }

  /** Restore durable storage. The accepted snapshot is `RESTORING`; completion is `STOPPED`. */
  async restore(agentIdOrName: string): Promise<Agent> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const data = await this.agentHttp.post<AgentHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/restore`,
      undefined,
      { retries: 1 },
    );
    this.invalidateOpenClawGateway(agentId);
    return this.hydrateAgent(data);
  }

  /**
   * Resolve who the presented credential is, per the Backend
   * (`GET /deployments/auth/me`).
   *
   * Answers the three questions a credential should be able to ask about
   * itself: which Agent it is (`agentId`, set only for an Agent runtime key),
   * which account owns it (`userId`, `teamId`, `planId`), and what it may do
   * (`tags`, `capabilities`). It returns only what the credential already
   * carries, so it is unscoped and safe for any caller.
   *
   * Distinct from the product-wide `client.user.authMe()`: this is the agent
   * product's own introspection and is the only one that reports `agentId`.
   */
  async accessIdentity(requestOptions: RequestOverrides = {}): Promise<AgentAccessIdentity> {
    const path = `${DEPLOYMENTS_API_PREFIX}/auth/me`;
    const data = Object.keys(requestOptions).length === 0
      ? await this.agentHttp.get<AgentAccessIdentityHydrationData>(path)
      : await this.agentHttp.get<AgentAccessIdentityHydrationData>(path, undefined, requestOptions);
    return agentAccessIdentityFromData(data);
  }

  async getRoutes(
    agentIdOrName: string,
    options: RequestOverrides = {},
  ): Promise<AgentRoutesState> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const path = `${DEPLOYMENTS_API_PREFIX}/${agentId}/routes`;
    const data = Object.keys(options).length > 0
      ? await this.agentHttp.get<AgentRoutesHydrationData>(path, undefined, options)
      : await this.agentHttp.get<AgentRoutesHydrationData>(path);
    return agentRoutesStateFromData(data);
  }

  async setRoutes(
    agentIdOrName: string,
    routes: Record<string, AgentRouteConfig>,
    options: SetRoutesOptions = {},
  ): Promise<AgentRoutesState> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const body: Record<string, unknown> = { routes: structuredClone(routes) };
    if (Object.prototype.hasOwnProperty.call(options, 'cors') && options.cors !== undefined) {
      body.cors = options.cors === null ? null : structuredClone(options.cors);
    }
    const data = await this.agentHttp.put<AgentRoutesHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/routes`,
      body,
    );
    return agentRoutesStateFromData(data);
  }

  async setRoute(
    agentIdOrName: string,
    name: string,
    route: AgentRouteConfig,
  ): Promise<AgentRoutesState> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const body: Record<string, unknown> = { port: route.port };
    if (route.auth !== undefined) body.auth = route.auth;
    if (route.prefix !== undefined) body.prefix = route.prefix;
    const data = await this.agentHttp.put<AgentRoutesHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/routes/${encodeURIComponent(name)}`,
      body,
    );
    return agentRoutesStateFromData(data);
  }

  async removeRoute(
    agentIdOrName: string,
    name: string,
  ): Promise<AgentRoutesState> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const data = await this.agentHttp.delete<AgentRoutesHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/routes/${encodeURIComponent(name)}`,
    );
    return agentRoutesStateFromData(data);
  }

  async delete(agentIdOrName: string): Promise<Record<string, any>> {
    // HTTP 200 accepts the durable soft delete. Cluster-local cleanup continues
    // in the background and is not proven complete by this response.
    const agentId = await this.resolveAgentId(agentIdOrName);
    const result = await this.agentHttp.delete<Record<string, any>>(`${DEPLOYMENTS_API_PREFIX}/${agentId}`);
    this.invalidateOpenClawGateway(agentId);
    return result;
  }

  async refreshToken(agentIdOrName: string): Promise<AgentTokenResponse> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    return this.agentHttp.get(`${DEPLOYMENTS_API_PREFIX}/${agentId}/token`);
  }

  async createScopedKey(agentIdOrName: string, name?: string): Promise<Record<string, any>> {
    const payload: Record<string, string> = {};
    if (name) payload.name = name;
    const agentId = await this.resolveAgentId(agentIdOrName);
    return this.agentHttp.post(`${DEPLOYMENTS_API_PREFIX}/${agentId}/keys`, Object.keys(payload).length ? payload : undefined);
  }

  async webSearch(query: string, options: BraveWebSearchOptions = {}): Promise<BraveWebSearchResponse> {
    const params: Record<string, string | number> = {
      q: query,
      count: options.count ?? 5,
    };
    if (options.country) params.country = options.country;
    if (options.searchLang) params.search_lang = options.searchLang;
    if (options.uiLang) params.ui_lang = options.uiLang;
    if (options.freshness) params.freshness = options.freshness;

    const headers = { 'X-Subscription-Token': this.apiKey };
    if (this.agentHttp instanceof HTTPClient) {
      return this.agentHttp.getWithHeaders<BraveWebSearchResponse>('/brave/res/v1/web/search', params, headers);
    }
    const response = await this.fetchRaw(`/brave/res/v1/web/search?${new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    ).toString()}`, { headers });
    return (await response.json()) as BraveWebSearchResponse;
  }

  async logsToken(agentIdOrName: string): Promise<AgentLogsTokenResponse> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    return this.agentHttp.post(`${DEPLOYMENTS_API_PREFIX}/${agentId}/logs/token`);
  }

  async env(
    agentIdOrName: string,
    requestOptions: RequestOverrides = {},
  ): Promise<AgentEnvResponse> {
    const agentId = await this.resolveAgentId(agentIdOrName, requestOptions);
    const path = `${DEPLOYMENTS_API_PREFIX}/${agentId}/env`;
    return Object.keys(requestOptions).length === 0
      ? this.agentHttp.get(path)
      : this.agentHttp.get(path, undefined, requestOptions);
  }

  async setEnv(
    agentIdOrName: string,
    key: string,
    value: string,
  ): Promise<AgentEnvMutationResponse> {
    if (!key) throw new Error('env key is required');
    const agentId = await this.resolveAgentId(agentIdOrName);
    return this.agentHttp.patch<AgentEnvMutationResponse>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/env/${encodeURIComponent(key)}`,
      { value },
    );
  }

  async deleteEnv(
    agentIdOrName: string,
    key: string,
  ): Promise<AgentEnvMutationResponse> {
    if (!key) throw new Error('env key is required');
    const agentId = await this.resolveAgentId(agentIdOrName);
    return this.agentHttp.delete<AgentEnvMutationResponse>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/env/${encodeURIComponent(key)}`,
    );
  }

  async secretNames(
    agentIdOrName: string,
    requestOptions: RequestOverrides = {},
  ): Promise<AgentSecretNamesResponse> {
    const agentId = await this.resolveAgentId(agentIdOrName, requestOptions);
    const path = `${DEPLOYMENTS_API_PREFIX}/${agentId}/secrets`;
    return Object.keys(requestOptions).length === 0
      ? this.agentHttp.get(path)
      : this.agentHttp.get(path, undefined, requestOptions);
  }

  async secret(
    agentIdOrName: string,
    key: string,
    requestOptions: RequestOverrides = {},
  ): Promise<AgentSecretResponse> {
    const agentId = await this.resolveAgentId(agentIdOrName, requestOptions);
    const path = `${DEPLOYMENTS_API_PREFIX}/${agentId}/secrets/${encodeURIComponent(key)}`;
    return Object.keys(requestOptions).length === 0
      ? this.agentHttp.get(path)
      : this.agentHttp.get(path, undefined, requestOptions);
  }

  async setSecret(
    agentIdOrName: string,
    key: string,
    value: string,
  ): Promise<AgentSecretMutationResponse> {
    if (!key) throw new Error('secret key is required');
    const agentId = await this.resolveAgentId(agentIdOrName);
    const result = await this.agentHttp.patch<AgentSecretMutationResponse>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/secrets/${encodeURIComponent(key)}`,
      { value },
    );
    this.invalidateOpenClawGateway(agentId);
    return result;
  }

  async deleteSecret(
    agentIdOrName: string,
    key: string,
  ): Promise<AgentSecretMutationResponse> {
    if (!key) throw new Error('secret key is required');
    const agentId = await this.resolveAgentId(agentIdOrName);
    const result = await this.agentHttp.delete<AgentSecretMutationResponse>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/secrets/${encodeURIComponent(key)}`,
    );
    this.invalidateOpenClawGateway(agentId);
    return result;
  }

  async exec(target: Agent | string, command: string[], options: AgentExecOptions = {}): Promise<AgentExecResult> {
    if (
      !Array.isArray(command)
      || command.length < 1
      || command.some((argument) => typeof argument !== 'string')
      || command[0].length === 0
      || command.some((argument) => argument.includes('\0'))
      || command.reduce((size, argument) => size + encodeUtf8(argument).byteLength, 0) > 65_536
    ) {
      throw new Error(
        'command must be a nonempty argv list of strings with a nonempty executable, at most 65536 UTF-8 bytes, and no NUL',
      );
    }
    command = [...command];
    const timeout = options.timeout ?? 30;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
      throw new Error('timeout must be an integer from 1 through 300');
    }
    const agentId = await this.agentIdFor(target);
    const payload: Record<string, unknown> = {
      command,
      timeout,
      dry_run: options.dryRun ?? false,
    };
    return validateAgentExecResult(
      await this.oneShotAgentWebSocket(agentId, 'exec', payload, (timeout + 10) * 1_000),
    );
  }

  /**
   * Wait until an Agent's Reef file API is actually serving.
   *
   * Probing the Agent hostname alone cannot answer this. The Agent domain is a
   * wildcard, so a host with no route still resolves and the edge answers a
   * plain-text `404 page not found` — byte for byte what a route that has not
   * converged yet returns. A caller polling the hostname therefore cannot tell
   * "not ready" from "never will be", and will retry until its deadline against
   * a host that was never going to work.
   *
   * So ask the API for the authoritative Agent state first: a deleted or failed
   * Agent rejects immediately with that state rather than timing out. Then
   * require consecutive successful reads, because one success only proves the
   * route answered once — the next request can still 404 while the edge settles.
   */
  async waitForFileApiReady(
    target: Agent | string,
    options: AgentFileApiReadyOptions = {},
  ): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 90_000;
    const consecutive = options.consecutive ?? 2;
    const pollMs = options.pollMs ?? 1_000;
    const agentId = await this.agentIdFor(target);
    const deadline = Date.now() + timeoutMs;
    let streak = 0;
    let lastError: unknown = null;
    let lastState = '';
    for (;;) {
      const agent = await this.get(agentId);
      lastState = String(agent.state ?? '').toUpperCase();
      if (lastState === 'DELETED' || lastState === 'FAILED') {
        throw new Error(
          `Agent ${agentId} is ${lastState}; its Reef file API will not serve. Waiting longer cannot help.`,
        );
      }
      try {
        await this.filesList(agentId, '');
        streak += 1;
        if (streak >= consecutive) return;
      } catch (error) {
        lastError = error;
        streak = 0;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Agent ${agentId} Reef file API did not serve ${consecutive} consecutive reads within ` +
            `${Math.round(timeoutMs / 1000)}s (agent state=${lastState || 'unknown'}, last error=${String(lastError)})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  async filesList(target: Agent | string, path: string = ''): Promise<AgentFileEntry[]> {
    const resolvedPath = resolveSyncRootFilePath(path);
    const agentId = await this.agentIdFor(target);
    const access = await this.reefFileAccess(agentId);
    const suffix = resolvedPath ? `/${encodeFilePath(resolvedPath)}` : '';
    const response = await this.fetchReef(access, `/directories${suffix}`);
    const payload = (await response.json()) as AgentDirectoryListing;
    if (!isDirectoryListingPayload(payload)) {
      throw new Error('Reef returned an invalid directory listing');
    }
    return [...(payload.directories ?? []), ...(payload.files ?? [])];
  }

  async fileReadBytesWithMetadata(
    target: Agent | string,
    path: string,
    options?: AgentFileReadOptions,
  ): Promise<AgentFileReadBytesResult> {
    const resolvedPath = resolveSyncRootFilePath(path);
    if (!resolvedPath) throw new Error('agent file path is required');
    const agentId = await this.agentIdFor(target);
    const access = await this.reefFileAccess(agentId);
    const response = await this.fetchReef(access, `/files/${encodeFilePath(resolvedPath)}`, {
      signal: options?.signal,
    });
    const maxBytes = options?.maxBytes === undefined
      ? AGENT_FILE_MAX_BYTES
      : Math.min(options.maxBytes, AGENT_FILE_MAX_BYTES);
    const bytes = await readResponseBytes(response, path, maxBytes);
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
    return { content: bytes, mimeType: contentType || undefined };
  }

  async fileReadBytes(
    target: Agent | string,
    path: string,
    options?: AgentFileReadOptions,
  ): Promise<Uint8Array> {
    return (await this.fileReadBytesWithMetadata(target, path, options)).content;
  }

  async fileRead(
    target: Agent | string,
    path: string,
    options?: AgentFileReadOptions,
  ): Promise<string> {
    return decodeUtf8(await this.fileReadBytes(target, path, options));
  }

  /**
   * Write bytes directly to a sync-root-relative path through Reef.
   *
   * Per-file writes are limited to 100 MiB (`AGENT_FILE_WRITE_MAX_BYTES`,
   * the Cloudflare edge request-body cap on the agent hostname). Larger data
   * should be split across files or synced via the agent's own tooling.
   */
  async fileWriteBytes(
    target: Agent | string,
    path: string,
    content: Uint8Array | ArrayBuffer | string,
  ): Promise<Record<string, any>> {
    path = normalizeWritableBackendFilePath(path);
    if (!path) throw new Error('agent file path is required');
    const encodedPath = encodeFilePath(path);
    const bytes = toUint8Array(content);
    if (bytes.byteLength > AGENT_FILE_WRITE_MAX_BYTES) {
      throw new Error(
        `Agent file writes are limited to ${AGENT_FILE_WRITE_MAX_BYTES / 1024 / 1024} MiB `
        + '(Cloudflare request-body cap on the agent hostname); '
        + 'split larger data or sync it via the agent\'s own tooling',
      );
    }
    const agentId = await this.agentIdFor(target);
    const access = await this.reefFileAccess(agentId);
    const response = await this.fetchReef(access, `/files/${encodedPath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    return (await response.json()) as Record<string, any>;
  }

  /**
   * Write a UTF-8 text file to an agent.
   *
   * Subject to the 100 MiB per-file write limit; see `fileWriteBytes`.
   */
  async fileWrite(target: Agent | string, path: string, content: string): Promise<Record<string, any>> {
    return this.fileWriteBytes(target, path, content);
  }

  async fileDelete(
    target: Agent | string,
    path: string,
    options: { recursive?: boolean } = {},
  ): Promise<Record<string, any>> {
    path = normalizeWritableBackendFilePath(path);
    if (!path) throw new Error('agent file path is required');
    const encodedPath = encodeFilePath(path);
    const params = new URLSearchParams();
    if (options.recursive) params.set('recursive', 'true');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const agentId = await this.agentIdFor(target);
    const access = await this.reefFileAccess(agentId);
    const response = await this.fetchReef(
      access,
      `/files/${encodedPath}${suffix}`,
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
    agentIdOrName: string,
    options: { tailLines?: number; container?: string } = {},
  ): Promise<WebSocket> {
    const agentId = await this.resolveAgentId(agentIdOrName);
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

  /**
   * Snapshot-then-updates over one socket: the connection opens with the
   * replayed history, reports `history_end`, then streams live lines.
   *
   * One mechanism rather than a REST read plus a separate subscribe. The two-step
   * form leaves a seam between the two calls that no server change can close,
   * because the fetch and the subscribe share no lock; the backend takes the
   * history snapshot and registers the subscriber under a single lock, so a line
   * arriving mid-replay is delivered exactly once.
   *
   * Deliberately does not reconnect. A reconnect replays history again, which
   * would duplicate lines into a consumer that has already rendered them;
   * reconnect policy belongs to the caller, which knows whether it is resuming
   * or restarting the view.
   */
  async subscribeLogs(
    agentIdOrName: string,
    handler: (line: string) => void | Promise<void>,
    options: AgentLogsSubscribeOptions = {},
  ): Promise<void> {
    const follow = options.follow ?? true;
    const ws = await this.logsConnect(agentIdOrName, {
      tailLines: options.tailLines,
      container: options.container,
    });

    void options.onReady?.();

    return await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch {
          // A socket already closed by the peer needs no local close.
        }
        if (error) reject(error);
        else resolve();
      };
      function onAbort() {
        finish();
      }

      if (options.signal?.aborted) {
        finish();
        return;
      }
      options.signal?.addEventListener('abort', onAbort, { once: true });

      ws.onmessage = (event: MessageEvent) => {
        const raw = typeof event.data === 'string' ? event.data : '';
        if (!raw) return;
        const frame = parseAgentLogFrame(raw);
        switch (frame.kind) {
          case 'log':
            void handler(frame.line);
            return;
          case 'historyEnd':
            void options.onHistoryEnd?.();
            if (!follow) finish();
            return;
          case 'error':
            finish(new Error(frame.detail));
            return;
          default:
            return;
        }
      };
      ws.onclose = (event: { code?: number; reason?: string }) => {
        options.onClose?.({ code: event?.code ?? 1006, reason: event?.reason ?? '' });
        finish();
      };
      ws.onerror = () => finish(new Error('WebSocket connection failed'));
    });
  }

  async shellToken(
    agentIdOrName: string,
    shell?: string,
    requestOptions: RequestOverrides = {},
  ): Promise<AgentShellTokenResponse> {
    const selectedShell = shell ?? '/bin/bash';
    const agentId = await this.resolveAgentId(agentIdOrName, requestOptions);
    const path = `${DEPLOYMENTS_API_PREFIX}/${agentId}/shell/token`;
    const rawToken = Object.keys(requestOptions).length === 0
      ? await this.agentHttp.post(path, { shell: selectedShell })
      : await this.agentHttp.post(path, { shell: selectedShell }, requestOptions);
    return validateAgentWsToken(
      rawToken,
      agentId,
      'shell',
      selectedShell,
    ) as AgentShellTokenResponse;
  }

  async shellConnect(
    agentIdOrName: string,
    shell?: string,
    options: AgentShellConnectOptions = {},
  ): Promise<WebSocket> {
    if (options.signal?.aborted) throw shellAbortError();
    const tokenTimeoutMs = options.tokenTimeoutMs ?? 15_000;
    const openTimeoutMs = options.openTimeoutMs ?? 10_000;
    const tokenDeadline = Date.now() + tokenTimeoutMs;
    const remainingTokenTime = () => Math.max(0, tokenDeadline - Date.now());
    const runBeforeTokenDeadline = <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
      const remaining = remainingTokenTime();
      if (remaining <= 0) return Promise.reject(new Error('Shell token request timed out'));
      return runShellOperation(
        operation,
        options.signal,
        remaining,
        'Shell token request timed out',
      );
    };
    const agentId = await runBeforeTokenDeadline(
      (signal) => this.resolveAgentId(agentIdOrName, { signal }),
    );
    const connectWithShell = async (requestedShell: string): Promise<WebSocket> => {
      const remaining = remainingTokenTime();
      if (remaining <= 0) throw new Error('Shell token request timed out');
      const requestOptions: RequestOverrides = {
        retries: 3,
        timeout: Math.max(500, Math.floor((tokenTimeoutMs - 3_000) / 3)),
        retryStatuses: [429, 502, 503, 504],
      };
      const tokenData = await runBeforeTokenDeadline(
        (signal) => {
          requestOptions.signal = signal;
          return this.shellToken(agentId, requestedShell, requestOptions);
        },
      );
      const parsed = new URL(tokenData.ws_url);
      parsed.searchParams.set('jwt', tokenData.jwt);
      parsed.searchParams.set('shell', tokenData.shell);
      const WebSocketImpl = globalThis.WebSocket ?? NodeWebSocket;
      const ws = new WebSocketImpl(parsed.toString());
      ws.binaryType = 'arraybuffer';
      return await new Promise<WebSocket>((resolve, reject) => {
        let settled = false;
        const abortConnection = () => finish(shellAbortError());
        const openTimer = setTimeout(() => finish(new Error('Shell connection timed out')), openTimeoutMs);
        const cleanup = () => {
          clearTimeout(openTimer);
          options.signal?.removeEventListener('abort', abortConnection);
        };
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) {
            try {
              ws.close();
            } catch {
              // The browser may have already finalized a failed socket.
            }
            reject(error);
          } else {
            resolve(ws);
          }
        };

        if (options.signal?.aborted) {
          finish(shellAbortError());
          return;
        }
        options.signal?.addEventListener('abort', abortConnection, { once: true });
        ws.onopen = () => {
          finish();
        };
        ws.onerror = () => undefined;
        ws.onclose = (event) => {
          const reason = event.reason ? `: ${event.reason}` : '';
          const error = new Error(`WebSocket closed before opening${reason}`) as Error & {
            closeCode: number;
            closeReason: string;
          };
          error.closeCode = event.code;
          error.closeReason = event.reason;
          finish(error);
        };
      });
    };

    return connectWithShell(shell ?? '/bin/bash');
  }
}
