import type { Dispatch, SetStateAction } from "react";
import type {
  ChatEvent,
  GatewayChatHistoryResult,
  GatewayClient,
  GatewayEvent,
  OpenClawConfigSchemaResponse,
} from "@hypercli.com/sdk/openclaw/gateway";
import {
  type OpenClawSessionRecord,
  findOpenClawSelectableSession,
  listOpenClawSessions,
  loadOpenClawChatHistory,
  loadOpenClawChatHistoryResult,
  normalizeOpenClawSessions,
  openClawEventMatchesSession,
  openClawSessionHasActiveRun,
  resolveOpenClawActiveSessionKey,
  resolveOpenClawGatewaySessionKey,
  sameOpenClawSessionKey,
  unscopedOpenClawSessionKey,
} from "@/lib/openclaw-session-sdk-surface";
import {
  type ChatMessage,
  type WorkspaceFile,
  isOpenClawEmptyReplyFailureText,
  isInternalHeartbeatMessage,
  normalizeHistoryMessage,
  normalizeLiveToolCall,
  normalizeLiveToolResult,
  OPENCLAW_EMPTY_REPLY_NOTICE,
  sanitizeChatDisplayText,
  settleAssistantProgress,
  settleAssistantReasoning,
  stripAssistantProgressContent,
  stripAssistantReasoningContent,
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
  refreshSessions: (options?: { fresh?: boolean }) => void | Promise<unknown>;
  appendActivity: (entry: { type: ActivityKind; action: string; detail?: string; id?: string; timestamp?: number }) => void;
  activeSessionKey: string;
  suppressChatStreamEvents?: boolean;
}

interface ChatStreamEventContext {
  chatEvent: ChatEvent;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  appendActivity: (entry: { type: ActivityKind; action: string; detail?: string; id?: string; timestamp?: number }) => void;
  assistantRenderId?: string;
  clientTurnId?: string;
}

type ChatMessageIdentity = Partial<Pick<
  ChatMessage,
  "eventId" | "messageId" | "turnId" | "runId" | "sessionKey" | "revision"
>>;

