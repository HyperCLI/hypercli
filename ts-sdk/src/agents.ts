/**
 * HyperClaw agents API - typed agent lifecycle, files, and exec. Agent chat
 * and sessions are driven over ACP (see acp.ts) through the backend /ws
 * bridge; the SDK no longer talks to runtime-internal gateway processes.
 */
import { randomFillSync } from 'node:crypto';
import NodeWebSocket from 'ws';

// undici's native WebSocket (Node 18+) drops a permessage-deflate frame when
// the peer's close frame and FIN land in the same TCP chunk, surfacing as a
// 1006 with the final message lost. In Node always use the `ws` package;
// everywhere else use the native implementation. Resolved per connection (not
// module-load), and an overridden globalThis.WebSocket (e.g. a test stub) is
// honored in every runtime.
function preferredWebSocket(): typeof WebSocket {
  const global = globalThis.WebSocket;
  if (typeof process !== 'undefined' && typeof process.versions?.node === 'string' && global !== undefined) {
    // Node's built-in WebSocket is `class _WebSocket extends EventTarget`
    // (undici); anything else is a deliberate override.
    if (Function.prototype.toString.call(global).startsWith('class _WebSocket')) {
      return NodeWebSocket as unknown as typeof WebSocket;
    }
    return global;
  }
  return global ?? (NodeWebSocket as unknown as typeof WebSocket);
}
export { preferredWebSocket };
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
import {
  defaultAcpProxyWsUrl,
  defaultAgentsWsUrl,
  defaultHyperAcpWsUrl,
  normalizeAgentsWsUrl,
  resolveAgentsApiBase,
} from './agent-urls.js';
import { getAgentsApiBaseUrl, getConfigValue } from './config.js';
export {
  parseControlUiAllowedOrigins,
} from './openclaw-control-ui-origin.js';
import {
  subscribeBuzzActivity,
  subscribeBuzzActivityRoute,
  type BuzzActivityHandlers,
  type BuzzActivityRouteHandlers,
  type BuzzActivitySubscription,
} from './buzz-activity.js';
import {
  CodingAgentAcpClient,
  type CodingAgentAcpConnectOptions,
} from './acp.js';
import { CodingAgentAcpPool } from './acp-pool.js';
import { AcpTurnDriver, type AcpTurnDriverOptions } from './acp-driver.js';
export {
  CodingAgentAcpClient,
  CodingAgentAcpConnectionError,
  CodingAgentAcpReplayGapError,
  CodingAgentAcpUnavailableError,
  ACP_RECONNECT_DELAYS_MS,
  type CodingAgentAcpConnectOptions,
} from './acp.js';
export {
  AcpTurnDriver,
  ACP_BUNDLE_FRAMING_HEADER,
  type AcpTurnBundle,
  type AcpTurnDriverOptions,
  type AcpTurnDriverState,
  type AcpTurnOutcome,
} from './acp-driver.js';
export { CodingAgentAcpPool, type AcpLease } from './acp-pool.js';
// Activity-transport error classes, re-exported here so consumers can classify
// failures without pulling the SDK root entry into their bundle.
export {
  BuzzActivityGapError,
  BuzzActivityRouteUnavailableError,
} from './buzz-activity.js';
import { APIError } from './errors.js';
import { HTTPClient, type RequestOverrides } from './http.js';
import { normalizeSlackRelayBaseUrl } from './channels.js';
const DEPLOYMENTS_API_PREFIX = '/deployments';
export const DEFAULT_OPENCLAW_IMAGE = 'ghcr.io/hypercli/hypercli-openclaw:prod';
export const DEFAULT_OPENCLAW_PRO_IMAGE = 'ghcr.io/hypercli/hypercli-openclaw:pro-prod';
export const DEFAULT_HERMES_AGENT_IMAGE = 'ghcr.io/hypercli/hypercli-hermes:latest';
export const DEFAULT_OPENCODE_IMAGE = 'ghcr.io/hypercli/hypercli-opencode:latest';
export const DEFAULT_CODEX_IMAGE = 'ghcr.io/hypercli/hypercli-codex:latest';
export const DEFAULT_CLAUDE_CODE_IMAGE = 'ghcr.io/hypercli/hypercli-claude:latest';
export const DEFAULT_GOOSE_IMAGE = 'ghcr.io/hypercli/hypercli-goose:latest';
export const DEFAULT_KIMI_CODE_IMAGE = 'ghcr.io/hypercli/hypercli-kimi-code:latest';
export const DEFAULT_PI_IMAGE = 'ghcr.io/hypercli/hypercli-pi:latest';
export const DEFAULT_BUZZ_AGENT_IMAGE = 'ghcr.io/hypercli/hypercli-buzz-agent:latest';
export const DEFAULT_BUZZ_OPENCODE_IMAGE = DEFAULT_OPENCODE_IMAGE;
export const DEFAULT_BUZZ_CODEX_IMAGE = DEFAULT_CODEX_IMAGE;
export const DEFAULT_BUZZ_CLAUDE_CODE_IMAGE = DEFAULT_CLAUDE_CODE_IMAGE;
export const DEFAULT_BUZZ_GOOSE_IMAGE = DEFAULT_GOOSE_IMAGE;
export const DEFAULT_BUZZ_KIMI_CODE_IMAGE = DEFAULT_KIMI_CODE_IMAGE;
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
// Runner-docker bind-mount cap; matches the Backend wire model
// (AssignmentDockerOptions.volumes max_length).
export const MAX_DOCKER_VOLUMES = 64;
export const DEFAULT_PI_ENV = Object.freeze({
  HYPER_RUNTIME_HOME: `${DEFAULT_CODING_AGENT_SYNC_ROOT}/.pi/agent`,
});
export type ManagedAgentRuntime =
  | 'generic'
  | 'openclaw'
  | 'openclaw-pro'
  | 'hermes-agent'
  | 'openclaw_acp'
  | 'hermes_acp'
  | 'buzz-agent'
  | 'opencode'
  | 'codex'
  | 'claude-code'
  | 'goose'
  | 'kimi-code'
  | 'pi';
export type CodingAgentRuntime = Extract<ManagedAgentRuntime, 'buzz-agent' | 'opencode' | 'codex' | 'claude-code' | 'goose' | 'kimi-code' | 'pi'>;
/**
 * Runtime labels whose pods front `hyper-acp`, so the ACP members on
 * {@link Agent} (acpConnect/acpPool/acpTurnDriver/auth) accept them; the gate
 * mirrors the old hydration gating — labeled runtimes by this set, legacy
 * unlabeled openclaw payloads structurally (see Agent.requireAcpCapable).
 */
const HYPER_ACP_RUNTIMES: ReadonlySet<string> = new Set<ManagedAgentRuntime>([
  'openclaw',
  'openclaw-pro',
  'hermes-agent',
  'openclaw_acp',
  'hermes_acp',
  'buzz-agent',
  'opencode',
  'codex',
  'claude-code',
  'goose',
  'kimi-code',
  'pi',
]);
export const DEFAULT_CODING_AGENT_IMAGES: Readonly<Record<CodingAgentRuntime, string>> = {
  'buzz-agent': DEFAULT_BUZZ_AGENT_IMAGE,
  opencode: DEFAULT_OPENCODE_IMAGE,
  codex: DEFAULT_CODEX_IMAGE,
  'claude-code': DEFAULT_CLAUDE_CODE_IMAGE,
  goose: DEFAULT_GOOSE_IMAGE,
  'kimi-code': DEFAULT_KIMI_CODE_IMAGE,
  pi: DEFAULT_PI_IMAGE,
};
export const DEFAULT_CODING_AGENT_SYNC_INCLUDES: Readonly<Record<CodingAgentRuntime, readonly string[] | null>> = {
  'buzz-agent': null,
  opencode: [
    '.hypercli/USER.md', '.hypercli/SOUL.md',
    '.config/opencode',
    '.local/share/opencode',
    '.local/state/opencode',
    '.cache/opencode',
  ],
  codex: ['.codex', '.hypercli/USER.md', '.hypercli/SOUL.md'],
  'claude-code': ['.claude', '.claude.json', '.hypercli/USER.md', '.hypercli/SOUL.md'],
  goose: ['.goose', '.hypercli/USER.md', '.hypercli/SOUL.md'],
  'kimi-code': ['.kimi-code', '.hypercli/USER.md', '.hypercli/SOUL.md'],
  // Native agent state and pi-acp metadata (~/.pi/pi-acp).
  pi: ['.pi', '.hypercli/USER.md', '.hypercli/SOUL.md'],
};
export const DEFAULT_BUZZ_CODING_AGENT_IMAGES: Readonly<Record<CodingAgentRuntime, string>> = {
  'buzz-agent': DEFAULT_BUZZ_AGENT_IMAGE,
  opencode: DEFAULT_BUZZ_OPENCODE_IMAGE,
  codex: DEFAULT_BUZZ_CODEX_IMAGE,
  'claude-code': DEFAULT_BUZZ_CLAUDE_CODE_IMAGE,
  goose: DEFAULT_BUZZ_GOOSE_IMAGE,
  'kimi-code': DEFAULT_BUZZ_KIMI_CODE_IMAGE,
  pi: DEFAULT_PI_IMAGE,
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
    command: '/opt/hypercli/bin/opencode',
    args: ['acp'],
    mcpCommand: '',
  },
  codex: {
    command: '/opt/hypercli/bin/codex-acp',
    args: [],
    mcpCommand: '/usr/local/lib/acp/buzz/sprig',
  },
  'claude-code': {
    command: '/opt/hypercli/bin/claude-agent-acp',
    args: [],
    mcpCommand: '',
  },
  goose: {
    command: '/usr/local/bin/goose',
    args: ['acp'],
    mcpCommand: '',
  },
  'kimi-code': {
    command: '/opt/hypercli/bin/kimi',
    args: ['acp'],
    mcpCommand: '',
  },
  pi: {
    command: '/opt/hypercli/bin/pi-acp',
    args: [],
    mcpCommand: '',
  },
};
export const DEFAULT_BUZZ_RUST_LOG =
  'hyper_acp=info,buzz_acp=info,pool::prompt=info,acp::stream=off';
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
  'BUZZ_AGENT_REQUIRE_REPLY',
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
  'HYPER_ACP_WS_URL',
  'HYPER_ACP_AGENT_COMMAND',
  'HYPER_ACP_AGENT_ARGS',
  'HYPER_ACP_WS_LISTEN',
  'HYPER_ACP_LOG',
  'HYPER_ACP_WS_TOKEN',
  'HYPER_ACP_AUTO_APPROVE_PERMISSION',
  'HYPER_ACP_PERMISSIONS',
  'HYPER_ACP_PERMISSION_MODE',
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
export const WORKSPACES_SYNC_ENV_DEFAULTS = {
  HYPER_WORKSPACES_BOOT_SYNC: '1',
  HYPER_WORKSPACES_DIR: '/home/node/shared',
  HYPER_WORKSPACES_SYNC_READY_ONLY: '1',
} as const;
export const OPENCLAW_CRON_ENV_DEFAULTS = {
  OPENCLAW_CRON_ENABLED: '1',
} as const;
export const HERMES_CRON_ENV_DEFAULTS = {
  HERMES_CRON_ENABLED: '1',
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
  'executor',
  'docker',
]);
const DEFAULT_OPENCLAW_SYNC_ROOT = '/home/node';
export const DEFAULT_HERMES_AGENT_SYNC_ROOT = '/home/hermes';
export const DEFAULT_HERMES_AGENT_SYNC_EXCLUDE = ['shared/**'] as const;
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

