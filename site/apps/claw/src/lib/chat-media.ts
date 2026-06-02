import { normalizeOpenClawMediaDisplayPath, normalizeOpenClawMediaFilePath } from "@/lib/agent-file-path";
import type { ChatPendingFile } from "@/lib/openclaw-chat";

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const IMAGE_URL_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#].*)?$/i;
const AUDIO_EXTENSIONS = /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)$/i;
const AUDIO_URL_EXTENSIONS = /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)(?:[?#].*)?$/i;
const NON_IMAGE_URL_EXTENSIONS = /\.(pdf|csv|txt|md|json|ya?ml|zip|gz|tar|xlsx?|docx?|pptx?)(?:[?#].*)?$/i;
const LOCAL_MEDIA_REFERENCE = /^media:/i;
const CONTENT_MEDIA_REFERENCE_LINE = /^\s*MEDIA(?::(?!\/\/)\s*(.*))?\s*$/i;
const CONTENT_LOCAL_MEDIA_REFERENCE_LINE = /^\s*(media:\/\/\S+)\s*$/i;
const CONTENT_MEDIA_MARKDOWN_LINE = /^\s*!\[([^\]]*)\](?:\(([^)]*)\))?\s*$/i;
const CONTENT_INLINE_MEDIA_REFERENCE = /\bMEDIA:(?!\/\/)\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|(\S+))/i;
const CONTENT_INLINE_LOCAL_MEDIA_REFERENCE = /\b(media:\/\/\S+)/i;
const UUID_FILE_SUFFIX = /---[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[^.?#]+)$/i;

export interface ContentMediaReference {
  file: ChatPendingFile;
  displayPath: string;
  raw?: string;
}

export type DirectChatMediaReference =
  | { kind: "image"; url: string; fileName: string; raw: string }
  | { kind: "audio"; url: string; fileName: string; raw: string }
  | { kind: "link"; url: string; fileName: string; raw: string }
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
  return file.type?.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name ?? "") || IMAGE_EXTENSIONS.test(file.path ?? "");
}

export function isAudioFileReference(file: { name?: string; path?: string; type?: string }): boolean {
  return file.type?.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name ?? "") || AUDIO_EXTENSIONS.test(file.path ?? "");
}

export function inferChatMediaFileType(path: string): string {
  const extension = path.split(/[?#]/)[0]?.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "aac": return "audio/aac";
    case "flac": return "audio/flac";
    case "m4a": return "audio/mp4";
    case "mp3": return "audio/mpeg";
    case "oga":
    case "ogg":
    case "opus": return "audio/ogg";
    case "wav": return "audio/wav";
    case "weba":
    case "webm": return "audio/webm";
    case "bmp": return "image/bmp";
    case "gif": return "image/gif";
    case "ico": return "image/x-icon";
    case "jpeg":
    case "jpg": return "image/jpeg";
    case "png": return "image/png";
    case "svg": return "image/svg+xml";
    case "webp": return "image/webp";
    case "epub": return "application/epub+zip";
    case "pdf": return "application/pdf";
    case "txt": return "text/plain";
    default: return "application/octet-stream";
  }
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
    return { kind: "local", raw, label: "Preview unavailable" };
  }
  if (/^(?:data:audio\/|blob:)/i.test(value) || AUDIO_URL_EXTENSIONS.test(value)) {
    return { kind: "audio", url: value, fileName: mediaFileNameFromUrl(value, "audio"), raw };
  }
  if (/^data:image\//i.test(value) || IMAGE_URL_EXTENSIONS.test(value)) {
    return { kind: "image", url: value, fileName: mediaFileNameFromUrl(value), raw };
  }
  if (/^(?:https?:\/\/|\/)/i.test(value)) {
    if (NON_IMAGE_URL_EXTENSIONS.test(value)) {
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
  const key = ref.kind === "image" || ref.kind === "audio" || ref.kind === "link" ? ref.url : ref.raw;
  if (seen.has(key)) return;
  seen.add(key);
  refs.push(ref);
}

export function extractContentMediaReferences(content: string): ExtractedContentMediaReferences {
  const mediaFiles: ContentMediaReference[] = [];
  const directMedia: DirectChatMediaReference[] = [];
  const visibleLines: string[] = [];
  const seenWorkspaceMedia = new Set<string>();
  const seenDirectMedia = new Set<string>();
  let pendingMedia = false;

  const consumeReference = (raw: string): boolean => {
    const value = mediaWorkspacePathFromReference(raw);
    if (!value) {
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

  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const markdownMediaMatch = line.match(CONTENT_MEDIA_MARKDOWN_LINE);
    if (markdownMediaMatch && /^MEDIA\b/i.test(markdownMediaMatch[1]?.trim() ?? "")) {
      const altPath = markdownMediaMatch[1]?.replace(/^MEDIA:?\s*/i, "").trim();
      const srcPath = markdownMediaMatch[2]?.trim();
      const raw = srcPath || altPath || "";
      if (!raw) {
        pendingMedia = true;
        continue;
      }
      consumeReference(raw);
      continue;
    }

    if (/^\s*!\[MEDIA\b/i.test(line)) {
      pendingMedia = true;
      continue;
    }

    const localMediaMatch = line.match(CONTENT_LOCAL_MEDIA_REFERENCE_LINE);
    if (localMediaMatch?.[1]) {
      consumeReference(localMediaMatch[1]);
      continue;
    }

    const match = line.match(CONTENT_MEDIA_REFERENCE_LINE);
    if (!match) {
      visibleLines.push(line);
      continue;
    }

    consumeReference(match[1] ?? "");
  }

  const visibleContent = visibleLines
    .map((line) => {
      const inlineMatch = line.match(CONTENT_INLINE_MEDIA_REFERENCE);
      const raw = inlineMatch?.[1] ?? inlineMatch?.[2] ?? inlineMatch?.[3] ?? inlineMatch?.[4];
      if (inlineMatch && raw != null) {
        consumeReference(raw);
        return line.replace(inlineMatch[0], "").trimEnd();
      }
      const localInlineMatch = line.match(CONTENT_INLINE_LOCAL_MEDIA_REFERENCE);
      if (!localInlineMatch?.[1]) return line;
      consumeReference(localInlineMatch[1]);
      return line.replace(localInlineMatch[0], "").trimEnd();
    })
    .join("\n")
    .trim();

  return { content: visibleContent, mediaFiles, directMedia, pendingMedia };
}
