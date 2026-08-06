/**
 * HyperClaw agents API - typed agent lifecycle, files, exec, and OpenClaw access.
 */
import { randomFillSync } from 'node:crypto';
import NodeWebSocket from 'ws';
import {
  agentSlotFromDict,
  type AgentSlot,
  type AgentSlotInventory,
} from './agent-slots.js';
export {
  agentSlotFromDict,
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
import type {
  OpenClawTelegramConfigPatch,
  OpenClawWhatsAppConfigPatch,
} from './openclaw/channels.js';
import { normalizeSlackRelayBaseUrl } from './channels.js';
import type {
  OpenClawSlackHttpConfiguration,
  OpenClawSlackRelayConfiguration,
  OpenClawSlackSocketConfiguration,
} from './openclaw/slack.js';

const AGENTS_API_BASE = 'https://api.hypercli.com/agents';
const DEV_AGENTS_API_BASE = 'https://api.dev.hypercli.com/agents';
const DEPLOYMENTS_API_PREFIX = '/deployments';
const AGENTS_WS_URL = 'wss://api.agents.hypercli.com/ws';
const DEV_AGENTS_WS_URL = 'wss://api.agents.dev.hypercli.com/ws';
export const DEFAULT_OPENCLAW_IMAGE = 'ghcr.io/hypercli/hypercli-openclaw:pro-latest';
export const DEFAULT_OPENCLAW_PRO_IMAGE = 'ghcr.io/hypercli/hypercli-openclaw:pro-latest';
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
export const DEFAULT_CODING_AGENT_SYNC_INCLUDES: Readonly<Record<CodingAgentRuntime, readonly string[]>> = {
  'buzz-agent': [],
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
const CODING_AGENT_RUNTIMES = new Set<CodingAgentRuntime>(['buzz-agent', 'opencode', 'codex', 'claude-code', 'goose', 'kimi-code']);
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
export const DEFAULT_BUZZ_RUST_LOG = 'buzz_acp=info,pool::prompt=info,acp::stream=off';
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
  HYPER_WORKSPACES_DIR: '/home/node/workspaces',
  HYPER_WORKSPACES_SYNC_READY_ONLY: '1',
} as const;
const LAUNCH_CONFIG_KEYS = new Set([
  'image',
  'env',
  'routes',
  'ports',
  'command',
  'entrypoint',
  'sync_root',
  'sync_enabled',
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
export const AGENT_FILE_MAX_BYTES = 250 * 1024 * 1024;
export const AGENT_FILE_TRANSFER_CHUNK_BYTES = 64 * 1024;
export const AGENT_FILE_OPERATION_TIMEOUT_MS = 300_000;

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

export interface BrowserDesktopUrlOptions {
  redirect?: string | null;
  resize?: string | null;
}

export interface AgentGatewayContext {
  agent_id?: string;
  hostname?: string | null;
  gateway_token?: string | null;
}

export interface GatewayContextWaitOptions {
  timeoutMs?: number;
  retryIntervalMs?: number;
  signal?: AbortSignal;
}

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
  agent_id?: string;
  jwt: string;
  expires_at?: string | null;
  ws_url?: string;
  shell?: string | null;
  dry_run?: boolean;
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

export interface AgentRoutesState {
  agentId: string;
  routes: Record<string, AgentRouteConfig>;
  routeStatuses: Record<string, Record<string, unknown>>;
}

interface AgentRoutesHydrationData {
  agent_id?: string;
  routes?: Record<string, AgentRouteConfig> | null;
  route_statuses?: Record<string, Record<string, unknown>> | null;
}

export type LaunchConfigFlatMap = Record<string, unknown>;

export interface AgentDesktopConfigSource {
  launchConfig?: unknown;
  launch_config?: unknown;
  routes?: unknown;
  ports?: unknown;
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
  syncInclude?: readonly string[] | null;
  syncExclude?: readonly string[] | null;
  /** Clear any stored selective policy and synchronize all of `syncRoot`. */
  syncAll?: boolean;
  syncUid?: number | null;
  syncGid?: number | null;
  registryUrl?: string | null;
  registryAuth?: RegistryAuth | null;
  restart?: boolean | null;
  runtimeScopes?: readonly string[] | null;
  gatewayToken?: string | null;
  heartbeat?: OpenClawHeartbeatConfig | null;
  /** Disable to avoid automatically locking browser control UI access to globalThis.location.origin. */
  controlUiOriginLock?: boolean | null;
  /** Internal launch behavior; coding runtimes do not use the OpenClaw gateway. */
  injectGatewayToken?: boolean;
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
  outputDir?: string | null;
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
  handle?: string | null;
  size?: string;
  config?: Record<string, any>;
  meta?: AgentMeta | null;
  tags?: string[];
  dryRun?: boolean;
  start?: boolean;
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

export interface StartAgentOptions extends BuildAgentConfigOptions {
  config?: Record<string, any>;
  dryRun?: boolean;
}

export interface UpdateAgentOptions {
  name?: string;
  handle?: string | null;
  size?: string;
  launchConfig?: Record<string, any> | null;
  refreshFromLagoon?: boolean;
  lastError?: string | null;
}

export interface OpenClawCreateAgentOptions extends CreateAgentOptions {
  openClawRoutes?: OpenClawRouteOptions | null;
  heartbeat?: OpenClawHeartbeatConfig | null;
  memoryIndex?: OpenClawMemoryIndexOptions | null;
  workspacesSync?: OpenClawWorkspacesSyncOptions | boolean | null;
}

export interface OpenClawStartAgentOptions extends StartAgentOptions {
  openClawRoutes?: OpenClawRouteOptions | null;
  heartbeat?: OpenClawHeartbeatConfig | null;
  memoryIndex?: OpenClawMemoryIndexOptions | null;
  workspacesSync?: OpenClawWorkspacesSyncOptions | boolean | null;
}

export interface CodingAgentCreateOptions extends Omit<CreateAgentOptions, 'runtime' | 'injectGatewayToken'> {
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
    BUZZ_PRIVATE_KEY: buzz.privateKeyNsec,
    NOSTR_PRIVATE_KEY: buzz.privateKeyNsec,
    BUZZ_RELAY_URL: buzz.relayUrl,
    BUZZ_MANAGED_AGENT_START_NONCE: randomHexToken(16),
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
  if (buzz.requireReply) env.BUZZ_ACP_REQUIRE_REPLY = 'true';
  return env;
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
  source?: AgentFileSource;
  [key: string]: any;
}

export interface AgentFileReadOptions {
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface AgentFileReadBytesResult {
  content: Uint8Array;
  mimeType?: string;
}

/**
 * The three file-access paths for an OpenClaw agent, each with its own root —
 * the SDK owns the roots so a workspace-relative path (e.g. `"AGENTS.md"`) hits
 * the same file on all three:
 * - `agent`  — the files API on the agent's live pod filesystem. A
 *              workspace-relative path resolves under the workspace, while an
 *              absolute `/…` path can be listed/read anywhere on the pod.
 *              Writes under the sync root are supported. (wire `source=pod`)
 * - `backup` — the S3 backup of the sync root (`/home/node`); served when the
 *              pod is stopped. Scoped to the sync root. (wire `source=s3`)
 * - `gateway`— the operator-WebSocket `agents.files.*` RPC; scoped to the
 *              `.openclaw/workspace` (name-addressed; no delete). Works on any
 *              gateway, self-hosted included.
 * - `auto`   — backend default: the agent while running, else the backup.
 *
 * `pod`/`s3` are accepted as deprecated aliases of `agent`/`backup`.
 */
export type AgentFileSource = 'auto' | 'agent' | 'backup' | 'gateway' | 'pod' | 's3';

/** @deprecated Alias of {@link AgentFileSource}; gateway is a base capability now. */
export type OpenClawFileSource = AgentFileSource;

/** The backend (non-gateway) file sources — the deployment HTTP files store. */
export type AgentFileBackendSource = Exclude<AgentFileSource, 'gateway'>;

/** The value the deployment HTTP API accepts on the wire (`source`/`destination`). */
export type AgentFileWireSource = 'auto' | 'pod' | 's3';

/** The agent's sync root and workspace, owned by the SDK so paths are unambiguous. */
export const OPENCLAW_SYNC_ROOT = '/home/node';
export const OPENCLAW_WORKSPACE_PREFIX = '.openclaw/workspace';

/** Map the friendly `agent`/`backup` names to their on-the-wire `pod`/`s3` values. */
export function toWireFileSource(source: AgentFileBackendSource): AgentFileWireSource {
  switch (source) {
    case 'agent': return 'pod';
    case 'backup': return 's3';
    default: return source; // 'auto' | 'pod' | 's3'
  }
}

const GATEWAY_FILE_SOURCES = new Set<OpenClawFileSource>(['gateway']);
const FULL_FS_FILE_SOURCES = new Set<OpenClawFileSource>(['agent', 'pod']);

/**
 * Resolve a caller path to the deployment HTTP files path (sync-root relative).
 * Workspace-relative by default (prefixed with the workspace); an absolute `/…`
 * path is read-only full-fs and only valid for the `agent` source.
 */
function resolveBackendFilePath(path: string, source: AgentFileBackendSource): string {
  if (path.startsWith('/')) {
    if (!FULL_FS_FILE_SOURCES.has(source)) {
      throw new Error(
        `absolute paths need the 'agent' source (full pod filesystem); ` +
        `'${source}' is scoped to ${source === 'backup' || source === 's3' ? 'the sync root' : 'the workspace'}.`,
      );
    }
    return path; // full-fs path, passed through to source=pod
  }
  const rel = stripRelPrefix(path);
  return rel ? `${OPENCLAW_WORKSPACE_PREFIX}/${rel}` : OPENCLAW_WORKSPACE_PREFIX;
}

function normalizeWritableBackendFilePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/')) {
    const parts = normalized.split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') {
        resolved.pop();
        continue;
      }
      resolved.push(part);
    }
    const absolute = `/${resolved.join('/')}`;
    const prefix = `${OPENCLAW_SYNC_ROOT}/`;
    if (!absolute.startsWith(prefix)) {
      throw new Error(`absolute write paths must stay within the sync root (${OPENCLAW_SYNC_ROOT}).`);
    }
    return absolute.slice(prefix.length);
  }
  if (normalized.split('/').includes('..')) {
    throw new Error("paths containing '..' are not writable; writes and deletes must stay within the sync root.");
  }
  return stripRelPrefix(normalized);
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
    routeStatuses: structuredClone(data.route_statuses ?? {}),
  };
}