/** Buffered exec stdin cap, mirrored by the backend exec protocol. */
export const AGENT_EXEC_STDIN_MAX_BYTES = 262_144;

export interface AgentMetricsResult {
  event: 'agent_metrics_result';
  ok: true;
  cpu: string;
  memory: string;
  timestamp: number;
}

export interface AgentOperationTokenResponse {
  agent_id: string;
  token: string;
  expires_at: string;
  ws_url: string;
}

export interface AgentTokenResponse {
  agent_id?: string;
  token: string;
  expires_at?: string | null;
  desktop_viewport?: { width: number; height: number } | null;
}

export interface BrowserDesktopUrlOptions {
  redirect?: string | null;
  resize?: string | null;
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

export interface AgentShellTokenResponse {
  agent_id: string;
  token: string;
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
  token: string;
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
  /** Request headers to remove before forwarding upstream. */
  remove_headers?: string[];
}

export interface AgentCorsConfig {
  allowed_origins: string[];
  allow_credentials?: boolean;
  allowed_headers?: string[];
  allowed_methods?: string[];
  max_age?: number;
}

function routeConfigBody(route: AgentRouteConfig): Record<string, unknown> {
  const body: Record<string, unknown> = { port: route.port };
  if (route.auth !== undefined) body.auth = route.auth;
  if (route.prefix !== undefined) body.prefix = route.prefix;
  if (route.remove_headers?.length) body.remove_headers = route.remove_headers;
  return body;
}

function routesConfigBody(routes: Record<string, AgentRouteConfig> | null | undefined): Record<string, AgentRouteConfig> {
  return Object.fromEntries(
    Object.entries(routes ?? {}).map(([name, route]) => [name, routeConfigBody(route) as unknown as AgentRouteConfig]),
  );
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

/** Runner-docker launch options; bind mounts use Compose short syntax (`source:target[:ro]`). */
export interface AgentDockerOptions {
  volumes?: string[];
}

/** Runner executor; required for runner-placed agents, forbidden for hosted agents. */
export type AgentExecutor = 'process' | 'docker';

/** Complete Backend launch_config replacement contract. */
export interface AgentLaunchConfig {
  config?: Record<string, any>;
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
  executor?: AgentExecutor;
  docker?: AgentDockerOptions | null;
}

const REQUIRED_START_LAUNCH_CONFIG_KEYS: ReadonlyArray<keyof AgentLaunchConfig> = [
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

const OPENCLAW_SECRET_ONLY_ENV_KEYS = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_USER_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_RELAY_AUTH_TOKEN',
] as const;

function rejectOpenClawSecretOnlyEnv(env: Record<string, unknown>, noun = 'env'): void {
  const matches = OPENCLAW_SECRET_ONLY_ENV_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(env, key));
  if (matches.length > 0) {
    throw new Error(`${matches.join(', ')} must be supplied through secrets, not ${noun}`);
  }
}

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
  const executor = value.executor;
  if (executor !== undefined && executor !== null && executor !== 'process' && executor !== 'docker') {
    throw new Error("launchConfig executor must be 'process' or 'docker'");
  }
  if (executor === 'process' && value.docker != null) {
    throw new Error('docker launch options require the docker executor');
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
  /** Runner executor (process runs the command on the runner host, docker runs the image). */
  executor?: AgentExecutor;
  /** Runner-docker launch options (Compose-shape bind volumes); runner placements only. */
  docker?: AgentDockerOptions | null;
}

export interface OpenClawRouteOptions {
  includeDesktop?: boolean;
  desktopPort?: number;
  desktopAuth?: boolean;
  desktopPrefix?: string;
}

export const OPENCLAW_TRUSTED_PROXIES_ENV = 'OPENCLAW_TRUSTED_PROXIES';
const DEFAULT_OPENCLAW_MODEL_ENV = Object.freeze({
  HYPER_MODELS: 'default-anthropic',
  HYPER_EMBEDDING_MODELS: 'qwen3-embedding-4b',
});
const DEFAULT_HERMES_MODEL_ENV = DEFAULT_OPENCLAW_MODEL_ENV;

export function buildOpenClawTrustedProxiesEnv(trustedProxies: readonly string[] | null | undefined): Record<string, string> {
  const proxies = (trustedProxies ?? []).map((proxy) => proxy.trim()).filter(Boolean);
  return proxies.length > 0 ? { [OPENCLAW_TRUSTED_PROXIES_ENV]: proxies.join(',') } : {};
}

export interface OpenClawMemoryIndexOptions {
  enabled?: boolean | null;
  onSessionStart?: boolean | null;
  onSearch?: boolean | null;
  watch?: boolean | null;
  watchDebounceMs?: number | null;
  intervalMinutes?: number | null;
}

export interface WorkspacesSyncOptions {
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
  description?: string | null;
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

/**
 * Self-hosted runner placement for POST /deployments
 * (docs/future/RUNNER.md). Tags match runner tags for the same owner;
 * runnerId pins one runner when tags are ambiguous.
 */
export interface RunnerTargetOptions {
  tags?: string[];
  runnerId?: string | null;
}

export interface CreateAgentOptions extends BuildAgentConfigOptions {
  name?: string;
  handle?: string | null;
  size?: string;
  config?: Record<string, any>;
  meta?: AgentMeta | null;
  tags?: string[];
  runner?: RunnerTargetOptions | null;
  dryRun?: boolean;
  runtime?: ManagedAgentRuntime;
}

export interface StartAgentOptions {
  dryRun?: boolean;
}

/**
 * Options for the deployment lifecycle actions stop, archive, restore, and
 * delete. Mirrors the Backend's LifecycleActionRequest (extra="forbid").
 */
export interface LifecycleActionOptions {
  /**
   * Validate the action only. The Backend returns the current Agent record
   * unchanged -- nothing mutates and the state stays as it was (the Agent is
   * not stopped, archived, restored, or deleted).
   */
  dryRun?: boolean;
}

export interface UpdateAgentOptions {
  ui?: Pick<AgentUiMeta, 'description'>;
  name?: string;
  handle?: string | null;
  size?: string;
  launchConfig?: Record<string, any> | null;
  /** Runtime family label; re-labeling is allowed at any time. */
  runtime?: ManagedAgentRuntime;
  /** Replace the stored launch image with the platform default for the (new or current) runtime on next start. Requires the agent stopped. */
  resetImage?: boolean;
  /** @deprecated Not accepted by the backend (UpdateAgentRequest is extra="forbid"); ignored. */
  refreshFromLagoon?: boolean;
  /** @deprecated Not accepted by the backend (UpdateAgentRequest is extra="forbid"); ignored. */
  error?: string | null;
}

export interface ResetRuntimeDefaultsOptions {
  runtime: ManagedAgentRuntime;
}

export interface ResetRuntimeDefaultsResult {
  agent: Agent;
  droppedLaunchKeys: string[];
}

function droppedLaunchConfigKeys(data: { warnings?: unknown }): string[] {
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];
  return warnings
    .filter((warning): warning is { code?: unknown; dropped_keys?: unknown } => (
      Boolean(warning) && typeof warning === 'object'
    ))
    .filter((warning) => warning.code === 'unsupported_launch_config_keys_dropped')
    .flatMap((warning) => (
      Array.isArray(warning.dropped_keys) ? warning.dropped_keys.map(String) : []
    ));
}

/**
 * Folded create options for {@link Deployments.createAgent}: the generic
 * launch contract plus every per-runtime facade knob
 * (openClawRoutes/trustedProxies/cronEnabled/memoryIndex/
 * workspacesSync/permissionMode/buzz). A runtime's
 * own launch branch reads the knobs it understands and ignores the rest,
 * exactly as the old per-runtime facades ignored fields outside their type.
 *
 * There is no Slack knob: hosted Slack is relay-attached after create
 * (`attachSlackRelayAgent`); the agents never dial a channel relay, so no
 * Slack launch env exists to set here.
 */
export interface ManagedAgentCreateOptions extends CreateAgentOptions {
  openClawRoutes?: OpenClawRouteOptions | null;
  /** Trusted proxies written as OPENCLAW_TRUSTED_PROXIES, replacing gateway.trustedProxies. */
  trustedProxies?: string[] | null;
  cronEnabled?: boolean | null;
  memoryIndex?: OpenClawMemoryIndexOptions | null;
  workspacesSync?: WorkspacesSyncOptions | boolean | null;
  /**
   * Permission preset for the launch-config env `HYPER_ACP_PERMISSIONS`
   * JSON. Defaults to `'default'` (allow-all). Caller env wins; Buzz launches
   * strip the key entirely (buzz-backend-provider owns that env surface).
   */
  permissionMode?: PermissionMode;
  /** @deprecated Use the typed `buzz` launch contract. */
  buzzEnabled?: boolean;
  /** Launch Buzz ACP with runtime-specific harness and MCP defaults. */
  buzz?: BuzzLaunchConfig | null;
  /**
   * @deprecated Hosted Buzz now always uses the raw outbound hyper-acp tunnel.
   * The old observer route is no longer provisioned.
   */
  buzzActivity?: boolean;
}

/** @deprecated Use `ManagedAgentCreateOptions` with `Deployments.createAgent('openclaw' | 'openclaw-pro', options)`. */
export type OpenClawCreateAgentOptions = Omit<ManagedAgentCreateOptions, 'config'>;

/** @deprecated Use `ManagedAgentCreateOptions` with `Deployments.createAgent('hermes-agent', options)`. */
export type HermesAgentCreateOptions = ManagedAgentCreateOptions;

/** Permission preset names for coding-agent launch env `HYPER_ACP_PERMISSIONS`. */
export type PermissionMode =
  | 'default'
  | 'auto'
  | 'bypass-permissions'
  | 'accept-edits'
  | 'plan'
  | 'dont-ask'
  | 'buzz-hosted';

export type PermissionAction = 'allow' | 'ask' | 'deny';
export type PermissionRules = Record<string, PermissionAction | Record<string, PermissionAction>>;

// Canonical key order; the harness compares the serialized bytes
// (buzz-backend-provider pins the buzz-hosted preset byte-for-byte).
const PERMISSION_PRESETS: Record<PermissionMode, PermissionRules> = {
  default: { '*': 'allow' },
  auto: { '*': 'allow' },
  'bypass-permissions': { '*': 'allow' },
  'accept-edits': {
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    edit: 'allow',
    todowrite: 'allow',
    '*': 'ask',
  },
  plan: {
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    lsp: 'allow',
    question: 'allow',
    edit: 'deny',
    bash: 'deny',
    task: 'deny',
    external_directory: 'deny',
    skill: 'deny',
    webfetch: 'deny',
    websearch: 'deny',
    '*': 'deny',
  },
  'dont-ask': {
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    '*': 'deny',
  },
  'buzz-hosted': {
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    lsp: 'allow',
    todowrite: 'allow',
    question: 'allow',
    edit: 'allow',
    doom_loop: 'deny',
    external_directory: 'allow',
    bash: {
      'sprig *': 'allow',
      'sprig': 'allow',
      'buzz *': 'allow',
      'buzz': 'allow',
      'hyper *': 'allow',
      'git *': 'allow',
      '*': 'deny',
    },
    webfetch: 'allow',
    websearch: 'allow',
    skill: 'allow',
    task: 'allow',
    '*': 'deny',
  },
};

/**
 * Serialize the opencode ConfigPermissionV1 permission JSON for a preset
 * mode, optionally layered with caller overrides. The output is what
 * `HYPER_ACP_PERMISSIONS` carries in launch-config env; hyper-acp translates
 * it to `OPENCODE_PERMISSION` at child spawn.
 */
export function buildPermissionsJson(mode: PermissionMode, overrides?: PermissionRules): string {
  const preset = PERMISSION_PRESETS[mode] ?? PERMISSION_PRESETS.default;
  return JSON.stringify(overrides ? { ...preset, ...overrides } : preset);
}

/** @deprecated Use `ManagedAgentCreateOptions` with `Deployments.createAgent(runtime, options)`. */
export type CodingAgentCreateOptions = Omit<ManagedAgentCreateOptions, 'runtime'>;

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
    env.CLAUDE_CODE_EXECUTABLE = '/opt/hypercli/bin/claude';
  }
  if (buzz.rustLog) env.RUST_LOG = buzz.rustLog;
  const optional: Record<string, string | undefined | null> = {
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
  if (buzz.requireReply !== false) {
    env.BUZZ_ACP_REQUIRE_REPLY = 'true';
    if (runtime === 'buzz-agent') env.BUZZ_AGENT_REQUIRE_REPLY = '1';
  } else if (runtime === 'buzz-agent') {
    env.BUZZ_AGENT_REQUIRE_REPLY = '0';
  }
  return env;
}

