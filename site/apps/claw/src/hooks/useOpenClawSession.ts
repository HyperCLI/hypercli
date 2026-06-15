"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  appendActivityEntry,
  handleOpenClawChatStreamEvent,
  handleOpenClawSessionEvent,
  hydrateOpenClawSession,
  refreshOpenClawChatMessages,
} from "@/lib/openclaw-session";
import {
  clearCachedOpenClawChatHistory,
  readCachedOpenClawChatHistory,
  writeCachedOpenClawChatHistory,
} from "@/lib/openclaw-chat-history-cache";
import {
  type OpenClawSessionPreviewMap,
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
  loadOpenClawSessionPreviews,
  normalizeOpenClawSessionDisplayName,
  normalizeOpenClawSessions,
  openClawEventMatchesSession,
  openClawGatewaySessionKey,
  openClawSessionTitleMapKeys,
  resolveOpenClawActiveSessionKey,
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
const GATEWAY_CONNECTING_STALL_MS = 30_000;
const GATEWAY_CONNECTING_STALL_MESSAGE =
  "Timed out opening the agent session. The gateway is still reconnecting in the background.";
const GENERIC_OPENCLAW_CONNECTION_ERROR = "Could not connect to the agent session.";
const OPENCLAW_ORIGIN_DENIED_MESSAGE =
  "This agent was opened from another dashboard address. Stop and start it from this page, then retry.";
const OPENCLAW_REPLY_STOPPED_MESSAGE = "Reply stopped";
let fallbackSessionCounter = 0;

interface SendMessageOptions {
  displayContent?: string;
  files?: ChatPendingFile[];
}

const VOICE_NOTE_FILE_NAME = /^(?:voice|audio)-[\w.-]+\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)$/i;

function messageFileName(file: ChatPendingFile): string {
  return file.name || file.path.split("/").filter(Boolean).pop() || "";
}

function isVoiceNoteInstruction(content: string): boolean {
  return /^I recorded a voice message\.\s*Run this command to transcribe it:\s*`?hyper\s+voice\s+transcribe\s+\S+\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)`?\s*$/i.test(
    content.trim(),
  );
}

function voiceNoteMessageKey(message: ChatMessage): string | null {
  if (message.role !== "user") return null;
  const voiceFile = (message.files ?? []).find((file) => VOICE_NOTE_FILE_NAME.test(messageFileName(file)));
  if (!voiceFile) return null;
  const content = message.content.trim();
  if (content && !isVoiceNoteInstruction(content)) return null;
  return messageFileName(voiceFile).toLowerCase();
}

function dedupeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const seenVoiceNotes = new Set<string>();
  return messages.filter((message) => {
    const key = voiceNoteMessageKey(message);
    if (!key) return true;
    if (seenVoiceNotes.has(key)) return false;
    seenVoiceNotes.add(key);
    return true;
  });
}

function mergeCurrentToolCallsIntoHistory(
  historyMessages: ChatMessage[],
  currentMessages: ChatMessage[],
): ChatMessage[] {
  let currentAssistantIndex = -1;
  for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
    const message = currentMessages[index];
    if (message?.role === "assistant" && (message.toolCalls?.length ?? 0) > 0) {
      currentAssistantIndex = index;
      break;
    }
  }
  if (currentAssistantIndex === -1) return historyMessages;

  const currentAssistant = currentMessages[currentAssistantIndex];
  const currentToolCalls = currentAssistant?.toolCalls;
  if (!currentToolCalls?.length) return historyMessages;

  const currentUserCount = currentMessages
    .slice(0, currentAssistantIndex)
    .filter((message) => message.role === "user").length;
  let historyUserCount = 0;
  let historyAssistantIndex = -1;
  for (let index = 0; index < historyMessages.length; index += 1) {
    const message = historyMessages[index];
    if (!message) continue;
    if (message.role === "user") {
      historyUserCount += 1;
      continue;
    }
    if (message.role === "assistant" && historyUserCount === currentUserCount) {
      historyAssistantIndex = index;
    }
  }
  if (historyAssistantIndex === -1) return historyMessages;

  const historyAssistant = historyMessages[historyAssistantIndex];
  if (!historyAssistant) return historyMessages;
  return historyMessages.map((message, index) => (
    index === historyAssistantIndex
      ? {
          ...historyAssistant,
          toolCalls: historyAssistant.toolCalls?.length ? historyAssistant.toolCalls : currentToolCalls,
        }
      : message
  ));
}

