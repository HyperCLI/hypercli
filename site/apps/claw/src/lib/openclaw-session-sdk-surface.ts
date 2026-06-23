"use client";

import type { ChatAttachment, ChatEvent, GatewayClient } from "@hypercli.com/sdk/openclaw/gateway";
import { resolveOpenClawSessionKey } from "@/lib/openclaw-session-key";

export interface OpenClawSessionRecord {
  key: string;
  gatewaySessionKey?: string;
  sourceSessionKey?: string;
  clientMode: string;
  clientDisplayName: string;
  createdAt: number;
  lastMessageAt: number;
  title: string;
  messageCount: number;
  sourceChannelId?: string;
  readOnly?: boolean;
  readOnlyReason?: string;
  raw: Record<string, unknown>;
}

export const OPENCLAW_DEFAULT_SESSION_KEY = "main";
export const OPENCLAW_NEW_SESSION_TITLE = "New Session";
const GENERATED_OPENCLAW_SESSION_KEY = /^session-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|local-[a-z0-9-]+)$/i;
const INTERNAL_OPENCLAW_SESSION_LABEL_PATTERNS = [
  /^Hyper Agent Web\b/i,
  /^HEARTBEAT(?:\.md|_OK)?$/i,
  /\bHEARTBEAT_OK\b/i,
  /\bRead\s+HEARTBEAT\.md\s+if\s+it\s+exists\b/i,
  /\bDo\s+not\s+infer\s+or\s+repeat\s+old\s+tasks\s+from\s+prior\s+chats\b/i,
  /(?:^|\/)HEARTBEAT\.md\b/i,
  /\/home\/node\/\.openclaw\/workspace\b/i,
  /^The user wants me to read\b/i,
  /^Let me read the file first\b/i,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = nonEmptyString(value);
    if (normalized) return normalized;
  }
  return null;
}

