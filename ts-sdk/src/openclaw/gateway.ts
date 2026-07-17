/**
 * OpenClaw Gateway WebSocket Client
 *
 * Connects to an agent's OpenClaw gateway over WebSocket for real-time
 * configuration, chat, session management, and file operations.
 *
 * Protocol: OpenClaw Gateway v3-v4
 */

import { getPublicKeyAsync, signAsync, utils as edUtils } from "@noble/ed25519";
import NodeWebSocket from "ws";

export interface GatewayOptions {
  /** WebSocket URL for the agent gateway (typically wss://{agent-host}) */
  url: string;
  /** Optional legacy query token for edge/proxy auth. Gateway auth uses `gatewayToken`. */
  token?: string;
  /** Shared gateway auth token used in the WebSocket connect handshake. */
  gatewayToken?: string;
  /** Bootstrap auth token used by newer OpenClaw gateway handshakes. */
  bootstrapToken?: string;
  /** Explicit device auth token used by newer OpenClaw gateway handshakes. */
  deviceToken?: string;
  /** Password auth field used by compatible gateway deployments. */
  password?: string;
  /** Approval-runtime auth token used by compatible gateway deployments. */
  approvalRuntimeToken?: string;
  /** Agent-runtime identity token used by compatible gateway deployments. */
  agentRuntimeIdentityToken?: string;
  /** Deployment id used for trusted pairing approval via agent exec. */
  deploymentId?: string;
  /** HyperCLI API bearer token used for trusted pairing approval via agent exec. */
  apiKey?: string;
  /** HyperCLI API base URL used for trusted pairing approval via agent exec. */
  apiBase?: string;
  /** Automatically approve first-time browser pairing using trusted agent exec. */
  autoApprovePairing?: boolean;
  /** Client ID (default: "cli") */
  clientId?: string;
  /** Client mode (default: "cli") */
  clientMode?: string;
  /** Optional client display name */
  clientDisplayName?: string;
  /** Client version sent to the gateway */
  clientVersion?: string;
  /** Client platform sent to the gateway */
  platform?: string;
  /** Optional device family sent to the gateway */
  deviceFamily?: string;
  /** Optional client instance ID */
  instanceId?: string;
  /** Optional gateway capability list */
  caps?: string[];
  /** Connection role in the connect handshake (default: "operator"). Use "node" to serve node commands. */
  role?: string;
  /** Auth scopes requested in the connect handshake (default: operator scopes for the operator role, else empty). */
  scopes?: string[];
  /** Declared node command surface advertised in the connect handshake (node role). */
  commands?: string[];
  /** Optional policy permissions advertised in the connect handshake. */
  permissions?: Record<string, boolean>;
  /** Optional PATH-like environment hint advertised in the connect handshake. */
  pathEnv?: string;
  /** Minimum gateway protocol version this client can speak. Defaults to v3 for live-agent compatibility. */
  minProtocol?: number;
  /** Maximum gateway protocol version this client can speak. */
  maxProtocol?: number;
  /** Origin header (default: omitted for non-browser SDK clients) */
  origin?: string;
  /** Default RPC timeout in ms (default: 30000) */
  timeout?: number;
  /** Called after a successful hello-ok response */
  onHello?: (hello: Record<string, any>) => void;
  /** Called after the socket closes */
  onClose?: (info: GatewayCloseInfo) => void;
  /** Called when an event sequence gap is detected */
  onGap?: (info: { expected: number; received: number }) => void;
  /** Called when a browser device pairing request is pending or updated. */
  onPairing?: (pairing: GatewayPairingState | null) => void;
}

export interface GatewayEvent {
  type: string;
  event: string;
  payload: Record<string, any>;
  seq?: number;
}

export interface ChatEvent {
  type: "content" | "thinking" | "tool_call" | "tool_result" | "done" | "error";
  text?: string;
  data?: Record<string, any>;
}

export interface GatewayAbortSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface GatewayEphemeralChatOptions {
  signal?: GatewayAbortSignal;
  timeoutMs?: number;
  maxResponseChars?: number;
  /** Request the selected model's fastest supported service tier for this hidden session. */
  fastMode?: boolean;
  onEvent?: (event: ChatEvent) => void | Promise<void>;
}

export interface GatewayChatToolCall {
  id?: string;
  name: string;
  args?: unknown;
  result?: string;
}

export interface GatewayChatMessageSummary {
  role: string;
  text: string;
  thinking: string;
  toolCalls: GatewayChatToolCall[];
  mediaUrls: string[];
  timestamp?: number;
}

export interface GatewaySessionPatch {
  key: string;
  model?: string;
  thinkingLevel?: string;
  [key: string]: unknown;
}

export interface GatewayChatAttachmentPayload {
  type: string;
  mimeType?: string;
  content?: string;
  fileName?: string;
  [key: string]: unknown;
}

export interface BrowserChatAttachment {
  id?: string;
  dataUrl: string;
  mimeType: string;
  fileName?: string;
}

export type ChatAttachment = GatewayChatAttachmentPayload | BrowserChatAttachment;

export interface GatewayCloseInfo {
  code: number;
  reason: string;
  error?: GatewayErrorShape | null;
}

export type GatewayConnectionState = "disconnected" | "connecting" | "connected";

export interface GatewayWaitReadyOptions {
  retryIntervalMs?: number;
  probe?: "config" | "status";
}

export interface GatewayPairingState {
  requestId: string;
  role: string;
  gatewayUrl: string;
  deviceId?: string;
  status: "pending" | "approving" | "approved" | "failed";
  updatedAtMs: number;
  error?: string;
}

export interface OpenClawConfigUiHint {
  label?: string;
  help?: string;
  tags?: string[];
  group?: string;
  order?: number;
  advanced?: boolean;
  sensitive?: boolean;
  placeholder?: string;
  itemTemplate?: unknown;
}

export interface OpenClawConfigSchemaResponse {
  schema: Record<string, any>;
  uiHints: Record<string, OpenClawConfigUiHint>;
  version?: string;
  generatedAt?: string;
}

export interface OpenClawConfigNodeDescriptor {
  schema: Record<string, any>;
  type?: string;
  properties: Record<string, Record<string, any>>;
  additionalProperties: boolean;
  additionalPropertySchema: Record<string, any> | null;
  isDynamicMap: boolean;
}

export interface GatewaySkillsStatusParams {
  agentId?: string;
}

export interface GatewaySkillsSearchParams {
  query?: string;
  limit?: number;
}

export interface GatewaySkillSearchOwner {
  handle?: string | null;
  displayName?: string | null;
  image?: string | null;
  [key: string]: unknown;
}

export interface GatewaySkillSearchResultItem {
  score: number;
  slug: string;
  displayName: string;
  summary?: string;
  version?: string | null;
  updatedAt?: number;
  ownerHandle?: string;
  owner?: GatewaySkillSearchOwner;
  [key: string]: unknown;
}

export interface GatewaySkillsSearchResult {
  results: GatewaySkillSearchResultItem[];
  [key: string]: unknown;
}

export interface GatewaySkillsDetailParams {
  slug: string;
}

export interface GatewaySkillsDetailResult {
  skill: {
    slug: string;
    displayName: string;
    summary?: string;
    tags?: Record<string, string>;
    createdAt: number;
    updatedAt: number;
    [key: string]: unknown;
  } | null;
  latestVersion?: {
    version: string;
    createdAt: number;
    changelog?: string;
    license?: string | null;
    [key: string]: unknown;
  } | null;
  metadata?: {
    os?: string[] | null;
    systems?: string[] | null;
    [key: string]: unknown;
  } | null;
  owner?: GatewaySkillSearchOwner | null;
  [key: string]: unknown;
}

export type GatewaySkillInstallKind = "brew" | "node" | "go" | "uv" | "download" | (string & {});

export interface GatewaySkillInstallOption {
  id: string;
  kind: GatewaySkillInstallKind;
  label: string;
  bins: string[];
  [key: string]: unknown;
}

export type GatewayClawHubSkillStatusLink =
  | {
      status: "linked";
      valid: true;
      registry: string;
      slug: string;
      installedVersion: string;
      installedAt: number;
      originPath?: string;
      lockPath?: string;
    }
  | {
      status: "invalid";
      valid: false;
      reason: string;
      registry?: string;
      slug?: string;
      installedVersion?: string;
      installedAt?: number;
      originPath?: string;
      lockPath?: string;
    };

export interface GatewayLocalSkillCardStatus {
  present: true;
  path: string;
  sizeBytes: number;
}

export interface GatewaySkillStatusConfigCheck {
  path: string;
  expected?: unknown;
  actual?: unknown;
  satisfied?: boolean;
  [key: string]: unknown;
}

export interface GatewaySkillStatusEntry {
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  filePath: string;
  baseDir: string;
  skillKey: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  blockedByAgentFilter: boolean;
  eligible: boolean;
  modelVisible: boolean;
  userInvocable: boolean;
  commandVisible: boolean;
  requirements: Record<string, unknown>;
  missing: Record<string, unknown>;
  configChecks: GatewaySkillStatusConfigCheck[];
  install: GatewaySkillInstallOption[];
  clawhub?: GatewayClawHubSkillStatusLink;
  skillCard?: GatewayLocalSkillCardStatus;
  [key: string]: unknown;
}

export interface GatewaySkillsStatusReport {
  workspaceDir: string;
  managedSkillsDir: string;
  agentId?: string;
  agentSkillFilter?: string[];
  skills: GatewaySkillStatusEntry[];
  [key: string]: unknown;
}

export interface GatewaySkillsSecurityVerdictsParams {
  agentId?: string;
}

export interface GatewaySkillSecurityVerdictItem {
  registry: string;
  ok: boolean;
  decision: string;
  reasons: string[];
  requestedSlug: string;
  requestedVersion: string;
  slug?: string | null;
  version?: string | null;
  displayName?: string | null;
  publisherHandle?: string | null;
  publisherDisplayName?: string | null;
  createdAt?: number | null;
  checkedAt?: number | null;
  skillUrl?: string | null;
  securityAuditUrl?: string | null;
  securityStatus?: string | null;
  securityPassed?: boolean | null;
  error?: {
    code?: string;
    message?: string;
  };
  [key: string]: unknown;
}

export interface GatewaySkillsSecurityVerdictsResult {
  schema: "openclaw.skills.security-verdicts.v1";
  items: GatewaySkillSecurityVerdictItem[];
}

export interface GatewaySkillsSkillCardParams {
  agentId?: string;
  skillKey: string;
}

export interface GatewaySkillsSkillCardResult {
  schema: "openclaw.skills.skill-card.v1";
  skillKey: string;
  path: string;
  sizeBytes: number;
  content: string;
}

export interface GatewayClawHubSkillInstallParams {
  source: "clawhub";
  slug: string;
  version?: string;
  force?: boolean;
  timeoutMs?: number;
}

export interface GatewayLocalSkillInstallParams {
  name: string;
  installId: string;
  dangerouslyForceUnsafeInstall?: boolean;
  timeoutMs?: number;
}

export interface GatewayUploadedSkillInstallParams {
  source: "upload";
  uploadId: string;
  slug: string;
  force?: boolean;
  sha256?: string;
  timeoutMs?: number;
}

export type GatewaySkillsInstallParams =
  | GatewayClawHubSkillInstallParams
  | GatewayLocalSkillInstallParams
  | GatewayUploadedSkillInstallParams;

export type GatewaySkillsInstallResult = {
  ok: boolean;
  message?: string;
  stdout?: string;
  stderr?: string;
  code?: number | null;
  slug?: string;
  version?: string;
  targetDir?: string;
  warnings?: string[];
  [key: string]: unknown;
};

export interface GatewaySkillConfigUpdateParams {
  skillKey: string;
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
}

export type GatewayClawHubSkillsUpdateParams =
  | { source: "clawhub"; slug: string; all?: never }
  | { source: "clawhub"; all: true; slug?: never };

export type GatewaySkillsUpdateParams = GatewaySkillConfigUpdateParams | GatewayClawHubSkillsUpdateParams;

