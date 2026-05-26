"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronDown, ChevronRight, Download, FileImage, FolderOpen, Loader2, Paperclip, Wrench } from "lucide-react";
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import type { ChatMessage as ChatMessageType, ChatPendingFile } from "@/lib/openclaw-chat";
import { getStoredToken } from "@/lib/api";
import { createAgentClient } from "@/lib/agent-client";
import { normalizeOpenClawMediaDisplayPath, normalizeOpenClawMediaFilePath, normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import { agentAvatar, type AgentMeta } from "@/lib/avatar";
import { ResourceImage } from "@/components/ResourceImage";
import { AudioPlayer } from "@/components/dashboard/chat/AudioPlayer";
import { ChatImageViewer } from "@/components/dashboard/chat/ChatImageViewer";
import { DirectoryVisualization, parseDirectoryVisualization } from "@/components/dashboard/chat/DirectoryVisualization";
import { CHAT_MARKDOWN_IMAGE_CLASS, MarkdownContent } from "@/components/dashboard/chat/MarkdownContent";

// ── Helpers ──

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const IMAGE_URL_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#].*)?$/i;
const AUDIO_EXTENSIONS = /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)$/i;
const AUDIO_URL_EXTENSIONS = /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)(?:[?#].*)?$/i;
const NON_IMAGE_URL_EXTENSIONS = /\.(pdf|csv|txt|md|json|ya?ml|zip|gz|tar|xlsx?|docx?|pptx?)(?:[?#].*)?$/i;
const LOCAL_MEDIA_REFERENCE = /^media:/i;
const CONTENT_MEDIA_REFERENCE_LINE = /^\s*MEDIA(?::\s*(.*))?\s*$/i;
const CONTENT_MEDIA_MARKDOWN_LINE = /^\s*!\[([^\]]*)\](?:\(([^)]*)\))?\s*$/i;
const CONTENT_INLINE_MEDIA_REFERENCE = /\bMEDIA:\s*(\S+)/i;

function extractImagePath(tc: { name: string; args: string; result?: string }): string | null {
  try {
    const args = JSON.parse(tc.args);
    const path = args.file_path || args.path || "";
    if (typeof path === "string" && IMAGE_EXTENSIONS.test(path)) return path;
  } catch { /* ignore */ }
  return null;
}

function isImageFileReference(file: { name?: string; path?: string; type?: string }): boolean {
  return file.type?.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name ?? "") || IMAGE_EXTENSIONS.test(file.path ?? "");
}

function isAudioFileReference(file: { name?: string; path?: string; type?: string }): boolean {
  return file.type?.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name ?? "") || AUDIO_EXTENSIONS.test(file.path ?? "");
}

function fileLabel(file: { name?: string; path?: string }): string {
  return file.name || file.path?.split("/").filter(Boolean).pop() || "file";
}

function normalizeChatFileReference(file: ChatPendingFile): ChatPendingFile | null {
  const candidate = file as Partial<ChatPendingFile>;
  const path = typeof candidate.path === "string" ? candidate.path : "";
  const name = typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : fileLabel({ path });
  const type = typeof candidate.type === "string" ? candidate.type : "";
  if (!path || !name) return null;
  return { name, path, type };
}

function findFileForAttachment(files: ChatPendingFile[], fileName: string | undefined): ChatPendingFile | null {
  if (!fileName) return null;
  return files.find((file) => file.name === fileName || fileLabel(file) === fileName) ?? null;
}

function mediaFileNameFromUrl(url: string, fallback = "media"): string {
  if (/^data:/i.test(url.trim())) return fallback;
  try {
    const parsed = new URL(url, "https://hypercli.local");
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : fallback;
  } catch {
    return url.split(/[?#]/)[0].split("/").filter(Boolean).pop() || fallback;
  }
}

function mediaFileNameFromReference(url: string): string {
  const rawName = mediaFileNameFromUrl(url);
  return rawName.replace(/---[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[^.?#]+)$/i, "$1");
}

function mediaWorkspacePathFromReference(path: string): string {
  return path.trim().replace(/^MEDIA:\s*/i, "");
}

function isGeneratedMediaPath(path: string): boolean {
  return /^(?:home\/node\/\.openclaw\/workspace|\.?openclaw\/workspace|workspace|home)(?:\/|$)/i.test(
    mediaWorkspacePathFromReference(path).replace(/^\/+/, ""),
  );
}

function findFileForMediaReference(files: ChatPendingFile[], url: string): ChatPendingFile | null {
  const mediaName = mediaFileNameFromReference(url);
  return files.find((file) => {
    const label = fileLabel(file);
    return label === mediaName || file.name === mediaName || mediaName.startsWith(`${label}---`);
  }) ?? null;
}

function isRenderableMediaImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || LOCAL_MEDIA_REFERENCE.test(trimmed)) return false;
  if (/^(?:data:image\/|blob:)/i.test(trimmed)) return true;
  if (IMAGE_URL_EXTENSIONS.test(trimmed)) return true;
  if (/^(?:https?:\/\/|\/)/i.test(trimmed)) return !NON_IMAGE_URL_EXTENSIONS.test(trimmed);
  return false;
}

function isPlayableMediaAudioUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || LOCAL_MEDIA_REFERENCE.test(trimmed)) return false;
  return /^(?:data:audio\/|blob:)/i.test(trimmed) || AUDIO_URL_EXTENSIONS.test(trimmed);
}

function inferChatMediaFileType(path: string): string {
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
    case "pdf": return "application/pdf";
    case "txt": return "text/plain";
    default: return "application/octet-stream";
  }
}

interface ContentMediaReference {
  file: ChatPendingFile;
  displayPath: string;
}