function assistantMessageHasVisibleReply(message: ChatMessage): boolean {
  return (
    message.role === "assistant" &&
    (
      message.content.trim().length > 0 ||
      (message.toolCalls?.length ?? 0) > 0 ||
      (message.mediaUrls?.length ?? 0) > 0 ||
      (message.files?.length ?? 0) > 0
    )
  );
}

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
    const raw = window.localStorage.getItem(sessionListStorageKey(agentId));
    const parsed = raw ? JSON.parse(raw) : null;
    const sessions = isRecord(parsed) ? parsed.sessions : parsed;
    return normalizeOpenClawSessions(sessions);
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

function hasLocalProjectIdentity(
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

function reconcileSessionsForActiveProject({
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
    .filter((session) => isGeneratedDirectBrowserSession(session) && !hasLocalProjectIdentity(session, titleMap, creatingSessionKeys));
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
) {
  const agentId = agent?.id ?? null;
  const activeSessionKey = resolveOpenClawActiveSessionKey(agentId, requestedActiveSessionKey);
  const latestAgentRef = useRef(agent);
  const [gateway, setGateway] = useState<GatewayClient | null>(null);
  const [status, setStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydrating, setHydrating] = useState(false);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [pendingInput, setPendingInput] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [configSchema, setConfigSchema] = useState<OpenClawConfigSchemaResponse | null>(null);
  const [gwAgentId, setGwAgentId] = useState("main");
  const [sessions, setSessions] = useState<OpenClawSessionRecord[]>([]);
  const [sessionsAgentId, setSessionsAgentId] = useState<string | null>(null);
  const [sessionsFetchedAgentId, setSessionsFetchedAgentId] = useState<string | null>(null);
  const [sessionPreviews, setSessionPreviews] = useState<OpenClawSessionPreviewMap>({});
  const [creatingSessionKeys, setCreatingSessionKeys] = useState<string[]>([]);
  const [deletedSessionKeys, setDeletedSessionKeys] = useState<Set<string>>(new Set());
  const [cronJobs, setCronJobs] = useState<Array<Record<string, unknown>>>([]);
  const [models, setModels] = useState<Array<Record<string, unknown>>>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEntry[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [pendingAttachmentReads, setPendingAttachmentReads] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<ChatPendingFile[]>([]);
  const [aborting, setAborting] = useState(false);
  const [retrySignal, setRetrySignal] = useState(0);
  const activeChatSendRef = useRef(false);
  const activeChatStreamRef = useRef<AsyncGenerator<ChatEvent> | null>(null);
  const abortRequestedRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const activeSessionKeyRef = useRef(activeSessionKey);
  const sessionTitleMapRef = useRef<Record<string, string>>({});
  const creatingSessionKeysRef = useRef<Set<string>>(new Set());
  const refreshSessionsAfterReconnectRef = useRef(false);
  const seededE2EConnection = hasSeededE2EConnection();

  useEffect(() => {
    latestAgentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!sending) abortRequestedRef.current = false;
  }, [sending]);

  useLayoutEffect(() => {
    activeSessionKeyRef.current = activeSessionKey;
  }, [activeSessionKey]);

  useLayoutEffect(() => {
    const titleMap = readStoredSessionTitles(agentId);
    writeStoredSessionTitles(agentId, titleMap);
    const cachedSessions = applyOpenClawSessionTitleMap(reconcileSessionsForActiveProject({
      sessions: readStoredSessions(agentId),
      activeSessionKey: activeSessionKeyRef.current,
      titleMap,
      creatingSessionKeys: new Set(),
    }), titleMap);
    writeStoredSessions(agentId, cachedSessions);
    setDeletedSessionKeys(new Set());
    setSessions(cachedSessions);
    setSessionsAgentId(agentId);
    setSessionsFetchedAgentId(null);
    setSessionPreviews({});
    creatingSessionKeysRef.current = new Set();
    setCreatingSessionKeys([]);
    sessionTitleMapRef.current = titleMap;
  }, [agentId]);

  const retry = useCallback(() => {
    setRetrySignal((value) => value + 1);
  }, []);

  const retryAndRefreshSessions = useCallback(() => {
    refreshSessionsAfterReconnectRef.current = true;
    setRetrySignal((value) => value + 1);
  }, []);

  const resetSessionStateForDisconnect = useCallback(({ preserveMessages = false }: { preserveMessages?: boolean } = {}) => {
    activeChatSendRef.current = false;
    activeChatStreamRef.current = null;
    abortRequestedRef.current = false;
    setAborting(false);
    setHydrating(false);
    setReady(false);
    if (!preserveMessages) setMessages([]);
    setFiles([]);
    setConfig(null);
    setConfigSchema(null);
    setSending(false);
    setGwAgentId("main");
    setPendingAttachments([]);
    setPendingAttachmentReads(0);
    setPendingFiles([]);
    setSessions([]);
    setSessionsAgentId(null);
    setSessionsFetchedAgentId(null);
    setSessionPreviews({});
    creatingSessionKeysRef.current = new Set();
    setCreatingSessionKeys([]);
    setDeletedSessionKeys(new Set());
    setCronJobs([]);
    setModels([]);
    setActivityFeed([]);
  }, []);

  useEffect(() => {
    const cachedMessages = readCachedOpenClawChatHistory(agentId, activeSessionKey);
    setMessages(dedupeChatMessages(cachedMessages));
  }, [agentId, activeSessionKey]);

  useEffect(() => {
    if (!agentId || messages.length === 0 || typeof window === "undefined") return;
    const timeout = window.setTimeout(() => {
      writeCachedOpenClawChatHistory(agentId, messages, activeSessionKey);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [agentId, activeSessionKey, messages]);

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
            setGateway(null);
            resetSessionStateForDisconnect({ preserveMessages: true });
            return;
          }
          if (nextState === "connecting") {
            setGateway(null);
            setHydrating(false);
            setReady(false);
            setSending(false);
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
  }, [enabled, agentId, retrySignal, seededE2EConnection, resetSessionStateForDisconnect]);

  const appendActivity = useCallback((entry: { type: ActivityKind; action: string; detail?: string; id?: string; timestamp?: number }) => {
    setActivityFeed((prev) => appendActivityEntry(prev, entry));
  }, []);

  const setTitledSessions = useCallback((value: OpenClawSessionRecord[] | ((prev: OpenClawSessionRecord[]) => OpenClawSessionRecord[])) => {
    setSessionsAgentId(agentId);
    setSessions((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      const reconciledSessions = reconcileSessionsForActiveProject({
        sessions: next,
        activeSessionKey,
        titleMap: sessionTitleMapRef.current,
        creatingSessionKeys: creatingSessionKeysRef.current,
      });
      const titledSessions = applyOpenClawSessionTitleMap(reconciledSessions, sessionTitleMapRef.current);
      writeStoredSessions(agentId, titledSessions);
      return titledSessions;
    });
  }, [agentId, activeSessionKey]);

  const activeSessionRecords = sessionsAgentId === agentId ? sessions : [];
  const activeSessionRecord = findOpenClawSelectableSession(activeSessionRecords, activeSessionKey)
    ?? (shouldReconcileGeneratedSessionsAsMain(activeSessionRecords, activeSessionKey)
      ? findOpenClawSelectableSession(activeSessionRecords, OPENCLAW_DEFAULT_SESSION_KEY)
      : null);
  const activeVisibleSessionKey = shouldReconcileGeneratedSessionsAsMain(activeSessionRecords, activeSessionKey)
    ? OPENCLAW_DEFAULT_SESSION_KEY
    : activeSessionKey;
  const activeGatewaySessionKey = openClawGatewaySessionKey(activeSessionRecord) ?? activeSessionKey;
  const activeSessionReadOnly = Boolean(activeSessionRecord?.readOnly);
  const activeSessionReadOnlyReason = activeSessionRecord?.readOnlyReason ?? null;

  const markCurrentReplyInterrupted = useCallback(() => {
    setMessages((prev) => {
      const lastAssistantIndex = (() => {
        for (let index = prev.length - 1; index >= 0; index -= 1) {
          if (prev[index]?.role === "assistant") return index;
          if (prev[index]?.role === "user") return -1;
        }
        return -1;
      })();
      const lastAssistant = lastAssistantIndex >= 0 ? prev[lastAssistantIndex] : null;
      if (lastAssistant && assistantMessageHasVisibleReply(lastAssistant)) {
        return prev.map((message, index) => (
          index === lastAssistantIndex ? { ...message, status: "interrupted" } : message
        ));
      }
      if (prev[prev.length - 1]?.role === "system" && prev[prev.length - 1]?.content === OPENCLAW_REPLY_STOPPED_MESSAGE) {
        return prev;
      }
      return [...prev, { role: "system", content: OPENCLAW_REPLY_STOPPED_MESSAGE, timestamp: Date.now() }];
    });
  }, []);

  const refreshMessagesFromHistory = useCallback(async () => {
    if (!gateway) return;
    const historyMessages = dedupeChatMessages(await refreshOpenClawChatMessages(gateway, agentId, activeSessionKey, activeGatewaySessionKey));
    if (historyMessages.length === 0) return;
    setMessages((currentMessages) => {
      const currentUserCount = currentMessages.filter((message) => message.role === "user").length;
      const historyUserCount = historyMessages.filter((message) => message.role === "user").length;
      if (currentMessages.length > 0 && historyMessages.length < currentMessages.length && historyUserCount < currentUserCount) {
        messagesRef.current = currentMessages;
        return currentMessages;
      }
      const mergedMessages = mergeCurrentToolCallsIntoHistory(historyMessages, currentMessages);
      messagesRef.current = mergedMessages;
      return mergedMessages;
    });
  }, [gateway, agentId, activeSessionKey, activeGatewaySessionKey]);

  const finishCreatingSession = useCallback((sessionKey: string) => {
    creatingSessionKeysRef.current.delete(sessionKey);
    setCreatingSessionKeys((prev) => prev.filter((key) => key !== sessionKey));
  }, []);

  useEffect(() => {
    if (!gateway) return;
    const unsubscribe = gateway.onEvent((gatewayEvent) => {
      const eventMatchesActiveSession = openClawEventMatchesSession(gatewayEvent.payload, activeSessionKey);
      handleOpenClawSessionEvent({
        gateway,
        gatewayEvent,
        setMessages,
        setSending,
        setSessions: setTitledSessions,
        appendActivity,
        activeSessionKey,
        suppressChatStreamEvents: activeChatSendRef.current,
      });
      const payload = gatewayEvent.payload ?? {};
      const payloadRecord = payload as Record<string, unknown>;
      const lifecycleData = payloadRecord.data as Record<string, unknown> | undefined;
      const isAgentLifecycleEnd = gatewayEvent.event === "agent" &&
        String(payloadRecord.stream || "").toLowerCase() === "lifecycle" &&
        String(lifecycleData?.phase || "").toLowerCase() === "end";
      const isPassiveCompletion = !activeChatSendRef.current && eventMatchesActiveSession && (
        gatewayEvent.event === "chat.done" ||
        (gatewayEvent.event === "chat" && payloadRecord.state === "final") ||
        isAgentLifecycleEnd
      );
      if (isPassiveCompletion) void refreshMessagesFromHistory().catch(() => {});
    });
    return unsubscribe;
  }, [gateway, activeSessionKey, appendActivity, refreshMessagesFromHistory, setTitledSessions]);

  useEffect(() => {
    if (!gateway || status !== "connected") return;
    if (creatingSessionKeysRef.current.has(activeSessionKey)) {
      setReady(true);
      setHydrating(false);
      setMessages([]);
      return;
    }
    let cancelled = false;
    setReady(false);
    setHydrating(true);
    void (async () => {
      try {
        const hydrated = await hydrateOpenClawSession(gateway, agentId, activeSessionKey);
        if (cancelled) return;
        setConfig(hydrated.config);
        setConfigSchema(hydrated.configSchema);
        if (!activeChatSendRef.current) {
          setMessages(() => {
            if (hydrated.messages.length > 0) return dedupeChatMessages(hydrated.messages);
            if (!hydrated.useLocalCacheFallback) return [];
            return readCachedOpenClawChatHistory(agentId, activeSessionKey);
          });
        }
        setFiles(hydrated.files);
        setGwAgentId(hydrated.gwAgentId);
        let nextSessionPreviews = hydrated.sessionPreviews;
        const shouldRefreshSessionsAfterReconnect = refreshSessionsAfterReconnectRef.current;
        if (hydrated.sessionsFetched) {
          setTitledSessions(hydrated.sessions);
          setSessionsFetchedAgentId(agentId);
          if (shouldRefreshSessionsAfterReconnect) refreshSessionsAfterReconnectRef.current = false;
        } else if (shouldRefreshSessionsAfterReconnect) {
          try {
            const nextSessions = await listOpenClawSessions(gateway);
            if (cancelled) return;
            setTitledSessions(nextSessions);
            setSessionsFetchedAgentId(agentId);
            nextSessionPreviews = await loadOpenClawSessionPreviews(gateway, nextSessions);
            if (cancelled) return;
          } catch {
          } finally {
            if (!cancelled) refreshSessionsAfterReconnectRef.current = false;
          }
        }
        setSessionPreviews(nextSessionPreviews);
        setCronJobs(hydrated.cronJobs);
        setModels(hydrated.models);
        setReady(true);
      } catch (e: unknown) {
        if (cancelled) return;
        setReady(false);
        setError(formatOpenClawConnectionError(e));
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gateway, status, agentId, activeSessionKey, setTitledSessions]);

  useEffect(() => {
    if (status !== "disconnected") return;
    if (enabled && agentId) return;
    resetSessionStateForDisconnect({ preserveMessages: true });
  }, [status, enabled, agentId, resetSessionStateForDisconnect]);

  useEffect(() => {
    if (!gateway || sessions.length === 0) return;

    let cancelled = false;
    void loadOpenClawSessionPreviews(gateway, sessions).then((previews) => {
      if (!cancelled) setSessionPreviews(previews);
    }).catch(() => {
      if (!cancelled) setSessionPreviews({});
    });
    return () => {
      cancelled = true;
    };
  }, [gateway, sessions]);

  const addPendingMessage = useCallback((message: string) => {
    setPendingInput((prev) => [...prev, message]);
  }, []);

  const addAttachments = useCallback((files: FileList) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    setPendingAttachmentReads((count) => count + imageFiles.length);

    imageFiles.forEach((file) => {
      const reader = new FileReader();
      let finished = false;
      const finishRead = () => {
        if (finished) return;
        finished = true;
        setPendingAttachmentReads((count) => Math.max(0, count - 1));
      };
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const base64 = result.split(",")[1];
        if (!base64) return;
        setPendingAttachments((prev) => [...prev, { type: "image", mimeType: file.type, content: base64, fileName: file.name }]);
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
  }, []);

  const addPendingFiles = useCallback((files: ChatPendingFile[]) => {
    setPendingFiles((prev) => [...prev, ...files]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => {
      const target = prev[index];
      if (target?.fileName) {
        setPendingFiles((currentFiles) => {
          const fileIndex = currentFiles.findIndex((file) => file.type.startsWith("image/") && file.name === target.fileName);
          if (fileIndex === -1) return currentFiles;
          return currentFiles.filter((_, i) => i !== fileIndex);
        });
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const removePendingFile = useCallback((index: number) => {
    setPendingFiles((prev) => {
      const target = prev[index];
      if (target?.type.startsWith("image/")) {
        setPendingAttachments((currentAttachments) => {
          const attachmentIndex = currentAttachments.findIndex((attachment) => attachment.fileName === target.name);
          if (attachmentIndex === -1) return currentAttachments;
          return currentAttachments.filter((_, i) => i !== attachmentIndex);
        });
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const sendMessage = useCallback(async (overrideInput?: string, options: SendMessageOptions = {}) => {
    if (!gateway || !ready) throw new Error("Chat is not ready");
    if (activeSessionReadOnly) return;
    const nextInput = typeof overrideInput === "string" ? overrideInput : input;
    const nextAttachments = typeof overrideInput === "string" ? [] : pendingAttachments;
    const nextFiles = options.files ?? (typeof overrideInput === "string" ? [] : pendingFiles);
    const readingAttachments = typeof overrideInput !== "string" && pendingAttachmentReads > 0;
    if ((!nextInput.trim() && nextAttachments.length === 0 && nextFiles.length === 0) || sending || readingAttachments) return;

    const msg = (options.displayContent ?? nextInput).trim();
    const agentInput = nextInput.trim();
    const attachments = [...nextAttachments];
    const files = [...nextFiles];
    const hiddenFileHeader = files.map((file) => `file: ${file.path}`).join("\n");
    const agentMessage = hiddenFileHeader ? (agentInput ? `${hiddenFileHeader}\n\n${agentInput}` : `${hiddenFileHeader}\n\n`) : agentInput;
    setInput("");
    setPendingAttachments([]);
    setPendingFiles([]);
    setAborting(false);
    abortRequestedRef.current = false;
    setSending(true);

    const messageTimestamp = Date.now();
    const userMsg: ChatMessage = { role: "user", content: msg, timestamp: messageTimestamp };
    if (attachments.length > 0) userMsg.attachments = attachments;
    if (files.length > 0) userMsg.files = files;
    setMessages((prev) => dedupeChatMessages([...prev, userMsg]));

    const preview = msg.slice(0, 80);
    appendActivity({ type: "message", action: "User message sent", detail: preview + (attachments.length > 0 ? ` · ${attachments.length} image${attachments.length === 1 ? "" : "s"}` : "") });
    setSessionPreviews((prev) => ({
      ...prev,
      [activeVisibleSessionKey]: { key: activeVisibleSessionKey, text: preview, role: "user", timestamp: messageTimestamp },
    }));
    setTitledSessions((prev) => {
      const existing = prev.find((session) => sameOpenClawSelectableSessionKey(session.key, activeVisibleSessionKey));
      const touchedSession = {
        ...(existing ?? localOpenClawSessionRecord(activeVisibleSessionKey)),
        lastMessageAt: messageTimestamp,
        messageCount: existing ? existing.messageCount + 1 : 1,
      };
      return [
        touchedSession,
        ...prev.filter((session) => !sameOpenClawSelectableSessionKey(session.key, activeVisibleSessionKey)),
      ];
    });

    let handledByChatSend = false;
    let chatSendCompleted = false;
    try {
      const sessionKey = activeGatewaySessionKey;
      const messageToSend = agentMessage || "What's in this image?";
      const attachmentsToSend = attachments.length > 0 ? attachments : undefined;
      if (typeof gateway.chatSend === "function") {
        handledByChatSend = true;
        activeChatSendRef.current = true;
        const chatStream = streamOpenClawChat(gateway, messageToSend, sessionKey, attachmentsToSend);
        activeChatStreamRef.current = chatStream;
        for await (const chatEvent of chatStream) {
          if (abortRequestedRef.current) continue;
          handleOpenClawChatStreamEvent({
            gateway,
            chatEvent,
            setMessages,
            setSending,
            setSessions: setTitledSessions,
            appendActivity,
          });
        }
        chatSendCompleted = true;
      } else {
        await sendOpenClawChatFallback(gateway, messageToSend, sessionKey, attachmentsToSend);
      }
    } catch (e: unknown) {
      const errMsg = formatOpenClawConnectionError(e);
      if (!abortRequestedRef.current) {
        setMessages((prev) => [...prev, { role: "system", content: `Error: ${errMsg}`, timestamp: Date.now() }]);
        appendActivity({ type: "error", action: "Send failed", detail: errMsg });
      }
      setSending(false);
    } finally {
      activeChatStreamRef.current = null;
      activeChatSendRef.current = false;
      abortRequestedRef.current = false;
      setAborting(false);
      if (handledByChatSend) {
        setSending(false);
      }
      if (handledByChatSend && chatSendCompleted) {
        await refreshMessagesFromHistory();
        try {
          const nextSessions = await listOpenClawSessions(gateway);
          setTitledSessions(nextSessions);
          setSessionsFetchedAgentId(agentId);
          setSessionPreviews(await loadOpenClawSessionPreviews(gateway, nextSessions));
        } catch {}
      }
    }
  }, [gateway, ready, activeSessionReadOnly, input, pendingAttachments, pendingAttachmentReads, pendingFiles, sending, appendActivity, activeGatewaySessionKey, activeVisibleSessionKey, refreshMessagesFromHistory, setTitledSessions, agentId]);

  const abortMessage = useCallback(async () => {
    if (!gateway || !ready || !sending || abortRequestedRef.current || typeof gateway.chatAbort !== "function") return;
    abortRequestedRef.current = true;
    setAborting(true);
    try {
      await gateway.chatAbort(activeGatewaySessionKey);
      void activeChatStreamRef.current?.return(undefined).catch(() => undefined);
      markCurrentReplyInterrupted();
      setSending(false);
      setAborting(false);
      appendActivity({ type: "system", action: "Assistant reply stopped" });
    } catch (e: unknown) {
      abortRequestedRef.current = false;
      setAborting(false);
      appendActivity({ type: "error", action: "Stop failed", detail: formatOpenClawConnectionError(e) });
    }
  }, [gateway, ready, sending, activeGatewaySessionKey, markCurrentReplyInterrupted, appendActivity]);

  useEffect(() => {
    if (!ready) return;
    if (!sending && pendingInput.length > 0) {
      const nextMessage = pendingInput[0];
      setPendingInput((prev) => prev.slice(1));
      void sendMessage(nextMessage);
    }
  }, [ready, sending, pendingInput, sendMessage]);

  const openFile = useCallback(async (name: string): Promise<string> => {
    if (!gateway) throw new Error("Not connected");
    const content = await gateway.fileGet(gwAgentId, name);
    appendActivity({ type: "tool", action: "file_read", detail: name });
    return content;
  }, [gateway, gwAgentId, appendActivity]);

  const saveFile = useCallback(async (name: string, content: string) => {
    if (!gateway) throw new Error("Not connected");
    await gateway.fileSet(gwAgentId, name, content);
    appendActivity({ type: "tool", action: "file_write", detail: `${name} · ${content.length.toLocaleString()} chars` });
  }, [gateway, gwAgentId, appendActivity]);

  const saveConfig = useCallback(async (patch: Record<string, unknown>) => {
    if (!gateway) throw new Error("Not connected");
    await gateway.configPatch(patch);
    try {
      setConfig(await gateway.configGet());
    } catch {}
    const keys = Object.keys(patch);
    appendActivity({ type: "system", action: "Config updated", detail: keys.length > 0 ? keys.slice(0, 3).join(", ") + (keys.length > 3 ? `, +${keys.length - 3}` : "") : "" });
  }, [gateway, appendActivity]);

  const saveFullConfig = useCallback(async (nextConfig: Record<string, unknown>) => {
    if (!gateway) throw new Error("Not connected");
    await gateway.configSet(nextConfig);
    setConfig(nextConfig);
    appendActivity({ type: "system", action: "openclaw.json updated", detail: "Saved full OpenClaw config" });
  }, [gateway, appendActivity]);

  const channelsStatus = useCallback(async (probe = false, timeoutMs?: number) => {
    if (!gateway) throw new Error("Not connected");
    return gateway.channelsStatus(probe, timeoutMs);
  }, [gateway]);

  const refreshSessions = useCallback(async () => {
    if (!gateway) return;
    try {
      const nextSessions = await listOpenClawSessions(gateway);
      setTitledSessions(nextSessions);
      setSessionsFetchedAgentId(agentId);
      setSessionPreviews(await loadOpenClawSessionPreviews(gateway, nextSessions));
      return nextSessions;
    } catch {
      return undefined;
    }
  }, [gateway, setTitledSessions, agentId]);

  const createSession = useCallback(async () => {
    if (!gateway) throw new Error("Not connected");
    if (sending) throw new Error("Wait for the current reply to finish.");
    if (sessionsFetchedAgentId !== agentId) throw new Error("Projects are still loading.");

    const sessionKey = createOpenClawSessionKey(sessions);
    clearCachedOpenClawChatHistory(agentId, sessionKey);
    const nextTitleMap = { ...sessionTitleMapRef.current, [sessionKey]: OPENCLAW_NEW_SESSION_TITLE };
    sessionTitleMapRef.current = nextTitleMap;
    writeStoredSessionTitles(agentId, nextTitleMap);
    creatingSessionKeysRef.current.add(sessionKey);
    setCreatingSessionKeys((prev) => prev.includes(sessionKey) ? prev : [...prev, sessionKey]);
    messagesRef.current = [];
    setMessages([]);
    setInput("");
    setPendingInput([]);
    setPendingAttachments([]);
    setPendingFiles([]);
    setDeletedSessionKeys((prev) => {
      if (!prev.has(sessionKey)) return prev;
      const next = new Set(prev);
      next.delete(sessionKey);
      return next;
    });
    setSessionPreviews((prev) => {
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
          const nextSessions = await listOpenClawSessions(gateway);
          const refreshedSessions = nextSessions.some((session) => sameOpenClawSelectableSessionKey(session.key, sessionKey))
            ? nextSessions
            : [newOpenClawSessionRecord(sessionKey), ...nextSessions];
          setTitledSessions(refreshedSessions);
          setSessionsFetchedAgentId(agentId);
          setSessionPreviews(await loadOpenClawSessionPreviews(gateway, refreshedSessions));
        } catch {}
      } catch (e: unknown) {
        finishCreatingSession(sessionKey);
        const errMsg = formatOpenClawConnectionError(e);
        setError(errMsg);
        appendActivity({ type: "error", action: "Project creation failed", detail: errMsg });
      }
    })();
    return sessionKey;
  }, [gateway, sending, sessionsFetchedAgentId, agentId, sessions, setTitledSessions, appendActivity, finishCreatingSession]);

  const renameSession = useCallback(async (sessionKey: string, title: string) => {
    if (!agentId) throw new Error("Session rename is unavailable.");
    const trimmedTitle = normalizeOpenClawSessionDisplayName(title, sessionKey);
    if (!trimmedTitle) throw new Error("Choose a different project name.");
    const nextTitleMap = { ...sessionTitleMapRef.current, [sessionKey]: trimmedTitle };
    for (const key of openClawSessionTitleMapKeys(sessionKey)) {
      nextTitleMap[key] = trimmedTitle;
    }
    sessionTitleMapRef.current = nextTitleMap;
    writeStoredSessionTitles(agentId, nextTitleMap);
    setSessions((prev) => {
      const next = prev.map((session) => (
        sameOpenClawSelectableSessionKey(session.key, sessionKey)
          ? { ...session, title: trimmedTitle, clientDisplayName: trimmedTitle }
          : session
      ));
      writeStoredSessions(agentId, next);
      return next;
    });
  }, [agentId]);

  const removeSession = useCallback(async (sessionKey: string) => {
    if (!gateway) throw new Error("Not connected");
    const session = findOpenClawSelectableSession(sessions, sessionKey);
    await deleteOpenClawSession(gateway, openClawGatewaySessionKey(session) ?? sessionKey);
    clearCachedOpenClawChatHistory(agentId, sessionKey);
    const nextTitleMap = { ...sessionTitleMapRef.current };
    for (const key of openClawSessionTitleMapKeys(sessionKey)) {
      delete nextTitleMap[key];
    }
    sessionTitleMapRef.current = nextTitleMap;
    writeStoredSessionTitles(agentId, nextTitleMap);
    setDeletedSessionKeys((prev) => new Set(prev).add(sessionKey));
    setSessions((prev) => {
      const next = prev.filter((session) => !sameOpenClawSelectableSessionKey(session.key, sessionKey));
      writeStoredSessions(agentId, next);
      return next;
    });
    setSessionPreviews((prev) => {
      const next = { ...prev };
      delete next[sessionKey];
      return next;
    });
    if (sameOpenClawSelectableSessionKey(sessionKey, activeSessionKey)) {
      messagesRef.current = [];
      setMessages([]);
    }
  }, [gateway, agentId, activeSessionKey, sessions]);

  const refreshCron = useCallback(async () => {
    if (!gateway) throw new Error("Not connected");
    setCronJobs(await gateway.cronList() as Array<Record<string, unknown>>);
  }, [gateway]);

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
    appendActivity({ type: "connection", action: "Connection auth started", detail: params.integrationId });
    return result;
  }, [gateway, appendActivity]);

  const integrationsAuthStatus = useCallback(async (params: GatewayIntegrationAuthStatusParams) => {
    if (!gateway) throw new Error("Not connected");
    return gateway.integrationsAuthStatus(params);
  }, [gateway]);

  const integrationsStatus = useCallback(async (params: GatewayIntegrationStatusParams = {}) => {
    if (!gateway) throw new Error("Not connected");
    return gateway.integrationsStatus(params);
  }, [gateway]);

  const integrationsDisconnect = useCallback(async (params: GatewayIntegrationDisconnectParams) => {
    if (!gateway) throw new Error("Not connected");
    const result = await gateway.integrationsDisconnect(params);
    appendActivity({ type: "connection", action: result.ok ? "Connection disconnected" : "Connection disconnect failed", detail: params.integrationId });
    return result;
  }, [gateway, appendActivity]);

  const connected = seededE2EConnection || (status === "connected" && ready && !hydrating);
  const connecting = seededE2EConnection || Boolean(error)
    ? false
    : status === "connecting" || hydrating || (status === "connected" && !ready);
  const activeSessions = activeSessionRecords;
  const sessionsFetched = Boolean(agentId && sessionsFetchedAgentId === agentId);
  const activeSessionPreviews = sessionsAgentId === agentId ? sessionPreviews : {};
  const visibleSessions = activeSessions.filter((session) => (
    !Array.from(deletedSessionKeys).some((deletedKey) => sameOpenClawSelectableSessionKey(session.key, deletedKey))
  ));

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
    input,
    setInput,
    pendingInput,
    addPendingMessage,
    activeSessionKey,
    activeSessionReadOnly,
    activeSessionReadOnlyReason,
    sending,
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
    sessionPreviews: activeSessionPreviews,
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