function buildBuzzLaunchSecrets(buzz: BuzzLaunchConfig): Record<string, string> {
  if (!buzz.privateKeyNsec.trim()) throw new Error('buzz.privateKeyNsec is required');
  const secrets: Record<string, string> = {
    BUZZ_PRIVATE_KEY: buzz.privateKeyNsec,
    NOSTR_PRIVATE_KEY: buzz.privateKeyNsec,
  };
  // The NIP-OA attestation is a bearer credential: keep it in the k8s-backed
  // secrets projection (unrolled to env at launch) rather than plaintext env.
  if (buzz.authTag) secrets.BUZZ_AUTH_TAG = buzz.authTag;
  return secrets;
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
  /**
   * Optional buffered stdin delivered to the command, then closed (stdin EOF).
   * Omit on interactive callers; the pod command sees stdin attached only
   * when this is set.
   */
  stdin?: string | Uint8Array;
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

type ReefFileAccess = { url: string; token: string };
type AgentFileAccess = ReefFileAccess | { transport: 'runner' };
/** Native control frames are deliberately bounded for prompt/markdown files. */
export const RUNNER_FILE_MAX_BYTES = 262_144;

function nativeFilePath(path: string): string {
  if (!path || encodeUtf8(path).byteLength > 4096 || /[\\:\0]/.test(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..' || /[ .]$/.test(part))) {
    throw new Error('Runner file paths must be portable paths relative to the assignment root');
  }
  return path;
}

function resolveSyncRootFilePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.includes('\0')) {
    throw new Error('agent file paths must be relative to the sync root');
  }
  const parts = normalized.split('/');
  if (parts.includes('..')) {
    throw new Error('agent file paths must stay within the sync root');
  }
  return parts.filter((part) => part && part !== '.').join('/');
}

