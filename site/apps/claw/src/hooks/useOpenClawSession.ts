"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OpenClawAgent } from "@hypercli.com/sdk/agents";
import type {
  ChatEvent,
  GatewayClient,
  GatewayCloseInfo,
  GatewayConnectionState,
  GatewayIntegrationAuthStartParams,
  GatewayIntegrationAuthStatusParams,
  GatewayIntegrationDisconnectParams,
  GatewayIntegrationStatusParams,
  GatewayIntegrationStatusResult,
  GatewaySkillsDetailParams,
  GatewaySkillsInstallParams,
  GatewaySkillsSearchParams,
  GatewaySkillsSecurityVerdictsParams,
  GatewaySkillsSkillCardParams,
  GatewaySkillsStatusParams,
  GatewaySkillsUpdateParams,
  OpenClawConfigSchemaResponse,
} from "@hypercli.com/sdk/openclaw/gateway";
import {
  type ChatAttachment,
  type ChatMessage,
  type ChatPendingFile,
  type WorkspaceFile,
} from "@/lib/openclaw-chat";
import {
  type ActivityEntry,
  type ActivityKind,
  type HydratedOpenClawConnection,
  appendActivityEntry,
  handleOpenClawChatStreamEvent,
  handleOpenClawSessionEvent,
  hydrateOpenClawConnection,
  hydrateOpenClawSession,
  refreshOpenClawChatMessages,
} from "@/lib/openclaw-session";
import {
  clearCachedOpenClawChatHistory,
  readCachedOpenClawChatHistory,
  writeCachedOpenClawChatHistory,
} from "@/lib/openclaw-chat-history-cache";
import {
  type ChatHistoryAction,
  type ChatHistoryTarget,
  reduceChatHistoryMessages,
  sameChatHistoryTarget,
} from "@/lib/openclaw-chat-history-state";
import {
  type OpenClawSessionRecord,
  OPENCLAW_DEFAULT_SESSION_KEY,
  OPENCLAW_NEW_SESSION_TITLE,
  applyOpenClawSessionTitleMap,
  createOpenClawSession,
  deleteOpenClawSession,
  fallbackOpenClawSessionDisplayName,
  findOpenClawSelectableSession,
  isGeneratedOpenClawSessionName,
  listOpenClawSessions,
  normalizeOpenClawSessionDisplayName,
  normalizeOpenClawSessions,
  openClawEventMatchesSession,
  openClawGatewaySessionKey,
  openClawSessionTitleMapKeys,
  resolveOpenClawActiveSessionKey,
  resolveOpenClawGatewaySessionKey,
  sameOpenClawSessionKey,
  sameOpenClawSelectableSessionKey,
  sendOpenClawChatFallback,
  streamOpenClawChat,
  unscopedOpenClawSessionKey,
} from "@/lib/openclaw-session-sdk-surface";
import { cronScheduleLabel } from "@/lib/cron-jobs";

const E2E_OPENCLAW_CONNECTED_KEY = "claw_e2e_openclaw_connected";
const OPENCLAW_SESSION_TITLE_STORAGE_PREFIX = "openclaw.sessionTitles.v1";
const OPENCLAW_SESSION_LIST_STORAGE_PREFIX = "openclaw.sessions.v1";
const OPENCLAW_SESSION_LIST_CACHE_TTL_MS = 5 * 60_000;
const OPENCLAW_DELETED_SESSION_TOMBSTONE_TTL_MS = 30_000;
const GATEWAY_CONNECTING_STALL_MS = 30_000;
const GATEWAY_STATUS_CACHE_TTL_MS = 5_000;
const OPENCLAW_PASSIVE_COMPLETION_REFRESH_DEBOUNCE_MS = 100;
const GATEWAY_CONNECTING_STALL_MESSAGE =
  "Timed out opening the agent session. The gateway is still reconnecting in the background.";
const GENERIC_OPENCLAW_CONNECTION_ERROR = "Could not connect to the agent session.";
const OPENCLAW_ORIGIN_DENIED_MESSAGE =
  "This agent was opened from another dashboard address. Stop and start it from this page, then retry.";
let fallbackSessionCounter = 0;

interface SendMessageOptions {
  displayContent?: string;
  files?: ChatPendingFile[];
}

interface ComposerDraftState {
  input: string;
  pendingAttachments: ChatAttachment[];
  pendingAttachmentReads: number;
  pendingFiles: ChatPendingFile[];
}

interface QueuedChatMessage {
  message: string;
  target: ChatHistoryTarget;
}

export type OpenClawHydrationMode = "full" | "sessions";

interface UseOpenClawSessionOptions {
  hydrationMode?: OpenClawHydrationMode;
}

interface ConnectionHydrationEntry {
  gateway: GatewayClient;
  agentId: string | null;
  promise: Promise<HydratedOpenClawConnection>;
  value?: HydratedOpenClawConnection;
}

interface GatewayStatusCacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

interface SessionListRefreshEntry {
  gateway: GatewayClient;
  agentId: string | null;
  promise: Promise<OpenClawSessionRecord[]>;
}

interface ReconnectSessionRefreshRequest {
  promise: Promise<OpenClawSessionRecord[] | undefined>;
  resolve: (sessions: OpenClawSessionRecord[] | undefined) => void;
}

interface SessionSnapshotEntry {
  agentId: string | null;
  fetchedAgentId: string | null;
  sessions: OpenClawSessionRecord[];
}

interface ChatHistoryRefreshEntry {
  gateway: GatewayClient;
  agentId: string | null;
  activeSessionKey: string;
  activeGatewaySessionKey: string;
  promise: Promise<void>;
}

type DeletedSessionTombstones = Record<string, number>;

function hasSeededE2EConnection(): boolean {
  if (typeof window === "undefined" || !window.navigator.webdriver) return false;
  try {
    return window.localStorage.getItem(E2E_OPENCLAW_CONNECTED_KEY) === "1";
  } catch {
    return false;
  }
}

function sessionTitleStorageKey(agentId: string): string {
  return `${OPENCLAW_SESSION_TITLE_STORAGE_PREFIX}:${agentId}`;
}

function sessionListStorageKey(agentId: string): string {
  return `${OPENCLAW_SESSION_LIST_STORAGE_PREFIX}:${agentId}`;
}

function createOpenClawSessionKey(existingSessions: OpenClawSessionRecord[]): string {
  const existingKeys = new Set(existingSessions.flatMap((session) => openClawSessionTitleMapKeys(session.key)));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `local-${(fallbackSessionCounter += 1).toString(36)}`;
    const key = `session-${suffix}`;
    if (!existingKeys.has(key)) return key;
  }
  fallbackSessionCounter += 1;
  return `session-local-${fallbackSessionCounter.toString(36)}`;
}

function newOpenClawSessionRecord(sessionKey: string): OpenClawSessionRecord {
  return localOpenClawSessionRecord(sessionKey, OPENCLAW_NEW_SESSION_TITLE);
}

function localOpenClawSessionRecord(sessionKey: string, title = fallbackOpenClawSessionDisplayName(sessionKey)): OpenClawSessionRecord {
  const now = Date.now();
  return {
    key: sessionKey,
    clientMode: "openclaw",
    clientDisplayName: title,
    createdAt: now,
    lastMessageAt: now,
    title,
    messageCount: 0,
    raw: { key: sessionKey, title },
  };
}

function chatHistoryTargetKey(target: ChatHistoryTarget): string {
  return JSON.stringify([target.agentId ?? null, target.sessionKey]);
}

function emptyComposerDraft(): ComposerDraftState {
  return {
    input: "",
    pendingAttachments: [],
    pendingAttachmentReads: 0,
    pendingFiles: [],
  };
}

function sameOpenClawSessionRecordForDisplay(left: OpenClawSessionRecord, right: OpenClawSessionRecord): boolean {
  return left.key === right.key &&
    left.gatewaySessionKey === right.gatewaySessionKey &&
    left.sourceSessionKey === right.sourceSessionKey &&
    left.clientMode === right.clientMode &&
    left.clientDisplayName === right.clientDisplayName &&
    left.createdAt === right.createdAt &&
    left.lastMessageAt === right.lastMessageAt &&
    left.title === right.title &&
    left.messageCount === right.messageCount &&
    left.sourceChannelId === right.sourceChannelId &&
    left.readOnly === right.readOnly &&
    left.readOnlyReason === right.readOnlyReason;
}

function sameOpenClawSessionListForDisplay(left: OpenClawSessionRecord[], right: OpenClawSessionRecord[]): boolean {
  return left.length === right.length && left.every((session, index) => sameOpenClawSessionRecordForDisplay(session, right[index]));
}

function readStoredSessionTitles(agentId: string | null): Record<string, string> {
  if (!agentId || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(sessionTitleStorageKey(agentId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
        .map(([key, value]) => [key, normalizeOpenClawSessionDisplayName(value, key)])
        .filter((entry): entry is [string, string] => entry[1] !== null),
    );
  } catch {
    return {};
  }
}

function writeStoredSessionTitles(agentId: string | null, titles: Record<string, string>): void {
  if (!agentId || typeof window === "undefined") return;
  try {
    const normalizedTitles = Object.fromEntries(
      Object.entries(titles)
        .map(([key, value]) => [key, normalizeOpenClawSessionDisplayName(value, key)])
        .filter((entry): entry is [string, string] => entry[1] !== null),
    );
    window.localStorage.setItem(sessionTitleStorageKey(agentId), JSON.stringify(normalizedTitles));
  } catch {}
}

function readStoredSessions(agentId: string | null): OpenClawSessionRecord[] {
  if (!agentId || typeof window === "undefined") return [];
  try {
    const storageKey = sessionListStorageKey(agentId);
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!isRecord(parsed)) return [];
    const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : NaN;
    const cacheAge = Date.now() - updatedAt;
    if (!Number.isFinite(cacheAge) || cacheAge < 0 || cacheAge > OPENCLAW_SESSION_LIST_CACHE_TTL_MS) {
      window.localStorage.removeItem(storageKey);
      return [];
    }
    return normalizeOpenClawSessions(parsed.sessions);
  } catch {
    return [];
  }
}

