import { useCallback, useEffect, useRef, useState } from "react";
import { CodingAgentAcpClient } from "../../ts-sdk/src/acp.ts";
import type { RequestPermissionRequest, SessionNotification } from "../../ts-sdk/node_modules/@agentclientprotocol/sdk/dist/acp.d.ts";
import { type AgentSummary, type RuntimeChatEvent } from "./api";
import { RUNNING, runtimeFamily } from "./agent-utils";
import {
  ChatTraceFolder,
  detailOf,
  genId,
  runtimeMessageToChat,
  type ChatMessage,
  type PlanEntry,
  type ToolCallEntry,
} from "./chat-trace";
import { runtimeChatHistory, streamRuntimeChatMessage } from "./runtime-client";

export type { ChatMessage, PlanEntry, ToolCallEntry } from "./chat-trace";

export interface ActivityEntry {
  id: string;
  ts: number;
  kind: "tool" | "thinking" | "reply" | "usage" | "note";
  title: string;
  detail?: string;
  status?: string;
  durationMs?: number;
}

export interface ApprovalOption {
  optionId: string;
  name: string;
  kind?: string;
}

export interface ApprovalRequest {
  toolCallId: string;
  title: string;
  kind?: string;
  options: ApprovalOption[];
  respond: (optionId: string | null) => void;
}

export interface SlashCommand {
  name: string;
  description?: string;
}

export type ChatPhase =
  | "idle"
  | "stopped"
  | "connecting"
  | "ready"
  | "error";

export type AgentChatMountState =
  | "STOPPED"
  | "STARTING"
  | "READY"
  | "MOUNTED"
  | "STOPPING";

const RUNTIME_CHAT_CACHE = new Map<string, ChatMessage[]>();

function textOf(content: unknown): string {
  if (
    content &&
    typeof content === "object" &&
    (content as { type?: string }).type === "text"
  ) {
    return (content as { text?: string }).text ?? "";
  }
  return "";
}

function sessionKey(agentId: string) {
  return `acp-session:${agentId}`;
}

function runtimeSessionKey(agentId: string) {
  return `runtime-session:${agentId}`;
}

function runtimeToolActivityId(event: RuntimeChatEvent) {
  const data = event.data ?? {};
  const id = data.toolCallId ?? data.tool_call_id ?? data.callId ?? data.call_id ?? data.id ?? event.eventId;
  return typeof id === "string" && id ? id : genId();
}

function runtimeToolActivityTitle(event: RuntimeChatEvent) {
  const data = event.data ?? {};
  const title = data.title ?? data.name ?? data.toolName ?? data.tool_name;
  return typeof title === "string" && title ? title : "Tool call";
}

function appendReplyActivity(prev: ActivityEntry[], text: string) {
  if (!text.trim()) return prev;
  const last = prev[prev.length - 1];
  if (last?.kind === "reply" && last.status === "in_progress") {
    const next = [...prev];
    next[next.length - 1] = {
      ...last,
      ts: Date.now(),
      detail: `${last.detail ?? ""}${text}`,
    };
    return next;
  }
  return [
    ...prev,
    { id: genId(), ts: Date.now(), kind: "reply" as const, title: "Reply", detail: text, status: "in_progress" },
  ].slice(-400);
}

function completeReplyActivity(prev: ActivityEntry[]) {
  return prev.map((entry) =>
    entry.kind === "reply" && entry.status === "in_progress"
      ? { ...entry, status: "completed" }
      : entry,
  );
}

