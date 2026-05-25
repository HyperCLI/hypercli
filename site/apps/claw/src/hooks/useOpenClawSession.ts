"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
} from "@/lib/openclaw-session";
import {
  readCachedOpenClawChatHistory,
  writeCachedOpenClawChatHistory,
} from "@/lib/openclaw-chat-history-cache";
import { resolveOpenClawSessionKey } from "@/lib/openclaw-session-key";

const E2E_OPENCLAW_CONNECTED_KEY = "claw_e2e_openclaw_connected";
const GATEWAY_CONNECTING_STALL_MS = 30_000;
const GATEWAY_CONNECTING_STALL_MESSAGE =
  "Timed out opening the agent session. The gateway is still reconnecting in the background.";
const GENERIC_OPENCLAW_CONNECTION_ERROR = "Could not connect to the agent session.";
const OPENCLAW_ORIGIN_DENIED_MESSAGE =
  "This agent was opened from another dashboard address. Stop and start it from this page, then retry.";

function hasSeededE2EConnection(): boolean {
  if (typeof window === "undefined" || !window.navigator.webdriver) return false;
  try {
    return window.localStorage.getItem(E2E_OPENCLAW_CONNECTED_KEY) === "1";
  } catch {
    return false;
  }
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
) {
  const agentId = agent?.id ?? null;
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
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([]);
  const [cronJobs, setCronJobs] = useState<Array<Record<string, unknown>>>([]);
  const [models, setModels] = useState<Array<Record<string, unknown>>>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEntry[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [pendingAttachmentReads, setPendingAttachmentReads] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<ChatPendingFile[]>([]);
  const [retrySignal, setRetrySignal] = useState(0);
  const activeChatSendRef = useRef(false);
  const seededE2EConnection = hasSeededE2EConnection();

  useEffect(() => {
    latestAgentRef.current = agent;
  }, [agent]);

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
    setCronJobs([]);
    setModels([]);
    setActivityFeed([]);
  }, []);

  useEffect(() => {
    const cachedMessages = readCachedOpenClawChatHistory(agentId);
    setMessages(cachedMessages);
  }, [agentId]);

  useEffect(() => {
    if (!agentId || messages.length === 0 || typeof window === "undefined") return;
    const timeout = window.setTimeout(() => {
      writeCachedOpenClawChatHistory(agentId, messages);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [agentId, messages]);

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

  useEffect(() => {
    if (!gateway) return;
    const unsubscribe = gateway.onEvent((gatewayEvent) => {
      handleOpenClawSessionEvent({
        gateway,
        gatewayEvent,
        setMessages,
        setSending,
        setSessions,
        appendActivity,
        suppressChatStreamEvents: activeChatSendRef.current,
      });
    });
    return unsubscribe;
  }, [gateway, appendActivity]);

  useEffect(() => {
    if (!gateway || status !== "connected") return;
    let cancelled = false;
    setReady(false);
    setHydrating(true);
    void (async () => {
      try {
        const hydrated = await hydrateOpenClawSession(gateway, agentId);
        if (cancelled) return;
        setConfig(hydrated.config);
        setConfigSchema(hydrated.configSchema);
        if (!activeChatSendRef.current) {
          setMessages((currentMessages) => {
            if (hydrated.messages.length > 0) return hydrated.messages;
            if (currentMessages.length > 0) return currentMessages;
            return readCachedOpenClawChatHistory(agentId);
          });
        }
        setFiles(hydrated.files);
        setGwAgentId(hydrated.gwAgentId);
        setSessions(hydrated.sessions);
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
  }, [gateway, status, agentId]);

  useEffect(() => {
    if (status !== "disconnected") return;
    resetSessionStateForDisconnect({ preserveMessages: true });
  }, [status, resetSessionStateForDisconnect]);

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

  const sendMessage = useCallback(async (overrideInput?: string) => {
    if (!gateway || !ready) throw new Error("Chat is not ready");
    const nextInput = typeof overrideInput === "string" ? overrideInput : input;
    const nextAttachments = typeof overrideInput === "string" ? [] : pendingAttachments;
    const nextFiles = typeof overrideInput === "string" ? [] : pendingFiles;
    const readingAttachments = typeof overrideInput !== "string" && pendingAttachmentReads > 0;
    if ((!nextInput.trim() && nextAttachments.length === 0 && nextFiles.length === 0) || sending || readingAttachments) return;

    const msg = nextInput.trim();
    const attachments = [...nextAttachments];
    const files = [...nextFiles];
    const hiddenFileHeader = files.map((file) => `file: ${file.path}`).join("\n");
    const agentMessage = hiddenFileHeader ? (msg ? `${hiddenFileHeader}\n\n${msg}` : `${hiddenFileHeader}\n\n`) : msg;
    setInput("");
    setPendingAttachments([]);
    setPendingFiles([]);
    setSending(true);

    const userMsg: ChatMessage = { role: "user", content: msg, timestamp: Date.now() };
    if (attachments.length > 0) userMsg.attachments = attachments;
    if (files.length > 0) userMsg.files = files;
    setMessages((prev) => [...prev, userMsg]);

    const preview = msg.slice(0, 80);
    appendActivity({ type: "message", action: "User message sent", detail: preview + (attachments.length > 0 ? ` · ${attachments.length} image${attachments.length === 1 ? "" : "s"}` : "") });

    let handledByChatSend = false;
    try {
      const sessionKey = resolveOpenClawSessionKey(agentId);
      const messageToSend = agentMessage || "What's in this image?";
      const attachmentsToSend = attachments.length > 0 ? attachments : undefined;
      if (typeof gateway.chatSend === "function") {
        handledByChatSend = true;
        activeChatSendRef.current = true;
        for await (const chatEvent of gateway.chatSend(messageToSend, sessionKey, attachmentsToSend)) {
          handleOpenClawChatStreamEvent({
            gateway,
            chatEvent,
            setMessages,
            setSending,
            setSessions,
            appendActivity,
          });
        }
      } else {
        await gateway.sendChat(messageToSend, sessionKey, undefined, attachmentsToSend);
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
    }
  }, [gateway, ready, input, pendingAttachments, pendingAttachmentReads, pendingFiles, sending, appendActivity, agentId]);

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
    try { setSessions(await gateway.sessionsList() as Array<Record<string, unknown>>); } catch {}
  }, [gateway]);

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
    sessions,
    cronJobs,
    models,
    activityFeed,
    refreshSessions,
    refreshCron,
    addCron,
    removeCron,
    runCron,
    retry,
  };
}