function writeStoredSessions(agentId: string | null, sessions: OpenClawSessionRecord[]): void {
  if (!agentId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(sessionListStorageKey(agentId), JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      sessions: sessions.map((session) => ({
        key: session.key,
        gatewaySessionKey: session.gatewaySessionKey,
        sourceSessionKey: session.sourceSessionKey,
        clientMode: session.clientMode,
        clientDisplayName: session.clientDisplayName,
        createdAt: session.createdAt,
        lastMessageAt: session.lastMessageAt,
        title: session.title,
        messageCount: session.messageCount,
        sourceChannelId: session.sourceChannelId,
        readOnly: session.readOnly,
        readOnlyReason: session.readOnlyReason,
      })),
    }));
  } catch {}
}

function rawSessionString(session: OpenClawSessionRecord, field: string): string {
  const value = session.raw?.[field];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isGeneratedDirectBrowserSession(session: OpenClawSessionRecord): boolean {
  if (session.readOnly || !isGeneratedOpenClawSessionName(session.key)) return false;
  const sourceChannel = session.sourceChannelId?.trim().toLowerCase() ?? "";
  if (sourceChannel && sourceChannel !== "webchat" && sourceChannel !== "browser") return false;

  const kind = rawSessionString(session, "kind");
  const chatType = rawSessionString(session, "chatType");
  const lastChannel = rawSessionString(session, "lastChannel");
  if (kind && kind !== "direct") return false;
  if (chatType && chatType !== "direct") return false;
  if (lastChannel && lastChannel !== "webchat" && lastChannel !== "browser") return false;
  return true;
}

function hasLocalSessionIdentity(
  session: OpenClawSessionRecord,
  titleMap: Record<string, string>,
  creatingSessionKeys: Set<string>,
): boolean {
  if (openClawSessionTitleMapKeys(session.key).some((key) => Boolean(titleMap[key]))) return true;
  for (const key of creatingSessionKeys) {
    if (sameOpenClawSelectableSessionKey(session.key, key)) return true;
  }
  return false;
}

function isActiveSessionChannelBackedDefault(
  sessions: OpenClawSessionRecord[],
  activeSessionKey: string,
): boolean {
  return sessions.some((session) => (
    session.readOnly === true &&
    sameOpenClawSessionKey(openClawGatewaySessionKey(session), activeSessionKey)
  ));
}

function shouldReconcileGeneratedSessionsAsMain(
  sessions: OpenClawSessionRecord[],
  activeSessionKey: string,
): boolean {
  if (activeSessionKey === OPENCLAW_DEFAULT_SESSION_KEY) return true;
  if (unscopedOpenClawSessionKey(activeSessionKey) !== OPENCLAW_DEFAULT_SESSION_KEY) return false;
  return !isActiveSessionChannelBackedDefault(sessions, activeSessionKey);
}

function reconcileSessionsForActiveSession({
  sessions,
  activeSessionKey,
  titleMap,
  creatingSessionKeys,
}: {
  sessions: OpenClawSessionRecord[];
  activeSessionKey: string;
  titleMap: Record<string, string>;
  creatingSessionKeys: Set<string>;
}): OpenClawSessionRecord[] {
  if (!shouldReconcileGeneratedSessionsAsMain(sessions, activeSessionKey)) return sessions;

  const generatedMainCandidates = sessions
    .filter((session) => isGeneratedDirectBrowserSession(session) && !hasLocalSessionIdentity(session, titleMap, creatingSessionKeys));
  const candidate = [...generatedMainCandidates].sort((a, b) => b.lastMessageAt - a.lastMessageAt)[0];
  if (!candidate) return sessions;

  const existingMain = findOpenClawSelectableSession(sessions, OPENCLAW_DEFAULT_SESSION_KEY);
  const ignoredGeneratedSessions = new Set(generatedMainCandidates);

  const mainSession: OpenClawSessionRecord = {
    ...(existingMain ?? candidate),
    key: OPENCLAW_DEFAULT_SESSION_KEY,
    gatewaySessionKey: existingMain?.gatewaySessionKey ?? candidate.gatewaySessionKey ?? candidate.key,
    lastMessageAt: Math.max(existingMain?.lastMessageAt ?? 0, candidate.lastMessageAt),
    messageCount: Math.max(existingMain?.messageCount ?? 0, candidate.messageCount),
    title: "",
    clientDisplayName: fallbackOpenClawSessionDisplayName(OPENCLAW_DEFAULT_SESSION_KEY),
  };
  return [
    mainSession,
    ...sessions.filter((session) => session !== existingMain && !ignoredGeneratedSessions.has(session)),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableStatusCacheKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStatusCacheKey).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value ?? null);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStatusCacheKey(value[key])}`).join(",")}}`;
}

function integrationStatusCacheKey(params: GatewayIntegrationStatusParams): string {
  const normalized: Record<string, unknown> = { ...params };
  if (normalized.probe === false) delete normalized.probe;
  return stableStatusCacheKey(normalized);
}

function mergeOpenClawConfigPatch(
  current: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = isRecord(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
      continue;
    }
    if (isRecord(value) && isRecord(next[key])) {
      next[key] = mergeOpenClawConfigPatch(next[key], value);
      continue;
    }
    next[key] = value;
  }
  return next;
}

function stringifyErrorForSearch(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function extractErrorMessage(value: unknown, seen = new WeakSet<object>()): string | null {
  if (value instanceof Error) return value.message || null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!isRecord(value)) return null;
  if (seen.has(value)) return null;
  seen.add(value);

  for (const key of ["message", "detail", "error", "reason", "statusText", "title"]) {
    const nested = extractErrorMessage(value[key], seen);
    if (nested && nested !== "[object Object]") return nested;
  }

  return null;
}

function formatOpenClawConnectionError(value: unknown): string {
  const searchable = stringifyErrorForSearch(value);
  if (/origin not allowed/i.test(searchable)) return OPENCLAW_ORIGIN_DENIED_MESSAGE;
  return extractErrorMessage(value) ?? GENERIC_OPENCLAW_CONNECTION_ERROR;
}

function isPairingProgressMessage(value: unknown): boolean {
  return /\bpairing required\b|PAIRING_REQUIRED|pairing approved/i.test(stringifyErrorForSearch(value));
}