/** Strip a workspace prefix so gateway (name-addressed) sees the bare name. */
function resolveGatewayFileName(path: string): string {
  if (path.startsWith('/')) {
    throw new Error("absolute paths are not valid for the 'gateway' source (scoped to the workspace).");
  }
  const rel = stripRelPrefix(path);
  return rel.startsWith(`${OPENCLAW_WORKSPACE_PREFIX}/`)
    ? rel.slice(OPENCLAW_WORKSPACE_PREFIX.length + 1)
    : rel;
}

/** Hooks an OpenClaw agent provides so AgentFiles can reach its gateway. */
export interface AgentFilesGatewayHooks {
  withGateway<T>(fn: (client: GatewayClient) => Promise<T>): Promise<T>;
  resolveAgentId(client: GatewayClient): Promise<string>;
}

/**
 * ONE client wrapping all three agent file-access paths behind a single `source`
 * switch (`agent` | `backup` | `gateway`, plus `auto`). The SDK owns the roots,
 * so a workspace-relative path is the same file on every source; `agent` also
 * takes absolute `/…` paths for read-only full-filesystem browsing. The
 * underlying APIs are left as-is — this only wraps them.
 */
export class AgentFiles {
  constructor(
    private readonly agent: Agent,
    private readonly deployments: Deployments,
    private readonly gatewayHooks?: AgentFilesGatewayHooks,
  ) {}

  private requireGateway(): AgentFilesGatewayHooks {
    if (!this.gatewayHooks) {
      throw new Error('gateway file source requires an OpenClaw agent with a gateway URL/token.');
    }
    return this.gatewayHooks;
  }

  async list(path = '', source: OpenClawFileSource = 'auto'): Promise<AgentFileEntry[]> {
    if (!GATEWAY_FILE_SOURCES.has(source)) {
      return this.deployments.filesList(this.agent, resolveBackendFilePath(path, source as AgentFileBackendSource), toWireFileSource(source as AgentFileBackendSource));
    }
    const gw = this.requireGateway();
    const name = resolveGatewayFileName(path);
    const files = await gw.withGateway(async (c) => c.filesList(await gw.resolveAgentId(c)));
    return (files ?? [])
      .map((f: any): AgentFileEntry => ({ name: f.name, path: f.name, type: 'file', size: f.size }))
      .filter((f) => !name || f.name === name || f.name.startsWith(name.endsWith('/') ? name : `${name}/`));
  }

  async readBytes(path: string, source: OpenClawFileSource = 'auto', options?: AgentFileReadOptions): Promise<Uint8Array> {
    if (!GATEWAY_FILE_SOURCES.has(source)) {
      const resolvedPath = resolveBackendFilePath(path, source as AgentFileBackendSource);
      const wireSource = toWireFileSource(source as AgentFileBackendSource);
      return options
        ? this.deployments.fileReadBytes(this.agent, resolvedPath, wireSource, options)
        : this.deployments.fileReadBytes(this.agent, resolvedPath, wireSource);
    }
    return (await this.readBytesWithMetadata(path, source, options)).content;
  }

  async readBytesWithMetadata(
    path: string,
    source: OpenClawFileSource = 'auto',
    options?: AgentFileReadOptions,
  ): Promise<AgentFileReadBytesResult> {
    if (!GATEWAY_FILE_SOURCES.has(source)) {
      return this.deployments.fileReadBytesWithMetadata(
        this.agent,
        resolveBackendFilePath(path, source as AgentFileBackendSource),
        toWireFileSource(source as AgentFileBackendSource),
        options,
      );
    }
    if (options?.signal?.aborted) {
      const error = new Error('File read cancelled');
      error.name = 'AbortError';
      throw error;
    }
    const content = encodeUtf8(await this.read(path, source));
    if (options?.maxBytes !== undefined && content.byteLength > options.maxBytes) {
      throw fileReadLimitError(path, options.maxBytes);
    }
    return { content, mimeType: 'text/plain' };
  }

