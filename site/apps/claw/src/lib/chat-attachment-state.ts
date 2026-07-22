import type { ChatAttachment, ChatMessage, ChatPendingFile } from "@/lib/openclaw-chat";
import {
  classifyChatMediaReference,
  findFileForMediaReference,
  getChatFileLabel,
  inferChatMediaFileType,
  type DirectChatMediaReference,
} from "@/lib/chat-media";

const TOOL_WRITE_FILE_NAMES = new Set(["write", "write-file", "file-write", "create", "save", "edit"]);

export type AttachmentPresentationItem =
  | { state: "image-attachment"; attachment: ChatAttachment; key: string }
  | { state: "file"; file: ChatPendingFile; key: string }
  | { state: "image-url"; reference: Extract<DirectChatMediaReference, { kind: "image" }>; key: string }
  | { state: "audio-url"; reference: Extract<DirectChatMediaReference, { kind: "audio" }>; key: string }
  | { state: "video-url"; reference: Extract<DirectChatMediaReference, { kind: "video" }>; key: string }
  | { state: "link-url"; reference: Extract<DirectChatMediaReference, { kind: "link" }>; key: string }
  | { state: "unavailable"; label: string; key: string };

export type AttachmentPresentationState =
  | { status: "empty"; items: [] }
  | { status: "ready"; items: AttachmentPresentationItem[] };

export interface DeriveAttachmentPresentationInput {
  attachments?: ChatAttachment[];
  files?: ChatPendingFile[];
  mediaUrls?: string[];
  toolCalls?: ChatMessage["toolCalls"];
  includeToolWrittenFiles?: boolean;
}

function isWriteFileToolName(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/[_\s]+/g, "-");
  return TOOL_WRITE_FILE_NAMES.has(normalized) || normalized.endsWith("-write") || normalized.endsWith("-write-file");
}

function parseToolArgs(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeFilePath(path: string): string {
  return path.trim();
}

function dedupeFiles(files: ChatPendingFile[]): ChatPendingFile[] {
  const next = new Map<string, ChatPendingFile>();
  for (const file of files) {
    const path = normalizeFilePath(file.path);
    const name = file.name || getChatFileLabel({ path });
    if (!path || !name || next.has(path)) continue;
    next.set(path, {
      name,
      path,
      type: file.type || inferChatMediaFileType(path),
    });
  }
  return Array.from(next.values());
}

export function deriveToolWrittenFiles(toolCalls: ChatMessage["toolCalls"] | undefined): ChatPendingFile[] {
  const files: ChatPendingFile[] = [];
  for (const toolCall of toolCalls ?? []) {
    if (toolCall.result === undefined || !isWriteFileToolName(toolCall.name)) continue;
    const args = parseToolArgs(toolCall.args);
    const rawPath = args?.path ?? args?.file_path ?? args?.filePath ?? args?.fullPath;
    const path = typeof rawPath === "string" ? normalizeFilePath(rawPath) : "";
    if (!path) continue;
    files.push({
      name: getChatFileLabel({ path }),
      path,
      type: inferChatMediaFileType(path),
    });
  }
  return dedupeFiles(files);
}

export function deriveAttachmentPresentationState({
  attachments,
  files,
  mediaUrls,
  toolCalls,
  includeToolWrittenFiles = true,
}: DeriveAttachmentPresentationInput): AttachmentPresentationState {
  const items: AttachmentPresentationItem[] = [];
  const concreteFiles = dedupeFiles([
    ...(files ?? []),
    ...(includeToolWrittenFiles ? deriveToolWrittenFiles(toolCalls) : []),
  ]);

  for (const [index, attachment] of (attachments ?? []).entries()) {
    items.push({ state: "image-attachment", attachment, key: `attachment:${attachment.fileName ?? index}:${index}` });
  }

  for (const file of concreteFiles) {
    items.push({ state: "file", file, key: `file:${file.path}` });
  }

  for (const [index, url] of (mediaUrls ?? []).entries()) {
    const matchingFile = findFileForMediaReference(concreteFiles, url);
    if (matchingFile) continue;

    const reference = classifyChatMediaReference(url);
    if (reference.kind === "workspace") {
      items.push({ state: "file", file: reference.media.file, key: `media-file:${reference.media.file.path}:${index}` });
      continue;
    }
    if (reference.kind === "file") {
      items.push({
        state: "file",
        file: { name: reference.fileName, path: reference.raw, type: inferChatMediaFileType(reference.fileName) },
        key: `local-file:${reference.raw}:${index}`,
      });
      continue;
    }
    if (reference.kind === "image") {
      items.push({ state: "image-url", reference, key: `image:${reference.raw}:${index}` });
      continue;
    }
    if (reference.kind === "audio") {
      items.push({ state: "audio-url", reference, key: `audio:${reference.raw}:${index}` });
      continue;
    }
    if (reference.kind === "video") {
      items.push({ state: "video-url", reference, key: `video:${reference.raw}:${index}` });
      continue;
    }
    if (reference.kind === "link") {
      items.push({ state: "link-url", reference, key: `link:${reference.raw}:${index}` });
      continue;
    }
    items.push({ state: "unavailable", label: reference.label, key: `unavailable:${reference.raw}:${index}` });
  }

  return items.length > 0 ? { status: "ready", items } : { status: "empty", items: [] };
}