function primitiveSessionKeyPart(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function sessionKeyPartCandidates(value: unknown, seen = new WeakSet<object>()): string[] {
  const primitive = primitiveSessionKeyPart(value);
  if (primitive) return [primitive];
  if (Array.isArray(value)) return value.flatMap((item) => sessionKeyPartCandidates(item, seen));
  if (!isRecord(value)) return [];
  if (seen.has(value)) return [];
  seen.add(value);

  const candidateFields = [
    "sessionKey",
    "session_key",
    "key",
    "id",
    "value",
    "from",
    "fromId",
    "from_id",
    "senderId",
    "sender_id",
    "userId",
    "user_id",
    "chatId",
    "chat_id",
    "username",
    "handle",
  ];
  const nestedFields = [
    "chat",
    "user",
    "sender",
    "fromUser",
    "from_user",
    "contact",
    "account",
  ];

  return [
    ...candidateFields.flatMap((field) => sessionKeyPartCandidates(value[field], seen)),
    ...nestedFields.flatMap((field) => sessionKeyPartCandidates(value[field], seen)),
  ];
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function normalizeOpenClawSessionChannelId(value: unknown): string | null {
  const raw = nonEmptyString(value);
  if (!raw) return null;

  const normalized = raw
    .replace(/^integration[:/]/i, "")
    .replace(/^integrations\./i, "")
    .replace(/^channels\./i, "")
    .replace(/^plugins\.entries\./i, "")
    .replace(/^plugin[:/]/i, "")
    .trim()
    .toLowerCase();
  const [id] = normalized.split(/[:/]/);
  const safeId = (id || normalized)
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");

  return safeId || null;
}

function sessionSourceChannelId(session: Record<string, unknown>): string | null {
  const origin = nestedRecord(session.origin);
  const deliveryContext = nestedRecord(session.deliveryContext) ?? nestedRecord(session.delivery_context);
  const source = nestedRecord(session.source);
  const connectedChannel = nestedRecord(session.connectedChannel) ?? nestedRecord(session.connected_channel);

  return normalizeOpenClawSessionChannelId(firstNonEmptyString(
    session.sourceChannelId,
    session.source_channel_id,
    session.channelId,
    session.channel_id,
    session.channel,
    session.integrationId,
    session.integration_id,
    connectedChannel?.id,
    connectedChannel?.channel,
    connectedChannel?.provider,
    deliveryContext?.channel,
    deliveryContext?.provider,
    origin?.channel,
    origin?.provider,
    source?.channel,
    source?.provider,
  ));
}

function isReadOnlyOpenClawSessionSource(sourceChannelId: string | null): boolean {
  if (!sourceChannelId) return false;
  const normalized = sourceChannelId.trim().toLowerCase();
  return Boolean(normalized && normalized !== "webchat" && normalized !== "browser");
}

function openClawSessionReadOnlyReason(sourceChannelId: string | null): string | undefined {
  if (!isReadOnlyOpenClawSessionSource(sourceChannelId)) return undefined;
  if (sourceChannelId?.trim().toLowerCase() === "telegram") {
    return "Telegram conversations are read-only here. Reply from Telegram.";
  }
  return "This connected conversation is read-only here.";
}

function safeSessionKeyPart(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function normalizeChannelSessionKey(value: unknown, sourceChannelId: string | null): string | null {
  const raw = primitiveSessionKeyPart(value);
  if (!raw) return null;
  const channelId = normalizeOpenClawSessionChannelId(sourceChannelId);
  const prefixed = /^([a-z0-9._-]+)[:/](.+)$/i.exec(raw.trim());

  if (prefixed) {
    const provider = normalizeOpenClawSessionChannelId(prefixed[1]);
    const id = safeSessionKeyPart(prefixed[2]);
    if (provider && id && (!channelId || provider === channelId)) return `${provider}:${id}`;
  }

  if (!channelId) return null;
  const id = safeSessionKeyPart(raw);
  return id ? `${channelId}:${id}` : null;
}

function channelSessionKeyFromMetadata(session: Record<string, unknown>, sourceChannelId: string | null): string | null {
  if (!sourceChannelId) return null;
  const origin = nestedRecord(session.origin);
  const deliveryContext = nestedRecord(session.deliveryContext) ?? nestedRecord(session.delivery_context);
  const source = nestedRecord(session.source);
  const connectedChannel = nestedRecord(session.connectedChannel) ?? nestedRecord(session.connected_channel);

  const candidates = [
    session.sourceSessionKey,
    session.source_session_key,
    session.channelSessionKey,
    session.channel_session_key,
    session.externalSessionKey,
    session.external_session_key,
    origin?.sessionKey,
    origin?.session_key,
    source?.sessionKey,
    source?.session_key,
    deliveryContext?.sessionKey,
    deliveryContext?.session_key,
    session.from,
    session.fromId,
    session.from_id,
    session.senderId,
    session.sender_id,
    session.userId,
    session.user_id,
    session.chatId,
    session.chat_id,
    session.chat,
    session.user,
    session.sender,
    origin?.from,
    origin?.fromId,
    origin?.from_id,
    origin?.senderId,
    origin?.sender_id,
    origin?.userId,
    origin?.user_id,
    origin?.chatId,
    origin?.chat_id,
    origin?.chat,
    origin?.user,
    origin?.sender,
    source?.from,
    source?.fromId,
    source?.from_id,
    source?.senderId,
    source?.sender_id,
    source?.userId,
    source?.user_id,
    source?.chatId,
    source?.chat_id,
    source?.chat,
    source?.user,
    source?.sender,
    deliveryContext?.from,
    deliveryContext?.fromId,
    deliveryContext?.from_id,
    deliveryContext?.senderId,
    deliveryContext?.sender_id,
    deliveryContext?.userId,
    deliveryContext?.user_id,
    deliveryContext?.chatId,
    deliveryContext?.chat_id,
    deliveryContext?.chat,
    deliveryContext?.user,
    deliveryContext?.sender,
    connectedChannel?.sessionKey,
    connectedChannel?.session_key,
    connectedChannel?.id,
    connectedChannel?.chat,
    connectedChannel?.user,
    deliveryContext?.to,
  ];

  for (const candidate of candidates) {
    for (const value of sessionKeyPartCandidates(candidate)) {
      const key = normalizeChannelSessionKey(value, sourceChannelId);
      if (key) return key;
    }
  }
  return null;
}

function shouldUseDerivedChannelSessionKey(rawKey: string | null, derivedKey: string | null): derivedKey is string {
  if (!derivedKey) return false;
  if (!rawKey) return true;
  return unscopedOpenClawSessionKey(rawKey) === OPENCLAW_DEFAULT_SESSION_KEY;
}

function shouldUseCanonicalMainSessionKey(
  rawKey: string | null,
  derivedChannelSessionKey: string | null,
  sourceChannelId: string | null,
): boolean {
  if (!rawKey || derivedChannelSessionKey) return false;
  if (unscopedOpenClawSessionKey(rawKey) !== OPENCLAW_DEFAULT_SESSION_KEY) return false;
  return !isReadOnlyOpenClawSessionSource(sourceChannelId);
}

export function unscopedOpenClawSessionKey(value: string | null | undefined): string {
  const key = (value ?? "").trim();
  const prefixed = /^agent:[^:]+:(.+)$/.exec(key);
  const withoutAgentScope = prefixed?.[1]?.trim() || key;
  const sessionTarget = /^session:(.+)$/.exec(withoutAgentScope);
  return sessionTarget?.[1]?.trim() || withoutAgentScope;
}

export function openClawSessionTitleMapKeys(sessionKey: string): string[] {
  const unscoped = unscopedOpenClawSessionKey(sessionKey);
  return unscoped === sessionKey ? [sessionKey] : [sessionKey, unscoped];
}

export function isGeneratedOpenClawSessionName(value: string | null | undefined): boolean {
  const key = unscopedOpenClawSessionKey(value);
  return GENERATED_OPENCLAW_SESSION_KEY.test(key);
}

function isInternalOpenClawSessionDisplayName(value: string): boolean {
  return INTERNAL_OPENCLAW_SESSION_LABEL_PATTERNS.some((pattern) => pattern.test(value));
}

export function normalizeOpenClawSessionDisplayName(value: unknown, sessionKey?: string | null): string | null {
  const label = nonEmptyString(value);
  if (!label) return null;
  if (isGeneratedOpenClawSessionName(label)) return null;
  if (isInternalOpenClawSessionDisplayName(label)) return null;
  if (sessionKey && label === sessionKey && unscopedOpenClawSessionKey(sessionKey) === OPENCLAW_DEFAULT_SESSION_KEY) return null;
  if (sessionKey && label === sessionKey && isGeneratedOpenClawSessionName(sessionKey)) return null;
  return label;
}

export function fallbackOpenClawSessionDisplayName(sessionKey: string): string {
  if (unscopedOpenClawSessionKey(sessionKey) === OPENCLAW_DEFAULT_SESSION_KEY) return "Main Session";
  return isGeneratedOpenClawSessionName(sessionKey) ? OPENCLAW_NEW_SESSION_TITLE : sessionKey;
}

export function displayOpenClawSessionName(
  session: Pick<OpenClawSessionRecord, "key" | "title" | "clientDisplayName">,
): string {
  return normalizeOpenClawSessionDisplayName(session.title, session.key)
    ?? normalizeOpenClawSessionDisplayName(session.clientDisplayName, session.key)
    ?? fallbackOpenClawSessionDisplayName(session.key);
}

function finiteTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map(contentText).filter(Boolean).join(" ").trim();
  }
  if (!isRecord(value)) return "";
  return firstNonEmptyString(
    value.text,
    value.content,
    value.message,
    value.summary,
    value.title,
  ) ?? contentText(value.content);
}

function sessionKeyFromRecord(session: Record<string, unknown>): string | null {
  return firstNonEmptyString(
    session.key,
    session.id,
    session.sessionKey,
    session.session_key,
    session.sessionId,
    session.session_id,
  );
}

export function resolveOpenClawActiveSessionKey(
  agentId: string | null | undefined,
  requestedSessionKey?: string | null,
): string {
  const requested = nonEmptyString(requestedSessionKey);
  return requested ?? resolveOpenClawSessionKey(agentId);
}

export function sameOpenClawSessionKey(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  return left === right || unscopedOpenClawSessionKey(left) === unscopedOpenClawSessionKey(right);
}

export function sameOpenClawSelectableSessionKey(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const leftUnscoped = unscopedOpenClawSessionKey(left);
  const rightUnscoped = unscopedOpenClawSessionKey(right);
  if (leftUnscoped === OPENCLAW_DEFAULT_SESSION_KEY || rightUnscoped === OPENCLAW_DEFAULT_SESSION_KEY) return false;
  return leftUnscoped === rightUnscoped;
}

export function findOpenClawSelectableSession(
  sessions: OpenClawSessionRecord[],
  sessionKey: string | null | undefined,
): OpenClawSessionRecord | null {
  return sessions.find((session) => sameOpenClawSelectableSessionKey(session.key, sessionKey)) ?? null;
}

export function openClawGatewaySessionKey(session: OpenClawSessionRecord | null | undefined): string | null {
  return nonEmptyString(session?.gatewaySessionKey) ?? nonEmptyString(session?.key);
}

export function resolveOpenClawGatewaySessionKey(
  sessions: OpenClawSessionRecord[],
  sessionKey: string | null | undefined,
): string {
  const requested = nonEmptyString(sessionKey) ?? OPENCLAW_DEFAULT_SESSION_KEY;
  return openClawGatewaySessionKey(findOpenClawSelectableSession(sessions, requested)) ?? requested;
}

export function openClawEventMatchesSession(payload: unknown, sessionKey: string): boolean {
  if (!isRecord(payload)) return true;
  const sourceChannelId = sessionSourceChannelId(payload);
  const derivedChannelSessionKey = channelSessionKeyFromMetadata(payload, sourceChannelId);
  const eventSessionKey = firstNonEmptyString(payload.sessionKey, payload.session_key, payload.key);
  if (derivedChannelSessionKey) {
    if (sameOpenClawSessionKey(derivedChannelSessionKey, sessionKey)) return true;
    if (unscopedOpenClawSessionKey(eventSessionKey) === OPENCLAW_DEFAULT_SESSION_KEY) return false;
    return sameOpenClawSessionKey(eventSessionKey, sessionKey);
  }
  return !eventSessionKey || sameOpenClawSessionKey(eventSessionKey, sessionKey);
}

export function normalizeOpenClawSession(session: unknown): OpenClawSessionRecord | null {
  if (!isRecord(session)) return null;
  const rawKey = sessionKeyFromRecord(session);
  const explicitGatewaySessionKey = firstNonEmptyString(session.gatewaySessionKey, session.gateway_session_key);
  const sourceChannelId = sessionSourceChannelId(session);
  const derivedChannelSessionKey = channelSessionKeyFromMetadata(session, sourceChannelId);
  const key = shouldUseDerivedChannelSessionKey(rawKey, derivedChannelSessionKey)
    ? derivedChannelSessionKey
    : shouldUseCanonicalMainSessionKey(rawKey, derivedChannelSessionKey, sourceChannelId)
      ? OPENCLAW_DEFAULT_SESSION_KEY
      : rawKey;
  if (!key) return null;
  const gatewaySessionKey = explicitGatewaySessionKey ?? rawKey;
  const readOnly = isReadOnlyOpenClawSessionSource(sourceChannelId);

  const createdAt = finiteTimestamp(session.createdAt ?? session.created_at ?? session.created) ?? 0;
  const lastMessageAt = finiteTimestamp(
    session.lastMessageAt ?? session.last_message_at ?? session.updatedAt ?? session.updated_at,
  ) ?? createdAt;
  const title = normalizeOpenClawSessionDisplayName(
    firstNonEmptyString(session.title, session.name, session.label),
    key,
  ) ?? "";
  const clientMode = firstNonEmptyString(session.clientMode, session.client_mode, session.mode, session.client) ?? "unknown";
  const rawClientDisplayName = normalizeOpenClawSessionDisplayName(firstNonEmptyString(
    session.clientDisplayName,
    session.client_display_name,
    session.displayName,
    session.display_name,
    title,
  ), key);
  const clientDisplayName = rawClientDisplayName ?? (title || fallbackOpenClawSessionDisplayName(key));
  const messageCount = Number(session.messageCount ?? session.message_count ?? 0);

  return {
    key,
    ...(gatewaySessionKey ? { gatewaySessionKey } : {}),
    ...(derivedChannelSessionKey ? { sourceSessionKey: derivedChannelSessionKey } : {}),
    clientMode,
    clientDisplayName,
    createdAt,
    lastMessageAt,
    title,
    messageCount: Number.isFinite(messageCount) ? Math.max(0, messageCount) : 0,
    ...(sourceChannelId ? { sourceChannelId } : {}),
    ...(readOnly ? { readOnly: true, readOnlyReason: openClawSessionReadOnlyReason(sourceChannelId) } : {}),
    raw: session,
  };
}

export function normalizeOpenClawSessions(value: unknown): OpenClawSessionRecord[] {
  const items = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value).map(([key, session]) => (
          isRecord(session) && !sessionKeyFromRecord(session) ? { ...session, key } : session
        ))
      : [];
  return items
    .map((item) => normalizeOpenClawSession(item))
    .filter((item): item is OpenClawSessionRecord => item !== null);
}