function protocolIdentityString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function payloadChatMessageIdentity(payload: Record<string, unknown>): ChatMessageIdentity {
  const eventId = protocolIdentityString(payload.eventId);
  const messageId = protocolIdentityString(payload.messageId);
  const turnId = protocolIdentityString(payload.turnId);
  const runId = protocolIdentityString(payload.runId);
  const sessionKey = protocolIdentityString(payload.canonicalSessionKey) ?? protocolIdentityString(payload.sessionKey);
  const revision = typeof payload.revision === "number" && Number.isFinite(payload.revision)
    ? payload.revision
    : protocolIdentityString(payload.revision);
  return {
    ...(eventId ? { eventId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(runId ? { runId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(revision !== undefined ? { revision } : {}),
  };
}

function streamChatMessageIdentity(chatEvent: ChatEvent): ChatMessageIdentity {
  return {
    ...(chatEvent.eventId ? { eventId: chatEvent.eventId } : {}),
    ...(chatEvent.messageId ? { messageId: chatEvent.messageId } : {}),
    ...(chatEvent.turnId ? { turnId: chatEvent.turnId } : {}),
    ...(chatEvent.runId ? { runId: chatEvent.runId } : {}),
    ...(chatEvent.sessionKey ? { sessionKey: chatEvent.sessionKey } : {}),
    ...(chatEvent.revision !== undefined ? { revision: chatEvent.revision } : {}),
  };
}

function identifiedAssistantMessage(
  message: ChatMessage,
  identity: ChatMessageIdentity,
  renderId?: string,
  clientTurnId?: string,
): ChatMessage {
  return {
    ...message,
    ...identity,
    ...(renderId ? { renderId } : {}),
    ...(clientTurnId ? { clientTurnId } : {}),
  };
}

function applyChatErrorMessage({
  setMessages,
  message,
  identity,
  assistantRenderId,
  clientTurnId,
}: {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  message: string;
  identity: ChatMessageIdentity;
  assistantRenderId?: string;
  clientTurnId?: string;
}): void {
  if (isOpenClawEmptyReplyFailureText(message)) {
    setMessages((prev) => upsertAssistantMessage(
      prev,
      identifiedAssistantMessage(
        { role: "assistant", content: OPENCLAW_EMPTY_REPLY_NOTICE, timestamp: Date.now() },
        identity,
        assistantRenderId,
        clientTurnId,
      ),
      { replaceContent: true },
    ));
    return;
  }
  setMessages((prev) => [...prev, { role: "system", content: `Error: ${message}`, timestamp: Date.now() }]);
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
  const payloadRecord = payload as Record<string, unknown> | null;
  const stream = String(payloadRecord?.stream || "").toLowerCase();
  if (stream === "tool" || stream === "lifecycle") return true;
  const data = payloadRecord?.data as Record<string, unknown> | undefined;
  return stream === "assistant" && String(data?.phase || "").toLowerCase() === "commentary";
}

function commentaryText(payload: Record<string, unknown>): string {
  const cumulativeText = typeof payload.text === "string" ? payload.text : "";
  const deltaText = typeof payload.delta === "string" ? payload.delta : "";
  return cumulativeText.trim() ? cumulativeText : deltaText;
}

function reasoningText(payload: Record<string, unknown>): string {
  const message = payload.message && typeof payload.message === "object" && !Array.isArray(payload.message)
    ? payload.message as Record<string, unknown>
    : null;
  const choice = Array.isArray(payload.choices) && payload.choices[0] && typeof payload.choices[0] === "object"
    ? payload.choices[0] as Record<string, unknown>
    : null;
  const records = [
    payload,
    payload.delta,
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>).delta
      : null,
    choice?.delta,
    message,
    message?.delta,
  ].filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value));
  for (const record of records) {
    const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
    const candidate = [record.reasoning_content, record.reasoningContent, record.reasoning, record.thinking]
      .find((value) => typeof value === "string" && value);
    if (typeof candidate === "string") return candidate;
    if ((type === "thinking_delta" || type === "reasoning_delta") && typeof record.text === "string") {
      return record.text;
    }
  }
  return "";
}

function settleAssistantTurn(
  messages: ChatMessage[],
  identity: Partial<Pick<ChatMessage, "renderId" | "clientTurnId" | "messageId" | "turnId" | "runId" | "sessionKey">>,
  reasoningState: "settled" | "incomplete" = "settled",
): ChatMessage[] {
  return settleAssistantReasoning(
    settleAssistantProgress(messages, identity),
    identity,
    reasoningState,
  );
}

export function handleOpenClawChatStreamEvent({
  chatEvent,
  setMessages,
  setSending,
  appendActivity,
  assistantRenderId,
  clientTurnId,
}: ChatStreamEventContext): void {
  const payload = chatEvent.data ?? {};
  const identity = streamChatMessageIdentity(chatEvent);

  if (chatEvent.type === "content") {
    const snapshotMessage = normalizeHistoryMessage(payload.message, { preserveBoundaryWhitespace: true });
    const contentSnapshot = snapshotMessage?.role === "assistant"
      ? snapshotMessage.progress?.text ?? snapshotMessage.content
      : undefined;
    const text = sanitizeChatDisplayText(chatEvent.text ?? "");
    const replaceContent = chatEvent.replace === true;
    if (text || replaceContent) {
      setMessages((prev) => upsertAssistantMessage(
        prev,
        identifiedAssistantMessage({ role: "assistant", content: text, timestamp: Date.now() }, identity, assistantRenderId, clientTurnId),
        {
          replaceContent,
          appendContent: !replaceContent,
          ...(contentSnapshot !== undefined ? { contentSnapshot } : {}),
          startNewRound: true,
        },
      ));
    }
  } else if (chatEvent.type === "commentary") {
    const text = sanitizeChatDisplayText(chatEvent.text ?? "");
    if (text.trim()) {
      setMessages((prev) => upsertAssistantMessage(
        prev,
        identifiedAssistantMessage({
          role: "assistant",
          content: "",
          progress: { text, state: "active", revisions: [text] },
          timestamp: Date.now(),
        }, identity, assistantRenderId, clientTurnId),
        { updateProgress: chatEvent.replace === true ? "replace" : "append" },
      ));
    }
  } else if (chatEvent.type === "reasoning") {
    const text = sanitizeChatDisplayText(chatEvent.text ?? "");
    if (text) {
      setMessages((prev) => upsertAssistantMessage(
        prev,
        identifiedAssistantMessage({
          role: "assistant",
          content: "",
          reasoning: { text, state: "active", startedAt: Date.now() },
          timestamp: Date.now(),
        }, identity, assistantRenderId, clientTurnId),
        {
          updateReasoning: chatEvent.replace === true ? "replace" : "append",
          startNewRound: true,
        },
      ));
    }
  } else if (chatEvent.type === "thinking") {
    const text = sanitizeChatDisplayText(chatEvent.text ?? "");
    if (text) setMessages((prev) => upsertAssistantMessage(prev, identifiedAssistantMessage({ role: "assistant", content: "", thinking: text, timestamp: Date.now() }, identity, assistantRenderId, clientTurnId)));
  } else if (chatEvent.type === "tool_call") {
    const toolCall = normalizeLiveToolCall(payload);
    if (toolCall) setMessages((prev) => upsertAssistantMessage(prev, identifiedAssistantMessage({ role: "assistant", content: "", toolCalls: [toolCall], timestamp: Date.now() }, identity, assistantRenderId, clientTurnId)));
    if (toolCall && !isInternalHeartbeatMessage({ toolCalls: [toolCall] })) {
      appendActivity({ type: "tool", action: toolCall.name, detail: toolCall.args || "" });
    }
  } else if (chatEvent.type === "tool_result") {
    const toolResult = normalizeLiveToolResult(payload);
    if (toolResult) setMessages((prev) => upsertAssistantMessage(prev, identifiedAssistantMessage({ role: "assistant", content: "", toolCalls: [toolResult], timestamp: Date.now() }, identity, assistantRenderId, clientTurnId)));
    if (toolResult?.result && !isInternalHeartbeatMessage({ toolCalls: [toolResult] })) {
      appendActivity({ type: "tool", action: `${toolResult.name} → result`, detail: toolResult.result });
    }
  } else if (chatEvent.type === "done") {
    const normalized = normalizeHistoryMessage(payload.message);
    const settleIdentity = { ...identity, ...(assistantRenderId ? { renderId: assistantRenderId } : {}) };
    setMessages((prev) => {
      const next = normalized?.role === "assistant"
        ? upsertAssistantMessage(
            prev,
            identifiedAssistantMessage(normalized, identity, assistantRenderId, clientTurnId),
            { startNewRound: true },
          )
        : assistantRenderId && Object.keys(identity).length > 0
          ? upsertAssistantMessage(
            prev,
            identifiedAssistantMessage({ role: "assistant", content: "", timestamp: Date.now() }, identity, assistantRenderId, clientTurnId),
          )
          : prev;
      return settleAssistantTurn(next, settleIdentity);
    });
    setSending(false);
    appendActivity({ type: "message", action: "Assistant response complete" });
  } else if (chatEvent.type === "error") {
    const message = chatEvent.text || "Unknown error";
    setMessages((prev) => settleAssistantTurn(
      prev,
      { ...identity, ...(assistantRenderId ? { renderId: assistantRenderId } : {}) },
      "incomplete",
    ));
    if (isAbortedChatPayload(payload, message)) {
      setSending(false);
      appendReplyStoppedActivity(appendActivity);
      return;
    }
    setSending(false);
    applyChatErrorMessage({ setMessages, message, identity, assistantRenderId, clientTurnId });
    appendActivity({ type: "error", action: "Error", detail: message });
  }
}

function appendLiveChatMessage(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  message: ChatMessage | null,
  options: { replaceContent?: boolean; appendContent?: boolean; startNewRound?: boolean } = {},
): void {
  if (!message) return;
  if (message.role === "assistant") {
    setMessages((prev) => upsertAssistantMessage(prev, message, options));
    return;
  }
  setMessages((prev) => [...prev, message]);
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
  const identity = payloadChatMessageIdentity(payloadRecord);

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
        if (toolCall) setMessages((prev) => upsertAssistantMessage(prev, identifiedAssistantMessage({ role: "assistant", content: "", toolCalls: [toolCall], timestamp: Date.now() }, identity)));
      } else if (phase === "result") {
        const toolResult = normalizeLiveToolResult(data);
        if (toolResult) {
          setMessages((prev) => upsertAssistantMessage(prev, identifiedAssistantMessage({ role: "assistant", content: "", toolCalls: [toolResult], timestamp: Date.now() }, identity)));
        }
      }
    }
  }

  if (event === "agent" && String(payloadRecord.stream || "").toLowerCase() === "assistant") {
    const data = payloadRecord.data as Record<string, unknown> | undefined;
    if (data && String(data.phase || "").toLowerCase() === "commentary") {
      const text = sanitizeChatDisplayText(commentaryText(data));
      if (text.trim()) {
        setMessages((prev) => upsertAssistantMessage(
          prev,
          identifiedAssistantMessage({
            role: "assistant",
            content: "",
            progress: { text, state: "active", revisions: [text] },
            timestamp: Date.now(),
          }, identity),
          { updateProgress: data.replace === true ? "replace" : "append" },
        ));
      }
    }
  }

  if (event === "agent" && String(payloadRecord.stream || "").toLowerCase() === "lifecycle") {
    const data = payloadRecord.data as Record<string, unknown> | undefined;
    const phase = String(data?.phase || "").toLowerCase();
    if (phase === "end" || isAbortSignal(phase) || (data && isAbortedChatPayload(data))) {
      const interrupted = isAbortSignal(phase) || Boolean(data && isAbortedChatPayload(data));
      setMessages((prev) => settleAssistantTurn(prev, identity, interrupted ? "incomplete" : "settled"));
    }
  }

  if (event === "chat") {
    if (isAbortedChatPayload(payloadRecord)) {
      setMessages((prev) => settleAssistantTurn(prev, identity, "incomplete"));
      setSending(false);
      appendReplyStoppedActivity(appendActivity);
      return;
    }
    const normalizedMessage = normalizeHistoryMessage(payloadRecord.message ?? payloadRecord);
    const state = String(payloadRecord.state || "").toLowerCase();
    const isTerminal = state === "final" || state === "error";
    const normalized = normalizedMessage?.role === "assistant" &&
      state === "delta" &&
      normalizedMessage.reasoning &&
      !normalizedMessage.content.trim() &&
      (normalizedMessage.toolCalls?.length ?? 0) === 0
      ? {
          ...normalizedMessage,
          reasoning: {
            ...normalizedMessage.reasoning,
            state: "active" as const,
            completedAt: undefined,
          },
        }
      : normalizedMessage;
    if (normalized?.role === "assistant") {
      setMessages((prev) => {
        const next = upsertAssistantMessage(
          prev,
          identifiedAssistantMessage(normalized, identity),
          { replaceContent: payloadRecord.replace === true, startNewRound: true },
        );
        return isTerminal
          ? settleAssistantTurn(next, identity, state === "error" ? "incomplete" : "settled")
          : next;
      });
    } else if (normalized) {
      appendLiveChatMessage(setMessages, identifiedAssistantMessage(normalized, identity));
    } else if (isTerminal) {
      setMessages((prev) => settleAssistantTurn(prev, identity, state === "error" ? "incomplete" : "settled"));
    }
    if (isTerminal) setSending(false);
  } else if (event === "chat.content") {
    const normalized = normalizeHistoryMessage(
      payloadRecord.message ?? payloadRecord,
      { preserveBoundaryWhitespace: true },
    );
    if (normalized) {
      appendLiveChatMessage(
        setMessages,
        identifiedAssistantMessage(normalized, identity),
        {
          replaceContent: payloadRecord.replace === true,
          appendContent: payloadRecord.replace !== true,
          startNewRound: true,
        },
      );
    } else {
      const text = sanitizeChatDisplayText((payload as Record<string, unknown>).text as string ?? "");
      if (text || payloadRecord.replace === true) {
        setMessages((prev) => upsertAssistantMessage(
          prev,
          identifiedAssistantMessage({ role: "assistant", content: text, timestamp: Date.now() }, identity),
          {
            replaceContent: payloadRecord.replace === true,
            appendContent: payloadRecord.replace !== true,
            startNewRound: true,
          },
        ));
      }
    }
  } else if (event === "chat.thinking") {
    const structuredReasoning = sanitizeChatDisplayText(reasoningText(payloadRecord));
    if (structuredReasoning) {
      setMessages((prev) => upsertAssistantMessage(
        prev,
        identifiedAssistantMessage({
          role: "assistant",
          content: "",
          reasoning: { text: structuredReasoning, state: "active", startedAt: Date.now() },
          timestamp: Date.now(),
        }, identity),
        { updateReasoning: payloadRecord.replace === true ? "replace" : "append", startNewRound: true },
      ));
    } else {
      const text = sanitizeChatDisplayText((payload as Record<string, unknown>).text as string ?? "");
      if (text) setMessages((prev) => upsertAssistantMessage(prev, identifiedAssistantMessage({ role: "assistant", content: "", thinking: text, timestamp: Date.now() }, identity)));
    }
  } else if (event === "chat.reasoning" || event === "chat.reasoning.delta" || event === "chat.thinking.delta") {
    const text = sanitizeChatDisplayText(reasoningText(payloadRecord) || (typeof payloadRecord.text === "string" ? payloadRecord.text : ""));
    if (text) {
      setMessages((prev) => upsertAssistantMessage(
        prev,
        identifiedAssistantMessage({
          role: "assistant",
          content: "",
          reasoning: { text, state: "active", startedAt: Date.now() },
          timestamp: Date.now(),
        }, identity),
        {
          updateReasoning: event === "chat.reasoning" || payloadRecord.replace === true ? "replace" : "append",
          startNewRound: true,
        },
      ));
    }
  } else if (event === "chat.tool_call") {
    const toolCall = normalizeLiveToolCall(payload as Record<string, unknown>);
    if (toolCall) setMessages((prev) => upsertAssistantMessage(prev, identifiedAssistantMessage({ role: "assistant", content: "", toolCalls: [toolCall], timestamp: Date.now() }, identity)));
  } else if (event === "chat.tool_result") {
    const toolResult = normalizeLiveToolResult(payload as Record<string, unknown>);
    if (toolResult) setMessages((prev) => upsertAssistantMessage(prev, identifiedAssistantMessage({ role: "assistant", content: "", toolCalls: [toolResult], timestamp: Date.now() }, identity)));
  } else if (event === "chat.done") {
    setMessages((prev) => settleAssistantTurn(prev, identity));
    setSending(false);
    void refreshSessions();
  } else if (event === "chat.aborted") {
    setMessages((prev) => settleAssistantTurn(prev, identity, "incomplete"));
    setSending(false);
    appendReplyStoppedActivity(appendActivity);
  } else if (event === "sessions.changed") {
    void refreshSessions({ fresh: true });
  } else if (event === "sessions.updated") {
    const list = (payload as Record<string, unknown>).sessions;
    if (Array.isArray(list)) setSessions(normalizeOpenClawSessions(list));
  } else if (event === "chat.error") {
    const message = String(payloadRecord.message ?? "Unknown error");
    setMessages((prev) => settleAssistantTurn(prev, identity, "incomplete"));
    if (isAbortedChatPayload(payloadRecord, message)) {
      setSending(false);
      appendReplyStoppedActivity(appendActivity);
      return;
    }
    setSending(false);
    applyChatErrorMessage({ setMessages, message, identity });
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
  hasActiveRun: boolean;
  activeRunIds: string[];
  inFlightRun: OpenClawInFlightRun | null;
  historyStatus: "fulfilled" | "rejected";
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

export interface HydratedOpenClawHistory {
  messages: ChatMessage[];
  gatewaySessionKey: string;
  activeSessionRecord: OpenClawSessionRecord | null;
  hasActiveRun: boolean;
  activeRunIds: string[];
  inFlightRun: OpenClawInFlightRun | null;
  historyStatus: "fulfilled" | "rejected";
  useLocalCacheFallback: boolean;
  sessions: OpenClawSessionRecord[];
  sessionsFetched: boolean;
}

export interface HydratedOpenClawSessionList {
  sessions: OpenClawSessionRecord[];
  fetched: boolean;
}

export interface OpenClawInFlightRun {
  runId: string;
  text: string;
}

const CANONICAL_GATEWAY_AGENT_ID = "main";

function isUuidLikeAgentId(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (value ?? "").trim()).filter(Boolean)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function assistantHistoryIdentityConflicts(current: ChatMessage, incoming: ChatMessage): boolean {
  return (["messageId", "turnId", "runId"] as const).some((field) => (
    Boolean(current[field] && incoming[field] && current[field] !== incoming[field])
  ));
}

function assistantHistoryIsReasoningOnly(message: ChatMessage): boolean {
  return message.role === "assistant" &&
    Boolean(message.reasoning?.text.trim()) &&
    !message.content.trim() &&
    (message.toolCalls?.length ?? 0) === 0 &&
    (message.mediaUrls?.length ?? 0) === 0 &&
    (message.attachments?.length ?? 0) === 0 &&
    (message.files?.length ?? 0) === 0;
}

function mergeCumulativeHistoryReasoning(
  current: ChatMessage,
  incoming: ChatMessage,
): ChatMessage["reasoning"] | null {
  const currentReasoning = current.reasoning;
  const incomingReasoning = incoming.reasoning;
  if (!currentReasoning || !incomingReasoning || assistantHistoryIdentityConflicts(current, incoming)) return null;
  const currentText = currentReasoning.text;
  const incomingText = incomingReasoning.text;
  if (!currentText.startsWith(incomingText) && !incomingText.startsWith(currentText)) return null;
  const text = incomingText.length >= currentText.length ? incomingText : currentText;
  const completedAt = Math.max(
    currentReasoning.completedAt ?? currentReasoning.startedAt,
    incomingReasoning.completedAt ?? incomingReasoning.startedAt,
  );
  return {
    text,
    state: incomingReasoning.state,
    startedAt: Math.min(currentReasoning.startedAt, incomingReasoning.startedAt),
    ...(incomingReasoning.state === "active" ? {} : { completedAt }),
  };
}

function isSupersedableNoReplyHistoryMessage(message: ChatMessage): boolean {
  return message.role !== "user" && isOpenClawEmptyReplyFailureText(message.content);
}

function assistantHistoryHasFinalReply(message: ChatMessage): boolean {
  return message.role === "assistant" &&
    !isSupersedableNoReplyHistoryMessage(message) &&
    Boolean(
      message.content.trim() ||
      (message.mediaUrls?.length ?? 0) > 0 ||
      (message.attachments?.length ?? 0) > 0 ||
      (message.files?.length ?? 0) > 0
    );
}

function normalizeHistoryMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  const normalized = messages
    .map((message) => normalizeHistoryMessage(message))
    .filter((message): message is ChatMessage => message !== null);
  const result: ChatMessage[] = [];
  let pendingProgressIndex: number | null = null;

  for (const message of normalized) {
    if (message.role !== "assistant") {
      result.push(message);
      if (message.role === "user") pendingProgressIndex = null;
      continue;
    }

    if (message.progress?.text) {
      if (pendingProgressIndex === null) {
        result.push(message);
        pendingProgressIndex = result.length - 1;
        continue;
      }

      const pending = result[pendingProgressIndex];
      if (!pending?.progress) {
        result.push(message);
        pendingProgressIndex = result.length - 1;
        continue;
      }
      const revisions = Array.from(new Set([
        ...pending.progress.revisions,
        pending.progress.text,
        ...message.progress.revisions,
        message.progress.text,
      ])).filter((revision) => revision.trim()).slice(-16);
      result[pendingProgressIndex] = {
        ...pending,
        progress: { text: message.progress.text, state: "settled", revisions },
      };
      continue;
    }

    if (pendingProgressIndex === null) {
      result.push(message);
      continue;
    }

    if (assistantHistoryIsReasoningOnly(message) || isSupersedableNoReplyHistoryMessage(message)) {
      result.push(message);
      continue;
    }

    const pending = result[pendingProgressIndex];
    if (!pending?.progress) {
      pendingProgressIndex = null;
      result.push(message);
      continue;
    }
    const content = stripAssistantProgressContent(message.content, pending.progress);
    const nextMessage = content === message.content ? message : { ...message, content };
    if (message.toolCalls?.length) {
      result.push(nextMessage);
      continue;
    }

    result.splice(pendingProgressIndex, 1);
    result.push({ ...nextMessage, progress: pending.progress });
    pendingProgressIndex = null;
  }

  const folded: ChatMessage[] = [];
  let pendingReasoningIndex: number | null = null;
  for (const message of result) {
    if (message.role === "user") {
      folded.push(message);
      pendingReasoningIndex = null;
      continue;
    }

    if (assistantHistoryIsReasoningOnly(message)) {
      const pending = pendingReasoningIndex === null ? null : folded[pendingReasoningIndex];
      const mergedReasoning = pending ? mergeCumulativeHistoryReasoning(pending, message) : null;
      if (pending && mergedReasoning) {
        folded[pendingReasoningIndex!] = {
          ...pending,
          reasoning: mergedReasoning,
          ...(message.progress ? { progress: message.progress } : {}),
        };
      } else {
        folded.push(message);
        pendingReasoningIndex = folded.length - 1;
      }
      continue;
    }

    if (isSupersedableNoReplyHistoryMessage(message)) {
      folded.push(message);
      continue;
    }

    if (pendingReasoningIndex !== null && assistantHistoryHasFinalReply(message)) {
      const pending = folded[pendingReasoningIndex];
      if (pending?.reasoning && !assistantHistoryIdentityConflicts(pending, message)) {
        const mergedReasoning = message.reasoning
          ? mergeCumulativeHistoryReasoning(pending, message)
          : pending.reasoning;
        if (mergedReasoning) {
          const progress = message.progress ?? pending.progress;
          const withoutProgressMirror = stripAssistantProgressContent(message.content, progress);
          const content = stripAssistantReasoningContent(withoutProgressMirror, mergedReasoning);
          folded.splice(pendingReasoningIndex, 1);
          folded.push({
            ...message,
            content,
            reasoning: mergedReasoning,
            ...(progress ? { progress } : {}),
          });
          pendingReasoningIndex = null;
          continue;
        }
      }
    }

    folded.push(message);
    if (message.role === "assistant") pendingReasoningIndex = null;
  }

  return folded.filter((message, index) => {
    if (!isSupersedableNoReplyHistoryMessage(message)) return true;
    for (let cursor = index + 1; cursor < folded.length; cursor += 1) {
      const candidate = folded[cursor];
      if (candidate?.role === "user") break;
      if (candidate && assistantHistoryHasFinalReply(candidate)) return false;
    }
    return true;
  });
}

function normalizedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueNonEmptyStrings(value.map((item) => nonEmptyString(item)));
}

function normalizeOpenClawHistoryRunState(
  result: GatewayChatHistoryResult,
  activeSessionRecord: OpenClawSessionRecord | null,
): Pick<HydratedOpenClawHistory, "hasActiveRun" | "activeRunIds" | "inFlightRun"> {
  const sessionInfo = isRecord(result.sessionInfo) ? result.sessionInfo : null;
  const status = nonEmptyString(sessionInfo?.status)?.toLowerCase();
  const activeRunIds = normalizedStringArray(sessionInfo?.activeRunIds ?? sessionInfo?.active_run_ids);
  const rawInFlightRun = isRecord(result.inFlightRun) ? result.inFlightRun : null;
  const inFlightRunId = nonEmptyString(rawInFlightRun?.runId ?? rawInFlightRun?.run_id);
  const inFlightRunText = typeof rawInFlightRun?.text === "string" ? rawInFlightRun.text : "";
  const inFlightRun = inFlightRunId
    ? { runId: inFlightRunId, text: inFlightRunText }
    : null;
  const explicitHasActiveRun = typeof sessionInfo?.hasActiveRun === "boolean"
    ? sessionInfo.hasActiveRun
    : typeof sessionInfo?.has_active_run === "boolean"
      ? sessionInfo.has_active_run
      : null;
  const statusIsTerminal = Boolean(status && status !== "running");
  const hasActiveRun = !statusIsTerminal && (
    explicitHasActiveRun ?? Boolean(inFlightRun || activeRunIds.length > 0 || openClawSessionHasActiveRun(activeSessionRecord))
  );
  const resolvedActiveRunIds = activeRunIds.length > 0
    ? activeRunIds
    : inFlightRun
      ? [inFlightRun.runId]
      : activeSessionRecord?.activeRunIds ?? [];

  return {
    hasActiveRun,
    activeRunIds: hasActiveRun ? resolvedActiveRunIds : [],
    inFlightRun: hasActiveRun ? inFlightRun : null,
  };
}

