"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Brain, ChevronRight, Download, FileImage, FolderOpen, Loader2, Paperclip, Square } from "lucide-react";
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import type { ChatMessage as ChatMessageType, ChatPendingFile } from "@/lib/openclaw-chat";
import { getStoredToken } from "@/lib/api";
import { createAgentClient } from "@/lib/agent-client";
import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import {
  classifyChatMediaReference,
  extractContentMediaReferences,
  findFileForMediaReference,
  getChatFileLabel,
  isAudioFileReference,
  isImageFileReference,
  isVideoFileReference,
  type ContentMediaReference,
  type DirectChatMediaReference,
  type ExtractedContentMediaReferences,
} from "@/lib/chat-media";
import { agentAvatar, type AgentMeta } from "@/lib/avatar";
import { ResourceImage } from "@/components/ResourceImage";
import { AudioPlayer } from "@/components/dashboard/chat/AudioPlayer";
import { ChatImageViewer } from "@/components/dashboard/chat/ChatImageViewer";
import { getToolCallClass } from "@/components/dashboard/chat/bubbleStyles";
import { DirectoryVisualization, parseDirectoryVisualization } from "@/components/dashboard/chat/DirectoryVisualization";
import { buildToolCallStackView, buildToolCallView } from "@/components/dashboard/chat/helpers";
import { CHAT_MARKDOWN_IMAGE_CLASS, MarkdownContent } from "@/components/dashboard/chat/MarkdownContent";
import { ToolCallDisclosureButton, ToolCallSectionList, ToolCallStatusFrame } from "@/components/dashboard/chat/ToolCallPresentation";

// ── Helpers ──

function extractImagePath(tc: { name: string; args: string; result?: string }): string | null {
  try {
    const args = JSON.parse(tc.args);
    const path = args.file_path || args.path || "";
    if (typeof path === "string" && isImageFileReference({ path })) return path;
  } catch { /* ignore */ }
  return null;
}

function normalizeChatFileReference(file: ChatPendingFile): ChatPendingFile | null {
  const candidate = file as Partial<ChatPendingFile>;
  const path = typeof candidate.path === "string" ? candidate.path : "";
  const name = typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : getChatFileLabel({ path });
  const type = typeof candidate.type === "string" ? candidate.type : "";
  if (!path || !name) return null;
  return { name, path, type };
}

function findFileForAttachment(files: ChatPendingFile[], fileName: string | undefined): ChatPendingFile | null {
  if (!fileName) return null;
  return files.find((file) => file.name === fileName || getChatFileLabel(file) === fileName) ?? null;
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

  const fileName = getChatFileLabel({ path: file.path });
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

interface ChatFileActionsProps {
  file: ChatPendingFile;
  onOpenFile?: (path: string) => void;
  onDownloadFile?: (file: ChatPendingFile) => void | Promise<void>;
  className?: string;
}

function ChatFileActions({ file, onOpenFile, onDownloadFile, className }: ChatFileActionsProps) {
  if (!file.path || (!onOpenFile && !onDownloadFile)) return null;

  const label = getChatFileLabel(file);
  const buttonClass = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background/60 text-text-muted transition-colors hover:border-[rgb(var(--selection-accent-rgb)_/_0.5)] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.5)]";

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

