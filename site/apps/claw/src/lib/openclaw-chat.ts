"use client";

import {
  type GatewayChatAttachmentPayload,
  type GatewayEvent,
  type GatewayChatToolCall,
  type OpenClawConfigSchemaResponse,
  type GatewayClient,
  normalizeGatewayChatMessage,
} from "@hypercli.com/sdk/openclaw/gateway";

export type ChatAttachment = GatewayChatAttachmentPayload;

export interface ChatPendingFile {
  name: string;
  path: string;
  type: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  toolCalls?: Array<{ id?: string; name: string; args: string; result?: string }>;
  mediaUrls?: string[];
  attachments?: ChatAttachment[]; // user-sent images
  files?: ChatPendingFile[]; // user-sent workspace files
  timestamp?: number;
}

export interface WorkspaceFile {
  name: string;
  size: number;
  missing: boolean;
}

interface Agent {
  id: string;
  name: string;
  state: string;
  hostname: string | null;
}

function maybeDecodeMojibake(text: string): string {
  // Some gateways occasionally emit UTF-8 text decoded as latin1 (e.g. ð, â).
  if (!/[Ãâð]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8").decode(bytes);
    if (decoded && decoded !== text) return decoded;
  } catch {
    // Fall back to original text on decoding errors.
  }
  return text;
}

const BINARY_CONTENT_OMITTED_MESSAGE = "[Binary file content omitted from chat preview.]";
const INTERNAL_TOOL_OUTPUT_OMITTED_MESSAGE = "[Internal tool output hidden from chat.]";
const FILE_TYPE_BY_EXTENSION: Record<string, string> = {
  aac: "audio/aac",
  bmp: "image/bmp",
  flac: "audio/flac",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  wav: "audio/wav",
  weba: "audio/webm",
  webm: "audio/webm",
  csv: "text/csv",
  epub: "application/epub+zip",
  md: "text/markdown",
  pdf: "application/pdf",
  txt: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function looksLikeBinaryDisplayText(text: string): boolean {
  const sample = text.slice(0, 4096);
  if (/^\s*%PDF-\d+(?:\.\d+)?/.test(sample) || sample.slice(0, 1200).includes("%PDF-")) {
    return true;
  }
  if (sample.includes("\u0000")) {
    return true;
  }

  const replacementCount = sample.match(/\uFFFD/g)?.length ?? 0;
  const controlCount = sample.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g)?.length ?? 0;
  if (controlCount >= 3) {
    return true;
  }
  return replacementCount >= 8 && replacementCount / Math.max(sample.length, 1) > 0.01;
}

function isBinaryOmittedText(text: string | undefined): boolean {
  return text === BINARY_CONTENT_OMITTED_MESSAGE;
}

function sanitizeChatDisplayText(text: string): string {
  const decoded = maybeDecodeMojibake(text);
  return looksLikeBinaryDisplayText(decoded) ? BINARY_CONTENT_OMITTED_MESSAGE : decoded;
}

function normalizeChatRole(role: string): ChatMessage["role"] {
  const normalized = role.trim().toLowerCase();
  if (normalized === "user" || normalized === "assistant" || normalized === "system") {
    return normalized;
  }
  return "assistant";
}