function mergeOpenClawInFlightRun(
  messages: ChatMessage[],
  inFlightRun: OpenClawInFlightRun | null,
): ChatMessage[] {
  if (!inFlightRun?.text) return messages;
  const ownedPrefixIndex = messages.findIndex((message) => (
    message.role === "assistant" &&
    message.runId === inFlightRun.runId &&
    Boolean(
      message.content &&
      (inFlightRun.text.startsWith(message.content) || message.content.startsWith(inFlightRun.text)),
    )
  ));
  let turnStart = ownedPrefixIndex;
  if (turnStart === -1) {
    turnStart = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role !== "user") continue;
      turnStart = index + 1;
      break;
    }
  }

  let persistedPrefixLength = 0;
  let lastMatchedAssistantIndex = -1;
  for (let index = turnStart; index < messages.length; index += 1) {
    const message = messages[index];
    if (
      message?.role !== "assistant" ||
      (message.runId && message.runId !== inFlightRun.runId) ||
      !message.content
    ) continue;

    const remainingText = inFlightRun.text.slice(persistedPrefixLength);
    if (remainingText.startsWith(message.content)) {
      persistedPrefixLength += message.content.length;
      lastMatchedAssistantIndex = index;
      continue;
    }
    if (message.content.startsWith(remainingText)) return messages;

    const leadingWhitespace = /^\s+/u.exec(remainingText)?.[0];
    if (persistedPrefixLength > 0 && leadingWhitespace) {
      const afterWhitespace = remainingText.slice(leadingWhitespace.length);
      if (afterWhitespace.startsWith(message.content)) {
        persistedPrefixLength += leadingWhitespace.length + message.content.length;
        lastMatchedAssistantIndex = index;
        continue;
      }
      if (message.content.startsWith(afterWhitespace)) return messages;
    }
    if (persistedPrefixLength > 0) break;
  }

  const tail = inFlightRun.text.slice(persistedPrefixLength);
  if (!tail) return messages;
  if (lastMatchedAssistantIndex >= 0) {
    return messages.map((message, index) => (
      index === lastMatchedAssistantIndex
        ? { ...message, content: `${message.content}${tail}`, runId: inFlightRun.runId }
        : message
    ));
  }

  const incoming = normalizeHistoryMessage({
    role: "assistant",
    content: tail,
    runId: inFlightRun.runId,
  });
  return incoming ? [...messages, incoming] : messages;
}