function ChatVideoFilePreview({
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
  const videoState = useAgentFileObjectState({ agentId, path: file.path }, readFileBytes);

  return (
    <div className="flex w-full max-w-[28rem] flex-col gap-1">
      {videoState.url ? (
        <video
          src={videoState.url}
          controls
          preload="metadata"
          className="max-h-[320px] w-full rounded-md border border-border bg-black"
          aria-label={`Video preview ${file.name}`}
        />
      ) : videoState.failed ? (
        <ChatMediaUnavailable label={file.name} />
      ) : (
        <div
          role="status"
          aria-label="Loading video"
          className="flex aspect-video w-full items-center justify-center rounded-md border border-border bg-background/50 text-xs text-text-muted"
        >
          Loading video
        </div>
      )}
      <div className="flex max-w-full items-center gap-2">
        <span className="truncate text-[11px] text-text-muted" title={file.path}>{file.name}</span>
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
  const isVideo = isVideoFileReference(file);
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

  if (isVideo && imagePreviewAgentId) {
    return (
      <ChatVideoFilePreview
        file={file}
        agentId={imagePreviewAgentId}
        readFileBytes={readFileBytes}
        onOpenFile={onOpenFile}
        onDownloadFile={onDownloadFile}
      />
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

interface DirectMediaRenderReference {
  reference: DirectChatMediaReference;
  matchingFile: ChatPendingFile | null;
  sourceKey: string;
}

function directMediaReferenceValue(reference: DirectChatMediaReference): string {
  return reference.kind === "image" || reference.kind === "audio" || reference.kind === "video" || reference.kind === "link"
    ? reference.url
    : reference.raw;
}

function directMediaReferenceKey(reference: DirectChatMediaReference): string {
  return `${reference.kind}:${directMediaReferenceValue(reference)}`;
}

function directMediaRenderReference(
  reference: DirectChatMediaReference,
  files: ChatPendingFile[],
): DirectMediaRenderReference {
  return {
    reference,
    matchingFile: findFileForMediaReference(files, directMediaReferenceValue(reference)),
    sourceKey: directMediaReferenceKey(reference),
  };
}

function uniqueDirectMediaReferences(references: DirectMediaRenderReference[]): DirectMediaRenderReference[] {
  const seen = new Set<string>();
  return references.filter((entry) => {
    if (seen.has(entry.sourceKey)) return false;
    seen.add(entry.sourceKey);
    return true;
  });
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

const AGENT_FILE_READ_RETRY_DELAYS_MS = [0, 250, 750, 1500, 2500];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function useAgentFileObjectState(
  file: AgentFileReference | null | undefined,
  readFileBytes?: (path: string) => Promise<Uint8Array>,
): { url: string | null; loading: boolean; failed: boolean } {
  const [objectState, setObjectState] = useState<{ key: string; url: string | null; failed: boolean }>({
    key: "",
    url: null,
    failed: false,
  });
  const blobRef = useRef<string | null>(null);
  const fileAgentId = file?.agentId;
  const filePath = file?.path;
  const fileKey = fileAgentId && filePath ? `${fileAgentId}\n${filePath}` : "";

  useEffect(() => {
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }

    if (!fileAgentId || !filePath) return;
    let cancelled = false;

    const readBytes = () => {
      if (readFileBytes) {
        return readFileBytes(filePath);
      }
      const token = getStoredToken();
      if (!token) {
        return Promise.reject(new Error("Missing auth token"));
      }
      return createAgentClient(token).fileReadBytes(fileAgentId, normalizeOpenClawWorkspaceFilePath(filePath));
    };

    const bytesPromise = (async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < AGENT_FILE_READ_RETRY_DELAYS_MS.length; attempt += 1) {
        if (cancelled) throw new Error("Cancelled");
        const delay = AGENT_FILE_READ_RETRY_DELAYS_MS[attempt];
        if (delay > 0) await wait(delay);
        if (cancelled) throw new Error("Cancelled");
        try {
          return await readBytes();
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("File unavailable");
    })();

    bytesPromise
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([toArrayBuffer(bytes)]);
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setObjectState({ key: fileKey, url, failed: false });
      })
      .catch(() => {
        if (cancelled) return;
        setObjectState({ key: fileKey, url: null, failed: true });
      });

    return () => {
      cancelled = true;
      if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    };
  }, [fileAgentId, fileKey, filePath, readFileBytes]);

  const stale = objectState.key !== fileKey;
  const failed = Boolean(fileKey && !stale && objectState.failed);
  const url = fileKey && !stale && !failed ? objectState.url : null;
  return { url, loading: Boolean(fileKey && stale), failed };
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

const TOOL_PENDING_TIMEOUT_MS = 45_000;
const TOOL_CALL_STACK_THRESHOLD = 3;

function shouldStackToolCalls(toolCalls: ChatMessageType["toolCalls"]): boolean {
  return (toolCalls?.length ?? 0) > TOOL_CALL_STACK_THRESHOLD;
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
  const detailId = useId();
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const rawPending = tc.result === undefined && isStreaming;
  const view = buildToolCallView(tc, { isStreaming, pendingTimedOut });
  const imagePath = agentId ? extractImagePath(tc) : null;
  const imageFile = imagePath && agentId ? { agentId, path: imagePath } : null;
  const directoryListing = tc.result !== undefined ? parseDirectoryVisualization(tc.result) : null;

  useEffect(() => {
    if (!rawPending) return;
    const timer = window.setTimeout(() => setPendingTimedOut(true), TOOL_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [rawPending]);

  return (
    <div className={getToolCallClass(themeVariant, view.status)}>
      <ToolCallDisclosureButton view={view} isOpen={isOpen} detailId={detailId} onClick={() => onToggle(index, defaultOpen)} />
      {isOpen && (
        <div id={detailId} className="space-y-2 border-t border-border px-2.5 py-1.5 text-[11px] text-text-muted">
          <ToolCallSectionList sections={[view.argsSection]} />
          {directoryListing && (
            <DirectoryVisualization
              title="Directory result"
              rootPath={directoryListing.rootPath}
              entries={directoryListing.entries}
              truncated={directoryListing.truncated}
            />
          )}
          <ToolCallSectionList sections={[directoryListing ? null : view.resultSection]} />
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
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState<Record<number, boolean>>({});
  const [pendingTimedOut, setPendingTimedOut] = useState(false);

  const rawPending = toolCalls.some((tc) => tc.result === undefined) && isStreaming;
  const stackView = buildToolCallStackView(toolCalls, { isStreaming, pendingTimedOut });

  useEffect(() => {
    if (!rawPending) return;
    const timer = window.setTimeout(() => setPendingTimedOut(true), TOOL_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [rawPending]);

  return (
    <motion.div
      layout
      className={`${getToolCallClass(themeVariant, stackView.status)} relative shadow-[0_8px_22px_rgba(0,0,0,0.12)] ring-1 ring-border/55`}
      transition={{ layout: { duration: 0.2, ease: "easeOut" } }}
    >
      <button
        type="button"
        aria-controls={detailId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-low/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.35)] focus-visible:ring-inset"
      >
        <motion.span
          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-surface-low/35"
          animate={stackView.isRunning ? { scale: [1, 1.02, 1] } : { scale: 1 }}
          transition={stackView.isRunning ? { repeat: Infinity, duration: 1.6, ease: "easeInOut" } : { duration: 0.16 }}
        >
          <span className="text-xs font-semibold leading-none text-foreground">{toolCalls.length}</span>
        </motion.span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate font-medium text-foreground">{toolCalls.length} tool calls</span>
            <ToolCallStatusFrame status={stackView.status} />
          </span>
          <span className="mt-0.5 block truncate text-text-muted">
            {stackView.summary}
            {stackView.progressText && ` - ${stackView.progressText}`}
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
      <div className="relative h-px bg-border/50">
        <motion.div
          className="h-px bg-[rgb(var(--selection-accent-rgb)_/_0.62)]"
          initial={false}
          animate={{ width: `${stackView.progressPercent}%` }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="stack-body"
            id={detailId}
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
                    key={`${tc.id ?? tc.name}-${index}`}
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
    const isStoppedNotice = /^reply stopped$/i.test(message.content.trim());
    return (
      <div className="flex min-w-0 max-w-full justify-center">
        <div className={`max-w-[85%] break-words rounded-lg border px-4 py-2 text-sm [overflow-wrap:anywhere] ${isStoppedNotice ? "border-border bg-surface-low/70 text-text-muted" : "border-[#d05f5f]/20 bg-[#d05f5f]/10 text-[#d05f5f]"}`}>
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
  const extractedContentMedia: ExtractedContentMediaReferences = !isUser
    ? extractContentMediaReferences(effectiveContent)
    : { content: effectiveContent, mediaFiles: [] as ContentMediaReference[], directMedia: [], pendingMedia: false };
  const hasInlineImageAttachments = (message.attachments?.length ?? 0) > 0;
  const imageFiles = messageFiles.filter(isImageFileReference);
  const audioFiles = messageFiles.filter(isAudioFileReference);
  const videoFiles = messageFiles.filter(isVideoFileReference);
  const imagePreviewAgentId = agentId ?? "";
  const shouldRenderImageFilePreviews = Boolean(imagePreviewAgentId && imageFiles.length > 0 && !hasInlineImageAttachments);
  const shouldRenderAudioFilePreviews = Boolean(imagePreviewAgentId && audioFiles.length > 0);
  const shouldRenderVideoFilePreviews = Boolean(imagePreviewAgentId && videoFiles.length > 0);
  const fileChips = messageFiles.filter((file) => (
    (!isImageFileReference(file) || (!hasInlineImageAttachments && !shouldRenderImageFilePreviews)) &&
    (!isAudioFileReference(file) || !shouldRenderAudioFilePreviews) &&
    (!isVideoFileReference(file) || !shouldRenderVideoFilePreviews)
  ));
  const mediaUrlReferences = (message.mediaUrls ?? []).map((url) => {
    const matchingFile = findFileForMediaReference(messageFiles, url);
    return {
      sourceUrl: url,
      matchingFile,
      reference: classifyChatMediaReference(url, matchingFile),
    };
  });
  const generatedMediaUrlReferences = !isUser
    ? mediaUrlReferences.flatMap(({ sourceUrl, reference }) => (
      reference.kind === "workspace" ? [{ sourceUrl, ...reference.media }] : []
    ))
    : [];
  const contentMediaDisplayPaths = new Set(extractedContentMedia.mediaFiles.map(({ displayPath }) => displayPath));
  const generatedMediaUrlPreviews = generatedMediaUrlReferences.filter(({ displayPath }) => !contentMediaDisplayPaths.has(displayPath));
  const directMediaReferences = uniqueDirectMediaReferences([
    ...extractedContentMedia.directMedia.map((reference) => directMediaRenderReference(reference, messageFiles)),
    ...mediaUrlReferences.flatMap(({ matchingFile, reference }) => (
      reference.kind === "workspace"
        ? []
        : [{ reference, matchingFile, sourceKey: directMediaReferenceKey(reference) }]
    )),
  ]);
  const inlineAudioRenderedAsGeneratedMedia = Boolean(inlineAudioFile && (
    inlineAudioAlreadyAttached ||
    [
      ...extractedContentMedia.mediaFiles,
      ...generatedMediaUrlReferences,
    ].some(({ file }) => isAudioFileReference(file) && isSameWorkspaceFilePath(file.path, inlineAudioFile.path))
  ));
  const hasAudioPresentation = Boolean(
    inlineAudioFile ||
    shouldRenderAudioFilePreviews ||
    extractedContentMedia.mediaFiles.some(({ file }) => isAudioFileReference(file)) ||
    generatedMediaUrlReferences.some(({ file }) => isAudioFileReference(file)) ||
    directMediaReferences.some(({ reference }) => reference.kind === "audio"),
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
                    openFileLabel={attachmentFile ? `Open ${getChatFileLabel(attachmentFile)} in files` : undefined}
                    downloadLabel={`Download ${attachmentFile ? getChatFileLabel(attachmentFile) : att.fileName || "attachment"}`}
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
            {shouldRenderVideoFilePreviews && (
              <div className="mb-2 flex w-full max-w-full flex-wrap gap-2">
                {videoFiles.map((file, i) => (
                  <ChatVideoFilePreview
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

        {isStreaming && extractedContentMedia.pendingMedia && extractedContentMedia.mediaFiles.length === 0 && generatedMediaUrlReferences.length === 0 && directMediaReferences.length === 0 && (
          <div className="mb-2 flex max-w-full flex-wrap gap-2">
            <ChatMediaLoading />
          </div>
        )}

        {/* Agent-sent media (URLs and local handles) */}
        {directMediaReferences.length > 0 && (
          <div className="mb-2 flex max-w-full flex-wrap gap-2">
            {directMediaReferences.map(({ reference, matchingFile, sourceKey }, i) => {
              if (reference.kind === "local") {
                if (matchingFile && (
                  isImageFileReference(matchingFile) ||
                  isAudioFileReference(matchingFile) ||
                  isVideoFileReference(matchingFile) ||
                  hasInlineImageAttachments ||
                  shouldRenderImageFilePreviews ||
                  shouldRenderAudioFilePreviews ||
                  shouldRenderVideoFilePreviews
                )) {
                  return null;
                }
                if (matchingFile) {
                  return (
                    <div
                      key={`${sourceKey}-${i}`}
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
                return <ChatMediaUnavailable key={`${sourceKey}-${i}`} label={reference.label} />;
              }

              if (reference.kind === "audio") {
                return (
                  <AudioPlayer
                    key={`${sourceKey}-${i}`}
                    src={reference.url}
                    title={reference.fileName}
                    downloadHref={reference.url}
                    downloadFileName={reference.fileName}
                    downloadLabel={`Download ${reference.fileName}`}
                  />
                );
              }

              if (reference.kind === "image") {
                return (
                  <ChatImageViewer
                    key={`${sourceKey}-${i}`}
                    src={reference.url}
                    alt={reference.fileName}
                    width={320}
                    height={320}
                    sizes="(max-width: 640px) 100vw, 320px"
                    className={CHAT_MARKDOWN_IMAGE_CLASS}
                    loading="lazy"
                    downloadHref={reference.url}
                    downloadFileName={reference.fileName}
                  />
                );
              }

              if (reference.kind === "video") {
                return (
                  <video
                    key={`${sourceKey}-${i}`}
                    src={reference.url}
                    controls
                    preload="metadata"
                    className="max-h-[320px] w-full max-w-[28rem] rounded-md border border-border bg-black"
                    aria-label={`Video preview ${reference.fileName}`}
                  />
                );
              }

              if (reference.kind === "unsupported") {
                return <ChatMediaUnavailable key={`${sourceKey}-${i}`} label={reference.label} />;
              }

              return (
                <a
                  key={`${sourceKey}-${i}`}
                  href={reference.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-full break-words text-xs text-accent hover:underline [overflow-wrap:anywhere]"
                >
                  {reference.fileName}
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
                onOpenWorkspaceFile={!isUser ? onOpenFileFromChat : undefined}
              />
            )}
            <StreamingStatusAnchor active={showStreamingDot} />
          </div>
        )}

        {message.status === "interrupted" && !isUser && (
          <div
            role="status"
            aria-label="Reply stopped"
            className="mt-2 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-low/70 px-2.5 py-1 text-[11px] font-medium text-text-muted"
          >
            <Square className="h-3 w-3 shrink-0" />
            <span>Stopped</span>
          </div>
        )}


        {standaloneInlineAudioFile && !inlineAudioRenderedAsGeneratedMedia && (
          <AudioPlayer
            src={inlineAudioState.url}
            title={getChatFileLabel({ path: standaloneInlineAudioFile.path }) || "Voice message"}
            loading={inlineAudioState.loading}
            error={inlineAudioState.failed}
            downloadHref={inlineAudioState.url ?? undefined}
            downloadFileName={getChatFileLabel({ path: standaloneInlineAudioFile.path }) || "voice-message.webm"}
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