function generatedMediaFileFromPath(path: string, matchingFile?: ChatPendingFile | null): ContentMediaReference {
  const displayPath = normalizeOpenClawMediaDisplayPath(path);
  const filePath = normalizeOpenClawMediaFilePath(matchingFile?.path || path);
  return {
    displayPath,
    file: {
      name: matchingFile?.name || fileLabel({ path: displayPath }),
      path: filePath,
      type: matchingFile?.type || inferChatMediaFileType(filePath),
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAudioReplyCarrierText(value: string): boolean {
  return !value
    .replace(/\b(?:audio|voice|generated|reply|message|file|saved|created|available|at|here|is|the|your|an|as)\b/gi, "")
    .replace(/[`"'()[\]{}:;,.!?\-_/\\|]+/g, "")
    .trim();
}

function isVoiceNoteTranscriptionInstruction(value: string): boolean {
  return /^I recorded a voice message\.\s*Run this command to transcribe it:\s*`?hyper\s+voice\s+transcribe\s+\S+\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)`?\s*$/i.test(
    value.trim(),
  );
}

function stripInlineAudioReplyContent(content: string, file: AgentFileReference | null | undefined): string {
  if (!file?.path) return content;

  const fileName = fileLabel({ path: file.path });
  const normalizedPath = normalizeOpenClawWorkspaceFilePath(file.path);
  const references = [file.path, normalizedPath, fileName]
    .map((value) => value.trim())
    .filter(Boolean);
  if (references.length === 0) return content;

  const referenceSource = references.map(escapeRegExp).join("|");
  const referencePattern = new RegExp(referenceSource, "gi");
  const referenceTestPattern = new RegExp(referenceSource, "i");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const hasAudioReference = lines.some((line) => referenceTestPattern.test(line));
  if (!hasAudioReference) return content;

  return lines
    .filter((line) => {
      const withoutReference = line
        .replace(referencePattern, "")
        .replace(/\bMEDIA:?\b/gi, "")
        .trim();
      referencePattern.lastIndex = 0;
      return !isAudioReplyCarrierText(withoutReference);
    })
    .join("\n")
    .trim();
}

function isSameWorkspaceFilePath(left: string, right: string): boolean {
  return normalizeOpenClawWorkspaceFilePath(left) === normalizeOpenClawWorkspaceFilePath(right);
}

function extractContentMediaReferences(content: string): { content: string; mediaFiles: ContentMediaReference[]; pendingMedia: boolean } {
  const mediaFiles: ContentMediaReference[] = [];
  const visibleLines: string[] = [];
  let pendingMedia = false;

  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const markdownMediaMatch = line.match(CONTENT_MEDIA_MARKDOWN_LINE);
    if (markdownMediaMatch && /^MEDIA\b/i.test(markdownMediaMatch[1]?.trim() ?? "")) {
      const altPath = markdownMediaMatch[1]?.replace(/^MEDIA:?\s*/i, "").trim();
      const srcPath = markdownMediaMatch[2]?.trim();
      const path = mediaWorkspacePathFromReference(srcPath || altPath);
      if (!path) {
        pendingMedia = true;
        continue;
      }
      if (!isGeneratedMediaPath(path)) {
        visibleLines.push(line);
        continue;
      }
      mediaFiles.push(generatedMediaFileFromPath(path));
      continue;
    }

    if (/^\s*!\[MEDIA\b/i.test(line)) {
      pendingMedia = true;
      continue;
    }

    const match = line.match(CONTENT_MEDIA_REFERENCE_LINE);
    if (!match) {
      visibleLines.push(line);
      continue;
    }

    const path = mediaWorkspacePathFromReference(match[1] ?? "");
    if (!path) {
      pendingMedia = true;
      continue;
    }
    mediaFiles.push(generatedMediaFileFromPath(path));
  }

  const visibleContent = visibleLines
    .map((line) => {
      const inlineMatch = line.match(CONTENT_INLINE_MEDIA_REFERENCE);
      if (!inlineMatch?.[1]) return line;
      const path = mediaWorkspacePathFromReference(inlineMatch[1]);
      if (!path) {
        pendingMedia = true;
        return line.replace(/\bMEDIA:?\s*$/i, "").trimEnd();
      }
      if (!isGeneratedMediaPath(path)) {
        return line.replace(/\bMEDIA:?\s*$/i, "").trimEnd();
      }
      mediaFiles.push(generatedMediaFileFromPath(path));
      return line.replace(inlineMatch[0], "").trimEnd();
    })
    .join("\n")
    .trim();

  return { content: visibleContent, mediaFiles, pendingMedia };
}

interface ChatFileActionsProps {
  file: ChatPendingFile;
  onOpenFile?: (path: string) => void;
  onDownloadFile?: (file: ChatPendingFile) => void | Promise<void>;
  className?: string;
}

function ChatFileActions({ file, onOpenFile, onDownloadFile, className }: ChatFileActionsProps) {
  if (!file.path || (!onOpenFile && !onDownloadFile)) return null;

  const label = fileLabel(file);
  const buttonClass = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background/60 text-text-muted transition-colors hover:border-[#38D39F]/50 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38D39F]";

  return (
    <span className={`inline-flex shrink-0 items-center gap-1 ${className ?? "ml-1"}`}>
      {onOpenFile && (
        <button
          type="button"
          onClick={() => onOpenFile(file.path)}
          className={buttonClass}
          aria-label={`Open ${label} in files`}
          title="Open in files"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
      )}
      {onDownloadFile && (
        <button
          type="button"
          onClick={() => { void onDownloadFile(file); }}
          className={buttonClass}
          aria-label={`Download ${label}`}
          title="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

function ChatAudioFilePreview({
  file,
  agentId,
  readFileBytes,
  onOpenFile,
  onDownloadFile,
}: {
  file: ChatPendingFile;
  agentId: string;
  readFileBytes?: (path: string) => Promise<Uint8Array>;
  onOpenFile?: (path: string) => void;
  onDownloadFile?: (file: ChatPendingFile) => void | Promise<void>;
}) {
  const audioState = useAgentFileObjectState({ agentId, path: file.path }, readFileBytes);

  return (
    <div className="flex w-full max-w-[22rem] flex-col gap-1">
      <AudioPlayer
        src={audioState.url}
        title={file.name}
        loading={audioState.loading}
        error={audioState.failed}
        downloadHref={audioState.url ?? undefined}
        downloadFileName={file.name}
        downloadLabel={`Download ${file.name}`}
        onDownload={onDownloadFile ? () => onDownloadFile(file) : undefined}
      />
      <ChatFileActions
        file={file}
        onOpenFile={onOpenFile}
        onDownloadFile={undefined}
        className="self-start"
      />
    </div>
  );
}

interface GeneratedMediaFilePreviewProps {
  file: ChatPendingFile;
  displayPath: string;
  imagePreviewAgentId: string;
  readFileBytes?: (path: string) => Promise<Uint8Array>;
  onOpenFile?: (path: string) => void;
  onDownloadFile?: (file: ChatPendingFile) => void | Promise<void>;
}

function GeneratedMediaFilePreview({
  file,
  displayPath,
  imagePreviewAgentId,
  readFileBytes,
  onOpenFile,
  onDownloadFile,
}: GeneratedMediaFilePreviewProps) {
  const isAudio = isAudioFileReference(file);
  const audioState = useAgentFileObjectState(
    isAudio && imagePreviewAgentId ? { agentId: imagePreviewAgentId, path: file.path } : null,
    readFileBytes,
  );

  if (isAudio) {
    return (
      <div className="flex w-full max-w-[22rem] flex-col gap-1">
        <AudioPlayer
          src={audioState.url}
          title={file.name}
          loading={audioState.loading}
          error={audioState.failed}
          downloadHref={audioState.url ?? undefined}
          downloadFileName={file.name}
          downloadLabel={`Download ${file.name}`}
          onDownload={onDownloadFile ? () => onDownloadFile(file) : undefined}
        />
        <div className="flex max-w-full items-center gap-2">
          <span className="truncate text-[11px] text-text-muted" title={`MEDIA:${displayPath}`}>{file.name}</span>
          <ChatFileActions
            file={file}
            onOpenFile={onOpenFile}
            onDownloadFile={undefined}
            className=""
          />
        </div>
      </div>
    );
  }

  if (isImageFileReference(file) && imagePreviewAgentId) {
    return (
      <div className="flex max-w-full flex-col gap-1">
        <AuthImage
          file={{ agentId: imagePreviewAgentId, path: file.path }}
          alt={file.name}
          className="h-auto max-h-[240px] max-w-full rounded-md object-contain sm:max-w-[240px]"
          readFileBytes={readFileBytes}
          onOpenFile={onOpenFile ? () => onOpenFile(file.path) : undefined}
          onDownload={onDownloadFile ? () => onDownloadFile(file) : undefined}
        />
        <div className="flex max-w-full items-center gap-2">
          <span className="truncate text-[11px] text-text-muted" title={`MEDIA:${displayPath}`}>{file.name}</span>
          <ChatFileActions
            file={file}
            onOpenFile={onOpenFile}
            onDownloadFile={onDownloadFile}
            className=""
          />
        </div>
      </div>
    );
  }

  return (
    <div className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary">
      <Paperclip className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate" title={`MEDIA:${displayPath}`}>{file.name}</span>
      <ChatFileActions
        file={file}
        onOpenFile={onOpenFile}
        onDownloadFile={onDownloadFile}
      />
    </div>
  );
}

function ChatMediaUnavailable({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label="Media preview unavailable"
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
    >
      <FileImage className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );
}

function ChatMediaLoading() {
  return (
    <div
      role="status"
      aria-label="Loading preview"
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
    >
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      <span className="truncate">Preparing preview</span>
    </div>
  );
}

// ── Variant types ──

export type FeatureVariant = "off" | "v1" | "v2" | "v3";
export type ThinkingVariant = FeatureVariant;
export type TimestampVariant = FeatureVariant;
export type BubblesVariant = FeatureVariant;
export type NameVariant = FeatureVariant;
export type AnimationVariant = FeatureVariant;
export type ThemeVariant = FeatureVariant;
export type StreamingVariant = FeatureVariant;

interface ChatMessageProps {
  message: ChatMessageType;
  inlineAudioFile?: AgentFileReference | null;
  agentId?: string | null;
  // Feature variants — all default to "off" (current production behavior, no change)
  timestampVariant?: TimestampVariant;
  nameVariant?: NameVariant;
  bubblesVariant?: BubblesVariant;
  animationVariant?: AnimationVariant;
  themeVariant?: ThemeVariant;
  streamingVariant?: StreamingVariant;
  isStreaming?: boolean;
  agentName?: string;
  agentMeta?: AgentMeta | null;
  senderName?: string;
  isGroupChat?: boolean;
  compactToolCalls?: boolean;
  onReadFileBytesFromChat?: (path: string) => Promise<Uint8Array>;
  onOpenFileFromChat?: (path: string) => void;
  onDownloadFileFromChat?: (file: ChatPendingFile) => void | Promise<void>;
}

interface AgentFileReference {
  agentId: string;
  path: string;
}

type ToolCall = NonNullable<ChatMessageType["toolCalls"]>[number];

function formatTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toolCallSummary(tc: { name: string; args: string; result?: string }): string {
  if (tc.result) {
    return "Result ready";
  }
  return tc.args.trim() ? "Arguments ready" : "";
}

function formatToolDetail(raw: string, maxLen: number): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  let display = trimmed;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const textBlocks = parsed
          .filter((entry: unknown) => (entry as Record<string, unknown>)?.type === "text" && typeof (entry as Record<string, unknown>)?.text === "string")
          .map((entry: unknown) => (entry as Record<string, string>).text.trim())
          .filter(Boolean);
        display = textBlocks.length > 0 ? textBlocks.join("\n\n") : JSON.stringify(parsed, null, 2);
      } else {
        display = JSON.stringify(parsed, null, 2);
      }
    } catch {
      display = trimmed;
    }
  }
  return display.length > maxLen ? `${display.slice(0, maxLen).trimEnd()}\n... clipped` : display;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function useAgentFileObjectState(
  file: AgentFileReference | null | undefined,
  readFileBytes?: (path: string) => Promise<Uint8Array>,
): { url: string | null; loading: boolean; failed: boolean } {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const blobRef = useRef<string | null>(null);
  const fileAgentId = file?.agentId;
  const filePath = file?.path;

  useEffect(() => {
    setBlobUrl(null);
    setFailed(false);
    setLoading(false);
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }

    if (!fileAgentId || !filePath) return;
    let cancelled = false;
    setLoading(true);

    let bytesPromise: Promise<Uint8Array>;
    if (readFileBytes) {
      bytesPromise = readFileBytes(filePath);
    } else {
      const token = getStoredToken();
      if (!token) {
        setFailed(true);
        setLoading(false);
        return;
      }
      bytesPromise = createAgentClient(token).fileReadBytes(fileAgentId, normalizeOpenClawWorkspaceFilePath(filePath));
    }

    bytesPromise
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([toArrayBuffer(bytes)]);
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setBlobUrl(url);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    };
  }, [fileAgentId, filePath, readFileBytes]);

  return { url: failed ? null : blobUrl, loading, failed };
}

export function AuthImage({
  file,
  alt,
  className,
  onOpenFile,
  onDownload,
  readFileBytes,
}: {
  file: AgentFileReference;
  alt: string;
  className?: string;
  onOpenFile?: () => void;
  onDownload?: () => void | Promise<void>;
  readFileBytes?: (path: string) => Promise<Uint8Array>;
}) {
  const { url: blobUrl, failed } = useAgentFileObjectState(file, readFileBytes);

  if (!blobUrl) {
    return (
      <div
        role="status"
        aria-label={failed ? "Image unavailable" : "Loading image"}
        className={`flex min-h-24 min-w-24 max-w-full items-center justify-center rounded-md border border-border bg-surface-low px-3 py-3 text-center text-xs text-text-muted ${className ?? ""}`}
      >
        {failed ? (
          <span>Image unavailable</span>
        ) : (
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted/25 border-t-[#38D39F]" />
        )}
      </div>
    );
  }

  return (
    <ChatImageViewer
      src={blobUrl}
      alt={alt}
      width={320}
      height={320}
      sizes="(max-width: 640px) 100vw, 320px"
      className={className}
      loading="lazy"
      downloadHref={blobUrl}
      downloadFileName={alt}
      downloadLabel={`Download ${alt}`}
      onDownload={onDownload}
      onOpenFile={onOpenFile}
      openFileLabel={`Open ${alt} in files`}
    />
  );
}

function AgentMessageAvatar({
  name,
  meta,
  sizeClass,
  iconClass,
}: {
  name: string;
  meta?: AgentMeta | null;
  sizeClass: string;
  iconClass: string;
}) {
  const avatar = agentAvatar(name, meta);
  const AvatarIcon = avatar.icon;

  return (
    <div className={`relative ${sizeClass} rounded-full flex items-center justify-center overflow-hidden`} style={{ backgroundColor: avatar.bgColor }}>
      {avatar.imageUrl ? (
        <ResourceImage
          src={avatar.imageUrl}
          alt={`${name} avatar`}
          fill
          sizes="28px"
          className="object-cover"
        />
      ) : (
        <AvatarIcon className={iconClass} style={{ color: avatar.fgColor }} />
      )}
    </div>
  );
}

function StreamingStatusDot() {
  return (
    <motion.span
      aria-label="streaming"
      className="block h-[7px] w-[7px] rounded-full bg-[#38D39F]"
      style={{ boxShadow: "0 0 6px rgba(56, 211, 159, 0.6)" }}
      animate={{ scale: [0.85, 1.15, 0.85], opacity: [0.6, 1, 0.6] }}
      transition={{ repeat: Infinity, duration: 1.1, ease: "easeInOut" }}
    />
  );
}

function StreamingStatusAnchor({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <div className="pointer-events-none absolute bottom-0 left-0 flex h-4 items-center pl-0.5">
      <StreamingStatusDot />
    </div>
  );
}

// Returns framer-motion props for the bubble entrance animation.
// Returns {} for "off" — motion.div with no animation props is a plain div.
function getEntranceProps(variant: AnimationVariant, isUser: boolean): HTMLMotionProps<"div"> {
  if (variant === "v1") {
    // Alt 1: subtle fade + lift
    return {
      initial: { opacity: 0, y: 10 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.22, ease: "easeOut" },
    };
  }
  if (variant === "v2") {
    // Alt 2: spring slide from the side the message originates from
    return {
      initial: { opacity: 0, x: isUser ? 28 : -28 },
      animate: { opacity: 1, x: 0 },
      transition: { type: "spring", stiffness: 380, damping: 28 },
    };
  }
  if (variant === "v3") {
    // Alt 3: scale pop from slightly below
    return {
      initial: { opacity: 0, scale: 0.88, y: 6 },
      animate: { opacity: 1, scale: 1, y: 0 },
      transition: { type: "spring", stiffness: 460, damping: 22 },
    };
  }
  return {};
}

// ── Theme helpers ──

function getThinkingBlockClass(theme: ThemeVariant): string {
  if (theme === "v1") return "mb-2 bg-[#38D39F]/8 border-l-2 border-[#38D39F]/50 pl-3 pr-2 py-1.5 rounded-r-md";
  if (theme === "v2") return "mb-2 bg-[#0d0d0f] border border-[#38D39F]/30 pl-3 pr-2 py-1.5 rounded-lg";
  if (theme === "v3") return "mb-2 bg-[#38D39F]/8 border-l-2 border-[#38D39F] pl-3 pr-2 py-1";
  return "mb-2 border-l-2 border-[#38D39F]/40 pl-3";
}

function getThinkingButtonClass(theme: ThemeVariant): string {
  if (theme === "v2") return "flex items-center gap-1.5 text-xs text-[#38D39F] hover:text-[#38D39F]/80 transition-colors font-medium";
  if (theme !== "off") return "flex items-center gap-1.5 text-xs text-[#38D39F]/80 hover:text-[#38D39F] transition-colors";
  return "flex items-center gap-1.5 text-xs text-[#38D39F]/70 hover:text-[#38D39F] transition-colors";
}

function getToolCallClass(theme: ThemeVariant, hasResult: boolean): string {
  const baseClass = "mb-2 w-full min-w-0 max-w-full text-xs overflow-hidden";
  if (theme === "v1") {
    return hasResult
      ? `${baseClass} rounded-md border border-[#38D39F]/25 bg-[#38D39F]/8`
      : `${baseClass} rounded-md border border-[#f0c56c]/25 bg-[#f0c56c]/8`;
  }
  if (theme === "v2") {
    return hasResult
      ? `${baseClass} rounded-md border-l-4 border-[#38D39F] bg-[#38D39F]/8`
      : `${baseClass} rounded-md border-l-4 border-[#f0c56c] bg-[#f0c56c]/8`;
  }
  if (theme === "v3") {
    return hasResult
      ? `${baseClass} rounded-md border border-[#38D39F]/30 bg-[#38D39F]/10`
      : `${baseClass} rounded-md border border-[#f0c56c]/30 bg-[#f0c56c]/10`;
  }
  return `${baseClass} rounded-md border border-border bg-background/50`;
}

const TOOL_PENDING_TIMEOUT_MS = 45_000;
const TOOL_CALL_STACK_THRESHOLD = 3;

function shouldStackToolCalls(toolCalls: ChatMessageType["toolCalls"]): boolean {
  return (toolCalls?.length ?? 0) > TOOL_CALL_STACK_THRESHOLD;
}

function toolNamesSummary(toolCalls: ToolCall[]): string {
  const names = Array.from(new Set(toolCalls.map((tc) => tc.name).filter(Boolean)));
  if (names.length === 0) return "";
  const visible = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${visible} +${names.length - 3}` : visible;
}

function ToolCallDisclosure({
  tc,
  index,
  isOpen,
  defaultOpen,
  onToggle,
  themeVariant,
  agentId,
  isStreaming,
}: {
  tc: { id?: string; name: string; args: string; result?: string };
  index: number;
  isOpen: boolean;
  defaultOpen: boolean;
  onToggle: (index: number, defaultOpen: boolean) => void;
  themeVariant: ThemeVariant;
  agentId?: string | null;
  isStreaming: boolean;
}) {
  const hasResult = Boolean(tc.result);
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const rawPending = !hasResult && isStreaming;
  const pending = rawPending && !pendingTimedOut;
  const summary = toolCallSummary(tc);
  const imagePath = agentId ? extractImagePath(tc) : null;
  const imageFile = imagePath && agentId ? { agentId, path: imagePath } : null;
  const argsDetail = formatToolDetail(tc.args, 280);
  const resultDetail = tc.result ? formatToolDetail(tc.result, 520) : "";
  const directoryListing = tc.result ? parseDirectoryVisualization(tc.result) : null;

  useEffect(() => {
    if (!rawPending) return;
    const timer = window.setTimeout(() => setPendingTimedOut(true), TOOL_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [rawPending]);

  return (
    <div className={getToolCallClass(themeVariant, hasResult)}>
      <button
        onClick={() => onToggle(index, defaultOpen)}
        className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-low"
      >
        {pending ? (
          <Loader2 className="w-3 h-3 text-[#f0c56c] animate-spin shrink-0" />
        ) : hasResult ? (
          <Check className="w-3 h-3 text-[#38D39F] shrink-0" />
        ) : (
          <Wrench className="w-3 h-3 text-text-muted shrink-0" />
        )}
        <span className="min-w-0 max-w-[45%] truncate font-medium text-[#f0c56c]">{tc.name}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-muted">
          {pending ? "Running" : hasResult ? "Done" : "Called"}
        </span>
        {!isOpen && summary && (
          <span className="text-text-muted truncate ml-1 flex-1 min-w-0">{summary}</span>
        )}
        {!isOpen ? (
          <ChevronRight className="w-3 h-3 text-text-muted ml-auto shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 text-text-muted ml-auto shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="space-y-2 border-t border-border px-2.5 py-1.5 text-[11px] text-text-muted">
          {argsDetail && (
            <div className="min-w-0">
              <p className="mb-1 font-medium text-text-secondary">Arguments</p>
              <pre className="max-h-28 max-w-full overflow-y-auto whitespace-pre-wrap break-words font-mono [overflow-wrap:anywhere]">{argsDetail}</pre>
            </div>
          )}
          {directoryListing && (
            <DirectoryVisualization
              title="Directory result"
              rootPath={directoryListing.rootPath}
              entries={directoryListing.entries}
              truncated={directoryListing.truncated}
            />
          )}
          {resultDetail && !directoryListing && (
            <div className="min-w-0">
              <p className="mb-1 font-medium text-text-secondary">Result</p>
              <pre className="max-h-36 max-w-full overflow-y-auto whitespace-pre-wrap break-words font-mono [overflow-wrap:anywhere]">{resultDetail}</pre>
            </div>
          )}
        </div>
      )}
      {imageFile && (
        <div className="max-w-full border-t border-border px-2.5 py-2">
          <AuthImage
            file={imageFile}
            alt={imagePath?.split("/").pop() || "generated image"}
            className={CHAT_MARKDOWN_IMAGE_CLASS}
          />
        </div>
      )}
    </div>
  );
}

function ToolCallStackDisclosure({
  toolCalls,
  themeVariant,
  agentId,
  isStreaming,
}: {
  toolCalls: ToolCall[];
  themeVariant: ThemeVariant;
  agentId?: string | null;
  isStreaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState<Record<number, boolean>>({});
  const [pendingTimedOut, setPendingTimedOut] = useState(false);

  const pendingCount = toolCalls.filter((tc) => !tc.result).length;
  const completedCount = toolCalls.length - pendingCount;
  const rawPending = pendingCount > 0 && isStreaming;
  const pending = rawPending && !pendingTimedOut;
  const allDone = completedCount === toolCalls.length;
  const summary = toolNamesSummary(toolCalls);
  const statusLabel = pending ? "Running" : allDone ? "Done" : "Called";
  const progressPercent = toolCalls.length === 0 ? 0 : Math.round((completedCount / toolCalls.length) * 100);
  const statusClass = pending
    ? "border-[#f0c56c]/30 bg-[#f0c56c]/15 text-[#f0c56c]"
    : allDone
      ? "border-[#38D39F]/30 bg-[#38D39F]/15 text-[#38D39F]"
      : "border-white/10 bg-white/[0.04] text-text-muted";

  useEffect(() => {
    if (!rawPending) return;
    const timer = window.setTimeout(() => setPendingTimedOut(true), TOOL_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [rawPending]);

  return (
    <motion.div
      layout
      className={`${getToolCallClass(themeVariant, allDone)} relative shadow-[0_10px_30px_rgba(0,0,0,0.18)] ring-1 ring-white/[0.03]`}
      transition={{ layout: { duration: 0.2, ease: "easeOut" } }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(56,211,159,0.13),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent)]" />
      <div className="pointer-events-none absolute inset-x-3 top-1 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-x-6 top-2 h-px bg-white/[0.06]" />
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
      >
        <motion.span
          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-background/70"
          animate={pending ? { scale: [1, 1.04, 1] } : { scale: 1 }}
          transition={pending ? { repeat: Infinity, duration: 1.2, ease: "easeInOut" } : { duration: 0.16 }}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#f0c56c]" />
          ) : allDone ? (
            <Check className="h-3.5 w-3.5 text-[#38D39F]" />
          ) : (
            <Wrench className="h-3.5 w-3.5 text-text-muted" />
          )}
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-background bg-[#f0c56c] px-1 text-[9px] font-bold leading-none text-black"
          >
            {toolCalls.length}
          </span>
        </motion.span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate font-medium text-[#f0c56c]">{toolCalls.length} tool calls</span>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusClass}`}>
              {statusLabel}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-text-muted">
            {summary}
            {!allDone && ` - ${completedCount}/${toolCalls.length} done`}
          </span>
        </span>
        <motion.span
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted"
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </motion.span>
      </button>
      <div className="relative h-px bg-white/[0.06]">
        <motion.div
          className={`h-px ${allDone ? "bg-[#38D39F]" : "bg-[#f0c56c]"}`}
          initial={false}
          animate={{ width: `${progressPercent}%` }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="stack-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden border-t border-border"
          >
            <motion.div
              className="max-h-[420px] overflow-y-auto px-2 py-2"
              initial="closed"
              animate="open"
              exit="closed"
              variants={{
                open: { transition: { staggerChildren: 0.035, delayChildren: 0.03 } },
                closed: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
              }}
            >
              {toolCalls.map((tc, index) => {
                const defaultToolOpen = false;
                const isToolOpen = toolsOpen[index] ?? defaultToolOpen;
                return (
                  <motion.div
                    key={tc.id ?? `${tc.name}-${index}`}
                    variants={{
                      closed: { opacity: 0, y: -6, scale: 0.99 },
                      open: { opacity: 1, y: 0, scale: 1 },
                    }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                  >
                    <ToolCallDisclosure
                      tc={tc}
                      index={index}
                      isOpen={isToolOpen}
                      defaultOpen={defaultToolOpen}
                      onToggle={(toolIndex, fallbackOpen) => {
                        setToolsOpen((prev) => ({ ...prev, [toolIndex]: !(prev[toolIndex] ?? fallbackOpen) }));
                      }}
                      themeVariant={themeVariant}
                      agentId={agentId}
                      isStreaming={isStreaming && !pendingTimedOut}
                    />
                  </motion.div>
                );
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function ChatMessageBubble({
  message,
  inlineAudioFile = null,
  agentId = null,
  timestampVariant = "off",
  nameVariant = "off",
  bubblesVariant = "off",
  animationVariant = "off",
  themeVariant = "off",
  streamingVariant = "off",
  isStreaming = false,
  agentName,
  agentMeta,
  senderName,
  isGroupChat = false,
  onReadFileBytesFromChat,
  onOpenFileFromChat,
  onDownloadFileFromChat,
}: ChatMessageProps) {
  const [toolsOpen, setToolsOpen] = useState<Record<number, boolean>>({});
  const messageFiles = (message.files ?? [])
    .map(normalizeChatFileReference)
    .filter((file): file is ChatPendingFile => Boolean(file));
  const inlineAudioAlreadyAttached = Boolean(inlineAudioFile && messageFiles.some((file) => (
    isAudioFileReference(file) && isSameWorkspaceFilePath(file.path, inlineAudioFile.path)
  )));
  const standaloneInlineAudioFile = inlineAudioAlreadyAttached ? null : inlineAudioFile;
  const inlineAudioState = useAgentFileObjectState(standaloneInlineAudioFile, onReadFileBytesFromChat);

  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex min-w-0 max-w-full justify-center">
        <div className="max-w-[85%] break-words rounded-lg border border-[#d05f5f]/20 bg-[#d05f5f]/10 px-4 py-2 text-sm text-[#d05f5f] [overflow-wrap:anywhere]">
          {message.content}
        </div>
      </div>
    );
  }

  // Compute name display logic
  const showV1Name = nameVariant === "v1";
  const showV2Name = nameVariant === "v2";
  const effectiveName = isUser ? (senderName ?? "You") : (agentName ?? "Agent");
  const showStreamingDot = isStreaming && !isUser;
  const hasToolResults = message.toolCalls?.some((tc) => tc.result != null) ?? false;
  let contentIsJson = false;
  if (hasToolResults) {
    const trimmedContent = message.content.trim();
    if (trimmedContent.startsWith("{") || trimmedContent.startsWith("[")) {
      try {
        JSON.parse(trimmedContent);
        contentIsJson = true;
      } catch {
        contentIsJson = false;
      }
    }
  }
  const rawEffectiveContent = contentIsJson ? "" : message.content;
  const effectiveContent = !isUser && inlineAudioFile
    ? stripInlineAudioReplyContent(rawEffectiveContent, inlineAudioFile)
    : rawEffectiveContent;
  const extractedContentMedia = !isUser
    ? extractContentMediaReferences(effectiveContent)
    : { content: effectiveContent, mediaFiles: [] as ContentMediaReference[], pendingMedia: false };
  const hasInlineImageAttachments = (message.attachments?.length ?? 0) > 0;
  const imageFiles = messageFiles.filter(isImageFileReference);
  const audioFiles = messageFiles.filter(isAudioFileReference);
  const imagePreviewAgentId = agentId ?? "";
  const shouldRenderImageFilePreviews = Boolean(imagePreviewAgentId && imageFiles.length > 0 && !hasInlineImageAttachments);
  const shouldRenderAudioFilePreviews = Boolean(imagePreviewAgentId && audioFiles.length > 0);
  const fileChips = messageFiles.filter((file) => (
    (!isImageFileReference(file) || (!hasInlineImageAttachments && !shouldRenderImageFilePreviews)) &&
    (!isAudioFileReference(file) || !shouldRenderAudioFilePreviews)
  ));
  const generatedMediaUrlReferences = !isUser
    ? (message.mediaUrls ?? [])
      .map((url) => {
        const mediaPath = mediaWorkspacePathFromReference(url);
        if (!isGeneratedMediaPath(mediaPath)) return null;
        return {
          sourceUrl: url,
          ...generatedMediaFileFromPath(mediaPath, findFileForMediaReference(messageFiles, url)),
        };
      })
      .filter((entry): entry is ContentMediaReference & { sourceUrl: string } => Boolean(entry))
    : [];
  const contentMediaDisplayPaths = new Set(extractedContentMedia.mediaFiles.map(({ displayPath }) => displayPath));
  const generatedMediaUrlPreviews = generatedMediaUrlReferences.filter(({ displayPath }) => !contentMediaDisplayPaths.has(displayPath));
  const inlineAudioRenderedAsGeneratedMedia = Boolean(inlineAudioFile && (
    inlineAudioAlreadyAttached ||
    [
      ...extractedContentMedia.mediaFiles,
      ...generatedMediaUrlReferences,
    ].some(({ file }) => isAudioFileReference(file) && isSameWorkspaceFilePath(file.path, inlineAudioFile.path))
  ));
  const nonGeneratedMediaUrls = (message.mediaUrls ?? []).filter((url) => !isGeneratedMediaPath(mediaWorkspacePathFromReference(url)));
  const hasAudioPresentation = Boolean(
    inlineAudioFile ||
    shouldRenderAudioFilePreviews ||
    extractedContentMedia.mediaFiles.some(({ file }) => isAudioFileReference(file)) ||
    generatedMediaUrlReferences.some(({ file }) => isAudioFileReference(file)) ||
    nonGeneratedMediaUrls.some((url) => isPlayableMediaAudioUrl(url)),
  );
  const displayContent = hasAudioPresentation && (
    (!isUser && isAudioReplyCarrierText(extractedContentMedia.content)) ||
    (isUser && isVoiceNoteTranscriptionInstruction(extractedContentMedia.content))
  )
    ? ""
    : extractedContentMedia.content;
  const contentDirectoryListing = !isUser && displayContent ? parseDirectoryVisualization(displayContent) : null;
  const messageColumnClass = isUser
    ? "w-fit max-w-[75%] items-end"
    : "flex-1 items-start";

  return (
    <motion.div
      className={`group flex min-w-0 max-w-full ${isUser ? "justify-end" : "justify-start"} items-start gap-2`}
      {...getEntranceProps(animationVariant, isUser)}
    >
      {/* v2 name: avatar circle to the left */}
      {showV2Name && (() => {
        if (isUser) {
          return (
            <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full bg-surface-low flex items-center justify-center">
              <span className="text-[10px] font-bold text-text-muted">{effectiveName[0]?.toUpperCase() ?? "Y"}</span>
            </div>
          );
        }
        return (
          <AgentMessageAvatar
            name={effectiveName}
            meta={agentMeta}
            sizeClass="mt-0.5 flex-shrink-0 w-7 h-7"
            iconClass="w-3.5 h-3.5"
          />
        );
      })()}

      <div className={`flex min-w-0 flex-col ${messageColumnClass}`}>

        {/* v1 name: monogram + muted label above bubble */}
        {showV1Name && (() => {
          if (isUser) {
            return (
              <div className="mb-1 flex max-w-full items-center gap-1.5 min-w-0 flex-row-reverse">
                <div className="w-5 h-5 rounded-full bg-surface-low flex items-center justify-center">
                  <span className="text-[9px] font-bold text-text-muted">{effectiveName[0]?.toUpperCase() ?? "Y"}</span>
                </div>
                <span className="block min-w-0 max-w-full truncate text-[11px] text-text-muted">{effectiveName}</span>
              </div>
            );
          }
          return (
            <div className="mb-1 flex max-w-full min-w-0 items-center gap-1.5">
              <AgentMessageAvatar name={effectiveName} meta={agentMeta} sizeClass="w-5 h-5" iconClass="w-3 h-3" />
              <span className="block min-w-0 max-w-full truncate text-[11px] text-text-muted">{effectiveName}</span>
            </div>
          );
        })()}

        {/* Internal reasoning is intentionally not exposed in chat. */}
        {message.thinking && !isUser && (
          <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#38D39F]/20 bg-[#38D39F]/8 px-2.5 py-1 text-xs text-text-muted">
            <Brain className="h-3.5 w-3.5 shrink-0 text-[#38D39F]" />
            <span className="truncate">Internal reasoning hidden</span>
          </div>
        )}

        {/* Tool calls */}
        {shouldStackToolCalls(message.toolCalls) ? (
          <ToolCallStackDisclosure
            toolCalls={message.toolCalls ?? []}
            themeVariant={themeVariant}
            agentId={agentId}
            isStreaming={isStreaming}
          />
        ) : (
          message.toolCalls?.map((tc, j) => {
            const defaultToolOpen = false;
            const isToolOpen = toolsOpen[j] ?? defaultToolOpen;
            return (
              <ToolCallDisclosure
                key={j}
                tc={tc}
                index={j}
                isOpen={isToolOpen}
                defaultOpen={defaultToolOpen}
                onToggle={(index, fallbackOpen) => {
                  setToolsOpen((prev) => ({ ...prev, [index]: !(prev[index] ?? fallbackOpen) }));
                }}
                themeVariant={themeVariant}
                agentId={agentId}
                isStreaming={isStreaming}
              />
            );
          })
        )}

        {/* User-sent image attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2 flex max-w-full flex-wrap gap-2">
            {message.attachments.map((att, i) => {
              const attachmentSrc = `data:${att.mimeType};base64,${att.content}`;
              const attachmentFile = findFileForAttachment(messageFiles, att.fileName);
              return (
                <div key={i} className="flex max-w-full flex-col gap-1">
                  <ChatImageViewer
                    src={attachmentSrc}
                    alt={att.fileName || "attachment"}
                    width={240}
                    height={240}
                    sizes="(max-width: 640px) 100vw, 240px"
                    className="h-auto max-h-[240px] max-w-full rounded-md object-cover sm:max-w-[240px]"
                    downloadHref={attachmentSrc}
                    downloadFileName={att.fileName || "attachment"}
                    onOpenFile={attachmentFile && onOpenFileFromChat ? () => onOpenFileFromChat(attachmentFile.path) : undefined}
                    onDownload={attachmentFile && onDownloadFileFromChat ? () => onDownloadFileFromChat(attachmentFile) : undefined}
                    openFileLabel={attachmentFile ? `Open ${fileLabel(attachmentFile)} in files` : undefined}
                    downloadLabel={`Download ${attachmentFile ? fileLabel(attachmentFile) : att.fileName || "attachment"}`}
                  />
                  {attachmentFile && (
                    <ChatFileActions
                      file={attachmentFile}
                      onOpenFile={onOpenFileFromChat}
                      onDownloadFile={onDownloadFileFromChat}
                      className="self-start"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {messageFiles.length > 0 && (
          <>
            {shouldRenderImageFilePreviews && (
              <div className="mb-2 flex max-w-full flex-wrap gap-2">
                {imageFiles.map((file, i) => (
                  <div key={`${file.path}-${i}`} className="flex max-w-full flex-col gap-1">
                    <AuthImage
                      file={{ agentId: imagePreviewAgentId, path: file.path }}
                      alt={file.name || "attachment"}
                      className="h-auto max-h-[240px] max-w-full rounded-md object-contain sm:max-w-[240px]"
                      readFileBytes={onReadFileBytesFromChat}
                      onOpenFile={onOpenFileFromChat ? () => onOpenFileFromChat(file.path) : undefined}
                      onDownload={onDownloadFileFromChat ? () => onDownloadFileFromChat(file) : undefined}
                    />
                    <ChatFileActions
                      file={file}
                      onOpenFile={onOpenFileFromChat}
                      onDownloadFile={onDownloadFileFromChat}
                      className="self-start"
                    />
                  </div>
                ))}
              </div>
            )}
            {shouldRenderAudioFilePreviews && (
              <div className="mb-2 flex w-full max-w-full flex-wrap gap-2">
                {audioFiles.map((file, i) => (
                  <ChatAudioFilePreview
                    key={`${file.path}-${i}`}
                    file={file}
                    agentId={imagePreviewAgentId}
                    readFileBytes={onReadFileBytesFromChat}
                    onOpenFile={onOpenFileFromChat}
                    onDownloadFile={onDownloadFileFromChat}
                  />
                ))}
              </div>
            )}
            {fileChips.length > 0 && (
              <div className="mb-2 flex max-w-full flex-wrap gap-2">
                {fileChips.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate" title={file.name}>{file.name}</span>
                    <ChatFileActions
                      file={file}
                      onOpenFile={onOpenFileFromChat}
                      onDownloadFile={onDownloadFileFromChat}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {extractedContentMedia.mediaFiles.length > 0 && (
          <div className="mb-2 flex max-w-full flex-wrap gap-2">
            {extractedContentMedia.mediaFiles.map(({ file, displayPath }, i) => (
              <GeneratedMediaFilePreview
                key={`${file.path}-${i}`}
                file={file}
                displayPath={displayPath}
                imagePreviewAgentId={imagePreviewAgentId}
                readFileBytes={onReadFileBytesFromChat}
                onOpenFile={onOpenFileFromChat}
                onDownloadFile={onDownloadFileFromChat}
              />
            ))}
          </div>
        )}

        {generatedMediaUrlPreviews.length > 0 && (
          <div className="mb-2 flex max-w-full flex-wrap gap-2">
            {generatedMediaUrlPreviews.map(({ file, displayPath, sourceUrl }, i) => (
              <GeneratedMediaFilePreview
                key={`${sourceUrl}-${i}`}
                file={file}
                displayPath={displayPath}
                imagePreviewAgentId={imagePreviewAgentId}
                readFileBytes={onReadFileBytesFromChat}
                onOpenFile={onOpenFileFromChat}
                onDownloadFile={onDownloadFileFromChat}
              />
            ))}
          </div>
        )}

        {isStreaming && extractedContentMedia.pendingMedia && extractedContentMedia.mediaFiles.length === 0 && generatedMediaUrlReferences.length === 0 && (
          <div className="mb-2 flex max-w-full flex-wrap gap-2">
            <ChatMediaLoading />
          </div>
        )}

        {/* Agent-sent media (URLs) */}
        {nonGeneratedMediaUrls.length > 0 && (
          <div className="mb-2 flex max-w-full flex-wrap gap-2">
            {nonGeneratedMediaUrls.map((url, i) => {
              const matchingFile = findFileForMediaReference(messageFiles, url);
              if (LOCAL_MEDIA_REFERENCE.test(url)) {
                if (matchingFile && (
                  isImageFileReference(matchingFile) ||
                  isAudioFileReference(matchingFile) ||
                  hasInlineImageAttachments ||
                  shouldRenderImageFilePreviews ||
                  shouldRenderAudioFilePreviews
                )) {
                  return null;
                }
                if (matchingFile) {
                  return (
                    <div
                      key={`${url}-${i}`}
                      className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate" title={matchingFile.name}>{matchingFile.name}</span>
                      <ChatFileActions
                        file={matchingFile}
                        onOpenFile={onOpenFileFromChat}
                        onDownloadFile={onDownloadFileFromChat}
                      />
                    </div>
                  );
                }
                return <ChatMediaUnavailable key={`${url}-${i}`} label="Preview unavailable" />;
              }
              if (isPlayableMediaAudioUrl(url)) {
                const label = mediaFileNameFromUrl(url, "audio");
                return (
                  <AudioPlayer
                    key={i}
                    src={url}
                    title={label}
                    downloadHref={url}
                    downloadFileName={label}
                    downloadLabel={`Download ${label}`}
                  />
                );
              }
              if (isRenderableMediaImageUrl(url)) {
                const mediaName = mediaFileNameFromUrl(url);
                return (
                  <ChatImageViewer
                    key={i}
                    src={url}
                    alt={mediaName}
                    width={320}
                    height={320}
                    sizes="(max-width: 640px) 100vw, 320px"
                    className={CHAT_MARKDOWN_IMAGE_CLASS}
                    loading="lazy"
                    downloadHref={url}
                    downloadFileName={mediaFileNameFromUrl(url)}
                  />
                );
              }
              // Non-image media: render as link
              const label = mediaFileNameFromUrl(url);
              if (!/^(?:https?:\/\/|\/)/i.test(url)) {
                return <ChatMediaUnavailable key={`${url}-${i}`} label="Preview unavailable" />;
              }
              return (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-full break-words text-xs text-accent hover:underline [overflow-wrap:anywhere]"
                >
                  {label}
                </a>
              );
            })}
          </div>
        )}

        {/* Content */}
        {(displayContent || showStreamingDot) && (
          <div className={`relative w-full min-w-0 max-w-full ${showStreamingDot ? "pb-5" : ""}`}>
            {contentDirectoryListing ? (
              <DirectoryVisualization
                title="Directory"
                rootPath={contentDirectoryListing.rootPath}
                entries={contentDirectoryListing.entries}
                truncated={contentDirectoryListing.truncated}
              />
            ) : displayContent && (
              <MarkdownContent
                content={displayContent}
                typewriter={isStreaming && !isUser}
                className="relative"
                style={isStreaming ? { willChange: "contents", transform: "translateZ(0)" } : undefined}
              />
            )}
            <StreamingStatusAnchor active={showStreamingDot} />
          </div>
        )}


        {standaloneInlineAudioFile && !inlineAudioRenderedAsGeneratedMedia && (
          <AudioPlayer
            src={inlineAudioState.url}
            title={fileLabel({ path: standaloneInlineAudioFile.path }) || "Voice message"}
            loading={inlineAudioState.loading}
            error={inlineAudioState.failed}
            downloadHref={inlineAudioState.url ?? undefined}
            downloadFileName={fileLabel({ path: standaloneInlineAudioFile.path }) || "voice-message.webm"}
            className="mt-2"
          />
        )}

        {/* Timestamp on hover */}
        {message.timestamp && (
          <div className="text-[10px] text-text-muted mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {formatTime(message.timestamp)}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function ChatThinkingIndicator({ variant = "off" }: { variant?: FeatureVariant } = {}) {
  void variant; // accepted for future style options
  return (
    <motion.div
      className="flex justify-start"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="relative bg-surface-low/60 backdrop-blur-sm rounded-2xl px-4 py-2.5 flex items-center gap-2.5 border border-[#38D39F]/20 overflow-hidden">
        {/* Subtle shimmer background */}
        <motion.div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-r from-transparent via-[#38D39F]/8 to-transparent"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }}
          style={{ width: "60%" }}
        />
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
        >
          <Brain className="w-4 h-4 text-[#38D39F]" />
        </motion.div>
        <span className="text-xs font-medium text-text-secondary">Thinking</span>
        <span className="flex items-center gap-1">
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-[#38D39F]"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
          />
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-[#38D39F]"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut", delay: 0.18 }}
          />
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-[#38D39F]"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut", delay: 0.36 }}
          />
        </span>
      </div>
    </motion.div>
  );
}