function rawSessionKeyCandidates(session: OpenClawSessionRecord | null | undefined): Array<string | null> {
  const raw = session?.raw;
  return [
    nonEmptyString(raw?.gatewaySessionKey),
    nonEmptyString(raw?.gateway_session_key),
    nonEmptyString(raw?.key),
    nonEmptyString(raw?.id),
    nonEmptyString(raw?.sessionKey),
    nonEmptyString(raw?.session_key),
  ];
}

function channelHistorySessionKeys(session: OpenClawSessionRecord | null | undefined): string[] {
  if (session?.readOnly !== true || !session.sourceChannelId) return [];
  return uniqueNonEmptyStrings([
    session.sourceSessionKey,
    session.key,
    session.gatewaySessionKey,
    ...rawSessionKeyCandidates(session),
  ]);
}

function previewItemsFromResponse(value: unknown, sessionKey: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.items)) return value.items;
  if (!Array.isArray(value.previews)) return [];
  const previews = value.previews.filter(isRecord);
  const matchingPreview = previews.find((preview) => nonEmptyString(preview.key) === sessionKey) ?? previews[0];
  return Array.isArray(matchingPreview?.items) ? matchingPreview.items : [];
}

function normalizedChannelId(value: unknown): string | null {
  const raw = nonEmptyString(value);
  if (!raw) return null;
  const normalized = raw
    .replace(/^integration[:/]/i, "")
    .replace(/^integrations\./i, "")
    .replace(/^channels\./i, "")
    .replace(/^plugins\.entries\./i, "")
    .replace(/^plugin[:/]/i, "")
    .trim()
    .toLowerCase();
  const [id] = normalized.split(/[:/]/);
  const safeId = (id || normalized).replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "");
  return safeId || null;
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function channelIdsFromRecord(record: Record<string, unknown>): string[] {
  const origin = nestedRecord(record.origin);
  const deliveryContext = nestedRecord(record.deliveryContext) ?? nestedRecord(record.delivery_context);
  const source = nestedRecord(record.source);
  return uniqueNonEmptyStrings([
    normalizedChannelId(record.sourceChannelId),
    normalizedChannelId(record.source_channel_id),
    normalizedChannelId(record.channelId),
    normalizedChannelId(record.channel_id),
    normalizedChannelId(record.channel),
    normalizedChannelId(record.provider),
    normalizedChannelId(deliveryContext?.channel),
    normalizedChannelId(deliveryContext?.provider),
    normalizedChannelId(record.lastChannel),
    normalizedChannelId(record.last_channel),
    normalizedChannelId(origin?.channel),
    normalizedChannelId(origin?.provider),
    normalizedChannelId(source?.channel),
    normalizedChannelId(source?.provider),
  ]);
}

