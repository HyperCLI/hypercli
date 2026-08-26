"use client";

import {
  type GatewayChatAttachmentPayload,
  type GatewayEvent,
  type GatewayChatToolCall,
  type OpenClawConfigSchemaResponse,
  type GatewayClient,
  extractGatewayChatMediaUrls,
  normalizeGatewayChatMessage,
} from "@hypercli.com/sdk/openclaw/gateway";
import { inferFileMimeType } from "@hypercli/shared-ui/files";
import type { ChatImageCollectionDescriptor } from "@/lib/chat-image-collection";

export type ChatAttachment = GatewayChatAttachmentPayload;

export interface ChatPendingFile {
  name: string;
  path: string;
  type: string;
  /** Client-side details used to manage a staged large image drop. */
  imageCollection?: ChatImageCollectionDescriptor;
}

export interface ChatMessageProgress {
  text: string;
  state: "active" | "settled";
  /** Recent public commentary revisions used to remove mirrored chat prefixes. */
  revisions: string[];
}

export interface ChatMessageReasoning {
  text: string;
  state: "active" | "settled" | "incomplete";
  startedAt: number;
  completedAt?: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  /** Stable client identity used only to preserve the rendered row across updates. */
  readonly renderId?: string;
  /** Identifies a turn initiated by this browser so viewport behavior is not inferred from role alone. */
  readonly clientTurnId?: string;
  /** Client-only prompt used to retry a turn when its visible content differs from the agent input. */
  readonly retryContent?: string;
  eventId?: string;
  messageId?: string;
  turnId?: string;
  runId?: string;
  sessionKey?: string;
  revision?: number | string;
  status?: "interrupted";
  /** Legacy runtime-private thinking. Never render this field. */
  thinking?: string;
  /** Provider-authored reasoning rendered separately from answer content. */
  reasoning?: ChatMessageReasoning;
  progress?: ChatMessageProgress;
  toolCalls?: Array<{ id?: string; name: string; args: string; result?: string }>;
  mediaUrls?: string[];
  attachments?: ChatAttachment[]; // user-sent images
  files?: ChatPendingFile[]; // user-sent workspace files
  timestamp?: number;
}

export const OPENCLAW_EMPTY_REPLY_NOTICE = "The agent finished without a final response. Review any completed actions above before retrying.";

let fallbackRenderIdCounter = 0;

