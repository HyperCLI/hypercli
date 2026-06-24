import type { Dispatch, SetStateAction } from "react";
import type { ChatEvent, GatewayClient, GatewayEvent, OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import {
  type OpenClawSessionRecord,
  findOpenClawSelectableSession,
  listOpenClawSessions,
  loadOpenClawChatHistory,
  normalizeOpenClawSessions,
  openClawEventMatchesSession,
  resolveOpenClawActiveSessionKey,
  resolveOpenClawGatewaySessionKey,
  sameOpenClawSessionKey,
} from "@/lib/openclaw-session-sdk-surface";
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
  gatewayEvent: GatewayEvent;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  setSessions: (sessions: OpenClawSessionRecord[]) => void;
  refreshSessions: () => void | Promise<unknown>;
  appendActivity: (entry: { type: ActivityKind; action: string; detail?: string; id?: string; timestamp?: number }) => void;
  activeSessionKey: string;
  suppressChatStreamEvents?: boolean;
}

interface ChatStreamEventContext {
  chatEvent: ChatEvent;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  appendActivity: (entry: { type: ActivityKind; action: string; detail?: string; id?: string; timestamp?: number }) => void;
}

function normalizeAbortSignal(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[.!]+$/, "")
    : "";
}

function isAbortSignal(value: unknown): boolean {
  const normalized = normalizeAbortSignal(value);
  return normalized === "abort" || normalized === "aborted" || normalized === "canceled" || normalized === "cancelled";
}

function isAbortedChatPayload(payload: Record<string, unknown>, text?: string): boolean {
  return (
    isAbortSignal(payload.state) ||
    isAbortSignal(payload.stopReason) ||
    isAbortSignal(payload.stop_reason) ||
    isAbortSignal(payload.reason) ||
    isAbortSignal(text)
  );
}

function appendReplyStoppedActivity(
  appendActivity: ChatStreamEventContext["appendActivity"],
): void {
  appendActivity({ type: "system", action: "Assistant reply stopped" });
}

function isGatewayChatStreamEvent(event: string, payload: unknown): boolean {
  if (event === "chat" || event.startsWith("chat.")) return true;
  if (event !== "agent") return false;
  const stream = String((payload as Record<string, unknown> | null)?.stream || "").toLowerCase();
  return stream === "tool" || stream === "lifecycle";
}

export function handleOpenClawChatStreamEvent({
  chatEvent,
  setMessages,
  setSending,
  appendActivity,
}: ChatStreamEventContext): void {
  const payload = chatEvent.data ?? {};

  if (chatEvent.type === "content") {
    const text = sanitizeChatDisplayText(chatEvent.text ?? "");
    if (text) setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: text, timestamp: Date.now() }));
  } else if (chatEvent.type === "thinking") {
    const text = sanitizeChatDisplayText(chatEvent.text ?? "");
    if (text) setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: "", thinking: text, timestamp: Date.now() }));
  } else if (chatEvent.type === "tool_call") {
    const toolCall = normalizeLiveToolCall(payload);
    if (toolCall) setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: "", toolCalls: [toolCall], timestamp: Date.now() }));
    if (toolCall && !isInternalHeartbeatMessage({ toolCalls: [toolCall] })) {
      appendActivity({ type: "tool", action: toolCall.name, detail: toolCall.args || "" });
    }
  } else if (chatEvent.type === "tool_result") {
    const toolResult = normalizeLiveToolResult(payload);
    if (toolResult) setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: "", toolCalls: [toolResult], timestamp: Date.now() }));
    if (toolResult?.result && !isInternalHeartbeatMessage({ toolCalls: [toolResult] })) {
      appendActivity({ type: "tool", action: `${toolResult.name} → result`, detail: toolResult.result });
    }
  } else if (chatEvent.type === "done") {
    const normalized = normalizeHistoryMessage(payload.message);
    if (normalized?.role === "assistant") setMessages((prev) => upsertAssistantMessage(prev, normalized));
    setSending(false);
    appendActivity({ type: "message", action: "Assistant response complete" });
  } else if (chatEvent.type === "error") {
    const message = chatEvent.text || "Unknown error";
    if (isAbortedChatPayload(payload, message)) {
      setSending(false);
      appendReplyStoppedActivity(appendActivity);
      return;
    }
    setSending(false);
    setMessages((prev) => [...prev, { role: "system", content: `Error: ${message}`, timestamp: Date.now() }]);
    appendActivity({ type: "error", action: "Error", detail: message });
  }
}

