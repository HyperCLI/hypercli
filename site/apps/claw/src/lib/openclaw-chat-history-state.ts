import type { ChatMessage } from "@/lib/openclaw-chat";

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
  const seenVoiceNotes = new Set<string>();
  return messages.filter((message) => {
    const key = voiceNoteMessageKey(message);
    if (!key) return true;
    if (seenVoiceNotes.has(key)) return false;
    seenVoiceNotes.add(key);
    return true;
  });
}

function mergeCurrentToolCallsIntoHistory(
  historyMessages: ChatMessage[],
  currentMessages: ChatMessage[],
): ChatMessage[] {
  let currentAssistantIndex = -1;
  for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
    const message = currentMessages[index];
    if (message?.role === "assistant" && (message.toolCalls?.length ?? 0) > 0) {
      currentAssistantIndex = index;
      break;
    }
  }
  if (currentAssistantIndex === -1) return historyMessages;

  const currentAssistant = currentMessages[currentAssistantIndex];
  const currentToolCalls = currentAssistant?.toolCalls;
  if (!currentToolCalls?.length) return historyMessages;

  const currentUserCount = currentMessages
    .slice(0, currentAssistantIndex)
    .filter((message) => message.role === "user").length;
  let historyUserCount = 0;
  let historyAssistantIndex = -1;
  for (let index = 0; index < historyMessages.length; index += 1) {
    const message = historyMessages[index];
    if (!message) continue;
    if (message.role === "user") {
      historyUserCount += 1;
      continue;
    }
    if (message.role === "assistant" && historyUserCount === currentUserCount) {
      historyAssistantIndex = index;
    }
  }
  if (historyAssistantIndex === -1) {
    const historyUserCount = historyMessages.filter((message) => message.role === "user").length;
    if (historyUserCount === currentUserCount) {
      return dedupeChatMessages([...historyMessages, currentAssistant]);
    }
    return historyMessages;
  }

  const historyAssistant = historyMessages[historyAssistantIndex];
  if (!historyAssistant) return historyMessages;
  return historyMessages.map((message, index) => (
    index === historyAssistantIndex
      ? {
          ...historyAssistant,
          toolCalls: historyAssistant.toolCalls?.length ? historyAssistant.toolCalls : currentToolCalls,
        }
      : message
  ));
}

function preservePendingAssistantTail(
  historyMessages: ChatMessage[],
  currentMessages: ChatMessage[],
): ChatMessage[] {
  const currentUserCount = currentMessages.filter((message) => message.role === "user").length;
  const historyUserCount = historyMessages.filter((message) => message.role === "user").length;
  if (currentUserCount === 0 || currentUserCount !== historyUserCount) return historyMessages;

  let currentLastUserIndex = -1;
  for (let index = currentMessages.length - 1; index >= 0; index -= 1) {
    if (currentMessages[index]?.role === "user") {
      currentLastUserIndex = index;
      break;
    }
  }
  let historyLastUserIndex = -1;
  for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
    if (historyMessages[index]?.role === "user") {
      historyLastUserIndex = index;
      break;
    }
  }
  if (currentLastUserIndex < 0 || historyLastUserIndex < 0) return historyMessages;
  if (historyMessages.slice(historyLastUserIndex + 1).some(assistantMessageHasVisibleReply)) return historyMessages;

  const pendingAssistantMessages = currentMessages
    .slice(currentLastUserIndex + 1)
    .filter(assistantMessageHasVisibleReply);
  return pendingAssistantMessages.length > 0
    ? dedupeChatMessages([...historyMessages, ...pendingAssistantMessages])
    : historyMessages;
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
  if (action.type === "apply-update") {
    const next = typeof action.update === "function" ? action.update(current) : action.update;
    return dedupeChatMessages(next);
  }

  if (action.type === "append-system-message") {
    return [...current, { role: "system", content: action.content, timestamp: action.timestamp ?? Date.now() }];
  }

  if (action.type === "append-user-message") {
    return dedupeChatMessages([...current, action.message]);
  }

  if (action.type === "clear") {
    return [];
  }

  if (action.type === "mark-interrupted") {
    const lastAssistantIndex = (() => {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        if (current[index]?.role === "assistant") return index;
        if (current[index]?.role === "user") return -1;
      }
      return -1;
    })();
    const lastAssistant = lastAssistantIndex >= 0 ? current[lastAssistantIndex] : null;
    if (lastAssistant && assistantMessageHasVisibleReply(lastAssistant)) {
      return current.map((message, index) => (
        index === lastAssistantIndex ? { ...message, status: "interrupted" } : message
      ));
    }
    if (current[current.length - 1]?.role === "system" && current[current.length - 1]?.content === OPENCLAW_REPLY_STOPPED_MESSAGE) {
      return current;
    }
    return [...current, { role: "system", content: OPENCLAW_REPLY_STOPPED_MESSAGE, timestamp: Date.now() }];
  }

  if (action.type === "merge-history-refresh") {
    const historyMessages = dedupeChatMessages(action.messages);
    if (historyMessages.length === 0) return current;
    const currentUserCount = current.filter((message) => message.role === "user").length;
    const historyUserCount = historyMessages.filter((message) => message.role === "user").length;
    if (current.length > 0 && historyMessages.length < current.length && historyUserCount < currentUserCount) {
      return current;
    }
    return mergeCurrentToolCallsIntoHistory(
      preservePendingAssistantTail(historyMessages, current),
      current,
    );
  }

  if (action.type === "replace" || action.type === "restore-cache") {
    return dedupeChatMessages(action.messages);
  }

  return current;
}