function previewItemMatchesReadOnlyChannel(
  item: unknown,
  session: OpenClawSessionRecord,
  queriedSessionKey: string,
): boolean {
  const expectedChannelId = normalizedChannelId(session.sourceChannelId);
  if (!expectedChannelId || !isRecord(item)) return true;
  const messageRecord = nestedRecord(item.message);
  const channelIds = uniqueNonEmptyStrings([
    ...channelIdsFromRecord(item),
    ...(messageRecord ? channelIdsFromRecord(messageRecord) : []),
  ]);
  if (channelIds.length === 0) {
    return Boolean(
      session.sourceSessionKey &&
      sameOpenClawSessionKey(queriedSessionKey, session.sourceSessionKey),
    );
  }
  return channelIds.includes(expectedChannelId);
}

async function loadReadOnlyChannelHistory(
  gateway: GatewayClient,
  session: OpenClawSessionRecord | null | undefined,
  limit: number,
): Promise<ChatMessage[] | null> {
  const sessionKeys = channelHistorySessionKeys(session);
  if (sessionKeys.length === 0 || !session) return null;
  for (const sessionKey of sessionKeys) {
    try {
      const messages = normalizeHistoryMessages(await loadOpenClawChatHistory(gateway, sessionKey, limit));
      if (messages.length > 0) return messages;
    } catch {}
  }
  if (typeof gateway.sessionsPreview !== "function") return [];
  for (const sessionKey of sessionKeys) {
    try {
      const items = previewItemsFromResponse(await gateway.sessionsPreview(sessionKey, limit), sessionKey)
        .filter((item) => previewItemMatchesReadOnlyChannel(item, session, sessionKey));
      const messages = normalizeHistoryMessages(items);
      if (messages.length > 0) return messages;
    } catch {}
  }
  return [];
}

