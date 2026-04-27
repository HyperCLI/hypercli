import type { Dispatch, SetStateAction } from "react";
import type { GatewayClient, GatewayEvent, OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import {
  type ChatMessage,
  type WorkspaceFile,
  maybeDecodeMojibake,
  normalizeHistoryMessage,
  normalizeLiveToolCall,
  normalizeLiveToolResult,
  upsertAssistantMessage,
} from "@/lib/openclaw-chat";

export type ActivityKind = "message" | "tool" | "connection" | "skill" | "cron" | "error" | "system";

export interface ActivityEntry {
  id: string;
  type: ActivityKind;
  action: string;
  detail: string;
  timestamp: number;
}

export function appendActivityEntry(
  prev: ActivityEntry[],
  entry: { type: ActivityKind; action: string; detail?: string; id?: string; timestamp?: number },
): ActivityEntry[] {
  const next = [...prev, {
    type: entry.type,
    action: entry.action,
    detail: entry.detail ?? "",
    id: entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: entry.timestamp ?? Date.now(),
  }];
  return next.length > 500 ? next.slice(next.length - 500) : next;
}

interface SessionEventContext {
  gateway: GatewayClient;
  gatewayEvent: GatewayEvent;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  setSessions: Dispatch<SetStateAction<Array<Record<string, unknown>>>>;
  appendActivity: (entry: { type: ActivityKind; action: string; detail?: string; id?: string; timestamp?: number }) => void;
}

export function handleOpenClawSessionEvent({
  gateway,
  gatewayEvent,
  setMessages,
  setSending,
  setSessions,
  appendActivity,
}: SessionEventContext): void {
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
}

export interface HydratedOpenClawSession {
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  messages: ChatMessage[];
  files: WorkspaceFile[];
  gwAgentId: string;
  sessions: Array<Record<string, unknown>>;
  cronJobs: Array<Record<string, unknown>>;
  models: Array<Record<string, unknown>>;
}

export async function hydrateOpenClawSession(gateway: GatewayClient): Promise<HydratedOpenClawSession> {
  const [cfgResult, schemaResult, historyResult, agentsResult, sessionsRes, cronRes, modelsRes] = await Promise.allSettled([
    gateway.configGet(),
    gateway.configSchema(),
    gateway.chatHistory("main", 200),
    gateway.agentsList(),
    gateway.sessionsList(),
    gateway.cronList(),
    gateway.modelsList(),
  ]);

  const agents = agentsResult.status === "fulfilled" ? agentsResult.value : [];
  const gwAgentId = agents.length > 0 ? agents[0].id : "main";
  let files: WorkspaceFile[] = [];
  if (agentsResult.status === "fulfilled") {
    try {
      files = await gateway.filesList(gwAgentId);
    } catch {}
  }

  return {
    config: cfgResult.status === "fulfilled" ? cfgResult.value : {},
    configSchema: schemaResult.status === "fulfilled" ? schemaResult.value : null,
    messages: historyResult.status === "fulfilled"
      ? historyResult.value.map((message) => normalizeHistoryMessage(message)).filter((message): message is ChatMessage => message !== null)
      : [],
    files,
    gwAgentId,
    sessions: sessionsRes.status === "fulfilled" ? sessionsRes.value as Array<Record<string, unknown>> : [],
    cronJobs: cronRes.status === "fulfilled" ? cronRes.value as Array<Record<string, unknown>> : [],
    models: modelsRes.status === "fulfilled" ? modelsRes.value as Array<Record<string, unknown>> : [],
  };
}