export function handleOpenClawSessionEvent({
  gatewayEvent,
  setMessages,
  setSending,
  setSessions,
  refreshSessions,
  appendActivity,
  activeSessionKey,
  suppressChatStreamEvents = false,
}: SessionEventContext): void {
  const event = gatewayEvent.event;
  const payload = gatewayEvent.payload ?? {};
  const payloadRecord = payload as Record<string, unknown>;

  if (isGatewayChatStreamEvent(event, payload) && !openClawEventMatchesSession(payload, activeSessionKey)) {
    return;
  }

  if (suppressChatStreamEvents && isGatewayChatStreamEvent(event, payload)) {
    return;
  }

  if (event === "agent" && String((payload as Record<string, unknown>).stream || "") === "tool") {
    const data = (payload as Record<string, unknown>).data as Record<string, unknown> | undefined;
    if (data) {
      const phase = typeof data.phase === "string" ? data.phase.toLowerCase() : "";
      if (phase === "start") {
        const toolCall = normalizeLiveToolCall(data);
        if (toolCall) setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: "", toolCalls: [toolCall], timestamp: Date.now() }));
      } else if (phase === "result") {
        const toolResult = normalizeLiveToolResult(data);
        if (toolResult) {
          setMessages((prev) => upsertAssistantMessage(prev, { role: "assistant", content: "", toolCalls: [toolResult], timestamp: Date.now() }));
        }
      }
    }
  }

  if (event === "chat") {
    if (isAbortedChatPayload(payloadRecord)) {
      setSending(false);
      appendReplyStoppedActivity(appendActivity);
      return;
    }
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
    void refreshSessions();
  } else if (event === "sessions.updated") {
    const list = (payload as Record<string, unknown>).sessions;
    if (Array.isArray(list)) setSessions(normalizeOpenClawSessions(list));
  } else if (event === "chat.error") {
    const message = String(payloadRecord.message ?? "Unknown error");
    if (isAbortedChatPayload(payloadRecord, message)) {
      setSending(false);
      appendReplyStoppedActivity(appendActivity);
      return;
    }
    setSending(false);
    setMessages((prev) => [...prev, { role: "system", content: `Error: ${message}`, timestamp: Date.now() }]);
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
  gatewaySessionKey: string;
  activeSessionRecord: OpenClawSessionRecord | null;
  useLocalCacheFallback: boolean;
  sessions: OpenClawSessionRecord[];
  sessionsFetched: boolean;
  cronJobs: Array<Record<string, unknown>>;
  models: Array<Record<string, unknown>>;
}

export interface HydratedOpenClawConnection {
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  agents: Array<Record<string, unknown>>;
  files: WorkspaceFile[];
  gwAgentId: string;
  cronJobs: Array<Record<string, unknown>>;
  models: Array<Record<string, unknown>>;
}

interface HydratedOpenClawSessionList {
  sessions: OpenClawSessionRecord[];
  fetched: boolean;
}

const CANONICAL_GATEWAY_AGENT_ID = "main";

function isUuidLikeAgentId(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (value ?? "").trim()).filter(Boolean)));
}

function normalizeHistoryMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => normalizeHistoryMessage(message))
    .filter((message): message is ChatMessage => message !== null);
}

export async function refreshOpenClawChatMessages(
  gateway: GatewayClient,
  preferredAgentId?: string | null,
  activeSessionKey?: string | null,
  activeGatewaySessionKey?: string | null,
): Promise<ChatMessage[]> {
  const sessionKey = activeGatewaySessionKey?.trim() || resolveOpenClawActiveSessionKey((preferredAgentId ?? "").trim(), activeSessionKey);
  try {
    return normalizeHistoryMessages(await loadOpenClawChatHistory(gateway, sessionKey, 200));
  } catch {
    return [];
  }
}

function resolveGatewayAgentId(agents: Array<Record<string, unknown>>): string {
  const mainAgent = agents.find((agent) => agent.id === CANONICAL_GATEWAY_AGENT_ID)?.id;
  if (typeof mainAgent === "string") return mainAgent;

  const namedAgent = agents.find((agent) => typeof agent.id === "string" && !isUuidLikeAgentId(agent.id))?.id;
  if (typeof namedAgent === "string") return namedAgent;

  return CANONICAL_GATEWAY_AGENT_ID;
}

