"use client";

import { ensureChatMessageRenderId, type ChatMessage } from "@/lib/openclaw-chat";
import { isEphemeralOpenClawSessionName } from "@/lib/openclaw-session-sdk-surface";

const CACHE_VERSION = 1;
const CACHE_KEY_PREFIX = "hypercli:openclaw-chat-history:v1";
const MAX_CACHED_MESSAGES = 300;
const MAX_CACHE_CHARS = 900_000;
const MAX_MESSAGE_CONTENT_CHARS = 60_000;
const MAX_TOOL_TEXT_CHARS = 8_000;
const TRUNCATED_MESSAGE_SUFFIX = "\n\n[Message shortened in local history.]";
const TRUNCATED_TOOL_SUFFIX = "\n\n[Tool output shortened in local history.]";

interface CachedChatHistoryPayload {
  version: typeof CACHE_VERSION;
  updatedAt: number;
  messages: ChatMessage[];
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizedAgentId(agentId: string | null | undefined): string | null {
  const normalized = (agentId ?? "").trim();
  return normalized ? normalized : null;
}

function normalizedSessionKey(sessionKey: string | null | undefined): string | null {
  const normalized = (sessionKey ?? "").trim();
  return normalized && normalized !== "main" ? normalized : null;
}

export function openClawChatHistoryCacheKey(
  agentId: string | null | undefined,
  sessionKey?: string | null,
): string | null {
  const normalized = normalizedAgentId(agentId);
  if (!normalized) return null;
  const session = normalizedSessionKey(sessionKey);
  if (session && isEphemeralOpenClawSessionName(session)) return null;
  const agentKey = `${CACHE_KEY_PREFIX}:${encodeURIComponent(normalized)}`;
  return session ? `${agentKey}:session:${encodeURIComponent(session)}` : agentKey;
}

function trimText(value: string, maxChars: number, suffix: string): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function compactMessage(message: ChatMessage): ChatMessage | null {
  if (message.role !== "user" && message.role !== "assistant" && message.role !== "system") return null;
  const normalized = ensureChatMessageRenderId(message);
  const content = typeof normalized.content === "string" ? trimText(normalized.content, MAX_MESSAGE_CONTENT_CHARS, TRUNCATED_MESSAGE_SUFFIX) : "";
  const timestamp = typeof normalized.timestamp === "number" && Number.isFinite(normalized.timestamp)
    ? normalized.timestamp
    : undefined;
  const files = Array.isArray(normalized.files)
    ? normalized.files.slice(0, 20).map((file) => ({
        name: String(file.name ?? ""),
        path: String(file.path ?? ""),
        type: String(file.type ?? ""),
      })).filter((file) => file.name || file.path)
    : undefined;
  const mediaUrls = Array.isArray(normalized.mediaUrls)
    ? normalized.mediaUrls.filter((url): url is string => typeof url === "string").slice(0, 20)
    : undefined;
  const toolCalls = Array.isArray(normalized.toolCalls)
    ? normalized.toolCalls.slice(0, 40).map((toolCall) => ({
        id: typeof toolCall.id === "string" ? toolCall.id : undefined,
        name: typeof toolCall.name === "string" ? toolCall.name : "tool",
        args: typeof toolCall.args === "string" ? trimText(toolCall.args, MAX_TOOL_TEXT_CHARS, TRUNCATED_TOOL_SUFFIX) : "",
        result: typeof toolCall.result === "string" ? trimText(toolCall.result, MAX_TOOL_TEXT_CHARS, TRUNCATED_TOOL_SUFFIX) : undefined,
      }))
    : undefined;

  if (!content && !files?.length && !mediaUrls?.length && !toolCalls?.length) return null;

  return {
    role: normalized.role,
    content,
    timestamp,
    renderId: normalized.renderId,
    ...(typeof normalized.clientTurnId === "string" && normalized.clientTurnId ? { clientTurnId: normalized.clientTurnId } : {}),
    ...(typeof normalized.eventId === "string" && normalized.eventId ? { eventId: normalized.eventId } : {}),
    ...(typeof normalized.messageId === "string" && normalized.messageId ? { messageId: normalized.messageId } : {}),
    ...(typeof normalized.turnId === "string" && normalized.turnId ? { turnId: normalized.turnId } : {}),
    ...(typeof normalized.runId === "string" && normalized.runId ? { runId: normalized.runId } : {}),
    ...(typeof normalized.sessionKey === "string" && normalized.sessionKey ? { sessionKey: normalized.sessionKey } : {}),
    ...(
      (typeof normalized.revision === "number" && Number.isFinite(normalized.revision)) ||
      (typeof normalized.revision === "string" && normalized.revision)
        ? { revision: normalized.revision }
        : {}
    ),
    ...(files?.length ? { files } : {}),
    ...(mediaUrls?.length ? { mediaUrls } : {}),
    ...(toolCalls?.length ? { toolCalls } : {}),
    ...(normalized.status ? { status: normalized.status } : {}),
  };
}

function compactMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .map((message) => compactMessage(message))
    .filter((message): message is ChatMessage => message !== null)
    .slice(-MAX_CACHED_MESSAGES);
}

function serializePayload(messages: ChatMessage[]): string {
  let compacted = compactMessages(messages);
  let serialized = JSON.stringify({
    version: CACHE_VERSION,
    updatedAt: Date.now(),
    messages: compacted,
  } satisfies CachedChatHistoryPayload);

  while (serialized.length > MAX_CACHE_CHARS && compacted.length > 1) {
    compacted = compacted.slice(Math.max(1, Math.ceil(compacted.length * 0.1)));
    serialized = JSON.stringify({
      version: CACHE_VERSION,
      updatedAt: Date.now(),
      messages: compacted,
    } satisfies CachedChatHistoryPayload);
  }

  return serialized;
}

function normalizeCachedMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return compactMessages(value.filter((message): message is ChatMessage => {
    if (!message || typeof message !== "object") return false;
    const role = (message as { role?: unknown }).role;
    const content = (message as { content?: unknown }).content;
    return (
      (role === "user" || role === "assistant" || role === "system") &&
      typeof content === "string"
    );
  }));
}

export function readCachedOpenClawChatHistory(
  agentId: string | null | undefined,
  sessionKey?: string | null,
): ChatMessage[] {
  const key = openClawChatHistoryCacheKey(agentId, sessionKey);
  const localStorage = storage();
  if (!key || !localStorage) return [];

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<CachedChatHistoryPayload>;
    if (parsed.version !== CACHE_VERSION) return [];
    return normalizeCachedMessages(parsed.messages);
  } catch {
    return [];
  }
}

export function writeCachedOpenClawChatHistory(
  agentId: string | null | undefined,
  messages: ChatMessage[],
  sessionKey?: string | null,
): void {
  const key = openClawChatHistoryCacheKey(agentId, sessionKey);
  const localStorage = storage();
  if (!key || !localStorage || messages.length === 0) return;

  try {
    const serialized = serializePayload(messages);
    localStorage.setItem(key, serialized);
  } catch {
    // Local history is a UX fallback. Quota/private-mode failures should not
    // interrupt live chat.
  }
}

export function clearCachedOpenClawChatHistory(
  agentId: string | null | undefined,
  sessionKey?: string | null,
): void {
  const key = openClawChatHistoryCacheKey(agentId, sessionKey);
  const localStorage = storage();
  if (!key || !localStorage) return;

  try {
    localStorage.removeItem(key);
  } catch {}
}
