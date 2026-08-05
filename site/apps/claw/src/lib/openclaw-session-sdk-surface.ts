"use client";

import {
  OPENCLAW_INTERNAL_MAIN_SESSION_KEY,
} from "@hypercli.com/sdk/openclaw/gateway";
import type {
  ChatAttachment,
  ChatEvent,
  GatewayChatHistoryResult,
  GatewayClient,
} from "@hypercli.com/sdk/openclaw/gateway";

export interface OpenClawSessionRecord {
  key: string;
  gatewaySessionKey?: string;
  sourceSessionKey?: string;
  model?: string;
  modelProvider?: string;
  thinkingLevel?: string;
  thinkingLevels?: OpenClawThinkingLevelOption[];
  thinkingDefault?: string;
  clientMode: string;
  clientDisplayName: string;
  createdAt: number;
  lastMessageAt: number;
  title: string;
  messageCount: number;
  sourceChannelId?: string;
  spawnedBy?: string;
  readOnly?: boolean;
  readOnlyReason?: string;
  ephemeral?: boolean;
  status?: string;
  hasActiveRun?: boolean;
  activeRunIds?: string[];
  raw: Record<string, unknown>;
}

export interface OpenClawThinkingLevelOption {
  id: string;
  label: string;
}

export const OPENCLAW_NEW_SESSION_TITLE = "New Session";
const OPENCLAW_CHAT_HISTORY_TRUNCATION_SUFFIX = "\n...(truncated)...";
const OPENCLAW_CHAT_MESSAGE_MAX_CHARS = 500_000;
const OPENCLAW_CHAT_MESSAGE_HYDRATION_CONCURRENCY = 4;
const GENERATED_OPENCLAW_SESSION_KEY = /^(?:(?:session-|hcli:|dashboard:)(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|local-[a-z0-9-]+))$/i;
const EPHEMERAL_OPENCLAW_SESSION_KEY = /^session-hypercli-ephemeral-[0-9a-f-]+$/i;
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

function containsOpenClawHistoryTruncation(value: unknown): boolean {
  if (typeof value === "string") return value.endsWith(OPENCLAW_CHAT_HISTORY_TRUNCATION_SUFFIX);
  if (Array.isArray(value)) return value.some(containsOpenClawHistoryTruncation);
  return isRecord(value) && Object.values(value).some(containsOpenClawHistoryTruncation);
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = nonEmptyString(value);
    if (normalized) return normalized;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((item) => {
    const normalized = nonEmptyString(item);
    return normalized ? [normalized] : [];
  })));
}

function hasExplicitActiveRun(value: Record<string, unknown>): boolean | null {
  const raw = value.hasActiveRun ?? value.has_active_run;
  return typeof raw === "boolean" ? raw : null;
}

export function openClawSessionHasActiveRun(
  session: OpenClawSessionRecord | null | undefined,
): boolean {
  if (!session) return false;
  const status = nonEmptyString(session.status ?? session.raw.status)?.toLowerCase();
  if (status && status !== "running") return false;
  const explicit = typeof session.hasActiveRun === "boolean"
    ? session.hasActiveRun
    : hasExplicitActiveRun(session.raw);
  return explicit ?? status === "running";
}

export function normalizeOpenClawThinkingLevels(
  value: unknown,
  legacyOptions?: unknown,
): OpenClawThinkingLevelOption[] {
  const levels = Array.isArray(value) ? value : [];
  const normalized = levels.flatMap((levelRaw) => {
    if (typeof levelRaw === "string") {
      const label = levelRaw.trim();
      return label ? [{ id: label, label }] : [];
    }
    if (!isRecord(levelRaw)) return [];
    const id = firstNonEmptyString(levelRaw.id, levelRaw.value);
    const label = firstNonEmptyString(levelRaw.label, levelRaw.name, id);
    return id && label ? [{ id, label }] : [];
  });
  if (normalized.length > 0) return normalized;

  return (Array.isArray(legacyOptions) ? legacyOptions : []).flatMap((option) => {
    const label = nonEmptyString(option);
    return label ? [{ id: label, label }] : [];
  });
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
    deliveryContext?.channel,
    deliveryContext?.provider,
    session.lastChannel,
    session.last_channel,
    connectedChannel?.id,
    connectedChannel?.channel,
    connectedChannel?.provider,
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
    deliveryContext?.sessionKey,
    deliveryContext?.session_key,
    deliveryContext?.to,
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
    session.lastTo,
    session.last_to,
    session.lastFrom,
    session.last_from,
    origin?.sessionKey,
    origin?.session_key,
    source?.sessionKey,
    source?.session_key,
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
    connectedChannel?.sessionKey,
    connectedChannel?.session_key,
    connectedChannel?.id,
    connectedChannel?.chat,
    connectedChannel?.user,
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
  return unscopedOpenClawSessionKey(rawKey) === OPENCLAW_INTERNAL_MAIN_SESSION_KEY;
}

