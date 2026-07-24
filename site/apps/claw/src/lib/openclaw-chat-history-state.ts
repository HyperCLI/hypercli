import { ensureChatMessageRenderId, type ChatMessage } from "@/lib/openclaw-chat";

const OPENCLAW_REPLY_STOPPED_MESSAGE = "Reply stopped";
const VOICE_NOTE_FILE_NAME = /^(?:voice|audio)-[\w.-]+\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)$/i;

export type ChatMessageUpdate = ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]);

export interface ChatHistoryTarget {
  agentId: string | null;
  sessionKey: string;
}

export type ChatHistoryAction =
  | { type: "apply-update"; update: ChatMessageUpdate }
  | { type: "append-system-message"; content: string; timestamp?: number }
  | { type: "append-user-message"; message: ChatMessage }
  | { type: "clear" }
  | { type: "mark-interrupted" }
  | { type: "merge-history-refresh"; messages: ChatMessage[] }
  | { type: "replace"; messages: ChatMessage[] }
  | { type: "restore-cache"; messages: ChatMessage[] };

type ChatMessageFile = NonNullable<ChatMessage["files"]>[number];

function messageFileName(file: ChatMessageFile): string {
  return file.name || file.path.split("/").filter(Boolean).pop() || "";
}

function isVoiceNoteInstruction(content: string): boolean {
  return /^I recorded a voice message\.\s*Run this command to transcribe it:\s*`?hyper\s+voice\s+transcribe\s+\S+\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)`?\s*$/i.test(
    content.trim(),
  );
}

function voiceNoteMessageKey(message: ChatMessage): string | null {
  if (message.role !== "user") return null;
  const voiceFile = (message.files ?? []).find((file) => VOICE_NOTE_FILE_NAME.test(messageFileName(file)));
  if (!voiceFile) return null;
  const content = message.content.trim();
  if (content && !isVoiceNoteInstruction(content)) return null;
  return messageFileName(voiceFile).toLowerCase();
}

export function dedupeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  let normalizedMessages = messages;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    const normalized = ensureChatMessageRenderId(message);
    if (normalized === message) continue;
    if (normalizedMessages === messages) normalizedMessages = [...messages];
    normalizedMessages[index] = normalized;
  }

  const seenVoiceNotes = new Set<string>();
  const deduped = normalizedMessages.filter((message) => {
    const key = voiceNoteMessageKey(message);
    if (!key) return true;
    if (seenVoiceNotes.has(key)) return false;
    seenVoiceNotes.add(key);
    return true;
  });
  return deduped.length === normalizedMessages.length ? normalizedMessages : deduped;
}

type CorrelationField = "messageId" | "turnId" | "runId" | "clientTurnId";

function hasProtocolCorrelation(message: ChatMessage): boolean {
  return Boolean(message.messageId || message.turnId || message.runId);
}

function findProtocolMatch(
  messages: ChatMessage[],
  target: ChatMessage,
  role: ChatMessage["role"],
  startIndex = 0,
): number {
  for (const field of ["messageId", "turnId", "runId", "clientTurnId"] as const satisfies readonly CorrelationField[]) {
    const value = target[field];
    if (!value) continue;
    for (let index = messages.length - 1; index >= startIndex; index -= 1) {
      const candidate = messages[index];
      if (candidate?.role === role && candidate[field] === value) return index;
    }
  }
  return -1;
}

function legacyRenderSignature(message: ChatMessage): string {
  return JSON.stringify([
    message.role,
    message.timestamp ?? null,
    message.content,
    (message.files ?? []).map((file) => [file.path, file.name, file.type]),
    (message.attachments ?? []).map((attachment) => [attachment.fileName ?? null, attachment.mimeType ?? null]),
  ]);
}

function retainHistoryRenderIds(
  historyMessages: ChatMessage[],
  currentMessages: ChatMessage[],
): ChatMessage[] {
  if (historyMessages.length === 0 || currentMessages.length === 0) return historyMessages;
  const usedCurrentIndexes = new Set<number>();
  let legacyCursor = 0;

  return historyMessages.map((historyMessage) => {
    let currentIndex = findProtocolMatch(currentMessages, historyMessage, historyMessage.role);
    if (usedCurrentIndexes.has(currentIndex)) currentIndex = -1;

    if (currentIndex < 0) {
      const signature = legacyRenderSignature(historyMessage);
      const findLegacyMatch = (start: number, end: number) => {
        for (let index = start; index < end; index += 1) {
          const candidate = currentMessages[index];
          if (!candidate || usedCurrentIndexes.has(index) || candidate.role !== historyMessage.role) continue;
          if (hasProtocolCorrelation(historyMessage) && hasProtocolCorrelation(candidate)) continue;
          if (legacyRenderSignature(candidate) === signature) return index;
        }
        return -1;
      };
      currentIndex = findLegacyMatch(legacyCursor, currentMessages.length);
      if (currentIndex < 0) currentIndex = findLegacyMatch(0, legacyCursor);
    }

    if (currentIndex < 0) return historyMessage;
    usedCurrentIndexes.add(currentIndex);
    legacyCursor = Math.max(legacyCursor, currentIndex + 1);
    const currentMessage = currentMessages[currentIndex];
    return {
      ...historyMessage,
      renderId: currentMessage?.renderId ?? historyMessage.renderId,
      ...(currentMessage?.clientTurnId ? { clientTurnId: currentMessage.clientTurnId } : {}),
      ...(currentMessage?.retryContent ? { retryContent: currentMessage.retryContent } : {}),
    };
  });
}