  async read(path: string, source: OpenClawFileSource = 'auto', options?: AgentFileReadOptions): Promise<string> {
    if (!GATEWAY_FILE_SOURCES.has(source)) {
      return decodeUtf8(await this.readBytes(path, source, options));
    }
    const gw = this.requireGateway();
    return gw.withGateway(async (c) => c.fileGet(await gw.resolveAgentId(c), resolveGatewayFileName(path)));
  }

  async writeBytes(path: string, content: Uint8Array | ArrayBuffer | string, source: OpenClawFileSource = 'auto'): Promise<Record<string, any>> {
    if (!GATEWAY_FILE_SOURCES.has(source)) {
      const writablePath = normalizeWritableBackendFilePath(path);
      const resolvedPath = path.startsWith('/')
        ? writablePath
        : resolveBackendFilePath(writablePath, source as AgentFileBackendSource);
      return this.deployments.fileWriteBytes(this.agent, resolvedPath, content, toWireFileSource(source as AgentFileBackendSource));
    }
    return this.write(path, coerceToUtf8String(content), source);
  }

  async write(path: string, content: string, source: OpenClawFileSource = 'auto'): Promise<Record<string, any>> {
    if (!GATEWAY_FILE_SOURCES.has(source)) {
      const writablePath = normalizeWritableBackendFilePath(path);
      const resolvedPath = path.startsWith('/')
        ? writablePath
        : resolveBackendFilePath(writablePath, source as AgentFileBackendSource);
      return this.deployments.fileWrite(this.agent, resolvedPath, content, toWireFileSource(source as AgentFileBackendSource));
    }
    const gw = this.requireGateway();
    const name = resolveGatewayFileName(path);
    const agentId = await gw.withGateway(async (c) => {
      const aid = await gw.resolveAgentId(c);
      await c.fileSet(aid, name, content);
      return aid;
    });
    return { name, source: 'gateway', agentId };
  }

