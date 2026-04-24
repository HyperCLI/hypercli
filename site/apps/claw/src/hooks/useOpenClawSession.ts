"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GatewayClient, GatewayCloseInfo, GatewayEvent, OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import {
  type ChatAttachment,
  type ChatMessage,
  type ChatPendingFile,
  type WorkspaceFile,
  maybeDecodeMojibake,
  normalizeHistoryMessage,
  normalizeLiveToolCall,
  normalizeLiveToolResult,
  upsertAssistantMessage,
} from "@/lib/openclaw-chat";

interface Agent {
  id: string;
  name?: string | null;
  state: string;
  hostname?: string | null;
  connect?: (options?: Record<string, unknown>) => Promise<import("@hypercli.com/sdk/openclaw/gateway").GatewayClient>;
}

type ActivityKind = "message" | "tool" | "connection" | "skill" | "cron" | "error" | "system";

export function useOpenClawSession(
  agent: Agent | null,
  enabled: boolean = true,
) {
  const [gateway, setGateway] = useState<GatewayClient | null>(null);
  const [status, setStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
  const [activityFeed, setActivityFeed] = useState<Array<{
    id: string;
    type: ActivityKind;
    action: string;
    detail: string;
    timestamp: number;
  }>>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatPendingFile[]>([]);

  useEffect(() => {
    let active = true;
    let localGateway: GatewayClient | null = null;

    if (!enabled || !agent || typeof agent.connect !== "function" || String(agent.state).toUpperCase() !== "RUNNING") {
      setGateway(null);
      setStatus("disconnected");
      setError(null);
      return () => {
        active = false;
      };
    }

    setGateway(null);
    setStatus("connecting");
    setError(null);

    const connect = agent.connect;

    void (async () => {
      try {
        localGateway = await connect({
          autoApprovePairing: true,
          onHello: () => {
            if (!active) return;
            setStatus("connected");
            setError(null);
          },
          onClose: ({ error: closeError, code, reason }: GatewayCloseInfo) => {
            if (!active) return;
            setStatus("disconnected");
            if (closeError?.message) {
              setError(closeError.message);
              return;
            }
            if (code !== 1000 && reason) {
              setError(`Disconnected: ${reason}`);
              return;
            }
            setError(null);
          },
        });

        if (!active) {
          localGateway.close();
          return;
        }

        setGateway(localGateway);
        setStatus("connected");
        setError(null);
      } catch (e: unknown) {
        if (!active) return;
        setGateway(null);
        setStatus("disconnected");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      active = false;
      localGateway?.close();
    };
  }, [enabled, agent]);

  const appendActivity = useCallback((entry: { type: ActivityKind; action: string; detail?: string; id?: string; timestamp?: number }) => {
    setActivityFeed((prev) => {
      const next = [...prev, {
        type: entry.type,
        action: entry.action,
        detail: entry.detail ?? "",
        id: entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: entry.timestamp ?? Date.now(),
      }];
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
  }, []);

  useEffect(() => {
    if (!gateway) return;
    const unsubscribe = gateway.onEvent((gatewayEvent: GatewayEvent) => {
      const event = gatewayEvent.event;
      const payload = gatewayEvent.payload ?? {};

      if (event === "agent" && String((payload as Record<string, unknown>).stream || "") === "tool") {
        const data = (payload as Record<string, unknown>).data as Record<string, unknown> | undefined;
        if (data) {
          const phase = data.phase as string;
          const toolName = (data.name as string) || "";
          const toolCallId = data.toolCallId as string | undefined;
          if (phase === "start" && toolName) {
            const args = data.args == null ? "" : typeof data.args === "string" ? maybeDecodeMojibake(data.args) : JSON.stringify(data.args, null, 2);
            setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: "", toolCalls: [{ ...(toolCallId ? { id: toolCallId } : {}), name: toolName, args }], timestamp: Date.now() }));
          } else if (phase === "result" && toolName) {
            const meta = (data.meta as string) || "";
            const isError = Boolean(data.isError);
            const resultText = isError ? `Error: ${meta}` : meta;
            if (resultText) {
              setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: "", toolCalls: [{ ...(toolCallId ? { id: toolCallId } : {}), name: toolName, args: "", result: resultText }], timestamp: Date.now() }));
            }
          }
        }
      }

      if (event === "chat") {
        const normalized = normalizeHistoryMessage((payload as Record<string, unknown>).message);
        if (normalized?.role === "assistant") setMessages((prev) => upsertAssistantMessage(prev, normalized));
        if ((payload as Record<string, unknown>).state === "final") setSending(false);
      } else if (event === "chat.content") {
        const text = maybeDecodeMojibake((payload as Record<string, unknown>).text as string ?? "");
        if (text) setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: text, timestamp: Date.now() }));
      } else if (event === "chat.thinking") {
        const text = maybeDecodeMojibake((payload as Record<string, unknown>).text as string ?? "");
        if (text) setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: "", thinking: text, timestamp: Date.now() }));
      } else if (event === "chat.tool_call") {
        const toolCall = normalizeLiveToolCall(payload as Record<string, unknown>);
        if (toolCall) setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: "", toolCalls: [toolCall], timestamp: Date.now() }));
      } else if (event === "chat.tool_result") {
        const toolResult = normalizeLiveToolResult(payload as Record<string, unknown>);
        if (toolResult) setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: "", toolCalls: [toolResult], timestamp: Date.now() }));
      } else if (event === "chat.done") {
        setSending(false);
        void gateway.sessionsList().then((list) => setSessions(list as Array<Record<string, unknown>>)).catch(() => {});
      } else if (event === "sessions.updated") {
        const list = (payload as Record<string, unknown>).sessions;
        if (Array.isArray(list)) setSessions(list as Array<Record<string, unknown>>);
      } else if (event === "chat.error") {
        setSending(false);
        setMessages((prev) => [...prev, { role: "system", content: `Error: ${(payload as Record<string, unknown>).message ?? "Unknown error"}`, timestamp: Date.now() }]);
      }

      const isActivityKind = (v: unknown): v is ActivityKind => v === "message" || v === "tool" || v === "connection" || v === "skill" || v === "cron" || v === "error" || v === "system";
      if (event === "chat.tool_call") {
        const tc = normalizeLiveToolCall(payload as Record<string, unknown>);
        if (tc) appendActivity({ type: "tool", action: tc.name, detail: tc.args || "" });
      } else if (event === "chat.tool_result") {
        const tc = normalizeLiveToolResult(payload as Record<string, unknown>);
        if (tc?.result) appendActivity({ type: "tool", action: `${tc.name} → result`, detail: tc.result });
      } else if (event === "chat.done") {
        appendActivity({ type: "message", action: "Assistant response complete" });
      } else if (event === "chat.error") {
        appendActivity({ type: "error", action: "Error", detail: String((payload as Record<string, unknown>).message ?? "Unknown error") });
      } else if (event === "activity.log") {
        const entry = payload as Record<string, unknown>;
        appendActivity({
          type: isActivityKind(entry.type) ? entry.type : "system",
          action: typeof entry.action === "string" ? entry.action : "Activity",
          detail: typeof entry.detail === "string" ? entry.detail : "",
          id: typeof entry.id === "string" ? entry.id : undefined,
          timestamp: typeof entry.timestamp === "number" ? entry.timestamp : undefined,
        });
      } else if (event === "sessions.updated") {
        const sessionsList = (payload as Record<string, unknown>).sessions;
        const count = Array.isArray(sessionsList) ? sessionsList.length : 0;
        appendActivity({ type: "system", action: "Sessions updated", detail: `${count} active` });
      }
    });
    return unsubscribe;
  }, [gateway, appendActivity]);

  useEffect(() => {
    if (!gateway) return;
    let cancelled = false;
    void (async () => {
      const [cfgResult, schemaResult, historyResult, agentsResult, sessionsRes, cronRes, modelsRes] = await Promise.allSettled([
        gateway.configGet(),
        gateway.configSchema(),
        gateway.chatHistory("main", 200),
        gateway.agentsList(),
        gateway.sessionsList(),
        gateway.cronList(),
        gateway.modelsList(),
      ]);
      if (cancelled) return;
      if (cfgResult.status === "fulfilled") setConfig(cfgResult.value); else setConfig({});
      if (schemaResult.status === "fulfilled") setConfigSchema(schemaResult.value);
      if (historyResult.status === "fulfilled") {
        const hydrated = historyResult.value.map((message) => normalizeHistoryMessage(message)).filter((message): message is ChatMessage => message !== null);
        setMessages(hydrated.length > 0 ? hydrated : []);
      } else {
        setMessages([]);
      }
      if (agentsResult.status === "fulfilled") {
        const agents = agentsResult.value;
        if (agents.length > 0) setGwAgentId(agents[0].id);
        const agentIdForFiles = agents.length > 0 ? agents[0].id : "main";
        try {
          const filesList = await gateway.filesList(agentIdForFiles);
          if (!cancelled) setFiles(filesList);
        } catch {}
      } else {
        setFiles([]);
      }
      if (sessionsRes.status === "fulfilled") setSessions(sessionsRes.value as Array<Record<string, unknown>>);
      if (cronRes.status === "fulfilled") setCronJobs(cronRes.value as Array<Record<string, unknown>>);
      if (modelsRes.status === "fulfilled") setModels(modelsRes.value as Array<Record<string, unknown>>);
    })();
    return () => { cancelled = true; };
  }, [gateway]);

  useEffect(() => {
    if (status !== "disconnected") return;
    setMessages([]);
    setFiles([]);
    setConfig(null);
    setConfigSchema(null);
    setSending(false);
    setGwAgentId("main");
    setPendingAttachments([]);
    setPendingFiles([]);
    setSessions([]);
    setCronJobs([]);
    setModels([]);
    setActivityFeed([]);
  }, [status]);

  const addPendingMessage = useCallback((message: string) => {
    setPendingInput((prev) => [...prev, message]);
  }, []);

  const addAttachments = useCallback((files: FileList) => {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        if (!base64) return;
        setPendingAttachments((prev) => [...prev, { type: "image", mimeType: file.type, content: base64, fileName: file.name }]);
      };
      reader.readAsDataURL(file);
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
    if (!gateway) throw new Error("Not connected");
    const nextInput = typeof overrideInput === "string" ? overrideInput : input;
    const nextAttachments = typeof overrideInput === "string" ? [] : pendingAttachments;
    const nextFiles = typeof overrideInput === "string" ? [] : pendingFiles;
    if ((!nextInput.trim() && nextAttachments.length === 0 && nextFiles.length === 0) || sending) return;

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

    try {
      await gateway.sendChat(agentMessage || "What's in this image?", "main", undefined, attachments.length > 0 ? attachments : undefined);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [...prev, { role: "system", content: `Error: ${errMsg}`, timestamp: Date.now() }]);
      appendActivity({ type: "error", action: "Send failed", detail: errMsg });
      setSending(false);
    }
  }, [gateway, input, pendingAttachments, pendingFiles, sending, appendActivity]);

  useEffect(() => {
    if (!sending && pendingInput.length > 0) {
      const nextMessage = pendingInput[0];
      setPendingInput((prev) => prev.slice(1));
      void sendMessage(nextMessage);
    }
  }, [sending, pendingInput, sendMessage]);

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
    const keys = Object.keys(patch);
    appendActivity({ type: "system", action: "Config updated", detail: keys.length > 0 ? keys.slice(0, 3).join(", ") + (keys.length > 3 ? `, +${keys.length - 3}` : "") : "" });
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

  return {
    gateway,
    status,
    error,
    connected: status === "connected",
    connecting: status === "connecting",
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
    channelsStatus,
    pendingFiles,
    pendingAttachments,
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
  };
}