const INTERNAL_HEARTBEAT_MARKERS = [/HEARTBEAT\.md/i, /HEARTBEAT_OK/i];
const INTERNAL_HEARTBEAT_PRELUDE_MARKERS = [
  /\bThe user wants me to read\b/i,
  /\bLet me read the file first\b/i,
];
const INTERNAL_HEARTBEAT_CONTROL_PROMPT_START = /\bRead\s+HEARTBEAT\.md\s+if\s+it\s+exists\b/i;
const INTERNAL_HEARTBEAT_CONTROL_PROMPT_DETAILS = [
  /\bworkspace context\b/i,
  /\bDo\s+not\s+infer\s+or\s+repeat\s+old\s+tasks\s+from\s+prior\s+chats\b/i,
  /\breply\s+HEARTBEAT_OK\b/i,
  /\/home\/node\/\.openclaw\/workspace\/HEARTBEAT\.md/i,
];
const INTERNAL_HISTORY_CONTENT_TYPES = new Set([
  "computer_call",
  "computer_call_output",
  "function_call",
  "function_call_output",
  "functioncall",
  "functioncalloutput",
  "input_image",
  "local_shell_call",
  "local_shell_call_output",
  "mcp_call",
  "mcp_list_tools",
  "reasoning",
  "thinking",
  "tool",
  "tool_call",
  "tool_output",
  "tool_use",
  "toolcall",
  "tooloutput",
  "tooluse",
  "tool_result",
  "toolresult",
  "audio",
  "input_audio",
  "output_audio",
  "image",
]);
const INTERNAL_TOOL_OUTPUT_CONTENT_TYPES = new Set([
  "computer_call_output",
  "function_call_output",
  "functioncalloutput",
  "local_shell_call_output",
  "tool_output",
  "tooloutput",
  "tool_result",
  "toolresult",
]);
const INTERNAL_WORKSPACE_PATH_MARKERS = ["/home/node/.openclaw/workspace", "/workspace"];
const INTERNAL_WORKSPACE_PATH_TOKEN = /^(?:\/home\/node\/\.openclaw\/workspace|\/workspace)(?:\/|$)/;
const INTERNAL_EXECUTION_STATUS_MARKERS = [
  /^\(?\s*command exited with code \d+\s*\)?\.?$/i,
  /^\(?\s*command failed with exit code \d+\s*\)?\.?$/i,
  /^\(?\s*process exited with code \d+\s*\)?\.?$/i,
  /^\(?\s*exit code:?\s*\d+\s*\)?\.?$/i,
];
const INTERNAL_EXECUTION_OUTPUT_MARKERS = [
  /\.\.\.\s*\(truncated\)\s*\.\.\./i,
  /^\s*PROOF\s+ANCHORS\b/i,
  /^\s*(?:stdout|stderr|tool output|command output|execution output|raw output)\s*[:\-]/i,
];
const MARKDOWN_HORIZONTAL_RULE = /^\s*[-*_]{3,}\s*$/;
const INTERNAL_ASYNC_COMMAND_COMPLETION_MARKERS = [
  /\bSystem\s*\(untrusted\):\s*\[[^\]]+\]\s*Exec completed\b/i,
  /\bAn async command you ran earlier has completed\b/i,
  /^\s*Exec completed\s*\([^)]*\bcode\s+\d+\b/i,
];