export interface GatewaySkillsUpdateResult {
  ok: boolean;
  skillKey: string;
  config: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GatewayIntegrationAuthStartParams {
  integrationId: string;
  scopes?: string[];
  accountId?: string;
  force?: boolean;
  [key: string]: unknown;
}

export interface GatewayIntegrationAuthStartResult {
  authId?: string;
  integrationId?: string;
  verificationUri?: string;
  url?: string;
  userCode?: string;
  expiresAt?: string | number;
  intervalMs?: number;
  scopes?: string[];
  instructions?: string;
  [key: string]: unknown;
}

export interface GatewayIntegrationAuthStatusParams {
  authId: string;
  integrationId?: string;
  accountId?: string;
  [key: string]: unknown;
}

export interface GatewayIntegrationAuthStatusResult {
  status?: string;
  integrationId?: string;
  connectionId?: string;
  accountId?: string;
  accountDisplayName?: string;
  scopes?: string[];
  error?: string;
  [key: string]: unknown;
}

export interface GatewayIntegrationStatusEntry {
  configured?: boolean;
  authenticated?: boolean;
  usable?: boolean;
  connectionId?: string;
  accountId?: string;
  accountDisplayName?: string;
  scopes?: string[];
  missingScopes?: string[];
  errorDetail?: string;
  probe?: {
    ok?: boolean;
    code?: string;
    message?: string;
    latencyMs?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GatewayIntegrationStatusParams {
  integrationId?: string;
  connectionId?: string;
  probe?: boolean;
  timeoutMs?: number;
  [key: string]: unknown;
}

export interface GatewayIntegrationStatusResult {
  integrations?: Record<string, GatewayIntegrationStatusEntry>;
  integration?: GatewayIntegrationStatusEntry;
  [key: string]: unknown;
}

export interface GatewayIntegrationDisconnectParams {
  integrationId: string;
  connectionId?: string;
  accountId?: string;
  revoke?: boolean;
  [key: string]: unknown;
}

export interface GatewayIntegrationDisconnectResult {
  ok: boolean;
  integrationId?: string;
  connectionId?: string;
  [key: string]: unknown;
}

export interface ChannelsStatusParams {
  probe?: boolean;
  timeoutMs?: number;
  channel?: string;
}

export type ChannelCredentialStatus = "available" | "configured_unavailable" | "missing";

export interface ChannelAccountSnapshot {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  linked?: boolean;
  running?: boolean;
  connected?: boolean;
  restartPending?: boolean;
  reconnectAttempts?: number;
  lastConnectedAt?: number;
  lastError?: string;
  healthState?: string;
  lastStartAt?: number;
  lastStopAt?: number;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  lastMessageAt?: number | null;
  lastEventAt?: number | null;
  lastTransportActivityAt?: number;
  statusState?: string;
  terminalDisconnect?: boolean;
  busy?: boolean;
  activeRuns?: number;
  lastRunActivityAt?: number;
  lastProbeAt?: number;
  mode?: string;
  dmPolicy?: string;
  allowFrom?: string[];
  tokenSource?: string;
  botTokenSource?: string;
  appTokenSource?: string;
  signingSecretSource?: string;
  tokenStatus?: ChannelCredentialStatus;
  botTokenStatus?: ChannelCredentialStatus;
  appTokenStatus?: ChannelCredentialStatus;
  signingSecretStatus?: ChannelCredentialStatus;
  userTokenStatus?: ChannelCredentialStatus;
  baseUrl?: string;
  allowUnmentionedGroups?: boolean;
  cliPath?: string | null;
  dbPath?: string | null;
  port?: number | null;
  probe?: unknown;
  audit?: unknown;
  application?: unknown;
  [key: string]: unknown;
}

export interface ChannelUiMeta {
  id: string;
  label: string;
  detailLabel: string;
  systemImage?: string;
  [key: string]: unknown;
}

export interface ChannelEventLoopHealth {
  degraded: boolean;
  reasons: Array<"event_loop_delay" | "event_loop_utilization" | "cpu">;
  intervalMs: number;
  delayP99Ms: number;
  delayMaxMs: number;
  utilization: number;
  cpuCoreRatio: number;
  [key: string]: unknown;
}

export interface ChannelsStatusResult {
  ts: number;
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channelDetailLabels?: Record<string, string>;
  channelSystemImages?: Record<string, string>;
  channelMeta?: ChannelUiMeta[];
  channels: Record<string, unknown>;
  channelAccounts: Record<string, ChannelAccountSnapshot[]>;
  channelDefaultAccountId: Record<string, string>;
  eventLoop?: ChannelEventLoopHealth;
  partial?: boolean;
  warnings?: string[];
  [key: string]: unknown;
}

export type GatewayEventHandler = (event: GatewayEvent) => void;
export type GatewayConnectionStateHandler = (state: GatewayConnectionState) => void;

export type GatewayClientRequestOptions = {
  expectFinal?: boolean;
  timeoutMs?: number | null;
  signal?: AbortSignal;
  /** Called once for expectFinal requests after an accepted response, before the final result. */
  onAccepted?: (payload: unknown) => void;
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (err: unknown) => void;
  expectFinal: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  cleanup: () => void;
  onAccepted?: (payload: unknown) => void;
  acceptedNotified?: boolean;
};

type DeviceTokenEntry = {
  token: string;
  role: string;
  scopes: string[];
  updatedAtMs: number;
  gatewayUrl?: string;
};

type DeviceAuthStore = {
  version: 1;
  deviceId?: string;
  publicKey?: string;
  privateKey?: string;
  createdAtMs?: number;
  tokens?: Record<string, DeviceTokenEntry>;
  pendingPairings?: Record<string, GatewayPairingState>;
};

type DeviceIdentityRecord = {
  deviceId: string;
  publicKey: string;
  privateKey: string;
  createdAtMs?: number;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type NavigatorLike = {
  platform?: string;
  userAgent?: string;
  language?: string;
};

type GatewayErrorShape = {
  code: string;
  message: string;
  details?: unknown;
};

class GatewayRequestError extends Error {
  readonly gatewayCode: string;
  readonly details?: unknown;

  constructor(error: GatewayErrorShape) {
    super(error.message);
    this.name = "GatewayRequestError";
    this.gatewayCode = error.code;
    this.details = error.details;
  }
}

export const MIN_GATEWAY_VERSION = 3;
export const MAX_GATEWAY_VERSION = 4;
const DEFAULT_CONNECTION_TIMEOUT = 30_000;
const WEB_LOGIN_WAIT_TIMEOUT = 120_000;
const DEFAULT_AGENT_TIMEOUT = 900_000;
const SKILLS_MUTATION_TIMEOUT = 300_000;
const RECONNECT_CLOSE_CODE = 4008;
const DEFAULT_CLIENT_ID = "cli";
const DEFAULT_CLIENT_MODE = "cli";
const DEFAULT_CLIENT_VERSION = "@hypercli/sdk";
const DEFAULT_CAPS = ["tool-events"];
const CONNECT_TIMER_MS = 750;
const INITIAL_BACKOFF_MS = 800;
const MAX_BACKOFF_MS = 15_000;
const BACKOFF_MULTIPLIER = 1.7;
const OPERATOR_ROLE = "operator";
const OPERATOR_SCOPES = ["operator.admin", "operator.approvals", "operator.pairing"];
const STORAGE_KEY = "openclaw.device.auth.v1";
const CONNECT_ERROR_PAIRING_REQUIRED = "PAIRING_REQUIRED";
const CONNECT_ERROR_AUTH_TOKEN_MISMATCH = "AUTH_TOKEN_MISMATCH";
const CONNECT_ERROR_AUTH_RATE_LIMITED = "AUTH_RATE_LIMITED";
const CONNECT_ERROR_DEVICE_TOKEN_MISMATCH = "AUTH_DEVICE_TOKEN_MISMATCH";
const VALID_CLIENT_IDS = new Set([
  "webchat-ui",
  "openclaw-control-ui",
  "openclaw-tui",
  "webchat",
  "cli",
  "gateway-client",
  "openclaw-macos",
  "openclaw-ios",
  "openclaw-watchos",
  "openclaw-android",
  "node-host",
  "openclaw-worker",
  "test",
  "fingerprint",
  "openclaw-probe",
]);
const VALID_CLIENT_MODES = new Set([
  "webchat",
  "cli",
  "ui",
  "backend",
  "node",
  "worker",
  "probe",
  "test",
]);

let memoryDeviceAuthStore: DeviceAuthStore | null = null;

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function asContentItems(value: unknown): Record<string, any>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, any> => item !== null);
}

function isBrowserChatAttachment(attachment: ChatAttachment): attachment is BrowserChatAttachment {
  return typeof (attachment as BrowserChatAttachment).dataUrl === "string";
}

function parseAttachmentDataUrl(
  dataUrl: string,
): { mimeType: string; content: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  return { mimeType: match[1], content: match[2] };
}

export function normalizeChatAttachments(
  attachments?: ChatAttachment[],
): GatewayChatAttachmentPayload[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.map((attachment) => {
    if (!isBrowserChatAttachment(attachment)) {
      return attachment;
    }
    const parsed = parseAttachmentDataUrl(attachment.dataUrl);
    if (!parsed) {
      throw new Error(`Invalid chat attachment dataUrl for mime type ${attachment.mimeType}`);
    }
    return {
      type: "image",
      mimeType: parsed.mimeType,
      content: parsed.content,
      ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
    };
  });
}

function normalizeToolArgs(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function stringifyToolResult(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function gatewayToolCallId(record: Record<string, any>): string | undefined {
  const direct =
    (typeof record.id === "string" && record.id.trim()) ||
    (typeof record.toolCallId === "string" && record.toolCallId.trim()) ||
    (typeof record.tool_call_id === "string" && record.tool_call_id.trim());
  return direct || undefined;
}

function gatewayToolName(record: Record<string, any>): string | undefined {
  const direct =
    (typeof record.name === "string" && record.name.trim()) ||
    (typeof record.toolName === "string" && record.toolName.trim()) ||
    (typeof record.tool_name === "string" && record.tool_name.trim());
  return direct || undefined;
}

function gatewayToolStreamPayload(record: Record<string, any>): Record<string, any> {
  const id = gatewayToolCallId(record);
  const name = gatewayToolName(record);
  return {
    ...(id ? { toolCallId: id } : {}),
    ...(name ? { name } : {}),
  };
}

function mergeGatewayToolResult(
  toolCalls: GatewayChatToolCall[],
  result: GatewayChatToolCall,
): GatewayChatToolCall[] {
  const next = [...toolCalls];
  let index = -1;
  for (let cursor = next.length - 1; cursor >= 0; cursor -= 1) {
    const entry = next[cursor];
    if (result.id && entry.id && entry.id === result.id) {
      index = cursor;
      break;
    }
    if (result.name && entry.name === result.name && (entry.result === null || entry.result === undefined)) {
      index = cursor;
      break;
    }
  }
  if (index >= 0) {
    const current = next[index];
    next[index] = {
      ...current,
      ...(result.id ? { id: result.id } : {}),
      ...(result.result !== undefined ? { result: result.result } : {}),
    };
    return next;
  }
  next.push(result);
  return next;
}

export function extractGatewayChatThinking(message: unknown): string {
  const record = asRecord(message);
  if (!record) {
    return "";
  }
  const parts = asContentItems(record.content)
    .map((item) => {
      if (item.type !== "thinking" || typeof item.thinking !== "string") {
        return null;
      }
      return item.thinking.trim();
    })
    .filter((value): value is string => Boolean(value));
  return parts.join("\n");
}

export function extractGatewayChatMediaUrls(message: unknown): string[] {
  const record = asRecord(message);
  if (!record) {
    return [];
  }
  const mediaUrls: string[] = [];
  for (const item of asContentItems(record.content)) {
    if (item.type !== "image" && item.type !== "audio" && item.type !== "input_audio" && item.type !== "output_audio") {
      continue;
    }
    const source = asRecord(item.source);
    if (!source) {
      continue;
    }
    if (source.type === "url" && typeof source.url === "string" && source.url.trim()) {
      mediaUrls.push(source.url);
      continue;
    }
    if (source.type === "base64" && typeof source.data === "string" && source.data.trim()) {
      const mimeType =
        typeof source.media_type === "string" && source.media_type.trim()
          ? source.media_type.trim()
          : item.type === "image"
            ? "image/png"
            : "audio/mpeg";
      mediaUrls.push(`data:${mimeType};base64,${source.data}`);
    }
  }
  if (typeof record.mediaUrl === "string" && record.mediaUrl.trim()) {
    mediaUrls.push(record.mediaUrl);
  }
  if (Array.isArray(record.mediaUrls)) {
    for (const entry of record.mediaUrls) {
      if (typeof entry === "string" && entry.trim()) {
        mediaUrls.push(entry);
      }
    }
  }
  return mediaUrls;
}

export function extractGatewayChatToolCalls(message: unknown): GatewayChatToolCall[] {
  const record = asRecord(message);
  if (!record) {
    return [];
  }

  let toolCalls: GatewayChatToolCall[] = [];
  for (const item of asContentItems(record.content)) {
    const kind = typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
    const name = gatewayToolName(item);
    const id = gatewayToolCallId(item);

    if (
      kind === "toolcall" ||
      kind === "tool_call" ||
      kind === "tooluse" ||
      kind === "tool_use" ||
      (name && (item.arguments !== undefined || item.args !== undefined))
    ) {
      toolCalls.push({
        ...(id ? { id } : {}),
        name: name ?? "tool",
        args: normalizeToolArgs(item.arguments ?? item.args),
      });
      continue;
    }

    if (kind === "toolresult" || kind === "tool_result") {
      toolCalls = mergeGatewayToolResult(toolCalls, {
        ...(id ? { id } : {}),
        name: name ?? "tool",
        result: stringifyToolResult(item.text ?? item.content ?? item.result),
      });
    }
  }

  if (Array.isArray(record.tool_calls)) {
    for (const item of record.tool_calls) {
      const tool = asRecord(item);
      if (!tool) continue;
      const name = gatewayToolName(tool);
      if (!name) continue;
      toolCalls.push({
        ...(gatewayToolCallId(tool) ? { id: gatewayToolCallId(tool) } : {}),
        name,
        args: normalizeToolArgs(tool.arguments ?? tool.args),
      });
    }
  }

  const topLevelToolName = gatewayToolName(record);
  const topLevelResult = stringifyToolResult(
    record.result ?? record.content ?? record.text ?? record.partialResult,
  );
  const role = typeof record.role === "string" ? record.role.trim().toLowerCase() : "";
  if (
    topLevelToolName &&
    topLevelResult &&
    (role === "toolresult" || role === "tool_result" || record.toolCallId || record.tool_call_id)
  ) {
    toolCalls = mergeGatewayToolResult(toolCalls, {
      ...(gatewayToolCallId(record) ? { id: gatewayToolCallId(record) } : {}),
      name: topLevelToolName,
      result: topLevelResult,
    });
  }

  return toolCalls;
}

export function normalizeGatewayChatMessage(message: unknown): GatewayChatMessageSummary | null {
  const record = asRecord(message);
  if (!record) {
    return null;
  }
  const text = extractMessageText(record) ?? "";
  const thinking = extractGatewayChatThinking(record);
  const toolCalls = extractGatewayChatToolCalls(record);
  const mediaUrls = extractGatewayChatMediaUrls(record);
  const timestamp = typeof record.timestamp === "number" ? record.timestamp : undefined;
  const role = typeof record.role === "string" && record.role.trim() ? record.role : "assistant";

  if (!text && !thinking && toolCalls.length === 0 && mediaUrls.length === 0) {
    return null;
  }

  return {
    role,
    text,
    thinking,
    toolCalls,
    mediaUrls,
    ...(timestamp !== undefined ? { timestamp } : {}),
  };
}

function extractMessageText(message: unknown): string | null {
  if (typeof message === "string") {
    return message;
  }
  const record = asRecord(message);
  if (!record) {
    return null;
  }
  const content = record.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((entry) => {
        const item = asRecord(entry);
        if (!item || item.type !== "text" || typeof item.text !== "string" || !item.text) {
          return null;
        }
        return item.text;
      })
      .filter((value): value is string => typeof value === "string");
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  return typeof record.text === "string" ? record.text : null;
}

function extractMessageRunId(message: unknown): string | null {
  const record = asRecord(message);
  if (!record) {
    return null;
  }
  const directRunId = typeof record.runId === "string" ? record.runId.trim() : "";
  if (directRunId) {
    return directRunId;
  }
  const agentRunId = typeof record.agentRunId === "string" ? record.agentRunId.trim() : "";
  if (agentRunId) {
    return agentRunId;
  }
  const meta = asRecord(record.meta);
  const metaRunId = typeof meta?.runId === "string" ? meta.runId.trim() : "";
  return metaRunId || null;
}

function latestHistoryAssistantText(messages: unknown[], acceptedRunIds: Set<string>): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index]);
    if (!message) {
      continue;
    }
    const role = typeof message.role === "string" ? message.role.trim().toLowerCase() : "";
    if (role !== "assistant") {
      continue;
    }
    const messageRunId = extractMessageRunId(message);
    if (messageRunId && acceptedRunIds.size > 0 && !acceptedRunIds.has(messageRunId)) {
      continue;
    }
    const text = extractMessageText(message)?.trim();
    if (text) {
      return text;
    }
  }
  return null;
}