function legacySessionKeyCandidates(
  preferredAgentId: string,
  sessions: OpenClawSessionRecord[],
): string[] {
  const normalizedPreferredAgentId = preferredAgentId.trim();
  if (!normalizedPreferredAgentId || normalizedPreferredAgentId === CANONICAL_GATEWAY_AGENT_ID) return [];

  const legacyAgentPrefix = `agent:${normalizedPreferredAgentId}:`;
  const candidates: Array<string | null | undefined> = [];
  for (const session of sessions) {
    for (const sessionKey of uniqueNonEmptyStrings([session.key, session.gatewaySessionKey])) {
      if (sessionKey === CANONICAL_GATEWAY_AGENT_ID) continue;
      if (!sessionKey.startsWith(legacyAgentPrefix)) continue;
      candidates.push(sessionKey);
    }
  }

  return uniqueNonEmptyStrings(candidates).filter((candidate) => candidate !== CANONICAL_GATEWAY_AGENT_ID);
}

async function loadLegacyHistory(
  gateway: GatewayClient,
  preferredAgentId: string,
  sessions: OpenClawSessionRecord[],
): Promise<ChatMessage[]> {
  for (const sessionKey of legacySessionKeyCandidates(preferredAgentId, sessions)) {
    try {
      const messages = normalizeHistoryMessages(await gateway.chatHistory(sessionKey, 200));
      if (messages.length > 0) return messages;
    } catch {}
  }
  return [];
}

function legacyGatewayAgentCandidates(
  agents: Array<Record<string, unknown>>,
  canonicalAgentId: string,
): string[] {
  const candidates: Array<string | null | undefined> = [];
  for (const agent of agents) {
    if (typeof agent.id === "string") candidates.push(agent.id);
  }
  return uniqueNonEmptyStrings(candidates).filter((candidate) => (
    candidate !== CANONICAL_GATEWAY_AGENT_ID && candidate !== canonicalAgentId
  ));
}

function hasRecoverableFiles(files: WorkspaceFile[]): boolean {
  return files.some((file) => typeof file.name === "string" && file.name.trim() && !file.missing);
}

function defaultSessionIsReadOnlyChannel(sessions: OpenClawSessionRecord[]): boolean {
  return sessions.some((session) => (
    session.readOnly === true && sameOpenClawSessionKey(session.gatewaySessionKey ?? session.key, CANONICAL_GATEWAY_AGENT_ID)
  ));
}

async function migrateLegacyGatewayFiles(
  gateway: GatewayClient,
  sourceAgentId: string,
  targetAgentId: string,
  files: WorkspaceFile[],
): Promise<WorkspaceFile[] | null> {
  const copied: WorkspaceFile[] = [];
  for (const file of files) {
    const name = typeof file.name === "string" ? file.name.trim() : "";
    if (!name || file.missing) continue;
    try {
      const content = await gateway.fileGet(sourceAgentId, name);
      await gateway.fileSet(targetAgentId, name, content);
      copied.push(file);
    } catch {}
  }

  if (copied.length === 0) return null;

  try {
    const refreshedFiles = await gateway.filesList(targetAgentId) as WorkspaceFile[];
    if (refreshedFiles.length > 0) return refreshedFiles;
  } catch {}

  return copied;
}

async function recoverLegacyGatewayFiles(
  gateway: GatewayClient,
  agents: Array<Record<string, unknown>>,
  canonicalAgentId: string,
): Promise<{ files: WorkspaceFile[]; agentId: string } | null> {
  for (const legacyAgentId of legacyGatewayAgentCandidates(agents, canonicalAgentId)) {
    let legacyFiles: WorkspaceFile[] = [];
    try {
      legacyFiles = await gateway.filesList(legacyAgentId) as WorkspaceFile[];
    } catch {
      continue;
    }

    if (!hasRecoverableFiles(legacyFiles)) continue;

    const migratedFiles = await migrateLegacyGatewayFiles(gateway, legacyAgentId, canonicalAgentId, legacyFiles);
    if (migratedFiles && migratedFiles.length > 0) {
      return { files: migratedFiles, agentId: canonicalAgentId };
    }

    return { files: legacyFiles, agentId: legacyAgentId };
  }

  return null;
}

