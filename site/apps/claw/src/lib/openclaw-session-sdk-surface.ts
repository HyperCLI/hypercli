"use client";

import type { ChatAttachment, ChatEvent, GatewayClient } from "@hypercli.com/sdk/openclaw/gateway";
import { resolveOpenClawSessionKey } from "@/lib/openclaw-session-key";

export interface OpenClawSessionRecord {
  key: string;
  clientMode: string;
  clientDisplayName: string;
  createdAt: number;
  lastMessageAt: number;
  title: string;
  messageCount: number;
  raw: Record<string, unknown>;
}

export interface OpenClawSessionPreview {
  key: string;
  text: string;
  role: string;
  timestamp?: number;
}

export type OpenClawSessionPreviewMap = Record<string, OpenClawSessionPreview>;

export const OPENCLAW_DEFAULT_SESSION_KEY = "main";
export const OPENCLAW_NEW_SESSION_TITLE = "New Project";
const GENERATED_OPENCLAW_SESSION_KEY = /^session-(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|local-[a-z0-9-]+)$/i;
const INTERNAL_OPENCLAW_SESSION_LABEL_PATTERNS = [
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
  if (unscopedOpenClawSessionKey(sessionKey) === OPENCLAW_DEFAULT_SESSION_KEY) return "Main Project";
  return isGeneratedOpenClawSessionName(sessionKey) ? OPENCLAW_NEW_SESSION_TITLE : sessionKey;
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

export function openClawEventMatchesSession(payload: unknown, sessionKey: string): boolean {
  if (!isRecord(payload)) return true;
  const eventSessionKey = firstNonEmptyString(payload.sessionKey, payload.session_key, payload.key);
  return !eventSessionKey || sameOpenClawSessionKey(eventSessionKey, sessionKey);
}

export function normalizeOpenClawSession(session: unknown): OpenClawSessionRecord | null {
  if (!isRecord(session)) return null;
  const key = sessionKeyFromRecord(session);
  if (!key) return null;

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
    clientMode,
    clientDisplayName,
    createdAt,
    lastMessageAt,
    title,
    messageCount: Number.isFinite(messageCount) ? Math.max(0, messageCount) : 0,
    raw: session,
  };
}

export function normalizeOpenClawSessions(value: unknown): OpenClawSessionRecord[] {
  const items = Array.isArray(value) ? value : [];
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

export function normalizeOpenClawSessionPreview(sessionKey: string, items: unknown): OpenClawSessionPreview | null {
  if (!Array.isArray(items)) return null;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!isRecord(item)) continue;
    const text = contentText(item.text ?? item.content ?? item.message ?? item.summary);
    if (!text) continue;
    return {
      key: sessionKey,
      text,
      role: firstNonEmptyString(item.role, item.author, item.type) ?? "message",
      timestamp: finiteTimestamp(item.timestamp ?? item.createdAt ?? item.created_at) ?? undefined,
    };
  }
  return null;
}

export async function listOpenClawSessions(gateway: Pick<GatewayClient, "sessionsList">): Promise<OpenClawSessionRecord[]> {
  return normalizeOpenClawSessions(await gateway.sessionsList());
}

export async function loadOpenClawSessionPreviews(
  gateway: Pick<GatewayClient, "sessionsPreview">,
  sessions: OpenClawSessionRecord[],
  options: { limit?: number; maxSessions?: number } = {},
): Promise<OpenClawSessionPreviewMap> {
  const limit = options.limit ?? 8;
  const maxSessions = options.maxSessions ?? 8;
  const targets = [...sessions]
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    .slice(0, maxSessions);
  const previews = await Promise.all(targets.map(async (session) => {
    try {
      return normalizeOpenClawSessionPreview(session.key, await gateway.sessionsPreview(session.key, limit));
    } catch {
      return null;
    }
  }));
  return Object.fromEntries(
    previews
      .filter((preview): preview is OpenClawSessionPreview => preview !== null)
      .map((preview) => [preview.key, preview]),
  );
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