function streamDelta(previousText: string, nextText: string): { delta: string; nextText: string } {
  if (!nextText) {
    return { delta: "", nextText: previousText };
  }
  if (previousText && nextText.startsWith(previousText)) {
    return { delta: nextText.slice(previousText.length), nextText };
  }
  if (nextText === previousText) {
    return { delta: "", nextText: previousText };
  }
  return { delta: nextText, nextText };
}

function parseAgentSessionKey(sessionKey: string | null | undefined): { agentId: string; rest: string } | null {
  const normalized = (sessionKey ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const parts = normalized.split(":").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "agent") {
    return null;
  }
  const agentId = parts[1]?.trim();
  const rest = parts.slice(2).join(":").trim();
  if (!agentId || !rest) {
    return null;
  }
  return { agentId, rest };
}

function sameSessionKey(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = (left ?? "").trim().toLowerCase();
  const normalizedRight = (right ?? "").trim().toLowerCase();
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const parsedLeft = parseAgentSessionKey(normalizedLeft);
  const parsedRight = parseAgentSessionKey(normalizedRight);
  if (parsedLeft && parsedRight) {
    return parsedLeft.agentId === parsedRight.agentId && parsedLeft.rest === parsedRight.rest;
  }
  if (parsedLeft) {
    return parsedLeft.rest === normalizedRight;
  }
  if (parsedRight) {
    return normalizedLeft === parsedRight.rest;
  }
  return false;
}

function splitConfigPath(path: string): string[] {
  return path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) =>
      part.endsWith("[]") && part !== "[]"
        ? [part.slice(0, -2), "[]"]
        : [part],
    );
}

export function normalizeOpenClawConfigSchemaNode(value: unknown): Record<string, any> {
  const schema = asRecord(value) ?? {};
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : [];
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : [];
  const union = [...oneOf, ...anyOf];
  if (union.length === 0) return schema;
  const primary = union.find((entry) => {
    const obj = asRecord(entry);
    if (!obj) return false;
    const t = obj.type;
    if (typeof t === "string") return t !== "null";
    if (Array.isArray(t)) return t.some((v) => v !== "null");
    return true;
  });
  return asRecord(primary) ?? schema;
}

export function describeOpenClawConfigNode(value: unknown): OpenClawConfigNodeDescriptor {
  const schema = normalizeOpenClawConfigSchemaNode(value);
  const rawType = schema.type;
  const type = Array.isArray(rawType)
    ? (rawType.find((entry) => entry !== "null") as string | undefined)
    : (typeof rawType === "string" ? rawType : undefined);
  const rawProperties = asRecord(schema.properties) ?? {};
  const properties: Record<string, Record<string, any>> = {};
  for (const [key, child] of Object.entries(rawProperties)) {
    const childSchema = asRecord(child);
    if (childSchema) {
      properties[key] = childSchema;
    }
  }
  const additionalPropertySchema = asRecord(schema.additionalProperties);
  const additionalProperties = schema.additionalProperties === true || Boolean(additionalPropertySchema);
  return {
    schema,
    type,
    properties,
    additionalProperties,
    additionalPropertySchema,
    isDynamicMap:
      (type === "object" || Object.keys(properties).length > 0 || additionalProperties) &&
      additionalProperties,
  };
}

export function createOpenClawConfigValue(value: unknown): unknown {
  const descriptor = describeOpenClawConfigNode(value);
  switch (descriptor.type) {
    case "object":
      return {};
    case "array":
      return [];
    case "boolean":
      return false;
    case "number":
    case "integer":
      return 0;
    default:
      return "";
  }
}

