"use client";

import {
  type GatewayChatAttachmentPayload,
  type GatewayEvent,
  type GatewayChatToolCall,
  type OpenClawConfigSchemaResponse,
  type GatewayClient,
  normalizeGatewayChatMessage,
} from "@hypercli.com/sdk/openclaw/gateway";

export type ChatAttachment = GatewayChatAttachmentPayload;

export interface ChatPendingFile {
  name: string;
  path: string;
  type: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  toolCalls?: Array<{ id?: string; name: string; args: string; result?: string }>;
  mediaUrls?: string[];
  attachments?: ChatAttachment[]; // user-sent images
  files?: ChatPendingFile[]; // user-sent workspace files
  timestamp?: number;
}

export interface WorkspaceFile {
  name: string;
  size: number;
  missing: boolean;
}

interface Agent {
  id: string;
  name: string;
  state: string;
  hostname: string | null;
}

function maybeDecodeMojibake(text: string): string {
  // Some gateways occasionally emit UTF-8 text decoded as latin1 (e.g. ð, â).
  if (!/[Ãâð]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8").decode(bytes);
    if (decoded && decoded !== text) return decoded;
  } catch {
    // Fall back to original text on decoding errors.
  }
  return text;
}

function normalizeChatRole(role: string): ChatMessage["role"] {
  const normalized = role.trim().toLowerCase();
  if (normalized === "user" || normalized === "assistant" || normalized === "system") {
    return normalized;
  }
  return "assistant";
}

const INTERNAL_HEARTBEAT_MARKERS = [/HEARTBEAT\.md/i, /HEARTBEAT_OK/i];
const INTERNAL_HEARTBEAT_PRELUDE_MARKERS = [
  /\bThe user wants me to read\b/i,
  /\bLet me read the file first\b/i,
];

function containsInternalHeartbeatMarker(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") {
    const text = maybeDecodeMojibake(value);
    return INTERNAL_HEARTBEAT_MARKERS.some((marker) => marker.test(text));
  }
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => containsInternalHeartbeatMarker(entry));
  }
  return Object.values(value as Record<string, unknown>).some((entry) => containsInternalHeartbeatMarker(entry));
}

export function isInternalHeartbeatMessage(value: unknown): boolean {
  if (containsInternalHeartbeatMarker(value)) return true;
  if (typeof value !== "object" || value == null) return false;
  const candidate = value as {
    content?: unknown;
    thinking?: unknown;
    toolCalls?: unknown;
  };
  return (
    containsInternalHeartbeatMarker(candidate.content) ||
    containsInternalHeartbeatMarker(candidate.thinking) ||
    containsInternalHeartbeatMarker(candidate.toolCalls)
  );
}

function isLikelyInternalHeartbeatPrelude(message: ChatMessage): boolean {
  if (message.role !== "assistant") return false;
  if (message.toolCalls?.length || message.mediaUrls?.length || message.attachments?.length || message.files?.length) {
    return false;
  }
  const text = `${message.thinking ?? ""}\n${message.content ?? ""}`.trim();
  return INTERNAL_HEARTBEAT_PRELUDE_MARKERS.some((marker) => marker.test(text));
}

function formatToolValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return maybeDecodeMojibake(value);
  try {
    return maybeDecodeMojibake(JSON.stringify(value, null, 2));
  } catch {
    return maybeDecodeMojibake(String(value));
  }
}

function summarizeToolCalls(
  toolCalls: GatewayChatToolCall[],
): ChatMessage["toolCalls"] | undefined {
  if (toolCalls.length === 0) {
    return undefined;
  }
  return toolCalls.map((toolCall) => ({
    ...(toolCall.id ? { id: toolCall.id } : {}),
    name: toolCall.name,
    args: formatToolValue(toolCall.args),
    ...(toolCall.result !== undefined ? { result: formatToolValue(toolCall.result) } : {}),
  }));
}