export function createChatRenderId(scope = "message"): string {
  const randomId = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${(fallbackRenderIdCounter += 1).toString(36)}`;
  return `${scope}:${randomId}`;
}

export function ensureChatMessageRenderId(message: ChatMessage, renderId?: string): ChatMessage {
  if (typeof message.renderId === "string" && message.renderId.trim()) return message;
  return { ...message, renderId: renderId?.trim() || createChatRenderId(message.role) };
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

const WINDOWS_1252_BYTE_BY_CODE_POINT = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function mojibakeSourceByte(character: string): number | undefined {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return undefined;
  if (codePoint <= 0xff) return codePoint;
  return WINDOWS_1252_BYTE_BY_CODE_POINT.get(codePoint);
}

function utf8SequenceLength(leadByte: number): number {
  if (leadByte >= 0xc2 && leadByte <= 0xdf) return 2;
  if (leadByte >= 0xe0 && leadByte <= 0xef) return 3;
  if (leadByte >= 0xf0 && leadByte <= 0xf4) return 4;
  return 0;
}

function hasStrongMojibakeEvidence(source: string, bytes: number[], decoded: string): boolean {
  if (!decoded || decoded === source || source.includes("\uFFFD") || decoded.includes("\uFFFD")) return false;
  if (Array.from(decoded).length !== 1 || utf8SequenceLength(bytes[0] ?? 0) !== bytes.length) return false;
  if (!bytes.slice(1).every((byte) => byte >= 0x80 && byte <= 0xbf)) return false;

  return Array.from(source).some((character, index) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      (index === 0 && codePoint >= 0x00c2 && codePoint <= 0x00f4) ||
      (codePoint >= 0x0080 && codePoint <= 0x009f) ||
      WINDOWS_1252_BYTE_BY_CODE_POINT.has(codePoint)
    );
  });
}

function hasPossibleMojibakeSequence(text: string): boolean {
  for (let cursor = 0; cursor < text.length; cursor += 1) {
    const leadByte = mojibakeSourceByte(text[cursor] ?? "");
    const sequenceLength = leadByte === undefined ? 0 : utf8SequenceLength(leadByte);
    if (sequenceLength === 0 || cursor + sequenceLength > text.length) continue;
    let complete = true;
    for (let offset = 1; offset < sequenceLength; offset += 1) {
      const byte = mojibakeSourceByte(text[cursor + offset] ?? "");
      if (byte === undefined || byte < 0x80 || byte > 0xbf) {
        complete = false;
        break;
      }
    }
    if (complete) return true;
  }
  return false;
}

function maybeDecodeMojibake(text: string): string {
  // Repair only complete UTF-8 byte sequences represented losslessly as Latin-1/Windows-1252.
  if (text.includes("\uFFFD") || !hasPossibleMojibakeSequence(text)) return text;
  const characters = Array.from(text);
  const output: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const encoder = new TextEncoder();

  for (let cursor = 0; cursor < characters.length;) {
    const leadByte = mojibakeSourceByte(characters[cursor] ?? "");
    const sequenceLength = leadByte === undefined ? 0 : utf8SequenceLength(leadByte);
    const source = sequenceLength > 0 ? characters.slice(cursor, cursor + sequenceLength) : [];
    const bytes = source.map(mojibakeSourceByte);
    if (
      source.length !== sequenceLength ||
      bytes.some((byte) => byte === undefined) ||
      !bytes.slice(1).every((byte) => byte !== undefined && byte >= 0x80 && byte <= 0xbf)
    ) {
      output.push(characters[cursor] ?? "");
      cursor += 1;
      continue;
    }

    try {
      const candidateBytes = Uint8Array.from(bytes as number[]);
      const decoded = decoder.decode(candidateBytes);
      const roundTrip = encoder.encode(decoded);
      const isLossless = roundTrip.length === candidateBytes.length &&
        roundTrip.every((byte, index) => byte === candidateBytes[index]);
      if (isLossless && hasStrongMojibakeEvidence(source.join(""), [...candidateBytes], decoded)) {
        output.push(decoded);
        cursor += sequenceLength;
        continue;
      }
    } catch {
      // Invalid UTF-8 is legitimate source text, not a repair candidate.
    }

    output.push(characters[cursor] ?? "");
    cursor += 1;
  }

  return output.join("");
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
  const hasPdfSignature = /^\s*%PDF-\d+(?:\.\d+)?(?=\r?\n|$)/.test(sample);
  const replacementCount = sample.match(/\uFFFD/g)?.length ?? 0;
  const controlCount = sample.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g)?.length ?? 0;
  const hasBinaryByteEvidence = sample.includes("\u0000") ||
    controlCount >= 3 ||
    (replacementCount >= 8 && replacementCount / Math.max(sample.length, 1) > 0.01);
  if (!hasPdfSignature) return hasBinaryByteEvidence;
  const hasPdfBinaryComment = sample
    .split(/\r?\n/)
    .slice(1, 6)
    .some((line) => line.startsWith("%") && Array.from(line.slice(1)).filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x80 && codePoint <= 0xff;
    }).length >= 4);
  return hasBinaryByteEvidence || hasPdfBinaryComment;
}

function isBinaryOmittedText(text: string | undefined): boolean {
  return text === BINARY_CONTENT_OMITTED_MESSAGE;
}

function sanitizeChatDisplayText(text: string): string {
  const decoded = maybeDecodeMojibake(text);
  return looksLikeBinaryDisplayText(decoded) ? BINARY_CONTENT_OMITTED_MESSAGE : decoded;
}

const OPENCLAW_EMPTY_REPLY_FAILURE_MARKERS = [
  "i finished the turn, but it did not produce a visible reply. please try again, or start a new session if this keeps happening.",
  "interactive agent run completed without a visible reply",
  "interactive follow-up completed without a visible reply",
  "completion agent did not produce a visible reply",
];

export function isOpenClawEmptyReplyFailureText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length <= OPENCLAW_EMPTY_REPLY_NOTICE.length && trimmed.toLowerCase() === OPENCLAW_EMPTY_REPLY_NOTICE.toLowerCase()) {
    return true;
  }
  if (!/(?:visible reply|completion agent)/i.test(text)) return false;
  const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return false;

  return OPENCLAW_EMPTY_REPLY_FAILURE_MARKERS.some((marker) => {
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex < 0) return false;
    const prefix = normalized.slice(0, markerIndex).trim().replace(/^⚠️\s*/u, "");
    return !prefix || /^(?:(?:[a-z]{1,4})?error:|assistant response failed:)$/.test(prefix);
  });
}

function normalizeOpenClawEmptyReplyText(text: string): string {
  return isOpenClawEmptyReplyFailureText(text) ? OPENCLAW_EMPTY_REPLY_NOTICE : text;
}

function normalizeChatRole(role: string): ChatMessage["role"] {
  const normalized = role.trim().toLowerCase();
  if (normalized === "user" || normalized === "assistant" || normalized === "system") {
    return normalized;
  }
  return "assistant";
}

const INTERNAL_HEARTBEAT_PRELUDE_MARKERS = [
  /^The user wants me to read\s+HEARTBEAT\.md\b[\s\S]*\bfollow it strictly\b/i,
  /^Let me read the file first\b[\s\S]*\bHEARTBEAT\.md\b/i,
];
const INTERNAL_HEARTBEAT_SENTINEL = /^HEARTBEAT_OK$/i;
const INTERNAL_HEARTBEAT_CONTROL_PROMPT_START = /^Read\s+HEARTBEAT\.md\s+if\s+it\s+exists\b/i;
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
];
const INTERNAL_EXECUTION_OUTPUT_MARKERS = [
  /^\s*PROOF\s+ANCHORS\b/i,
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
  if (text.length > 160 || !/\b(?:command|process)\b/i.test(text)) return false;
  const trimmed = text.trim();
  return INTERNAL_EXECUTION_STATUS_MARKERS.some((marker) => marker.test(trimmed));
}

function isInternalAsyncCommandCompletionText(text: string): boolean {
  if (!/\b(?:Exec completed|async command)\b/i.test(text)) return false;
  const trimmed = text.trim();
  return INTERNAL_ASYNC_COMMAND_COMPLETION_MARKERS.some((marker) => marker.test(trimmed));
}

function isInternalHeartbeatControlPromptText(text: string): boolean {
  const trimmed = text.trim();
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
  if (!/^\s*\[cron/i.test(text) && !/PROOF\s+ANCHORS/i.test(text)) return text;
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
    message.reasoning?.text.trim() ||
    message.progress?.text.trim() ||
    (message.toolCalls?.length ?? 0) > 0 ||
    (message.mediaUrls?.length ?? 0) > 0 ||
    (message.attachments?.length ?? 0) > 0 ||
    (message.files?.length ?? 0) > 0
  );
}

function isInternalNoReplyText(text: string): boolean {
  return text.length <= 24 && /^NO_REPLY$/i.test(text.trim());
}

function isInternalNoReplyMessage(message: ChatMessage): boolean {
  return message.role === "assistant" &&
    isInternalNoReplyText(message.content) &&
    !message.thinking?.trim() &&
    !message.reasoning?.text.trim() &&
    !message.progress?.text.trim() &&
    (message.toolCalls?.length ?? 0) === 0 &&
    (message.mediaUrls?.length ?? 0) === 0 &&
    (message.attachments?.length ?? 0) === 0 &&
    (message.files?.length ?? 0) === 0;
}

function isInternalAudioReplyCarrierText(text: string): boolean {
  return text.length <= 40 && /^audio\s+reply[:.!?]*$/i.test(text.trim());
}

function isInternalAudioReplyCarrierMessage(message: ChatMessage): boolean {
  return message.role === "assistant" &&
    isInternalAudioReplyCarrierText(message.content) &&
    !message.thinking?.trim() &&
    !message.progress?.text.trim() &&
    (message.toolCalls?.length ?? 0) === 0 &&
    (message.mediaUrls?.length ?? 0) === 0 &&
    (message.attachments?.length ?? 0) === 0 &&
    (message.files?.length ?? 0) === 0;
}

function isInternalHeartbeatText(text: string): boolean {
  const trimmed = text.trim();
  return INTERNAL_HEARTBEAT_SENTINEL.test(trimmed) ||
    isInternalHeartbeatControlPromptText(trimmed) ||
    INTERNAL_HEARTBEAT_PRELUDE_MARKERS.some((marker) => marker.test(trimmed));
}

function isExactHeartbeatPath(value: string): boolean {
  return /(?:^|[/\\])HEARTBEAT\.md$/i.test(value.trim().replace(/^['"]|['"]$/g, ""));
}

function hasExactHeartbeatPathArgument(value: unknown, allowDirectPath = true): boolean {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (allowDirectPath && isExactHeartbeatPath(trimmed)) return true;
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
    try {
      return hasExactHeartbeatPathArgument(JSON.parse(trimmed), false);
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasExactHeartbeatPathArgument(entry, false));
  }
  const record = asRecord(value);
  if (!record) return false;

  return Object.entries(record).some(([key, entry]) => {
    const normalizedKey = key.replace(/[_-]/g, "").toLowerCase();
    if (normalizedKey === "path" || normalizedKey === "filepath" || normalizedKey === "file") {
      return typeof entry === "string" && isExactHeartbeatPath(entry);
    }
    return typeof entry === "object" && entry !== null
      ? hasExactHeartbeatPathArgument(entry, false)
      : false;
  });
}

function isInternalHeartbeatToolCall(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!/(?:^|[.:/])(?:read|read_file)$/i.test(name)) return false;
  return hasExactHeartbeatPathArgument(record.args ?? record.arguments);
}

export function isInternalHeartbeatMessage(value: unknown): boolean {
  if (typeof value === "string") return isInternalHeartbeatText(value);
  const candidate = asRecord(value);
  if (!candidate) return false;

  const content = typeof candidate.content === "string" ? candidate.content : "";
  if (content && isInternalHeartbeatText(content)) return true;
  if (content.trim()) return false;

  const thinking = typeof candidate.thinking === "string" ? candidate.thinking : "";
  if (thinking && isInternalHeartbeatText(thinking)) return true;
  const toolCalls = Array.isArray(candidate.toolCalls) ? candidate.toolCalls : [];
  return toolCalls.some((toolCall) => isInternalHeartbeatToolCall(toolCall));
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

  if (typeof source.url === "string" && source.url.trim()) {
    return source.url.trim();
  }
  if (sourceType && sourceType !== "audio" && sourceType !== "base64" && sourceType !== "input_audio" && sourceType !== "output_audio") {
    return null;
  }

  const data = typeof source.data === "string" ? source.data.trim() : "";
  if (!data) return null;
  if (/^data:audio\//i.test(data)) return data;

  const rawMimeType =
    (typeof source.media_type === "string" && source.media_type.trim()) ||
    (typeof source.mime_type === "string" && source.mime_type.trim()) ||
    (typeof record.media_type === "string" && record.media_type.trim()) ||
    (typeof record.mime_type === "string" && record.mime_type.trim()) ||
    "";
  const rawFormat =
    (typeof source.format === "string" && source.format.trim().toLowerCase()) ||
    (typeof record.format === "string" && record.format.trim().toLowerCase()) ||
    "";
  const normalizedMimeType = rawMimeType.split(";", 1)[0].trim();
  const inferredMimeType = FILE_TYPE_BY_EXTENSION[rawFormat] ?? "";
  const mimeType = /^audio\/[A-Za-z0-9.+-]+$/i.test(normalizedMimeType)
    ? normalizedMimeType
    : /^audio\//i.test(inferredMimeType)
      ? inferredMimeType
      : "audio/mpeg";
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
  if (/(?:^|[/\\])(?:voice|audio|reply|tts|speech)[-_][^/\\]*\.webm(?:[?#].*)?$/i.test(path)) return "audio/webm";
  return inferFileMimeType(path);
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

function isDeliveryMirrorHistoryMessage(message: unknown): boolean {
  const record = asRecord(message);
  if (!record) return false;
  const provider = typeof record.provider === "string" ? record.provider.trim().toLowerCase() : "";
  const model = typeof record.model === "string" ? record.model.trim().toLowerCase() : "";
  return provider === "openclaw" && model === "delivery-mirror";
}

function isDisplayableDeliveryMirrorHistoryMessage(message: unknown): boolean {
  return isDeliveryMirrorHistoryMessage(message) &&
    (
      extractGatewayChatMediaUrls(message).length > 0 ||
      extractGatewayContentAudioUrls(message).length > 0
    );
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

function isAbortedHistoryMessage(message: unknown): boolean {
  const record = asRecord(message);
  if (!record) return false;
  const values = [record.stopReason, record.stop_reason, record.state, record.reason, record.errorMessage]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase().replace(/[.!]+$/, ""));
  return values.some((value) => value === "abort" || value === "aborted" || value === "canceled" || value === "cancelled");
}

function normalizeHistoryErrorContent(message: unknown): string | null {
  const payload = readHistoryErrorPayload(message);
  if (!payload) return null;
  if (isOpenClawEmptyReplyFailureText(payload.message || payload.raw)) {
    return OPENCLAW_EMPTY_REPLY_NOTICE;
  }
  const firstLine = (payload.message || payload.raw).split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  if (/context overflow|prompt too large|context length|maximum context/i.test(firstLine)) {
    return "The conversation is too large for the current model. Start a new session or compact the context, then retry.";
  }
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

function protocolIdentityString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function historyMessageIdentity(
  message: unknown,
  normalized: NonNullable<ReturnType<typeof normalizeGatewayChatMessage>> | null,
): Partial<Pick<ChatMessage, "messageId" | "turnId" | "runId" | "sessionKey" | "revision">> {
  const record = asRecord(message);
  const messageId = normalized?.messageId ?? protocolIdentityString(record?.messageId);
  const turnId = normalized?.turnId ?? protocolIdentityString(record?.turnId);
  const runId = normalized?.runId ?? protocolIdentityString(record?.runId);
  const sessionKey = normalized?.sessionKey ??
    protocolIdentityString(record?.canonicalSessionKey) ??
    protocolIdentityString(record?.sessionKey);
  const rawRevision = normalized?.revision ?? record?.revision;
  const revision = typeof rawRevision === "number" && Number.isFinite(rawRevision)
    ? rawRevision
    : protocolIdentityString(rawRevision);
  return {
    ...(messageId ? { messageId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(runId ? { runId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(revision !== undefined ? { revision } : {}),
  };
}

function historyMessageRenderId(
  role: ChatMessage["role"],
  identity: Partial<Pick<ChatMessage, "messageId" | "turnId" | "runId" | "sessionKey">>,
  timestamp?: number,
  content?: string,
): string {
  const scope = identity.sessionKey ?? "session";
  if (identity.messageId) return JSON.stringify(["history", scope, "message", identity.messageId]);
  if (identity.turnId) return JSON.stringify(["history", scope, "turn", identity.turnId, role]);
  if (identity.runId) return JSON.stringify(["history", scope, "run", identity.runId, role]);
  if (timestamp !== undefined) return JSON.stringify(["history", scope, "timestamp", timestamp, role, content ?? ""]);
  return createChatRenderId("history");
}

function historyStopReason(message: unknown): string {
  const record = asRecord(message);
  const nestedMessage = asRecord(record?.message);
  const value = record?.stopReason ?? record?.stop_reason ?? nestedMessage?.stopReason ?? nestedMessage?.stop_reason;
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[_-]/g, "") : "";
}

function normalizeHistoryMessage(
  message: unknown,
  options: { preserveBoundaryWhitespace?: boolean } = {},
): ChatMessage | null {
  if (isDeliveryMirrorHistoryMessage(message) && !isDisplayableDeliveryMirrorHistoryMessage(message)) return null;
  if (isInternalToolHistoryRole(rawHistoryRole(message))) return null;
  const normalized = normalizeGatewayChatMessage(message);
  const identity = historyMessageIdentity(message, normalized);
  const role = normalized ? normalizeChatRole(normalized.role) : roleFromHistoryMessage(message);
  const fallbackContent = extractVisibleHistoryText(message) || extractNaturalLanguageToolOutputText(message);
  const rawContent = chooseVisibleHistoryText(normalized?.text ?? "", fallbackContent);
  const userContent = role === "user"
    ? extractUserVisibleContentAndFiles(rawContent)
    : { content: rawContent, files: [] as ChatPendingFile[] };
  const sanitizedContent = sanitizeChatDisplayText(userContent.content);
  const rawSanitizedContent = options.preserveBoundaryWhitespace
    ? sanitizedContent
    : sanitizedContent.trim();
  if (role === "user" && isCronUserControlMessage(rawSanitizedContent)) {
    return null;
  }
  const content = role === "user"
    ? rawSanitizedContent
    : normalizeOpenClawEmptyReplyText(
      role === "assistant" ? stripInternalAssistantContent(rawSanitizedContent) : rawSanitizedContent,
    );
  const timestamp = normalized?.timestamp ?? Date.now();
  const renderId = historyMessageRenderId(role, identity, normalized?.timestamp, content);
  const reasoningText = role === "assistant"
    ? sanitizeChatDisplayText(normalized?.reasoning ?? "").trim()
    : "";
  if (isInternalHeartbeatControlPromptText(content)) {
    return null;
  }
  if (isInternalAsyncCommandCompletionText(content)) {
    return null;
  }
  if (role === "assistant" && !content && !reasoningText && isAbortedHistoryMessage(message)) {
    return null;
  }
  const historyErrorContent = role === "assistant" && !content && !reasoningText
    ? normalizeHistoryErrorContent(message)
    : null;
  if (historyErrorContent) {
    return {
      role: "system",
      content: historyErrorContent,
      timestamp: normalized?.timestamp ?? Date.now(),
      renderId,
      ...identity,
    };
  }
  const thinking = sanitizeChatDisplayText(normalized?.thinking ?? "").trim();
  const historyToolCalls = summarizeToolCalls(normalized?.toolCalls ?? []);
  if (!content && isInternalHeartbeatMessage({ thinking, toolCalls: historyToolCalls })) {
    return null;
  }
  const mediaUrls = uniqueStrings([
    ...(normalized?.mediaUrls ?? []),
    ...extractGatewayContentAudioUrls(message),
  ]);
  const isSettledProgress = role === "assistant" &&
    historyStopReason(message) === "tooluse" &&
    Boolean(content.trim()) &&
    (historyToolCalls?.length ?? 0) === 0 &&
    mediaUrls.length === 0 &&
    userContent.files.length === 0;
  const progress = isSettledProgress
    ? normalizeAssistantProgress({ text: content, state: "settled", revisions: [content] })
    : undefined;
  const reasoning = reasoningText
    ? normalizeAssistantReasoning({
        text: reasoningText,
        state: isAbortedHistoryMessage(message) ? "incomplete" : "settled",
        startedAt: timestamp,
        ...(!isAbortedHistoryMessage(message) ? { completedAt: timestamp } : {}),
      })
    : undefined;
  const visibleContent = progress ? "" : content;
  if (role === "assistant" && isInternalNoReplyText(content)) {
    return null;
  }
  if (role === "assistant" && isInternalHeartbeatText(content)) {
    return null;
  }
  if (role === "assistant" && isInternalAudioReplyCarrierText(content) && mediaUrls.length === 0) {
    return null;
  }
  if (role === "assistant" && (isLikelyInternalToolOutputText(content) || isInternalExecutionStatusText(content))) {
    return null;
  }
  if (
    !visibleContent.trim()
    && (!options.preserveBoundaryWhitespace || visibleContent.length === 0)
    && !progress
    && !reasoning
    && mediaUrls.length === 0
    && userContent.files.length === 0
  ) {
    return null;
  }
  return {
    role,
    content: visibleContent,
    renderId,
    ...identity,
    ...(reasoning ? { reasoning } : {}),
    ...(progress ? { progress } : {}),
    ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
    ...(userContent.files.length > 0 ? { files: userContent.files } : {}),
    timestamp,
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

interface AssistantUpsertOptions {
  replaceContent?: boolean;
  appendContent?: boolean;
  updateProgress?: "replace" | "append";
  updateReasoning?: "replace" | "append";
  startNewRound?: boolean;
}

const ASSISTANT_PROGRESS_REVISION_LIMIT = 16;
const ASSISTANT_PROGRESS_NEAR_PREFIX_MIN_LENGTH = 48;
const ASSISTANT_PROGRESS_NEAR_PREFIX_MAX_REMAINDER = 24;
const ASSISTANT_PROGRESS_NEAR_PREFIX_MIN_COVERAGE = 0.9;

function normalizeAssistantProgress(progress: ChatMessageProgress | undefined): ChatMessageProgress | undefined {
  if (!progress) return undefined;
  const text = sanitizeChatDisplayText(progress.text);
  if (!text.trim()) return undefined;
  const revisions = Array.from(new Set([
    ...(progress.revisions ?? []).map(sanitizeChatDisplayText).filter((revision) => revision.trim()),
    text,
  ])).slice(-ASSISTANT_PROGRESS_REVISION_LIMIT);
  return { text, state: progress.state, revisions };
}

function mergeAssistantProgress(
  current: ChatMessageProgress | undefined,
  incoming: ChatMessageProgress | undefined,
  update: AssistantUpsertOptions["updateProgress"],
): ChatMessageProgress | undefined {
  const normalizedCurrent = normalizeAssistantProgress(current);
  const normalizedIncoming = normalizeAssistantProgress(incoming);
  if (!normalizedIncoming) return normalizedCurrent;
  if (!normalizedCurrent) return normalizedIncoming;

  const text = update === "append"
    ? `${normalizedCurrent.text}${normalizedIncoming.text}`
    : normalizedIncoming.text;
  const revisions = Array.from(new Set([
    ...normalizedCurrent.revisions,
    normalizedCurrent.text,
    ...normalizedIncoming.revisions,
    normalizedIncoming.text,
    text,
  ])).filter((revision) => revision.trim()).slice(-ASSISTANT_PROGRESS_REVISION_LIMIT);
  return { text, state: normalizedIncoming.state, revisions };
}

function normalizeAssistantReasoning(reasoning: ChatMessageReasoning | undefined): ChatMessageReasoning | undefined {
  if (!reasoning) return undefined;
  const text = sanitizeChatDisplayText(reasoning.text);
  if (!text.trim()) return undefined;
  return {
    text,
    state: reasoning.state,
    startedAt: reasoning.startedAt,
    ...(reasoning.completedAt !== undefined ? { completedAt: reasoning.completedAt } : {}),
  };
}

function mergeAssistantReasoning(
  current: ChatMessageReasoning | undefined,
  incoming: ChatMessageReasoning | undefined,
  update: AssistantUpsertOptions["updateReasoning"],
): ChatMessageReasoning | undefined {
  const normalizedCurrent = normalizeAssistantReasoning(current);
  const normalizedIncoming = normalizeAssistantReasoning(incoming);
  if (!normalizedIncoming) return normalizedCurrent;
  if (!normalizedCurrent) return normalizedIncoming;
  return {
    text: update === "append"
      ? `${normalizedCurrent.text}${normalizedIncoming.text}`
      : normalizedIncoming.text,
    state: normalizedIncoming.state,
    startedAt: normalizedCurrent.startedAt,
    ...(normalizedIncoming.completedAt !== undefined
      ? { completedAt: normalizedIncoming.completedAt }
      : {}),
  };
}

export function stripAssistantProgressContent(
  content: string,
  progress: ChatMessageProgress | readonly string[] | undefined,
): string {
  if (!content || !progress) return content;
  const progressRevisions: readonly string[] = Array.isArray(progress)
    ? progress
    : [...(progress as ChatMessageProgress).revisions, (progress as ChatMessageProgress).text];
  const revisions = progressRevisions
    .map((revision) => sanitizeChatDisplayText(revision))
    .filter((revision) => revision.trim());
  if (revisions.length === 0) return content;

  const candidates = new Set(revisions);
  for (let start = 0; start < revisions.length; start += 1) {
    let sequence = "";
    for (let end = start; end < revisions.length; end += 1) {
      sequence = sequence ? `${sequence}\n${revisions[end]}` : revisions[end] ?? "";
      if (sequence) candidates.add(sequence);
    }
  }

  let matchedPrefixLength = 0;
  for (const candidate of candidates) {
    for (const prefix of [candidate, `\n${candidate}`, `\r\n${candidate}`]) {
      if (prefix.length > matchedPrefixLength && content.startsWith(prefix)) matchedPrefixLength = prefix.length;
    }
  }
  if (matchedPrefixLength > 0) return content.slice(matchedPrefixLength);

  // Some cumulative gateway frames switch to the answer before finishing the
  // commentary's last word. Only accept a near-prefix when the overlap is long
  // and nearly exhausts a known commentary revision.
  for (const candidate of candidates) {
    for (const leadingBreak of ["", "\n", "\r\n"]) {
      if (leadingBreak && !content.startsWith(leadingBreak)) continue;
      const value = content.slice(leadingBreak.length);
      const limit = Math.min(value.length, candidate.length);
      let overlap = 0;
      while (overlap < limit && value[overlap] === candidate[overlap]) overlap += 1;
      const remainder = candidate.length - overlap;
      const coverage = candidate.length > 0 ? overlap / candidate.length : 0;
      if (
        overlap >= ASSISTANT_PROGRESS_NEAR_PREFIX_MIN_LENGTH &&
        remainder <= ASSISTANT_PROGRESS_NEAR_PREFIX_MAX_REMAINDER &&
        coverage >= ASSISTANT_PROGRESS_NEAR_PREFIX_MIN_COVERAGE
      ) {
        matchedPrefixLength = Math.max(matchedPrefixLength, leadingBreak.length + overlap);
      }
    }
  }
  return matchedPrefixLength > 0 ? content.slice(matchedPrefixLength) : content;
}

function chatMessageProtocolIdentity(
  message: ChatMessage,
): Partial<Pick<ChatMessage, "eventId" | "messageId" | "turnId" | "runId" | "sessionKey" | "revision">> {
  return {
    ...(message.eventId ? { eventId: message.eventId } : {}),
    ...(message.messageId ? { messageId: message.messageId } : {}),
    ...(message.turnId ? { turnId: message.turnId } : {}),
    ...(message.runId ? { runId: message.runId } : {}),
    ...(message.sessionKey ? { sessionKey: message.sessionKey } : {}),
    ...(message.revision !== undefined ? { revision: message.revision } : {}),
  };
}

function hasAssistantCorrelationIdentity(message: ChatMessage): boolean {
  return Boolean(message.messageId || message.turnId || message.runId);
}

function matchingAssistantIndex(messages: ChatMessage[], incoming: ChatMessage): number {
  const findBy = (field: "messageId" | "turnId" | "runId" | "clientTurnId" | "renderId"): number => {
    const value = incoming[field];
    if (!value) return -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate?.role === "assistant" && candidate[field] === value) return index;
    }
    return -1;
  };

  if (incoming.messageId) {
    const messageIndex = findBy("messageId");
    if (messageIndex >= 0) return messageIndex;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate?.role !== "assistant" || candidate.messageId) continue;
      if (
        (incoming.turnId && candidate.turnId === incoming.turnId) ||
        (incoming.runId && candidate.runId === incoming.runId) ||
        (incoming.clientTurnId && candidate.clientTurnId === incoming.clientTurnId) ||
        (incoming.renderId && candidate.renderId === incoming.renderId)
      ) return index;
    }
    return -1;
  }

  for (const field of ["turnId", "runId", "clientTurnId", "renderId"] as const) {
    const index = findBy(field);
    if (index >= 0) return index;
  }

  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  if (last?.role !== "assistant") return -1;
  if (hasAssistantCorrelationIdentity(incoming) && hasAssistantCorrelationIdentity(last)) return -1;
  return lastIndex;
}

function mergeAssistantMessage(
  current: ChatMessage,
  incoming: ChatMessage,
  options: AssistantUpsertOptions = {},
): ChatMessage {
  const cleanCurrent = sanitizeAssistantMessage(current);
  const mergedProgress = mergeAssistantProgress(cleanCurrent.progress, incoming.progress, options.updateProgress);
  let mergedReasoning = mergeAssistantReasoning(cleanCurrent.reasoning, incoming.reasoning, options.updateReasoning);
  const currentContent = stripAssistantProgressContent(cleanCurrent.content, mergedProgress);
  const incomingContent = stripAssistantProgressContent(incoming.content, mergedProgress);
  // Cumulative vs delta detection: only treat as cumulative when the incoming
  // text actually contains the current text as a prefix. The previous
  // length-based heuristic broke delta streams whenever a single chunk was
  // longer than the accumulated text, silently dropping prior content.
  const rawMergedContent = options.replaceContent
    ? incomingContent
    : options.appendContent
      ? `${currentContent}${incomingContent}`
      : incomingContent
      ? (
        currentContent && incomingContent.startsWith(currentContent)
          ? incomingContent
          : `${currentContent}${incomingContent}`
      )
      : currentContent;
  const mergedContent = !options.replaceContent && (
    isBinaryOmittedText(cleanCurrent.content) || isBinaryOmittedText(incoming.content)
  ) && (cleanCurrent.content || incoming.content)
    ? BINARY_CONTENT_OMITTED_MESSAGE
    : normalizeOpenClawEmptyReplyText(sanitizeChatDisplayText(rawMergedContent));
  const mergedMediaUrls = [
    ...(cleanCurrent.mediaUrls ?? []),
    ...((incoming.mediaUrls ?? []).filter((url) => !(cleanCurrent.mediaUrls ?? []).includes(url))),
  ];
  const mergedToolCalls = incoming.toolCalls
    ? mergeToolCalls(cleanCurrent.toolCalls ?? [], incoming.toolCalls)
    : cleanCurrent.toolCalls;
  if (mergedReasoning?.state === "active" && (
    cleanCurrent.content.trim() ||
    (cleanCurrent.toolCalls?.length ?? 0) > 0 ||
    incoming.content.trim() ||
    (incoming.toolCalls?.length ?? 0) > 0
  )) {
    mergedReasoning = {
      ...mergedReasoning,
      state: "settled",
      completedAt: incoming.timestamp ?? cleanCurrent.timestamp ?? mergedReasoning.startedAt,
    };
  }
  const next: ChatMessage = {
    ...cleanCurrent,
    ...chatMessageProtocolIdentity(incoming),
    ...((cleanCurrent.clientTurnId ?? incoming.clientTurnId)
      ? { clientTurnId: cleanCurrent.clientTurnId ?? incoming.clientTurnId }
      : {}),
    ...((cleanCurrent.renderId ?? incoming.renderId)
      ? { renderId: cleanCurrent.renderId ?? incoming.renderId }
      : {}),
    content: mergedContent,
    ...(mergedReasoning ? { reasoning: mergedReasoning } : {}),
    ...(mergedProgress ? { progress: mergedProgress } : {}),
    ...(mergedToolCalls && mergedToolCalls.length > 0 ? { toolCalls: mergedToolCalls } : {}),
    ...(mergedMediaUrls.length > 0 ? { mediaUrls: mergedMediaUrls } : {}),
    status: incoming.status ?? cleanCurrent.status,
    timestamp: incoming.timestamp ?? cleanCurrent.timestamp,
  };
  return next;
}

function sanitizeAssistantMessage(message: ChatMessage): ChatMessage {
  const rawContent = sanitizeChatDisplayText(message.content);
  const content = message.role === "assistant"
    ? normalizeOpenClawEmptyReplyText(stripInternalAssistantContent(rawContent))
    : normalizeOpenClawEmptyReplyText(rawContent);
  const toolCalls = message.toolCalls?.filter((toolCall) => !isInternalHeartbeatToolCall(toolCall)).map((toolCall) => {
    const result = toolCall.result !== undefined ? sanitizeChatDisplayText(toolCall.result) : undefined;
    return {
      ...toolCall,
      args: sanitizeChatDisplayText(toolCall.args),
      ...(result !== undefined
        ? { result: (isLikelyInternalToolOutputText(result) || isInternalExecutionStatusText(result)) ? INTERNAL_TOOL_OUTPUT_OMITTED_MESSAGE : result }
        : {}),
    };
  });
  const progress = normalizeAssistantProgress(message.progress);
  const reasoning = normalizeAssistantReasoning(message.reasoning);
  return {
    role: message.role,
    content: message.role === "assistant" && (
      isInternalNoReplyText(content) ||
      isInternalHeartbeatText(content) ||
      isLikelyInternalToolOutputText(content) ||
      isInternalAsyncCommandCompletionText(content) ||
      isInternalExecutionStatusText(content)
    ) ? "" : content,
    ...chatMessageProtocolIdentity(message),
    ...(message.clientTurnId ? { clientTurnId: message.clientTurnId } : {}),
    ...(message.renderId ? { renderId: message.renderId } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(progress ? { progress } : {}),
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    ...(message.mediaUrls && message.mediaUrls.length > 0 ? { mediaUrls: message.mediaUrls } : {}),
    ...(message.attachments && message.attachments.length > 0 ? { attachments: message.attachments } : {}),
    ...(message.files && message.files.length > 0 ? { files: message.files } : {}),
    ...(message.status ? { status: message.status } : {}),
    ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
  };
}

function upsertAssistantMessage(
  prev: ChatMessage[],
  incoming: ChatMessage,
  options: AssistantUpsertOptions = {},
): ChatMessage[] {
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
  let assistantIndex = matchingAssistantIndex(prev, sanitizedIncoming);
  if (
    options.startNewRound &&
    assistantIndex >= 0 &&
    prev[assistantIndex]?.toolCalls?.some((toolCall) => toolCall.result !== undefined)
  ) {
    assistantIndex = -1;
  }
  if (!hasDisplayableMessageContent(sanitizedIncoming)) {
    const canUpdateExisting = assistantIndex >= 0 && (
      options.replaceContent === true ||
      sanitizedIncoming.content.length > 0 ||
      hasAssistantCorrelationIdentity(sanitizedIncoming)
    );
    if (!canUpdateExisting) return prev;
  }
  let next: ChatMessage[];
  if (assistantIndex >= 0) {
    next = prev.map((message, index) => (
      index === assistantIndex ? mergeAssistantMessage(message, sanitizedIncoming, options) : message
    ));
  } else {
    const renderIdAlreadyUsed = Boolean(
      sanitizedIncoming.renderId && prev.some((message) => message.renderId === sanitizedIncoming.renderId),
    );
    next = [
      ...prev,
      renderIdAlreadyUsed
        ? { ...sanitizedIncoming, renderId: createChatRenderId("assistant-round") }
        : sanitizedIncoming,
    ];
  }
  return next.filter((message) => (
    !isInternalHeartbeatMessage(message) &&
    !isInternalNoReplyMessage(message) &&
    !isInternalAudioReplyCarrierMessage(message) &&
    hasDisplayableMessageContent(message)
  ));
}

export function settleAssistantProgress(
  messages: ChatMessage[],
  identity: Partial<Pick<ChatMessage, "renderId" | "clientTurnId" | "messageId" | "turnId" | "runId" | "sessionKey">> = {},
): ChatMessage[] {
  const correlationFields = ["renderId", "clientTurnId", "messageId", "turnId", "runId"] as const;
  const suppliedCorrelations = correlationFields.filter((field) => Boolean(identity[field]));
  const hasSessionIdentity = Boolean(identity.sessionKey);
  let fallbackIndex = -1;
  if (suppliedCorrelations.length === 0 && !hasSessionIdentity) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant" && messages[index]?.progress?.state === "active") {
        fallbackIndex = index;
        break;
      }
    }
  }

  let changed = false;
  const next = messages.map((message, index) => {
    if (message.role !== "assistant" || message.progress?.state !== "active") return message;
    const sessionMatches = !hasSessionIdentity || message.sessionKey === identity.sessionKey;
    const correlationMatches = suppliedCorrelations.length === 0 || suppliedCorrelations.some((field) => (
      message[field] === identity[field]
    ));
    const matches = fallbackIndex >= 0 ? index === fallbackIndex : sessionMatches && correlationMatches;
    if (!matches) return message;
    changed = true;
    return { ...message, progress: { ...message.progress, state: "settled" as const } };
  });
  return changed ? next : messages;
}

export function settleAssistantReasoning(
  messages: ChatMessage[],
  identity: Partial<Pick<ChatMessage, "renderId" | "clientTurnId" | "messageId" | "turnId" | "runId" | "sessionKey">> = {},
  state: "settled" | "incomplete" = "settled",
): ChatMessage[] {
  const correlationFields = ["renderId", "clientTurnId", "messageId", "turnId", "runId"] as const;
  const suppliedCorrelations = correlationFields.filter((field) => Boolean(identity[field]));
  const hasSessionIdentity = Boolean(identity.sessionKey);
  let fallbackIndex = -1;
  if (suppliedCorrelations.length === 0 && !hasSessionIdentity) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant" && messages[index]?.reasoning?.state === "active") {
        fallbackIndex = index;
        break;
      }
    }
  }

  let changed = false;
  const next = messages.map((message, index) => {
    if (message.role !== "assistant" || message.reasoning?.state !== "active") return message;
    const sessionMatches = !hasSessionIdentity || message.sessionKey === identity.sessionKey;
    const correlationMatches = suppliedCorrelations.length === 0 || suppliedCorrelations.some((field) => (
      message[field] === identity[field]
    ));
    const matches = fallbackIndex >= 0 ? index === fallbackIndex : sessionMatches && correlationMatches;
    if (!matches) return message;
    changed = true;
    return {
      ...message,
      reasoning: {
        ...message.reasoning,
        state,
        ...(state === "settled" ? { completedAt: Date.now() } : {}),
      },
    };
  });
  return changed ? next : messages;
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
