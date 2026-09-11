import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CodingAgentAcpClient,
  type ContentBlock,
  type RequestPermissionRequest,
  type SessionNotification,
} from "../../ts-sdk/src/acp.ts";
import type { AcpLease } from "../../ts-sdk/src/acp-pool.ts";
import { acquireAcpClient, agentTtsVoice, type AgentSummary, type RuntimeChatEvent } from "./api";
import { RUNNING, runtimeFamily } from "./agent-utils";
import { ActivityTrace, type ActivityEntry } from "./activity-trace";
import { usageUpdateText } from "./usage";
import {
  ChatTraceFolder,
  detailOf,
  genId,
  imageMarkdownOf,
  mergeDiffs,
  runtimeMessageToChat,
  settleOpenToolCalls,
  toolDiffsOf,
  type ChatMessage,
  type MessageAttachment,
  type PlanEntry,
  type ToolCallEntry,
} from "./chat-trace";
import { abortRuntimeChat, runtimeChatCapability, runtimeChatHistory, streamRuntimeChatMessage } from "./runtime-client";
import { runtimeStreamSink, type RuntimeStreamSink } from "./runtime-stream";
import { readAloud } from "./lib/read-aloud";

export type { ChatMessage, MessageAttachment, PlanEntry, ToolCallEntry } from "./chat-trace";
export type { ActivityEntry } from "./activity-trace";

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

function runtimeToolCallId(event: RuntimeChatEvent): string | undefined {
  const data = event.data ?? {};
  const id = data.toolCallId ?? data.tool_call_id ?? data.callId ?? data.call_id ?? data.id ?? event.eventId;
  if (typeof id === "string" && id) return id;
  const name = data.name ?? data.tool_name ?? data.title;
  return typeof name === "string" && name ? `tool:${name}` : undefined;
}

function runtimeToolActivityTitle(event: RuntimeChatEvent) {
  const data = event.data ?? {};
  const title = data.title ?? data.name ?? data.toolName ?? data.tool_name;
  return typeof title === "string" && title ? title : "Tool call";
}