  async delete(path: string, options: { recursive?: boolean; source?: OpenClawFileSource } = {}): Promise<Record<string, any>> {
    const source = options.source ?? 'auto';
    if (GATEWAY_FILE_SOURCES.has(source)) {
      throw new Error('delete is not supported over the gateway file source; use the agent/backup source.');
    }
    const writablePath = normalizeWritableBackendFilePath(path);
    const resolvedPath = path.startsWith('/')
      ? writablePath
      : resolveBackendFilePath(writablePath, source as AgentFileBackendSource);
    return this.deployments.fileDelete(this.agent, resolvedPath, {
      recursive: options.recursive,
      source: toWireFileSource(source as AgentFileBackendSource),
    });
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
  | 'PENDING'
  | 'RESTORING'
  | 'RESTORE_FAILED'
  | 'SYNCING'
  | 'SYNC_FAILED'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'FAILED'
  | (string & {});

export interface DeploymentEvent {
  version: number;
  type: 'deployment.transition' | 'deployments.changed';
  deployment_id?: string;
  state?: AgentState;
  placement_epoch?: number;
  runtime_generation?: number;
  finalize_epoch?: number;
}

export interface DeploymentSubscribeOptions {
  signal?: AbortSignal;
}

export interface AgentStateFields {
  id: string;
  userId: string;
  podId: string;
  podName: string;
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
  hostname?: string | null;
  tags?: string[];
  jwtToken?: string | null;
  jwtExpiresAt?: Date | null;
  startedAt?: Date | null;
  stoppedAt?: Date | null;
  lastError?: string | null;
  placementEpoch?: number;
  runtimeGeneration?: number;
  finalizeEpoch?: number | null;
  restoreState?: string | null;
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
  hostname?: string | null;
  tags?: string[] | null;
  jwt_token?: string | null;
  jwt_expires_at?: string | null;
  started_at?: string | null;
  stopped_at?: string | null;
  last_error?: string | null;
  placement_epoch?: number;
  runtime_generation?: number;
  finalize_epoch?: number | null;
  restore_state?: string | null;
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
  if (data.runtime === 'openclaw' || data.runtime === 'openclaw-pro') return true;
  const routes = data.routes;
  if (routes && typeof routes === 'object' && !Array.isArray(routes) && routes.openclaw) {
    return true;
  }
  const launchRoutes = data.launch_config?.routes;
  return !!(launchRoutes && typeof launchRoutes === 'object' && !Array.isArray(launchRoutes) && launchRoutes.openclaw);
}

function isCodingAgentRuntime(runtime: unknown): runtime is CodingAgentRuntime {
  return typeof runtime === 'string' && CODING_AGENT_RUNTIMES.has(runtime as CodingAgentRuntime);
}

function isTruthyEnv(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value ?? '').trim().toLowerCase());
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

export function portsHaveDesktop(ports: unknown): boolean {
  return Array.isArray(ports) && ports.some((port) => isPlainRecord(port) && Number(port.port) === 3000);
}

export function launchConfigHasDesktop(launchConfig: unknown): boolean {
  if (!isPlainRecord(launchConfig)) return false;
  if (isTruthyEnv(getLaunchConfigValue(launchConfig, 'env.OPENCLAW_DESKTOP_ENABLED'))) return true;
  if (routesHaveDesktop(getLaunchConfigValue(launchConfig, 'routes'))) return true;
  return portsHaveDesktop(getLaunchConfigValue(launchConfig, 'ports'));
}

export function agentConfigHasDesktop(source: AgentDesktopConfigSource | null | undefined): boolean {
  if (!source) return false;
  return (
    launchConfigHasDesktop(source.launchConfig ?? source.launch_config) ||
    routesHaveDesktop(source.routes) ||
    portsHaveDesktop(source.ports)
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

function deploymentFileReadRequest(
  path: string,
  source: 'auto' | 'pod' | 's3',
): { suffix: string; params: URLSearchParams } {
  const params = new URLSearchParams({ source });
  if (path.startsWith('/')) {
    if (source !== 'pod') {
      throw new Error("absolute paths require source='pod'.");
    }
    params.set('absolute_path', path);
    return { suffix: '', params };
  }
  const encodedPath = encodeFilePath(path);
  return { suffix: encodedPath ? `/${encodedPath}` : '', params };
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

/** Coerce write content to a string for the gateway (text-only) file source. */
function coerceToUtf8String(content: Uint8Array | ArrayBuffer | string): string {
  if (typeof content === 'string') return content;
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
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
    hostname: data.hostname ?? null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    jwtToken: data.jwt_token ?? null,
    jwtExpiresAt: parseDate(data.jwt_expires_at),
    startedAt: parseDate(data.started_at),
    stoppedAt: parseDate(data.stopped_at),
    lastError: data.last_error ?? null,
    placementEpoch: data.placement_epoch ?? 0,
    runtimeGeneration: data.runtime_generation ?? 0,
    finalizeEpoch: data.finalize_epoch ?? null,
    restoreState: data.restore_state ?? null,
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

  let gatewayToken = '';
  if (options.injectGatewayToken !== false) {
    gatewayToken = options.gatewayToken?.trim() || env.OPENCLAW_GATEWAY_TOKEN?.trim() || '';
    if (!gatewayToken) {
      gatewayToken = randomHexToken(32);
    }

    env.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
    if (options.controlUiOriginLock !== false && !env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN?.trim()) {
      const controlUiOrigin = defaultControlUiAllowedOrigin();
      if (controlUiOrigin) {
        env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN = controlUiOrigin;
      }
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
  if (options.syncAll && (options.syncInclude != null || options.syncExclude != null)) {
    throw new Error('syncAll cannot be combined with syncInclude or syncExclude');
  }
  if (options.syncAll) {
    prepared.sync_include = null;
    prepared.sync_exclude = null;
  } else {
    if (options.syncInclude != null) prepared.sync_include = [...options.syncInclude];
    if (options.syncExclude != null) prepared.sync_exclude = [...options.syncExclude];
  }
  if (options.syncUid !== undefined && options.syncUid !== null) prepared.sync_uid = options.syncUid;
  if (options.syncGid !== undefined && options.syncGid !== null) prepared.sync_gid = options.syncGid;
  if (options.registryUrl !== undefined && options.registryUrl !== null) prepared.registry_url = options.registryUrl;
  if (options.registryAuth !== undefined && options.registryAuth !== null) prepared.registry_auth = options.registryAuth;
  if (options.restart !== undefined && options.restart !== null) prepared.restart = options.restart;
  if (options.runtimeScopes !== undefined && options.runtimeScopes !== null) {
    prepared.runtime_scopes = [...options.runtimeScopes];
  }

  return { config: prepared, gatewayToken };
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

function productApiBaseFromAgentsApiBase(apiBase: string): string {
  const normalized = apiBase.replace(/\/+$/, '');
  const agentsSuffix = '/agents';
  return normalized.endsWith(agentsSuffix) ? normalized.slice(0, -agentsSuffix.length) : normalized;
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
  const routes: Record<string, AgentRouteConfig> = {};
  if (options.includeGateway ?? true) {
    routes.openclaw = {
      port: options.gatewayPort ?? 18789,
      auth: options.gatewayAuth ?? false,
      prefix: options.gatewayPrefix ?? '',
    };
  }
  if (options.includeDesktop ?? false) {
    routes.desktop = {
      port: options.desktopPort ?? 3000,
      auth: options.desktopAuth ?? true,
      prefix: options.desktopPrefix ?? 'desktop',
    };
  }
  return routes;
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
  if (options.outputDir) {
    env.HYPER_WORKSPACES_DIR = options.outputDir;
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
  public readonly podId: string;
  public readonly podName: string;
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
  public readonly hostname: string | null;
  public readonly tags: string[];
  public jwtToken: string | null;
  public jwtExpiresAt: Date | null;
  public readonly startedAt: Date | null;
  public readonly stoppedAt: Date | null;
  public readonly lastError: string | null;
  public readonly placementEpoch: number;
  public readonly runtimeGeneration: number;
  public readonly finalizeEpoch: number | null;
  public readonly restoreState: string | null;
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
    this.hostname = fields.hostname ?? null;
    this.tags = [...(fields.tags ?? [])];
    this.jwtToken = fields.jwtToken ?? null;
    this.jwtExpiresAt = fields.jwtExpiresAt ?? null;
    this.startedAt = fields.startedAt ?? null;
    this.stoppedAt = fields.stoppedAt ?? null;
    this.lastError = fields.lastError ?? null;
    this.placementEpoch = fields.placementEpoch ?? 0;
    this.runtimeGeneration = fields.runtimeGeneration ?? 0;
    this.finalizeEpoch = fields.finalizeEpoch ?? null;
    this.restoreState = fields.restoreState ?? null;
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

  browserDesktopUrl(token: string, options: BrowserDesktopUrlOptions = {}): string | null {
    if (!this.desktopUrl) return null;
    return buildBrowserDesktopUrl(this.desktopUrl, token, options);
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

  get hasDesktop(): boolean {
    return agentConfigHasDesktop({
      launchConfig: this.launchConfig,
      routes: this.routes,
      ports: this.ports,
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

  /**
   * The gateway file writer a subclass supplies — the seam that enables the
   * `gateway` source. The base agent has none (gateway calls throw); an agent
   * type that speaks a gateway file protocol (e.g. OpenClaw's `agents.files.*`)
   * overloads this. Kept on the base so the *calling* is standardized through
   * the superclass even though each agent's gateway differs.
   */
  protected gatewayFileHooks(): AgentFilesGatewayHooks | undefined {
    return undefined;
  }

  /**
   * The single file client for this agent — one `source` switch (`agent` |
   * `backup` | `gateway`) routes to the three underlying APIs (pod sidecar / S3
   * backup / gateway), with the SDK owning the roots. One implementation; a
   * subclass only supplies its gateway via {@link gatewayFileHooks}.
   */
  get files(): AgentFiles {
    return new AgentFiles(this, this.requireDeployments(), this.gatewayFileHooks());
  }

  async filesList(path: string = '', source: AgentFileSource = 'auto'): Promise<AgentFileEntry[]> {
    return this.files.list(path, source);
  }

  async fileReadBytes(path: string, source: AgentFileSource = 'auto', options?: AgentFileReadOptions): Promise<Uint8Array> {
    return this.files.readBytes(path, source, options);
  }

  async fileReadBytesWithMetadata(
    path: string,
    source: AgentFileSource = 'auto',
    options?: AgentFileReadOptions,
  ): Promise<AgentFileReadBytesResult> {
    return this.files.readBytesWithMetadata(path, source, options);
  }

  async fileRead(path: string, source: AgentFileSource = 'auto', options?: AgentFileReadOptions): Promise<string> {
    return this.files.read(path, source, options);
  }

  async fileWriteBytes(path: string, content: Uint8Array | ArrayBuffer | string, destination: AgentFileSource = 'auto'): Promise<Record<string, any>> {
    return this.files.writeBytes(path, content, destination);
  }

  async fileWrite(path: string, content: string, destination: AgentFileSource = 'auto'): Promise<Record<string, any>> {
    return this.files.write(path, content, destination);
  }

  async fileDelete(path: string, options: { recursive?: boolean; source?: AgentFileSource } = {}): Promise<Record<string, any>> {
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
    const result = await this.agent.exec(commandString(command));
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
    const result = await this.agent.exec(commandString(this.config.statusCommand));
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
    const result = await this.agent.exec(commandString(command));
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
      gatewayUrl: this.gatewayUrlFromHostname(data.hostname),
      gatewayToken: data.gateway_token ?? null,
    });
  }

  protected static gatewayUrlFromHostname(hostname: string | null | undefined): string | null {
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
    const callerAbortError = (): Error => {
      if (options.signal?.reason instanceof Error) return options.signal.reason;
      const error = new Error('OpenClaw gateway context wait cancelled');
      error.name = 'AbortError';
      return error;
    };
    if (options.signal?.aborted) throw callerAbortError();
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
        const requests: Promise<void>[] = [];
        if (!this.gatewayUrl) {
          requests.push(deployments.get(this.id, requestOptions).then((refreshed) => {
            const gatewayUrl = OpenClawAgent.gatewayUrlFromHostname(refreshed.hostname);
            if (gatewayUrl) this.gatewayUrl = gatewayUrl;
          }));
        }
        if (!this.gatewayToken) {
          requests.push(deployments.env(this.id, requestOptions).then((envData) => {
            const gatewayToken = envData.env?.OPENCLAW_GATEWAY_TOKEN?.trim() || null;
            if (gatewayToken) this.gatewayToken = gatewayToken;
          }));
        }

        const results = await runWithAbort(Promise.allSettled(requests));
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (this.gatewayToken && this.gatewayUrl) {
          return {
            agent_id: this.id,
            hostname: this.currentGatewayHostname(),
            gateway_token: this.gatewayToken,
          };
        }
        lastError = rejected?.reason ?? new Error('missing gateway context');
        const remainingAfterRequestMs = deadline - Date.now();
        if (remainingAfterRequestMs <= 0) throw timeoutError();
        const retryDelayMs = Math.min(Math.max(0, retryIntervalMs), remainingAfterRequestMs);
        await waitForRetry(retryDelayMs);
      }
    } finally {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', forwardAbort);
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
      onProtocolError: options.onProtocolError,
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

  /** Run a fn against a connected gateway client, then close it. */
  private async withGateway<T>(fn: (client: GatewayClient) => Promise<T>): Promise<T> {
    const client = await this.connect();
    try {
      return await fn(client);
    } finally {
      client.close();
    }
  }

  private _gatewayAgentId?: string;

  /**
   * The in-gateway agent id for `agents.files.*` — NOT the deployment id. A
   * deployment's gateway hosts an agent named `main` (or a named agent);
   * matches the existing fileGet/fileSet/workspaceFiles convention.
   */
  private async resolveGatewayAgentId(client: GatewayClient): Promise<string> {
    if (this._gatewayAgentId) return this._gatewayAgentId;
    let agents: any[] = [];
    try {
      agents = await client.agentsList();
    } catch {
      // fall through to the canonical default
    }
    const resolved: string = agents[0]?.id ?? 'main';
    this._gatewayAgentId = resolved;
    return resolved;
  }

  /**
   * Overload the base gateway seam with OpenClaw's `agents.files.*` — the actual
   * OpenClaw gateway file methods. The base `files`/`fileX` calling surface is
   * inherited unchanged; only the gateway writer is supplied here.
   */
  protected override gatewayFileHooks(): AgentFilesGatewayHooks {
    return {
      withGateway: (fn) => this.withGateway(fn),
      resolveAgentId: (c) => this.resolveGatewayAgentId(c),
    };
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

  async configureSlackRelay(
    options: (Omit<OpenClawSlackRelayOptions, 'gatewayId'> & { gatewayId?: string }) | OpenClawSlackRelayConfiguration,
    gatewayOptions: Omit<Partial<GatewayOptions>, 'url' | 'token'> & { accountId?: string } = {},
  ): Promise<void> {
    const { accountId, ...connectOptions } = gatewayOptions;
    const client = await this.connect(connectOptions);
    try {
      if ('relay' in options) {
        await client.configureSlackRelay(options, accountId);
      } else {
        await client.configureSlackRelay({
          ...options,
          gatewayId: options.gatewayId ?? this.gatewayId ?? `agent:${this.id}`,
        });
      }
    } finally {
      client.close();
    }
  }

  async configureSlackSocket(
    config: OpenClawSlackSocketConfiguration,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & { accountId?: string } = {},
  ): Promise<void> {
    const { accountId, ...gatewayOptions } = options;
    const client = await this.connect(gatewayOptions);
    try {
      await client.configureSlackSocket(config, accountId);
    } finally {
      client.close();
    }
  }

  async configureSlackHttp(
    config: OpenClawSlackHttpConfiguration,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & { accountId?: string } = {},
  ): Promise<void> {
    const { accountId, ...gatewayOptions } = options;
    const client = await this.connect(gatewayOptions);
    try {
      await client.configureSlackHttp(config, accountId);
    } finally {
      client.close();
    }
  }

  async configureTelegram(
    config: OpenClawTelegramConfigPatch,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & { accountId?: string } = {},
  ): Promise<void> {
    const { accountId, ...gatewayOptions } = options;
    const client = await this.connect(gatewayOptions);
    try {
      await client.configureTelegram(config, accountId);
    } finally {
      client.close();
    }
  }

  async configureWhatsapp(
    config: OpenClawWhatsAppConfigPatch,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & { accountId?: string } = {},
  ): Promise<void> {
    const { accountId, ...gatewayOptions } = options;
    const client = await this.connect(gatewayOptions);
    try {
      await client.configureWhatsapp(config, accountId);
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

  async sessionsListResult(options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {}): Promise<GatewaySessionsListResult> {
    const client = await this.connect(options);
    try {
      return await client.sessionsListResult();
    } finally {
      client.close();
    }
  }

  async operationsSnapshot(
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<OpenClawOperationsSnapshot> {
    if (!this.gatewayUrl || (!this.gatewayToken && !options.gatewayToken)) {
      await this.waitForGatewayContext({ timeoutMs: options.timeout });
    }
    const client = this.gateway(options);
    try {
      await client.connect();
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
      channel?: string;
    } = {},
  ): Promise<Record<string, any>> {
    const client = await this.connect(options);
    try {
      return await client.channelsStatus(options.probe ?? false, options.timeoutMs, options.channel);
    } finally {
      client.close();
    }
  }

  async channelsStart(
    channel: string,
    accountId?: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<Record<string, any>> {
    const client = await this.connect(options);
    try {
      return await client.channelsStart(channel, accountId);
    } finally {
      client.close();
    }
  }

  async channelsStop(
    channel: string,
    accountId?: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<Record<string, any>> {
    const client = await this.connect(options);
    try {
      return await client.channelsStop(channel, accountId);
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
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & GatewayWebLoginStartOptions = {},
  ): Promise<GatewayWebLoginStartResult> {
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
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> & GatewayWebLoginWaitOptions = {},
  ): Promise<GatewayWebLoginWaitResult> {
    const client = await this.connect(options);
    try {
      return await client.webLoginWait({
        timeoutMs: options.timeoutMs,
        accountId: options.accountId,
        currentQrDataUrl: options.currentQrDataUrl,
      });
    } finally {
      client.close();
    }
  }

  async integrationsAuthStart(
    params: GatewayIntegrationAuthStartParams,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<GatewayIntegrationAuthStartResult> {
    const client = await this.connect(options);
    try {
      return await client.integrationsAuthStart(params);
    } finally {
      client.close();
    }
  }

  async integrationsAuthStatus(
    params: GatewayIntegrationAuthStatusParams,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<GatewayIntegrationAuthStatusResult> {
    const client = await this.connect(options);
    try {
      return await client.integrationsAuthStatus(params);
    } finally {
      client.close();
    }
  }

  async integrationsStatus(
    params: GatewayIntegrationStatusParams = {},
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<GatewayIntegrationStatusResult> {
    const client = await this.connect(options);
    try {
      return await client.integrationsStatus(params);
    } finally {
      client.close();
    }
  }

  async integrationsDisconnect(
    params: GatewayIntegrationDisconnectParams,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<GatewayIntegrationDisconnectResult> {
    const client = await this.connect(options);
    try {
      return await client.integrationsDisconnect(params);
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
        options.sessionKey,
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

  async cronAdd(
    job: Record<string, any>,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<any> {
    const client = await this.connect(options);
    try {
      return await client.cronAdd(job);
    } finally {
      client.close();
    }
  }

  async cronRemove(
    jobId: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<void> {
    const client = await this.connect(options);
    try {
      await client.cronRemove(jobId);
    } finally {
      client.close();
    }
  }

  async cronRun(
    jobId: string,
    options: Omit<Partial<GatewayOptions>, 'url' | 'token'> = {},
  ): Promise<any> {
    const client = await this.connect(options);
    try {
      return await client.cronRun(jobId);
    } finally {
      client.close();
    }
  }
}

export class OpenClawProAgent extends OpenClawAgent {
  static override fromDict(data: AgentHydrationData): OpenClawProAgent {
    return new OpenClawProAgent({
      ...agentStateFromDict(data),
      gatewayUrl: this.gatewayUrlFromHostname(data.hostname),
      gatewayToken: data.gateway_token ?? null,
    });
  }
}

export class Deployments {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly agentsWsUrl: string;
  private readonly agentHttp: Pick<HTTPClient, 'get' | 'post' | 'postRaw' | 'put' | 'patch' | 'delete'>;

  constructor(
    private readonly http: HTTPClient,
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
    let agent: Agent;
    if (data.runtime === 'buzz-agent') {
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
      const values = [agent.id, agent.name, agent.handle, agent.podName, agent.hostname];
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
    allowSelf = false,
  ): Promise<string> {
    const raw = String(agentIdOrName || '').trim();
    if (!raw) {
      throw new Error('agentIdOrName is required');
    }
    if (isSelfAgentRef(raw)) {
      if (allowSelf) return 'self';
      throw new Error('self is only supported for status, start, stop, and routes');
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

  async create(options: CreateAgentOptions = {}): Promise<Agent> {
    const { config, gatewayToken } = buildAgentConfig(options.config ?? {}, {
      ...options,
      injectGatewayToken: options.injectGatewayToken ?? !isCodingAgentRuntime(options.runtime),
    });
    const body: Record<string, any> = { ...config, start: options.start ?? true };
    if (options.dryRun) body.dry_run = true;
    if (options.name) body.name = options.name;
    if (options.handle !== undefined) body.handle = options.handle;
    if (options.size) body.size = options.size;
    if (options.meta?.ui) body.meta = { ui: structuredClone(options.meta.ui) };
    if (options.tags?.length) body.tags = [...options.tags];
    if (options.runtime) body.runtime = options.runtime;

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
    const effectiveOptions: CreateAgentOptions = { ...options, runtime: options.runtime ?? 'openclaw' };
    effectiveOptions.env = {
      HYPER_API_BASE: productApiBaseFromAgentsApiBase(this.apiBase),
      ...buildOpenClawWorkspacesSyncEnv(options.workspacesSync ?? null),
      ...buildOpenClawMemoryIndexEnv(options.memoryIndex),
      ...(options.env ?? {}),
    };
    if (options.routes === undefined) {
      effectiveOptions.routes = buildOpenClawRoutes(options.openClawRoutes ?? {});
    }
    effectiveOptions.image = defaultOpenClawImage(options.image);
    if (effectiveOptions.syncRoot === undefined) effectiveOptions.syncRoot = DEFAULT_OPENCLAW_SYNC_ROOT;
    if (effectiveOptions.syncEnabled === undefined) effectiveOptions.syncEnabled = true;
    return this.create(effectiveOptions);
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
    if (options.syncAll && (options.syncInclude !== undefined || options.syncExclude !== undefined)) {
      throw new Error('syncAll cannot be combined with syncInclude or syncExclude');
    }
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
      HYPER_API_BASE: productApiBaseFromAgentsApiBase(this.apiBase),
      ...buildOpenClawWorkspacesSyncEnv(options.workspacesSync ?? null),
      ...(options.env ?? {}),
    };
    if (options.buzz) {
      for (const key of BUZZ_RESERVED_ENV_KEYS) delete effectiveEnv[key];
      Object.assign(
        effectiveEnv,
        buildBuzzLaunchEnv(runtime, options.buzz, options.name),
      );
    }
    if (buzzLaunch) {
      effectiveEnv.RUST_LOG ??= DEFAULT_BUZZ_RUST_LOG;
    }
    let syncInclude: readonly string[] | null;
    let syncExclude: readonly string[] | null;
    if (options.syncAll) {
      syncInclude = null;
      syncExclude = null;
    } else if (options.syncInclude !== undefined && options.syncInclude !== null) {
      syncInclude = options.syncInclude;
      syncExclude = null;
    } else if (options.syncExclude !== undefined) {
      syncInclude = null;
      syncExclude = options.syncExclude;
    } else if (options.syncInclude === null) {
      syncInclude = null;
      syncExclude = null;
    } else {
      syncInclude = DEFAULT_CODING_AGENT_SYNC_INCLUDES[runtime];
      syncExclude = null;
    }
    const effectiveOptions: CreateAgentOptions = {
      ...options,
      runtime,
      size: buzzLaunch ? 'large' : options.size,
      injectGatewayToken: false,
      env: effectiveEnv,
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
      syncEnabled: options.syncEnabled ?? true,
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

  async metrics(agentIdOrName: string): Promise<Record<string, any>> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    return this.agentHttp.get(`${DEPLOYMENTS_API_PREFIX}/${agentId}/metrics`);
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
    const runningFallback = items.filter((agent: Agent) => !['STOPPED', 'FAILED'].includes(agent.state.toUpperCase())).length;
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
    await this.list({ signal: options.signal });
    let retryDelay = 250;
    while (!options.signal?.aborted) {
      try {
        const token = await this.agentHttp.post<{
          version: number;
          token: string;
          ws_url: string;
        }>(`${DEPLOYMENTS_API_PREFIX}/events/token`, undefined, { signal: options.signal });
        const WebSocketImpl = globalThis.WebSocket ?? NodeWebSocket;
        const ws = new WebSocketImpl(token.ws_url);
        await new Promise<void>((resolve, reject) => {
          let opened = false;
          let ready = false;
          let processing = Promise.resolve();
          const readyTimer = setTimeout(() => {
            ws.close(1002, 'Deployment event ready timed out');
            reject(new Error('Deployment event ready timed out'));
          }, 10_000);
          const abort = () => ws.close(1000, 'Subscription cancelled');
          options.signal?.addEventListener('abort', abort, { once: true });
          ws.addEventListener('open', () => {
            opened = true;
            ws.send(JSON.stringify({ version: 1, type: 'auth', token: token.token }));
          });
          ws.addEventListener('message', (message) => {
            processing = processing.then(async () => {
              const frame = JSON.parse(await websocketMessageText(message.data)) as Record<string, unknown>;
              if (!ready) {
                if (frame.version !== 1 || frame.type !== 'ready') {
                  throw new Error('Deployment event socket did not send ready');
                }
                ready = true;
                clearTimeout(readyTimer);
                await this.list({ signal: options.signal });
                await handler({ version: 1, type: 'deployments.changed' });
                retryDelay = 250;
                return;
              }
              if (
                frame.version === 1
                && (frame.type === 'deployment.transition' || frame.type === 'deployments.changed')
              ) {
                await handler(frame as unknown as DeploymentEvent);
              }
            }).catch((error) => {
              ws.close(1002, 'Invalid deployment event');
              reject(error);
            });
          });
          ws.addEventListener('error', () => reject(new Error('Deployment event WebSocket failed')));
          ws.addEventListener('close', () => {
            clearTimeout(readyTimer);
            options.signal?.removeEventListener('abort', abort);
            processing.then(resolve, reject);
          });
          if (options.signal?.aborted) abort();
          void opened;
        });
      } catch (error) {
        if (options.signal?.aborted) break;
        if (error instanceof APIError && [401, 403].includes(error.statusCode)) throw error;
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
        void error;
      }
    }
  }

  async waitForState(
    agentIdOrName: string,
    states: readonly AgentState[],
    timeoutMs = 300_000,
    failureStates: readonly AgentState[] = [],
  ): Promise<Agent> {
    if (!states.length) throw new Error('states must not be empty');
    const agentId = await this.resolveAgentId(agentIdOrName);
    const deadline = Date.now() + timeoutMs;
    let lastState = '';
    let lastAgent: Agent | null = null;
    let wakePending = true;
    let wake: (() => void) | null = null;
    let subscriptionError: unknown;
    const controller = new AbortController();
    const subscription = this.subscribe((event) => {
      if (!event.deployment_id || event.deployment_id === agentId) {
        wakePending = true;
        wake?.();
      }
    }, { signal: controller.signal }).catch((error) => {
      subscriptionError = error;
      wake?.();
    });
    const desired = new Set(states.map((state) => state.toLowerCase()));
    const failures = new Set(failureStates.map((state) => state.toLowerCase()));
    const stateLabel = states.join(', ');
    const diagnostics = (agent: Agent | null): string => {
      if (!agent) return '';
      const details: string[] = [];
      if (agent.lastError) details.push(`lastError=${JSON.stringify(agent.lastError)}`);
      if (agent.updatedAt && !Number.isNaN(agent.updatedAt.getTime())) {
        details.push(`updatedAt=${agent.updatedAt.toISOString()}`);
      }
      return details.length ? `, ${details.join(', ')}` : '';
    };
    try {
      while (Date.now() < deadline) {
        if (wakePending) {
          wakePending = false;
          const agent = await this.get(agentId);
          lastAgent = agent;
          lastState = String(agent.state || '');
          if (desired.has(lastState.toLowerCase())) return agent;
          if (failures.has(lastState.toLowerCase())) {
            throw new Error(`Agent entered ${lastState} while waiting for ${stateLabel}${diagnostics(agent)}`);
          }
          continue;
        }
        if (subscriptionError) throw subscriptionError;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await Promise.race([
          new Promise<void>((resolve) => { wake = resolve; }),
          sleep(remaining),
        ]);
        wake = null;
      }
    } finally {
      controller.abort();
      await subscription;
    }
    throw new Error(
      `Timed out waiting for agent ${agentId} to reach ${stateLabel} (last=${lastState || 'unknown'}${diagnostics(lastAgent)})`,
    );
  }

  async waitRunning(agentIdOrName: string, timeoutMs = 300_000, pollIntervalMs = 5_000): Promise<Agent> {
    void pollIntervalMs;
    return this.waitForState(
      agentIdOrName,
      ['RUNNING'],
      timeoutMs,
      ['FAILED', 'RESTORE_FAILED', 'SYNC_FAILED', 'error'],
    );
  }

  async start(agentIdOrName: string, options: StartAgentOptions = {}): Promise<Agent> {
    if (isSelfAgentRef(agentIdOrName)) {
      const provided = Object.keys(options).filter(
        (key) => options[key as keyof StartAgentOptions] !== undefined,
      );
      if (provided.length > 0) {
        throw new Error(
          `start self uses the backend-stored launch configuration and does not accept launch overrides: ${provided.join(', ')}`,
        );
      }
      const data = await this.agentHttp.post<AgentHydrationData>(
        `${DEPLOYMENTS_API_PREFIX}/self/start`,
        {},
      );
      return this.hydrateAgent(data);
    }
    const { config, gatewayToken } = buildAgentConfig(options.config ?? {}, options);
    const body: Record<string, any> = { ...config };
    if (options.dryRun) body.dry_run = true;
    const agentId = await this.resolveAgentId(agentIdOrName, {}, true);
    const data = await this.agentHttp.post<AgentHydrationData>(`${DEPLOYMENTS_API_PREFIX}/${agentId}/start`, body);
    const agent = this.hydrateAgent(data);
    if (agent instanceof OpenClawAgent) {
      agent.gatewayToken = gatewayToken;
    }
    return agent;
  }

  async startOpenClaw(agentIdOrName: string, options: OpenClawStartAgentOptions = {}): Promise<Agent> {
    const effectiveOptions: StartAgentOptions = { ...options };
    effectiveOptions.env = {
      HYPER_API_BASE: productApiBaseFromAgentsApiBase(this.apiBase),
      ...buildOpenClawWorkspacesSyncEnv(options.workspacesSync ?? null),
      ...buildOpenClawMemoryIndexEnv(options.memoryIndex),
      ...(options.env ?? {}),
    };
    if (options.routes === undefined) {
      effectiveOptions.routes = buildOpenClawRoutes(options.openClawRoutes ?? {});
    }
    effectiveOptions.image = defaultOpenClawImage(options.image);
    if (effectiveOptions.syncRoot === undefined) effectiveOptions.syncRoot = DEFAULT_OPENCLAW_SYNC_ROOT;
    if (effectiveOptions.syncEnabled === undefined) effectiveOptions.syncEnabled = true;
    return this.start(agentIdOrName, effectiveOptions);
  }

  async startOpenClawPro(agentIdOrName: string, options: OpenClawStartAgentOptions = {}): Promise<Agent> {
    return this.startOpenClaw(agentIdOrName, {
      ...options,
      env: { OPENCLAW_DESKTOP_ENABLED: '1', ...(options.env ?? {}) },
      image: defaultOpenClawProImage(options.image),
      runtimeScopes: options.runtimeScopes ?? DEFAULT_AGENT_RUNTIME_SCOPES,
      openClawRoutes: { includeDesktop: true, ...(options.openClawRoutes ?? {}) },
    });
  }

  async update(agentIdOrName: string, options: UpdateAgentOptions = {}): Promise<Agent> {
    const body: Record<string, any> = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.handle !== undefined) body.handle = options.handle;
    if (options.size !== undefined) body.size = options.size;
    if (options.launchConfig !== undefined) body.launch_config = options.launchConfig;
    if (options.refreshFromLagoon !== undefined) body.refresh_from_lagoon = options.refreshFromLagoon;
    if (options.lastError !== undefined) body.last_error = options.lastError;
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
    const agentId = await this.resolveAgentId(agentIdOrName, {}, true);
    const data = await this.agentHttp.post<AgentHydrationData>(`${DEPLOYMENTS_API_PREFIX}/${agentId}/stop`);
    return this.hydrateAgent(data);
  }

  async getRoutes(agentIdOrName: string): Promise<AgentRoutesState> {
    const agentId = await this.resolveAgentId(agentIdOrName, {}, true);
    const data = await this.agentHttp.get<AgentRoutesHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/routes`,
    );
    return agentRoutesStateFromData(data);
  }

  async setRoutes(
    agentIdOrName: string,
    routes: Record<string, AgentRouteConfig>,
  ): Promise<AgentRoutesState> {
    const agentId = await this.resolveAgentId(agentIdOrName, {}, true);
    const body: Record<string, unknown> = { routes: structuredClone(routes) };
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
    const agentId = await this.resolveAgentId(agentIdOrName, {}, true);
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
    const agentId = await this.resolveAgentId(agentIdOrName, {}, true);
    const data = await this.agentHttp.delete<AgentRoutesHydrationData>(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/routes/${encodeURIComponent(name)}`,
    );
    return agentRoutesStateFromData(data);
  }

  async delete(agentIdOrName: string): Promise<Record<string, any>> {
    const agentId = await this.resolveAgentId(agentIdOrName);
    return this.agentHttp.delete(`${DEPLOYMENTS_API_PREFIX}/${agentId}`);
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
  ): Promise<{ agent_id: string; env: Record<string, string> }> {
    const agentId = await this.resolveAgentId(agentIdOrName, requestOptions);
    const path = `${DEPLOYMENTS_API_PREFIX}/${agentId}/env`;
    return Object.keys(requestOptions).length === 0
      ? this.agentHttp.get(path)
      : this.agentHttp.get(path, undefined, requestOptions);
  }

  async exec(target: Agent | string, command: string, options: AgentExecOptions = {}): Promise<AgentExecResult> {
    const agentId = await this.agentIdFor(target);
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
    const { suffix, params } = deploymentFileReadRequest(path, source);
    const agentId = await this.agentIdFor(target);
    const response = await this.fetchRaw(`${DEPLOYMENTS_API_PREFIX}/${agentId}/files${suffix}?${params.toString()}`);
    const payload = (await response.json()) as AgentDirectoryListing;
    return [...(payload.directories ?? []), ...(payload.files ?? [])];
  }

  async fileReadBytesWithMetadata(
    target: Agent | string,
    path: string,
    source: 'auto' | 'pod' | 's3' = 'auto',
    options?: AgentFileReadOptions,
  ): Promise<AgentFileReadBytesResult> {
    const { suffix, params } = deploymentFileReadRequest(path, source);
    const agentId = await this.agentIdFor(target);
    const response = await this.fetchRaw(`${DEPLOYMENTS_API_PREFIX}/${agentId}/files${suffix}?${params.toString()}`, {
      redirect: 'follow',
      signal: options?.signal,
    });
    const bytes = await readResponseBytes(response, path, options?.maxBytes);
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
    source: 'auto' | 'pod' | 's3' = 'auto',
    options?: AgentFileReadOptions,
  ): Promise<Uint8Array> {
    return (await this.fileReadBytesWithMetadata(target, path, source, options)).content;
  }

  async fileRead(
    target: Agent | string,
    path: string,
    source: 'auto' | 'pod' | 's3' = 'auto',
    options?: AgentFileReadOptions,
  ): Promise<string> {
    return decodeUtf8(await this.fileReadBytes(target, path, source, options));
  }

  async fileWriteBytes(
    target: Agent | string,
    path: string,
    content: Uint8Array | ArrayBuffer | string,
    destination: 'auto' | 'pod' | 's3' = 'auto',
  ): Promise<Record<string, any>> {
    path = normalizeWritableBackendFilePath(path);
    const encodedPath = encodeFilePath(path);
    const params = new URLSearchParams({ destination });
    const bytes = toUint8Array(content);
    if (bytes.byteLength > AGENT_FILE_MAX_BYTES) {
      throw new Error(`Agent file writes are limited to ${AGENT_FILE_MAX_BYTES / 1024 / 1024} MiB`);
    }
    const agentId = await this.agentIdFor(target);
    const response = await this.fetchRaw(`${DEPLOYMENTS_API_PREFIX}/${agentId}/files/${encodedPath}?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    return (await response.json()) as Record<string, any>;
  }

  async fileWrite(target: Agent | string, path: string, content: string, destination: 'auto' | 'pod' | 's3' = 'auto'): Promise<Record<string, any>> {
    return this.fileWriteBytes(target, path, content, destination);
  }

  async fileDelete(
    target: Agent | string,
    path: string,
    options: { recursive?: boolean; source?: 'auto' | 'pod' | 's3' } = {},
  ): Promise<Record<string, any>> {
    path = normalizeWritableBackendFilePath(path);
    const encodedPath = encodeFilePath(path);
    const params = new URLSearchParams();
    if (options.recursive) params.set('recursive', 'true');
    if (options.source && options.source !== 'auto') params.set('source', options.source);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const agentId = await this.agentIdFor(target);
    const response = await this.fetchRaw(
      `${DEPLOYMENTS_API_PREFIX}/${agentId}/files/${encodedPath}${suffix}`,
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

  async shellToken(
    agentIdOrName: string,
    shell?: string,
    dryRun: boolean = false,
    requestOptions: RequestOverrides = {},
  ): Promise<AgentShellTokenResponse> {
    const selectedShell = shell ?? '/bin/bash';
    const payload: Record<string, any> = { shell: selectedShell };
    if (dryRun) payload.dry_run = true;
    const agentId = await this.resolveAgentId(agentIdOrName, requestOptions);
    const path = `${DEPLOYMENTS_API_PREFIX}/${agentId}/shell/token`;
    if (Object.keys(requestOptions).length === 0) return this.agentHttp.post(path, payload);
    return this.agentHttp.post(path, payload, requestOptions);
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
          return this.shellToken(agentId, requestedShell, false, requestOptions);
        },
      );
      const baseUrl = `${this.agentsWsUrl}/shell/${agentId}`;
      const separator = baseUrl.includes("?") ? "&" : "?";
      const wsUrl =
        `${baseUrl}${separator}jwt=${encodeURIComponent(tokenData.jwt)}` +
        `&shell=${encodeURIComponent(tokenData.shell || requestedShell)}`;
      const ws = new WebSocket(wsUrl);
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

    if (shell) {
      return connectWithShell(shell);
    }

    try {
      return await connectWithShell('/bin/bash');
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const detail = error instanceof APIError ? error.detail : error instanceof Error ? error.message : '';
      const bashUnavailable = /(\/bin\/bash|\bbash\b)/i.test(detail)
        && /(not found|no such file|missing|unavailable|unsupported)/i.test(detail);
      if (!bashUnavailable) throw error;
      return connectWithShell('/bin/sh');
    }
  }
}
