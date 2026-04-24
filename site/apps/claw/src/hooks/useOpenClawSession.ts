"use client";

import { useCallback, useEffect, useState } from "react";
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
  handleOpenClawSessionEvent,
  hydrateOpenClawSession,
} from "@/lib/openclaw-session";

export function useOpenClawSession(
  agent: OpenClawAgent | null,
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
  const [activityFeed, setActivityFeed] = useState<ActivityEntry[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatPendingFile[]>([]);

  useEffect(() => {
    let active = true;
    let localGateway: GatewayClient | null = null;
    let unsubscribeConnectionState: (() => void) | null = null;

    if (!enabled || !agent || typeof agent.connect !== "function") {
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

    void (async () => {
      try {
        await agent.waitForGatewayContext();
        const client = agent.gateway({
          autoApprovePairing: true,
          onClose: ({ error: closeError, code, reason }: GatewayCloseInfo) => {
            if (!active) return;
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
        localGateway = client;
        const applyState = (nextState: GatewayConnectionState) => {
          if (!active) return;
          setStatus(nextState);
          if (nextState === "connected") {
            setError(null);
          }
        };
        applyState(client.state);
        unsubscribeConnectionState = client.onConnectionState(applyState);
        setGateway(client);
        await client.connect();
        if (!active) {
          client.close();
          return;
        }
      } catch (e: unknown) {
        if (!active) return;
        setGateway(null);
        setStatus("disconnected");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      active = false;
      unsubscribeConnectionState?.();
      localGateway?.close();
    };
  }, [enabled, agent]);

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
      });
    });
    return unsubscribe;
  }, [gateway, appendActivity]);

  useEffect(() => {
    if (!gateway || status !== "connected") return;
    let cancelled = false;
    void (async () => {
      const hydrated = await hydrateOpenClawSession(gateway);
      if (cancelled) return;
      setConfig(hydrated.config);
      setConfigSchema(hydrated.configSchema);
      setMessages(hydrated.messages);
      setFiles(hydrated.files);
      setGwAgentId(hydrated.gwAgentId);
      setSessions(hydrated.sessions);
      setCronJobs(hydrated.cronJobs);
      setModels(hydrated.models);
    })();
    return () => { cancelled = true; };
  }, [gateway, status]);

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
