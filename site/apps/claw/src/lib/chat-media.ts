import { normalizeOpenClawMediaDisplayPath, normalizeOpenClawMediaFilePath } from "@/lib/agent-file-path";
import type { ChatPendingFile } from "@/lib/openclaw-chat";
import {
  inferFileMimeType,
  isAudioFileReference as isSharedAudioFileReference,
  isImageFileReference as isSharedImageFileReference,
  isKnownNonImageFileReference,
  isVideoFileReference as isSharedVideoFileReference,
  resolveFileType,
} from "@hypercli/shared-ui/files";

const LOCAL_MEDIA_REFERENCE = /^media:/i;
const CONTENT_MEDIA_REFERENCE_LINE = /^\s*MEDIA(?::(?!\/\/)\s*(.*))?\s*$/i;
const CONTENT_LOCAL_MEDIA_REFERENCE_LINE = /^\s*(media:\/\/\S+)\s*$/i;
const CONTENT_MEDIA_MARKDOWN_LINE = /^\s*!\[([^\]]*)\](?:\(([^)]*)\))?\s*$/i;
const CONTENT_INLINE_MEDIA_REFERENCE = /\bMEDIA:(?!\/\/)\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|(\S+))/i;
const CONTENT_INLINE_LOCAL_MEDIA_REFERENCE = /\b(media:\/\/\S+)/i;
const UUID_FILE_SUFFIX = /---[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[^.?#]+)$/i;
const URL_SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

export interface ContentMediaReference {
  file: ChatPendingFile;
  displayPath: string;
  raw?: string;
}

export type DirectChatMediaReference =
  | { kind: "image"; url: string; fileName: string; raw: string }
  | { kind: "audio"; url: string; fileName: string; raw: string }
  | { kind: "video"; url: string; fileName: string; raw: string }
  | { kind: "link"; url: string; fileName: string; raw: string }
  | { kind: "file"; fileName: string; raw: string }
  | { kind: "local"; raw: string; label: string }
  | { kind: "unsupported"; raw: string; label: string };

export type ClassifiedChatMediaReference =
  | { kind: "workspace"; media: ContentMediaReference; raw: string }
  | DirectChatMediaReference;

export interface ExtractedContentMediaReferences {
  content: string;
  mediaFiles: ContentMediaReference[];
  directMedia: DirectChatMediaReference[];
  pendingMedia: boolean;
}

interface ExtractContentMediaOptions {
  streaming?: boolean;
}

export function getChatFileLabel(file: { name?: string; path?: string }): string {
  return file.name || file.path?.split("/").filter(Boolean).pop() || "file";
}

export function mediaFileNameFromUrl(url: string, fallback = "media"): string {
  if (/^data:/i.test(url.trim())) return fallback;
  try {
    const parsed = new URL(url, "https://hypercli.local");
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : fallback;
  } catch {
    return url.split(/[?#]/)[0].split("/").filter(Boolean).pop() || fallback;
  }
}

export function mediaFileNameFromReference(url: string): string {
  const rawName = mediaFileNameFromUrl(url);
  return rawName.replace(UUID_FILE_SUFFIX, "$1");
}

function stripMediaWrapper(value: string): string {
  let next = value
    .trim()
    .replace(/^MEDIA:(?!\/\/)\s*/i, "")
    .trim()
    .replace(/^[`"'(<[]+/, "")
    .replace(/[`"'>\]]+$/, "")
    .trim();

  while (/[),.;!?]$/.test(next)) {
    const candidate = next.slice(0, -1).trimEnd();
    if (!/\.[A-Za-z0-9]{2,5}[)\]]*$/i.test(candidate)) break;
    next = candidate;
  }
  return next;
}

export function mediaWorkspacePathFromReference(path: string): string {
  return stripMediaWrapper(path);
}

export function isGeneratedMediaPath(path: string): boolean {
  return /^(?:home\/node\/\.openclaw\/workspace|\.?openclaw\/workspace|workspace|home)(?:\/|$)/i.test(
    mediaWorkspacePathFromReference(path).replace(/^\/+/, ""),
  );
}

export function isImageFileReference(file: { name?: string; path?: string; type?: string }): boolean {
  return isSharedImageFileReference(file);
}

export function isAudioFileReference(file: { name?: string; path?: string; type?: string }): boolean {
  return isSharedAudioFileReference(file);
}

export function isVideoFileReference(file: { name?: string; path?: string; type?: string }): boolean {
  return isSharedVideoFileReference(file);
}

export function isSafeDirectMediaUrl(value: string, kind?: "audio" | "image" | "video"): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("//") || /[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  const scheme = URL_SCHEME.exec(trimmed)?.[1]?.toLowerCase();
  if (!scheme) return true;
  if (scheme === "http" || scheme === "https" || scheme === "blob") return true;
  if (scheme !== "data") return false;
  return kind
    ? new RegExp(`^data:${kind}/`, "i").test(trimmed)
    : /^data:(?:audio|image|video)\//i.test(trimmed);
}

export function inferChatMediaFileType(path: string, mimeType?: string): string {
  return inferFileMimeType({ path, mimeType });
}

function isKnownLocalFileHandle(value: string): boolean {
  const fileType = resolveFileType(value);
  return fileType.known && fileType.kind !== "image" && fileType.kind !== "audio" && fileType.kind !== "video";
}

export function generatedMediaFileFromPath(path: string, matchingFile?: ChatPendingFile | null): ContentMediaReference {
  const displayPath = normalizeOpenClawMediaDisplayPath(path);
  const filePath = normalizeOpenClawMediaFilePath(matchingFile?.path || path);
  return {
    displayPath,
    raw: path,
    file: {
      name: matchingFile?.name || getChatFileLabel({ path: displayPath }),
      path: filePath,
      type: matchingFile?.type || inferChatMediaFileType(filePath),
    },
  };
}

export function findFileForMediaReference(files: ChatPendingFile[], url: string): ChatPendingFile | null {
  const mediaName = mediaFileNameFromReference(url);
  return files.find((file) => {
    const label = getChatFileLabel(file);
    return label === mediaName || file.name === mediaName || mediaName.startsWith(`${label}---`);
  }) ?? null;
}

export function classifyChatMediaReference(raw: string, matchingFile?: ChatPendingFile | null): ClassifiedChatMediaReference {
  const value = mediaWorkspacePathFromReference(raw);
  if (!value) return { kind: "unsupported", raw, label: "Preview unavailable" };
  if (isGeneratedMediaPath(value)) {
    return { kind: "workspace", media: generatedMediaFileFromPath(value, matchingFile), raw };
  }
  if (LOCAL_MEDIA_REFERENCE.test(value)) {
    if (isKnownLocalFileHandle(value)) {
      return { kind: "file", fileName: mediaFileNameFromReference(value), raw };
    }
    return { kind: "local", raw, label: "Preview unavailable" };
  }
  if (!isSafeDirectMediaUrl(value)) return { kind: "unsupported", raw, label: "Preview unavailable" };
  if (/^data:/i.test(value)) {
    if (/^data:audio\//i.test(value)) return { kind: "audio", url: value, fileName: mediaFileNameFromUrl(value, "audio"), raw };
    if (/^data:video\//i.test(value)) return { kind: "video", url: value, fileName: mediaFileNameFromUrl(value, "video"), raw };
    if (/^data:image\//i.test(value)) return { kind: "image", url: value, fileName: mediaFileNameFromUrl(value), raw };
    return { kind: "unsupported", raw, label: "Preview unavailable" };
  }
  if (/^blob:/i.test(value)) {
    if (matchingFile && isAudioFileReference(matchingFile)) return { kind: "audio", url: value, fileName: getChatFileLabel(matchingFile), raw };
    if (matchingFile && isVideoFileReference(matchingFile)) return { kind: "video", url: value, fileName: getChatFileLabel(matchingFile), raw };
    if (matchingFile && isImageFileReference(matchingFile)) return { kind: "image", url: value, fileName: getChatFileLabel(matchingFile), raw };
    return { kind: "unsupported", raw, label: "Preview unavailable" };
  }
  if (isAudioFileReference({ path: value })) {
    return { kind: "audio", url: value, fileName: mediaFileNameFromUrl(value, "audio"), raw };
  }
  if (isVideoFileReference({ path: value })) {
    return { kind: "video", url: value, fileName: mediaFileNameFromUrl(value, "video"), raw };
  }
  if (isImageFileReference({ path: value })) {
    return { kind: "image", url: value, fileName: mediaFileNameFromUrl(value), raw };
  }
  if (/^(?:https?:\/\/|\/)/i.test(value)) {
    if (isKnownNonImageFileReference(value)) {
      return { kind: "link", url: value, fileName: mediaFileNameFromUrl(value), raw };
    }
    return { kind: "image", url: value, fileName: mediaFileNameFromUrl(value), raw };
  }
  return { kind: "unsupported", raw, label: "Preview unavailable" };
}

function addUniqueMediaReference(
  refs: ContentMediaReference[],
  ref: ContentMediaReference,
  seen: Set<string>,
): void {
  const key = ref.file.path || ref.displayPath;
  if (seen.has(key)) return;
  seen.add(key);
  refs.push(ref);
}

function addUniqueDirectReference(
  refs: DirectChatMediaReference[],
  ref: DirectChatMediaReference,
  seen: Set<string>,
): void {
  const key = ref.kind === "image" || ref.kind === "audio" || ref.kind === "video" || ref.kind === "link" ? ref.url : ref.raw;
  if (seen.has(key)) return;
  seen.add(key);
  refs.push(ref);
}

function isDefinitiveStreamingMediaReference(raw: string): boolean {
  const value = mediaWorkspacePathFromReference(raw);
  if (!value) return false;
  if (/^data:(?:audio|image|video)\//i.test(value)) return true;
  return isAudioFileReference({ path: value }) ||
    isVideoFileReference({ path: value }) ||
    isImageFileReference({ path: value }) ||
    isKnownNonImageFileReference(value);
}

export function extractContentMediaReferences(content: string, options: ExtractContentMediaOptions = {}): ExtractedContentMediaReferences {
  const mediaFiles: ContentMediaReference[] = [];
  const directMedia: DirectChatMediaReference[] = [];
  const visibleLines: string[] = [];
  const seenWorkspaceMedia = new Set<string>();
  const seenDirectMedia = new Set<string>();
  let pendingMedia = false;

  const consumeReference = (raw: string, deferAmbiguous = false): boolean => {
    const value = mediaWorkspacePathFromReference(raw);
    if (!value) {
      pendingMedia = true;
      return true;
    }
    if (deferAmbiguous && !isDefinitiveStreamingMediaReference(value)) {
      pendingMedia = true;
      return true;
    }
    const classified = classifyChatMediaReference(value);
    if (classified.kind === "workspace") {
      addUniqueMediaReference(mediaFiles, classified.media, seenWorkspaceMedia);
      return true;
    }
    addUniqueDirectReference(directMedia, classified, seenDirectMedia);
    return true;
  };

  const normalizedContent = content.replace(/\r\n/g, "\n");
  const contentLines = normalizedContent.split("\n");
  for (const [lineIndex, line] of contentLines.entries()) {
    const deferAmbiguous = Boolean(options.streaming && lineIndex === contentLines.length - 1 && !normalizedContent.endsWith("\n"));
    const markdownMediaMatch = line.match(CONTENT_MEDIA_MARKDOWN_LINE);
    if (markdownMediaMatch && /^MEDIA\b/i.test(markdownMediaMatch[1]?.trim() ?? "")) {
      const altPath = markdownMediaMatch[1]?.replace(/^MEDIA:?\s*/i, "").trim();
      const srcPath = markdownMediaMatch[2]?.trim();
      const raw = srcPath || altPath || "";
      if (!raw) {
        pendingMedia = true;
        continue;
      }
      consumeReference(raw, deferAmbiguous);
      continue;
    }

    if (/^\s*!\[MEDIA\b/i.test(line)) {
      pendingMedia = true;
      continue;
    }

    const localMediaMatch = line.match(CONTENT_LOCAL_MEDIA_REFERENCE_LINE);
    if (localMediaMatch?.[1]) {
      consumeReference(localMediaMatch[1], deferAmbiguous);
      continue;
    }

    const match = line.match(CONTENT_MEDIA_REFERENCE_LINE);
    if (!match) {
      visibleLines.push(line);
      continue;
    }

    consumeReference(match[1] ?? "", deferAmbiguous);
  }

  const visibleContent = visibleLines
    .map((line, lineIndex) => {
      const deferAmbiguous = Boolean(options.streaming && lineIndex === visibleLines.length - 1 && !normalizedContent.endsWith("\n"));
      const inlineMatch = line.match(CONTENT_INLINE_MEDIA_REFERENCE);
      const raw = inlineMatch?.[1] ?? inlineMatch?.[2] ?? inlineMatch?.[3] ?? inlineMatch?.[4];
      if (inlineMatch && raw != null) {
        consumeReference(raw, deferAmbiguous);
        return line.replace(inlineMatch[0], "").trimEnd();
      }
      const localInlineMatch = line.match(CONTENT_INLINE_LOCAL_MEDIA_REFERENCE);
      if (!localInlineMatch?.[1]) return line;
      consumeReference(localInlineMatch[1], deferAmbiguous);
      return line.replace(localInlineMatch[0], "").trimEnd();
    })
    .join("\n")
    .trim();

  return { content: visibleContent, mediaFiles, directMedia, pendingMedia };
}
