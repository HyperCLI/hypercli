/**
 * OpenClaw Gateway WebSocket Client
 *
 * Connects to an agent's OpenClaw gateway over WebSocket for real-time
 * configuration, chat, session management, and file operations.
 *
 * Protocol: OpenClaw Gateway v3
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
  /** Optional client instance ID */
  instanceId?: string;
  /** Optional gateway capability list */
  caps?: string[];
  /** Origin header (default: omitted for non-browser SDK clients) */
  origin?: string;
  /** Default RPC timeout in ms (default: 15000) */
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

export type GatewayEventHandler = (event: GatewayEvent) => void;

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
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

const PROTOCOL_VERSION = 3;
const DEFAULT_TIMEOUT = 15_000;
const CHAT_TIMEOUT = 120_000;
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
  "webchat",
  "cli",
  "gateway-client",
  "openclaw-macos",
  "openclaw-ios",
  "openclaw-android",
  "node-host",
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
  if (value == null) {
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
    if (result.name && entry.name === result.name && entry.result == null) {
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
    if (item.type !== "image") {
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
          : "image/png";
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
  private deploymentId?: string;
  private apiKey?: string;
  private apiBase?: string;
  private autoApprovePairing: boolean;
  private clientId: string;
  private clientMode: string;
  private clientDisplayName?: string;
  private clientVersion: string;
  private clientPlatform: string;
  private clientInstanceId?: string;
  private caps: string[];
  private origin?: string;
  private defaultTimeout: number;
  private ws: GatewaySocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventHandlers = new Set<GatewayEventHandler>();
  private connected = false;
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
    this.token = options.token?.trim() || undefined;
    this.gatewayToken = options.gatewayToken?.trim() || undefined;
    this.deploymentId = options.deploymentId?.trim() || undefined;
    this.apiKey = options.apiKey?.trim() || undefined;
    this.apiBase = options.apiBase?.trim().replace(/\/$/, "") || undefined;
    this.autoApprovePairing = options.autoApprovePairing === true;
    this.clientId = normalizeClientId(options.clientId);
    this.clientMode = normalizeClientMode(options.clientMode);
    this.clientVersion = options.clientVersion?.trim() || DEFAULT_CLIENT_VERSION;
    this.clientPlatform = resolvePlatform(options.platform);
    this.clientDisplayName = resolveClientDisplayName(options.clientDisplayName, this.clientPlatform);
    this.clientInstanceId = options.instanceId?.trim() || makeId();
    this.caps = Array.isArray(options.caps)
      ? options.caps.map((cap) => cap.trim()).filter(Boolean)
      : [...DEFAULT_CAPS];
    // Non-browser SDK clients should not send Origin by default. OpenClaw
    // treats any Origin header as browser-originated and applies browser
    // origin checks to the connection.
    this.origin = typeof options.origin === "string" && options.origin.trim()
      ? options.origin.trim()
      : undefined;
    this.defaultTimeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.onHello = options.onHello;
    this.onClose = options.onClose;
    this.onGap = options.onGap;
    this.onPairing = options.onPairing;
    this.pairingState = loadPendingPairing(this.storageScope(), OPERATOR_ROLE);
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

  get pendingPairing() {
    return this.pairingState;
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
      clearPendingPairing(this.storageScope(), OPERATOR_ROLE);
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
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private flushPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
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
        OPERATOR_ROLE,
      )?.token;
      const authToken = this.gatewayToken ?? storedDeviceToken;
      const authDeviceToken = this.pendingDeviceTokenRetry ? (storedDeviceToken ?? undefined) : undefined;
      const signedAtMs = Date.now();
      const payload = buildDeviceAuthPayload({
        deviceId: identity.deviceId,
        clientId: this.clientId,
        clientMode: this.clientMode,
        role: OPERATOR_ROLE,
        scopes: OPERATOR_SCOPES,
        signedAtMs,
        token: authToken ?? null,
        nonce,
      });
      const signature = await signDevicePayload(identity.privateKey, payload);

      const params: Record<string, any> = {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: this.clientId,
          ...(this.clientDisplayName ? { displayName: this.clientDisplayName } : {}),
          version: this.clientVersion,
          platform: this.clientPlatform,
          mode: this.clientMode,
          ...(this.clientInstanceId ? { instanceId: this.clientInstanceId } : {}),
        },
        role: OPERATOR_ROLE,
        scopes: [...OPERATOR_SCOPES],
        device: {
          id: identity.deviceId,
          publicKey: identity.publicKey,
          signature,
          signedAt: signedAtMs,
          nonce,
        },
        caps: this.caps,
        ...(authToken
          ? {
              auth: {
                ...(authToken ? { token: authToken } : {}),
                ...(authDeviceToken ? { deviceToken: authDeviceToken } : {}),
              },
            }
          : authDeviceToken
            ? {
                auth: {
                  deviceToken: authDeviceToken,
                },
              }
            : {}),
        ...(resolveUserAgent() ? { userAgent: resolveUserAgent() } : {}),
        ...(resolveLocale() ? { locale: resolveLocale() } : {}),
      };

      const hello = await this.sendRawRequest<Record<string, any>>(
        "connect",
        params,
        this.defaultTimeout,
        true,
      );

      if (hello?.auth?.deviceToken) {
        storeStoredDeviceToken({
          deviceId: identity.deviceId,
          scope: this.storageScope(),
          gatewayUrl: this.url,
          role: hello.auth.role ?? OPERATOR_ROLE,
          token: hello.auth.deviceToken,
          scopes: hello.auth.scopes ?? [],
        });
      }

      this._version = hello?.server?.version ?? hello?.version ?? null;
      this._protocol = hello?.protocol ?? null;
      this.connected = true;
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
        clearStoredDeviceToken(identity.deviceId, this.storageScope(), OPERATOR_ROLE);
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
        clearStoredDeviceToken(identity.deviceId, this.storageScope(), OPERATOR_ROLE);
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
          } catch (approvalError) {
            this.pendingConnectError = toCloseError(approvalError);
            this.updatePairingState({
              requestId,
              role: OPERATOR_ROLE,
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
            role: OPERATOR_ROLE,
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
    this.pending.delete(message.id);
    clearTimeout(pending.timer);

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
    timeout = this.defaultTimeout,
    allowBeforeHello = false,
  ): Promise<T> {
    if (!this.ws || !isSocketOpen(this.ws)) {
      return Promise.reject(new Error("gateway not connected"));
    }
    if (!allowBeforeHello && !this.connected) {
      return Promise.reject(new Error("gateway not connected"));
    }

    const id = makeId();
    const request = { type: "req", id, method, params };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });
      this.ws?.send(JSON.stringify(request));
    });
  }

  // ---------------------------------------------------------------------------
  // RPC
  // ---------------------------------------------------------------------------

  private rpc(method: string, params: Record<string, any> = {}, timeout?: number): Promise<any> {
    return this.sendRawRequest(method, params, timeout ?? this.defaultTimeout);
  }

  request<T = any>(method: string, params: Record<string, any> = {}, timeout?: number): Promise<T> {
    return this.rpc(method, params, timeout);
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

  async channelsStatus(probe = false, timeoutMs?: number): Promise<Record<string, any>> {
    const params: Record<string, any> = { probe };
    if (timeoutMs !== undefined) params.timeoutMs = timeoutMs;
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
    return await this.rpc("web.login.wait", params, CHAT_TIMEOUT);
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

  async sessionsPatch(patch: Record<string, any> & { key: string }): Promise<Record<string, any>> {
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
    return this.rpc("chat.send", params, CHAT_TIMEOUT);
  }

  async sessionsReset(sessionKey: string, reason?: "new" | "reset"): Promise<void> {
    const params: Record<string, any> = { key: sessionKey };
    if (reason) params.reason = reason;
    await this.rpc("sessions.reset", params);
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
      if (evt.event === "chat" || evt.event?.startsWith("chat.")) {
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

      const ack = await this.rpc("chat.send", params, CHAT_TIMEOUT);
      const serverRunId = typeof ack?.runId === "string" ? ack.runId.trim() : "";
      if (serverRunId) {
        acceptedRunIds.add(serverRunId);
      }

      let deadline = Date.now() + CHAT_TIMEOUT;
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

        deadline = Date.now() + CHAT_TIMEOUT;

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
          if (phase === "start") {
            const toolCallId =
              typeof toolPayload.toolCallId === "string" && toolPayload.toolCallId.trim()
                ? toolPayload.toolCallId.trim()
                : `${typeof toolPayload.name === "string" ? toolPayload.name : "tool"}:${JSON.stringify(toolPayload.args ?? null)}`;
            seenToolCallIds.add(toolCallId);
            yield {
              type: "tool_call",
              data: {
                ...(toolPayload.toolCallId ? { toolCallId: toolPayload.toolCallId } : {}),
                name: toolPayload.name,
                args: toolPayload.args,
              },
            };
          } else if (phase === "result") {
            const toolCallId =
              typeof toolPayload.toolCallId === "string" && toolPayload.toolCallId.trim()
                ? toolPayload.toolCallId.trim()
                : `${typeof toolPayload.name === "string" ? toolPayload.name : "tool"}:${JSON.stringify(toolPayload.args ?? null)}`;
            seenToolResultIds.add(toolCallId);
            yield {
              type: "tool_result",
              data: {
                ...(toolPayload.toolCallId ? { toolCallId: toolPayload.toolCallId } : {}),
                name: toolPayload.name,
                result: toolPayload.result,
                isError: toolPayload.isError,
              },
            };
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
            typeof payload.toolCallId === "string" && payload.toolCallId.trim()
              ? payload.toolCallId.trim()
              : `${typeof payload.name === "string" ? payload.name : "tool"}:${JSON.stringify(payload.args ?? payload.arguments ?? null)}`;
          seenToolCallIds.add(toolCallId);
          yield { type: "tool_call", data: payload };
          continue;
        }
        if (evt.event === "chat.tool_result") {
          const toolCallId =
            typeof payload.toolCallId === "string" && payload.toolCallId.trim()
              ? payload.toolCallId.trim()
              : `${typeof payload.name === "string" ? payload.name : "tool"}:${JSON.stringify(payload.args ?? payload.arguments ?? null)}`;
          seenToolResultIds.add(toolCallId);
          yield { type: "tool_result", data: payload };
          continue;
        }
        if (evt.event === "chat.done") {
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
        const normalizedMessage = normalizeGatewayChatMessage(payload.message);
        if (state === "delta") {
          const streamed = streamDelta(lastLegacyText, currentText);
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
          const historyText = latestHistoryAssistantText(
            await this.chatHistory(sessionKey, 20),
            acceptedRunIds,
          );
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
    return this.rpc("cron.add", { job });
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