function stripTokenWrapper(token: string): string {
  return token
    .replace(/^[`"'([{<]+/, "")
    .replace(/[`"',.;:)\]}>]+$/, "");
}

function isLikelyInternalToolOutputText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (INTERNAL_EXECUTION_OUTPUT_MARKERS.some((marker) => marker.test(trimmed))) return true;
  if (!INTERNAL_WORKSPACE_PATH_MARKERS.some((marker) => trimmed.includes(marker))) return false;

  const tokens = trimmed.split(/\s+/).map(stripTokenWrapper).filter(Boolean);
  const pathTokens = tokens.filter((token) => INTERNAL_WORKSPACE_PATH_TOKEN.test(token));
  if (pathTokens.length < 3) return false;

  const nonPathWordCount = tokens
    .filter((token) => !INTERNAL_WORKSPACE_PATH_TOKEN.test(token))
    .join(" ")
    .match(/[A-Za-z]{3,}/g)?.length ?? 0;
  return pathTokens.length / Math.max(tokens.length, 1) >= 0.5 && nonPathWordCount < 8;
}

function isInternalExecutionStatusText(text: string): boolean {
  const trimmed = sanitizeChatDisplayText(text).trim();
  return INTERNAL_EXECUTION_STATUS_MARKERS.some((marker) => marker.test(trimmed));
}

function isInternalAsyncCommandCompletionText(text: string): boolean {
  const trimmed = sanitizeChatDisplayText(text).trim();
  return INTERNAL_ASYNC_COMMAND_COMPLETION_MARKERS.some((marker) => marker.test(trimmed));
}

function isInternalHeartbeatControlPromptText(text: string): boolean {
  const trimmed = sanitizeChatDisplayText(text).trim();
  if (!INTERNAL_HEARTBEAT_CONTROL_PROMPT_START.test(trimmed)) return false;
  return INTERNAL_HEARTBEAT_CONTROL_PROMPT_DETAILS.some((marker) => marker.test(trimmed));
}

const CRON_ASSISTANT_UUID_ENVELOPE = /^\s*\[cron:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\s+[^\]]*)?\]\s*/i;
const CRON_ASSISTANT_CONTEXTUAL_ENVELOPE = /^\s*\[cron:[^\]\n<]{1,240}(?:\]|(?=<system-reminder>))\s*/i;
const CRON_USER_MESSAGE_PREFIX = /^\s*\[cron/i;
const CRON_DELIVERY_REMINDER = /Return your response as plain text; it will be delivered automatically\.\s*If the task explicitly calls for messaging a specific external recipient, note who\/where it should go instead of sending it yourself\.?/i;
const SYSTEM_REMINDER_TAG = /<system-reminder>[\s\S]*?<\/system-reminder>/i;

function hasCronAssistantEnvelope(text: string): boolean {
  if (CRON_ASSISTANT_UUID_ENVELOPE.test(text)) return true;
  if (!CRON_ASSISTANT_CONTEXTUAL_ENVELOPE.test(text)) return false;
  return SYSTEM_REMINDER_TAG.test(text) || CRON_DELIVERY_REMINDER.test(text);
}

function stripCronInstructionLeak(text: string): string {
  if (!hasCronAssistantEnvelope(text)) return text;
  return "";
}

function isCronUserControlMessage(text: string): boolean {
  return CRON_USER_MESSAGE_PREFIX.test(text);
}

function isInternalExecutionOutputLine(line: string): boolean {
  return INTERNAL_EXECUTION_OUTPUT_MARKERS.some((marker) => marker.test(line.trim()));
}

function stripInternalAssistantContent(text: string): string {
  const withoutCronInstructions = stripCronInstructionLeak(text);
  const lines = withoutCronInstructions.replace(/\r\n/g, "\n").split("\n");
  const visible: string[] = [];
  let strippedInternalBlock = false;

  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? "";
    if (!isInternalExecutionOutputLine(line)) {
      visible.push(line);
      continue;
    }

    strippedInternalBlock = true;
    if (/\.\.\.\s*\(truncated\)\s*\.\.\./i.test(line)) {
      continue;
    }

    cursor += 1;
    while (cursor < lines.length) {
      const candidate = lines[cursor] ?? "";
      if (!candidate.trim()) break;
      if (MARKDOWN_HORIZONTAL_RULE.test(candidate)) break;
      cursor += 1;
    }
    while (cursor < lines.length && MARKDOWN_HORIZONTAL_RULE.test(lines[cursor] ?? "")) {
      cursor += 1;
    }
    cursor -= 1;
  }

  const visibleText = visible.join("\n");
  return strippedInternalBlock ? visibleText.trim() : visibleText;
}

function hasDisplayableMessageContent(message: ChatMessage): boolean {
  if (isInternalNoReplyMessage(message)) return false;
  if (isInternalAudioReplyCarrierMessage(message)) return false;
  return Boolean(
    message.content.trim() ||
    (message.toolCalls?.length ?? 0) > 0 ||
    (message.mediaUrls?.length ?? 0) > 0 ||
    (message.attachments?.length ?? 0) > 0 ||
    (message.files?.length ?? 0) > 0
  );
}

function isInternalNoReplyText(text: string): boolean {
  return /^NO_REPLY$/i.test(sanitizeChatDisplayText(text).trim());
}

function isInternalNoReplyMessage(message: ChatMessage): boolean {
  return message.role === "assistant" &&
    isInternalNoReplyText(message.content) &&
    !message.thinking?.trim() &&
    (message.toolCalls?.length ?? 0) === 0 &&
    (message.mediaUrls?.length ?? 0) === 0 &&
    (message.attachments?.length ?? 0) === 0 &&
    (message.files?.length ?? 0) === 0;
}

function isInternalAudioReplyCarrierText(text: string): boolean {
  return /^audio\s+reply[:.!?]*$/i.test(sanitizeChatDisplayText(text).trim());
}

function isInternalAudioReplyCarrierMessage(message: ChatMessage): boolean {
  return message.role === "assistant" &&
    isInternalAudioReplyCarrierText(message.content) &&
    !message.thinking?.trim() &&
    (message.toolCalls?.length ?? 0) === 0 &&
    (message.mediaUrls?.length ?? 0) === 0 &&
    (message.attachments?.length ?? 0) === 0 &&
    (message.files?.length ?? 0) === 0;
}

function containsInternalHeartbeatMarker(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") {
    const text = maybeDecodeMojibake(value);
    return INTERNAL_HEARTBEAT_MARKERS.some((marker) => marker.test(text));
  }
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => containsInternalHeartbeatMarker(entry));
  }
  return Object.values(value as Record<string, unknown>).some((entry) => containsInternalHeartbeatMarker(entry));
}