export function useOpenClawSession(
  agent: OpenClawAgent | null,
  enabled: boolean = true,
  requestedActiveSessionKey?: string | null,
  options: UseOpenClawSessionOptions = {},
) {
  const agentId = agent?.id ?? null;
  const hydrationMode = options.hydrationMode ?? "full";
  const fullHydrationEnabled = hydrationMode === "full";
  const activeSessionKey = resolveOpenClawActiveSessionKey(agentId, requestedActiveSessionKey);
  const latestAgentRef = useRef(agent);
  const [gateway, setGateway] = useState<GatewayClient | null>(null);
  const [status, setStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydrating, setHydrating] = useState(false);
  const [ready, setReady] = useState(false);
  const [input, setActiveInput] = useState("");
  const [pendingMessages, setPendingMessages] = useState<QueuedChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sendingTargets, setSendingTargets] = useState<ChatHistoryTarget[]>([]);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [configSchema, setConfigSchema] = useState<OpenClawConfigSchemaResponse | null>(null);
  const [gwAgentId, setGwAgentId] = useState("main");
  const [sessions, setSessions] = useState<OpenClawSessionRecord[]>([]);
  const [sessionsAgentId, setSessionsAgentId] = useState<string | null>(null);
  const [sessionsFetchedAgentId, setSessionsFetchedAgentId] = useState<string | null>(null);
  const [creatingSessionKeys, setCreatingSessionKeys] = useState<string[]>([]);
  const [deletedSessionKeys, setDeletedSessionKeys] = useState<DeletedSessionTombstones>({});
  const [cronJobs, setCronJobs] = useState<Array<Record<string, unknown>>>([]);
  const [models, setModels] = useState<Array<Record<string, unknown>>>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEntry[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [pendingAttachmentReads, setPendingAttachmentReads] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<ChatPendingFile[]>([]);
  const [aborting, setAborting] = useState(false);
  const [abortingTarget, setAbortingTarget] = useState<ChatHistoryTarget | null>(null);
  const [retrySignal, setRetrySignal] = useState(0);
  const activeChatSendTargetsRef = useRef<Set<string>>(new Set());
  const activeChatStreamsRef = useRef<Map<string, AsyncGenerator<ChatEvent>>>(new Map());
  const abortRequestedTargetsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<ChatMessage[]>([]);
  const liveChatHistoryByTargetRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const composerDraftsByTargetRef = useRef<Map<string, ComposerDraftState>>(new Map());
  const activeComposerTargetRef = useRef<ChatHistoryTarget>({ agentId, sessionKey: activeSessionKey });
  const sendingRef = useRef(false);
  const sendingTargetsRef = useRef<Map<string, ChatHistoryTarget>>(new Map());
  const abortingTargetRef = useRef<ChatHistoryTarget | null>(null);
  const activeSessionKeyRef = useRef(activeSessionKey);
  const chatHistoryTargetRef = useRef<ChatHistoryTarget>({ agentId, sessionKey: activeSessionKey });
  const cacheRestoreTargetRef = useRef<ChatHistoryTarget | null>(null);
  const sessionTitleMapRef = useRef<Record<string, string>>({});
  const creatingSessionKeysRef = useRef<Set<string>>(new Set());
  const reconnectSessionRefreshRef = useRef<ReconnectSessionRefreshRequest | null>(null);
  const connectionHydrationRef = useRef<ConnectionHydrationEntry | null>(null);
  const sessionListRefreshRef = useRef<SessionListRefreshEntry | null>(null);
  const chatHistoryRefreshRef = useRef<ChatHistoryRefreshEntry | null>(null);
  const sessionSnapshotRef = useRef<SessionSnapshotEntry>({ agentId: null, fetchedAgentId: null, sessions: [] });
  const channelsStatusCacheRef = useRef<GatewayStatusCacheEntry<Record<string, unknown>> | null>(null);
  const integrationsStatusCacheRef = useRef<Map<string, GatewayStatusCacheEntry<GatewayIntegrationStatusResult>>>(new Map());
  const seededE2EConnection = hasSeededE2EConnection();

  useEffect(() => {
    latestAgentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  const publishSendingTargets = useCallback(() => {
    const nextTargets = Array.from(sendingTargetsRef.current.values());
    setSendingTargets(nextTargets);
    const anySending = nextTargets.length > 0;
    sendingRef.current = anySending;
    setSending(anySending);
  }, []);

  const markSendingForTarget = useCallback((target: ChatHistoryTarget) => {
    sendingTargetsRef.current.set(chatHistoryTargetKey(target), target);
    publishSendingTargets();
  }, [publishSendingTargets]);

  const clearSendingForTarget = useCallback((target?: ChatHistoryTarget | null) => {
    if (target) {
      sendingTargetsRef.current.delete(chatHistoryTargetKey(target));
    } else {
      sendingTargetsRef.current.clear();
    }
    publishSendingTargets();
  }, [publishSendingTargets]);

  const setSendingForTarget = useCallback((target: ChatHistoryTarget, value: boolean | ((prev: boolean) => boolean)) => {
    const targetIsSending = sendingTargetsRef.current.has(chatHistoryTargetKey(target));
    const nextValue = typeof value === "function" ? value(targetIsSending) : value;
    if (nextValue) {
      markSendingForTarget(target);
    } else {
      clearSendingForTarget(target);
    }
  }, [clearSendingForTarget, markSendingForTarget]);

  const markAbortingForTarget = useCallback((target: ChatHistoryTarget) => {
    abortingTargetRef.current = target;
    setAbortingTarget(target);
    setAborting(true);
  }, []);

  const clearAbortingForTarget = useCallback((target?: ChatHistoryTarget | null) => {
    const currentTarget = abortingTargetRef.current;
    if (target && currentTarget && !sameChatHistoryTarget(currentTarget, target)) return;
    abortingTargetRef.current = null;
    setAbortingTarget(null);
    setAborting(false);
  }, []);

  const readComposerDraftForTarget = useCallback((target: ChatHistoryTarget): ComposerDraftState => {
    return composerDraftsByTargetRef.current.get(chatHistoryTargetKey(target)) ?? emptyComposerDraft();
  }, []);

  const syncActiveComposerDraft = useCallback((target: ChatHistoryTarget) => {
    const draft = readComposerDraftForTarget(target);
    setActiveInput(draft.input);
    setPendingAttachments(draft.pendingAttachments);
    setPendingAttachmentReads(draft.pendingAttachmentReads);
    setPendingFiles(draft.pendingFiles);
  }, [readComposerDraftForTarget]);

  const updateComposerDraftForTarget = useCallback((
    target: ChatHistoryTarget,
    update: (draft: ComposerDraftState) => ComposerDraftState,
  ) => {
    const targetKey = chatHistoryTargetKey(target);
    const currentDraft = composerDraftsByTargetRef.current.get(targetKey) ?? emptyComposerDraft();
    const nextDraft = update(currentDraft);
    composerDraftsByTargetRef.current.set(targetKey, nextDraft);
    if (sameChatHistoryTarget(activeComposerTargetRef.current, target)) {
      setActiveInput(nextDraft.input);
      setPendingAttachments(nextDraft.pendingAttachments);
      setPendingAttachmentReads(nextDraft.pendingAttachmentReads);
      setPendingFiles(nextDraft.pendingFiles);
    }
  }, []);

  const setInput = useCallback((value: string | ((current: string) => string)) => {
    const target = activeComposerTargetRef.current;
    updateComposerDraftForTarget(target, (draft) => ({
      ...draft,
      input: typeof value === "function" ? value(draft.input) : value,
    }));
  }, [updateComposerDraftForTarget]);

  useLayoutEffect(() => {
    activeSessionKeyRef.current = activeSessionKey;
  }, [activeSessionKey]);

  useLayoutEffect(() => {
    chatHistoryTargetRef.current = { agentId, sessionKey: activeSessionKey };
  }, [agentId, activeSessionKey]);

  useLayoutEffect(() => {
    const target = { agentId, sessionKey: activeSessionKey };
    activeComposerTargetRef.current = target;
    syncActiveComposerDraft(target);
  }, [agentId, activeSessionKey, syncActiveComposerDraft]);

  useLayoutEffect(() => {
    sessionSnapshotRef.current = { agentId: sessionsAgentId, fetchedAgentId: sessionsFetchedAgentId, sessions };
  }, [sessionsAgentId, sessionsFetchedAgentId, sessions]);

  const dispatchChatHistory = useCallback((action: ChatHistoryAction, target?: ChatHistoryTarget) => {
    const dispatchTarget = target ?? chatHistoryTargetRef.current;
    const targetKey = chatHistoryTargetKey(dispatchTarget);
    if (!sameChatHistoryTarget(chatHistoryTargetRef.current, dispatchTarget)) {
      const currentMessages = liveChatHistoryByTargetRef.current.get(targetKey) ?? [];
      const nextMessages = reduceChatHistoryMessages(currentMessages, action);
      liveChatHistoryByTargetRef.current.set(targetKey, nextMessages);
      return;
    }
    setMessages((currentMessages) => {
      const nextMessages = reduceChatHistoryMessages(currentMessages, action);
      messagesRef.current = nextMessages;
      liveChatHistoryByTargetRef.current.set(targetKey, nextMessages);
      return nextMessages;
    });
  }, []);

  useLayoutEffect(() => {
    const titleMap = readStoredSessionTitles(agentId);
    writeStoredSessionTitles(agentId, titleMap);
    const cachedSessions = applyOpenClawSessionTitleMap(reconcileSessionsForActiveSession({
      sessions: readStoredSessions(agentId),
      activeSessionKey: activeSessionKeyRef.current,
      titleMap,
      creatingSessionKeys: new Set(),
    }), titleMap);
    writeStoredSessions(agentId, cachedSessions);
    setDeletedSessionKeys({});
    setSessions(cachedSessions);
    setSessionsAgentId(agentId);
    setSessionsFetchedAgentId(null);
    creatingSessionKeysRef.current = new Set();
    setCreatingSessionKeys([]);
    sessionTitleMapRef.current = titleMap;
  }, [agentId]);

  const completeReconnectSessionRefresh = useCallback((request: ReconnectSessionRefreshRequest | null, sessions: OpenClawSessionRecord[] | undefined) => {
    if (!request) return;
    if (reconnectSessionRefreshRef.current === request) reconnectSessionRefreshRef.current = null;
    request.resolve(sessions);
  }, []);

  const retry = useCallback(() => {
    setRetrySignal((value) => value + 1);
  }, []);

  const retryAndRefreshSessions = useCallback(() => {
    const current = reconnectSessionRefreshRef.current;
    if (current) return current.promise;

    let resolveRequest: ReconnectSessionRefreshRequest["resolve"] = () => undefined;
    const promise = new Promise<OpenClawSessionRecord[] | undefined>((resolve) => {
      resolveRequest = resolve;
    });
    const request: ReconnectSessionRefreshRequest = { promise, resolve: resolveRequest };
    reconnectSessionRefreshRef.current = request;
    setRetrySignal((value) => value + 1);
    return promise;
  }, []);

  const clearGatewayStatusCaches = useCallback(() => {
    channelsStatusCacheRef.current = null;
    integrationsStatusCacheRef.current.clear();
  }, []);

  const hydrateConnectionForGateway = useCallback((nextGateway: GatewayClient) => {
    const current = connectionHydrationRef.current;
    if (current && current.gateway === nextGateway && current.agentId === agentId) return current.promise;

    const promise = hydrateOpenClawConnection(nextGateway, agentId);
    const nextEntry: ConnectionHydrationEntry = { gateway: nextGateway, agentId, promise };
    connectionHydrationRef.current = nextEntry;
    void promise.then((value) => {
      if (connectionHydrationRef.current === nextEntry) nextEntry.value = value;
    }).catch(() => {
      if (connectionHydrationRef.current === nextEntry) connectionHydrationRef.current = null;
    });
    return promise;
  }, [agentId]);

  const updateConnectionHydration = useCallback((update: (connection: HydratedOpenClawConnection) => void) => {
    const current = connectionHydrationRef.current;
    if (!current) return;
    if (current.value) {
      update(current.value);
      return;
    }
    void current.promise.then((value) => {
      if (connectionHydrationRef.current === current) update(value);
    }).catch(() => undefined);
  }, []);

  const resetSessionStateForDisconnect = useCallback(({ preserveMessages = false }: { preserveMessages?: boolean } = {}) => {
    completeReconnectSessionRefresh(reconnectSessionRefreshRef.current, undefined);
    connectionHydrationRef.current = null;
    sessionListRefreshRef.current = null;
    chatHistoryRefreshRef.current = null;
    clearGatewayStatusCaches();
    activeChatSendTargetsRef.current.clear();
    activeChatStreamsRef.current.clear();
    abortRequestedTargetsRef.current.clear();
    abortingTargetRef.current = null;
    sendingTargetsRef.current.clear();
    publishSendingTargets();
    setAbortingTarget(null);
    setAborting(false);
    setHydrating(false);
    setReady(false);
    if (!preserveMessages) dispatchChatHistory({ type: "clear" });
    setFiles([]);
    setConfig(null);
    setConfigSchema(null);
    setSending(false);
    setGwAgentId("main");
    composerDraftsByTargetRef.current.clear();
    setActiveInput("");
    setPendingAttachments([]);
    setPendingAttachmentReads(0);
    setPendingFiles([]);
    setPendingMessages([]);
    setSessions([]);
    setSessionsAgentId(null);
    setSessionsFetchedAgentId(null);
    creatingSessionKeysRef.current = new Set();
    setCreatingSessionKeys([]);
    setDeletedSessionKeys({});
    setCronJobs([]);
    setModels([]);
    setActivityFeed([]);
  }, [clearGatewayStatusCaches, completeReconnectSessionRefresh, dispatchChatHistory, publishSendingTargets]);

  useEffect(() => {
    if (!enabled || !agentId || seededE2EConnection || status !== "connecting" || ready || error) return;
    const timeout = window.setTimeout(() => {
      setError((current) => current ?? GATEWAY_CONNECTING_STALL_MESSAGE);
    }, GATEWAY_CONNECTING_STALL_MS);
    return () => window.clearTimeout(timeout);
  }, [agentId, enabled, error, ready, seededE2EConnection, status]);

  useEffect(() => {
    let active = true;
    let localGateway: GatewayClient | null = null;
    let unsubscribeConnectionState: (() => void) | null = null;
    connectionHydrationRef.current = null;
    sessionListRefreshRef.current = null;
    chatHistoryRefreshRef.current = null;
    clearGatewayStatusCaches();

    if (enabled && seededE2EConnection) {
      setGateway(null);
      setStatus("connected");
      setError(null);
      setHydrating(false);
      setReady(true);
      return () => {
        active = false;
      };
    }

    const sessionAgent = latestAgentRef.current;
    if (!enabled || !agentId || !sessionAgent || typeof sessionAgent.connect !== "function") {
      setGateway(null);
      setStatus("disconnected");
      setError(null);
      resetSessionStateForDisconnect();
      return () => {
        active = false;
      };
    }

    setGateway(null);
    setStatus("connecting");
    setError(null);
    setHydrating(false);
    setReady(false);

    void (async () => {
      try {
        await sessionAgent.waitForGatewayContext();
        const client = sessionAgent.gateway({
          autoApprovePairing: true,
          onClose: ({ error: closeError, code, reason }: GatewayCloseInfo) => {
            if (!active) return;
            if (isPairingProgressMessage(closeError) || isPairingProgressMessage(reason)) {
              setError(null);
              return;
            }
            if (closeError?.message) {
              setError(formatOpenClawConnectionError(closeError));
              return;
            }
            if (code !== 1000 && reason) {
              const formattedReason = formatOpenClawConnectionError(reason);
              setError(formattedReason === reason ? `Disconnected: ${formattedReason}` : formattedReason);
              return;
            }
            setError(null);
          },
        });
        localGateway = client;
        const applyState = (nextState: GatewayConnectionState) => {
          if (!active) return;
          setStatus(nextState);
          if (nextState === "disconnected") {
            connectionHydrationRef.current = null;
            sessionListRefreshRef.current = null;
            chatHistoryRefreshRef.current = null;
            clearGatewayStatusCaches();
            setGateway(null);
            resetSessionStateForDisconnect({ preserveMessages: true });
            return;
          }
          if (nextState === "connecting") {
            connectionHydrationRef.current = null;
            sessionListRefreshRef.current = null;
            chatHistoryRefreshRef.current = null;
            clearGatewayStatusCaches();
            abortingTargetRef.current = null;
            activeChatSendTargetsRef.current.clear();
            activeChatStreamsRef.current.clear();
            abortRequestedTargetsRef.current.clear();
            sendingTargetsRef.current.clear();
            publishSendingTargets();
            setGateway(null);
            setHydrating(false);
            setReady(false);
            setAbortingTarget(null);
            setAborting(false);
            return;
          }
          if (nextState === "connected") {
            setGateway(client);
            setError(null);
          }
        };
        applyState(client.state);
        unsubscribeConnectionState = client.onConnectionState(applyState);
        void client.connect().catch((e: unknown) => {
          if (!active) return;
          setGateway(null);
          setStatus("disconnected");
          resetSessionStateForDisconnect({ preserveMessages: true });
          setError(formatOpenClawConnectionError(e));
        });
      } catch (e: unknown) {
        if (!active) return;
        setGateway(null);
        setStatus("disconnected");
        resetSessionStateForDisconnect({ preserveMessages: true });
        setError(formatOpenClawConnectionError(e));
      }
    })();

    return () => {
      active = false;
      unsubscribeConnectionState?.();
      localGateway?.close();
    };
  }, [enabled, agentId, retrySignal, seededE2EConnection, clearGatewayStatusCaches, publishSendingTargets, resetSessionStateForDisconnect]);

  const appendActivity = useCallback((entry: { type: ActivityKind; action: string; detail?: string; id?: string; timestamp?: number }) => {
    setActivityFeed((prev) => appendActivityEntry(prev, entry));
  }, []);

  const setTitledSessions = useCallback((value: OpenClawSessionRecord[] | ((prev: OpenClawSessionRecord[]) => OpenClawSessionRecord[])) => {
    const sessionSnapshot = sessionSnapshotRef.current;
    const canSkipUnchangedWrite = sessionSnapshot.agentId === agentId && sessionSnapshot.fetchedAgentId === agentId;
    setSessionsAgentId(agentId);
    setSessions((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      const reconciledSessions = reconcileSessionsForActiveSession({
        sessions: next,
        activeSessionKey,
        titleMap: sessionTitleMapRef.current,
        creatingSessionKeys: creatingSessionKeysRef.current,
      });
      const titledSessions = applyOpenClawSessionTitleMap(reconciledSessions, sessionTitleMapRef.current);
      if (canSkipUnchangedWrite && sameOpenClawSessionListForDisplay(prev, titledSessions)) {
        return prev;
      }
      writeStoredSessions(agentId, titledSessions);
      return sameOpenClawSessionListForDisplay(prev, titledSessions) ? prev : titledSessions;
    });
  }, [agentId, activeSessionKey]);

  const pruneDeletedSessionTombstones = useCallback(() => {
    const now = Date.now();
    setDeletedSessionKeys((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([, expiresAt]) => expiresAt > now));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, []);

  const updateSessionTitleMap = useCallback((update: (current: Record<string, string>) => Record<string, string>) => {
    const nextTitleMap = update(sessionTitleMapRef.current);
    sessionTitleMapRef.current = nextTitleMap;
    writeStoredSessionTitles(agentId, nextTitleMap);
    return nextTitleMap;
  }, [agentId]);

  const setSessionTitleOverride = useCallback((sessionKey: string, title: string) => {
    updateSessionTitleMap((current) => {
      const next = { ...current };
      for (const key of openClawSessionTitleMapKeys(sessionKey)) next[key] = title;
      return next;
    });
  }, [updateSessionTitleMap]);

  const removeSessionTitleOverride = useCallback((sessionKey: string) => {
    updateSessionTitleMap((current) => {
      const next = { ...current };
      for (const key of openClawSessionTitleMapKeys(sessionKey)) delete next[key];
      return next;
    });
  }, [updateSessionTitleMap]);

  const applyFetchedSessions = useCallback((nextSessions: OpenClawSessionRecord[]) => {
    pruneDeletedSessionTombstones();
    setTitledSessions(nextSessions);
    setSessionsFetchedAgentId(agentId);
    return nextSessions;
  }, [agentId, pruneDeletedSessionTombstones, setTitledSessions]);

  const fetchSessionList = useCallback((targetGateway: GatewayClient): Promise<OpenClawSessionRecord[]> => {
    const current = sessionListRefreshRef.current;
    if (current && current.gateway === targetGateway && current.agentId === agentId) return current.promise;

    const promise = listOpenClawSessions(targetGateway);
    const entry: SessionListRefreshEntry = { gateway: targetGateway, agentId, promise };
    sessionListRefreshRef.current = entry;
    void promise.then(
      () => {
        if (sessionListRefreshRef.current === entry) sessionListRefreshRef.current = null;
      },
      () => {
        if (sessionListRefreshRef.current === entry) sessionListRefreshRef.current = null;
      },
    );
    return promise;
  }, [agentId]);

  const refreshSessionList = useCallback(async (targetGateway: GatewayClient | null = gateway) => {
    if (!targetGateway) return undefined;
    try {
      return applyFetchedSessions(await fetchSessionList(targetGateway));
    } catch {
      return undefined;
    }
  }, [gateway, applyFetchedSessions, fetchSessionList]);

  const activeSessionRecords = useMemo(
    () => sessionsAgentId === agentId ? sessions : [],
    [agentId, sessions, sessionsAgentId],
  );
  const activeSessionRecord = findOpenClawSelectableSession(activeSessionRecords, activeSessionKey)
    ?? (shouldReconcileGeneratedSessionsAsMain(activeSessionRecords, activeSessionKey)
      ? findOpenClawSelectableSession(activeSessionRecords, OPENCLAW_DEFAULT_SESSION_KEY)
      : null);
  const activeGatewaySessionKey = openClawGatewaySessionKey(activeSessionRecord) ?? activeSessionKey;
  const activeSessionReadOnly = Boolean(activeSessionRecord?.readOnly);
  const activeSessionReadOnlyReason = activeSessionRecord?.readOnlyReason ?? null;
  const activeSessionTarget = { agentId, sessionKey: activeSessionKey };
  const activeSessionSending = sendingTargets.some((target) => sameChatHistoryTarget(target, activeSessionTarget));
  const activeSessionAborting = Boolean(aborting && abortingTarget && sameChatHistoryTarget(abortingTarget, activeSessionTarget));

  const resolveChatTargetState = useCallback((target: ChatHistoryTarget) => {
    const targetSessionRecord = target.agentId === agentId
      ? findOpenClawSelectableSession(activeSessionRecords, target.sessionKey)
        ?? (shouldReconcileGeneratedSessionsAsMain(activeSessionRecords, target.sessionKey)
          ? findOpenClawSelectableSession(activeSessionRecords, OPENCLAW_DEFAULT_SESSION_KEY)
          : null)
      : null;
    const visibleSessionKey = shouldReconcileGeneratedSessionsAsMain(activeSessionRecords, target.sessionKey)
      ? OPENCLAW_DEFAULT_SESSION_KEY
      : target.sessionKey;
    return {
      gatewaySessionKey: openClawGatewaySessionKey(targetSessionRecord) ?? target.sessionKey,
      readOnly: Boolean(targetSessionRecord?.readOnly),
      visibleSessionKey,
    };
  }, [activeSessionRecords, agentId]);

  useLayoutEffect(() => {
    const target = { agentId, sessionKey: activeSessionKey };
    if (cacheRestoreTargetRef.current && sameChatHistoryTarget(cacheRestoreTargetRef.current, target)) return;
    cacheRestoreTargetRef.current = target;
    if (activeSessionReadOnly) {
      dispatchChatHistory({ type: "clear" }, target);
      return;
    }
    const liveMessages = liveChatHistoryByTargetRef.current.get(chatHistoryTargetKey(target));
    const restoredMessages = liveMessages ?? readCachedOpenClawChatHistory(agentId, activeSessionKey);
    dispatchChatHistory({ type: "restore-cache", messages: restoredMessages }, target);
  }, [agentId, activeSessionKey, activeSessionReadOnly, dispatchChatHistory]);

  useEffect(() => {
    if (activeSessionReadOnly || !agentId || messages.length === 0 || typeof window === "undefined") return;
    const timeout = window.setTimeout(() => {
      writeCachedOpenClawChatHistory(agentId, messages, activeSessionKey);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [agentId, activeSessionKey, activeSessionReadOnly, messages]);

  const markCurrentReplyInterrupted = useCallback(() => {
    dispatchChatHistory({ type: "mark-interrupted" });
  }, [dispatchChatHistory]);

  const refreshMessagesFromHistory = useCallback(async (
    targetGateway: GatewayClient | null = gateway,
    targetOverride?: ChatHistoryTarget,
  ) => {
    if (!targetGateway) return;
    const refreshTarget = targetOverride ?? { agentId, sessionKey: activeSessionKey };
    if (refreshTarget.agentId !== agentId) return;
    const targetState = resolveChatTargetState(refreshTarget);
    const current = chatHistoryRefreshRef.current;
    if (
      current &&
      current.gateway === targetGateway &&
      current.agentId === refreshTarget.agentId &&
      current.activeSessionKey === refreshTarget.sessionKey &&
      current.activeGatewaySessionKey === targetState.gatewaySessionKey
    ) {
      return current.promise;
    }

    const promise = refreshOpenClawChatMessages(targetGateway, refreshTarget.agentId, refreshTarget.sessionKey, targetState.gatewaySessionKey)
      .then((historyMessages) => {
        dispatchChatHistory({ type: "merge-history-refresh", messages: historyMessages }, refreshTarget);
      });
    const entry: ChatHistoryRefreshEntry = {
      gateway: targetGateway,
      agentId: refreshTarget.agentId,
      activeSessionKey: refreshTarget.sessionKey,
      activeGatewaySessionKey: targetState.gatewaySessionKey,
      promise,
    };
    chatHistoryRefreshRef.current = entry;
    void promise.finally(() => {
      if (chatHistoryRefreshRef.current === entry) chatHistoryRefreshRef.current = null;
    });
    return promise;
  }, [gateway, agentId, activeSessionKey, dispatchChatHistory, resolveChatTargetState]);

  const finishCreatingSession = useCallback((sessionKey: string) => {
    creatingSessionKeysRef.current.delete(sessionKey);
    setCreatingSessionKeys((prev) => prev.filter((key) => key !== sessionKey));
  }, []);

  useEffect(() => {
    if (!gateway) return;
    const target = { agentId, sessionKey: activeSessionKey };
    const targetKey = chatHistoryTargetKey(target);
    let passiveCompletionRefreshTimer: number | null = null;
    let passiveCompletionRefreshHistory = false;
    let passiveCompletionRefreshSessions = false;
    const flushPassiveCompletionRefresh = () => {
      passiveCompletionRefreshTimer = null;
      const shouldRefreshHistory = passiveCompletionRefreshHistory;
      const shouldRefreshSessions = passiveCompletionRefreshSessions;
      passiveCompletionRefreshHistory = false;
      passiveCompletionRefreshSessions = false;
      if (shouldRefreshHistory) void refreshMessagesFromHistory(gateway).catch(() => {});
      if (shouldRefreshSessions) void refreshSessionList(gateway).catch(() => {});
    };
    const queuePassiveCompletionRefresh = ({ history = false, sessions = false }: { history?: boolean; sessions?: boolean }) => {
      passiveCompletionRefreshHistory ||= history;
      passiveCompletionRefreshSessions ||= sessions;
      if (passiveCompletionRefreshTimer !== null) return;
      passiveCompletionRefreshTimer = window.setTimeout(
        flushPassiveCompletionRefresh,
        OPENCLAW_PASSIVE_COMPLETION_REFRESH_DEBOUNCE_MS,
      );
    };
    const unsubscribe = gateway.onEvent((gatewayEvent) => {
      const eventMatchesActiveSession = openClawEventMatchesSession(gatewayEvent.payload, activeSessionKey);
      handleOpenClawSessionEvent({
        gatewayEvent,
        setMessages: (update) => dispatchChatHistory({ type: "apply-update", update }, target),
        setSending: (value) => setSendingForTarget(target, value),
        setSessions: applyFetchedSessions,
        refreshSessions: () => queuePassiveCompletionRefresh({ sessions: true }),
        appendActivity,
        activeSessionKey,
        suppressChatStreamEvents: activeChatSendTargetsRef.current.has(targetKey),
      });
      const payload = gatewayEvent.payload ?? {};
      const payloadRecord = payload as Record<string, unknown>;
      const lifecycleData = payloadRecord.data as Record<string, unknown> | undefined;
      const isAgentLifecycleEnd = gatewayEvent.event === "agent" &&
        String(payloadRecord.stream || "").toLowerCase() === "lifecycle" &&
        String(lifecycleData?.phase || "").toLowerCase() === "end";
      const isPassiveCompletion = !activeChatSendTargetsRef.current.has(targetKey) && eventMatchesActiveSession && (
        gatewayEvent.event === "chat.done" ||
        (gatewayEvent.event === "chat" && payloadRecord.state === "final") ||
        isAgentLifecycleEnd
      );
      if (isPassiveCompletion && fullHydrationEnabled) queuePassiveCompletionRefresh({ history: true });
    });
    return () => {
      if (passiveCompletionRefreshTimer !== null) window.clearTimeout(passiveCompletionRefreshTimer);
      unsubscribe();
    };
  }, [gateway, agentId, activeSessionKey, appendActivity, applyFetchedSessions, dispatchChatHistory, fullHydrationEnabled, refreshMessagesFromHistory, refreshSessionList, setSendingForTarget]);

  useEffect(() => {
    if (!gateway || status !== "connected") return;
    if (creatingSessionKeysRef.current.has(activeSessionKey)) {
      setReady(fullHydrationEnabled);
      setHydrating(false);
      if (fullHydrationEnabled) dispatchChatHistory({ type: "clear" }, { agentId, sessionKey: activeSessionKey });
      return;
    }
    let cancelled = false;
    const target = { agentId, sessionKey: activeSessionKey };
    const targetKey = chatHistoryTargetKey(target);
    type SessionListResult =
      | { status: "fulfilled"; sessions: OpenClawSessionRecord[] }
      | { status: "rejected" };

    const reconnectRefreshRequest = reconnectSessionRefreshRef.current;
    const shouldRefreshSessionsAfterReconnect = Boolean(reconnectRefreshRequest);
    const readSessionHydration = () => {
      const sessionSnapshot = sessionSnapshotRef.current;
      return {
        sessions: sessionSnapshot.agentId === agentId ? sessionSnapshot.sessions : [],
        fetched: sessionSnapshot.fetchedAgentId === agentId,
      };
    };
    const sessionHydrationHasActiveSession = (value: ReturnType<typeof readSessionHydration>) => value.fetched && (
      unscopedOpenClawSessionKey(activeSessionKey) === OPENCLAW_DEFAULT_SESSION_KEY ||
      Boolean(findOpenClawSelectableSession(value.sessions, activeSessionKey))
    );
    const sessionListNeededForHydration = (value: ReturnType<typeof readSessionHydration>) => (
      !value.fetched || !sessionHydrationHasActiveSession(value)
    );
    const initialSessionHydration = readSessionHydration();
    const currentConnectionHydration = connectionHydrationRef.current;
    const keepSessionSwitchReady = fullHydrationEnabled &&
      currentConnectionHydration?.gateway === gateway &&
      currentConnectionHydration.agentId === agentId &&
      Boolean(currentConnectionHydration.value) &&
      sessionHydrationHasActiveSession(initialSessionHydration) &&
      !shouldRefreshSessionsAfterReconnect;
    setReady(keepSessionSwitchReady);
    setHydrating(!keepSessionSwitchReady);
    void (async () => {
      let sessionHydration = initialSessionHydration;
      let needsSessionListForHydration = sessionListNeededForHydration(sessionHydration);
      let shouldFetchSessionList = shouldRefreshSessionsAfterReconnect || needsSessionListForHydration;
      let sessionListResult: Promise<SessionListResult> | null = null;
      const getSessionListResult = () => {
        sessionListResult ??= fetchSessionList(gateway)
          .then((nextSessions): SessionListResult => ({ status: "fulfilled", sessions: nextSessions }))
          .catch((): SessionListResult => ({ status: "rejected" }));
        return sessionListResult;
      };

      if (needsSessionListForHydration) void getSessionListResult();

      try {
        if (!fullHydrationEnabled) {
          sessionHydration = readSessionHydration();
          needsSessionListForHydration = sessionListNeededForHydration(sessionHydration);
          shouldFetchSessionList = shouldRefreshSessionsAfterReconnect || needsSessionListForHydration;
          if (shouldFetchSessionList) void getSessionListResult();

          if (shouldFetchSessionList) {
            const initialSessionListResult = await getSessionListResult();
            if (cancelled) return;
            if (initialSessionListResult.status === "fulfilled") {
              completeReconnectSessionRefresh(reconnectRefreshRequest, applyFetchedSessions(initialSessionListResult.sessions));
            } else {
              completeReconnectSessionRefresh(reconnectRefreshRequest, undefined);
            }
          }
          setReady(false);
          return;
        }

        const connectionHydration = await hydrateConnectionForGateway(gateway);
        if (cancelled) return;
        sessionHydration = readSessionHydration();
        needsSessionListForHydration = sessionListNeededForHydration(sessionHydration);
        shouldFetchSessionList = shouldRefreshSessionsAfterReconnect || needsSessionListForHydration;
        if (needsSessionListForHydration) void getSessionListResult();
        if (!sessionHydration.fetched && unscopedOpenClawSessionKey(activeSessionKey) === OPENCLAW_DEFAULT_SESSION_KEY) {
          const initialSessionListResult = await getSessionListResult();
          if (cancelled) return;
          if (initialSessionListResult.status === "fulfilled") {
            sessionHydration = { sessions: initialSessionListResult.sessions, fetched: true };
          }
        }
        if (cancelled) return;
        const hydrated = await hydrateOpenClawSession(gateway, agentId, activeSessionKey, connectionHydration, sessionHydration);
        if (cancelled) return;
        setConfig(hydrated.config);
        setConfigSchema(hydrated.configSchema);
        if (!activeChatSendTargetsRef.current.has(targetKey)) {
          const liveMessages = liveChatHistoryByTargetRef.current.get(chatHistoryTargetKey(target));
          const hydratedMessages = hydrated.messages.length > 0
            ? hydrated.messages
            : liveMessages && liveMessages.length > 0
              ? liveMessages
              : hydrated.useLocalCacheFallback
                ? readCachedOpenClawChatHistory(agentId, activeSessionKey)
                : [];
          dispatchChatHistory({ type: "replace", messages: hydratedMessages }, target);
        }
        setFiles(hydrated.files);
        setGwAgentId(hydrated.gwAgentId);
        setCronJobs(hydrated.cronJobs);
        setModels(hydrated.models);
        setReady(true);
        if (!shouldFetchSessionList) return;
        void (async () => {
          let nextSessions: OpenClawSessionRecord[] | null = null;
          const initialSessionListResult = await getSessionListResult();
          if (cancelled) return;
          if (initialSessionListResult.status === "fulfilled") {
            nextSessions = applyFetchedSessions(initialSessionListResult.sessions);
          }
          completeReconnectSessionRefresh(reconnectRefreshRequest, nextSessions ?? undefined);
          if (!nextSessions || activeChatSendTargetsRef.current.has(targetKey)) return;
          const refreshedGatewaySessionKey = resolveOpenClawGatewaySessionKey(nextSessions, activeSessionKey);
          if (refreshedGatewaySessionKey === hydrated.gatewaySessionKey) return;
          const refreshedMessages = await refreshOpenClawChatMessages(gateway, agentId, activeSessionKey, refreshedGatewaySessionKey);
          if (!cancelled) dispatchChatHistory({ type: "merge-history-refresh", messages: refreshedMessages }, target);
        })();
      } catch (e: unknown) {
        if (cancelled) return;
        completeReconnectSessionRefresh(reconnectRefreshRequest, undefined);
        setReady(false);
        setError(formatOpenClawConnectionError(e));
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateway, status, agentId, activeSessionKey, applyFetchedSessions, completeReconnectSessionRefresh, dispatchChatHistory, fetchSessionList, fullHydrationEnabled, hydrateConnectionForGateway, setTitledSessions]);

  useEffect(() => {
    if (status !== "disconnected") return;
    if (enabled && agentId) return;
    resetSessionStateForDisconnect({ preserveMessages: true });
  }, [status, enabled, agentId, resetSessionStateForDisconnect]);

  const addPendingMessage = useCallback((message: string) => {
    const target = activeComposerTargetRef.current;
    setPendingMessages((prev) => [...prev, { message, target }]);
  }, []);

  const addAttachments = useCallback((files: FileList) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const target = activeComposerTargetRef.current;

    updateComposerDraftForTarget(target, (draft) => ({
      ...draft,
      pendingAttachmentReads: draft.pendingAttachmentReads + imageFiles.length,
    }));

    imageFiles.forEach((file) => {
      const reader = new FileReader();
      let finished = false;
      const finishRead = () => {
        if (finished) return;
        finished = true;
        updateComposerDraftForTarget(target, (draft) => ({
          ...draft,
          pendingAttachmentReads: Math.max(0, draft.pendingAttachmentReads - 1),
        }));
      };
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const base64 = result.split(",")[1];
        if (!base64) return;
        updateComposerDraftForTarget(target, (draft) => ({
          ...draft,
          pendingAttachments: [...draft.pendingAttachments, { type: "image", mimeType: file.type, content: base64, fileName: file.name }],
        }));
      };
      reader.onerror = finishRead;
      reader.onabort = finishRead;
      reader.onloadend = finishRead;
      try {
        reader.readAsDataURL(file);
      } catch {
        finishRead();
      }
    });
  }, [updateComposerDraftForTarget]);

  const addPendingFiles = useCallback((files: ChatPendingFile[]) => {
    const target = activeComposerTargetRef.current;
    updateComposerDraftForTarget(target, (draft) => ({
      ...draft,
      pendingFiles: [...draft.pendingFiles, ...files],
    }));
  }, [updateComposerDraftForTarget]);

  const removeAttachment = useCallback((index: number) => {
    const target = activeComposerTargetRef.current;
    updateComposerDraftForTarget(target, (draft) => {
      const attachment = draft.pendingAttachments[index];
      let nextPendingFiles = draft.pendingFiles;
      if (attachment?.fileName) {
        const fileIndex = nextPendingFiles.findIndex((file) => file.type.startsWith("image/") && file.name === attachment.fileName);
        if (fileIndex !== -1) nextPendingFiles = nextPendingFiles.filter((_, i) => i !== fileIndex);
      }
      return {
        ...draft,
        pendingAttachments: draft.pendingAttachments.filter((_, i) => i !== index),
        pendingFiles: nextPendingFiles,
      };
    });
  }, [updateComposerDraftForTarget]);

  const removePendingFile = useCallback((index: number) => {
    const target = activeComposerTargetRef.current;
    updateComposerDraftForTarget(target, (draft) => {
      const file = draft.pendingFiles[index];
      let nextPendingAttachments = draft.pendingAttachments;
      if (file?.type.startsWith("image/")) {
        const attachmentIndex = nextPendingAttachments.findIndex((attachment) => attachment.fileName === file.name);
        if (attachmentIndex !== -1) nextPendingAttachments = nextPendingAttachments.filter((_, i) => i !== attachmentIndex);
      }
      return {
        ...draft,
        pendingAttachments: nextPendingAttachments,
        pendingFiles: draft.pendingFiles.filter((_, i) => i !== index),
      };
    });
  }, [updateComposerDraftForTarget]);

  const sendMessage = useCallback(async (
    overrideInput?: string,
    options: SendMessageOptions = {},
    targetOverride?: ChatHistoryTarget,
  ) => {
    if (!gateway || !ready) throw new Error("Chat is not ready");
    const target = targetOverride ?? { agentId, sessionKey: activeSessionKey };
    if (target.agentId !== agentId) return;
    const targetKey = chatHistoryTargetKey(target);
    const targetState = resolveChatTargetState(target);
    if (targetState.readOnly) return;
    const targetDraft = readComposerDraftForTarget(target);
    const nextInput = typeof overrideInput === "string" ? overrideInput : targetDraft.input;
    const nextAttachments = typeof overrideInput === "string" ? [] : targetDraft.pendingAttachments;
    const nextFiles = options.files ?? (typeof overrideInput === "string" ? [] : targetDraft.pendingFiles);
    const readingAttachments = typeof overrideInput !== "string" && targetDraft.pendingAttachmentReads > 0;
    if ((!nextInput.trim() && nextAttachments.length === 0 && nextFiles.length === 0) || sendingTargetsRef.current.has(targetKey) || readingAttachments) return;

    const msg = (options.displayContent ?? nextInput).trim();
    const agentInput = nextInput.trim();
    const attachments = [...nextAttachments];
    const files = [...nextFiles];
    const hiddenFileHeader = files.map((file) => `file: ${file.path}`).join("\n");
    const agentMessage = hiddenFileHeader ? (agentInput ? `${hiddenFileHeader}\n\n${agentInput}` : `${hiddenFileHeader}\n\n`) : agentInput;
    updateComposerDraftForTarget(target, (draft) => ({
      ...draft,
      input: "",
      pendingAttachments: [],
      pendingAttachmentReads: 0,
      pendingFiles: [],
    }));
    clearAbortingForTarget(null);
    abortRequestedTargetsRef.current.delete(targetKey);
    markSendingForTarget(target);

    const messageTimestamp = Date.now();
    const userMsg: ChatMessage = { role: "user", content: msg, timestamp: messageTimestamp };
    if (attachments.length > 0) userMsg.attachments = attachments;
    if (files.length > 0) userMsg.files = files;
    dispatchChatHistory({ type: "append-user-message", message: userMsg }, target);

    const preview = msg.slice(0, 80);
    appendActivity({ type: "message", action: "User message sent", detail: preview + (attachments.length > 0 ? ` · ${attachments.length} image${attachments.length === 1 ? "" : "s"}` : "") });
    setTitledSessions((prev) => {
      const existing = prev.find((session) => sameOpenClawSelectableSessionKey(session.key, targetState.visibleSessionKey));
      const touchedSession = {
        ...(existing ?? localOpenClawSessionRecord(targetState.visibleSessionKey)),
        lastMessageAt: messageTimestamp,
        messageCount: existing ? existing.messageCount + 1 : 1,
      };
      return [
        touchedSession,
        ...prev.filter((session) => !sameOpenClawSelectableSessionKey(session.key, targetState.visibleSessionKey)),
      ];
    });

    let handledByChatSend = false;
    let chatSendCompleted = false;
    try {
      const sessionKey = targetState.gatewaySessionKey;
      const messageToSend = agentMessage || "What's in this image?";
      const attachmentsToSend = attachments.length > 0 ? attachments : undefined;
      if (typeof gateway.chatSend === "function") {
        handledByChatSend = true;
        activeChatSendTargetsRef.current.add(targetKey);
        const chatStream = streamOpenClawChat(gateway, messageToSend, sessionKey, attachmentsToSend);
        activeChatStreamsRef.current.set(targetKey, chatStream);
        for await (const chatEvent of chatStream) {
          if (abortRequestedTargetsRef.current.has(targetKey)) continue;
          handleOpenClawChatStreamEvent({
            chatEvent,
            setMessages: (update) => dispatchChatHistory({ type: "apply-update", update }, target),
            setSending: (value) => setSendingForTarget(target, value),
            appendActivity,
          });
        }
        chatSendCompleted = true;
      } else {
        await sendOpenClawChatFallback(gateway, messageToSend, sessionKey, attachmentsToSend);
      }
    } catch (e: unknown) {
      const errMsg = formatOpenClawConnectionError(e);
      if (!abortRequestedTargetsRef.current.has(targetKey)) {
        dispatchChatHistory({ type: "append-system-message", content: `Error: ${errMsg}` }, target);
        appendActivity({ type: "error", action: "Send failed", detail: errMsg });
      }
      clearSendingForTarget(target);
    } finally {
      activeChatStreamsRef.current.delete(targetKey);
      activeChatSendTargetsRef.current.delete(targetKey);
      abortRequestedTargetsRef.current.delete(targetKey);
      clearAbortingForTarget(target);
      if (handledByChatSend) {
        clearSendingForTarget(target);
      }
      if (handledByChatSend && chatSendCompleted) {
        await refreshMessagesFromHistory(gateway, target);
        await refreshSessionList(gateway);
      }
    }
  }, [gateway, ready, agentId, activeSessionKey, appendActivity, clearAbortingForTarget, clearSendingForTarget, dispatchChatHistory, markSendingForTarget, readComposerDraftForTarget, refreshMessagesFromHistory, refreshSessionList, resolveChatTargetState, setSendingForTarget, setTitledSessions, updateComposerDraftForTarget]);

  const abortMessage = useCallback(async () => {
    const target = { agentId, sessionKey: activeSessionKey };
    const targetKey = chatHistoryTargetKey(target);
    if (!gateway || !ready || !sendingTargetsRef.current.has(targetKey) || abortRequestedTargetsRef.current.has(targetKey) || typeof gateway.chatAbort !== "function") return;
    abortRequestedTargetsRef.current.add(targetKey);
    markAbortingForTarget(target);
    try {
      await gateway.chatAbort(activeGatewaySessionKey);
      void activeChatStreamsRef.current.get(targetKey)?.return(undefined).catch(() => undefined);
      markCurrentReplyInterrupted();
      clearSendingForTarget(target);
      clearAbortingForTarget(target);
      appendActivity({ type: "system", action: "Assistant reply stopped" });
    } catch (e: unknown) {
      abortRequestedTargetsRef.current.delete(targetKey);
      clearAbortingForTarget(target);
      appendActivity({ type: "error", action: "Stop failed", detail: formatOpenClawConnectionError(e) });
    }
  }, [gateway, ready, agentId, activeSessionKey, activeGatewaySessionKey, markAbortingForTarget, markCurrentReplyInterrupted, clearSendingForTarget, clearAbortingForTarget, appendActivity]);

  useEffect(() => {
    if (!ready) return;
    const nextMessageIndex = pendingMessages.findIndex((message) => (
      message.target.agentId === agentId && !sendingTargetsRef.current.has(chatHistoryTargetKey(message.target))
    ));
    if (nextMessageIndex !== -1) {
      const nextMessage = pendingMessages[nextMessageIndex];
      setPendingMessages((prev) => prev.filter((_, index) => index !== nextMessageIndex));
      if (nextMessage) void sendMessage(nextMessage.message, {}, nextMessage.target);
    }
  }, [ready, pendingMessages, sendMessage, agentId, sendingTargets]);

  const openFile = useCallback(async (name: string): Promise<string> => {
    if (!gateway) throw new Error("Not connected");
    const content = await gateway.fileGet(gwAgentId, name);
    appendActivity({ type: "tool", action: "file_read", detail: name });
    return content;
  }, [gateway, gwAgentId, appendActivity]);

  const saveFile = useCallback(async (name: string, content: string) => {
    if (!gateway) throw new Error("Not connected");
    await gateway.fileSet(gwAgentId, name, content);
    connectionHydrationRef.current = null;
    appendActivity({ type: "tool", action: "file_write", detail: `${name} · ${content.length.toLocaleString()} chars` });
  }, [gateway, gwAgentId, appendActivity]);

  const saveConfig = useCallback(async (patch: Record<string, unknown>) => {
    if (!gateway) throw new Error("Not connected");
    await gateway.configPatch(patch);
    clearGatewayStatusCaches();
    setConfig((current) => mergeOpenClawConfigPatch(current, patch));
    updateConnectionHydration((connection) => {
      connection.config = mergeOpenClawConfigPatch(connection.config, patch);
    });
    const keys = Object.keys(patch);
    appendActivity({ type: "system", action: "Config updated", detail: keys.length > 0 ? keys.slice(0, 3).join(", ") + (keys.length > 3 ? `, +${keys.length - 3}` : "") : "" });
  }, [gateway, appendActivity, clearGatewayStatusCaches, updateConnectionHydration]);

  const saveFullConfig = useCallback(async (nextConfig: Record<string, unknown>) => {
    if (!gateway) throw new Error("Not connected");
    await gateway.configSet(nextConfig);
    clearGatewayStatusCaches();
    setConfig(nextConfig);
    updateConnectionHydration((connection) => {
      connection.config = nextConfig;
    });
    appendActivity({ type: "system", action: "openclaw.json updated", detail: "Saved full OpenClaw config" });
  }, [gateway, appendActivity, clearGatewayStatusCaches, updateConnectionHydration]);

  const channelsStatus = useCallback(async (probe = false, timeoutMs?: number) => {
    if (!gateway) throw new Error("Not connected");
    if (probe || timeoutMs !== undefined) return gateway.channelsStatus(probe, timeoutMs);
    const now = Date.now();
    const cached = channelsStatusCacheRef.current;
    if (cached && cached.expiresAt > now) return cached.promise;
    const promise = gateway.channelsStatus(false) as Promise<Record<string, unknown>>;
    channelsStatusCacheRef.current = { expiresAt: now + GATEWAY_STATUS_CACHE_TTL_MS, promise };
    void promise.catch(() => {
      if (channelsStatusCacheRef.current?.promise === promise) channelsStatusCacheRef.current = null;
    });
    return promise;
  }, [gateway]);

  const refreshSessions = useCallback(async () => {
    return refreshSessionList();
  }, [refreshSessionList]);

  const createSession = useCallback(async () => {
    if (!gateway) throw new Error("Not connected");
    if (sending) throw new Error("Wait for the current reply to finish.");
    if (sessionsFetchedAgentId !== agentId) throw new Error("Sessions are still loading.");

    const sessionKey = createOpenClawSessionKey(sessions);
    clearCachedOpenClawChatHistory(agentId, sessionKey);
    setSessionTitleOverride(sessionKey, OPENCLAW_NEW_SESSION_TITLE);
    creatingSessionKeysRef.current.add(sessionKey);
    setCreatingSessionKeys((prev) => prev.includes(sessionKey) ? prev : [...prev, sessionKey]);
    dispatchChatHistory({ type: "clear" });
    updateComposerDraftForTarget(activeComposerTargetRef.current, () => emptyComposerDraft());
    setPendingMessages([]);
    setDeletedSessionKeys((prev) => {
      if (!(sessionKey in prev)) return prev;
      const next = { ...prev };
      delete next[sessionKey];
      return next;
    });
    setTitledSessions((prev) => [
      newOpenClawSessionRecord(sessionKey),
      ...prev.filter((session) => session.key !== sessionKey),
    ]);
    appendActivity({ type: "system", action: OPENCLAW_NEW_SESSION_TITLE });
    void (async () => {
      try {
        await createOpenClawSession(gateway, sessionKey);
        finishCreatingSession(sessionKey);
        try {
          const nextSessions = await fetchSessionList(gateway);
          const refreshedSessions = nextSessions.some((session) => sameOpenClawSelectableSessionKey(session.key, sessionKey))
            ? nextSessions
            : [newOpenClawSessionRecord(sessionKey), ...nextSessions];
          applyFetchedSessions(refreshedSessions);
        } catch {}
      } catch (e: unknown) {
        finishCreatingSession(sessionKey);
        const errMsg = formatOpenClawConnectionError(e);
        setError(errMsg);
        appendActivity({ type: "error", action: "Session creation failed", detail: errMsg });
      }
    })();
    return sessionKey;
  }, [gateway, sending, sessionsFetchedAgentId, agentId, sessions, applyFetchedSessions, setSessionTitleOverride, setTitledSessions, appendActivity, fetchSessionList, finishCreatingSession, dispatchChatHistory, updateComposerDraftForTarget]);

  const renameSession = useCallback(async (sessionKey: string, title: string) => {
    if (!agentId) throw new Error("Session rename is unavailable.");
    const trimmedTitle = normalizeOpenClawSessionDisplayName(title, sessionKey);
    if (!trimmedTitle) throw new Error("Choose a different session name.");
    setSessionTitleOverride(sessionKey, trimmedTitle);
    setTitledSessions((prev) => prev);
  }, [agentId, setSessionTitleOverride, setTitledSessions]);

  const removeSession = useCallback(async (sessionKey: string) => {
    if (!gateway) throw new Error("Not connected");
    const session = findOpenClawSelectableSession(sessions, sessionKey);
    await deleteOpenClawSession(gateway, openClawGatewaySessionKey(session) ?? sessionKey);
    clearCachedOpenClawChatHistory(agentId, sessionKey);
    const target = { agentId, sessionKey };
    const targetKey = chatHistoryTargetKey(target);
    liveChatHistoryByTargetRef.current.delete(targetKey);
    composerDraftsByTargetRef.current.delete(targetKey);
    setPendingMessages((prev) => prev.filter((item) => !sameChatHistoryTarget(item.target, target)));
    removeSessionTitleOverride(sessionKey);
    setDeletedSessionKeys((prev) => ({
      ...prev,
      [sessionKey]: Date.now() + OPENCLAW_DELETED_SESSION_TOMBSTONE_TTL_MS,
    }));
    setTitledSessions((prev) => prev.filter((session) => !sameOpenClawSelectableSessionKey(session.key, sessionKey)));
    if (sameOpenClawSelectableSessionKey(sessionKey, activeSessionKey)) {
      dispatchChatHistory({ type: "clear" });
      syncActiveComposerDraft(target);
    }
  }, [gateway, agentId, activeSessionKey, sessions, removeSessionTitleOverride, setTitledSessions, dispatchChatHistory, syncActiveComposerDraft]);

  const refreshCron = useCallback(async () => {
    if (!gateway) throw new Error("Not connected");
    const nextCronJobs = await gateway.cronList() as Array<Record<string, unknown>>;
    setCronJobs(nextCronJobs);
    updateConnectionHydration((connection) => {
      connection.cronJobs = nextCronJobs;
    });
  }, [gateway, updateConnectionHydration]);

  const addCron = useCallback(async (job: Record<string, unknown>) => {
    if (!gateway) throw new Error("Not connected");
    await gateway.cronAdd(job);
    await refreshCron();
    const schedule = cronScheduleLabel(job.schedule);
    const name = typeof job.name === "string" ? job.name : (typeof job.description === "string" ? job.description : "");
    appendActivity({ type: "cron", action: "Cron added", detail: [name, schedule].filter(Boolean).join(" · ") });
  }, [gateway, refreshCron, appendActivity]);

  const removeCron = useCallback(async (jobId: string) => {
    if (!gateway) throw new Error("Not connected");
    await gateway.cronRemove(jobId);
    await refreshCron();
    appendActivity({ type: "cron", action: "Cron removed", detail: jobId });
  }, [gateway, refreshCron, appendActivity]);

  const updateCron = useCallback(async (jobId: string, job: Record<string, unknown>) => {
    if (!gateway) throw new Error("Not connected");
    let addedUpdatedJob = false;
    try {
      await gateway.cronAdd(job);
      addedUpdatedJob = true;
      await gateway.cronRemove(jobId);
    } catch (err) {
      if (addedUpdatedJob) {
        await refreshCron().catch(() => undefined);
        throw new Error("Saved the updated schedule, but could not remove the old one. Delete the old schedule manually.");
      }
      throw err;
    }
    await refreshCron();
    const schedule = cronScheduleLabel(job.schedule);
    const name = typeof job.name === "string" ? job.name : (typeof job.description === "string" ? job.description : "");
    appendActivity({ type: "cron", action: "Cron updated", detail: [name, schedule].filter(Boolean).join(" · ") || jobId });
  }, [gateway, refreshCron, appendActivity]);

  const runCron = useCallback(async (jobId: string) => {
    if (!gateway) throw new Error("Not connected");
    const result = await gateway.cronRun(jobId);
    appendActivity({ type: "cron", action: "Cron run", detail: jobId });
    return result;
  }, [gateway, appendActivity]);

  const skillsStatus = useCallback(async (params: GatewaySkillsStatusParams = {}) => {
    if (!gateway) throw new Error("Not connected");
    return gateway.skillsStatus(params);
  }, [gateway]);

  const skillsSearch = useCallback(async (params: GatewaySkillsSearchParams = {}) => {
    if (!gateway) throw new Error("Not connected");
    return gateway.skillsSearch(params);
  }, [gateway]);

  const skillsDetail = useCallback(async (params: GatewaySkillsDetailParams) => {
    if (!gateway) throw new Error("Not connected");
    return gateway.skillsDetail(params);
  }, [gateway]);

  const skillsSecurityVerdicts = useCallback(async (params: GatewaySkillsSecurityVerdictsParams = {}) => {
    if (!gateway) throw new Error("Not connected");
    return gateway.skillsSecurityVerdicts(params);
  }, [gateway]);

  const skillsSkillCard = useCallback(async (params: GatewaySkillsSkillCardParams) => {
    if (!gateway) throw new Error("Not connected");
    return gateway.skillsSkillCard(params);
  }, [gateway]);

  const skillsInstall = useCallback(async (params: GatewaySkillsInstallParams) => {
    if (!gateway) throw new Error("Not connected");
    const result = await gateway.skillsInstall(params);
    const detail = "source" in params && params.source === "clawhub"
      ? params.slug
      : "name" in params
        ? params.name
        : params.slug;
    appendActivity({ type: "skill", action: result.ok ? "Skill installed" : "Skill install failed", detail });
    return result;
  }, [gateway, appendActivity]);

  const skillsUpdate = useCallback(async (params: GatewaySkillsUpdateParams) => {
    if (!gateway) throw new Error("Not connected");
    const result = await gateway.skillsUpdate(params);
    const detail = "skillKey" in params ? params.skillKey : params.slug ?? "all";
    appendActivity({ type: "skill", action: "Skills updated", detail });
    return result;
  }, [gateway, appendActivity]);

  const integrationsAuthStart = useCallback(async (params: GatewayIntegrationAuthStartParams) => {
    if (!gateway) throw new Error("Not connected");
    const result = await gateway.integrationsAuthStart(params);
    clearGatewayStatusCaches();
    appendActivity({ type: "connection", action: "Connection auth started", detail: params.integrationId });
    return result;
  }, [gateway, appendActivity, clearGatewayStatusCaches]);

  const integrationsAuthStatus = useCallback(async (params: GatewayIntegrationAuthStatusParams) => {
    if (!gateway) throw new Error("Not connected");
    return gateway.integrationsAuthStatus(params);
  }, [gateway]);

  const integrationsStatus = useCallback(async (params: GatewayIntegrationStatusParams = {}): Promise<GatewayIntegrationStatusResult> => {
    if (!gateway) throw new Error("Not connected");
    if (params.probe === true) return gateway.integrationsStatus(params);
    const cacheKey = integrationStatusCacheKey(params);
    const now = Date.now();
    const cached = integrationsStatusCacheRef.current.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.promise;
    const promise = gateway.integrationsStatus(params);
    integrationsStatusCacheRef.current.set(cacheKey, { expiresAt: now + GATEWAY_STATUS_CACHE_TTL_MS, promise });
    void promise.catch(() => {
      if (integrationsStatusCacheRef.current.get(cacheKey)?.promise === promise) {
        integrationsStatusCacheRef.current.delete(cacheKey);
      }
    });
    return promise;
  }, [gateway]);

  const integrationsDisconnect = useCallback(async (params: GatewayIntegrationDisconnectParams) => {
    if (!gateway) throw new Error("Not connected");
    const result = await gateway.integrationsDisconnect(params);
    clearGatewayStatusCaches();
    appendActivity({ type: "connection", action: result.ok ? "Connection disconnected" : "Connection disconnect failed", detail: params.integrationId });
    return result;
  }, [gateway, appendActivity, clearGatewayStatusCaches]);

  const connected = seededE2EConnection || (status === "connected" && !hydrating && (fullHydrationEnabled ? ready : true));
  const connecting = seededE2EConnection || Boolean(error)
    ? false
    : status === "connecting" || hydrating || (fullHydrationEnabled && status === "connected" && !ready);
  const activeSessions = activeSessionRecords;
  const sessionsFetched = Boolean(agentId && sessionsFetchedAgentId === agentId);
  const visibleSessions = activeSessions.filter((session) => (
    !Object.keys(deletedSessionKeys).some((deletedKey) => sameOpenClawSelectableSessionKey(session.key, deletedKey))
  ));
  const pendingInput = pendingMessages
    .filter((item) => sameChatHistoryTarget(item.target, activeSessionTarget))
    .map((item) => item.message);

  return {
    gateway,
    status,
    error,
    ready,
    gatewayConnected: seededE2EConnection || status === "connected",
    connected,
    connecting,
    hydrating,
    messages,
    sendMessage,
    abortMessage,
    aborting,
    activeSessionAborting,
    input,
    setInput,
    pendingInput,
    addPendingMessage,
    activeSessionKey,
    activeSessionReadOnly,
    activeSessionReadOnlyReason,
    sending,
    activeSessionSending,
    files,
    config,
    configSchema,
    openFile,
    saveFile,
    saveConfig,
    saveFullConfig,
    channelsStatus,
    pendingFiles,
    pendingAttachments,
    pendingAttachmentReads,
    addPendingFiles,
    addAttachments,
    removePendingFile,
    removeAttachment,
    sessions: visibleSessions,
    sessionsFetched,
    creatingSessionKeys,
    cronJobs,
    models,
    activityFeed,
    createSession,
    refreshSessions,
    renameSession,
    deleteSession: removeSession,
    refreshCron,
    addCron,
    updateCron,
    removeCron,
    runCron,
    skillsStatus,
    skillsSearch,
    skillsDetail,
    skillsSecurityVerdicts,
    skillsSkillCard,
    skillsInstall,
    skillsUpdate,
    integrationsAuthStart,
    integrationsAuthStatus,
    integrationsStatus,
    integrationsDisconnect,
    retry,
    retryAndRefreshSessions,
  };
}