function resolveSchemaRef(
  ref: string,
  root: Record<string, any>,
): Record<string, any> | null {
  // Handle JSON Pointer style refs: #/$defs/Name, #/definitions/Name
  if (!ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let cursor: any = root;
  for (const part of parts) {
    cursor = asRecord(cursor)?.[part];
    if (cursor === undefined || cursor === null) return null;
  }
  return asRecord(cursor);
}

function mergeAllOfSchemas(schemas: Record<string, any>[]): Record<string, any> {
  const merged: Record<string, any> = {};
  for (const schema of schemas) {
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'properties') {
        merged.properties = { ...(asRecord(merged.properties) ?? {}), ...(asRecord(value) ?? {}) };
      } else if (key === 'required' && Array.isArray(value)) {
        merged.required = [...(Array.isArray(merged.required) ? merged.required : []), ...value];
      } else if (!(key in merged)) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function resolveSchemaNode(
  node: Record<string, any>,
  root: Record<string, any>,
  visited: Set<string>,
): Record<string, any> {
  // Resolve $ref
  const ref = typeof node.$ref === 'string' ? node.$ref : null;
  if (ref) {
    if (visited.has(ref)) return node; // circular reference guard
    visited.add(ref);
    const resolved = resolveSchemaRef(ref, root);
    if (resolved) {
      // Merge any sibling properties (e.g. title, description) with the resolved ref
      const { $ref: _, ...siblings } = node;
      const resolvedNode = resolveSchemaNode(resolved, root, visited);
      return Object.keys(siblings).length > 0
        ? { ...resolvedNode, ...siblings, ...(resolvedNode.properties && siblings.properties ? { properties: { ...resolvedNode.properties, ...siblings.properties } } : {}) }
        : resolvedNode;
    }
  }

  // Resolve allOf
  const allOf = Array.isArray(node.allOf) ? node.allOf : null;
  if (allOf) {
    const resolved = allOf
      .map((entry: unknown) => asRecord(entry))
      .filter((entry): entry is Record<string, any> => entry !== null)
      .map((entry) => resolveSchemaNode(entry, root, new Set(visited)));
    const { allOf: _, ...rest } = node;
    const merged = mergeAllOfSchemas([...resolved, rest]);
    return merged;
  }

  // Recursively resolve properties
  const props = asRecord(node.properties);
  if (props) {
    const resolvedProps: Record<string, any> = {};
    for (const [key, child] of Object.entries(props)) {
      const childSchema = asRecord(child);
      if (childSchema) {
        resolvedProps[key] = resolveSchemaNode(childSchema, root, new Set(visited));
      } else {
        resolvedProps[key] = child;
      }
    }
    return { ...node, properties: resolvedProps };
  }

  // Resolve additionalProperties if it's a schema object
  const additionalProps = asRecord(node.additionalProperties);
  if (additionalProps) {
    return { ...node, additionalProperties: resolveSchemaNode(additionalProps, root, new Set(visited)) };
  }

  // Resolve items (for array schemas)
  const items = asRecord(node.items);
  if (items) {
    return { ...node, items: resolveSchemaNode(items, root, new Set(visited)) };
  }

  return node;
}

function resolveSchemaRefs(schema: Record<string, any>): Record<string, any> {
  return resolveSchemaNode(schema, schema, new Set());
}

export function normalizeOpenClawConfigSchema(
  value: unknown,
): OpenClawConfigSchemaResponse | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const wrappedSchema = asRecord(raw.schema);
  const uiHints = asRecord(raw.uiHints) ?? {};
  const resolvedSchema = wrappedSchema
    ? resolveSchemaRefs(wrappedSchema)
    : resolveSchemaRefs(raw);
  const normalized: OpenClawConfigSchemaResponse = {
    schema: resolvedSchema,
    uiHints: uiHints as Record<string, OpenClawConfigUiHint>,
  };

  if (typeof raw.version === "string") {
    normalized.version = raw.version;
  }
  if (typeof raw.generatedAt === "string") {
    normalized.generatedAt = raw.generatedAt;
  }

  return normalized;
}

export function resolveOpenClawConfigUiHint(
  source: OpenClawConfigSchemaResponse | Record<string, OpenClawConfigUiHint> | null | undefined,
  path: string,
): { path: string; hint: OpenClawConfigUiHint } | null {
  if (!path.trim()) return null;
  const sourceRecord = asRecord(source);
  const uiHints =
    sourceRecord && asRecord(sourceRecord.uiHints)
      ? (sourceRecord.uiHints as Record<string, OpenClawConfigUiHint>)
      : (sourceRecord as Record<string, OpenClawConfigUiHint> | null);
  if (!uiHints || typeof uiHints !== "object") return null;

  const targetParts = splitConfigPath(path);
  let best: { path: string; hint: OpenClawConfigUiHint; wildcardCount: number } | null = null;

  for (const [hintPath, hint] of Object.entries(uiHints)) {
    const hintParts = splitConfigPath(hintPath);
    if (hintParts.length !== targetParts.length) continue;

    let wildcardCount = 0;
    let matches = true;
    for (let index = 0; index < hintParts.length; index += 1) {
      const hintPart = hintParts[index];
      const targetPart = targetParts[index];
      if (hintPart === targetPart) continue;
      if (hintPart === "*" || hintPart === "[]") {
        wildcardCount += 1;
        continue;
      }
      matches = false;
      break;
    }

    if (!matches) continue;
    if (!best || wildcardCount < best.wildcardCount) {
      best = { path: hintPath, hint, wildcardCount };
    }
  }

  return best ? { path: best.path, hint: best.hint } : null;
}

function normalizeClientId(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && VALID_CLIENT_IDS.has(normalized) ? normalized : DEFAULT_CLIENT_ID;
}

function normalizeClientMode(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && VALID_CLIENT_MODES.has(normalized) ? normalized : DEFAULT_CLIENT_MODE;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function normalizeProtocolVersion(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback;
}

function normalizePermissions(value: Record<string, boolean> | undefined): Record<string, boolean> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const entries = Object.entries(value)
    .filter(([key, allowed]) => key.trim() && typeof allowed === "boolean")
    .map(([key, allowed]) => [key.trim(), allowed] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function getNavigatorLike(): NavigatorLike | null {
  const maybeNavigator = (globalThis as typeof globalThis & { navigator?: NavigatorLike }).navigator;
  return maybeNavigator ?? null;
}

function resolvePlatform(value: string | undefined): string {
  const normalized = value?.trim();
  if (normalized) return normalized;
  const browserNavigator = getNavigatorLike();
  if (browserNavigator?.platform) return browserNavigator.platform;
  if (typeof process !== "undefined" && process.platform) return process.platform;
  return "web";
}

function inferBrowserName(userAgent: string | undefined): string | null {
  const ua = userAgent ?? "";
  if (!ua) return null;
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  return null;
}

function inferPlatformName(platform: string): string | null {
  const normalized = platform.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("mac")) return "macOS";
  if (normalized.includes("win")) return "Windows";
  if (normalized.includes("linux")) return "Linux";
  if (normalized.includes("iphone") || normalized.includes("ipad") || normalized.includes("ios")) {
    return "iOS";
  }
  if (normalized.includes("android")) return "Android";
  return platform.trim();
}

function resolveBrowserHost(): string | null {
  const browserWindow = (globalThis as typeof globalThis & {
    window?: { location?: { hostname?: string } };
  }).window;
  const hostname = browserWindow?.location?.hostname?.trim();
  return hostname || null;
}

function resolveClientDisplayName(value: string | undefined, platform: string): string {
  const provided = value?.trim();
  if (provided) return provided;
  const browserName = inferBrowserName(resolveUserAgent());
  const platformName = inferPlatformName(platform);
  const host = resolveBrowserHost();
  const details = [browserName, platformName ? `on ${platformName}` : null]
    .filter(Boolean)
    .join(" ");
  if (details && host) {
    return `Hyper Agent Web (${details}, ${host})`;
  }
  if (details) {
    return `Hyper Agent Web (${details})`;
  }
  if (host) {
    return `Hyper Agent Web (${host})`;
  }
  return "Hyper Agent Web";
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  if (!Array.isArray(scopes)) {
    return [];
  }
  const unique = new Set<string>();
  for (const scope of scopes) {
    const normalized = scope.trim();
    if (normalized) unique.add(normalized);
  }
  return [...unique].sort();
}

function getStorage(): StorageLike | null {
  const storage = (globalThis as typeof globalThis & { localStorage?: StorageLike }).localStorage;
  return storage ?? null;
}

function readDeviceAuthStore(): DeviceAuthStore | null {
  const storage = getStorage();
  if (!storage) {
    return memoryDeviceAuthStore;
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceAuthStore;
    return parsed?.version === 1 && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeDeviceAuthStore(store: DeviceAuthStore): void {
  const normalized: DeviceAuthStore = {
    version: 1,
    ...(store.deviceId ? { deviceId: store.deviceId } : {}),
    ...(store.publicKey ? { publicKey: store.publicKey } : {}),
    ...(store.privateKey ? { privateKey: store.privateKey } : {}),
    ...(typeof store.createdAtMs === "number" ? { createdAtMs: store.createdAtMs } : {}),
    ...(store.tokens ? { tokens: store.tokens } : {}),
    ...(store.pendingPairings ? { pendingPairings: store.pendingPairings } : {}),
  };
  const storage = getStorage();
  if (!storage) {
    memoryDeviceAuthStore = normalized;
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    memoryDeviceAuthStore = normalized;
  }
}

function storageScopeKey(scope: string, role: string): string {
  return `${scope.trim()}|${role.trim()}`;
}

function loadStoredDeviceToken(deviceId: string, scope: string, role: string): DeviceTokenEntry | null {
  const store = readDeviceAuthStore();
  if (!store || store.deviceId !== deviceId || !store.tokens) return null;
  const entry = store.tokens[storageScopeKey(scope, role)];
  return entry && typeof entry.token === "string" ? entry : null;
}

function storeStoredDeviceToken(params: {
  deviceId: string;
  scope: string;
  gatewayUrl?: string;
  role: string;
  token: string;
  scopes?: string[];
}): DeviceTokenEntry {
  const role = params.role.trim();
  const key = storageScopeKey(params.scope, role);
  const existing = readDeviceAuthStore();
  const next: DeviceAuthStore = {
    version: 1,
    ...(existing?.deviceId ? { deviceId: existing.deviceId } : {}),
    ...(existing?.publicKey ? { publicKey: existing.publicKey } : {}),
    ...(existing?.privateKey ? { privateKey: existing.privateKey } : {}),
    ...(typeof existing?.createdAtMs === "number" ? { createdAtMs: existing.createdAtMs } : {}),
    ...(existing?.pendingPairings ? { pendingPairings: existing.pendingPairings } : {}),
    tokens: {
      ...(existing?.tokens ?? {}),
      [key]: {
        token: params.token,
        role,
        scopes: normalizeScopes(params.scopes),
        updatedAtMs: Date.now(),
        ...(params.gatewayUrl ? { gatewayUrl: params.gatewayUrl } : {}),
      },
    },
  };
  if (!next.deviceId) {
    next.deviceId = params.deviceId;
  }
  writeDeviceAuthStore(next);
  return next.tokens?.[key] as DeviceTokenEntry;
}

function clearStoredDeviceToken(deviceId: string, scope: string, role: string): void {
  const store = readDeviceAuthStore();
  if (!store || store.deviceId !== deviceId || !store.tokens) return;
  const key = storageScopeKey(scope, role);
  if (!store.tokens[key]) return;
  const nextTokens = { ...store.tokens };
  delete nextTokens[key];
  writeDeviceAuthStore({
    version: 1,
    ...(store.deviceId ? { deviceId: store.deviceId } : {}),
    ...(store.publicKey ? { publicKey: store.publicKey } : {}),
    ...(store.privateKey ? { privateKey: store.privateKey } : {}),
    ...(typeof store.createdAtMs === "number" ? { createdAtMs: store.createdAtMs } : {}),
    ...(store.pendingPairings ? { pendingPairings: store.pendingPairings } : {}),
    tokens: nextTokens,
  });
}

function pairingStoreKey(scope: string, role: string): string {
  return storageScopeKey(scope, role);
}

function loadPendingPairing(scope: string, role: string): GatewayPairingState | null {
  const store = readDeviceAuthStore();
  const key = pairingStoreKey(scope, role);
  return store?.pendingPairings?.[key] ?? null;
}

function storePendingPairing(pairing: GatewayPairingState, scope: string): GatewayPairingState {
  const existing = readDeviceAuthStore();
  const key = pairingStoreKey(scope, pairing.role);
  writeDeviceAuthStore({
    version: 1,
    ...(existing?.deviceId ? { deviceId: existing.deviceId } : {}),
    ...(existing?.publicKey ? { publicKey: existing.publicKey } : {}),
    ...(existing?.privateKey ? { privateKey: existing.privateKey } : {}),
    ...(typeof existing?.createdAtMs === "number" ? { createdAtMs: existing.createdAtMs } : {}),
    ...(existing?.tokens ? { tokens: existing.tokens } : {}),
    pendingPairings: {
      ...(existing?.pendingPairings ?? {}),
      [key]: pairing,
    },
  });
  return pairing;
}

function clearPendingPairing(scope: string, role: string): void {
  const store = readDeviceAuthStore();
  if (!store?.pendingPairings) return;
  const key = pairingStoreKey(scope, role);
  if (!store.pendingPairings[key]) return;
  const nextPendingPairings = { ...store.pendingPairings };
  delete nextPendingPairings[key];
  writeDeviceAuthStore({
    version: 1,
    ...(store.deviceId ? { deviceId: store.deviceId } : {}),
    ...(store.publicKey ? { publicKey: store.publicKey } : {}),
    ...(store.privateKey ? { privateKey: store.privateKey } : {}),
    ...(typeof store.createdAtMs === "number" ? { createdAtMs: store.createdAtMs } : {}),
    ...(store.tokens ? { tokens: store.tokens } : {}),
    ...(Object.keys(nextPendingPairings).length > 0 ? { pendingPairings: nextPendingPairings } : {}),
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
  const encoder = globalThis as typeof globalThis & { btoa?: (value: string) => string };
  if (typeof encoder.btoa !== "function") {
    throw new Error("base64 encoder unavailable");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return encoder
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }
  const decoder = globalThis as typeof globalThis & { atob?: (encoded: string) => string };
  if (typeof decoder.atob !== "function") {
    throw new Error("base64 decoder unavailable");
  }
  const binary = decoder.atob(padded);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("crypto.subtle is required for device auth");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentityRecord> {
  const store = readDeviceAuthStore();
  if (
    store?.version === 1 &&
    typeof store.deviceId === "string" &&
    typeof store.publicKey === "string" &&
    typeof store.privateKey === "string"
  ) {
    const derivedId = await sha256Hex(base64UrlToBytes(store.publicKey));
    if (derivedId !== store.deviceId) {
      writeDeviceAuthStore({
        ...store,
        version: 1,
        deviceId: derivedId,
      });
      return {
        deviceId: derivedId,
        publicKey: store.publicKey,
        privateKey: store.privateKey,
        createdAtMs: store.createdAtMs,
      };
    }
    return {
      deviceId: store.deviceId,
      publicKey: store.publicKey,
      privateKey: store.privateKey,
      createdAtMs: store.createdAtMs,
    };
  }

  const privateKeyBytes = edUtils.randomSecretKey();
  const publicKeyBytes = await getPublicKeyAsync(privateKeyBytes);
  const deviceId = await sha256Hex(publicKeyBytes);
  const identity: DeviceIdentityRecord = {
    deviceId,
    publicKey: bytesToBase64Url(publicKeyBytes),
    privateKey: bytesToBase64Url(privateKeyBytes),
    createdAtMs: Date.now(),
  };
  writeDeviceAuthStore({
    version: 1,
    ...identity,
    ...(store?.tokens ? { tokens: store.tokens } : {}),
  });
  return identity;
}

async function signDevicePayload(privateKey: string, payload: string): Promise<string> {
  const signature = await signAsync(new TextEncoder().encode(payload), base64UrlToBytes(privateKey));
  return bytesToBase64Url(signature);
}

function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
}): string {
  return [
    "v2",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
  ].join("|");
}

function toCloseError(error: unknown): GatewayErrorShape | null {
  if (error instanceof GatewayRequestError) {
    return {
      code: error.gatewayCode,
      message: error.message,
      details: error.details,
    };
  }
  if (error instanceof Error) {
    return {
      code: "UNAVAILABLE",
      message: error.message,
    };
  }
  return null;
}

function readConnectErrorCode(error: unknown): string | null {
  if (!(error instanceof GatewayRequestError)) return null;
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const code = (details as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

function readConnectPairingRequestId(error: unknown): string | null {
  if (!(error instanceof GatewayRequestError)) return null;
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const requestId = (details as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.trim() ? requestId.trim() : null;
}

function canRetryWithDeviceToken(error: unknown): boolean {
  if (!(error instanceof GatewayRequestError)) return false;
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return false;
  const record = details as {
    canRetryWithDeviceToken?: unknown;
    recommendedNextStep?: unknown;
  };
  return (
    record.canRetryWithDeviceToken === true ||
    record.recommendedNextStep === "retry_with_device_token"
  );
}

function shouldPauseReconnectAfterAuthFailure(detailCode: string | null, pendingDeviceTokenRetry: boolean): boolean {
  if (!detailCode) return false;
  if (
    detailCode === CONNECT_ERROR_AUTH_RATE_LIMITED ||
    detailCode === CONNECT_ERROR_PAIRING_REQUIRED
  ) {
    return true;
  }
  if (detailCode !== CONNECT_ERROR_AUTH_TOKEN_MISMATCH) {
    return false;
  }
  return !pendingDeviceTokenRetry;
}

type GatewaySocket = WebSocket | NodeWebSocket;

function isSocketOpen(ws: GatewaySocket | null): boolean {
  return Boolean(ws && ws.readyState === 1);
}

function resolveUserAgent(): string | undefined {
  return getNavigatorLike()?.userAgent;
}

function resolveLocale(): string | undefined {
  return getNavigatorLike()?.language;
}

export class GatewayClient {
  private url: string;
  private token?: string;
  private gatewayToken?: string;
  private bootstrapToken?: string;
  private deviceToken?: string;
  private password?: string;
  private approvalRuntimeToken?: string;
  private agentRuntimeIdentityToken?: string;
  private deploymentId?: string;
  private apiKey?: string;
  private apiBase?: string;
  private autoApprovePairing: boolean;
  private clientId: string;
  private clientMode: string;
  private clientDisplayName?: string;
  private clientVersion: string;
  private clientPlatform: string;
  private clientDeviceFamily?: string;
  private clientInstanceId?: string;
  private caps: string[];
  private role: string;
  private scopes: string[];
  private commands?: string[];
  private permissions?: Record<string, boolean>;
  private pathEnv?: string;
  private minProtocol: number;
  private maxProtocol: number;
  private origin?: string;
  private defaultTimeout: number;
  private ws: GatewaySocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventHandlers = new Set<GatewayEventHandler>();
  private connectionStateHandlers = new Set<GatewayConnectionStateHandler>();
  private connected = false;
  private connectionState: GatewayConnectionState = "disconnected";
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private connectNonce: string | null = null;
  private connectSent = false;
  private pendingConnectError: GatewayErrorShape | null = null;
  private pairingState: GatewayPairingState | null = null;
  private autoApproveAttemptedRequestIds = new Set<string>();
  private authTokenMismatchRetried = false;
  private deviceTokenMismatchRetried = false;
  private pendingDeviceTokenRetry = false;
  private lastSeq: number | null = null;
  private connectPromise: Promise<void> | null = null;
  private resolveConnectPromise: (() => void) | null = null;
  private rejectConnectPromise: ((error: unknown) => void) | null = null;
  private _version: string | null = null;
  private _protocol: number | null = null;
  onDisconnect: (() => void) | null = null;

  constructor(options: GatewayOptions) {
    this.url = options.url;
    this.token = normalizeOptionalString(options.token);
    this.gatewayToken = normalizeOptionalString(options.gatewayToken);
    this.bootstrapToken = normalizeOptionalString(options.bootstrapToken);
    this.deviceToken = normalizeOptionalString(options.deviceToken);
    this.password = normalizeOptionalString(options.password);
    this.approvalRuntimeToken = normalizeOptionalString(options.approvalRuntimeToken);
    this.agentRuntimeIdentityToken = normalizeOptionalString(options.agentRuntimeIdentityToken);
    this.deploymentId = normalizeOptionalString(options.deploymentId);
    this.apiKey = normalizeOptionalString(options.apiKey);
    this.apiBase = options.apiBase?.trim().replace(/\/$/, "") || undefined;
    this.autoApprovePairing = options.autoApprovePairing === true;
    this.clientId = normalizeClientId(options.clientId);
    this.clientMode = normalizeClientMode(options.clientMode);
    this.clientVersion = options.clientVersion?.trim() || DEFAULT_CLIENT_VERSION;
    this.clientPlatform = resolvePlatform(options.platform);
    this.clientDeviceFamily = normalizeOptionalString(options.deviceFamily);
    this.clientDisplayName = resolveClientDisplayName(options.clientDisplayName, this.clientPlatform);
    this.clientInstanceId = normalizeOptionalString(options.instanceId) || makeId();
    this.caps = Array.isArray(options.caps)
      ? options.caps.map((cap) => cap.trim()).filter(Boolean)
      : [...DEFAULT_CAPS];
    this.role = options.role?.trim() || OPERATOR_ROLE;
    this.scopes = Array.isArray(options.scopes)
      ? options.scopes.map((scope) => scope.trim()).filter(Boolean)
      : this.role === OPERATOR_ROLE
        ? [...OPERATOR_SCOPES]
        : [];
    this.commands = Array.isArray(options.commands)
      ? options.commands.map((command) => command.trim()).filter(Boolean)
      : undefined;
    this.permissions = normalizePermissions(options.permissions);
    this.pathEnv = normalizeOptionalString(options.pathEnv);
    this.minProtocol = normalizeProtocolVersion(options.minProtocol, MIN_GATEWAY_VERSION);
    this.maxProtocol = normalizeProtocolVersion(options.maxProtocol, MAX_GATEWAY_VERSION);
    // Non-browser SDK clients should not send Origin by default. OpenClaw
    // treats any Origin header as browser-originated and applies browser
    // origin checks to the connection.
    this.origin = typeof options.origin === "string" && options.origin.trim()
      ? options.origin.trim()
      : undefined;
    this.defaultTimeout = options.timeout ?? DEFAULT_CONNECTION_TIMEOUT;
    this.onHello = options.onHello;
    this.onClose = options.onClose;
    this.onGap = options.onGap;
    this.onPairing = options.onPairing;
    this.pairingState = loadPendingPairing(this.storageScope(), this.role);
  }

  private readonly onHello?: (hello: Record<string, any>) => void;
  private readonly onClose?: (info: GatewayCloseInfo) => void;
  private readonly onGap?: (info: { expected: number; received: number }) => void;
  private readonly onPairing?: (pairing: GatewayPairingState | null) => void;

  get version() {
    return this._version;
  }

  get protocol() {
    return this._protocol;
  }

  get isConnected() {
    return this.connected;
  }

  get state() {
    return this.connectionState;
  }

  get pendingPairing() {
    return this.pairingState;
  }

  onConnectionState(handler: GatewayConnectionStateHandler): () => void {
    this.connectionStateHandlers.add(handler);
    return () => this.connectionStateHandlers.delete(handler);
  }

  private setConnectionState(state: GatewayConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const handler of this.connectionStateHandlers) {
      try {
        handler(state);
      } catch {
        // state handlers are isolated from socket lifecycle
      }
    }
  }

  /** Update the gateway token for subsequent connect attempts. */
  setGatewayToken(token: string): void {
    this.gatewayToken = token.trim() || undefined;
  }

  private storageScope(): string {
    return this.deploymentId || this.url;
  }

  /** Subscribe to server-sent events */
  onEvent(handler: GatewayEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /** Connect and keep reconnecting until stopped */
  connect(): Promise<void> {
    return this.start();
  }

  start(): Promise<void> {
    this.closed = false;
    if (this.connected) {
      return Promise.resolve();
    }
    this.setConnectionState("connecting");
    if (!this.connectPromise) {
      this.connectPromise = new Promise<void>((resolve, reject) => {
        this.resolveConnectPromise = resolve;
        this.rejectConnectPromise = reject;
      });
    }
    this.openSocket();
    return this.connectPromise;
  }

  /** Close permanently and stop reconnecting */
  close(): void {
    this.stop();
  }

  stop(): void {
    this.closed = true;
    this.connected = false;
    this.setConnectionState("disconnected");
    this.connectSent = false;
    this.connectNonce = null;
    this.pendingConnectError = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.close();
    }
    this.flushPending(new Error("gateway client stopped"));
    if (this.rejectConnectPromise) {
      this.rejectConnectPromise(new Error("gateway client stopped"));
    }
    this.connectPromise = null;
    this.resolveConnectPromise = null;
    this.rejectConnectPromise = null;
  }

  private updatePairingState(pairing: GatewayPairingState | null): void {
    this.pairingState = pairing;
    if (pairing) {
      storePendingPairing(pairing, this.storageScope());
    } else {
      clearPendingPairing(this.storageScope(), this.role);
    }
    this.onPairing?.(pairing);
  }

  private canAutoApprovePairing(): boolean {
    return Boolean(
      this.autoApprovePairing &&
      this.deploymentId &&
      this.apiKey &&
      this.apiBase &&
      typeof fetch === "function",
    );
  }

  private async approvePairingRequest(requestId: string): Promise<void> {
    if (!this.canAutoApprovePairing()) {
      throw new Error("autoApprovePairing requires deploymentId, apiKey, apiBase, and fetch()");
    }
    const command = `openclaw devices approve ${JSON.stringify(requestId)} --json`;
    const response = await fetch(
      `${this.apiBase}/deployments/${encodeURIComponent(this.deploymentId as string)}/exec`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command,
          timeout: 30,
        }),
      },
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pairing approval failed: ${response.status} ${errorText}`);
    }
    const payload = await response.json() as {
      exitCode?: number;
      exit_code?: number;
      stdout?: string;
      stderr?: string;
    };
    if ((payload.exitCode ?? payload.exit_code ?? 1) !== 0) {
      throw new Error(payload.stderr?.trim() || payload.stdout?.trim() || "pairing approval command failed");
    }
  }

  private openSocket(): void {
    if (this.closed || this.ws) return;
    const useBrowserSocket = "localStorage" in globalThis && typeof WebSocket !== "undefined";
    if (!useBrowserSocket && typeof NodeWebSocket === "undefined") {
      throw new Error("WebSocket is not available in this environment");
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const wsUrl = this.token
      ? `${this.url}${this.url.includes("?") ? "&" : "?"}token=${encodeURIComponent(this.token)}`
      : this.url;
    const ws: GatewaySocket = useBrowserSocket
      ? new WebSocket(wsUrl)
      : new NodeWebSocket(
          wsUrl,
          this.origin ? { headers: { Origin: this.origin } } : undefined,
        );
    this.ws = ws;

    if (useBrowserSocket) {
      ws.onopen = () => {
        this.queueConnect();
      };

      ws.onmessage = (event: { data?: unknown }) => {
        this.handleMessage(String(event.data ?? ""));
      };

      ws.onerror = () => {
        // Close handling covers retries and surfaced errors.
      };

      ws.onclose = (event: { code?: number; reason?: string }) => {
        this.handleClose(ws, event.code ?? 1006, String(event.reason ?? ""));
      };
      return;
    }

    const nodeWs = ws as NodeWebSocket;
    nodeWs.on("open", () => {
      this.queueConnect();
    });
    nodeWs.on("message", (data: NodeWebSocket.RawData) => {
      this.handleMessage(typeof data === "string" ? data : data.toString());
    });
    nodeWs.on("error", () => {
      // Close handling covers retries and surfaced errors.
    });
    nodeWs.on("close", (code: number, reason: Buffer) => {
      this.handleClose(ws, code ?? 1006, reason?.toString() ?? "");
    });
  }

  private queueConnect(): void {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
    }
    this.connectTimer = setTimeout(() => {
      if (!this.ws || !isSocketOpen(this.ws) || this.closed || this.connectSent) {
        return;
      }
      if (!this.connectNonce) {
        this.pendingConnectError = {
          code: "CONNECT_CHALLENGE_TIMEOUT",
          message: "gateway connect challenge timeout",
        };
        this.ws.close(RECONNECT_CLOSE_CODE, "connect challenge timeout");
      }
    }, CONNECT_TIMER_MS);
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) {
      return;
    }
    this.setConnectionState("connecting");
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private flushPending(error: Error): void {
    for (const [, pending] of this.pending) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleClose(ws: GatewaySocket, code: number, reason: string): void {
    if (this.ws !== ws) {
      return;
    }
    this.ws = null;
    this.connected = false;
    this.setConnectionState("disconnected");
    this.connectSent = false;
    this.connectNonce = null;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    const error = this.pendingConnectError;
    this.pendingConnectError = null;
    this.flushPending(new Error(`gateway closed (${code}): ${reason || "no reason"}`));
    this.onClose?.({ code, reason, error });
    if (!this.closed) {
      this.onDisconnect?.();
      const detailCode =
        error && typeof error === "object"
          ? readConnectErrorCode(new GatewayRequestError({
              code: error.code ?? "UNAVAILABLE",
              message: error.message ?? "gateway request failed",
              details: error.details,
            }))
          : null;
      if (!shouldPauseReconnectAfterAuthFailure(detailCode, this.pendingDeviceTokenRetry)) {
        this.scheduleReconnect();
      }
    }
  }

  private async sendConnect(): Promise<void> {
    if (this.connectSent || !this.ws || !isSocketOpen(this.ws)) {
      return;
    }
    const nonce = this.connectNonce?.trim() ?? "";
    if (!nonce) {
      this.pendingConnectError = {
        code: "DEVICE_AUTH_NONCE_REQUIRED",
        message: "gateway connect challenge missing nonce",
      };
      this.ws.close(RECONNECT_CLOSE_CODE, "connect challenge missing nonce");
      return;
    }

    this.connectSent = true;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    let identity: DeviceIdentityRecord | null = null;
    let storedDeviceToken: string | null = null;
    try {
      identity = await loadOrCreateDeviceIdentity();
      storedDeviceToken = loadStoredDeviceToken(
        identity.deviceId,
        this.storageScope(),
        this.role,
      )?.token ?? null;
      const resolvedDeviceToken = this.deviceToken ?? storedDeviceToken ?? undefined;
      const authToken = this.gatewayToken ?? resolvedDeviceToken;
      const authBootstrapToken =
        !this.gatewayToken && !resolvedDeviceToken && !this.password
          ? this.bootstrapToken
          : undefined;
      const authDeviceToken =
        this.deviceToken ?? (this.pendingDeviceTokenRetry ? resolvedDeviceToken : undefined);
      const signatureToken = authToken ?? authBootstrapToken;
      const signedAtMs = Date.now();
      const payload = buildDeviceAuthPayload({
        deviceId: identity.deviceId,
        clientId: this.clientId,
        clientMode: this.clientMode,
        role: this.role,
        scopes: this.scopes,
        signedAtMs,
        token: signatureToken ?? null,
        nonce,
      });
      const signature = await signDevicePayload(identity.privateKey, payload);

      const auth: Record<string, string> = {};
      if (authToken) auth.token = authToken;
      if (authBootstrapToken) auth.bootstrapToken = authBootstrapToken;
      if (authDeviceToken) auth.deviceToken = authDeviceToken;
      if (this.password) auth.password = this.password;
      if (this.approvalRuntimeToken) auth.approvalRuntimeToken = this.approvalRuntimeToken;
      if (this.agentRuntimeIdentityToken) auth.agentRuntimeIdentityToken = this.agentRuntimeIdentityToken;

      const params: Record<string, any> = {
        minProtocol: this.minProtocol,
        maxProtocol: this.maxProtocol,
        client: {
          id: this.clientId,
          ...(this.clientDisplayName ? { displayName: this.clientDisplayName } : {}),
          version: this.clientVersion,
          platform: this.clientPlatform,
          ...(this.clientDeviceFamily ? { deviceFamily: this.clientDeviceFamily } : {}),
          mode: this.clientMode,
          ...(this.clientInstanceId ? { instanceId: this.clientInstanceId } : {}),
        },
        role: this.role,
        scopes: [...this.scopes],
        device: {
          id: identity.deviceId,
          publicKey: identity.publicKey,
          signature,
          signedAt: signedAtMs,
          nonce,
        },
        caps: this.caps,
        ...(this.commands ? { commands: this.commands } : {}),
        ...(this.permissions ? { permissions: this.permissions } : {}),
        ...(this.pathEnv ? { pathEnv: this.pathEnv } : {}),
        ...(Object.keys(auth).length ? { auth } : {}),
        ...(resolveUserAgent() ? { userAgent: resolveUserAgent() } : {}),
        ...(resolveLocale() ? { locale: resolveLocale() } : {}),
      };

      const hello = await this.sendRawRequest<Record<string, any>>(
        "connect",
        params,
        { timeoutMs: this.defaultTimeout },
        true,
      );

      if (hello?.auth?.deviceToken) {
        storeStoredDeviceToken({
          deviceId: identity.deviceId,
          scope: this.storageScope(),
          gatewayUrl: this.url,
          role: hello.auth.role ?? this.role,
          token: hello.auth.deviceToken,
          scopes: hello.auth.scopes ?? [],
        });
      }

      this._version = hello?.server?.version ?? hello?.version ?? null;
      this._protocol = hello?.protocol ?? null;
      this.connected = true;
      this.setConnectionState("connected");
      this.pendingConnectError = null;
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.authTokenMismatchRetried = false;
      this.deviceTokenMismatchRetried = false;
      this.pendingDeviceTokenRetry = false;
      this.updatePairingState(null);

      if (this.resolveConnectPromise) {
        this.resolveConnectPromise();
      }
      this.connectPromise = null;
      this.resolveConnectPromise = null;
      this.rejectConnectPromise = null;

      this.onHello?.(hello);
    } catch (error) {
      this.pendingConnectError = toCloseError(error);
      const detailCode = readConnectErrorCode(error);
      const requestId = readConnectPairingRequestId(error);

      // Stale device token after agent restart — clear it and retry on the
      // same socket instead of forcing a full reconnect cycle. Guard with a
      // one-shot flag to prevent infinite recursion if the retry also fails.
      if (identity && detailCode === CONNECT_ERROR_DEVICE_TOKEN_MISMATCH && !this.deviceTokenMismatchRetried) {
        this.deviceTokenMismatchRetried = true;
        clearStoredDeviceToken(identity.deviceId, this.storageScope(), this.role);
        this.connectSent = false;
        this.pendingConnectError = null;
        this.pendingDeviceTokenRetry = false;
        await this.sendConnect();
        return;
      }

      if (
        identity &&
        detailCode === CONNECT_ERROR_AUTH_TOKEN_MISMATCH &&
        !this.authTokenMismatchRetried &&
        storedDeviceToken &&
        this.gatewayToken &&
        canRetryWithDeviceToken(error)
      ) {
        this.authTokenMismatchRetried = true;
        this.pendingDeviceTokenRetry = true;
        this.connectSent = false;
        this.pendingConnectError = null;
        await this.sendConnect();
        return;
      }

      if (identity && detailCode === CONNECT_ERROR_PAIRING_REQUIRED) {
        clearStoredDeviceToken(identity.deviceId, this.storageScope(), this.role);
      }
      if (detailCode === CONNECT_ERROR_PAIRING_REQUIRED && requestId) {
        if (this.canAutoApprovePairing() && !this.autoApproveAttemptedRequestIds.has(requestId)) {
          // Auto-approve silently — don't emit intermediate pairing states
          // that would cause UI flicker in the dashboard.
          this.autoApproveAttemptedRequestIds.add(requestId);
          try {
            await this.approvePairingRequest(requestId);
            this.pendingConnectError = {
              code: "PAIRING_APPROVED",
              message: "Pairing approved, reconnecting",
            };
            this.connectSent = false;
            if (!this.ws || !isSocketOpen(this.ws)) {
              this.openSocket();
              return;
            }
            this.ws.close(RECONNECT_CLOSE_CODE, "pairing approved");
            return;
          } catch (approvalError) {
            this.pendingConnectError = toCloseError(approvalError);
            this.updatePairingState({
              requestId,
              role: this.role,
              gatewayUrl: this.url,
              ...(identity ? { deviceId: identity.deviceId } : {}),
              status: "failed",
              updatedAtMs: Date.now(),
              error: approvalError instanceof Error ? approvalError.message : String(approvalError),
            });
          }
        } else {
          // No auto-approve — surface pairing state so the UI can prompt.
          this.updatePairingState({
            requestId,
            role: this.role,
            gatewayUrl: this.url,
            ...(identity ? { deviceId: identity.deviceId } : {}),
            status: "pending",
            updatedAtMs: Date.now(),
          });
        }
      }
      if (this.ws) {
        this.ws.close(RECONNECT_CLOSE_CODE, "connect failed");
      }
    }
  }

  private handleMessage(raw: string): void {
    let message: Record<string, any>;
    try {
      message = JSON.parse(raw) as Record<string, any>;
    } catch {
      return;
    }

    if (message.type === "event") {
      const gatewayEvent = message as GatewayEvent;
      if (gatewayEvent.event === "connect.challenge") {
        const nonce =
          gatewayEvent.payload && typeof gatewayEvent.payload.nonce === "string"
            ? gatewayEvent.payload.nonce.trim()
            : "";
        if (!nonce) {
          this.pendingConnectError = {
            code: "DEVICE_AUTH_NONCE_REQUIRED",
            message: "gateway connect challenge missing nonce",
          };
          this.ws?.close(RECONNECT_CLOSE_CODE, "connect challenge missing nonce");
          return;
        }
        this.connectNonce = nonce;
        void this.sendConnect();
        return;
      }

      if (typeof gatewayEvent.seq === "number") {
        if (this.lastSeq !== null && gatewayEvent.seq > this.lastSeq + 1) {
          this.onGap?.({ expected: this.lastSeq + 1, received: gatewayEvent.seq });
        }
        this.lastSeq = gatewayEvent.seq;
      }

      for (const handler of this.eventHandlers) {
        try {
          handler(gatewayEvent);
        } catch {
          // Event handlers are isolated from the socket lifecycle.
        }
      }
      return;
    }

    if (message.type !== "res") {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    const payload = message.payload as { status?: unknown } | undefined;
    if (pending.expectFinal && payload?.status === "accepted") {
      if (!pending.acceptedNotified) {
        pending.acceptedNotified = true;
        try {
          pending.onAccepted?.(message.payload);
        } catch {
          // Accepted callbacks are observational and must not break the request.
        }
      }
      return;
    }
    this.pending.delete(message.id);
    pending.cleanup();

    if (message.ok) {
      pending.resolve(message.payload);
      return;
    }

    pending.reject(
      new GatewayRequestError({
        code: message.error?.code ?? "UNAVAILABLE",
        message: message.error?.message ?? "gateway request failed",
        details: message.error?.details,
      }),
    );
  }

  private sendRawRequest<T>(
    method: string,
    params: Record<string, any> = {},
    options: GatewayClientRequestOptions = {},
    allowBeforeHello = false,
  ): Promise<T> {
    if (!this.ws || !isSocketOpen(this.ws)) {
      return Promise.reject(new Error("gateway not connected"));
    }
    if (!allowBeforeHello && !this.connected) {
      return Promise.reject(new Error("gateway not connected"));
    }
    if (options.signal?.aborted) {
      return Promise.reject(createGatewayRequestAbortError(method));
    }

    const id = makeId();
    const request = { type: "req", id, method, params };
    const expectFinal = options.expectFinal === true;
    const timeout =
      options.timeoutMs === null
        ? null
        : typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
          ? Math.max(0, options.timeoutMs)
          : expectFinal
            ? null
            : this.defaultTimeout;
    const promise = new Promise<T>((resolve, reject) => {
      const timer =
        timeout === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`RPC timeout: ${method}`));
            }, timeout);
      const abortHandler = () => {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        pending?.cleanup();
        reject(createGatewayRequestAbortError(method));
      };
      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
        }
        options.signal?.removeEventListener("abort", abortHandler);
      };

      this.pending.set(id, {
        resolve,
        reject,
        expectFinal,
        timer,
        cleanup,
        onAccepted: options.onAccepted,
      });
      options.signal?.addEventListener("abort", abortHandler, { once: true });
    });
    try {
      this.ws?.send(JSON.stringify(request));
    } catch (error) {
      const pending = this.pending.get(id);
      this.pending.delete(id);
      pending?.cleanup();
      throw error;
    }
    return promise;
  }

  // ---------------------------------------------------------------------------
  // RPC
  // ---------------------------------------------------------------------------

  private rpc(
    method: string,
    params: Record<string, any> = {},
    timeout?: number | null,
  ): Promise<any> {
    return this.sendRawRequest(method, params, {
      timeoutMs: timeout === undefined ? this.defaultTimeout : timeout,
    });
  }

  request<T = any>(
    method: string,
    params: Record<string, any> = {},
    options?: number | null | GatewayClientRequestOptions,
  ): Promise<T> {
    return this.sendRawRequest(
      method,
      params,
      typeof options === "object" && options !== null ? options : { timeoutMs: options },
    );
  }

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  async configGet(): Promise<Record<string, any>> {
    const res = await this.rpc("config.get");
    if (res?.parsed) return res.parsed;
    if (res?.raw) {
      try {
        return JSON.parse(res.raw);
      } catch {
        // Fall through to the raw payload.
      }
    }
    return res?.config ?? res ?? {};
  }

  async configSchema(): Promise<OpenClawConfigSchemaResponse> {
    const res = await this.rpc("config.schema");
    return normalizeOpenClawConfigSchema(res) ?? { schema: {}, uiHints: {} };
  }

  async configPatch(patch: Record<string, any>): Promise<void> {
    const { hash, baseHash } = await this.rpc("config.get") as { hash?: string; baseHash?: string };
    await this.rpc("config.patch", {
      raw: JSON.stringify(patch),
      baseHash: hash ?? baseHash ?? "",
    });
  }

  async configApply(config: Record<string, any>): Promise<void> {
    const { hash, baseHash } = await this.rpc("config.get") as { hash?: string; baseHash?: string };
    await this.rpc("config.apply", {
      raw: JSON.stringify(config),
      baseHash: hash ?? baseHash ?? "",
    });
  }

  async configSet(config: Record<string, any>): Promise<void> {
    const { hash, baseHash } = await this.rpc("config.get") as { hash?: string; baseHash?: string };
    await this.rpc("config.set", {
      raw: JSON.stringify(config),
      baseHash: hash ?? baseHash ?? "",
    });
  }

  async modelsList(): Promise<any[]> {
    const res = await this.rpc("models.list");
    return res?.models ?? res ?? [];
  }

  // ---------------------------------------------------------------------------
  // Skills
  // ---------------------------------------------------------------------------

  async skillsStatus(params: GatewaySkillsStatusParams = {}): Promise<GatewaySkillsStatusReport> {
    return await this.rpc("skills.status", params);
  }

  async skillsSearch(params: GatewaySkillsSearchParams = {}): Promise<GatewaySkillsSearchResult> {
    return await this.rpc("skills.search", params);
  }

  async skillsDetail(params: GatewaySkillsDetailParams): Promise<GatewaySkillsDetailResult> {
    return await this.rpc("skills.detail", params);
  }

  async skillsSecurityVerdicts(
    params: GatewaySkillsSecurityVerdictsParams = {},
  ): Promise<GatewaySkillsSecurityVerdictsResult> {
    return await this.rpc("skills.securityVerdicts", params);
  }

  async skillsSkillCard(params: GatewaySkillsSkillCardParams): Promise<GatewaySkillsSkillCardResult> {
    return await this.rpc("skills.skillCard", params);
  }

  async skillsInstall(params: GatewaySkillsInstallParams): Promise<GatewaySkillsInstallResult> {
    const timeoutMs = Math.max(params.timeoutMs ?? SKILLS_MUTATION_TIMEOUT, this.defaultTimeout);
    return await this.rpc("skills.install", params, timeoutMs);
  }

  async skillsUpdate(params: GatewaySkillsUpdateParams): Promise<GatewaySkillsUpdateResult> {
    const isClawHubUpdate = "source" in params && params.source === "clawhub";
    return await this.rpc(
      "skills.update",
      params,
      isClawHubUpdate ? SKILLS_MUTATION_TIMEOUT : undefined,
    );
  }

  async integrationsAuthStart(
    params: GatewayIntegrationAuthStartParams,
  ): Promise<GatewayIntegrationAuthStartResult> {
    return await this.rpc("integrations.auth.start", params, 30_000);
  }

  async integrationsAuthStatus(
    params: GatewayIntegrationAuthStatusParams,
  ): Promise<GatewayIntegrationAuthStatusResult> {
    return await this.rpc("integrations.auth.status", params);
  }

  async integrationsStatus(
    params: GatewayIntegrationStatusParams = {},
  ): Promise<GatewayIntegrationStatusResult> {
    return await this.rpc("integrations.status", params);
  }

  async integrationsDisconnect(
    params: GatewayIntegrationDisconnectParams,
  ): Promise<GatewayIntegrationDisconnectResult> {
    return await this.rpc("integrations.disconnect", params);
  }

  async waitReady(
    timeoutMs = 300_000,
    options: GatewayWaitReadyOptions = {},
  ): Promise<Record<string, any>> {
    const retryIntervalMs = options.retryIntervalMs ?? 5_000;
    const probe = options.probe ?? "config";
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;

    while (!this.closed) {
      try {
        if (!this.connected) {
          await this.connect();
        }
        if (probe === "status") {
          return await this.status();
        }
        return await this.configGet();
      } catch (error) {
        lastError = error;
        this.close();
        if (Date.now() >= deadline) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
      }
    }

    const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
    throw new Error(`Gateway readiness probe timed out after ${timeoutMs}ms${detail}`);
  }

  async channelsStatus(probe = false, timeoutMs?: number, channel?: string): Promise<ChannelsStatusResult> {
    const params: ChannelsStatusParams = { probe };
    if (timeoutMs !== undefined) params.timeoutMs = timeoutMs;
    if (channel !== undefined) params.channel = channel;
    return await this.rpc("channels.status", params);
  }

  async channelsLogout(channel: string, accountId?: string): Promise<Record<string, any>> {
    const params: Record<string, any> = { channel };
    if (accountId) params.accountId = accountId;
    return await this.rpc("channels.logout", params);
  }

  async webLoginStart(options: {
    force?: boolean;
    timeoutMs?: number;
    verbose?: boolean;
    accountId?: string;
  } = {}): Promise<Record<string, any>> {
    const params: Record<string, any> = {};
    if (options.force) params.force = true;
    if (options.timeoutMs !== undefined) params.timeoutMs = options.timeoutMs;
    if (options.verbose) params.verbose = true;
    if (options.accountId) params.accountId = options.accountId;
    return await this.rpc("web.login.start", params, 30_000);
  }

  async webLoginWait(options: {
    timeoutMs?: number;
    accountId?: string;
  } = {}): Promise<Record<string, any>> {
    const params: Record<string, any> = {};
    if (options.timeoutMs !== undefined) params.timeoutMs = options.timeoutMs;
    if (options.accountId) params.accountId = options.accountId;
    return await this.rpc("web.login.wait", params, WEB_LOGIN_WAIT_TIMEOUT);
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  async sessionsList(): Promise<any[]> {
    const res = await this.rpc("sessions.list");
    return res?.sessions ?? res ?? [];
  }

  async sessionsPreview(sessionKey: string, limit = 20): Promise<any[]> {
    const res = await this.rpc("sessions.preview", { keys: [sessionKey], limit });
    return res?.previews?.[0]?.items ?? [];
  }

  async sessionsPatch(patch: GatewaySessionPatch): Promise<Record<string, any>> {
    return await this.rpc("sessions.patch", patch);
  }

  async chatHistory(sessionKey?: string, limit = 50): Promise<any[]> {
    const params: Record<string, any> = { limit };
    if (sessionKey) params.sessionKey = sessionKey;
    const res = await this.rpc("chat.history", params);
    return res?.messages ?? res ?? [];
  }

  async chatAbort(sessionKey?: string): Promise<void> {
    const params: Record<string, any> = {};
    if (sessionKey) params.sessionKey = sessionKey;
    await this.rpc("chat.abort", params);
  }

  async sendChat(
    message: string,
    sessionKey = "main",
    agentId?: string,
    attachments?: ChatAttachment[],
  ): Promise<any> {
    const normalizedAttachments = normalizeChatAttachments(attachments);
    const params: Record<string, any> = {
      message,
      deliver: false,
      sessionKey,
      idempotencyKey: makeId(),
    };
    if (agentId) params.agentId = agentId;
    if (normalizedAttachments) params.attachments = normalizedAttachments;
    return this.rpc("chat.send", params, DEFAULT_AGENT_TIMEOUT);
  }

  async sessionsReset(sessionKey: string, reason?: "new" | "reset"): Promise<string> {
    const params: Record<string, any> = { key: sessionKey };
    if (reason) params.reason = reason;
    const result = await this.rpc("sessions.reset", params);
    const canonicalKey = result?.key ?? result?.sessionKey ?? result?.session?.key;
    return typeof canonicalKey === "string" && canonicalKey.trim() ? canonicalKey.trim() : sessionKey;
  }

  // ---------------------------------------------------------------------------
  // Nodes (operator-side: manage & drive paired nodes)
  //
  // A "node" is a device/machine connected to the same gateway with
  // `role: "node"` that exposes a command surface. An operator lists/approves
  // node pairings and drives them with `node.invoke`; the node executes the
  // command locally and returns the result. This is the gateway's built-in
  // "agent asks a connected machine to do X and use the result" path.
  // ---------------------------------------------------------------------------

  /** Paired nodes known to the gateway. */
  async nodesList(): Promise<any[]> {
    const res = await this.rpc("node.list");
    return res?.nodes ?? res ?? [];
  }

  /** Detailed metadata for one paired node (caps + supported invoke commands). */
  async nodeDescribe(nodeId: string): Promise<any> {
    return await this.rpc("node.describe", { nodeId });
  }

  /** Pending and paired node-pairing requests. */
  async nodePairList(): Promise<{ pending: any[]; paired: any[] }> {
    const res = await this.rpc("node.pair.list");
    return { pending: res?.pending ?? [], paired: res?.paired ?? [] };
  }

  /**
   * Approve a pending node pairing (and its declared command surface). This is
   * the sibling of `device.pair.approve`; it requires `operator.pairing` and,
   * for command-bearing nodes, `operator.write`/`operator.admin`.
   */
  async nodePairApprove(requestId: string): Promise<any> {
    return await this.rpc("node.pair.approve", { requestId });
  }

  /** Reject a pending node pairing request. */
  async nodePairReject(requestId: string): Promise<void> {
    await this.rpc("node.pair.reject", { requestId });
  }

  /** Remove an already-paired node from the gateway trust set. */
  async nodePairRemove(nodeId: string): Promise<void> {
    await this.rpc("node.pair.remove", { nodeId });
  }

  /** Rename a paired node while preserving its stable node id. */
  async nodeRename(nodeId: string, displayName: string): Promise<void> {
    await this.rpc("node.rename", { nodeId, displayName });
  }

  /**
   * Invoke a command on a paired node and return its result. The node must be
   * connected, have declared `command`, and the command must be allowed by the
   * gateway policy (declared + approved surface, and/or
   * `gateway.nodes.allowCommands`).
   */
  async nodeInvoke(
    nodeId: string,
    command: string,
    params: Record<string, any> = {},
    timeoutMs?: number,
  ): Promise<any> {
    const rpcParams: Record<string, any> = {
      nodeId,
      command,
      params,
      idempotencyKey: makeId(),
    };
    if (timeoutMs !== undefined) rpcParams.timeoutMs = timeoutMs;
    return await this.rpc("node.invoke", rpcParams, timeoutMs);
  }

  // ---------------------------------------------------------------------------
  // Chat (streaming via events)
  // ---------------------------------------------------------------------------

  async *chatSend(
    message: string,
    sessionKey: string,
    attachments?: ChatAttachment[],
  ): AsyncGenerator<ChatEvent> {
    if (!this.connected || !this.ws) {
      throw new Error("Not connected");
    }

    const idempotencyKey = makeId();
    const acceptedRunIds = new Set<string>([idempotencyKey]);
    const queuedEvents: GatewayEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let streamedDisplayText = false;
    let lastLegacyText = "";
    let lastThinkingText = "";
    const seenToolCallIds = new Set<string>();
    const seenToolResultIds = new Set<string>();

    const handler: GatewayEventHandler = (evt) => {
      const isAgentStreamEvent =
        evt.event === "agent" &&
        (() => {
          const payload = asRecord(evt.payload) ?? {};
          const stream = typeof payload.stream === "string" ? payload.stream.toLowerCase() : "";
          return stream === "tool" || stream === "lifecycle";
        })();
      if (evt.event === "chat" || evt.event?.startsWith("chat.") || isAgentStreamEvent) {
        queuedEvents.push(evt);
        const waiter = resolveWait;
        resolveWait = null;
        waiter?.();
      }
    };

    this.eventHandlers.add(handler);

    try {
      const normalizedAttachments = normalizeChatAttachments(attachments);
      const params: Record<string, any> = {
        message,
        deliver: false,
        sessionKey,
        idempotencyKey,
      };
      if (normalizedAttachments) params.attachments = normalizedAttachments;

      const ack = await this.rpc("chat.send", params, DEFAULT_AGENT_TIMEOUT);
      const serverRunId = typeof ack?.runId === "string" ? ack.runId.trim() : "";
      if (serverRunId) {
        acceptedRunIds.add(serverRunId);
      }

      const waitForHistoryText = async (timeoutMs = 10_000): Promise<string> => {
        const historyDeadline = Date.now() + Math.min(timeoutMs, DEFAULT_AGENT_TIMEOUT);
        while (true) {
          const historyText = latestHistoryAssistantText(
            await this.chatHistory(sessionKey, 20),
            acceptedRunIds,
          );
          if (historyText) return historyText;
          if (Date.now() >= historyDeadline) return "";
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      };

      let deadline = Date.now() + DEFAULT_AGENT_TIMEOUT;
      while (Date.now() < deadline) {
        if (queuedEvents.length === 0) {
          const remainingMs = Math.max(100, Math.min(1000, deadline - Date.now()));
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              if (resolveWait === release) {
                resolveWait = null;
              }
              resolve();
            }, remainingMs);
            const release = () => {
              clearTimeout(timer);
              resolve();
            };
            resolveWait = release;
          });
          continue;
        }

        const evt = queuedEvents.shift()!;
        const payload = asRecord(evt.payload) ?? {};
        const payloadRunId = typeof payload.runId === "string" ? payload.runId.trim() : "";
        const payloadSessionKey =
          typeof payload.sessionKey === "string" ? payload.sessionKey.trim() : "";
        if (payloadRunId && !acceptedRunIds.has(payloadRunId)) {
          continue;
        }
        if (payloadSessionKey && !sameSessionKey(payloadSessionKey, sessionKey)) {
          continue;
        }

        deadline = Date.now() + DEFAULT_AGENT_TIMEOUT;

        if (evt.event === "chat.content") {
          const text = typeof payload.text === "string" ? payload.text : "";
          if (text) {
            streamedDisplayText = true;
            yield { type: "content", text };
          }
          continue;
        }
        if (evt.event === "agent" && String(payload.stream || "").toLowerCase() === "tool") {
          const toolPayload = asRecord(payload.data) ?? {};
          const phase = typeof toolPayload.phase === "string" ? toolPayload.phase.toLowerCase() : "";
          const toolCallId =
            gatewayToolCallId(toolPayload) ??
            `${gatewayToolName(toolPayload) ?? "tool"}:${JSON.stringify(toolPayload.args ?? null)}`;
          if (phase === "start") {
            seenToolCallIds.add(toolCallId);
            yield {
              type: "tool_call",
              data: {
                ...gatewayToolStreamPayload(toolPayload),
                args: toolPayload.args,
              },
            };
          } else if (phase === "result") {
            seenToolResultIds.add(toolCallId);
            yield {
              type: "tool_result",
              data: {
                ...gatewayToolStreamPayload(toolPayload),
                result: toolPayload.result ?? toolPayload.meta ?? toolPayload.content ?? toolPayload.text ?? toolPayload.partialResult,
                isError: toolPayload.isError,
              },
            };
          }
          continue;
        }
        if (evt.event === "agent" && String(payload.stream || "").toLowerCase() === "lifecycle") {
          const lifecyclePayload = asRecord(payload.data) ?? {};
          const phase =
            typeof lifecyclePayload.phase === "string" ? lifecyclePayload.phase.toLowerCase() : "";
          if (phase === "end") {
            const hasNonTextActivity =
              Boolean(lastThinkingText) || seenToolCallIds.size > 0 || seenToolResultIds.size > 0;
            const historyText =
              hasNonTextActivity
                ? ""
                : streamedDisplayText || lastLegacyText
                ? latestHistoryAssistantText(await this.chatHistory(sessionKey, 20), acceptedRunIds)
                : await waitForHistoryText();
            if (historyText) {
              const streamed = streamDelta(lastLegacyText, historyText);
              lastLegacyText = streamed.nextText;
              if (streamed.delta) {
                streamedDisplayText = true;
                yield { type: "content", text: streamed.delta, data: payload };
              }
            }
            yield { type: "done", data: payload };
            return;
          }
          if (phase === "error") {
            yield {
              type: "error",
              text:
                typeof lifecyclePayload.error === "string" && lifecyclePayload.error
                  ? lifecyclePayload.error
                  : typeof payload.errorMessage === "string" && payload.errorMessage
                    ? payload.errorMessage
                    : phase,
              data: payload,
            };
            return;
          }
          continue;
        }
        if (evt.event === "chat.thinking") {
          const text = typeof payload.text === "string" ? payload.text : "";
          if (text) {
            lastThinkingText += text;
          }
          yield { type: "thinking", text };
          continue;
        }
        if (evt.event === "chat.tool_call") {
          const toolCallId =
            gatewayToolCallId(payload) ??
            `${gatewayToolName(payload) ?? "tool"}:${JSON.stringify(payload.args ?? payload.arguments ?? null)}`;
          seenToolCallIds.add(toolCallId);
          yield { type: "tool_call", data: payload };
          continue;
        }
        if (evt.event === "chat.tool_result") {
          const toolCallId =
            gatewayToolCallId(payload) ??
            `${gatewayToolName(payload) ?? "tool"}:${JSON.stringify(payload.args ?? payload.arguments ?? null)}`;
          seenToolResultIds.add(toolCallId);
          yield { type: "tool_result", data: payload };
          continue;
        }
        if (evt.event === "chat.done") {
          const hasNonTextActivity =
            Boolean(lastThinkingText) || seenToolCallIds.size > 0 || seenToolResultIds.size > 0;
          if (!streamedDisplayText && !lastLegacyText && !hasNonTextActivity) {
            const historyText = await waitForHistoryText();
            if (historyText) {
              yield { type: "content", text: historyText, data: payload };
            }
          }
          yield { type: "done", data: payload };
          return;
        }
        if (evt.event === "chat.error") {
          yield {
            type: "error",
            text: typeof payload.message === "string" ? payload.message : "Unknown error",
            data: payload,
          };
          return;
        }
        if (evt.event !== "chat") {
          continue;
        }

        const state = typeof payload.state === "string" ? payload.state.trim().toLowerCase() : "";
        const currentText = extractMessageText(payload.message) ?? "";
        const currentDeltaText = typeof payload.deltaText === "string" ? payload.deltaText : "";
        const normalizedMessage = normalizeGatewayChatMessage(payload.message);
        if (state === "delta") {
          const streamed = currentText
            ? streamDelta(lastLegacyText, currentText)
            : {
                delta: currentDeltaText,
                nextText: currentDeltaText
                  ? payload.replace === true
                    ? currentDeltaText
                    : lastLegacyText + currentDeltaText
                  : lastLegacyText,
              };
          lastLegacyText = streamed.nextText;
          if (streamed.delta) {
            streamedDisplayText = true;
            yield { type: "content", text: streamed.delta, data: payload };
          }
          continue;
        }
        if (state === "final") {
          const thinkingDelta = normalizedMessage?.thinking
            ? streamDelta(lastThinkingText, normalizedMessage.thinking)
            : { delta: "", nextText: lastThinkingText };
          lastThinkingText = thinkingDelta.nextText;
          if (thinkingDelta.delta) {
            yield { type: "thinking", text: thinkingDelta.delta, data: payload };
          }

          for (const toolCall of normalizedMessage?.toolCalls ?? []) {
            const toolCallKey =
              toolCall.id?.trim() ||
              `${toolCall.name}:${JSON.stringify(toolCall.args ?? null)}`;
            if (toolCall.args !== undefined && !seenToolCallIds.has(toolCallKey)) {
              seenToolCallIds.add(toolCallKey);
              yield {
                type: "tool_call",
                data: {
                  ...(toolCall.id ? { toolCallId: toolCall.id } : {}),
                  name: toolCall.name,
                  args: toolCall.args,
                },
              };
            }
            if (toolCall.result !== undefined && !seenToolResultIds.has(toolCallKey)) {
              seenToolResultIds.add(toolCallKey);
              yield {
                type: "tool_result",
                data: {
                  ...(toolCall.id ? { toolCallId: toolCall.id } : {}),
                  name: toolCall.name,
                  result: toolCall.result,
                },
              };
            }
          }

          if (currentText) {
            const streamed = streamDelta(lastLegacyText, currentText);
            lastLegacyText = streamed.nextText;
            if (streamed.delta) {
              streamedDisplayText = true;
              yield { type: "content", text: streamed.delta, data: payload };
            }
            yield { type: "done", data: payload };
            return;
          }
          if (streamedDisplayText || lastLegacyText) {
            yield { type: "done", data: payload };
            return;
          }
          if (normalizedMessage?.thinking || (normalizedMessage?.toolCalls.length ?? 0) > 0) {
            yield { type: "done", data: payload };
            return;
          }
          const historyText = await waitForHistoryText();
          if (historyText) {
            yield { type: "content", text: historyText, data: payload };
          }
          yield { type: "done", data: payload };
          return;
        }
        if (state === "error" || state === "aborted") {
          if (currentText) {
            const streamed = streamDelta(lastLegacyText, currentText);
            lastLegacyText = streamed.nextText;
            if (streamed.delta) {
              streamedDisplayText = true;
              yield { type: "content", text: streamed.delta, data: payload };
            }
          }
          yield {
            type: "error",
            text: typeof payload.errorMessage === "string" ? payload.errorMessage : state,
            data: payload,
          };
          return;
        }
      }

      throw new Error("Streaming chat.send timed out");
    } finally {
      this.eventHandlers.delete(handler);
    }
  }

  async runEphemeralChat(
    message: string,
    options: GatewayEphemeralChatOptions = {},
  ): Promise<string> {
    const prompt = message.trim();
    if (!prompt) throw new Error("Ephemeral chat requires a message.");
    if (!this.connected || !this.ws) throw new Error("Not connected");

    const timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT;
    const maxResponseChars = options.maxResponseChars ?? 128 * 1024;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_AGENT_TIMEOUT) {
      throw new Error(`Ephemeral chat timeout must be between 1 and ${DEFAULT_AGENT_TIMEOUT} milliseconds.`);
    }
    if (!Number.isSafeInteger(maxResponseChars) || maxResponseChars <= 0) {
      throw new Error("Ephemeral chat response limit must be a positive integer.");
    }

    const requestedSessionKey = `session-${makeId()}`;
    let sessionKey = requestedSessionKey;
    let created = false;
    let terminal = false;
    let stream: AsyncGenerator<ChatEvent> | null = null;
    let stopError: Error | null = null;
    let abortPromise: Promise<void> | null = null;
    let resolveStop: ((error: Error) => void) | null = null;
    const stopped = new Promise<Error>((resolve) => {
      resolveStop = resolve;
    });
    const requestAbort = (error: Error) => {
      if (!stopError) {
        stopError = error;
        resolveStop?.(error);
      }
      if (created && !terminal && !abortPromise) {
        abortPromise = this.chatAbort(sessionKey).catch(() => undefined);
      }
      void stream?.return(undefined).catch(() => undefined);
    };
    const dispatchEvent = async (event: ChatEvent) => {
      if (!options.onEvent) return;
      await Promise.race([
        Promise.resolve().then(() => options.onEvent?.(event)),
        stopped.then((error) => Promise.reject(error)),
      ]);
    };
    const abortError = () => {
      const error = new Error("Ephemeral chat was cancelled.");
      error.name = "AbortError";
      return error;
    };
    const handleSignalAbort = () => requestAbort(abortError());
    const timeout = setTimeout(() => requestAbort(new Error("Ephemeral chat timed out.")), timeoutMs);
    options.signal?.addEventListener("abort", handleSignalAbort, { once: true });

    try {
      if (options.signal?.aborted) throw abortError();
      sessionKey = await this.sessionsReset(requestedSessionKey, "new");
      created = true;
      if (options.signal?.aborted) throw abortError();
      if (stopError) throw stopError;

      if (options.fastMode) {
        let fastModeTerminal = false;
        stream = this.chatSend("/fast on", sessionKey);
        while (true) {
          const next = await Promise.race([
            stream.next(),
            stopped.then((error) => Promise.reject(error)),
          ]);
          if (next.done) break;
          const event = next.value;
          if (event.type === "error") {
            fastModeTerminal = true;
            break;
          }
          if (event.type === "done") {
            fastModeTerminal = true;
            break;
          }
        }
        stream = null;
        if (stopError) throw stopError;
        if (!fastModeTerminal) throw new Error("Ephemeral fast mode ended without completing.");
      }

      let content = "";
      stream = this.chatSend(prompt, sessionKey);
      while (true) {
        const next = await Promise.race([
          stream.next(),
          stopped.then((error) => Promise.reject(error)),
        ]);
        if (next.done) break;
        const event = next.value;
        if (stopError) throw stopError;
        if (event.type === "content") {
          content += event.text ?? "";
          if (content.length > maxResponseChars) {
            const error = new Error("Ephemeral chat response exceeds the configured limit.");
            requestAbort(error);
            throw error;
          }
        }
        await dispatchEvent(event);
        if (event.type === "error") {
          terminal = true;
          throw new Error(event.text || "Ephemeral chat failed.");
        } else if (event.type === "done") {
          terminal = true;
        }
      }
      if (stopError) throw stopError;
      if (!terminal) throw new Error("Ephemeral chat ended without completing.");
      if (!content.trim()) throw new Error("Ephemeral chat returned an empty response.");
      return content;
    } catch (error) {
      if (created && !terminal) requestAbort(error instanceof Error ? error : new Error("Ephemeral chat failed."));
      await abortPromise;
      throw stopError ?? error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", handleSignalAbort);
      void stream?.return(undefined).catch(() => undefined);
      if (created) await this.sessionsReset(sessionKey, "reset").catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Files (agent workspace files)
  // ---------------------------------------------------------------------------

  async filesList(agentId: string = "main"): Promise<any[]> {
    const res = await this.rpc("agents.files.list", { agentId });
    return res?.files ?? [];
  }

  async fileGet(agentId: string, name: string): Promise<string> {
    const res = await this.rpc("agents.files.get", { agentId, name });
    return res?.content ?? "";
  }

  async fileSet(agentId: string, name: string, content: string): Promise<void> {
    await this.rpc("agents.files.set", { agentId, name, content });
  }

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------

  async agentsList(): Promise<any[]> {
    const res = await this.rpc("agents.list");
    const agents = res?.agents ?? res ?? [];
    return Array.isArray(agents)
      ? agents.map((agent: any) => ({ ...agent, id: agent?.agentId ?? agent?.id }))
      : [];
  }

  async agentGet(agentId = "main"): Promise<any> {
    const res = await this.rpc("agents.get", { agentId });
    return res?.agent ?? res ?? {};
  }

  // ---------------------------------------------------------------------------
  // Cron
  // ---------------------------------------------------------------------------

  async cronList(): Promise<any[]> {
    const res = await this.rpc("cron.list");
    return res?.jobs ?? res ?? [];
  }

  async cronAdd(job: Record<string, any>): Promise<any> {
    return this.rpc("cron.add", job);
  }

  async cronRemove(jobId: string): Promise<void> {
    await this.rpc("cron.remove", { jobId });
  }

  async cronRun(jobId: string): Promise<any> {
    return this.rpc("cron.run", { jobId });
  }

  async execApprove(execId: string): Promise<void> {
    await this.rpc("exec.approve", { execId });
  }

  async execDeny(execId: string): Promise<void> {
    await this.rpc("exec.deny", { execId });
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  async status(): Promise<Record<string, any>> {
    return this.rpc("status");
  }
}

function createGatewayRequestAbortError(method: string): Error {
  const err = new Error(`gateway request aborted for ${method}`);
  err.name = "AbortError";
  return err;
}

// -----------------------------------------------------------------------------
// Node receiver (node-side: be a node the agent drives)
//
// The operator methods above (nodesList/nodeInvoke/...) drive paired nodes.
// NodeServer is the other half: it connects to the gateway with role "node",
// declares a command surface, then answers `node.invoke.request` events by
// dispatching to local handlers and replying with the `node.invoke.result` RPC.
// The gateway correlates request and result by the request `id`.
// -----------------------------------------------------------------------------

/** Handler for one node command. Receives decoded params, returns a JSON-serializable payload. */
export type NodeCommandHandler = (params: any) => Promise<any> | any;

export interface NodeServerOptions
  extends Omit<GatewayOptions, "role" | "scopes" | "commands" | "clientMode"> {
  /** Stable node id advertised to operators (defaults to the client instance id). */
  nodeId?: string;
}

interface NodeInvokeRequest {
  id: string;
  nodeId: string;
  command: string;
  paramsJSON: string | null;
}

type NodeInvokeResult =
  | { ok: true; payloadJSON: string }
  | { ok: false; error: { code: string; message: string } };

function coerceNodeInvokeRequest(payload: unknown): NodeInvokeRequest | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const obj = payload as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const nodeId = typeof obj.nodeId === "string" ? obj.nodeId.trim() : "";
  const command = typeof obj.command === "string" ? obj.command.trim() : "";
  if (!id || !nodeId || !command) {
    return null;
  }
  const paramsJSON =
    typeof obj.paramsJSON === "string"
      ? obj.paramsJSON
      : obj.params !== undefined
        ? JSON.stringify(obj.params)
        : null;
  return { id, nodeId, command, paramsJSON };
}

/**
 * Serve a node command surface over a gateway connection. Wraps a
 * {@link GatewayClient} connected as `role: "node"`, subscribes to
 * `node.invoke.request`, dispatches to the registered handlers, and replies with
 * `node.invoke.result` (JSON-encoded payload on success, or an error).
 */
export class NodeServer {
  readonly gateway: GatewayClient;
  private readonly handlers: Record<string, NodeCommandHandler>;
  private unsubscribe: (() => void) | null = null;

  constructor(commands: Record<string, NodeCommandHandler>, options: NodeServerOptions) {
    this.handlers = { ...commands };
    const nodeId = options.nodeId?.trim() || undefined;
    this.gateway = new GatewayClient({
      ...options,
      clientId: options.clientId ?? "node-host",
      clientMode: "node",
      role: "node",
      scopes: [],
      caps: options.caps ?? [],
      commands: Object.keys(this.handlers),
      ...(nodeId ? { instanceId: nodeId } : {}),
    });
  }

  /** Connect as a node and start answering invoke requests. Resolves once connected. */
  async start(): Promise<void> {
    if (!this.unsubscribe) {
      this.unsubscribe = this.gateway.onEvent((event) => {
        if (event.event === "node.invoke.request") {
          void this.handleInvoke(event.payload);
        }
      });
    }
    await this.gateway.connect();
  }

  /** Stop answering requests and disconnect. */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.gateway.stop();
  }

  private async handleInvoke(payload: Record<string, any>): Promise<void> {
    const frame = coerceNodeInvokeRequest(payload);
    if (!frame) {
      return;
    }
    const result = await this.dispatch(frame);
    try {
      await this.gateway.request("node.invoke.result", {
        id: frame.id,
        nodeId: frame.nodeId,
        ...result,
      });
    } catch {
      // node invoke replies are best-effort; the gateway times out stale ids.
    }
  }

  private async dispatch(frame: NodeInvokeRequest): Promise<NodeInvokeResult> {
    const handler = this.handlers[frame.command];
    if (!handler) {
      return {
        ok: false,
        error: { code: "INVALID_REQUEST", message: `command not supported: ${frame.command}` },
      };
    }
    let params: any;
    try {
      params = frame.paramsJSON ? JSON.parse(frame.paramsJSON) : {};
    } catch {
      return {
        ok: false,
        error: { code: "INVALID_REQUEST", message: "paramsJSON malformed JSON" },
      };
    }
    try {
      const result = await handler(params);
      return { ok: true, payloadJSON: JSON.stringify(result === undefined ? null : result) };
    } catch (err) {
      return {
        ok: false,
        error: { code: "UNAVAILABLE", message: err instanceof Error ? err.message : String(err) },
      };
    }
  }
}