export function isInternalHeartbeatMessage(value: unknown): boolean {
  if (containsInternalHeartbeatMarker(value)) return true;
  if (typeof value !== "object" || value == null) return false;
  const candidate = value as {
    content?: unknown;
    thinking?: unknown;
    toolCalls?: unknown;
  };
  return (
    containsInternalHeartbeatMarker(candidate.content) ||
    containsInternalHeartbeatMarker(candidate.thinking) ||
    containsInternalHeartbeatMarker(candidate.toolCalls)
  );
}

function isLikelyInternalHeartbeatPrelude(message: ChatMessage): boolean {
  if (message.role !== "assistant") return false;
  if (message.toolCalls?.length || message.mediaUrls?.length || message.attachments?.length || message.files?.length) {
    return false;
  }
  const text = `${message.thinking ?? ""}\n${message.content ?? ""}`.trim();
  return INTERNAL_HEARTBEAT_PRELUDE_MARKERS.some((marker) => marker.test(text));
}

function formatToolValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return sanitizeChatDisplayText(value);
  try {
    return sanitizeChatDisplayText(JSON.stringify(value, null, 2));
  } catch {
    return sanitizeChatDisplayText(String(value));
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function extractAudioDataUrlFromContentItem(item: unknown): string | null {
  const record = asRecord(item);
  if (!record) return null;

  const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
  if (type !== "audio" && type !== "input_audio" && type !== "output_audio") {
    return null;
  }

  const directSource = asRecord(record.source);
  const nestedSource = asRecord(record.audio) ?? asRecord(record.input_audio) ?? asRecord(record.output_audio);
  const source = directSource ?? nestedSource ?? record;
  const sourceType = typeof source.type === "string" ? source.type.trim().toLowerCase() : "";

  if (sourceType === "url" && typeof source.url === "string" && source.url.trim()) {
    return source.url.trim();
  }
  if (sourceType && sourceType !== "base64" && sourceType !== "input_audio" && sourceType !== "output_audio") {
    return null;
  }

  const data = typeof source.data === "string" ? source.data.trim() : "";
  if (!data) return null;
  if (/^data:audio\//i.test(data)) return data;

  const mimeType =
    (typeof source.media_type === "string" && source.media_type.trim()) ||
    (typeof source.mime_type === "string" && source.mime_type.trim()) ||
    (typeof record.media_type === "string" && record.media_type.trim()) ||
    (typeof record.mime_type === "string" && record.mime_type.trim()) ||
    "audio/mpeg";
  return `data:${mimeType};base64,${data}`;
}

function extractGatewayContentAudioUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((entry) => extractGatewayContentAudioUrls(entry)));
  }

  const record = asRecord(value);
  if (!record) return [];

  const directAudio = extractAudioDataUrlFromContentItem(record);
  const nestedAudio = extractGatewayContentAudioUrls(record.content);
  return uniqueStrings([
    ...(directAudio ? [directAudio] : []),
    ...nestedAudio,
  ]);
}

function isHistoryWrapperLabelText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "message" || normalized === "assistant" || normalized === "assistant message";
}

function nestedVisibleRecordText(record: Record<string, unknown>): string {
  return [record.output, record.message, record.messages, record.content]
    .map((value) => extractVisibleHistoryText(value))
    .filter((value) => value.trim() && !isHistoryWrapperLabelText(value) && !isInternalExecutionStatusText(value))
    .join("\n");
}

function chooseVisibleHistoryText(normalizedText: string, fallbackText: string): string {
  const fallback = fallbackText.trim();
  if (fallback && (
    !normalizedText.trim() ||
    isHistoryWrapperLabelText(normalizedText) ||
    isInternalExecutionStatusText(normalizedText)
  )) {
    return fallbackText;
  }
  return normalizedText || fallbackText;
}