function lastMessageIndex(messages: ChatMessage[], role: ChatMessage["role"]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) return index;
  }
  return -1;
}

function sameLegacyUserTurn(current: ChatMessage, history: ChatMessage): boolean {
  if (hasProtocolCorrelation(current) && hasProtocolCorrelation(history)) return false;
  return current.role === "user" &&
    history.role === "user" &&
    current.content.trim() === history.content.trim() &&
    JSON.stringify(current.files ?? []) === JSON.stringify(history.files ?? []) &&
    JSON.stringify(current.attachments ?? []) === JSON.stringify(history.attachments ?? []);
}

function identityWithHistoryPriority(history: ChatMessage, current: ChatMessage): Partial<ChatMessage> {
  const eventId = history.eventId ?? current.eventId;
  const messageId = history.messageId ?? current.messageId;
  const turnId = history.turnId ?? current.turnId;
  const runId = history.runId ?? current.runId;
  const sessionKey = history.sessionKey ?? current.sessionKey;
  const revision = history.revision ?? current.revision;
  const clientTurnId = history.clientTurnId ?? current.clientTurnId;
  return {
    ...(eventId ? { eventId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(runId ? { runId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(revision !== undefined ? { revision } : {}),
    ...(clientTurnId ? { clientTurnId } : {}),
  };
}

function historyRevisionIsAtLeastCurrent(history: ChatMessage, current: ChatMessage): boolean {
  if (history.revision === undefined || current.revision === undefined) return false;
  if (typeof history.revision === "number" && typeof current.revision === "number") {
    return history.revision >= current.revision;
  }
  return typeof history.revision === "string" &&
    typeof current.revision === "string" &&
    history.revision === current.revision;
}

function mergeAssistantSnapshot(history: ChatMessage, current: ChatMessage): ChatMessage {
  const liveContentIsFuller = !historyRevisionIsAtLeastCurrent(history, current) &&
    current.content.length > history.content.length &&
    current.content.startsWith(history.content);
  return {
    ...history,
    ...identityWithHistoryPriority(history, current),
    renderId: current.renderId ?? history.renderId,
    content: liveContentIsFuller ? current.content : history.content,
    ...(liveContentIsFuller && current.eventId ? { eventId: current.eventId } : {}),
    ...(liveContentIsFuller && current.revision !== undefined ? { revision: current.revision } : {}),
    ...(!history.toolCalls?.length && current.toolCalls?.length ? { toolCalls: current.toolCalls } : {}),
    ...(!history.mediaUrls?.length && current.mediaUrls?.length ? { mediaUrls: current.mediaUrls } : {}),
    ...(!history.files?.length && current.files?.length ? { files: current.files } : {}),
    ...(!history.attachments?.length && current.attachments?.length ? { attachments: current.attachments } : {}),
    ...(current.status ? { status: current.status } : {}),
  };
}

function reconcileCurrentLastTurn(
  historyMessages: ChatMessage[],
  currentMessages: ChatMessage[],
): ChatMessage[] {
  const currentLastUserIndex = lastMessageIndex(currentMessages, "user");
  const currentTail = currentMessages.slice(currentLastUserIndex + 1);
  const currentAssistant = [...currentTail].reverse().find(assistantMessageHasVisibleReply);
  const protocolAssistantIndex = currentAssistant && hasProtocolCorrelation(currentAssistant)
    ? findProtocolMatch(historyMessages, currentAssistant, "assistant")
    : -1;
  const reconciledHistory = protocolAssistantIndex >= 0 && currentAssistant
    ? historyMessages.map((message, index) => (
        index === protocolAssistantIndex ? mergeAssistantSnapshot(message, currentAssistant) : message
      ))
    : historyMessages;
  const historyLastUserIndex = lastMessageIndex(reconciledHistory, "user");
  if (currentLastUserIndex < 0 || historyLastUserIndex < 0) return reconciledHistory;

  const currentUser = currentMessages[currentLastUserIndex];
  const historyUser = reconciledHistory[historyLastUserIndex];
  if (!currentUser || !historyUser) return reconciledHistory;
  const matchedHistoryUserIndex = findProtocolMatch(reconciledHistory, currentUser, "user");
  const usersMatch = matchedHistoryUserIndex === historyLastUserIndex || sameLegacyUserTurn(currentUser, historyUser);
  if (!usersMatch) return reconciledHistory;

  const next = [...reconciledHistory];
  next[historyLastUserIndex] = {
    ...historyUser,
    ...identityWithHistoryPriority(historyUser, currentUser),
    renderId: currentUser.renderId ?? historyUser.renderId,
    ...(currentUser.retryContent ? { retryContent: currentUser.retryContent } : {}),
  };

  if (currentAssistant) {
    let historyAssistantIndex = protocolAssistantIndex >= historyLastUserIndex + 1
      ? protocolAssistantIndex
      : findProtocolMatch(next, currentAssistant, "assistant", historyLastUserIndex + 1);
    if (historyAssistantIndex < 0) {
      const legacyAssistantIndex = lastMessageIndex(next.slice(historyLastUserIndex + 1), "assistant");
      if (legacyAssistantIndex >= 0) {
        const absoluteIndex = historyLastUserIndex + 1 + legacyAssistantIndex;
        const historyAssistant = next[absoluteIndex];
        if (historyAssistant && (!hasProtocolCorrelation(currentAssistant) || !hasProtocolCorrelation(historyAssistant))) {
          historyAssistantIndex = absoluteIndex;
        }
      }
    }

    if (historyAssistantIndex >= 0) {
      const historyAssistant = next[historyAssistantIndex];
      if (historyAssistant) next[historyAssistantIndex] = mergeAssistantSnapshot(historyAssistant, currentAssistant);
    } else if (!next.slice(historyLastUserIndex + 1).some((message) => (
      message.role === "assistant" && hasProtocolCorrelation(message)
    ))) {
      next.push(...currentTail.filter(assistantMessageHasVisibleReply));
    }
  }

  const stoppedNotice = currentTail.find((message) => (
    message.role === "system" && message.content === OPENCLAW_REPLY_STOPPED_MESSAGE
  ));
  if (stoppedNotice && !next.slice(historyLastUserIndex + 1).some((message) => (
    message.role === "system" && message.content === OPENCLAW_REPLY_STOPPED_MESSAGE
  ))) {
    next.push(stoppedNotice);
  }

  return dedupeChatMessages(next);
}

function assistantMessageHasVisibleReply(message: ChatMessage): boolean {
  return (
    message.role === "assistant" &&
    (
      message.content.trim().length > 0 ||
      (message.toolCalls?.length ?? 0) > 0 ||
      (message.mediaUrls?.length ?? 0) > 0 ||
      (message.files?.length ?? 0) > 0
    )
  );
}

export function sameChatHistoryTarget(a: ChatHistoryTarget, b: ChatHistoryTarget): boolean {
  return a.agentId === b.agentId && a.sessionKey === b.sessionKey;
}

export function reduceChatHistoryMessages(current: ChatMessage[], action: ChatHistoryAction): ChatMessage[] {
  const currentMessages = dedupeChatMessages(current);

  if (action.type === "apply-update") {
    const next = typeof action.update === "function" ? action.update(currentMessages) : action.update;
    return dedupeChatMessages(next);
  }

  if (action.type === "append-system-message") {
    return dedupeChatMessages([
      ...currentMessages,
      { role: "system", content: action.content, timestamp: action.timestamp ?? Date.now() },
    ]);
  }

  if (action.type === "append-user-message") {
    return dedupeChatMessages([...currentMessages, action.message]);
  }

  if (action.type === "clear") {
    return [];
  }

  if (action.type === "mark-interrupted") {
    const lastAssistantIndex = (() => {
      for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
        if (currentMessages[index]?.role === "assistant") return index;
        if (currentMessages[index]?.role === "user") return -1;
      }
      return -1;
    })();
    const lastAssistant = lastAssistantIndex >= 0 ? currentMessages[lastAssistantIndex] : null;
    if (lastAssistant && assistantMessageHasVisibleReply(lastAssistant)) {
      return currentMessages.map((message, index) => (
        index === lastAssistantIndex ? { ...message, status: "interrupted" } : message
      ));
    }
    if (currentMessages[currentMessages.length - 1]?.role === "system" && currentMessages[currentMessages.length - 1]?.content === OPENCLAW_REPLY_STOPPED_MESSAGE) {
      return currentMessages;
    }
    return dedupeChatMessages([
      ...currentMessages,
      { role: "system", content: OPENCLAW_REPLY_STOPPED_MESSAGE, timestamp: Date.now() },
    ]);
  }

  if (action.type === "merge-history-refresh") {
    const historyMessages = retainHistoryRenderIds(dedupeChatMessages(action.messages), currentMessages);
    if (historyMessages.length === 0) return currentMessages;
    const currentUserCount = currentMessages.filter((message) => message.role === "user").length;
    const historyUserCount = historyMessages.filter((message) => message.role === "user").length;
    if (currentMessages.length > 0 && historyMessages.length < currentMessages.length && historyUserCount < currentUserCount) {
      return currentMessages;
    }
    return reconcileCurrentLastTurn(historyMessages, currentMessages);
  }

  if (action.type === "replace") {
    return retainHistoryRenderIds(dedupeChatMessages(action.messages), currentMessages);
  }

  if (action.type === "restore-cache") {
    return dedupeChatMessages(action.messages);
  }

  return currentMessages;
}