export function applyOpenClawSessionTitleMap(
  sessions: OpenClawSessionRecord[],
  titleMap: Record<string, string>,
): OpenClawSessionRecord[] {
  return sessions.map((session) => {
    const title = openClawSessionTitleMapKeys(session.key)
      .map((key) => normalizeOpenClawSessionDisplayName(titleMap[key], session.key))
      .find((value) => value !== null);
    return title ? { ...session, title, clientDisplayName: title } : session;
  });
}

export async function listOpenClawSessions(gateway: Pick<GatewayClient, "sessionsList">): Promise<OpenClawSessionRecord[]> {
  return normalizeOpenClawSessions(await gateway.sessionsList());
}

export async function loadOpenClawChatHistory(
  gateway: Pick<GatewayClient, "chatHistory">,
  sessionKey: string,
  limit = 200,
): Promise<unknown[]> {
  return gateway.chatHistory(sessionKey, limit);
}

export function streamOpenClawChat(
  gateway: Pick<GatewayClient, "chatSend">,
  message: string,
  sessionKey: string,
  attachments?: ChatAttachment[],
): AsyncGenerator<ChatEvent> {
  return gateway.chatSend(message, sessionKey, attachments);
}

export async function sendOpenClawChatFallback(
  gateway: Pick<GatewayClient, "sendChat">,
  message: string,
  sessionKey: string,
  attachments?: ChatAttachment[],
): Promise<unknown> {
  return gateway.sendChat(message, sessionKey, undefined, attachments);
}

export async function deleteOpenClawSession(
  gateway: Pick<GatewayClient, "sessionsReset">,
  sessionKey: string,
): Promise<void> {
  await gateway.sessionsReset(sessionKey, "reset");
}

export async function createOpenClawSession(
  gateway: Pick<GatewayClient, "sessionsReset">,
  sessionKey: string,
): Promise<void> {
  await gateway.sessionsReset(sessionKey, "new");
}