async function loadSessionHistory(
  gateway: GatewayClient,
  sessionKey: string,
  session: OpenClawSessionRecord | null | undefined,
  limit: number,
): Promise<ChatMessage[]> {
  if (session?.readOnly === true) {
    const channelHistory = await loadReadOnlyChannelHistory(gateway, session, limit);
    if (channelHistory) return channelHistory;
  }
  return normalizeHistoryMessages((await loadOpenClawChatHistoryResult(gateway, sessionKey, limit)).messages);
}

async function loadSessionHistoryResult(
  gateway: GatewayClient,
  sessionKey: string,
  session: OpenClawSessionRecord | null | undefined,
  limit: number,
): Promise<GatewayChatHistoryResult> {
  if (session?.readOnly === true) {
    const channelHistory = await loadReadOnlyChannelHistory(gateway, session, limit);
    if (channelHistory) return { messages: channelHistory };
  }
  return await loadOpenClawChatHistoryResult(gateway, sessionKey, limit);
}

export async function refreshOpenClawChatMessages(
  gateway: GatewayClient,
  preferredAgentId?: string | null,
  activeSessionKey?: string | null,
  activeGatewaySessionKey?: string | null,
  activeSessionRecord?: OpenClawSessionRecord | null,
  options: { throwOnError?: boolean } = {},
): Promise<ChatMessage[]> {
  const sessionKey = activeGatewaySessionKey?.trim() || resolveOpenClawActiveSessionKey((preferredAgentId ?? "").trim(), activeSessionKey);
  try {
    return await loadSessionHistory(gateway, sessionKey, activeSessionRecord, 200);
  } catch (error) {
    if (options.throwOnError) throw error;
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
    session.readOnly === true &&
    unscopedOpenClawSessionKey(session.gatewaySessionKey ?? session.key) === CANONICAL_GATEWAY_AGENT_ID
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

export async function hydrateOpenClawHistory(
  gateway: GatewayClient,
  preferredAgentId?: string | null,
  activeSessionKey?: string | null,
  sessionHydration?: HydratedOpenClawSessionList,
): Promise<HydratedOpenClawHistory> {
  const normalizedPreferredAgentId = (preferredAgentId ?? "").trim();
  const requestedSessionKey = resolveOpenClawActiveSessionKey(normalizedPreferredAgentId, activeSessionKey);
  const sessionsRes = sessionHydration
    ? { status: sessionHydration.fetched ? "fulfilled" as const : "rejected" as const, value: sessionHydration.sessions }
    : await listOpenClawSessions(gateway)
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason: unknown) => ({ status: "rejected" as const, reason, value: [] as OpenClawSessionRecord[] }));

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
    ? { status: "fulfilled" as const, value: { messages: [] } as GatewayChatHistoryResult }
    : await loadSessionHistoryResult(gateway, sessionKey, activeSessionRecord, 200)
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason: unknown) => ({ status: "rejected" as const, reason }));
  const canonicalMessages = historyResult.status === "fulfilled"
    ? normalizeHistoryMessages(historyResult.value.messages)
    : [];
  const runState = historyResult.status === "fulfilled"
    ? normalizeOpenClawHistoryRunState(historyResult.value, activeSessionRecord)
    : { hasActiveRun: false, activeRunIds: [], inFlightRun: null };
  const baseMessages = canonicalMessages.length > 0 || runState.hasActiveRun
    ? canonicalMessages
    : activeSessionRecord?.readOnly !== true && sameOpenClawSessionKey(sessionKey, CANONICAL_GATEWAY_AGENT_ID)
      ? await loadLegacyHistory(gateway, normalizedPreferredAgentId, sessions)
      : [];
  const messages = mergeOpenClawInFlightRun(baseMessages, runState.inFlightRun);
  const historyStatus = historyResult.status === "fulfilled" || messages.length > 0
    ? "fulfilled"
    : "rejected";
  return {
    messages,
    gatewaySessionKey: sessionKey,
    activeSessionRecord,
    ...runState,
    historyStatus,
    useLocalCacheFallback: !skipAmbiguousSyntheticMainHistory && activeSessionRecord?.readOnly !== true,
    sessions,
    sessionsFetched: sessionsRes.status === "fulfilled",
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
  const connection = connectionHydration ?? await hydrateOpenClawConnection(gateway, normalizedPreferredAgentId);
  const history = await hydrateOpenClawHistory(
    gateway,
    normalizedPreferredAgentId,
    activeSessionKey,
    sessionHydration,
  );
  return {
    config: connection.config,
    configSchema: connection.configSchema,
    messages: history.messages,
    files: connection.files,
    gwAgentId: connection.gwAgentId,
    gatewaySessionKey: history.gatewaySessionKey,
    activeSessionRecord: history.activeSessionRecord,
    hasActiveRun: history.hasActiveRun,
    activeRunIds: history.activeRunIds,
    inFlightRun: history.inFlightRun,
    historyStatus: history.historyStatus,
    useLocalCacheFallback: history.useLocalCacheFallback,
    sessions: history.sessions,
    sessionsFetched: history.sessionsFetched,
    cronJobs: connection.cronJobs,
    models: connection.models,
  };
}
