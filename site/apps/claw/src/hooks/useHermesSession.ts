"use client";

import React from "react";

import type { HermesAgent } from "@hypercli.com/sdk/agents";
import type { AgentSessionClient, AgentSessionSummary } from "@hypercli.com/sdk/session";
import {
  createChatRenderId,
  type ChatMessage,
  type ChatPendingFile,
} from "@/lib/openclaw-chat";
import type { AgentGatewaySession } from "@/components/dashboard/agents/AgentGatewayProvider";

type OpenClawHistoryPhase = "idle" | "loading" | "ready" | "error";

const noop = () => undefined;
const asyncNoop = async () => undefined;
const asyncNull = async () => null;
const asyncEmptyObject = async () => ({});
const EMPTY_LIST: never[] = [];
const EMPTY_RECORD: Record<string, never> = {};
const HERMES_CONNECT_RETRY_DELAYS_MS = [750, 1_500, 3_000, 5_000, 10_000, 15_000, 30_000, 30_000] as const;

/**
 * OpenClaw-only members, inert under hermes. Module-level so every identity
 * is stable across renders (consumers put these in effect dep arrays).
 */
const HERMES_INERT_SESSION_MEMBERS = {
  gateway: null,
  pendingInput: EMPTY_LIST as string[],
  addPendingMessage: noop,
  activeSessionThinkingLevel: "",
  activeSessionThinkingLevels: EMPTY_LIST as string[],
  activeSessionThinkingDefault: "",
  activeSessionReadOnly: false,
  activeSessionReadOnlyReason: null,
  temporaryChatAvailable: false,
  temporaryChatActive: false,
  temporaryChatState: "inactive" as const,
  temporaryChatError: null,
  startTemporaryChat: asyncNoop,
  endTemporaryChat: asyncNoop,
  files: EMPTY_LIST,
  config: null,
  configSchema: null,
  openFile: asyncNoop,
  saveFile: asyncNoop,
  saveConfig: asyncNoop,
  saveFullConfig: asyncNoop,
  setActiveSessionThinkingLevel: asyncNoop,
  channelsStatus: asyncEmptyObject,
  ensureWhatsAppSupport: asyncNoop,
  whatsAppPairingStart: asyncNoop,
  whatsAppPairingState: null,
  cancelWhatsAppPairing: noop,
  webLoginStart: asyncNoop,
  webLoginWait: asyncNoop,
  channelsProvider: null,
  connectorsProvider: null,
  connectorRuntime: null,
  connectorWorkflows: EMPTY_RECORD,
  generateConnectorWorkflow: asyncNoop,
  preloadConnectorWorkflows: asyncNoop,
  runConnectorShellProposal: asyncNoop,
  reportedChannels: EMPTY_LIST,
  reportedChannelSnapshot: null,
  // True on purpose: false would send consumers down a provider-probe path
  // that does not exist for hermes and spins forever.
  reportedChannelsReady: true,
  reportedChannelsError: null,
  refreshReportedChannels: asyncNoop,
  activeUnindexedInitialSession: null,
  cronJobs: EMPTY_LIST,
  refreshCron: asyncNoop,
  addCron: asyncNoop,
  updateCron: asyncNoop,
  removeCron: asyncNoop,
  runCron: asyncNoop,
  activityFeed: EMPTY_LIST,
  runEphemeralPrompt: asyncNull,
  readGatewayMediaBytes: asyncNull,
  skillsProvider: null,
  integrationsAuthStart: asyncNoop,
  integrationsAuthStatus: asyncNoop,
  integrationsStatus: null,
  integrationsDisconnect: asyncNoop,
  ensureSlackSupport: asyncNoop,
} as const;

export type HermesSessionStatus = "disconnected" | "connecting" | "connected" | "error";

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string" && value) return value;
  return "Hermes request failed";
}

function hermesConnectRetryDelay(attempt: number): number | null {
  return HERMES_CONNECT_RETRY_DELAYS_MS[attempt] ?? null;
}

function sessionLabel(session: AgentSessionSummary): string {
  return session.label?.trim() || `Session ${session.key.slice(0, 8)}`;
}

function toSessionRecord(session: AgentSessionSummary): Record<string, unknown> {
  return {
    key: session.key,
    sessionId: session.sessionId ?? session.key,
    // displayOpenClawSessionName reads title first, then clientDisplayName.
    title: session.label ?? null,
    label: sessionLabel(session),
    displayName: sessionLabel(session),
    model: session.model ?? null,
    source: typeof session.source === "string" ? session.source : "api_server",
  };
}