function looksLikeAssistantAnswerText(text: string): boolean {
  const trimmed = sanitizeChatDisplayText(text).trim();
  if (
    !trimmed ||
    isLikelyInternalToolOutputText(trimmed) ||
    isInternalExecutionStatusText(trimmed) ||
    isInternalHeartbeatMessage(trimmed)
  ) {
    return false;
  }
  if (/^[{[]/.test(trimmed)) return false;

  const words = trimmed.match(/[A-Za-z][A-Za-z']{1,}/g)?.length ?? 0;
  if (words < 5) return false;

  return (
    /[.!?](?:\s|$)/.test(trimmed) ||
    /:\s*(?:\n|$)/.test(trimmed) ||
    /^(?:no|yes|there|the|it|here|i|you|workspace)\b/i.test(trimmed)
  );
}

function extractNaturalLanguageToolOutputText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((entry) => extractNaturalLanguageToolOutputText(entry))
      .find((text) => text.trim()) ?? "";
  }

  const record = asRecord(value);
  if (!record) return "";

  const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
  const role = typeof record.role === "string" ? record.role.trim().toLowerCase() : "";
  const canUseDirectOutput = INTERNAL_TOOL_OUTPUT_CONTENT_TYPES.has(type) || role === "tool";
  if (canUseDirectOutput) {
    for (const key of ["text", "output", "content", "result"]) {
      const text = record[key];
      if (typeof text === "string" && looksLikeAssistantAnswerText(text)) {
        return text;
      }
    }
  }

  for (const key of ["content", "output", "message", "messages"]) {
    const text = extractNaturalLanguageToolOutputText(record[key]);
    if (text.trim()) return text;
  }
  return "";
}

function visibleContentItemText(item: unknown): string | null {
  if (typeof item === "string") return item;
  const record = asRecord(item);
  if (!record) return null;

  const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
  if (INTERNAL_HISTORY_CONTENT_TYPES.has(type)) return null;

  const nestedText = nestedVisibleRecordText(record);
  if (nestedText && (type === "message" || type.endsWith("_message"))) {
    return nestedText;
  }

  for (const key of ["text", "output_text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  if (typeof record.content === "string" && record.content.trim()) {
    return isHistoryWrapperLabelText(record.content) && nestedText ? nestedText : record.content;
  }

  if (nestedText) return nestedText;

  return null;
}

function extractVisibleHistoryText(message: unknown): string {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    return message
      .map((item) => visibleContentItemText(item))
      .filter((value): value is string => Boolean(value))
      .join("\n");
  }
  const record = asRecord(message);
  if (!record) return "";
  const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
  if (INTERNAL_HISTORY_CONTENT_TYPES.has(type)) return "";

  const nestedText = nestedVisibleRecordText(record);
  if (nestedText && (type === "message" || type.endsWith("_message"))) {
    return nestedText;
  }

  if (typeof record.content === "string") {
    return isInternalExecutionStatusText(record.content) && nestedText ? nestedText : record.content;
  }

  for (const key of ["text", "output_text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  if (nestedText) return nestedText;
  return "";
}

function fileNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function inferFileType(path: string): string {
  const extension = fileNameFromPath(path).split(".").pop()?.toLowerCase() ?? "";
  return FILE_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function isMediaAttachmentSentinel(line: string): boolean {
  return /^\s*\[media attached:\s*media:\/\/[^\]]+\]\s*$/i.test(line);
}

function extractUserVisibleContentAndFiles(content: string): { content: string; files: ChatPendingFile[] } {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let cursor = 0;
  const files: ChatPendingFile[] = [];
  while (/^file:\s+/i.test(lines[cursor]?.trim() ?? "")) {
    const path = (lines[cursor] ?? "")
      .replace(/^\s*file:\s+/i, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (path) {
      files.push({
        name: fileNameFromPath(path),
        path,
        type: inferFileType(path),
      });
    }
    cursor += 1;
  }
  if (cursor > 0 && lines[cursor]?.trim() === "") cursor += 1;
  const visibleLines = (cursor > 0 ? lines.slice(cursor) : lines)
    .filter((line) => !isMediaAttachmentSentinel(line));
  return {
    content: visibleLines.join("\n").trim(),
    files,
  };
}

function roleFromHistoryMessage(message: unknown): ChatMessage["role"] {
  const record = asRecord(message);
  const role = typeof record?.role === "string" ? record.role : "assistant";
  return normalizeChatRole(role);
}

function rawHistoryRole(message: unknown): string {
  const record = asRecord(message);
  return typeof record?.role === "string" ? record.role.trim().toLowerCase() : "";
}

function isInternalToolHistoryRole(role: string): boolean {
  return role === "tool" || role === "toolresult" || role === "tool_result";
}

function parseEmbeddedJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const candidate of [trimmed, trimmed.slice(Math.max(0, trimmed.indexOf("{")))]) {
    if (!candidate.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(candidate);
      return asRecord(parsed);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function readHistoryErrorPayload(message: unknown): { raw: string; type?: string; status?: string; message?: string } | null {
  const record = asRecord(message);
  if (!record) return null;
  const stopReason = typeof record.stopReason === "string" ? record.stopReason.trim().toLowerCase() : "";
  const raw = typeof record.errorMessage === "string" ? sanitizeChatDisplayText(record.errorMessage).trim() : "";
  if (!raw && stopReason !== "error") return null;

  const status = raw.match(/^\s*(\d{3})\b/)?.[1];
  const parsed = raw ? parseEmbeddedJsonObject(raw) : null;
  const parsedError = asRecord(parsed?.error);
  const parsedType = typeof parsedError?.type === "string" ? parsedError.type.trim() : undefined;
  const parsedMessage = typeof parsedError?.message === "string" ? sanitizeChatDisplayText(parsedError.message).trim() : undefined;
  const parsedCode = parsedError?.code;
  const parsedStatus = typeof parsedCode === "number" || typeof parsedCode === "string" ? String(parsedCode) : undefined;

  return {
    raw,
    ...(parsedType && parsedType.toLowerCase() !== "none" ? { type: parsedType } : {}),
    ...(status || parsedStatus ? { status: status ?? parsedStatus } : {}),
    ...(parsedMessage ? { message: parsedMessage } : {}),
  };
}

function normalizeHistoryErrorContent(message: unknown): string | null {
  const payload = readHistoryErrorPayload(message);
  if (!payload) return null;
  const firstLine = (payload.message || payload.raw).split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  const canShowFirstLine = firstLine && !/validation errors?|pydantic|field required|input_value/i.test(firstLine);
  if (canShowFirstLine && firstLine.length <= 160) {
    return `Assistant response failed: ${firstLine.replace(/[.。]+$/, "")}.`;
  }
  const detail = [payload.status, payload.type].filter(Boolean).join(" ");
  return `Assistant response failed before returning content${detail ? ` (${detail})` : ""}.`;
}

function summarizeToolCalls(
  toolCalls: GatewayChatToolCall[],
): ChatMessage["toolCalls"] | undefined {
  if (toolCalls.length === 0) {
    return undefined;
  }
  return toolCalls.map((toolCall) => ({
    ...(toolCall.id ? { id: toolCall.id } : {}),
    name: toolCall.name,
    args: formatToolValue(toolCall.args),
    ...(toolCall.result !== undefined ? { result: formatToolValue(toolCall.result) } : {}),
  }));
}

function normalizeHistoryMessage(message: unknown): ChatMessage | null {
  if (isInternalToolHistoryRole(rawHistoryRole(message))) return null;
  const normalized = normalizeGatewayChatMessage(message);
  const role = normalized ? normalizeChatRole(normalized.role) : roleFromHistoryMessage(message);
  const fallbackContent = extractVisibleHistoryText(message) || extractNaturalLanguageToolOutputText(message);
  const rawContent = chooseVisibleHistoryText(normalized?.text ?? "", fallbackContent);
  const userContent = role === "user"
    ? extractUserVisibleContentAndFiles(rawContent)
    : { content: rawContent, files: [] as ChatPendingFile[] };
  const rawSanitizedContent = sanitizeChatDisplayText(
    userContent.content,
  ).trim();
  if (role === "user" && isCronUserControlMessage(rawSanitizedContent)) {
    return null;
  }
  const content = role === "assistant" ? stripInternalAssistantContent(rawSanitizedContent) : rawSanitizedContent;
  if (isInternalHeartbeatControlPromptText(content)) {
    return null;
  }
  if (isInternalAsyncCommandCompletionText(content)) {
    return null;
  }
  const historyErrorContent = role === "assistant" && !content ? normalizeHistoryErrorContent(message) : null;
  if (historyErrorContent) {
    return {
      role: "system",
      content: historyErrorContent,
      timestamp: normalized?.timestamp ?? Date.now(),
    };
  }
  const thinking = sanitizeChatDisplayText(normalized?.thinking ?? "").trim();
  if (isInternalHeartbeatMessage({ thinking })) return null;
  const historyToolCalls = summarizeToolCalls(normalized?.toolCalls ?? []);
  if (historyToolCalls?.some((toolCall) => isInternalHeartbeatMessage({ toolCalls: [toolCall] }))) {
    return null;
  }
  const mediaUrls = uniqueStrings([
    ...(normalized?.mediaUrls ?? []),
    ...extractGatewayContentAudioUrls(message),
  ]);
  if (role === "assistant" && isInternalNoReplyText(content)) {
    return null;
  }
  if (role === "assistant" && isInternalAudioReplyCarrierText(content) && mediaUrls.length === 0) {
    return null;
  }
  if (role === "assistant" && (isLikelyInternalToolOutputText(content) || isInternalExecutionStatusText(content))) {
    return null;
  }
  if (!content.trim() && mediaUrls.length === 0 && userContent.files.length === 0) {
    return null;
  }
  return {
    role,
    content,
    ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
    ...(userContent.files.length > 0 ? { files: userContent.files } : {}),
    timestamp: normalized?.timestamp ?? Date.now(),
  };
}

function mergeToolCalls(
  current: NonNullable<ChatMessage["toolCalls"]>,
  incoming: NonNullable<ChatMessage["toolCalls"]>,
): NonNullable<ChatMessage["toolCalls"]> {
  const next = [...current];
  for (const toolCall of incoming) {
    let index = -1;
    for (let cursor = next.length - 1; cursor >= 0; cursor -= 1) {
      const entry = next[cursor];
      if (toolCall.id && entry.id && entry.id === toolCall.id) {
        index = cursor;
        break;
      }
      if (toolCall.result !== undefined) {
        if (entry.name === toolCall.name && entry.result == null) {
          index = cursor;
          break;
        }
        continue;
      }
      if (entry.name === toolCall.name && entry.args === toolCall.args) {
        index = cursor;
        break;
      }
    }
    if (index >= 0) {
      next[index] = {
        ...next[index],
        ...(toolCall.id ? { id: toolCall.id } : {}),
        ...(toolCall.args ? { args: toolCall.args } : {}),
        ...(toolCall.result !== undefined ? { result: toolCall.result } : {}),
      };
      continue;
    }
    next.push(toolCall);
  }
  return next;
}

function mergeAssistantMessage(current: ChatMessage, incoming: ChatMessage): ChatMessage {
  const cleanCurrent = sanitizeAssistantMessage(current);
  // Cumulative vs delta detection: only treat as cumulative when the incoming
  // text actually contains the current text as a prefix. The previous
  // length-based heuristic broke delta streams whenever a single chunk was
  // longer than the accumulated text, silently dropping prior content.
  const rawMergedContent = incoming.content
    ? (
      cleanCurrent.content && incoming.content.startsWith(cleanCurrent.content)
        ? incoming.content
        : `${cleanCurrent.content ?? ""}${incoming.content}`
    )
    : cleanCurrent.content;
  const mergedContent = isBinaryOmittedText(cleanCurrent.content) && incoming.content
    ? cleanCurrent.content
    : sanitizeChatDisplayText(rawMergedContent);
  const mergedMediaUrls = [
    ...(cleanCurrent.mediaUrls ?? []),
    ...((incoming.mediaUrls ?? []).filter((url) => !(cleanCurrent.mediaUrls ?? []).includes(url))),
  ];
  const mergedToolCalls = incoming.toolCalls
    ? mergeToolCalls(cleanCurrent.toolCalls ?? [], incoming.toolCalls)
    : cleanCurrent.toolCalls;
  return {
    ...cleanCurrent,
    content: mergedContent,
    ...(mergedToolCalls && mergedToolCalls.length > 0 ? { toolCalls: mergedToolCalls } : {}),
    ...(mergedMediaUrls.length > 0 ? { mediaUrls: mergedMediaUrls } : {}),
    timestamp: incoming.timestamp ?? cleanCurrent.timestamp,
  };
}

function sanitizeAssistantMessage(message: ChatMessage): ChatMessage {
  const rawContent = sanitizeChatDisplayText(message.content);
  const content = message.role === "assistant" ? stripInternalAssistantContent(rawContent) : rawContent;
  const toolCalls = message.toolCalls?.map((toolCall) => {
    const result = toolCall.result !== undefined ? sanitizeChatDisplayText(toolCall.result) : undefined;
    return {
      ...toolCall,
      args: sanitizeChatDisplayText(toolCall.args),
      ...(result !== undefined
        ? { result: (isLikelyInternalToolOutputText(result) || isInternalExecutionStatusText(result)) ? INTERNAL_TOOL_OUTPUT_OMITTED_MESSAGE : result }
        : {}),
    };
  });
  return {
    role: message.role,
    content: message.role === "assistant" && (
      isInternalNoReplyText(content) ||
      isInternalHeartbeatControlPromptText(content) ||
      isLikelyInternalToolOutputText(content) ||
      isInternalAsyncCommandCompletionText(content) ||
      isInternalExecutionStatusText(content)
    ) ? "" : content,
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    ...(message.mediaUrls && message.mediaUrls.length > 0 ? { mediaUrls: message.mediaUrls } : {}),
    ...(message.attachments && message.attachments.length > 0 ? { attachments: message.attachments } : {}),
    ...(message.files && message.files.length > 0 ? { files: message.files } : {}),
    ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
  };
}

function upsertAssistantMessage(prev: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (isInternalHeartbeatMessage(incoming)) {
    return last && isLikelyInternalHeartbeatPrelude(last) ? prev.slice(0, -1) : prev;
  }
  const sanitizedIncoming = sanitizeAssistantMessage(incoming);
  if (isInternalHeartbeatMessage(sanitizedIncoming)) {
    const last = prev[prev.length - 1];
    return last && isLikelyInternalHeartbeatPrelude(last) ? prev.slice(0, -1) : prev;
  }
  if (isInternalNoReplyMessage(sanitizedIncoming)) {
    return prev;
  }
  if (isInternalAudioReplyCarrierMessage(sanitizedIncoming)) {
    return prev;
  }
  if (!hasDisplayableMessageContent(sanitizedIncoming)) {
    const canMergeWhitespaceDelta = last?.role === "assistant" && sanitizedIncoming.role === "assistant" && sanitizedIncoming.content.length > 0;
    if (!canMergeWhitespaceDelta) return prev;
  }
  let next: ChatMessage[];
  if (last?.role === "assistant") {
    next = [...prev.slice(0, -1), mergeAssistantMessage(last, sanitizedIncoming)];
  } else {
    next = [...prev, sanitizedIncoming];
  }
  return next.filter((message) => (
    !isInternalHeartbeatMessage(message) &&
    !isInternalNoReplyMessage(message) &&
    !isInternalAudioReplyCarrierMessage(message) &&
    hasDisplayableMessageContent(message)
  ));
}

function liveToolCallId(payload: Record<string, unknown>): string | undefined {
  const id =
    (typeof payload.id === "string" && payload.id.trim()) ||
    (typeof payload.toolCallId === "string" && payload.toolCallId.trim()) ||
    (typeof payload.tool_call_id === "string" && payload.tool_call_id.trim());
  return id || undefined;
}

function liveToolName(payload: Record<string, unknown>): string | undefined {
  const name =
    (typeof payload.name === "string" && payload.name.trim()) ||
    (typeof payload.toolName === "string" && payload.toolName.trim()) ||
    (typeof payload.tool_name === "string" && payload.tool_name.trim());
  return name || undefined;
}

function hasLiveToolCallShape(payload: Record<string, unknown>): boolean {
  return Boolean(
    liveToolCallId(payload) ||
    liveToolName(payload) ||
    Object.prototype.hasOwnProperty.call(payload, "args") ||
    Object.prototype.hasOwnProperty.call(payload, "arguments")
  );
}

function normalizeLiveToolCall(
  payload: Record<string, unknown>,
): NonNullable<ChatMessage["toolCalls"]>[number] | null {
  const id = liveToolCallId(payload);
  const name = liveToolName(payload) ?? (hasLiveToolCallShape(payload) ? "tool" : undefined);
  if (!name) {
    return null;
  }
  return {
    ...(id ? { id } : {}),
    name,
    args: formatToolValue(payload.args ?? payload.arguments),
  };
}

function normalizeLiveToolResult(
  payload: Record<string, unknown>,
): NonNullable<ChatMessage["toolCalls"]>[number] | null {
  const resultValue = payload.result ?? payload.meta ?? payload.content ?? payload.text ?? payload.partialResult;
  if (resultValue == null) {
    return null;
  }
  const rawResult = formatToolValue(resultValue);
  const result = payload.isError === true ? `Error${rawResult ? `: ${rawResult}` : ""}` : rawResult;
  const id = liveToolCallId(payload);
  const name = liveToolName(payload) ?? "tool";
  return {
    ...(id ? { id } : {}),
    name,
    args: formatToolValue(payload.args ?? payload.arguments),
    result,
  };
}


export { maybeDecodeMojibake, normalizeHistoryMessage, normalizeLiveToolCall, normalizeLiveToolResult, sanitizeChatDisplayText, upsertAssistantMessage };