function normalizeWritableBackendFilePath(path: string): string {
  return resolveSyncRootFilePath(path);
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

/** Backend-discovered file access scoped to an agent's retained storage root. */
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
  | 'NO_NAMESPACE'
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
  'NO_NAMESPACE',
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
  'NO_NAMESPACE',
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
  avatarAudioUrl?: string | null;
  displayIdentity?: Record<string, any> | null;
  runtime?: string | null;
  managed?: boolean | null;
  isLaunchable?: boolean;
  gatewayId?: string | null;
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
  /** Pinned self-hosted runner placement, when the Agent deployment is runner-bound. */
  runner?: { tags: string[]; runnerId: string | null } | null;
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
  avatar_audio_url?: string | null;
  display_identity?: Record<string, any> | null;
  runtime?: string | null;
  managed?: boolean | null;
  is_launchable?: boolean;
  gateway_id?: string | null;
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
  runner?: { tags?: string[]; runner_id?: string | null } | null;
  launch_epoch?: number;
  created_at?: string | null;
  updated_at?: string | null;
  launch_config?: Record<string, any> | null;
  meta?: Record<string, any> | null;
  routes?: Record<string, AgentRouteConfig> | null;
  command?: string[] | null;
  entrypoint?: string[] | null;
  dry_run?: boolean;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOpenClawRuntime(
  runtime: string | null | undefined,
  routes: unknown = null,
): boolean {
  if (runtime === 'openclaw' || runtime === 'openclaw-pro' || runtime === 'openclaw_acp') return true;
  return !!(routes && typeof routes === 'object' && !Array.isArray(routes)
    && (routes as Record<string, unknown>).openclaw);
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
  const desktopEnabled = getLaunchConfigValue(launchConfig, 'env.HYPER_DESKTOP_ENABLED');
  if (isFalseyEnv(desktopEnabled)) return false;
  if (isTruthyEnv(desktopEnabled)) return true;
  return routesHaveDesktop(getLaunchConfigValue(launchConfig, 'routes'));
}

export function agentConfigHasDesktop(source: AgentDesktopConfigSource | null | undefined): boolean {
  if (!source) return false;
  const launchConfig = source.launchConfig ?? source.launch_config;
  const desktopEnabled = getLaunchConfigValue(launchConfig, 'env.HYPER_DESKTOP_ENABLED');
  if (isFalseyEnv(desktopEnabled)) return false;
  return (
    launchConfigHasDesktop(launchConfig) ||
    routesHaveDesktop(source.routes)
  );
}

function browserDesktopRedirectPath(options: BrowserDesktopUrlOptions = {}): string {
  const redirect = (options.redirect ?? 'vnc_lite.html').trim() || 'vnc_lite.html';
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
    if (resize.trim()) {
      // vnc_lite.html (the default viewer) takes `scale=true`; the full vnc.html
      // UI takes `resize=scale`. Emit the parameter for whichever page the
      // redirect targets.
      const targetsLite = (parsed.pathname.endsWith('vnc_lite.html') || parsed.pathname.endsWith('vnc_auto.html'));
      if (targetsLite) parsed.searchParams.set('scale', resize === 'scale' ? 'true' : resize);
      else parsed.searchParams.set('resize', resize);
    }
  }

  const pathname = parsed.pathname.replace(/^\/+/, '') || 'vnc_lite.html';
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

function isOpenClawProLaunchConfig(launchConfig: unknown): boolean {
  if (!launchConfig || typeof launchConfig !== 'object' || Array.isArray(launchConfig)) return false;
  if (launchConfigHasDesktop(launchConfig)) {
    return true;
  }
  const image = String((launchConfig as { image?: unknown }).image ?? '');
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

export { defaultAcpProxyWsUrl, defaultHyperAcpWsUrl, resolveAgentsApiBase } from './agent-urls.js';

function randomHexToken(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(buffer);
  } else {
    randomFillSync(bytes ? buffer.subarray(0, bytes) : buffer);
  }
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

function encodeBase64(data: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data).toString('base64');
  }
  // Browser fallback: btoa over chunked binary string (avoids arg-limit blowups)
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(binary);
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
  const base = purpose === 'shell'
    ? ['agent_id', 'expires_at', 'shell', 'ws_url']
    : ['agent_id', 'expires_at', 'ws_url'];
  const invalid = () => new Error(`Backend returned an invalid Agent ${purpose} token response`);
  if (!isPlainRecord(value)) throw invalid();
  if (!ownKeysEqual(value, [...base, 'token']) || typeof value.token !== 'string' || !value.token) {
    throw invalid();
  }
  if (
    value.agent_id !== agentId
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
  return value as unknown as
    AgentOperationTokenResponse | AgentShellTokenResponse;
}

function validateDeploymentEventToken(value: unknown): { token: string; ws_url: string } {
  const invalid = () => new Error('Backend returned an invalid deployment event token response');
  if (!isPlainRecord(value) || !ownKeysEqual(value, ['token', 'ws_url'])) throw invalid();
  if (typeof value.token !== 'string' || !value.token || typeof value.ws_url !== 'string' || !value.ws_url) {
    throw invalid();
  }
  let parsed: URL;
  try {
    parsed = new URL(value.ws_url);
  } catch {
    throw invalid();
  }
  if (!['ws:', 'wss:'].includes(parsed.protocol) || !parsed.hostname || parsed.search || parsed.hash) {
    throw invalid();
  }
  return { token: value.token, ws_url: value.ws_url };
}

function validateAgentLogsToken(value: unknown): AgentLogsTokenResponse {
  const invalid = () => new Error('Backend returned an invalid Agent logs token response');
  if (!isPlainRecord(value)) throw invalid();
  if (!ownKeysEqual(value, ['agent_id', 'expires_at', 'token', 'ws_url'])) throw invalid();
  if (typeof value.token !== 'string' || !value.token) throw invalid();
  if (typeof value.agent_id !== 'string' || !value.agent_id) throw invalid();
  if (typeof value.expires_at !== 'string' || !value.expires_at) throw invalid();
  if (typeof value.ws_url !== 'string' || !value.ws_url) throw invalid();
  if (typeof value.ws_url === 'string') {
    let parsed: URL;
    try {
      parsed = new URL(value.ws_url);
    } catch {
      throw invalid();
    }
    if (!['ws:', 'wss:'].includes(parsed.protocol) || !parsed.hostname || parsed.search || parsed.hash) {
      throw invalid();
    }
  }
  return value as unknown as AgentLogsTokenResponse;
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
    avatarAudioUrl: data.avatar_audio_url ?? null,
    displayIdentity: data.display_identity ? structuredClone(data.display_identity) : null,
    runtime: data.runtime ?? null,
    managed: data.managed ?? null,
    isLaunchable: data.is_launchable ?? data.managed !== false,
    gatewayId: data.gateway_id ?? null,
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
    runner: isPlainRecord(data.runner)
      ? {
          tags: Array.isArray(data.runner.tags) ? data.runner.tags.map(String) : [],
          runnerId: typeof data.runner.runner_id === 'string' ? data.runner.runner_id : null,
        }
      : null,
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

function normalizeExecutor(executor: string | null | undefined): AgentExecutor | undefined {
  // undefined/null leaves the stored executor alone; the Backend treats
  // pre-existing runner rows without one as docker.
  if (executor === undefined || executor === null) return undefined;
  if (executor !== 'process' && executor !== 'docker') {
    throw new Error("executor must be 'process' or 'docker'");
  }
  return executor;
}

function normalizeDockerOptions(docker: AgentDockerOptions | null | undefined): AgentDockerOptions | null | undefined {
  // undefined leaves stored runner docker options alone; null (or an empty
  // volumes list) clears them, because the Backend treats provided-but-empty
  // docker as absent on a replacement write.
  if (docker === undefined) return undefined;
  if (docker === null) return null;
  if (!isPlainRecord(docker)) throw new Error('docker accepts only a volumes list');
  const extra = Object.keys(docker).filter((key) => key !== 'volumes');
  if (extra.length > 0) throw new Error(`Unsupported docker settings: ${extra.sort().join(', ')}`);
  const volumes = docker.volumes ?? [];
  if (!Array.isArray(volumes) || volumes.some((volume) => typeof volume !== 'string')) {
    throw new Error('docker volumes must be a list of strings');
  }
  if (volumes.length > MAX_DOCKER_VOLUMES) {
    throw new Error(`docker volumes accept at most ${MAX_DOCKER_VOLUMES} entries`);
  }
  for (const volume of volumes) {
    const segments = volume.split(':');
    if (segments.length < 2 || segments.length > 3) {
      throw new Error(`docker volume must be source:target[:ro]: ${volume}`);
    }
    const [source, target] = segments;
    if (!source || !target || volume.includes('\0')) {
      throw new Error(`docker volume paths must be non-empty and NUL-free: ${volume}`);
    }
    if (!source.startsWith('/') || !target.startsWith('/')) {
      throw new Error(`docker volume source and target must be absolute: ${volume}`);
    }
    if (segments.length === 3 && segments[2] !== 'ro') {
      throw new Error(`docker volume mode must be ro or omitted: ${volume}`);
    }
  }
  if (volumes.length === 0) return null;
  return { volumes: [...volumes] };
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
    image: options.image ?? null,
    env,
    secrets,
    routes: routesConfigBody(options.routes),
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
  if (Object.keys(preparedConfig).length > 0) prepared.config = preparedConfig;
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
  const docker = normalizeDockerOptions(options.docker);
  const executor = normalizeExecutor(options.executor);
  if (executor === 'process' && docker != null) {
    throw new Error('docker launch options require the docker executor');
  }
  if (docker !== undefined) prepared.docker = docker;
  if (executor !== undefined) prepared.executor = executor;
  return { config: prepared };
}

function buildAgentCreateConfig(
  config: Record<string, any>,
  options: BuildAgentConfigOptions,
): Record<string, any> {
  const complete = buildAgentConfig(config, options).config;
  const prepared: Record<string, any> = {};
  if (complete.config && Object.keys(complete.config).length > 0) prepared.config = complete.config;
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
  if (complete.docker) prepared.docker = complete.docker;
  if (complete.executor !== undefined) prepared.executor = complete.executor;
  return prepared;
}

function defaultOpenClawImage(
  runtime: string,
  image: string | null | undefined,
): string {
  if (image !== undefined && image !== null) return image;
  return runtime === 'openclaw-pro' ? DEFAULT_OPENCLAW_PRO_IMAGE : DEFAULT_OPENCLAW_IMAGE;
}

function defaultHermesAgentImage(image: string | null | undefined): string {
  if (image !== undefined && image !== null) return image;
  return DEFAULT_HERMES_AGENT_IMAGE;
}

function prepareOpenClawLaunch(
  options: OpenClawCreateAgentOptions,
): {
  env: Record<string, string>;
  secrets: Record<string, string>;
} {
  const env = { ...(options.env ?? {}) };
  rejectOpenClawSecretOnlyEnv(env);
  const secrets = { ...(options.secrets ?? {}) };
  // OpenClaw treats this env as a full replace for
  // gateway.controlUi.allowedOrigins, and every HyperCLI surface (desktop,
  // console) drives the control UI from dynamic origins. The only value that
  // lands reliably is the wildcard — always write it.
  env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN = '*';
  Object.assign(env, buildOpenClawTrustedProxiesEnv(options.trustedProxies));
  return { env, secrets };
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
    restartRequired: payload.restart_required !== false,
    teamId: typeof payload.team_id === 'string' ? payload.team_id : null,
    teamName: typeof payload.team_name === 'string' ? payload.team_name : null,
    botUserId: typeof payload.bot_user_id === 'string' ? payload.bot_user_id : null,
  };
}

export function buildOpenClawDesktopRoute(options: OpenClawRouteOptions = {}): Record<string, AgentRouteConfig> {
  return {
    desktop: {
      port: options.desktopPort ?? 3000,
      auth: options.desktopAuth ?? true,
      prefix: options.desktopPrefix ?? 'desktop',
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

export function buildOpenClawCronEnv(enabled: boolean | null = null): Record<string, string> {
  return {
    ...OPENCLAW_CRON_ENV_DEFAULTS,
    ...(enabled !== null ? { OPENCLAW_CRON_ENABLED: envBool(enabled) } : {}),
  };
}

export function buildHermesCronEnv(enabled: boolean | null = null): Record<string, string> {
  return {
    ...HERMES_CRON_ENV_DEFAULTS,
    ...(enabled !== null ? { HERMES_CRON_ENABLED: envBool(enabled) } : {}),
  };
}

export function buildWorkspacesSyncEnv(
  workspacesSync: WorkspacesSyncOptions | boolean | null = null,
): Record<string, string> {
  if (workspacesSync === false) return { HYPER_WORKSPACES_BOOT_SYNC: '0' };
  const options = typeof workspacesSync === 'object' && workspacesSync !== null ? workspacesSync : {};
  if (options.enabled === false) return { HYPER_WORKSPACES_BOOT_SYNC: '0' };
  const env: Record<string, string> = { ...WORKSPACES_SYNC_ENV_DEFAULTS };
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
  public readonly avatarAudioUrl: string | null;
  public readonly displayIdentity: Record<string, any> | null;
  public readonly runtime: string | null;
  public readonly managed: boolean | null;
  public readonly isLaunchable: boolean;
  public readonly gatewayId: string | null;
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
  public readonly runner: { tags: string[]; runnerId: string | null } | null;
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
    this.avatarAudioUrl = fields.avatarAudioUrl ?? null;
    this.displayIdentity = fields.displayIdentity ? structuredClone(fields.displayIdentity) : null;
    this.runtime = fields.runtime ?? null;
    this.managed = fields.managed ?? null;
    this.isLaunchable = fields.isLaunchable ?? true;
    this.gatewayId = fields.gatewayId ?? null;
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
    this.runner = fields.runner ?? null;
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

  /**
   * ACP-capable gating, mirroring the old hydration class choice: a labeled
   * runtime must front hyper-acp (HYPER_ACP_RUNTIMES); legacy payloads without
   * a runtime label pass the structural openclaw / openclaw-pro detection the
   * hydration gating used. Anything else has no ACP bridge to dial.
   */
  protected requireAcpCapable(): void {
    const runtime = this.runtime;
    if (runtime !== null && (HYPER_ACP_RUNTIMES as ReadonlySet<string>).has(runtime)) return;
    if (
      isOpenClawRuntime(runtime, this.routes)
      || isOpenClawRuntime(null, this.launchConfig?.routes)
      || isOpenClawProLaunchConfig(this.launchConfig)
    ) return;
    throw new Error(
      `Agent runtime '${runtime ?? 'generic'}' does not front hyper-acp; ` +
      'the ACP surface (acpConnect, acpPool, acpTurnDriver) is available on ACP-capable runtimes only',
    );
  }

  /** Runtime auth flows for this agent's pod (coding runtimes only). */
  get auth(): RuntimeAuthClient {
    return new RuntimeAuthClient(this);
  }

  /**
   * Connect to this agent's ACP surface through the backend session proxy.
   *
   * Default (`options.transport` unset): dials `/ws/acp` — the client-facing
   * ACP session authority (sessions/README §14). The proxy owns the backend
   * session record `{session_id → legs}`, fans runtime frames out to every
   * attached session client, and answers `session/new` with the backend
   * session id (backend-keyed, not the pod-side ACP id). Create-or-attach
   * semantics key on `options.sessionId`:
   *
   * - omitted: the socket starts session-less; `newSession()` runs the
   *   proxy's `session/new`, minting the backend session.
   * - provided: the dial attaches to that session (`?session_id=...`),
   *   joining its live tee first — attach BEFORE `loadSession`/
   *   `resumeSession` so the replayed history stream reaches this
   *   connection. An id the store does not hold fails the connect with
   *   close code 4404 (`ACP_PROXY_UNKNOWN_SESSION_CLOSE_CODE`).
   *
   * `transport: 'direct'` dials the agent-keyed `/ws` bridge instead
   * (`?agent_id&token`), the pre-proxy path. Infra/debug only: `/ws` is
   * being hardened to runtime + backend-service identities, and combining
   * it with `sessionId` throws (the bridge has no session binding).
   *
   * The ACP `initialize` handshake offers protocol version 2 by default and
   * negotiates down to v1 for v1-only runtimes (see
   * `client.negotiatedProtocolVersion`; through the proxy the answer is the
   * min of the offer and the leg's version). The `cwd` default is the agent
   * workspace root (the launch's sync root, `/home/node` for coding-agent
   * runtimes, `/home/hermes` for hermes-agent).
   */
  async acpConnect(options: CodingAgentAcpConnectOptions = {}): Promise<CodingAgentAcpClient> {
    this.requireAcpCapable();
    const deployments = this.requireDeployments();
    const transport = options.transport ?? 'proxy';
    if (transport === 'direct' && options.sessionId) {
      throw new Error(
        "acpConnect: sessionId is a proxy-transport option; the direct /ws bridge " +
        "has no session binding (drop sessionId or use the default 'proxy' transport)",
      );
    }
    const url = new URL(
      transport === 'direct'
        ? defaultHyperAcpWsUrl(deployments.agentApiBase)
        : defaultAcpProxyWsUrl(deployments.agentApiBase),
    );
    url.searchParams.set('agent_id', this.id);
    url.searchParams.set('token', deployments.agentApiKey);
    if (options.sessionId) url.searchParams.set('session_id', options.sessionId);
    const syncRoot = this.launchConfig?.sync_root;
    return CodingAgentAcpClient.connect(
      { url: url.toString(), token: '' },
      { ...options, cwd: options.cwd ?? (typeof syncRoot === 'string' ? syncRoot : DEFAULT_CODING_AGENT_SYNC_ROOT) },
    );
  }

  private acpPoolValue: CodingAgentAcpPool | null = null;

  /**
   * Lazily created connection pool for this agent's ACP surface. Two
   * clients dialed to the same agent share one pod-side stdio session, so all
   * ACP consumers (chat panes, session sweeps, turn drivers) must ride ONE
   * pooled connection via leases instead of dialing their own — the bridge
   * rejects a duplicate runtime attach. The pool closes the connection when
   * the last lease releases, so a lease taken by a long-lived consumer (a
   * turn driver) outlives callers that unmount (a chat pane) and vice versa.
   *
   * Under the default proxy transport the pooled connection dials session-less:
   * prompting a session id the proxy has never seen (a stored id whose
   * runtime was evicted backend-side) fails with an unknown-session error.
   * Prompt against ids created through this proxy, or attach first with a
   * dedicated `acpConnect({ sessionId })`.
   */
  get acpPool(): CodingAgentAcpPool {
    this.requireAcpCapable();
    if (this.acpPoolValue === null) {
      this.acpPoolValue = new CodingAgentAcpPool({ connect: () => this.acpConnect() });
    }
    return this.acpPoolValue;
  }

  /**
   * Acquire a lease on this agent's pooled ACP connection and return a ready
   * per-session {@link AcpTurnDriver} bound to it. `options.sessionId` is the
   * pinned ACP session id (the id the app persists, e.g. under
   * `localStorage["acp-session:<agentId>"]`); drivers are cheap — one per
   * session, all sharing the same lease-held connection — and turn frames for
   * other sessions are ignored per-session. The driver holds its lease until
   * `driver.close()`; the pooled connection stays up for other leaseholders.
   */
  async acpTurnDriver(options: AcpTurnDriverOptions): Promise<AcpTurnDriver> {
    const lease = await this.acpPool.acquire(this.id);
    try {
      return new AcpTurnDriver(lease, options);
    } catch (error) {
      lease.release();
      throw error;
    }
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
    this.jwtToken = data.token ?? null;
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

  async resetRuntimeDefaults(options: ResetRuntimeDefaultsOptions): Promise<ResetRuntimeDefaultsResult> {
    return this.requireDeployments().resetRuntimeDefaults(this.id, options);
  }

  async resize(options: Pick<UpdateAgentOptions, 'size'>): Promise<Agent> {
    return this.requireDeployments().resize(this.id, options);
  }

  /** Accept background archival and return its transitional Agent projection. */
  async archive(options?: LifecycleActionOptions): Promise<Agent> {
    return this.requireDeployments().archive(this.id, options);
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

// Runtime auth surfaces are launch-shape data per runtime label, not class
// behavior. openclaw/hermes-agent pods have no in-pod login flow and carry
// no table entry.
const RUNTIME_AUTH_CONFIG: Record<CodingAgentRuntime, RuntimeAuthConfig> = {
  'buzz-agent': {
    agentCommand: ['buzz-agent'],
    statusCommand: ['hyper-acp', 'plugin', 'models', '--agent-command', 'buzz-agent', '--json'],
    logoutCommand: null,
    nativeMethods: [],
  },
  opencode: {
    agentCommand: ['opencode', 'acp'],
    statusCommand: ['hyper-acp', 'plugin', 'models', '--agent-command', 'opencode', '--agent-args', 'acp', '--json'],
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
    statusCommand: ['hyper-acp', 'plugin', 'models', '--agent-command', 'goose', '--agent-args', 'acp', '--json'],
    logoutCommand: null,
    nativeMethods: [],
  },
  'kimi-code': {
    agentCommand: ['kimi', 'acp'],
    statusCommand: ['hyper-acp', 'plugin', 'models', '--agent-command', 'kimi', '--agent-args', 'acp', '--json'],
    logoutCommand: null,
    nativeMethods: [],
  },
  pi: {
    agentCommand: ['pi-acp'],
    statusCommand: ['hyper-acp', 'plugin', 'models', '--agent-command', 'pi-acp', '--json'],
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

  constructor(public readonly agent: Agent) {
    const config = RUNTIME_AUTH_CONFIG[agent.runtime as CodingAgentRuntime];
    if (!config) {
      throw new Error(`Runtime authentication is not available for runtime '${agent.runtime ?? 'generic'}'`);
    }
    this.config = config;
  }

  async methods(): Promise<RuntimeAuthMethod[]> {
    const [agentCommand, ...agentArgs] = this.config.agentCommand;
    const command = ['hyper-acp', 'plugin', 'auth-methods', '--agent-command', agentCommand];
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
      command = ['hyper-acp', 'plugin', 'authenticate', '--agent-command', agentCommand];
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

/**
 * Every managed runtime — openclaw, openclaw-pro, hermes-agent, and the
 * coding-agent runtimes — boots its pod behind `hyper-acp`, so chat,
 * sessions, runtime auth, and turn driving all ride the same ACP bridge; the
 * runtimes differ only in the `runtime` label plus launch-config data
 * (images, sync roots/uid/gid, harness env). Session protocol behavior is
 * version-keyed (`negotiatedProtocolVersion`), never runtime-keyed.
 *
 * There is no per-runtime facade class: `Agent` carries the ACP members
 * directly and gates them at call time via `requireAcpCapable` and the
 * runtime auth table.
 *
 * @deprecated Every deployment hydrates to the single flat {@link Agent};
 * use `Agent` in place of `CodingAgent`.
 */
export type CodingAgent = Agent;

export class Deployments {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly agentsWsUrl: string;
  private readonly agentHttp: Pick<HTTPClient, 'get' | 'post' | 'postRaw' | 'put' | 'patch' | 'delete'>;

  constructor(
    http: HTTPClient,
    agentApiKey?: string,
    agentApiBase?: string,
    agentsWsUrl?: string,
    requestTimeout?: number,
  ) {
    this.apiKey = agentApiKey || (http as any).apiKey;
    this.apiBase = resolveAgentsApiBase(agentApiBase || getAgentsApiBaseUrl());
    this.agentsWsUrl = normalizeAgentsWsUrl(agentsWsUrl || getConfigValue('AGENTS_WS_URL') || defaultAgentsWsUrl(this.apiBase));
    const agentTimeout = requestTimeout ?? (http instanceof HTTPClient ? (http as any).timeout : undefined);
    this.agentHttp = http instanceof HTTPClient ? new HTTPClient(this.apiBase, this.apiKey, agentTimeout) : http;
  }

  get agentApiKey(): string {
    return this.apiKey;
  }

  get agentApiBase(): string {
    return this.apiBase;
  }

  private hydrateAgent(data: AgentHydrationData): Agent {
    // One flat Agent for every runtime: ACP capability is gated at call time
    // (Agent.requireAcpCapable), not by hydration class.
    return bindAgent(Agent.fromDict(data), this);
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

  private async routesTarget(agentIdOrName: string): Promise<string> {
    const raw = String(agentIdOrName || '').trim();
    if (isSelfAgentRef(raw)) {
      return 'self';
    }
    return this.resolveAgentId(raw);
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

  private async fileAccess(agentId: string): Promise<AgentFileAccess> {
    const payload = await this.agentHttp.post<AgentFileTokenResponse | { transport: 'runner'; executor: 'process' | 'docker'; max_bytes: number }>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/files/token`,
      undefined,
      { redirect: 'error' },
    );
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Backend returned an invalid Agent file token response');
    }
    const fields = 'transport' in payload ? ['transport', 'executor', 'max_bytes'] : ['url', 'token', 'expires_at'];
    if (Object.keys(payload).length !== fields.length || fields.some((key) => !(key in payload))) {
      throw new Error('Backend returned an invalid Agent file token response');
    }
    if ('transport' in payload) {
      if (payload.transport !== 'runner' || !['process', 'docker'].includes(payload.executor) || payload.max_bytes !== RUNNER_FILE_MAX_BYTES) {
        throw new Error('Backend returned an invalid runner file transport');
      }
      return { transport: 'runner' };
    }
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
    access: ReefFileAccess,
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
    if (options.runner) {
      body.runner = {
        ...(options.runner.tags ? { tags: [...options.runner.tags] } : {}),
        ...(options.runner.runnerId ? { runner_id: options.runner.runnerId } : {}),
      };
    }
    if (options.runtime) body.runtime = options.runtime;

    const data = await this.agentHttp.post<AgentHydrationData>(
      DEPLOYMENTS_API_PREFIX,
      body,
      { retries: 1 },
    );
    return this.hydrateAgent(data);
  }

  /**
   * Create a managed agent for a runtime in one call.
   *
   * `runtime` selects the per-runtime launch defaults (image, sync root and
   * include/exclude presets, uid/gid, env presets, routes, boot command) from
   * the SDK's data tables; `options` folds the old per-runtime facade option
   * types — each runtime family reads the knobs it understands and ignores
   * the rest. `create()` stays the raw generic entry; `createAgent` is the
   * typed one.
   *
   * - openclaw/openclaw-pro: OpenClaw ACP launch; pro adds the
   *   desktop route + leg.
   * - hermes-agent: Hermes ACP launch with the hermes image, sync-root, and cron defaults.
   * - buzz-agent/opencode/codex/claude-code/goose/kimi-code/pi: the shared
   *   ACP coding-agent launch contract; `buzz` switches to the Buzz launch.
   */
  async createAgent(runtime: ManagedAgentRuntime, options: ManagedAgentCreateOptions = {}): Promise<Agent> {
    if (runtime === 'generic') return this.create(options);
    if (runtime === 'openclaw' || runtime === 'openclaw-pro' || runtime === 'openclaw_acp') {
      return this.createOpenClawAgent(runtime, options);
    }
    if (runtime === 'hermes-agent' || runtime === 'hermes_acp') {
      return this.createHermesAgentDeployment(runtime, options);
    }
    return this.createCodingAgentDeployment(runtime, options);
  }

  /**
   * Create a hosted OpenClaw Agent.
   *
   * @deprecated Use {@link Deployments.createAgent} with 'openclaw' or
   * 'openclaw-pro'.
   */
  async createOpenClaw(options: OpenClawCreateAgentOptions = {}): Promise<Agent> {
    // The old facade read its label from options.runtime (default 'openclaw');
    // delegating keeps that precedence: an explicit label wins, the same as
    // createAgent's first argument.
    return this.createAgent(options.runtime ?? 'openclaw', options);
  }

  private async createOpenClawAgent(runtime: ManagedAgentRuntime, options: ManagedAgentCreateOptions): Promise<Agent> {
    const prepared = prepareOpenClawLaunch(options);
    const pro = runtime === 'openclaw-pro';
    const effectiveOptions: CreateAgentOptions = {
      ...options,
      runtime,
      secrets: prepared.secrets,
    };
    delete (effectiveOptions as { config?: unknown }).config;
    effectiveOptions.env = {
      // openclaw-pro is the same launch shape with the desktop leg on.
      ...(pro ? { HYPER_DESKTOP_ENABLED: '1' } : null),
      ...buildWorkspacesSyncEnv(options.workspacesSync ?? null),
      ...buildOpenClawCronEnv(options.cronEnabled ?? null),
      ...buildOpenClawMemoryIndexEnv(options.memoryIndex),
      ...DEFAULT_OPENCLAW_MODEL_ENV,
      ...prepared.env,
    };
    const openClawRoutes: OpenClawRouteOptions = pro
      ? { includeDesktop: true, ...(options.openClawRoutes ?? {}) }
      : (options.openClawRoutes ?? {});
    effectiveOptions.routes = options.routes === undefined
      ? (openClawRoutes.includeDesktop ? buildOpenClawDesktopRoute(openClawRoutes) : {})
      : options.routes;
    effectiveOptions.image = defaultOpenClawImage(runtime, options.image);
    if (pro && options.runtimeScopes === undefined) {
      effectiveOptions.runtimeScopes = DEFAULT_AGENT_RUNTIME_SCOPES;
    }
    if (effectiveOptions.syncRoot === undefined) effectiveOptions.syncRoot = DEFAULT_OPENCLAW_SYNC_ROOT;
    if (options.syncInclude === undefined && options.syncExclude === undefined) {
      effectiveOptions.syncExclude = DEFAULT_OPENCLAW_SYNC_EXCLUDE;
    }
    return this.create(effectiveOptions);
  }

  /**
   * @deprecated Use {@link Deployments.createAgent} with 'hermes-agent'; the
   * folded entry takes the same options bag.
   */
  async createHermesAgent(options: HermesAgentCreateOptions = {}): Promise<Agent> {
    // The old facade always launched 'hermes-agent', ignoring options.runtime;
    // the delegation now honors an explicit 'hermes_acp' relabel instead.
    return this.createAgent(options.runtime ?? 'hermes-agent', options);
  }

  private async createHermesAgentDeployment(
    runtime: 'hermes-agent' | 'hermes_acp',
    options: ManagedAgentCreateOptions,
  ): Promise<Agent> {
    const env: Record<string, string> = {
      ...buildHermesCronEnv(options.cronEnabled ?? null),
      ...DEFAULT_HERMES_MODEL_ENV,
      ...(options.env ?? {}),
    };
    const effectiveOptions: CreateAgentOptions = {
      ...options,
      runtime,
      env,
      secrets: options.secrets,
      cors: options.cors,
      image: defaultHermesAgentImage(options.image),
      runtimeScopes: options.runtimeScopes ?? DEFAULT_AGENT_RUNTIME_SCOPES,
      syncRoot: options.syncRoot ?? DEFAULT_HERMES_AGENT_SYNC_ROOT,
      syncExclude: options.syncInclude === undefined && options.syncExclude === undefined
        ? [...DEFAULT_HERMES_AGENT_SYNC_EXCLUDE]
        : options.syncExclude,
      syncUid: options.syncUid ?? DEFAULT_HERMES_AGENT_SYNC_UID,
      syncGid: options.syncGid ?? DEFAULT_HERMES_AGENT_SYNC_GID,
      routes: options.routes,
    };
    const agent = await this.create(effectiveOptions);
    if (agent.runtime !== 'hermes-agent' && agent.runtime !== 'hermes_acp') {
      throw new Error("Hermes deployment response did not identify runtime 'hermes-agent'");
    }
    return agent;
  }

  /**
   * Create an ACP-fronted coding agent. All coding runtimes share one launch
   * contract; `runtime` selects the default image, sync includes, and harness
   * env (`pi` gets `HYPER_RUNTIME_HOME`), nothing else.
   *
   * @deprecated Use {@link Deployments.createAgent} with the runtime label;
   * the folded entry takes the same options bag.
   */
  async createCodingAgent(
    runtime: CodingAgentRuntime,
    options: CodingAgentCreateOptions = {},
  ): Promise<Agent> {
    return this.createAgent(runtime, options);
  }

  private async createCodingAgentDeployment(
    runtime: CodingAgentRuntime,
    options: ManagedAgentCreateOptions,
  ): Promise<Agent> {
    if (options.buzzEnabled && options.buzz) {
      throw new Error('buzzEnabled cannot be combined with buzz');
    }
    if ((options.buzzEnabled || options.buzz) && options.command !== undefined && options.command !== null) {
      throw new Error('Buzz launch cannot be combined with an explicit command');
    }
    const buzzLaunch = options.buzzEnabled || options.buzz !== undefined && options.buzz !== null;
    if (buzzLaunch && options.size !== undefined && options.size !== 'large' && options.size !== 'medium') {
      throw new Error("Buzz coding agents require size='large' or 'medium'");
    }
    const effectiveEnv: Record<string, string> = {
      ...buildWorkspacesSyncEnv(options.workspacesSync ?? null),
      ...(runtime === 'pi' ? DEFAULT_PI_ENV : null),
      ...(options.env ?? {}),
    };
    effectiveEnv.HYPER_ACP_PERMISSIONS ??= buildPermissionsJson(options.permissionMode ?? 'default');
    if (options.permissionMode !== undefined) {
      // Transition: legacy hyper-acp builds only read the mode var, so keep
      // emitting it alongside the JSON when the caller chose a mode. A
      // caller-supplied HYPER_ACP_PERMISSION_MODE in env passes through.
      effectiveEnv.HYPER_ACP_PERMISSION_MODE ??= options.permissionMode;
    }
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
    const resolvedImage = options.image ?? DEFAULT_CODING_AGENT_IMAGES[runtime];
    if (buzzLaunch) {
      for (const key of [
        'HYPER_ACP_WS_LISTEN',
        'HYPER_ACP_LOG',
        'HYPER_ACP_WS_TOKEN',
        'HYPER_ACP_AGENT_COMMAND',
        'HYPER_ACP_AGENT_ARGS',
        'HYPER_ACP_AUTO_APPROVE_PERMISSION',
        'HYPER_ACP_PERMISSIONS',
        'HYPER_ACP_PERMISSION_MODE',
      ]) {
        delete effectiveEnv[key];
      }
      delete effectiveSecrets.HYPER_ACP_WS_TOKEN;
      effectiveEnv.HYPER_ACP_WS_URL = defaultHyperAcpWsUrl(this.apiBase);
      effectiveEnv.BUZZ_ACP_RELAY_OBSERVER = 'true';
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
      const defaultInclude = DEFAULT_CODING_AGENT_SYNC_INCLUDES[runtime];
      syncInclude = defaultInclude ?? undefined;
      syncExclude = defaultInclude === null ? [] : undefined;
    }
    const effectiveOptions: CreateAgentOptions = {
      ...options,
      runtime,
      size: buzzLaunch ? (options.size ?? 'large') : options.size,
      env: effectiveEnv,
      secrets: effectiveSecrets,
      routes: buzzLaunch ? {} : options.routes ?? {},
      image: resolvedImage,
      command: options.buzzEnabled || options.buzz
        ? ['/usr/local/bin/hyper-acp', 'plugin', 'buzz']
        // Plain ACP launches use the image's hyper-acp binary.
        : options.command ?? ['/usr/local/bin/hyper-acp'],
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
    const agent = await this.create(effectiveOptions);
    if (agent.runtime !== runtime) {
      throw new Error(`Deployment response did not identify runtime '${runtime}'`);
    }
    return agent;
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
    parsed.searchParams.set('token', token.token);
    const WebSocketImpl = preferredWebSocket();
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
        const token = validateDeploymentEventToken(await this.agentHttp.post<{
          token: string;
          ws_url: string;
        }>(`${DEPLOYMENTS_API_PREFIX}/events/token`, undefined, { signal: options.signal }));
        const eventUrl = new URL(token.ws_url);
        eventUrl.searchParams.set('token', token.token);
        const WebSocketImpl = preferredWebSocket();
        const ws = new WebSocketImpl(eventUrl.toString());
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
          ws.addEventListener('open', () => { opened = true; });
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
        if (error instanceof Error && error.message === 'Backend returned an invalid deployment event token response') {
          throw error;
        }
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
      ['STOPPED', 'ARCHIVED', 'DELETED', 'FAILED', 'NO_NAMESPACE'],
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
   * `secrets` again. A caller that writes launch_config before start still
   * needs a complete replacement object. Without this step the obvious round
   * trip can never succeed, because the read side is structurally incapable of
   * returning what the write side requires:
   *
   * ```ts
   * const agent = await client.deployments.get(agentId);
   * await client.deployments.update(agentId, { launchConfig: agent.launchConfig });
   * // Error: launchConfig is incomplete; missing: secrets, registry_auth
   * ```
   *
   * The fix is to complete the object honestly, never to weaken the
   * completeness contract — launch_config writes are replacements, not merges.
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
          + 'with the launch_config update',
        );
      } else {
        prepared.registry_auth = {};
      }
    }
    return prepared as AgentLaunchConfig;
  }

  /**
   * Rebuild a complete replacement launch_config from
   * nothing but the Agent's stored projection.
   *
   * This SDK starts stored config without reading it. This method is retained
   * for callers that want to explicitly update stored launch_config;
   * it is also the only place that canonicalizes the two legacy projection
   * shapes the inline repair never sees, because the repair fills absent keys
   * and touches nothing else:
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
    // representation; replacement writes receive one explicit boolean.
    if ('restart' in launchConfig && launchConfig.restart === null) {
      launchConfig.restart = false;
    }

    launchConfig.secrets = await this.recoverRedactedSecrets(agent.id, agent.launchEpoch);

    const registryUrl = String(launchConfig.registry_url ?? '').trim();
    if (registryUrl && !options.registryAuth) {
      throw new Error(
        `Agent ${agent.id} pulls from registry_url ${JSON.stringify(registryUrl)}; `
        + 'registry_auth is caller-held and never stored server-side, so it must '
        + 'be supplied to rebuild a complete launch_config replacement',
      );
    }
    launchConfig.registry_auth = options.registryAuth ? structuredClone(options.registryAuth) : {};

    // Replacement writes require exactly one sync policy. Includes win when a legacy
    // projection carries both; carrying neither canonicalizes to the
    // explicit sync-everything exclusion list.
    if (Object.prototype.hasOwnProperty.call(launchConfig, 'sync_include')) {
      delete launchConfig.sync_exclude;
    } else if (!Object.prototype.hasOwnProperty.call(launchConfig, 'sync_exclude')) {
      launchConfig.sync_exclude = [];
    }

    return cloneCompleteLaunchConfig(
      await this.rehydrateRedactedLaunchConfig(agent.id, launchConfig as AgentLaunchConfig, options.registryAuth),
    );
  }

  async start(agentIdOrName: string, options?: StartAgentOptions): Promise<Agent> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const suppliedOptions = options as Record<string, unknown> | undefined;
    const mutationOptions = suppliedOptions
      ? ['launchConfig', 'trustedProxies', 'registryAuth'].filter((key) => Object.prototype.hasOwnProperty.call(suppliedOptions, key))
      : [];
    if (mutationOptions.length > 0) {
      throw new Error(
        `start no longer accepts launch mutation options: ${mutationOptions.join(', ')}; `
        + 'update launchConfig before starting',
      );
    }
    const body: Record<string, any> = {};
    if (options?.dryRun) body.dry_run = true;
    const data = await this.agentHttp.post<AgentHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/start`,
      Object.keys(body).length ? body : undefined,
      { retries: 1 },
    );
    return this.hydrateAgent(data);
  }

  async update(agentIdOrName: string, options: UpdateAgentOptions = {}): Promise<Agent> {
    // Only fields the backend UpdateAgentRequest accepts (it is extra="forbid"):
    // name, handle, size, launch_config, runtime, reset_image. refresh_from_lagoon/error are rejected.
    const body: Record<string, any> = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.handle !== undefined) body.handle = options.handle;
    if (options.size !== undefined) body.size = options.size;
    if (options.launchConfig !== undefined) body.launch_config = options.launchConfig;
    if (options.runtime !== undefined) body.runtime = options.runtime;
    if (options.resetImage !== undefined) body.reset_image = options.resetImage;
    if (options.ui !== undefined) body.ui = options.ui;
    const agentId = await this.resolveAgentId(agentIdOrName);
    const data = await this.agentHttp.patch<AgentHydrationData>(`${DEPLOYMENTS_API_PREFIX}/${agentId}`, body);
    return this.hydrateAgent(data);
  }

  /**
   * Reset a deployment back to this runtime's platform defaults.
   *
   * The empty launch_config is intentional: Backend treats `{}` as "clear every
   * mutable launch setting" while preserving protected launch identity and
   * retained-storage fields. Runtime-specific files are deleted best-effort so
   * the image can reseed its own config on the next boot.
   */
  async resetRuntimeDefaults(
    agentIdOrName: string,
    options: ResetRuntimeDefaultsOptions,
  ): Promise<ResetRuntimeDefaultsResult> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const resetData = await this.agentHttp.patch<AgentHydrationData & { warnings?: unknown }>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}`,
      {
        runtime: options.runtime,
        reset_image: true,
        launch_config: {},
      },
    );
    const droppedLaunchKeys = droppedLaunchConfigKeys(resetData);
    if (options.runtime === 'openclaw' || options.runtime === 'openclaw-pro' || options.runtime === 'openclaw_acp') {
      await this.setEnv(agentId, 'OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN', '*');
      await this.fileDelete(agentId, '.openclaw/openclaw.json').catch(() => undefined);
    } else if (options.runtime === 'hermes-agent' || options.runtime === 'hermes_acp') {
      await this.fileDelete(agentId, '.hermes/config.yaml').catch(() => undefined);
      await this.fileDelete(agentId, '.hermes/mem0.json').catch(() => undefined);
    }
    return { agent: await this.get(agentId), droppedLaunchKeys };
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
   *
   * With `dryRun: true` the Backend only validates the request and returns
   * the current Agent unchanged -- nothing mutates and no stop is started.
   */
  async stop(agentIdOrName: string, options?: LifecycleActionOptions): Promise<Agent> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const body: Record<string, any> = {};
    if (options?.dryRun) body.dry_run = true;
    const data = await this.agentHttp.post<AgentHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/stop`,
      Object.keys(body).length ? body : undefined,
      { retries: 1 },
    );
    return this.hydrateAgent(data);
  }

  /**
   * Archive durable storage without launching the agent.
   *
   * With `dryRun: true` the Backend only validates the request and returns
   * the current Agent unchanged -- nothing mutates and no archive is started.
   */
  async archive(agentIdOrName: string, options?: LifecycleActionOptions): Promise<Agent> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const body: Record<string, any> = {};
    if (options?.dryRun) body.dry_run = true;
    const data = await this.agentHttp.post<AgentHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/archive`,
      Object.keys(body).length ? body : undefined,
      { retries: 1 },
    );
    return this.hydrateAgent(data);
  }

  /**
   * Restore durable storage. The accepted snapshot is `RESTORING`; completion is `STOPPED`.
   *
   * With `dryRun: true` the Backend only validates the request and returns
   * the current Agent unchanged -- nothing mutates and no restore is started.
   */
  async restore(agentIdOrName: string, options?: LifecycleActionOptions): Promise<Agent> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const body: Record<string, any> = {};
    if (options?.dryRun) body.dry_run = true;
    const data = await this.agentHttp.post<AgentHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/restore`,
      Object.keys(body).length ? body : undefined,
      { retries: 1 },
    );
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
    const agentId = await this.routesTarget(agentIdOrName);
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
    const agentId = await this.routesTarget(agentIdOrName);
    const body: Record<string, unknown> = {
      routes: Object.fromEntries(
        Object.entries(routes).map(([name, route]) => [name, routeConfigBody(route)]),
      ),
    };
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
    const agentId = await this.routesTarget(agentIdOrName);
    const body = routeConfigBody(route);
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
    const agentId = await this.routesTarget(agentIdOrName);
    const data = await this.agentHttp.delete<AgentRoutesHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/routes/${encodeURIComponent(name)}`,
    );
    return agentRoutesStateFromData(data);
  }

  /**
   * Delete a deployment.
   *
   * With `dryRun: true` the Backend only validates the request and returns
   * the current Agent record unchanged -- nothing mutates and the deployment
   * is not deleted.
   */
  async delete(agentIdOrName: string, options?: LifecycleActionOptions): Promise<Record<string, any>> {
    // HTTP 200 accepts the durable soft delete. Cluster-local cleanup continues
    // in the background and is not proven complete by this response.
    const agentId = await this.resolveAgentId(agentIdOrName);
    const path = `${DEPLOYMENTS_API_PREFIX}/${agentId}`;
    const result = options?.dryRun
      ? await this.agentHttp.delete<Record<string, any>>(path, { dry_run: true })
      : await this.agentHttp.delete<Record<string, any>>(path);
    return result;
  }

  async refreshToken(agentIdOrName: string): Promise<AgentTokenResponse> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    return this.agentHttp.get(`${DEPLOYMENTS_API_PREFIX}/${agentId}/token`);
  }

  /**
   * Signed URL for the agent's VNC desktop. Requires a running agent with the
   * `desktop` route enabled; throws otherwise.
   */
  async desktopUrl(
    agentIdOrName: string,
    options: BrowserDesktopUrlOptions = {},
  ): Promise<{ url: string; expiresAt: Date | null; viewport: { width: number; height: number } | null }> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    const [token, agent] = await Promise.all([
      this.refreshToken(agentId),
      this.getById(agentId),
    ]);
    const jwt = (token.token ?? '').trim();
    if (!jwt) throw new Error('Desktop token is missing');
    if (!agent.isRunning) throw new Error('Start the agent to open its desktop');
    const base = agent.desktopUrl;
    if (!base) throw new Error('Desktop route is not enabled for this agent');
    const url = buildBrowserDesktopUrl(base, jwt, {
      redirect: 'vnc_lite.html',
      resize: 'scale',
      ...options,
    });
    return { url, expiresAt: parseDate(token.expires_at), viewport: token.desktop_viewport ?? null };
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
    return validateAgentLogsToken(await this.agentHttp.post<AgentLogsTokenResponse>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/logs/token`,
    ));
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
    let stdin: string | undefined;
    if (options.stdin !== undefined) {
      const bytes = typeof options.stdin === 'string'
        ? encodeUtf8(options.stdin)
        : options.stdin;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > AGENT_EXEC_STDIN_MAX_BYTES) {
        throw new Error(`stdin must be a string or Uint8Array of at most ${AGENT_EXEC_STDIN_MAX_BYTES} bytes`);
      }
      stdin = encodeBase64(bytes);
    }
    const agentId = await this.agentIdFor(target);
    const payload: Record<string, unknown> = {
      command,
      timeout,
      dry_run: options.dryRun ?? false,
      ...(stdin !== undefined ? { stdin } : {}),
    };
    return validateAgentExecResult(
      await this.oneShotAgentWebSocket(agentId, 'exec', payload, (timeout + 10) * 1_000),
    );
  }

  /**
   * Wait until the Agent file API is serving. Native assignments use a bounded
   * file read; hosted assignments use the Reef readiness checks below.
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
      if (lastState === 'DELETED' || lastState === 'FAILED' || lastState === 'NO_NAMESPACE') {
        throw new Error(
          `Agent ${agentId} is ${lastState}; its Reef file API will not serve. Waiting longer cannot help.`,
        );
      }
      try {
        await this.filesList(agentId, '');
        streak += 1;
        if (streak >= consecutive) return;
      } catch (error) {
        if (error instanceof APIError && error.statusCode === 501) throw error;
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
    const access = await this.fileAccess(agentId);
    let payload: AgentDirectoryListing;
    if ('transport' in access) {
      payload = await this.agentHttp.post<AgentDirectoryListing>(
        `${DEPLOYMENTS_API_PREFIX}/${agentId}/files/list`,
        { path: resolvedPath ? nativeFilePath(resolvedPath) : '' },
        { redirect: 'error' },
      );
    } else {
      const suffix = resolvedPath ? `/${encodeFilePath(resolvedPath)}` : '';
      const response = await this.fetchReef(access, `/directories${suffix}`);
      payload = (await response.json()) as AgentDirectoryListing;
    }
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
    const access = await this.fileAccess(agentId);
    if ('transport' in access) {
      const maxBytes = Math.min(options?.maxBytes ?? RUNNER_FILE_MAX_BYTES, RUNNER_FILE_MAX_BYTES);
      if (!Number.isInteger(maxBytes) || maxBytes < 0) throw new Error('maxBytes must be a nonnegative integer');
      const payload = await this.agentHttp.post<{ content_base64: string }>(
        `${DEPLOYMENTS_API_PREFIX}/${agentId}/files/read`,
        { path: nativeFilePath(resolvedPath), max_bytes: maxBytes },
        { signal: options?.signal, redirect: 'error' },
      );
      if (typeof payload?.content_base64 !== 'string' || payload.content_base64.length > Math.ceil(maxBytes / 3) * 4
        || payload.content_base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.content_base64)) {
        throw new Error('Invalid runner file response');
      }
      let content: Uint8Array;
      try {
        content = Uint8Array.from(atob(payload.content_base64), (character) => character.charCodeAt(0));
      } catch {
        throw new Error('Invalid runner file response');
      }
      if (content.byteLength > maxBytes) throw fileReadLimitError(path, maxBytes);
      return { content };
    }
    const response = await this.fetchReef(access, `/files/${encodeFilePath(resolvedPath)}`, {
      signal: options?.signal,
    });
    const maxBytes = options?.maxBytes === undefined
      ? AGENT_FILE_MAX_BYTES
      : Math.min(options.maxBytes, AGENT_FILE_MAX_BYTES);
    const bytes = await readResponseBytes(response, path, maxBytes);
    const contentType = response.headers.get('content-type') || '';
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
    // ignoreBOM means treat the BOM as content, matching Python/Rust UTF-8 readers.
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await this.fileReadBytes(target, path, options));
  }

  /**
   * Write bytes to a relative path through Reef or the native runner transport.
   *
   * Per-file writes are limited to 100 MiB (`AGENT_FILE_WRITE_MAX_BYTES`,
   * the Cloudflare edge request-body cap on the agent hostname). Larger data
   * should be split across files or synced via the agent's own tooling.
   * Native runner files are limited to 256 KiB under the retained assignment root.
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
    const access = await this.fileAccess(agentId);
    if ('transport' in access) {
      if (bytes.byteLength > RUNNER_FILE_MAX_BYTES) throw new Error(`Runner files are limited to ${RUNNER_FILE_MAX_BYTES} bytes`);
      const receipt = await this.agentHttp.post<{ ok: boolean }>(`${DEPLOYMENTS_API_PREFIX}/${agentId}/files/write`, {
        path: nativeFilePath(path), content_base64: encodeBase64(bytes),
      }, { retries: 1, redirect: 'error' }); // Neither retry nor redirect may replay file content.
      if (receipt?.ok !== true) throw new Error('Invalid runner file receipt');
      return receipt;
    }
    const response = await this.fetchReef(access, `/files/${encodedPath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes as unknown as NonNullable<RequestInit['body']>,
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
    const access = await this.fileAccess(agentId);
    if ('transport' in access) {
      if (options.recursive) throw new Error('Runner file deletion is never recursive');
      // Backend POST performs exactly one attempt; an uncertain delete is never replayed.
      const receipt = await this.agentHttp.post<Record<string, any>>(
        `${DEPLOYMENTS_API_PREFIX}/${agentId}/files/delete`,
        { path: nativeFilePath(path) },
        { redirect: 'error' },
      );
      if (receipt?.status !== 'deleted' || receipt?.path !== path) throw new Error('Invalid runner file receipt');
      return receipt;
    }
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
      `?token=${encodeURIComponent(tokenData.token)}` +
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

  /**
   * Buzz-backed agents publish observer telemetry to a Nostr relay (kind
   * 24200, NIP-44-v2-encrypted to the owner). This subscribes the relay
   * directly and decrypts locally; see {@link subscribeBuzzActivity}.
   */
  async subscribeBuzzActivity(
    agentIdOrName: string,
    handlers: BuzzActivityHandlers,
  ): Promise<BuzzActivitySubscription> {
    return subscribeBuzzActivity(this, agentIdOrName, handlers);
  }

  /**
   * Legacy Buzz activity through an agent `hyper-acp` WS route. Hosted Buzz
   * launches no longer provision this route; the raw ACP path is outbound
   * `HYPER_ACP_WS_URL`. See {@link subscribeBuzzActivityRoute}.
   */
  async subscribeBuzzActivityRoute(
    agentIdOrName: string,
    handlers: BuzzActivityRouteHandlers,
  ): Promise<BuzzActivitySubscription> {
    return subscribeBuzzActivityRoute(this, agentIdOrName, handlers);
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
      parsed.searchParams.set('token', tokenData.token);
      parsed.searchParams.set('shell', tokenData.shell);
      const WebSocketImpl = preferredWebSocket();
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
