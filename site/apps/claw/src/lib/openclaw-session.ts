import type { Dispatch, SetStateAction } from "react";
import type { GatewayClient, GatewayEvent, OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import { resolveOpenClawSessionKey } from "./openclaw-session-key";
import {
  type ChatMessage,
  type WorkspaceFile,
  isInternalHeartbeatMessage,
  normalizeHistoryMessage,
  normalizeLiveToolCall,
  normalizeLiveToolResult,
  sanitizeChatDisplayText,
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

function formatSessionToolValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return sanitizeChatDisplayText(value);
  try {
    return sanitizeChatDisplayText(JSON.stringify(value, null, 2));
  } catch {
    return sanitizeChatDisplayText(String(value));
  }
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
        const args = formatSessionToolValue(data.args);
        setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: "", toolCalls: [{ ...(toolCallId ? { id: toolCallId } : {}), name: toolName, args }], timestamp: Date.now() }));
      } else if (phase === "result" && toolName) {
        const meta = (data.meta as string) || "";
        const isError = Boolean(data.isError);
        const resultText = isError ? `Error: ${sanitizeChatDisplayText(meta)}` : sanitizeChatDisplayText(meta);
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
    const text = sanitizeChatDisplayText((payload as Record<string, unknown>).text as string ?? "");
    if (text) setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: text, timestamp: Date.now() }));
  } else if (event === "chat.thinking") {
    const text = sanitizeChatDisplayText((payload as Record<string, unknown>).text as string ?? "");
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
    if (tc && !isInternalHeartbeatMessage({ toolCalls: [tc] })) {
      appendActivity({ type: "tool", action: tc.name, detail: tc.args || "" });
    }
  } else if (event === "chat.tool_result") {
    const tc = normalizeLiveToolResult(payload as Record<string, unknown>);
    if (tc?.result && !isInternalHeartbeatMessage({ toolCalls: [tc] })) {
      appendActivity({ type: "tool", action: `${tc.name} → result`, detail: tc.result });
    }
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

function isUuidLikeAgentId(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function resolveGatewayAgentId(agents: Array<Record<string, unknown>>): string {
  const mainAgent = agents.find((agent) => agent.id === "main")?.id;
  if (typeof mainAgent === "string") return mainAgent;

  const namedAgent = agents.find((agent) => typeof agent.id === "string" && !isUuidLikeAgentId(agent.id))?.id;
  if (typeof namedAgent === "string") return namedAgent;

  return "main";
}

export async function hydrateOpenClawSession(
  gateway: GatewayClient,
  preferredAgentId?: string | null,
): Promise<HydratedOpenClawSession> {
  const normalizedPreferredAgentId = (preferredAgentId ?? "").trim();
  const sessionKey = resolveOpenClawSessionKey(normalizedPreferredAgentId);
  const [cfgResult, schemaResult, historyResult, agentsResult, sessionsRes, cronRes, modelsRes] = await Promise.allSettled([
    gateway.configGet(),
    gateway.configSchema(),
    gateway.chatHistory(sessionKey, 200),
    gateway.agentsList(),
    gateway.sessionsList(),
    gateway.cronList(),
    gateway.modelsList(),
  ]);

  const agents = agentsResult.status === "fulfilled" ? agentsResult.value : [];
  const resolvedGatewayAgentId = resolveGatewayAgentId(agents);
  let files: WorkspaceFile[] = [];
  if (agentsResult.status === "fulfilled") {
    try {
      files = await gateway.filesList(resolvedGatewayAgentId);
    } catch {}
  }

  return {
    config: cfgResult.status === "fulfilled" ? cfgResult.value : {},
    configSchema: schemaResult.status === "fulfilled" ? schemaResult.value : null,
    messages: historyResult.status === "fulfilled"
      ? historyResult.value.map((message) => normalizeHistoryMessage(message)).filter((message): message is ChatMessage => message !== null)
      : [],
    files,
    gwAgentId: resolvedGatewayAgentId,
    sessions: sessionsRes.status === "fulfilled" ? sessionsRes.value as Array<Record<string, unknown>> : [],
    cronJobs: cronRes.status === "fulfilled" ? cronRes.value as Array<Record<string, unknown>> : [],
    models: modelsRes.status === "fulfilled" ? modelsRes.value as Array<Record<string, unknown>> : [],
  };
}