export function useAgentChat(agent: AgentSummary | null, sessionNonce = 0) {
  const agentId = agent?.id ?? null;
  const runtime = agent?.runtime ?? null;
  const running = agent?.state === RUNNING;
  const supportsAcp = runtimeFamily(runtime) === "acp";
  // Only families whose chat is carried by a canonical SDK session
  // (OpenClaw, Hermes — see runtime-client.ts) mount one.
  const supportsRuntimeSession = runtimeChatCapability(agent).transport === "session";

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
  const leaseRef = useRef<AcpLease | null>(null);
  const subsRef = useRef<{ offUpdate: () => void; offClose: () => void } | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const mountKeyRef = useRef<string | null>(null);
  const activityTraceRef = useRef(new ActivityTrace());
  const pendingUserEchoRef = useRef<string | null>(null);
  /** The in-flight runtime send, so Stop can abort the run it is streaming. */
  const runtimeSendRef = useRef<{ agentId: string; sink: RuntimeStreamSink } | null>(null);
  /**
   * Accumulated agent reply text for the in-flight turn (read-aloud source).
   * Reset on each send; ACP chunks append in `fold`, runtime content events in
   * `foldRuntimeEvent`.
   */
  const turnReplyRef = useRef("");
  /** A cancelled turn is never read aloud, even if its stream ends cleanly. */
  const suppressReadRef = useRef(false);

  useEffect(() => {
    latestAgentRef.current = agent;
  }, [agent]);

  // Switching agents or unmounting the pane silences any in-flight read; the
  // next chat reads for itself.
  useEffect(() => {
    return () => readAloud.stop();
  }, [agentId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const fold = useCallback((notification: SessionNotification) => {
    const update = notification.update as Record<string, unknown>;
    const kind = update.sessionUpdate as string;

    const pushActivity = (entry: Parameters<ActivityTrace["addNote"]>[0]) =>
      setActivity(activityTraceRef.current.addNote(entry));

    if (kind === "available_commands_update") {
      const list = (update.availableCommands as SlashCommand[]) ?? [];
      setCommands(list);
      return;
    }
    if (kind === "usage_update") {
      pushActivity({
        kind: "usage",
        title: usageUpdateText({
          used: update.used as number | undefined,
          size: update.size as number | undefined,
          cost: update.cost as { amount?: number; currency?: string } | undefined,
        }),
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
      const openAssistant = (forceNew = false): ChatMessage => {
        const last = next[next.length - 1];
        if (last?.role === "assistant" && !forceNew) return last;
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
        const image = imageMarkdownOf(update.content);
        if (image) {
          const last = next[next.length - 1];
          if (last?.role === "user") {
            replaceLast({ ...last, text: `${last.text}\n\n${image}\n\n` });
          } else {
            next.push({
              id: genId(),
              role: "user",
              text: image,
              thoughts: [],
              toolCalls: [],
              plan: [],
              ts: Date.now(),
            });
          }
          return next;
        }
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
        if (text) turnReplyRef.current += text;
        const image = imageMarkdownOf(update.content);
        const appended = text || (image ? `\n\n${image}\n\n` : "");
        const last = next[next.length - 1];
        const newSegment = last?.role === "assistant" && last.text.trim().length > 0 && last.toolCalls.length > 0;
        const current = openAssistant(newSegment);
        replaceLast({ ...current, text: current.text + appended });
        if (text) setActivity(activityTraceRef.current.appendReplyText(text));
        return next;
      }
      if (kind === "agent_thought_chunk") {
        const text = textOf(update.content);
        const last = next[next.length - 1];
        const newSegment = last?.role === "assistant" && last.text.trim().length > 0;
        const current = openAssistant(newSegment);
        const thoughts =
          current.thoughts.length === 0
            ? [text]
            : [
                ...current.thoughts.slice(0, -1),
                current.thoughts[current.thoughts.length - 1] + text,
              ];
        replaceLast({ ...current, thoughts });
        setActivity(activityTraceRef.current.appendThinkingChunk(text));
        return next;
      }
      if (kind === "tool_call") {
        const rawId = update.toolCallId ?? update.tool_call_id ?? update.callId ?? update.call_id ?? update.id;
        const callId = typeof rawId === "string" && rawId ? rawId : undefined;
        const title = (update.title as string) ?? "Tool call";
        const tool: ToolCallEntry = {
          id: callId ?? genId(),
          title,
          kind: update.kind as string | undefined,
          status: (update.status as string) ?? "pending",
          detail: detailOf(update.rawInput),
          diffs: toolDiffsOf(update.rawInput, update.content),
        };
        const last = next[next.length - 1];
        const newSegment = last?.role === "assistant" && last.text.trim().length > 0;
        const current = openAssistant(newSegment);
        replaceLast({ ...current, toolCalls: [...current.toolCalls, tool] });
        setActivity(
          activityTraceRef.current.startToolCall({
            callId,
            title,
            detail: tool.detail,
            status: tool.status,
          }),
        );
        setLastAction(title);
        return next;
      }
      if (kind === "tool_call_update") {
        const rawId = update.toolCallId ?? update.tool_call_id ?? update.callId ?? update.call_id ?? update.id;
        const callId = typeof rawId === "string" && rawId ? rawId : undefined;
        const status = update.status as string | undefined;
        const done = status === "completed" || status === "failed";
        const startedAt = activityTraceRef.current.toolStartedAt(callId);
        const durationMs = done && startedAt != null ? Date.now() - startedAt : undefined;
        // Patch semantics: a tool_call_update carries only the fields that
        // changed. Merge any newly provided detail (rawInput / content) so the
        // row becomes expandable, not just a status flip.
        const updatedDetail =
          detailOf(update.rawInput) ?? detailOf(update.content) ?? detailOf(update.output);
        const updatedDiffs = toolDiffsOf(update.content, update.rawInput, update.output);
        let handled = false;
        if (callId) {
          for (let i = next.length - 1; i >= 0; i -= 1) {
            const message = next[i];
            if (message.role !== "assistant" || !message.toolCalls.some((t) => t.id === callId)) continue;
            next[i] = {
              ...message,
              toolCalls: message.toolCalls.map((t) =>
                t.id === callId
                  ? {
                      ...t,
                      status: status ?? t.status,
                      durationMs: durationMs ?? t.durationMs,
                      detail: updatedDetail ?? t.detail,
                      diffs: mergeDiffs(t.diffs, updatedDiffs),
                    }
                  : t,
              ),
            };
            handled = true;
            break;
          }
        }
        if (!handled && done) {
          for (const message of next) {
            if (message.role !== "assistant") continue;
            const index = message.toolCalls.findIndex(
              (t) => t.status === "pending" || t.status === "in_progress",
            );
            if (index < 0) continue;
            next[next.indexOf(message)] = {
              ...message,
              toolCalls: message.toolCalls.map((t, i) =>
                i === index
                  ? { ...t, status: status ?? t.status, detail: updatedDetail ?? t.detail, diffs: mergeDiffs(t.diffs, updatedDiffs) }
                  : t,
              ),
            };
            break;
          }
        }
        if (status) {
          setActivity(activityTraceRef.current.updateToolCall({ callId, status }));
        }
        return next;
      }
      return next;
    });
  }, []);

  const foldRuntimeEvent = useCallback((event: RuntimeChatEvent) => {
    if ((event.type === "content" || event.type === "commentary") && event.text) {
      setActivity(activityTraceRef.current.appendReplyText(event.text ?? ""));
    }
    if ((event.type === "content" || event.type === "commentary") && event.text) {
      turnReplyRef.current = event.replace === true ? event.text : turnReplyRef.current + event.text;
    }
    if (event.type === "thinking" || event.type === "reasoning") {
      const text = event.text ?? "";
      if (text) {
        setActivity(activityTraceRef.current.appendThinkingChunk(text, event.replace === true));
      }
    }
    if (event.type === "tool_call") {
      const data = event.data ?? {};
      const callId = runtimeToolCallId(event);
      const title = runtimeToolActivityTitle(event);
      const detail = detailOf(data.args ?? data.arguments ?? data.input ?? data.rawInput ?? data);
      setActivity(activityTraceRef.current.startToolCall({ callId, title, detail, status: "in_progress" }));
    }
    if (event.type === "tool_result") {
      const callId = runtimeToolCallId(event);
      const title = runtimeToolActivityTitle(event);
      const failed = event.data?.isError === true || event.data?.error === true;
      setActivity(
        activityTraceRef.current.updateToolCall({
          callId,
          status: failed ? "failed" : "completed",
          createTitle: title,
        }),
      );
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
      activityTraceRef.current.clear();
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
      activityTraceRef.current.clear();
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
          setActivity(activityTraceRef.current.addNote({ kind: "note", title: `History unavailable: ${message}` }));
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
      activityTraceRef.current.clear();
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
    activityTraceRef.current.clear();
    setActivity([]);
    setApprovals([]);
    setCommands([]);
    setLastAction(null);

    const connect = async () => {
      const lease = await acquireAcpClient(agentId);
      const client = lease.client;
      if (cancelled || generationRef.current !== generation) {
        lease.release();
        return;
      }
      leaseRef.current = lease;
      clientRef.current = client;
      const offUpdate = client.addUpdateListener((notification) => {
        if (generationRef.current === generation) fold(notification);
      });
      client.setPermissionHandler((params: RequestPermissionRequest) =>
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
      );
      const offClose = client.addCloseListener((event) => {
        if (generationRef.current !== generation) return;
        setConnected(false);
        setPhase("error");
        setError(event.reason || `Connection closed (${event.code})`);
      });
      subsRef.current = { offUpdate, offClose };

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
      activityTraceRef.current.clear();
      traceFolderRef.current.clear();
      subsRef.current?.offUpdate();
      subsRef.current?.offClose();
      subsRef.current = null;
      clientRef.current?.setPermissionHandler(null);
      clientRef.current = null;
      leaseRef.current?.release();
      leaseRef.current = null;
    };
  }, [agentId, running, runtime, supportsAcp, supportsRuntimeSession, retryNonce, sessionNonce, fold]);

  const send = useCallback(
    async (text: string, attachments: MessageAttachment[] = []) => {
      const prompt = text.trim();
      if ((!prompt && attachments.length === 0) || !agentId) return;
      // The mount generation at send time. While the stream is in flight the
      // agent can change underneath us; events and post-stream writes from a
      // superseded mount must not land in its successor's transcript (the ACP
      // path guards its callback the same way, at its own dispatch site).
      const generation = generationRef.current;
      const isCurrent = () => generationRef.current === generation;
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: "user",
          text: prompt,
          ...(attachments.length ? { attachments } : {}),
          thoughts: [],
          toolCalls: [],
          plan: [],
          ts: Date.now(),
        },
      ]);
      pendingUserEchoRef.current = prompt;
      // A new turn supersedes any in-flight read: the old reply trails off and
      // the next one reads fresh.
      turnReplyRef.current = "";
      suppressReadRef.current = false;
      readAloud.stop();
      setBusy(true);
      try {
        const currentAgent = latestAgentRef.current;
        if (supportsRuntimeSession && currentAgent) {
          if (attachments.length) throw new Error("File attachments need an ACP-capable agent; this runtime only accepts text.");
          if (mountState !== "MOUNTED") throw new Error("Chat is still mounting. Try again in a moment.");
          const selectedRuntimeSessionKey = localStorage.getItem(runtimeSessionKey(currentAgent.id));
          const sink = runtimeStreamSink(selectedRuntimeSessionKey ?? "main", isCurrent, foldRuntimeEvent);
          runtimeSendRef.current = { agentId: currentAgent.id, sink };
          try {
            await streamRuntimeChatMessage(currentAgent, prompt, sink.onEvent, selectedRuntimeSessionKey);
          } finally {
            if (runtimeSendRef.current?.sink === sink) runtimeSendRef.current = null;
          }
          if (!isCurrent()) return;
          setActivity(activityTraceRef.current.settleTurn("completed"));
          setMessages((prev) => settleOpenToolCalls(prev, "completed"));
          if (!suppressReadRef.current) {
            void readAloud.readIfEnabled(turnReplyRef.current, {
              voice: agentTtsVoice(latestAgentRef.current),
            });
          }
          return;
        }
        const client = clientRef.current;
        const sessionId = sessionIdRef.current;
        if (!client || !sessionId) return;
        let content: string | ContentBlock[] = prompt;
        if (attachments.length) {
          const caps = client.initializeResponse?.agentCapabilities?.promptCapabilities;
          const wantsFile = attachments.some((a) => !a.mimeType.startsWith("image/"));
          if (wantsFile && caps?.embeddedContext !== true) {
            throw new Error(`${latestAgentRef.current?.name ?? "This agent"} can't take file attachments, only images.`);
          }
          const blocks: ContentBlock[] = attachments.map((attachment) =>
            attachment.mimeType.startsWith("image/")
              ? { type: "image", data: attachment.dataBase64, mimeType: attachment.mimeType }
              : {
                  type: "resource",
                  resource: {
                    uri: `file:///${encodeURIComponent(attachment.name)}`,
                    blob: attachment.dataBase64,
                    mimeType: attachment.mimeType,
                  },
                },
          );
          if (prompt) blocks.push({ type: "text", text: prompt });
          content = blocks;
        }
        const response = await client.prompt(sessionId, content);
        if (!isCurrent()) return;
        setActivity(activityTraceRef.current.settleTurn("completed"));
        setMessages((prev) => settleOpenToolCalls(prev, "completed"));
        // Only a clean end_turn is read aloud — cancelled / refused / truncated
        // turns stay silent.
        if (response.stopReason === "end_turn" && !suppressReadRef.current) {
          void readAloud.readIfEnabled(turnReplyRef.current, {
            voice: agentTtsVoice(latestAgentRef.current),
          });
        }
      } catch (e) {
        pendingUserEchoRef.current = null;
        if (!isCurrent()) return;
        const message = e instanceof Error ? e.message : String(e);
        setMessages((prev) => [
          ...settleOpenToolCalls(prev, "interrupted"),
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
        activityTraceRef.current.settleTurn("interrupted");
        setActivity(activityTraceRef.current.addNote({ kind: "note", title: message }));
      } finally {
        setBusy(false);
      }
    },
    [agentId, foldRuntimeEvent, mountState, supportsRuntimeSession],
  );

  const cancel = useCallback(async () => {
    // A cancelled turn is never read aloud, and any read already speaking stops.
    suppressReadRef.current = true;
    readAloud.stop();
    // A runtime send has no clientRef session to cancel; abort the run the
    // stream was tracking (run id included when it reported one) and clear
    // busy now rather than waiting for the stream to notice.
    const runtimeSend = runtimeSendRef.current;
    const currentAgent = latestAgentRef.current;
    if (runtimeSend && currentAgent?.id === runtimeSend.agentId) {
      await abortRuntimeChat(currentAgent, runtimeSend.sink.sessionKey, runtimeSend.sink.runId).catch(() => {});
      setBusy(false);
    }
    const sessionId = sessionIdRef.current;
    if (clientRef.current && sessionId) {
      await clientRef.current.cancel(sessionId).catch(() => {});
    }
    setActivity(activityTraceRef.current.settleTurn("interrupted"));
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