function shouldUseCanonicalMainSessionKey(
  rawKey: string | null,
  derivedChannelSessionKey: string | null,
  sourceChannelId: string | null,
): boolean {
  if (!rawKey || derivedChannelSessionKey) return false;
  if (unscopedOpenClawSessionKey(rawKey) !== OPENCLAW_INTERNAL_MAIN_SESSION_KEY) return false;
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

export function isEphemeralOpenClawSessionName(value: string | null | undefined): boolean {
  return EPHEMERAL_OPENCLAW_SESSION_KEY.test(unscopedOpenClawSessionKey(value));
}

export function isOpenClawMainSessionKey(value: string | null | undefined): boolean {
  return unscopedOpenClawSessionKey(value).toLowerCase() === OPENCLAW_INTERNAL_MAIN_SESSION_KEY;
}

export function isOpenClawHeartbeatSessionKey(value: string | null | undefined): boolean {
  return unscopedOpenClawSessionKey(value).toLowerCase() === "heartbeat";
}

export function isOpenClawSubagentSessionKey(value: string | null | undefined): boolean {
  return unscopedOpenClawSessionKey(value).toLowerCase().startsWith("subagent:");
}

export function isOpenClawSubagentSession(
  session: Pick<OpenClawSessionRecord, "key"> & Partial<Pick<OpenClawSessionRecord, "spawnedBy">>,
): boolean {
  return isOpenClawSubagentSessionKey(session.key) || Boolean(session.spawnedBy?.trim());
}

function isInternalOpenClawSessionDisplayName(value: string): boolean {
  return INTERNAL_OPENCLAW_SESSION_LABEL_PATTERNS.some((pattern) => pattern.test(value));
}

export function normalizeOpenClawSessionDisplayName(value: unknown, sessionKey?: string | null): string | null {
  const label = nonEmptyString(value);
  if (!label) return null;
  if (isEphemeralOpenClawSessionName(label)) return null;
  if (isGeneratedOpenClawSessionName(label)) return null;
  if (isInternalOpenClawSessionDisplayName(label)) return null;
  if (sessionKey && label === sessionKey && unscopedOpenClawSessionKey(sessionKey) === OPENCLAW_INTERNAL_MAIN_SESSION_KEY) return null;
  if (sessionKey && label === sessionKey && (isGeneratedOpenClawSessionName(sessionKey) || isEphemeralOpenClawSessionName(sessionKey))) return null;
  return label;
}

export function normalizeOpenClawGeneratedSessionTitle(value: unknown, sessionKey: string): string | null {
  const raw = nonEmptyString(value);
  if (!raw || raw.length > 60 || /[\r\n]/.test(raw)) return null;
  if (/^(?:```|[\[{#>*])/.test(raw) || /^(?:sure\b|here(?:'s| is)\b|the (?:session )?title is\b)/i.test(raw)) {
    return null;
  }
  if (/(?:\bAKIA[0-9A-Z]{16}\b|\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(raw)) {
    return null;
  }
  const title = normalizeOpenClawSessionDisplayName(raw, sessionKey);
  return title && title !== OPENCLAW_NEW_SESSION_TITLE ? title : null;
}

function firstNormalizedOpenClawSessionDisplayName(
  sessionKey: string,
  ...values: unknown[]
): string | null {
  for (const value of values) {
    const normalized = normalizeOpenClawSessionDisplayName(value, sessionKey);
    if (normalized) return normalized;
  }
  return null;
}

export function fallbackOpenClawSessionDisplayName(sessionKey: string): string {
  if (unscopedOpenClawSessionKey(sessionKey) === OPENCLAW_INTERNAL_MAIN_SESSION_KEY) return "Main Session";
  return isGeneratedOpenClawSessionName(sessionKey) || isEphemeralOpenClawSessionName(sessionKey)
    ? OPENCLAW_NEW_SESSION_TITLE
    : sessionKey;
}

export function displayOpenClawSessionName(
  session: Pick<OpenClawSessionRecord, "key" | "title" | "clientDisplayName">,
): string {
  const fallback = fallbackOpenClawSessionDisplayName(session.key);
  const displayName = normalizeOpenClawSessionDisplayName(session.title, session.key)
    ?? normalizeOpenClawSessionDisplayName(session.clientDisplayName, session.key)
    ?? fallback;
  return isOpenClawMainSessionKey(session.key) && displayName === fallback
    ? "Previous conversation"
    : displayName;
}

export function isRecoverableOpenClawMainSession(session: OpenClawSessionRecord): boolean {
  if (!isOpenClawMainSessionKey(session.key) || session.readOnly) return false;
  const fallback = fallbackOpenClawSessionDisplayName(session.key);
  const title = normalizeOpenClawSessionDisplayName(session.title, session.key);
  const clientDisplayName = normalizeOpenClawSessionDisplayName(session.clientDisplayName, session.key);
  return session.messageCount > 0 || session.lastMessageAt > 0 ||
    Boolean((title && title !== fallback) || (clientDisplayName && clientDisplayName !== fallback));
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
  return requested ?? OPENCLAW_INTERNAL_MAIN_SESSION_KEY;
}

export function sameOpenClawSessionKey(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (left === right) return true;
  const leftUnscoped = unscopedOpenClawSessionKey(left);
  const rightUnscoped = unscopedOpenClawSessionKey(right);
  if (leftUnscoped === OPENCLAW_INTERNAL_MAIN_SESSION_KEY || rightUnscoped === OPENCLAW_INTERNAL_MAIN_SESSION_KEY) return false;
  return leftUnscoped === rightUnscoped;
}

export function sameOpenClawSelectableSessionKey(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const leftUnscoped = unscopedOpenClawSessionKey(left);
  const rightUnscoped = unscopedOpenClawSessionKey(right);
  if (leftUnscoped === OPENCLAW_INTERNAL_MAIN_SESSION_KEY || rightUnscoped === OPENCLAW_INTERNAL_MAIN_SESSION_KEY) return false;
  return leftUnscoped === rightUnscoped;
}

export function findOpenClawSelectableSession(
  sessions: OpenClawSessionRecord[],
  sessionKey: string | null | undefined,
): OpenClawSessionRecord | null {
  return sessions.find((session) => sameOpenClawSelectableSessionKey(session.key, sessionKey)) ?? null;
}

export function resolveOpenClawResumeSessionKey(sessions: OpenClawSessionRecord[]): string | null {
  let latestSession: OpenClawSessionRecord | null = null;
  let latestActivity = 0;

  for (const session of sessions) {
    if (
      session.readOnly ||
      session.ephemeral ||
      session.raw.archived === true ||
      isOpenClawMainSessionKey(session.key) ||
      isOpenClawHeartbeatSessionKey(session.key) ||
      isEphemeralOpenClawSessionName(session.key) ||
      isOpenClawSubagentSession(session)
    ) continue;

    const activity = Math.max(session.lastMessageAt, session.createdAt);
    if (!Number.isFinite(activity) || activity <= latestActivity) continue;
    latestSession = session;
    latestActivity = activity;
  }

  return latestSession?.key ?? null;
}

export function openClawGatewaySessionKey(session: OpenClawSessionRecord | null | undefined): string | null {
  return nonEmptyString(session?.gatewaySessionKey) ?? nonEmptyString(session?.key);
}

export function resolveOpenClawGatewaySessionKey(
  sessions: OpenClawSessionRecord[],
  sessionKey: string | null | undefined,
): string {
  const requested = nonEmptyString(sessionKey) ?? OPENCLAW_INTERNAL_MAIN_SESSION_KEY;
  return openClawGatewaySessionKey(findOpenClawSelectableSession(sessions, requested)) ?? requested;
}

export function openClawEventMatchesSession(payload: unknown, sessionKey: string): boolean {
  if (!isRecord(payload)) return false;
  const sourceChannelId = sessionSourceChannelId(payload);
  const derivedChannelSessionKey = channelSessionKeyFromMetadata(payload, sourceChannelId);
  const eventSessionKey = firstNonEmptyString(payload.sessionKey, payload.session_key, payload.key);
  if (derivedChannelSessionKey) {
    if (sameOpenClawSessionKey(derivedChannelSessionKey, sessionKey)) return true;
    if (unscopedOpenClawSessionKey(eventSessionKey) === OPENCLAW_INTERNAL_MAIN_SESSION_KEY) return false;
    return sameOpenClawSessionKey(eventSessionKey, sessionKey);
  }
  return Boolean(eventSessionKey && sameOpenClawSessionKey(eventSessionKey, sessionKey));
}

export function normalizeOpenClawSession(session: unknown): OpenClawSessionRecord | null {
  if (!isRecord(session)) return null;
  const rawKey = sessionKeyFromRecord(session);
  const explicitGatewaySessionKey = firstNonEmptyString(session.gatewaySessionKey, session.gateway_session_key);
  const sourceChannelId = sessionSourceChannelId(session);
  const spawnedBy = firstNonEmptyString(session.spawnedBy, session.spawned_by);
  const derivedChannelSessionKey = channelSessionKeyFromMetadata(session, sourceChannelId);
  const key = shouldUseDerivedChannelSessionKey(rawKey, derivedChannelSessionKey)
    ? derivedChannelSessionKey
    : shouldUseCanonicalMainSessionKey(rawKey, derivedChannelSessionKey, sourceChannelId)
      ? OPENCLAW_INTERNAL_MAIN_SESSION_KEY
      : rawKey;
  if (!key) return null;
  const gatewaySessionKey = explicitGatewaySessionKey ?? rawKey;
  const readOnly = isReadOnlyOpenClawSessionSource(sourceChannelId);

  const createdAt = finiteTimestamp(session.createdAt ?? session.created_at ?? session.created) ?? 0;
  const lastMessageAt = finiteTimestamp(
    session.lastMessageAt ?? session.last_message_at ?? session.updatedAt ?? session.updated_at,
  ) ?? createdAt;
  const gatewayDisplayName = unscopedOpenClawSessionKey(key).startsWith("dashboard:")
    ? [session.displayName, session.display_name]
        .map((value) => normalizeOpenClawGeneratedSessionTitle(value, key))
        .find((value) => value !== null) ?? null
    : firstNormalizedOpenClawSessionDisplayName(key, session.displayName, session.display_name);
  const title = firstNormalizedOpenClawSessionDisplayName(
    key,
    session.label,
    gatewayDisplayName,
    session.title,
    session.name,
  ) ?? "";
  const clientMode = firstNonEmptyString(session.clientMode, session.client_mode, session.mode, session.client) ?? "unknown";
  const rawClientDisplayName = firstNormalizedOpenClawSessionDisplayName(
    key,
    session.clientDisplayName,
    session.client_display_name,
    gatewayDisplayName,
    title,
  );
  const clientDisplayName = rawClientDisplayName ?? (title || fallbackOpenClawSessionDisplayName(key));
  const messageCount = Number(session.messageCount ?? session.message_count ?? 0);
  const modelProvider = firstNonEmptyString(session.modelProvider, session.model_provider, session.provider);
  const modelId = firstNonEmptyString(session.model, session.modelId, session.model_id);
  const model = modelProvider && modelId && !modelId.toLowerCase().startsWith(`${modelProvider.toLowerCase()}/`)
    ? `${modelProvider}/${modelId}`
    : modelId;
  const thinkingLevel = firstNonEmptyString(session.thinkingLevel, session.thinking_level);
  const thinkingDefault = firstNonEmptyString(session.thinkingDefault, session.thinking_default);
  const thinkingLevels = normalizeOpenClawThinkingLevels(
    session.thinkingLevels ?? session.thinking_levels,
    session.thinkingOptions ?? session.thinking_options,
  );
  const status = nonEmptyString(session.status);
  const activeRunIds = stringArray(session.activeRunIds ?? session.active_run_ids);
  const explicitHasActiveRun = hasExplicitActiveRun(session);
  const hasActiveRun = status && status.toLowerCase() !== "running"
    ? false
    : explicitHasActiveRun ?? status?.toLowerCase() === "running";

  return {
    key,
    ...(gatewaySessionKey ? { gatewaySessionKey } : {}),
    ...(derivedChannelSessionKey ? { sourceSessionKey: derivedChannelSessionKey } : {}),
    ...(model ? { model } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(thinkingLevels.length > 0 ? { thinkingLevels } : {}),
    ...(thinkingDefault ? { thinkingDefault } : {}),
    ...(status ? { status } : {}),
    ...(hasActiveRun !== null && hasActiveRun !== undefined ? { hasActiveRun } : {}),
    ...(activeRunIds.length > 0 ? { activeRunIds } : {}),
    clientMode,
    clientDisplayName,
    createdAt,
    lastMessageAt,
    title,
    messageCount: Number.isFinite(messageCount) ? Math.max(0, messageCount) : 0,
    ...(sourceChannelId ? { sourceChannelId } : {}),
    ...(spawnedBy ? { spawnedBy } : {}),
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
    if (normalizeOpenClawSessionDisplayName(session.raw.label, session.key)) return session;
    const title = openClawSessionTitleMapKeys(session.key)
      .map((key) => normalizeOpenClawSessionDisplayName(titleMap[key], session.key))
      .find((value) => value !== null);
    const nativeDisplayName = [session.raw.displayName, session.raw.display_name]
      .map((value) => normalizeOpenClawGeneratedSessionTitle(value, session.key))
      .find((value) => value !== null) ?? null;
    if (nativeDisplayName && title === OPENCLAW_NEW_SESSION_TITLE) return session;
    return title ? { ...session, title, clientDisplayName: title } : session;
  });
}

export async function listOpenClawSessions(
  gateway: Pick<GatewayClient, "sessionsList"> & Partial<Pick<GatewayClient, "sessionsListResult">>,
): Promise<OpenClawSessionRecord[]> {
  const result = typeof gateway.sessionsListResult === "function"
    ? await gateway.sessionsListResult()
    : { sessions: await gateway.sessionsList() };
  const defaults = isRecord(result.defaults) ? result.defaults : null;
  const defaultSession = defaults
    ? normalizeOpenClawSession({ ...defaults, key: OPENCLAW_INTERNAL_MAIN_SESSION_KEY })
    : null;
  const sessions = normalizeOpenClawSessions(result.sessions).map((session) => (
    defaultSession
      ? {
          ...session,
          ...(!session.model && defaultSession.model ? { model: defaultSession.model } : {}),
          ...(!session.modelProvider && defaultSession.modelProvider ? { modelProvider: defaultSession.modelProvider } : {}),
          ...(!session.thinkingLevels?.length && defaultSession.thinkingLevels?.length
            ? { thinkingLevels: defaultSession.thinkingLevels }
            : {}),
          ...(!session.thinkingDefault && defaultSession.thinkingDefault
            ? { thinkingDefault: defaultSession.thinkingDefault }
            : {}),
        }
      : session
  ));
  if (findOpenClawSelectableSession(sessions, OPENCLAW_INTERNAL_MAIN_SESSION_KEY)) return sessions;
  if (!defaultSession) return sessions;
  const hasSelectableDefaults = Boolean(
    defaultSession.model ||
    defaultSession.thinkingDefault ||
    defaultSession.thinkingLevels?.length,
  );
  return hasSelectableDefaults ? [defaultSession, ...sessions] : sessions;
}

export async function loadOpenClawChatHistory(
  gateway: Pick<GatewayClient, "chatHistory"> & Partial<Pick<GatewayClient, "chatHistoryResult" | "chatMessageGet">>,
  sessionKey: string,
  limit = 200,
): Promise<unknown[]> {
  return (await loadOpenClawChatHistoryResult(gateway, sessionKey, limit)).messages;
}

export async function loadOpenClawChatHistoryResult(
  gateway: Pick<GatewayClient, "chatHistory"> & Partial<Pick<GatewayClient, "chatHistoryResult" | "chatMessageGet">>,
  sessionKey: string,
  limit = 200,
): Promise<GatewayChatHistoryResult> {
  const historyResult = typeof gateway.chatHistoryResult === "function"
    ? await gateway.chatHistoryResult(sessionKey, limit)
    : { messages: await gateway.chatHistory(sessionKey, limit) };
  const messages = historyResult.messages;
  const chatMessageGet = gateway.chatMessageGet?.bind(gateway);
  if (!chatMessageGet) return historyResult;

  const candidates = messages.flatMap((message, index) => {
    if (!isRecord(message) || String(message.role ?? "").toLowerCase() !== "assistant") return [];
    if (message.openclawMessageToolMirror) return [];
    const metadata = isRecord(message.__openclaw) ? message.__openclaw : null;
    const messageId = nonEmptyString(metadata?.id) ?? nonEmptyString(message.messageId);
    const explicitlyTruncated = metadata?.truncated === true;
    return messageId && (explicitlyTruncated || containsOpenClawHistoryTruncation(message))
      ? [{ index, message, messageId }]
      : [];
  });
  if (candidates.length === 0) return historyResult;

  const hydrated = [...messages];
  let cursor = 0;
  const hydrateNext = async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++];
      if (!candidate) continue;
      try {
        const result = await chatMessageGet(sessionKey, candidate.messageId, {
          maxChars: OPENCLAW_CHAT_MESSAGE_MAX_CHARS,
        });
        if (!result.ok || !isRecord(result.message)) continue;
        const fullMetadata = isRecord(result.message.__openclaw) ? result.message.__openclaw : null;
        hydrated[candidate.index] = {
          ...candidate.message,
          ...result.message,
          ...(
            candidate.message.__openclaw || result.message.__openclaw
              ? {
                  __openclaw: {
                    ...(isRecord(candidate.message.__openclaw) ? candidate.message.__openclaw : {}),
                    ...(fullMetadata ?? {}),
                  },
                }
              : {}
          ),
        };
      } catch {}
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(OPENCLAW_CHAT_MESSAGE_HYDRATION_CONCURRENCY, candidates.length) },
      hydrateNext,
    ),
  );
  return { ...historyResult, messages: hydrated };
}

export function streamOpenClawChat(
  gateway: Pick<GatewayClient, "chatSend">,
  message: string,
  sessionKey: string,
  attachments?: ChatAttachment[],
  captureHistoryBaseline = false,
): AsyncGenerator<ChatEvent> {
  return captureHistoryBaseline
    ? gateway.chatSend(message, sessionKey, attachments, { captureHistoryBaseline: true })
    : gateway.chatSend(message, sessionKey, attachments);
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
  gateway: Pick<GatewayClient, "sessionsPatch">,
  sessionKey: string,
): Promise<void> {
  await gateway.sessionsPatch({ key: sessionKey, archived: true });
}

export async function createOpenClawSession(
  gateway: Pick<GatewayClient, "sessionsReset"> & Partial<Pick<GatewayClient, "sessionsCreate" | "sessionsSubscribe">>,
  sessionKey: string,
): Promise<string> {
  const resetSession = async (): Promise<string> => {
    const resetKey = nonEmptyString(await gateway.sessionsReset(sessionKey, "new")) ?? "";
    if (resetKey && sameOpenClawSessionKey(resetKey, sessionKey)) return resetKey;
    throw new Error(`Gateway protocol error: expected session ${sessionKey}, received ${resetKey || "no session key"}`);
  };

  if (typeof gateway.sessionsCreate === "function" && typeof gateway.sessionsSubscribe === "function") {
    try {
      await gateway.sessionsSubscribe();
      const result = await gateway.sessionsCreate({ key: sessionKey });
      const createdKey = typeof result.key === "string" ? result.key.trim() : "";
      if (createdKey && sameOpenClawSessionKey(createdKey, sessionKey)) return createdKey;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      if (!/unknown method|method not found|not implemented|unsupported/i.test(message)) throw error;
    }
  }
  return await resetSession();
}