export async function hydrateOpenClawConnection(
  gateway: GatewayClient,
  preferredAgentId?: string | null,
): Promise<HydratedOpenClawConnection> {
  const normalizedPreferredAgentId = (preferredAgentId ?? "").trim();
  const [cfgResult, schemaResult, agentsResult, cronRes, modelsRes] = await Promise.allSettled([
    gateway.configGet(),
    gateway.configSchema(),
    gateway.agentsList(),
    gateway.cronList(),
    gateway.modelsList(),
  ]);

  const agents = agentsResult.status === "fulfilled" ? agentsResult.value : [];
  const resolvedGatewayAgentId = resolveGatewayAgentId(agents);
  let activeGatewayAgentId = resolvedGatewayAgentId;
  let files: WorkspaceFile[] = [];
  if (agentsResult.status === "fulfilled") {
    try {
      files = await gateway.filesList(resolvedGatewayAgentId);
    } catch {}
    if (files.length === 0) {
      const recovered = await recoverLegacyGatewayFiles(gateway, agents, resolvedGatewayAgentId);
      if (recovered) {
        files = recovered.files;
        activeGatewayAgentId = recovered.agentId;
      }
    }
  }

  return {
    config: cfgResult.status === "fulfilled" ? cfgResult.value : {},
    configSchema: schemaResult.status === "fulfilled" ? schemaResult.value : null,
    agents,
    files,
    gwAgentId: activeGatewayAgentId,
    cronJobs: cronRes.status === "fulfilled" ? cronRes.value as Array<Record<string, unknown>> : [],
    models: modelsRes.status === "fulfilled" ? modelsRes.value as Array<Record<string, unknown>> : [],
  };
}

export async function hydrateOpenClawSession(
  gateway: GatewayClient,
  preferredAgentId?: string | null,
  activeSessionKey?: string | null,
  connectionHydration?: HydratedOpenClawConnection,
  sessionHydration?: HydratedOpenClawSessionList,
): Promise<HydratedOpenClawSession> {
  const normalizedPreferredAgentId = (preferredAgentId ?? "").trim();
  const requestedSessionKey = resolveOpenClawActiveSessionKey(normalizedPreferredAgentId, activeSessionKey);
  const connection = connectionHydration ?? await hydrateOpenClawConnection(gateway, normalizedPreferredAgentId);
  const sessionsRes = sessionHydration
    ? { status: sessionHydration.fetched ? "fulfilled" as const : "rejected" as const, value: sessionHydration.sessions }
    : await listOpenClawSessions(gateway)
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason: unknown) => ({ status: "rejected" as const, reason, value: [] as OpenClawSessionRecord[] }));

  const agents = connection.agents;
  const sessions = sessionsRes.value;
  const activeSessionRecord = findOpenClawSelectableSession(sessions, requestedSessionKey);
  const resolvedSessionKey = resolveOpenClawGatewaySessionKey(sessions, requestedSessionKey);
  const legacyPreferredMainSessionKey = normalizedPreferredAgentId ? `agent:${normalizedPreferredAgentId}:main` : "";
  const sessionKey = requestedSessionKey === CANONICAL_GATEWAY_AGENT_ID && resolvedSessionKey === legacyPreferredMainSessionKey
    ? CANONICAL_GATEWAY_AGENT_ID
    : resolvedSessionKey;
  const skipAmbiguousSyntheticMainHistory = requestedSessionKey === CANONICAL_GATEWAY_AGENT_ID &&
    !activeSessionRecord &&
    defaultSessionIsReadOnlyChannel(sessions);
  const historyResult = skipAmbiguousSyntheticMainHistory
    ? { status: "fulfilled" as const, value: [] }
    : await loadOpenClawChatHistory(gateway, sessionKey, 200)
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason: unknown) => ({ status: "rejected" as const, reason }));
  const canonicalMessages = historyResult.status === "fulfilled"
    ? normalizeHistoryMessages(historyResult.value)
    : [];
  const messages = canonicalMessages.length > 0
    ? canonicalMessages
    : sameOpenClawSessionKey(sessionKey, CANONICAL_GATEWAY_AGENT_ID)
      ? await loadLegacyHistory(gateway, normalizedPreferredAgentId, sessions)
      : [];
  return {
    config: connection.config,
    configSchema: connection.configSchema,
    messages,
    files: connection.files,
    gwAgentId: connection.gwAgentId,
    gatewaySessionKey: sessionKey,
    activeSessionRecord,
    useLocalCacheFallback: !skipAmbiguousSyntheticMainHistory && activeSessionRecord?.readOnly !== true,
    sessions,
    sessionsFetched: sessionsRes.status === "fulfilled",
    cronJobs: connection.cronJobs,
    models: connection.models,
  };
}