function historyMessageToChatMessage(message: {
  role: string;
  text: string;
  thinking?: string;
  messageId?: string;
  timestamp?: number;
}): ChatMessage {
  return {
    role: message.role === "user" ? "user" : message.role === "system" ? "system" : "assistant",
    content: message.text,
    renderId: createChatRenderId(message.role),
    ...(message.messageId ? { messageId: message.messageId } : {}),
    ...(message.thinking ? { thinking: message.thinking } : {}),
    ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
  };
}

/**
 * The hermes implementation of the shared agent session contract consumed by
 * the standard chat UI. Transport and protocol live in the SDK
 * (AgentSessionClient over the Hermes HTTP/SSE API); this hook only adapts
 * state into the AgentGatewaySession shape. OpenClaw-only members are inert,
 * stable-identity defaults (HERMES_INERT_SESSION_MEMBERS).
 */
export function useHermesSession(
  agent: HermesAgent | null,
  enabled: boolean,
  requestedSessionKey?: string | null,
): AgentGatewaySession {
  const [status, setStatus] = React.useState<HermesSessionStatus>("disconnected");
  const [error, setError] = React.useState<string | null>(null);
  const [sessions, setSessions] = React.useState<AgentSessionSummary[]>([]);
  const [sessionsFetched, setSessionsFetched] = React.useState(false);
  const [activeSessionKey, setActiveSessionKey] = React.useState<string | null>(null);
  const [historyPhase, setHistoryPhase] = React.useState<OpenClawHistoryPhase>("idle");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [aborting, setAborting] = React.useState(false);
  const [models, setModels] = React.useState<Array<Record<string, unknown>>>([]);
  const [pendingFiles, setPendingFiles] = React.useState<ChatPendingFile[]>([]);
  const [pendingAttachments, setPendingAttachments] = React.useState<unknown[]>([]);

  const clientRef = React.useRef<AgentSessionClient | null>(null);
  const generationRef = React.useRef(0);
  const sendAbortRef = React.useRef<AbortController | null>(null);
  const activeSessionKeyRef = React.useRef<string | null>(null);
  const requestedSessionKeyRef = React.useRef<string | null>(null);
  // Set when a send appended local rows for a session; a late history load
  // must not clobber a live transcript with a stale snapshot.
  const transcriptDirtyRef = React.useRef<string | null>(null);
  const connectRetryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRetryAttemptRef = React.useRef(0);
  const connectAbortRef = React.useRef<AbortController | null>(null);

  // The roster rehydrates Agent instances on every poll; reconnecting on
  // identity change would wipe live transcripts. Key the connection on
  // id + launchEpoch (a restart bumps the epoch) and keep the instance in a ref.
  const agentIdentityKey = agent ? `${agent.id}:${agent.launchEpoch ?? 0}` : null;
  const agentRef = React.useRef<HermesAgent | null>(agent);
  React.useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  React.useEffect(() => {
    activeSessionKeyRef.current = activeSessionKey;
  }, [activeSessionKey]);

  React.useEffect(() => {
    requestedSessionKeyRef.current = requestedSessionKey ?? null;
  }, [requestedSessionKey]);

  const clearConnectRetryTimer = React.useCallback(() => {
    if (!connectRetryTimerRef.current) return;
    window.clearTimeout(connectRetryTimerRef.current);
    connectRetryTimerRef.current = null;
  }, []);

  const cancelPendingConnect = React.useCallback((reason: string) => {
    clearConnectRetryTimer();
    connectAbortRef.current?.abort(new Error(reason));
    connectAbortRef.current = null;
  }, [clearConnectRetryTimer]);

  const closeConnectedClient = React.useCallback(() => {
    clientRef.current?.close();
    clientRef.current = null;
  }, []);

  const loadHistory = React.useCallback(async (client: AgentSessionClient, sessionKey: string, generation: number) => {
    setHistoryPhase("loading");
    try {
      const history = await client.chatHistory(sessionKey, 100);
      if (generationRef.current !== generation || activeSessionKeyRef.current !== sessionKey) return;
      if (transcriptDirtyRef.current !== sessionKey) {
        setMessages(history
          .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
          .map(historyMessageToChatMessage));
      }
      setHistoryPhase("ready");
    } catch (cause) {
      if (generationRef.current !== generation || activeSessionKeyRef.current !== sessionKey) return;
      setHistoryPhase("error");
      setError(errorText(cause));
    }
  }, []);

  const refreshSessions = React.useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const generation = generationRef.current;
    try {
      const listed = await client.sessionsList();
      if (generationRef.current !== generation) return;
      setSessions([...listed].reverse());
      setSessionsFetched(true);
    } catch (cause) {
      if (generationRef.current !== generation) return;
      setError(errorText(cause));
    }
  }, []);

  const connect = React.useCallback(async (generation: number) => {
    const connectTarget = agentRef.current;
    if (!connectTarget) return;
    cancelPendingConnect("Hermes session reconnecting");
    const abortController = new AbortController();
    connectAbortRef.current = abortController;
    let client: AgentSessionClient | null = null;
    setStatus("connecting");
    setError(null);
    try {
      client = await connectTarget.connect({ signal: abortController.signal });
      if (connectAbortRef.current === abortController) connectAbortRef.current = null;
      if (generationRef.current !== generation) {
        client.close();
        return;
      }
      clientRef.current = client;
      connectRetryAttemptRef.current = 0;
      setStatus("connected");
      const listed = await client.sessionsList();
      if (generationRef.current !== generation) return;
      const sorted = [...listed].reverse();
      setSessions(sorted);
      setSessionsFetched(true);
      void client.modelsList()
        .then((listedModels) => {
          if (generationRef.current === generation) setModels(listedModels);
        })
        .catch(() => undefined);
      let sessionKey = sorted[0]?.key ?? null;
      const requestedKey = requestedSessionKeyRef.current;
      if (requestedKey && sorted.some((session) => session.key === requestedKey)) {
        sessionKey = requestedKey;
      }
      if (!sessionKey) {
        const created = await client.sessionsCreate();
        if (generationRef.current !== generation) return;
        sessionKey = created.key;
        setSessions([created]);
      }
      setActiveSessionKey(sessionKey);
      activeSessionKeyRef.current = sessionKey;
      setMessages([]);
      if (sessionKey) await loadHistory(client, sessionKey, generation);
    } catch (cause) {
      if (generationRef.current !== generation) return;
      if (abortController.signal.aborted) return;
      if (connectAbortRef.current === abortController) connectAbortRef.current = null;
      if (clientRef.current === client) clientRef.current = null;
      client?.close();
      setStatus("error");
      setError(errorText(cause));
      const retryDelay = hermesConnectRetryDelay(connectRetryAttemptRef.current);
      if (retryDelay !== null) {
        connectRetryAttemptRef.current += 1;
        connectRetryTimerRef.current = window.setTimeout(() => {
          connectRetryTimerRef.current = null;
          if (generationRef.current !== generation || !agentRef.current) return;
          void connect(generation);
        }, retryDelay);
      }
    }
  }, [cancelPendingConnect, loadHistory]);

  // Follow route-driven session selection, mirroring the openclaw hook.
  React.useEffect(() => {
    if (!requestedSessionKey || requestedSessionKey === activeSessionKeyRef.current) return;
    const client = clientRef.current;
    if (!client) return;
    const generation = generationRef.current;
    setActiveSessionKey(requestedSessionKey);
    activeSessionKeyRef.current = requestedSessionKey;
    setMessages([]);
    void loadHistory(client, requestedSessionKey, generation);
  }, [requestedSessionKey, loadHistory]);

  React.useEffect(() => {
    if (!agentIdentityKey || !enabled) {
      generationRef.current += 1;
      connectRetryAttemptRef.current = 0;
      cancelPendingConnect("Hermes session disabled");
      closeConnectedClient();
      const resetTimer = window.setTimeout(() => {
        setStatus("disconnected");
        setError(null);
        setSessions([]);
        setSessionsFetched(false);
        setActiveSessionKey(null);
        setHistoryPhase("idle");
        setMessages([]);
        setSending(false);
        setAborting(false);
        setModels([]);
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    connectRetryAttemptRef.current = 0;
    cancelPendingConnect("Hermes session starting");
    void connect(generation);
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      cancelPendingConnect("Hermes session changed");
      sendAbortRef.current?.abort();
      closeConnectedClient();
    };
  }, [agentIdentityKey, enabled, cancelPendingConnect, closeConnectedClient, connect]);

  const selectSession = React.useCallback((sessionKey: string) => {
    const client = clientRef.current;
    if (!client || sessionKey === activeSessionKeyRef.current) return;
    const generation = generationRef.current;
    setActiveSessionKey(sessionKey);
    activeSessionKeyRef.current = sessionKey;
    setMessages([]);
    void loadHistory(client, sessionKey, generation);
  }, [loadHistory]);

  const createSession = React.useCallback(async () => {
    const client = clientRef.current;
    if (!client) return null;
    const generation = generationRef.current;
    const created = await client.sessionsCreate();
    if (generationRef.current !== generation) return null;
    setSessions((current) => [created, ...current]);
    setActiveSessionKey(created.key);
    activeSessionKeyRef.current = created.key;
    setMessages([]);
    setHistoryPhase("ready");
    return toSessionRecord(created);
  }, []);

  const renameSession = React.useCallback(async (sessionKey: string, title: string) => {
    const client = clientRef.current;
    if (!client) return;
    const generation = generationRef.current;
    const updated = await client.sessionsPatch({ key: sessionKey, label: title });
    if (generationRef.current !== generation) return;
    setSessions((current) => current.map((session) => (
      session.key === sessionKey ? { ...session, label: updated.label ?? title } : session
    )));
  }, []);

  const deleteSession = React.useCallback(async (sessionKey: string) => {
    const client = clientRef.current;
    if (!client) return;
    const generation = generationRef.current;
    await client.sessionsDelete(sessionKey);
    if (generationRef.current !== generation) return;
    setSessions((current) => {
      const remaining = current.filter((session) => session.key !== sessionKey);
      if (activeSessionKeyRef.current === sessionKey) {
        const next = remaining[0]?.key ?? null;
        setActiveSessionKey(next);
        activeSessionKeyRef.current = next;
        setMessages([]);
        if (next) void loadHistory(client, next, generation);
        else setHistoryPhase("idle");
      }
      return remaining;
    });
  }, [loadHistory]);

  const sendMessage = React.useCallback(async (overrideInput?: string) => {
    const client = clientRef.current;
    const sessionKey = activeSessionKeyRef.current;
    const text = (overrideInput ?? input).trim();
    if (!client || !sessionKey || !text || sending) return;
    const generation = generationRef.current;

    const userMessage: ChatMessage = {
      role: "user",
      content: text,
      renderId: createChatRenderId("user"),
      clientTurnId: createChatRenderId("turn"),
      sessionKey,
    };
    const assistantRenderId = createChatRenderId("assistant");
    transcriptDirtyRef.current = sessionKey;
    setMessages((current) => [
      ...current,
      userMessage,
      { role: "assistant", content: "", renderId: assistantRenderId, sessionKey },
    ]);
    setInput("");
    setSending(true);
    setError(null);

    const abort = new AbortController();
    sendAbortRef.current = abort;

    try {
      for await (const event of client.chatSend(text, sessionKey, { signal: abort.signal })) {
        if (generationRef.current !== generation) return;
        if (event.type === "content" && event.text) {
          setMessages((current) => current.map((message) => (
            message.renderId === assistantRenderId
              ? { ...message, content: event.replace ? event.text ?? "" : message.content + (event.text ?? "") }
              : message
          )));
        } else if (event.type === "thinking" && event.text) {
          setMessages((current) => current.map((message) => (
            message.renderId === assistantRenderId
              ? { ...message, thinking: (message.thinking ?? "") + (event.text ?? "") }
              : message
          )));
        } else if (event.type === "tool_call") {
          const name = typeof event.data?.name === "string" ? event.data.name : "tool";
          const args = event.data?.args === undefined ? "" : JSON.stringify(event.data.args);
          setMessages((current) => current.map((message) => (
            message.renderId === assistantRenderId
              ? { ...message, toolCalls: [...(message.toolCalls ?? []), { name, args }] }
              : message
          )));
        } else if (event.type === "tool_result") {
          const name = typeof event.data?.name === "string" ? event.data.name : "tool";
          const result = typeof event.data?.preview === "string" ? event.data.preview : undefined;
          setMessages((current) => current.map((message) => {
            if (message.renderId !== assistantRenderId) return message;
            const toolCalls = [...(message.toolCalls ?? [])];
            const openIndex = toolCalls.map((call) => call.name).lastIndexOf(name);
            if (openIndex >= 0 && result !== undefined) {
              toolCalls[openIndex] = { ...toolCalls[openIndex], result };
            }
            return { ...message, toolCalls };
          }));
        } else if (event.type === "error") {
          const detail = event.text ?? "The run failed.";
          setError(detail);
          setMessages((current) => current.map((message) => (
            message.renderId === assistantRenderId && !message.content
              ? { ...message, content: detail }
              : message
          )));
        }
      }
      if (abort.signal.aborted && generationRef.current === generation) {
        setMessages((current) => current.map((message) => (
          message.renderId === assistantRenderId ? { ...message, status: "interrupted" as const } : message
        )));
      }
    } catch (cause) {
      if (generationRef.current !== generation) return;
      if (abort.signal.aborted) {
        setMessages((current) => current.map((message) => (
          message.renderId === assistantRenderId ? { ...message, status: "interrupted" as const } : message
        )));
      } else {
        const detail = errorText(cause);
        setError(detail);
        setMessages((current) => current.map((message) => (
          message.renderId === assistantRenderId && !message.content
            ? { ...message, content: detail }
            : message
        )));
      }
    } finally {
      if (generationRef.current === generation) {
        sendAbortRef.current = null;
        setSending(false);
      }
    }
  }, [input, sending]);

  const abortMessage = React.useCallback(async () => {
    const client = clientRef.current;
    const abort = sendAbortRef.current;
    if (!abort) return;
    setAborting(true);
    try {
      abort.abort();
      // chatAbort throws when no run is active; an aborted send is already
      // finished server-side, so that miss is expected.
      await client?.chatAbort(activeSessionKeyRef.current ?? undefined).catch(() => undefined);
    } finally {
      setAborting(false);
    }
  }, []);

  const retry = React.useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    connectRetryAttemptRef.current = 0;
    cancelPendingConnect("Hermes session retry requested");
    closeConnectedClient();
    await connect(generation);
  }, [cancelPendingConnect, closeConnectedClient, connect]);

  const retryAndRefreshSessions = React.useCallback(async () => {
    await retry();
    await refreshSessions();
  }, [retry, refreshSessions]);

  const setActiveSessionModel = React.useCallback(async (model: string) => {
    const client = clientRef.current;
    const sessionKey = activeSessionKeyRef.current;
    if (!client || !sessionKey || !model) return;
    const generation = generationRef.current;
    await client.sessionsPatch({ key: sessionKey, model });
    if (generationRef.current !== generation) return;
    setSessions((current) => current.map((session) => (
      session.key === sessionKey ? { ...session, model } : session
    )));
  }, []);

  const connected = status === "connected";
  const connecting = status === "connecting";
  const activeSessionSelectionResolved = sessionsFetched;
  const activeSession = sessions.find((session) => session.key === activeSessionKey) ?? null;
  const sessionRecords = React.useMemo(() => sessions.map(toSessionRecord), [sessions]);
  const thinkingSessionKeys = React.useMemo(
    () => (sending && activeSessionKey ? [activeSessionKey] : EMPTY_LIST as string[]),
    [sending, activeSessionKey],
  );

  return {
    backend: "hermes",
    status: connected ? "connected" : connecting ? "connecting" : "disconnected",
    error,
    ready: connected && sessionsFetched,
    gatewayConnected: connected,
    connected,
    connecting,
    hydrating: connecting || (connected && !sessionsFetched),
    historyPhase,
    historyPending: historyPhase === "loading",
    messages,
    sendMessage,
    abortMessage,
    aborting,
    activeSessionAborting: aborting,
    input,
    setInput,
    activeSessionKey,
    activeSessionSelectionResolved,
    activeSessionModel: activeSession?.model ?? "",
    activeSessionCanSend: connected && Boolean(activeSessionKey) && historyPhase !== "error",
    sending,
    activeSessionSending: sending,
    thinkingSessionKeys: sending && activeSessionKey ? [activeSessionKey] : EMPTY_LIST as string[],
    pendingFiles,
    pendingAttachments: pendingAttachments as never[],
    pendingAttachmentReads: 0,
    addPendingFiles: (files: ChatPendingFile[]) => setPendingFiles((current) => [...current, ...files]),
    addAttachments: (attachments: unknown[]) => setPendingAttachments((current) => [...current, ...attachments]),
    removePendingFile: (name: string) => setPendingFiles((current) => current.filter((file) => file.name !== name)),
    removeAttachment: (index: number) => setPendingAttachments((current) => current.filter((_, entry) => entry !== index)),
    sessions: sessionRecords,
    sessionsFetched,
    creatingSessionKeys: EMPTY_LIST as string[],
    createSession,
    refreshSessions,
    renameSession,
    deleteSession,
    models,
    setActiveSessionModel,
    retry,
    retryAndRefreshSessions,
    ...HERMES_INERT_SESSION_MEMBERS,
  } as unknown as AgentGatewaySession;
}