export function useAgentChat(agent: AgentSummary | null, sessionNonce = 0) {
  const agentId = agent?.id ?? null;
  const runtime = agent?.runtime ?? null;
  const running = agent?.state === RUNNING;
  const supportsAcp = runtimeFamily(runtime) === "acp";
  const supportsOpenClaw = runtimeFamily(runtime) === "openclaw";
  const supportsHermes = runtimeFamily(runtime) === "hermes";
  const supportsRuntimeSession = supportsOpenClaw || supportsHermes;

  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [mountState, setMountState] = useState<AgentChatMountState>("STOPPED");
  const [retryNonce, setRetryNonce] = useState(0);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const latestAgentRef = useRef<AgentSummary | null>(agent);
  const messagesRef = useRef<ChatMessage[]>([]);
  const traceFolderRef = useRef(new ChatTraceFolder());
  const clientRef = useRef<CodingAgentAcpClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const mountKeyRef = useRef<string | null>(null);
  const toolStartRef = useRef(new Map<string, number>());
  const toolActivityRef = useRef(new Map<string, string>());
  const pendingUserEchoRef = useRef<string | null>(null);

  useEffect(() => {
    latestAgentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const fold = useCallback((notification: SessionNotification) => {
    const update = notification.update as Record<string, unknown>;
    const kind = update.sessionUpdate as string;

    const pushActivity = (entry: Omit<ActivityEntry, "id" | "ts">) =>
      setActivity((prev) =>
        [...prev, { ...entry, id: genId(), ts: Date.now() }].slice(-400),
      );

    if (kind === "available_commands_update") {
      const list = (update.availableCommands as SlashCommand[]) ?? [];
      setCommands(list);
      return;
    }
    if (kind === "usage_update") {
      const used = update.used as number | undefined;
      const size = update.size as number | undefined;
      const cost = update.cost as { amount?: number; currency?: string } | undefined;
      const costText = cost?.amount != null ? ` ($${cost.amount.toFixed(4)} ${cost.currency ?? "USD"})` : "";
      pushActivity({
        kind: "usage",
        title: `Usage · Tokens: ${used ?? "?"}/${size ?? "?"}${costText}`,
      });
      return;
    }
    if (kind === "plan") {
      const entries = (update.entries as PlanEntry[]) ?? [];
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = { ...last, plan: entries };
        }
        return next;
      });
      return;
    }
    if (kind === "current_mode_update") {
      const mode = update.currentModeId as string | undefined;
      if (mode) pushActivity({ kind: "note", title: `Mode → ${mode}` });
      return;
    }

    setMessages((prev) => {
      const next = [...prev];
      const openAssistant = (): ChatMessage => {
        const last = next[next.length - 1];
        if (last?.role === "assistant") return last;
        const message: ChatMessage = {
          id: genId(),
          role: "assistant",
          text: "",
          thoughts: [],
          toolCalls: [],
          plan: [],
          ts: Date.now(),
        };
        next.push(message);
        return message;
      };
      const replaceLast = (message: ChatMessage) => {
        next[next.length - 1] = message;
      };

      if (kind === "user_message_chunk") {
        const text = textOf(update.content);
        const pendingEcho = pendingUserEchoRef.current;
        if (pendingEcho) {
          if (pendingEcho.startsWith(text)) {
            pendingUserEchoRef.current = pendingEcho.slice(text.length) || null;
            return next;
          }
          if (text.startsWith(pendingEcho)) {
            pendingUserEchoRef.current = null;
            return next;
          }
          pendingUserEchoRef.current = null;
        }
        const last = next[next.length - 1];
        if (last?.role === "user") {
          replaceLast({ ...last, text: last.text + text });
        } else {
          next.push({
            id: genId(),
            role: "user",
            text,
            thoughts: [],
            toolCalls: [],
            plan: [],
            ts: Date.now(),
          });
        }
        return next;
      }
      if (kind === "agent_message_chunk") {
        const text = textOf(update.content);
        const current = openAssistant();
        replaceLast({ ...current, text: current.text + text });
        setActivity((prevAct) => appendReplyActivity(prevAct, text));
        return next;
      }
      if (kind === "agent_thought_chunk") {
        const text = textOf(update.content);
        setActivity(completeReplyActivity);
        const current = openAssistant();
        const thoughts =
          current.thoughts.length === 0
            ? [text]
            : [
                ...current.thoughts.slice(0, -1),
                current.thoughts[current.thoughts.length - 1] + text,
              ];
        replaceLast({ ...current, thoughts });
        setActivity((prevAct) => {
          const last = prevAct[prevAct.length - 1];
          if (last?.kind === "thinking") {
            const copy = [...prevAct];
            copy[copy.length - 1] = { ...last, detail: (last.detail ?? "") + text };
            return copy;
          }
          return [
            ...prevAct,
            {
              id: genId(),
              ts: Date.now(),
              kind: "thinking" as const,
              title: "Thinking",
              detail: text,
            },
          ].slice(-400);
        });
        return next;
      }
      if (kind === "tool_call") {
        const rawId = update.toolCallId ?? update.tool_call_id ?? update.callId ?? update.call_id ?? update.id;
        const toolCallId = typeof rawId === "string" && rawId ? rawId : genId();
        const title = (update.title as string) ?? "Tool call";
        setActivity(completeReplyActivity);
        const tool: ToolCallEntry = {
          id: toolCallId,
          title,
          kind: update.kind as string | undefined,
          status: (update.status as string) ?? "pending",
          detail: detailOf(update.rawInput),
        };
        toolStartRef.current.set(toolCallId, Date.now());
        const current = openAssistant();
        replaceLast({ ...current, toolCalls: [...current.toolCalls, tool] });
        const activityId = genId();
        toolActivityRef.current.set(toolCallId, activityId);
        setActivity((prevAct) =>
          [
            ...prevAct,
            {
              id: activityId,
              ts: Date.now(),
              kind: "tool" as const,
              title,
              detail: tool.detail,
              status: tool.status,
            },
          ].slice(-400),
        );
        setLastAction(title);
        return next;
      }
      if (kind === "tool_call_update") {
        const rawId = update.toolCallId ?? update.tool_call_id ?? update.callId ?? update.call_id ?? update.id;
        const toolCallId = typeof rawId === "string" ? rawId : "";
        const status = update.status as string | undefined;
        const started = toolStartRef.current.get(toolCallId);
        const done = status === "completed" || status === "failed";
        const durationMs =
          done && started ? Date.now() - started : undefined;
        const last = next[next.length - 1];
        if (last) {
          replaceLast({
            ...last,
            toolCalls: last.toolCalls.map((t) =>
              t.id === toolCallId
                ? { ...t, status: status ?? t.status, durationMs: durationMs ?? t.durationMs }
                : t,
            ),
          });
        }
        if (status) {
          const entryId = toolActivityRef.current.get(toolCallId);
          if (entryId) {
            setActivity((prevAct) =>
              prevAct.map((entry) =>
                entry.id === entryId
                  ? { ...entry, status, durationMs: durationMs ?? entry.durationMs }
                  : entry,
              ),
            );
          } else if (done) {
            setActivity((prevAct) =>
              prevAct.map((entry) =>
                entry.kind === "tool" && (entry.status === "pending" || entry.status === "in_progress")
                  ? { ...entry, status, durationMs: durationMs ?? entry.durationMs }
                  : entry,
              ),
            );
          }
        }
        return next;
      }
      return next;
    });
  }, []);

  const foldRuntimeEvent = useCallback((event: RuntimeChatEvent) => {
    if ((event.type === "content" || event.type === "commentary") && event.text) {
      setActivity((prev) => appendReplyActivity(prev, event.text ?? ""));
    }
    if (event.type === "thinking" || event.type === "reasoning") {
      const text = event.text ?? "";
      if (text) {
        setActivity((prev) => {
          const last = prev[prev.length - 1];
          if (last?.kind === "thinking") {
            const next = [...prev];
            next[next.length - 1] = {
              ...last,
              ts: Date.now(),
              detail: event.replace ? text : `${last.detail ?? ""}${text}`,
            };
            return next;
          }
          return [...prev, { id: genId(), ts: Date.now(), kind: "thinking" as const, title: "Thinking", detail: text }].slice(-400);
        });
      }
    }
    if (event.type === "tool_call") {
      const data = event.data ?? {};
      const toolCallId = runtimeToolActivityId(event);
      const title = runtimeToolActivityTitle(event);
      const detail = detailOf(data.args ?? data.arguments ?? data.input ?? data.rawInput ?? data);
      toolStartRef.current.set(toolCallId, Date.now());
      const activityId = genId();
      toolActivityRef.current.set(toolCallId, activityId);
      setActivity((prev) => [
        ...prev,
        { id: activityId, ts: Date.now(), kind: "tool" as const, title, detail, status: "in_progress" },
      ].slice(-400));
    }
    if (event.type === "tool_result") {
      const toolCallId = runtimeToolActivityId(event);
      const title = runtimeToolActivityTitle(event);
      const started = toolStartRef.current.get(toolCallId);
      const failed = event.data?.isError === true || event.data?.error === true;
      const durationMs = started ? Date.now() - started : undefined;
      const entryId = toolActivityRef.current.get(toolCallId);
      setActivity((prev) => {
        if (!entryId) {
          return [...prev, {
            id: genId(),
            ts: Date.now(),
            kind: "tool" as const,
            title,
            status: failed ? "failed" : "completed",
            durationMs,
          }].slice(-400);
        }
        return prev.map((entry) => entry.id === entryId ? {
          ...entry,
          ts: Date.now(),
          title: title === "Tool call" ? entry.title : title,
          status: failed ? "failed" : "completed",
          durationMs: durationMs ?? entry.durationMs,
        } : entry);
      });
    }
    setMessages((prev) => {
      const result = traceFolderRef.current.foldRuntimeEvent(prev, event);
      if (result.lastAction) setLastAction(result.lastAction);
      return result.messages;
    });
  }, []);

  useEffect(() => {
    const selectedRuntimeSessionKey = agentId ? localStorage.getItem(runtimeSessionKey(agentId)) : null;
    const mountKey = agentId && runtime ? `${agentId}:${runtime}:${selectedRuntimeSessionKey ?? "main"}:${sessionNonce}` : agentId;
    if (!agentId || !running) {
      setMountState("STOPPING");
      setPhase(agentId && !running ? "stopped" : "idle");
      setMessages([]);
      setActivity([]);
      setApprovals([]);
      setCommands([]);
      setBusy(false);
      setConnected(false);
      setLastAction(null);
      traceFolderRef.current.clear();
      setMountState("STOPPED");
      mountKeyRef.current = null;
      return;
    }

    if (supportsRuntimeSession) {
      const currentAgent = latestAgentRef.current;
      if (!currentAgent) return;
      const generation = ++generationRef.current;
      const changedMount = mountKeyRef.current !== mountKey;
      if (changedMount && mountKeyRef.current && messagesRef.current.length > 0) {
        RUNTIME_CHAT_CACHE.set(mountKeyRef.current, messagesRef.current);
      }
      const cachedMessages = mountKey ? RUNTIME_CHAT_CACHE.get(mountKey) : undefined;
      mountKeyRef.current = mountKey;
      setMountState(cachedMessages ? "MOUNTED" : "STARTING");
      setPhase(cachedMessages ? "ready" : "connecting");
      setError(null);
      if (changedMount) setMessages(cachedMessages ?? []);
      if (changedMount) traceFolderRef.current.clear();
      setActivity([]);
      setApprovals([]);
      setCommands([]);
      setBusy(false);
      setConnected(true);
      setLastAction(null);
      setMountState("READY");
      setActiveSessionId(selectedRuntimeSessionKey ?? null);
      runtimeChatHistory(currentAgent, selectedRuntimeSessionKey)
        .then((history) => {
          if (generationRef.current !== generation) return;
          const hydrated = history.map(runtimeMessageToChat);
          if (mountKey) RUNTIME_CHAT_CACHE.set(mountKey, hydrated);
          setMessages((current) => (hydrated.length > 0 || changedMount ? hydrated : current));
          setPhase("ready");
          setMountState("MOUNTED");
        })
        .catch((e) => {
          if (generationRef.current !== generation) return;
          const message = e instanceof Error ? e.message : String(e);
          setPhase("ready");
          setMountState("MOUNTED");
          setActivity((prev) => [
            ...prev,
            { id: genId(), ts: Date.now(), kind: "note", title: `History unavailable: ${message}` },
          ]);
        });
      return () => {
        generationRef.current++;
        setConnected(false);
      };
    }

    if (!supportsAcp) {
      setPhase("idle");
      setMessages([]);
      setActivity([]);
      setApprovals([]);
      setCommands([]);
      setBusy(false);
      setConnected(false);
      setLastAction(null);
      traceFolderRef.current.clear();
      setMountState("STOPPED");
      return;
    }

    const generation = ++generationRef.current;
    let cancelled = false;
    const changedMount = mountKeyRef.current !== mountKey;
    mountKeyRef.current = mountKey;
    setMountState("STARTING");
    setPhase("connecting");
    setError(null);
    if (changedMount) setMessages([]);
    if (changedMount) traceFolderRef.current.clear();
    setActivity([]);
    setApprovals([]);
    setCommands([]);
    setLastAction(null);

    const connect = async () => {
      const ws = new URL("/__desktop_ng/acp", window.location.href);
      ws.protocol = ws.protocol === "https:" ? "wss:" : "ws:";
      ws.searchParams.set("agent_id", agentId);
      const url = ws.toString();

      const client = await CodingAgentAcpClient.connect(
        { url, token: "" },
        {
          clientInfo: { name: "hypercli-desktop-ng", version: "0.1.0" },
          onUpdate: (notification) => {
            if (generationRef.current === generation) fold(notification);
          },
          onPermissionRequest: (params: RequestPermissionRequest) =>
            new Promise((resolve) => {
              if (generationRef.current !== generation) {
                resolve({ outcome: { outcome: "cancelled" } });
                return;
              }
              const toolCall = params.toolCall as {
                toolCallId?: string;
                title?: string;
                kind?: string;
              };
              const request: ApprovalRequest = {
                toolCallId: toolCall.toolCallId ?? "",
                title: toolCall.title ?? "Permission requested",
                kind: toolCall.kind,
                options: (params.options ?? []) as ApprovalOption[],
                respond: (optionId) => {
                  setApprovals((prev) =>
                    prev.filter((a) => a.toolCallId !== request.toolCallId),
                  );
                  resolve(
                    optionId
                      ? { outcome: { outcome: "selected", optionId } }
                      : { outcome: { outcome: "cancelled" } },
                  );
                },
              };
              setApprovals((prev) => [...prev, request]);
            }),
          onError: () => {},
          onClose: (event) => {
            if (generationRef.current !== generation) return;
            setConnected(false);
            setPhase("error");
            setError(event.reason || `Connection closed (${event.code})`);
          },
        },
      );
      if (cancelled || generationRef.current !== generation) {
        client.close();
        return;
      }
      clientRef.current = client;
      setConnected(true);
      setMountState("READY");

      const stored = localStorage.getItem(sessionKey(agentId));
      const canLoad = client.initializeResponse?.agentCapabilities?.loadSession === true;
      let sessionId: string | null = null;
      if (stored && canLoad) {
        try {
          await client.loadSession(stored);
          sessionId = stored;
        } catch {
          localStorage.removeItem(sessionKey(agentId));
        }
      }
      if (!sessionId) {
        const created = await client.newSession();
        sessionId = created.sessionId;
        localStorage.setItem(sessionKey(agentId), sessionId);
      }
      sessionIdRef.current = sessionId;
      setActiveSessionId(sessionId);
      if (generationRef.current === generation) {
        setPhase("ready");
        setMountState("MOUNTED");
      }
    };

    connect().catch((e) => {
      if (generationRef.current !== generation) return;
      setPhase("error");
      setMountState("STOPPED");
      setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
      setMountState("STOPPING");
      generationRef.current++;
      sessionIdRef.current = null;
      toolStartRef.current.clear();
      toolActivityRef.current.clear();
      traceFolderRef.current.clear();
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [agentId, running, runtime, supportsAcp, supportsRuntimeSession, retryNonce, sessionNonce, fold]);

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || !agentId) return;
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: "user",
          text: prompt,
          thoughts: [],
          toolCalls: [],
          plan: [],
          ts: Date.now(),
        },
      ]);
      pendingUserEchoRef.current = prompt;
      setBusy(true);
      try {
        const currentAgent = latestAgentRef.current;
        if (supportsRuntimeSession && currentAgent) {
          if (mountState !== "MOUNTED") throw new Error("Chat is still mounting. Try again in a moment.");
          const selectedRuntimeSessionKey = localStorage.getItem(runtimeSessionKey(currentAgent.id));
          await streamRuntimeChatMessage(currentAgent, prompt, foldRuntimeEvent, selectedRuntimeSessionKey);
          setActivity(completeReplyActivity);
          return;
        }
        const client = clientRef.current;
        const sessionId = sessionIdRef.current;
        if (!client || !sessionId) return;
        await client.prompt(sessionId, prompt);
        setActivity(completeReplyActivity);
      } catch (e) {
        pendingUserEchoRef.current = null;
        const message = e instanceof Error ? e.message : String(e);
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: "assistant",
            text: message,
            error: true,
            thoughts: [],
            toolCalls: [],
            plan: [],
            ts: Date.now(),
          },
        ]);
        setActivity((prev) => [
          ...prev,
          {
            id: genId(),
            ts: Date.now(),
            kind: "note",
            title: message,
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [agentId, foldRuntimeEvent, mountState, supportsRuntimeSession],
  );

  const cancel = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (clientRef.current && sessionId) {
      await clientRef.current.cancel(sessionId).catch(() => {});
    }
  }, []);

  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  return {
    phase,
    error,
    messages,
    activity,
    approvals,
    commands,
    busy,
    connected,
    mountState,
    lastAction,
    activeSessionId,
    send,
    cancel,
    retry,
  };
}

export type AgentChat = ReturnType<typeof useAgentChat>;