function normalizeHistoryMessage(message: unknown): ChatMessage | null {
  const normalized = normalizeGatewayChatMessage(message);
  if (!normalized) return null;
  const content = maybeDecodeMojibake(normalized.text);
  const thinking = maybeDecodeMojibake(normalized.thinking).trim();
  if (isInternalHeartbeatMessage({ content, thinking })) return null;
  const toolCalls = summarizeToolCalls(normalized.toolCalls)?.filter(
    (toolCall) => !isInternalHeartbeatMessage({ toolCalls: [toolCall] }),
  );
  const mediaUrls = normalized.mediaUrls;
  if (!content.trim() && !thinking && (!toolCalls || toolCalls.length === 0) && mediaUrls.length === 0) {
    return null;
  }
  return {
    role: normalizeChatRole(normalized.role),
    content,
    ...(thinking ? { thinking } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
    timestamp: normalized.timestamp ?? Date.now(),
  };
}

function mergeToolCalls(
  current: NonNullable<ChatMessage["toolCalls"]>,
  incoming: NonNullable<ChatMessage["toolCalls"]>,
): NonNullable<ChatMessage["toolCalls"]> {
  const next = [...current];
  for (const toolCall of incoming) {
    let index = -1;
    for (let cursor = next.length - 1; cursor >= 0; cursor -= 1) {
      const entry = next[cursor];
      if (toolCall.id && entry.id && entry.id === toolCall.id) {
        index = cursor;
        break;
      }
      if (toolCall.result !== undefined) {
        if (entry.name === toolCall.name && entry.result == null) {
          index = cursor;
          break;
        }
        continue;
      }
      if (entry.name === toolCall.name && entry.args === toolCall.args) {
        index = cursor;
        break;
      }
    }
    if (index >= 0) {
      next[index] = {
        ...next[index],
        ...(toolCall.id ? { id: toolCall.id } : {}),
        ...(toolCall.args ? { args: toolCall.args } : {}),
        ...(toolCall.result !== undefined ? { result: toolCall.result } : {}),
      };
      continue;
    }
    next.push(toolCall);
  }
  return next;
}

function mergeAssistantMessage(current: ChatMessage, incoming: ChatMessage): ChatMessage {
  // Cumulative vs delta detection: only treat as cumulative when the incoming
  // text actually contains the current text as a prefix. The previous
  // length-based heuristic broke delta streams whenever a single chunk was
  // longer than the accumulated text, silently dropping prior content.
  const mergedContent = incoming.content
    ? (
      current.content && incoming.content.startsWith(current.content)
        ? incoming.content
        : `${current.content ?? ""}${incoming.content}`
    )
    : current.content;
  const mergedThinking = incoming.thinking
    ? (
      current.thinking && incoming.thinking.startsWith(current.thinking)
        ? incoming.thinking
        : `${current.thinking ?? ""}${incoming.thinking}`
    )
    : current.thinking;
  const mergedMediaUrls = [
    ...(current.mediaUrls ?? []),
    ...((incoming.mediaUrls ?? []).filter((url) => !(current.mediaUrls ?? []).includes(url))),
  ];
  const mergedToolCalls = incoming.toolCalls
    ? mergeToolCalls(current.toolCalls ?? [], incoming.toolCalls)
    : current.toolCalls;
  return {
    ...current,
    content: mergedContent,
    ...(mergedThinking ? { thinking: mergedThinking } : {}),
    ...(mergedToolCalls && mergedToolCalls.length > 0 ? { toolCalls: mergedToolCalls } : {}),
    ...(mergedMediaUrls.length > 0 ? { mediaUrls: mergedMediaUrls } : {}),
    timestamp: incoming.timestamp ?? current.timestamp,
  };
}

function upsertAssistantMessage(prev: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  if (isInternalHeartbeatMessage(incoming)) {
    const last = prev[prev.length - 1];
    return last && isLikelyInternalHeartbeatPrelude(last) ? prev.slice(0, -1) : prev;
  }
  const last = prev[prev.length - 1];
  let next: ChatMessage[];
  if (last?.role === "assistant") {
    next = [...prev.slice(0, -1), mergeAssistantMessage(last, incoming)];
  } else {
    next = [...prev, incoming];
  }
  return next.filter((message) => !isInternalHeartbeatMessage(message));
}

function normalizeLiveToolCall(
  payload: Record<string, unknown>,
): NonNullable<ChatMessage["toolCalls"]>[number] | null {
  const name =
    (typeof payload.name === "string" && payload.name.trim()) ||
    (typeof payload.toolName === "string" && payload.toolName.trim()) ||
    (typeof payload.tool_name === "string" && payload.tool_name.trim());
  if (!name) {
    return null;
  }
  return {
    ...(typeof payload.toolCallId === "string" && payload.toolCallId.trim()
      ? { id: payload.toolCallId.trim() }
      : {}),
    name,
    args: formatToolValue(payload.args ?? payload.arguments),
  };
}

function normalizeLiveToolResult(
  payload: Record<string, unknown>,
): NonNullable<ChatMessage["toolCalls"]>[number] | null {
  const result = formatToolValue(payload.result ?? payload.content ?? payload.text ?? payload.partialResult);
  if (!result) {
    return null;
  }
  const name =
    (typeof payload.name === "string" && payload.name.trim()) ||
    (typeof payload.toolName === "string" && payload.toolName.trim()) ||
    (typeof payload.tool_name === "string" && payload.tool_name.trim()) ||
    "tool";
  return {
    ...(typeof payload.toolCallId === "string" && payload.toolCallId.trim()
      ? { id: payload.toolCallId.trim() }
      : {}),
    name,
    args: formatToolValue(payload.args ?? payload.arguments),
    result,
  };
}


export { maybeDecodeMojibake, normalizeHistoryMessage, normalizeLiveToolCall, normalizeLiveToolResult, upsertAssistantMessage };
