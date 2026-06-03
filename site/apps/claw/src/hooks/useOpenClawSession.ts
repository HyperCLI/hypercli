"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { OpenClawAgent } from "@hypercli.com/sdk/agents";
import type { GatewayClient, GatewayCloseInfo, GatewayConnectionState, OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
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
  OPENCLAW_NEW_SESSION_TITLE,
  applyOpenClawSessionTitleMap,
  createOpenClawSession,
  deleteOpenClawSession,
  fallbackOpenClawSessionDisplayName,
  listOpenClawSessions,
  loadOpenClawSessionPreviews,
  normalizeOpenClawSessionDisplayName,
  normalizeOpenClawSessions,
  openClawSessionTitleMapKeys,
  resolveOpenClawActiveSessionKey,
  sameOpenClawSessionKey,
  sendOpenClawChatFallback,
  streamOpenClawChat,
} from "@/lib/openclaw-session-sdk-surface";

const E2E_OPENCLAW_CONNECTED_KEY = "claw_e2e_openclaw_connected";
const OPENCLAW_SESSION_TITLE_STORAGE_PREFIX = "openclaw.sessionTitles.v1";
const OPENCLAW_SESSION_LIST_STORAGE_PREFIX = "openclaw.sessions.v1";
const GATEWAY_CONNECTING_STALL_MS = 30_000;
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
        clientMode: session.clientMode,
        clientDisplayName: session.clientDisplayName,
        createdAt: session.createdAt,
        lastMessageAt: session.lastMessageAt,
        title: session.title,
        messageCount: session.messageCount,
      })),
    }));
  } catch {}
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
  const [retrySignal, setRetrySignal] = useState(0);
  const activeChatSendRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const sessionTitleMapRef = useRef<Record<string, string>>({});
  const creatingSessionKeysRef = useRef<Set<string>>(new Set());
  const seededE2EConnection = hasSeededE2EConnection();

  useEffect(() => {
    latestAgentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useLayoutEffect(() => {
    const titleMap = readStoredSessionTitles(agentId);
    writeStoredSessionTitles(agentId, titleMap);
    const cachedSessions = applyOpenClawSessionTitleMap(readStoredSessions(agentId), titleMap);
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

  const resetSessionStateForDisconnect = useCallback(({ preserveMessages = false }: { preserveMessages?: boolean } = {}) => {
    activeChatSendRef.current = false;
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
      const titledSessions = applyOpenClawSessionTitleMap(next, sessionTitleMapRef.current);
      writeStoredSessions(agentId, titledSessions);
      return titledSessions;
    });
  }, [agentId]);

  const refreshMessagesFromHistory = useCallback(async () => {
    if (!gateway) return;
    const historyMessages = dedupeChatMessages(await refreshOpenClawChatMessages(gateway, agentId, activeSessionKey));
    if (historyMessages.length === 0) return;
    const currentMessages = messagesRef.current;
    const currentUserCount = currentMessages.filter((message) => message.role === "user").length;
    const historyUserCount = historyMessages.filter((message) => message.role === "user").length;
    if (currentMessages.length > 0 && historyMessages.length < currentMessages.length && historyUserCount < currentUserCount) {
      return;
    }
    messagesRef.current = historyMessages;
    setMessages(historyMessages);
  }, [gateway, agentId, activeSessionKey]);

  const finishCreatingSession = useCallback((sessionKey: string) => {
    creatingSessionKeysRef.current.delete(sessionKey);
    setCreatingSessionKeys((prev) => prev.filter((key) => key !== sessionKey));
  }, []);

  useEffect(() => {
    if (!gateway) return;
    const unsubscribe = gateway.onEvent((gatewayEvent) => {
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
    });
    return unsubscribe;
  }, [gateway, activeSessionKey, appendActivity, setTitledSessions]);

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
          setMessages((currentMessages) => {
            if (hydrated.messages.length > 0) return dedupeChatMessages(hydrated.messages);
            if (currentMessages.length > 0) return currentMessages;
            return readCachedOpenClawChatHistory(agentId, activeSessionKey);
          });
        }
        setFiles(hydrated.files);
        setGwAgentId(hydrated.gwAgentId);
        if (hydrated.sessionsFetched) {
          setTitledSessions(hydrated.sessions);
          setSessionsFetchedAgentId(agentId);
        }
        setSessionPreviews(hydrated.sessionPreviews);
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
      [activeSessionKey]: { key: activeSessionKey, text: preview, role: "user", timestamp: messageTimestamp },
    }));
    setTitledSessions((prev) => {
      const existing = prev.find((session) => sameOpenClawSessionKey(session.key, activeSessionKey));
      const touchedSession = {
        ...(existing ?? localOpenClawSessionRecord(activeSessionKey)),
        lastMessageAt: messageTimestamp,
        messageCount: existing ? existing.messageCount + 1 : 1,
      };
      return [
        touchedSession,
        ...prev.filter((session) => !sameOpenClawSessionKey(session.key, activeSessionKey)),
      ];
    });

    let handledByChatSend = false;
    let chatSendCompleted = false;
    try {
      const sessionKey = activeSessionKey;
      const messageToSend = agentMessage || "What's in this image?";
      const attachmentsToSend = attachments.length > 0 ? attachments : undefined;
      if (typeof gateway.chatSend === "function") {
        handledByChatSend = true;
        activeChatSendRef.current = true;
        for await (const chatEvent of streamOpenClawChat(gateway, messageToSend, sessionKey, attachmentsToSend)) {
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
      setMessages((prev) => [...prev, { role: "system", content: `Error: ${errMsg}`, timestamp: Date.now() }]);
      appendActivity({ type: "error", action: "Send failed", detail: errMsg });
      setSending(false);
    } finally {
      activeChatSendRef.current = false;
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
  }, [gateway, ready, input, pendingAttachments, pendingAttachmentReads, pendingFiles, sending, appendActivity, activeSessionKey, refreshMessagesFromHistory, setTitledSessions, agentId]);

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
    } catch {}
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
          const refreshedSessions = nextSessions.some((session) => sameOpenClawSessionKey(session.key, sessionKey))
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
    sessionTitleMapRef.current = nextTitleMap;
    writeStoredSessionTitles(agentId, nextTitleMap);
    setSessions((prev) => {
      const next = prev.map((session) => (
        session.key === sessionKey
          ? { ...session, title: trimmedTitle, clientDisplayName: trimmedTitle }
          : session
      ));
      writeStoredSessions(agentId, next);
      return next;
    });
  }, [agentId]);

  const removeSession = useCallback(async (sessionKey: string) => {
    if (!gateway) throw new Error("Not connected");
    await deleteOpenClawSession(gateway, sessionKey);
    clearCachedOpenClawChatHistory(agentId, sessionKey);
    const nextTitleMap = { ...sessionTitleMapRef.current };
    delete nextTitleMap[sessionKey];
    sessionTitleMapRef.current = nextTitleMap;
    writeStoredSessionTitles(agentId, nextTitleMap);
    setDeletedSessionKeys((prev) => new Set(prev).add(sessionKey));
    setSessions((prev) => {
      const next = prev.filter((session) => session.key !== sessionKey);
      writeStoredSessions(agentId, next);
      return next;
    });
    setSessionPreviews((prev) => {
      const next = { ...prev };
      delete next[sessionKey];
      return next;
    });
    if (sessionKey === activeSessionKey) {
      messagesRef.current = [];
      setMessages([]);
    }
  }, [gateway, agentId, activeSessionKey]);

  const refreshCron = useCallback(async () => {
    if (!gateway) return;
    try { setCronJobs(await gateway.cronList() as Array<Record<string, unknown>>); } catch {}
  }, [gateway]);

  const addCron = useCallback(async (job: Record<string, unknown>) => {
    if (!gateway) throw new Error("Not connected");
    await gateway.cronAdd(job);
    await refreshCron();
    const schedule = typeof job.schedule === "string" ? job.schedule : "";
    const description = typeof job.description === "string" ? job.description : "";
    appendActivity({ type: "cron", action: "Cron added", detail: [description, schedule].filter(Boolean).join(" · ") });
  }, [gateway, refreshCron, appendActivity]);

  const removeCron = useCallback(async (jobId: string) => {
    if (!gateway) throw new Error("Not connected");
    await gateway.cronRemove(jobId);
    await refreshCron();
    appendActivity({ type: "cron", action: "Cron removed", detail: jobId });
  }, [gateway, refreshCron, appendActivity]);

  const runCron = useCallback(async (jobId: string) => {
    if (!gateway) throw new Error("Not connected");
    appendActivity({ type: "cron", action: "Cron run", detail: jobId });
    return gateway.cronRun(jobId);
  }, [gateway, appendActivity]);

  const connected = seededE2EConnection || (status === "connected" && ready && !hydrating);
  const connecting = seededE2EConnection || Boolean(error)
    ? false
    : status === "connecting" || hydrating || (status === "connected" && !ready);
  const activeSessions = sessionsAgentId === agentId ? sessions : [];
  const sessionsFetched = Boolean(agentId && sessionsFetchedAgentId === agentId);
  const activeSessionPreviews = sessionsAgentId === agentId ? sessionPreviews : {};
  const visibleSessions = activeSessions.filter((session) => !deletedSessionKeys.has(session.key));

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
    input,
    setInput,
    pendingInput,
    addPendingMessage,
    activeSessionKey,
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
    removeCron,
    runCron,
    retry,
  };
}
