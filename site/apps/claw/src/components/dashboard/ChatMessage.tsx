"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Download, FileImage, FolderOpen, Loader2, Paperclip, RefreshCw, Square } from "lucide-react";
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import { RecoveryDetails } from "@hypercli/shared-ui";
import {
  isOpenClawEmptyReplyFailureText,
  OPENCLAW_EMPTY_REPLY_NOTICE,
  type ChatMessage as ChatMessageType,
  type ChatPendingFile,
} from "@/lib/openclaw-chat";
import { getStoredToken } from "@/lib/api";
import { createAgentClient } from "@/lib/agent-client";
import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import { deriveToolWrittenFiles } from "@/lib/chat-attachment-state";
import {
  classifyChatMediaReference,
  dropIncompleteMediaSentinelLines,
  extractContentMediaReferences,
  findFileForMediaReference,
  getChatFileLabel,
  inferChatMediaFileType,
  isAudioFileReference,
  isImageFileReference,
  isOpenClawManagedOutgoingMediaUrl,
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
import {
  buildToolCallStackView,
  buildToolCallView,
  presentSystemMessage,
  TOOL_CALL_NOTE_MESSAGE,
} from "@/components/dashboard/chat/helpers";
import { CHAT_MARKDOWN_IMAGE_CLASS, MarkdownContent } from "@/components/dashboard/chat/MarkdownContent";
import { ToolCallDisclosureButton, ToolCallSectionList, ToolCallStatusFrame } from "@/components/dashboard/chat/ToolCallPresentation";
import { TimestampDisplay } from "@/components/dashboard/chat/TimestampDisplay";
import { TooltipHint } from "@/components/ClawTooltip";
import { HyperCLILogoMark } from "@/components/HyperCLILogoLink";

// ── Helpers ──

export interface ChatFileReadOptions {
  maxBytes: number;
  signal: AbortSignal;
}

export type ChatFileBytesReader = (path: string, options?: ChatFileReadOptions) => Promise<Uint8Array>;

function normalizeChatFileReference(file: ChatPendingFile): ChatPendingFile | null {
  const candidate = file as Partial<ChatPendingFile>;
  const path = typeof candidate.path === "string" ? candidate.path : "";
  const name = typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : getChatFileLabel({ path });
  const type = typeof candidate.type === "string" ? candidate.type : "";
  if (!path || !name) return null;
  return { name, path, type };
}

function uniqueChatFiles(files: ChatPendingFile[]): ChatPendingFile[] {
  const next = new Map<string, ChatPendingFile>();
  for (const file of files) {
    const key = normalizeOpenClawWorkspaceFilePath(file.path || file.name);
    if (!key || next.has(key)) continue;
    next.set(key, file);
  }
  return Array.from(next.values());
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
    .replace(/\b(?:audio|voice|tts|speech|spoken|synthesized|generated|reply|message|file|saved|created|available|at|here|is|the|your|an|as)\b/gi, "")
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

function parseJsonValue(value: string): { value: unknown } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return { value: JSON.parse(trimmed) };
  } catch {
    return null;
  }
}

function jsonValuesAreEquivalent(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => jsonValuesAreEquivalent(entry, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => (
    Object.prototype.hasOwnProperty.call(rightRecord, key) &&
    jsonValuesAreEquivalent(leftRecord[key], rightRecord[key])
  ));
}

function isDuplicateToolResultJson(message: ChatMessageType): boolean {
  if (message.role !== "assistant") return false;
  const contentJson = parseJsonValue(message.content);
  if (!contentJson) return false;

  return message.toolCalls?.some((toolCall) => {
    if (toolCall.result === undefined) return false;
    const resultJson = parseJsonValue(toolCall.result);
    return resultJson !== null && jsonValuesAreEquivalent(contentJson.value, resultJson.value);
  }) ?? false;
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
        <TooltipHint label="Open in files">
          <button type="button" onClick={() => onOpenFile(file.path)} className={buttonClass} aria-label={`Open ${label} in files`}>
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </TooltipHint>
      )}
      {onDownloadFile && (
        <TooltipHint label="Download">
          <button type="button" onClick={() => { void onDownloadFile(file); }} className={buttonClass} aria-label={`Download ${label}`}>
            <Download className="h-3.5 w-3.5" />
          </button>
        </TooltipHint>
      )}
    </span>
  );
}

function ChatTooltipText({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return (
    <TooltipHint label={label}>
      <span className={className} tabIndex={0}>{children}</span>
    </TooltipHint>
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
  readFileBytes?: ChatFileBytesReader;
  onOpenFile?: (path: string) => void;
  onDownloadFile?: (file: ChatPendingFile) => void | Promise<void>;
}) {
  const { visibilityRef, shouldLoad } = useNearViewportMedia(true);
  const audioState = useAgentFileObjectState(
    { agentId, path: file.path, mimeType: file.type },
    readFileBytes,
    shouldLoad,
  );

  return (
    <div ref={visibilityRef} className="flex w-full max-w-[22rem] flex-col gap-1">
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
  readFileBytes?: ChatFileBytesReader;
  onOpenFile?: (path: string) => void;
  onDownloadFile?: (file: ChatPendingFile) => void | Promise<void>;
}) {
  const { visibilityRef, shouldLoad } = useNearViewportMedia(true);
  const videoState = useAgentFileObjectState(
    { agentId, path: file.path, mimeType: file.type },
    readFileBytes,
    shouldLoad,
  );

  return (
    <div ref={visibilityRef} className="flex w-full max-w-[28rem] flex-col gap-1">
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
        <ChatTooltipText className="truncate text-[11px] text-text-muted" label={file.path}>{file.name}</ChatTooltipText>
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
  readFileBytes?: ChatFileBytesReader;
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
  const { visibilityRef, shouldLoad } = useNearViewportMedia(isAudio);
  const audioState = useAgentFileObjectState(
    isAudio && imagePreviewAgentId ? { agentId: imagePreviewAgentId, path: file.path, mimeType: file.type } : null,
    readFileBytes,
    shouldLoad,
  );

  if (isAudio) {
    return (
      <div ref={visibilityRef} className="flex w-full max-w-[22rem] flex-col gap-1">
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
          <ChatTooltipText className="truncate text-[11px] text-text-muted" label={`MEDIA:${displayPath}`}>{file.name}</ChatTooltipText>
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
          file={{ agentId: imagePreviewAgentId, path: file.path, mimeType: file.type }}
          alt={file.name}
          className="h-auto max-h-[240px] max-w-full rounded-md object-contain sm:max-w-[240px]"
          readFileBytes={readFileBytes}
          onOpenFile={onOpenFile ? () => onOpenFile(file.path) : undefined}
          onDownload={onDownloadFile ? () => onDownloadFile(file) : undefined}
        />
        <div className="flex max-w-full items-center gap-2">
          <ChatTooltipText className="truncate text-[11px] text-text-muted" label={`MEDIA:${displayPath}`}>{file.name}</ChatTooltipText>
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
      <ChatTooltipText className="truncate" label={`MEDIA:${displayPath}`}>{file.name}</ChatTooltipText>
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
  agentAvatarUrl?: string | null;
  userAvatarUrl?: string | null;
  senderName?: string;
  isGroupChat?: boolean;
  compactToolCalls?: boolean;
  fileSyncRoot?: string;
  onReadFileBytesFromChat?: ChatFileBytesReader;
  onReadGatewayMediaBytesFromChat?: ChatFileBytesReader;
  onOpenFileFromChat?: (path: string) => void;
  onDownloadFileFromChat?: (file: ChatPendingFile) => void | Promise<void>;
  onRetryFailedReply?: () => void;
  retryFailedReplyDisabled?: boolean;
  retryingFailedReply?: boolean;
}

interface AgentFileReference {
  agentId: string;
  path: string;
  mimeType?: string;
}

type ToolCall = NonNullable<ChatMessageType["toolCalls"]>[number];

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

const AGENT_FILE_READ_RETRY_DELAYS_MS = [0, 250, 750, 1500, 2500];
const MAX_CHAT_MEDIA_PREVIEW_BYTES = 64 * 1024 * 1024;
const CHAT_MEDIA_PRELOAD_MARGIN_PX = 800;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function useNearViewportMedia(enabled: boolean): {
  visibilityRef: (element: HTMLElement | null) => void;
  shouldLoad: boolean;
} {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const observerSupported = typeof window !== "undefined" && typeof window.IntersectionObserver === "function";

  useEffect(() => {
    if (!enabled || nearViewport || !element || !observerSupported) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setNearViewport(true);
      observer.disconnect();
    }, { rootMargin: `${CHAT_MEDIA_PRELOAD_MARGIN_PX}px 0px` });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, enabled, nearViewport, observerSupported]);

  return {
    visibilityRef: setElement,
    shouldLoad: enabled && (!observerSupported || nearViewport),
  };
}

function useAgentFileObjectState(
  file: AgentFileReference | null | undefined,
  readFileBytes?: ChatFileBytesReader,
  enabled = true,
): { url: string | null; loading: boolean; failed: boolean } {
  const [objectState, setObjectState] = useState<{ key: string; url: string | null; failed: boolean }>({
    key: "",
    url: null,
    failed: false,
  });
  const blobRef = useRef<string | null>(null);
  const fileAgentId = file?.agentId;
  const filePath = file?.path;
  const fileMimeType = file?.mimeType;
  const fileKey = fileAgentId && filePath ? `${fileAgentId}\n${filePath}\n${fileMimeType ?? ""}` : "";

  useEffect(() => {
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }

    if (!enabled || !fileAgentId || !filePath) return;
    let cancelled = false;
    const abortController = new AbortController();

    const readBytes = () => {
      if (readFileBytes) {
        return readFileBytes(filePath, {
          maxBytes: MAX_CHAT_MEDIA_PREVIEW_BYTES,
          signal: abortController.signal,
        });
      }
      const token = getStoredToken();
      if (!token) {
        return Promise.reject(new Error("Missing auth token"));
      }
      return createAgentClient(token).fileReadBytes(
        fileAgentId,
        normalizeOpenClawWorkspaceFilePath(filePath),
        { maxBytes: MAX_CHAT_MEDIA_PREVIEW_BYTES, signal: abortController.signal },
      );
    };

    const bytesPromise = (async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < AGENT_FILE_READ_RETRY_DELAYS_MS.length; attempt += 1) {
        if (cancelled) throw new Error("Cancelled");
        const delay = AGENT_FILE_READ_RETRY_DELAYS_MS[attempt];
        if (delay > 0) await wait(delay);
        if (cancelled) throw new Error("Cancelled");
        try {
          const bytes = await readBytes();
          if (bytes.byteLength > MAX_CHAT_MEDIA_PREVIEW_BYTES) {
            throw new Error("Media preview exceeds the 64 MiB limit");
          }
          return bytes;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("File unavailable");
    })();

    bytesPromise
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([toArrayBuffer(bytes)], { type: inferChatMediaFileType(filePath, fileMimeType) });
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
      abortController.abort();
      if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    };
  }, [enabled, fileAgentId, fileKey, fileMimeType, filePath, readFileBytes]);

  const stale = objectState.key !== fileKey;
  const failed = Boolean(fileKey && !stale && objectState.failed);
  const url = fileKey && !stale && !failed ? objectState.url : null;
  return { url, loading: Boolean(fileKey && stale), failed };
}

function isGatewayManagedMediaUrl(value: string): boolean {
  return isOpenClawManagedOutgoingMediaUrl(value);
}

function useGatewayMediaObjectState(
  mediaUrl: string,
  readGatewayMediaBytes: ChatFileBytesReader | undefined,
) {
  const [objectState, setObjectState] = useState<{ key: string; url: string | null; failed: boolean }>({
    key: "",
    url: null,
    failed: false,
  });
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mediaUrl || !readGatewayMediaBytes) return undefined;
    let cancelled = false;
    const key = mediaUrl;

    void readGatewayMediaBytes(mediaUrl)
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([toArrayBuffer(bytes)]);
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setObjectState({ key, url, failed: false });
      })
      .catch(() => {
        if (cancelled) return;
        setObjectState({ key, url: null, failed: true });
      });

    return () => {
      cancelled = true;
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [mediaUrl, readGatewayMediaBytes]);

  const stale = objectState.key !== mediaUrl;
  return {
    url: stale || objectState.failed ? null : objectState.url,
    failed: !stale && objectState.failed,
  };
}

function GatewayManagedImagePreview({
  mediaUrl,
  alt,
  readGatewayMediaBytes,
}: {
  mediaUrl: string;
  alt: string;
  readGatewayMediaBytes: ChatFileBytesReader;
}) {
  const { url: blobUrl, failed } = useGatewayMediaObjectState(mediaUrl, readGatewayMediaBytes);
  if (!blobUrl) {
    return (
      <div
        role="status"
        aria-label={failed ? "Image unavailable" : "Loading image"}
        className={`flex aspect-square min-h-24 min-w-24 w-full max-w-[320px] items-center justify-center rounded-md border border-border bg-surface-low px-3 py-3 text-center text-xs text-text-muted ${CHAT_MARKDOWN_IMAGE_CLASS}`}
      >
        {failed ? (
          <span>Image unavailable</span>
        ) : (
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted/25 border-t-primary" />
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
      className={CHAT_MARKDOWN_IMAGE_CLASS}
      loading="lazy"
      downloadHref={blobUrl}
      downloadFileName={alt}
    />
  );
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
  readFileBytes?: ChatFileBytesReader;
}) {
  const { visibilityRef, shouldLoad } = useNearViewportMedia(true);
  const { url: blobUrl, failed } = useAgentFileObjectState(file, readFileBytes, shouldLoad);

  if (!blobUrl) {
    return (
      <div
        ref={visibilityRef}
        role="status"
        aria-label={failed ? "Image unavailable" : "Loading image"}
        className={`flex aspect-square min-h-24 min-w-24 w-full max-w-[320px] items-center justify-center rounded-md border border-border bg-surface-low px-3 py-3 text-center text-xs text-text-muted ${className ?? ""}`}
      >
        {failed ? (
          <span>Image unavailable</span>
        ) : (
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted/25 border-t-primary" />
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
  avatarUrl,
  sizeClass,
  iconClass,
}: {
  name: string;
  meta?: AgentMeta | null;
  avatarUrl?: string | null;
  sizeClass: string;
  iconClass: string;
}) {
  const avatar = agentAvatar(name, meta, avatarUrl);
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

function UserMessageAvatar({
  name,
  avatarUrl,
  sizeClass,
  initialClass,
  sizes,
}: {
  name: string;
  avatarUrl?: string | null;
  sizeClass: string;
  initialClass: string;
  sizes: string;
}) {
  return (
    <div className={`relative ${sizeClass} rounded-full bg-surface-low flex items-center justify-center overflow-hidden`}>
      {avatarUrl ? (
        <ResourceImage src={avatarUrl} alt="Profile avatar" fill sizes={sizes} className="object-cover" />
      ) : (
        <span className={initialClass}>{name[0]?.toUpperCase() ?? "Y"}</span>
      )}
    </div>
  );
}

function StreamingStatusDot() {
  return (
    <motion.span
      aria-label="streaming"
      className="block h-[7px] w-[7px] rounded-full bg-primary"
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

function FailedReplyRetryButton({
  onRetry,
  disabled = false,
  retrying = false,
}: {
  onRetry: () => void;
  disabled?: boolean;
  retrying?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={disabled || retrying}
      aria-label={retrying ? "Retrying failed reply" : "Retry failed reply"}
      className="mt-2 inline-flex h-8 w-fit items-center gap-1.5 rounded-lg border border-border bg-surface-low/70 px-2.5 text-xs font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${retrying ? "animate-spin motion-reduce:animate-none" : ""}`} />
      {retrying ? "Retrying..." : "Retry"}
    </button>
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

const TOOL_PENDING_TIMEOUT_MS = 45_000;
const TOOL_CALL_STACK_THRESHOLD = 3;

function shouldStackToolCalls(toolCalls: ChatMessageType["toolCalls"]): boolean {
  return (toolCalls?.length ?? 0) >= TOOL_CALL_STACK_THRESHOLD;
}

function ToolCallDisclosure({
  tc,
  index,
  isOpen,
  defaultOpen,
  onToggle,
  themeVariant,
  isStreaming,
}: {
  tc: { id?: string; name: string; args: string; result?: string };
  index: number;
  isOpen: boolean;
  defaultOpen: boolean;
  onToggle: (index: number, defaultOpen: boolean) => void;
  themeVariant: ThemeVariant;
  isStreaming: boolean;
}) {
  const detailId = useId();
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const rawPending = tc.result === undefined && isStreaming;
  const view = buildToolCallView(tc, { isStreaming, pendingTimedOut });
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
          {view.isFailed && (
            <p className="leading-relaxed text-text-secondary">{TOOL_CALL_NOTE_MESSAGE}</p>
          )}
          <ToolCallSectionList sections={[view.argsSection]} />
          {directoryListing && !view.isFailed && (
            <DirectoryVisualization
              title="Directory result"
              rootPath={directoryListing.rootPath}
              entries={directoryListing.entries}
              truncated={directoryListing.truncated}
            />
          )}
          {view.isFailed ? (
            view.resultSection && (
              <RecoveryDetails
                label="More details"
                technicalDetails={view.resultSection.text}
                className="rounded-lg border border-border bg-background/25"
              />
            )
          ) : (
            <ToolCallSectionList sections={[directoryListing ? null : view.resultSection]} />
          )}
        </div>
      )}
    </div>
  );
}

function ToolCallStackDisclosure({
  toolCalls,
  themeVariant,
  isStreaming,
}: {
  toolCalls: ToolCall[];
  themeVariant: ThemeVariant;
  isStreaming: boolean;
}) {
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState<Record<number, boolean>>({});
  const [pendingTimedOut, setPendingTimedOut] = useState(false);

  const rawPending = toolCalls.some((tc) => tc.result === undefined) && isStreaming;
  const stackView = buildToolCallStackView(toolCalls, { isStreaming, pendingTimedOut });
  const presentationStatus = stackView.allReturned ? "done" : stackView.status;

  useEffect(() => {
    if (!rawPending) return;
    const timer = window.setTimeout(() => setPendingTimedOut(true), TOOL_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [rawPending]);

  return (
    <motion.div
      layout
      className={`${getToolCallClass(themeVariant, presentationStatus)} relative shadow-[0_8px_22px_rgba(0,0,0,0.12)] ring-1 ring-border/55`}
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
            <ToolCallStatusFrame status={presentationStatus} label={stackView.statusLabel} />
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

function AssistantProgressNote({ progress }: { progress: NonNullable<ChatMessageType["progress"]> }) {
  const detailId = useId();
  const [open, setOpen] = useState(false);

  if (progress.state === "active") {
    return (
      <div
        role="status"
        aria-label="Working"
        data-testid="agent-assistant-progress"
        data-progress-state="active"
        className="mb-3 flex w-fit max-w-full min-w-0 items-start gap-2.5 text-[13px] leading-5 text-text-muted"
      >
        <span aria-hidden="true" className="mt-2.5 h-px w-4 shrink-0 bg-primary/60" />
        <p className="min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {progress.text}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="agent-assistant-progress"
      data-progress-state="settled"
      className="mb-2 w-fit max-w-full min-w-0 text-xs text-text-muted"
    >
      <button
        type="button"
        aria-controls={detailId}
        aria-expanded={open}
        aria-label="Working notes"
        onClick={() => setOpen((value) => !value)}
        className="group flex min-h-8 max-w-full items-center gap-2 text-left font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.35)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span aria-hidden="true" className="h-px w-4 shrink-0 bg-border-strong transition-colors group-hover:bg-primary/70" />
        <span>Working notes</span>
        <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
      </button>
      <div id={detailId} hidden={!open} aria-hidden={!open} className="ml-2 border-l border-border py-1.5 pl-4">
        <p className="max-w-full whitespace-pre-wrap break-words text-[13px] leading-5 [overflow-wrap:anywhere]">{progress.text}</p>
      </div>
    </div>
  );
}

function reasoningLabel(reasoning: NonNullable<ChatMessageType["reasoning"]>): string {
  if (reasoning.state === "active") return "Thinking";
  if (reasoning.state === "incomplete") return "Thoughts incomplete";
  const durationMs = reasoning.completedAt === undefined ? 0 : reasoning.completedAt - reasoning.startedAt;
  return durationMs >= 1_000 ? `Thought for ${Math.max(1, Math.round(durationMs / 1_000))}s` : "Thoughts";
}

function AssistantReasoningDisclosure({ reasoning }: { reasoning: NonNullable<ChatMessageType["reasoning"]> }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [userExpanded, setUserExpanded] = useState(false);
  const forcedOpen = reasoning.state !== "settled";
  const open = forcedOpen || userExpanded;
  const label = reasoningLabel(reasoning);

  useEffect(() => {
    if (reasoning.state !== "active" || !contentRef.current) return;
    contentRef.current.scrollTop = contentRef.current.scrollHeight;
  }, [reasoning.state, reasoning.text]);

  return (
    <>
      <details
        open={open}
        onToggle={(event) => {
          if (!forcedOpen) setUserExpanded(event.currentTarget.open);
        }}
        data-testid="agent-assistant-reasoning"
        data-reasoning-state={reasoning.state}
        aria-busy={reasoning.state === "active" || undefined}
        className="group/reasoning mb-3 w-full text-[13px] text-text-muted"
      >
        <summary
          data-testid="agent-assistant-reasoning-toggle"
          aria-label={label}
          aria-disabled={forcedOpen || undefined}
          onClick={(event) => {
            if (forcedOpen) event.preventDefault();
          }}
          className={`flex min-h-8 w-fit max-w-full list-none items-center gap-2 rounded-sm font-medium outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.35)] focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden ${forcedOpen ? "cursor-default" : "cursor-pointer transition-colors hover:text-foreground"}`}
        >
          <span
            aria-hidden="true"
            data-testid="agent-assistant-reasoning-logo"
            className="relative flex h-4 w-4 shrink-0 items-center justify-center"
          >
            <span
              className={`absolute inset-0 rounded-[0.3rem] border ${reasoning.state === "active" ? "animate-pulse border-primary/70 motion-reduce:animate-none" : "border-text-muted/40"}`}
            />
            <HyperCLILogoMark className={`h-2.5 w-2.5 ${reasoning.state === "active" ? "" : "opacity-70"}`} />
          </span>
          <span className="truncate">{label}</span>
          <ChevronRight
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          />
        </summary>
        <div
          ref={contentRef}
          className="ml-[0.4375rem] max-h-48 overflow-y-auto border-l border-border py-1.5 pl-[1.375rem] pr-2"
        >
          <p className="max-w-full whitespace-pre-wrap break-words leading-5 [overflow-wrap:anywhere]">
            {reasoning.text}
          </p>
        </div>
      </details>
      <span className="sr-only" aria-live="polite">
        {reasoning.state === "active" ? "Reasoning in progress" : reasoning.state === "incomplete" ? "Reasoning stopped before completion" : "Reasoning complete"}
      </span>
    </>
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
  agentAvatarUrl,
  userAvatarUrl,
  senderName,
  isGroupChat = false,
  fileSyncRoot,
  onReadFileBytesFromChat,
  onReadGatewayMediaBytesFromChat,
  onOpenFileFromChat,
  onDownloadFileFromChat,
  onRetryFailedReply,
  retryFailedReplyDisabled = false,
  retryingFailedReply = false,
}: ChatMessageProps) {
  const [toolsOpen, setToolsOpen] = useState<Record<number, boolean>>({});
  const stackToolCalls = shouldStackToolCalls(message.toolCalls);
  const messageFiles = uniqueChatFiles([
    ...(message.files ?? []),
    ...(message.role === "assistant" ? deriveToolWrittenFiles(message.toolCalls) : []),
  ]
    .map(normalizeChatFileReference)
    .filter((file): file is ChatPendingFile => Boolean(file)));
  const inlineAudioAlreadyAttached = Boolean(inlineAudioFile && messageFiles.some((file) => (
    isAudioFileReference(file) && isSameWorkspaceFilePath(file.path, inlineAudioFile.path)
  )));
  const standaloneInlineAudioFile = inlineAudioAlreadyAttached ? null : inlineAudioFile;
  const { visibilityRef: inlineAudioVisibilityRef, shouldLoad: shouldLoadInlineAudio } = useNearViewportMedia(
    Boolean(standaloneInlineAudioFile),
  );
  const inlineAudioState = useAgentFileObjectState(
    standaloneInlineAudioFile,
    onReadFileBytesFromChat,
    shouldLoadInlineAudio,
  );

  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isIncompleteReply = isOpenClawEmptyReplyFailureText(message.content);

  if (isSystem) {
    const systemMessage = presentSystemMessage(message.content);
    const noticeText = isIncompleteReply ? OPENCLAW_EMPTY_REPLY_NOTICE : systemMessage.text;
    const noticeLabel = isIncompleteReply ? "Incomplete reply" : systemMessage.ariaLabel;
    const isNeutralNotice = !isIncompleteReply && systemMessage.tone === "neutral";
    return (
      <div className="flex min-w-0 max-w-full justify-center">
        <div
          role="status"
          aria-label={noticeLabel}
          className={`max-w-[85%] break-words rounded-lg border px-4 py-2 text-sm [overflow-wrap:anywhere] ${isNeutralNotice ? "border-border bg-surface-low/70 text-text-muted" : "border-warning/30 bg-warning/10 text-text-secondary"}`}
        >
          {noticeText}
          {onRetryFailedReply ? (
            <div>
              <FailedReplyRetryButton
                onRetry={onRetryFailedReply}
                disabled={retryFailedReplyDisabled}
                retrying={retryingFailedReply}
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // Compute name display logic
  const showV1Name = nameVariant === "v1";
  const showV2Name = nameVariant === "v2";
  const effectiveName = isUser ? (senderName ?? "You") : (agentName ?? "Agent");
  const showStreamingDot = isStreaming && !isUser && !message.progress?.text && !message.reasoning?.text;
  const rawEffectiveContent = isDuplicateToolResultJson(message)
    ? ""
    : isIncompleteReply
      ? OPENCLAW_EMPTY_REPLY_NOTICE
      : message.content;
  const effectiveContent = !isUser && inlineAudioFile
    ? stripInlineAudioReplyContent(rawEffectiveContent, inlineAudioFile)
    : rawEffectiveContent;
  const extractedContentMedia: ExtractedContentMediaReferences = !isUser
    ? extractContentMediaReferences(effectiveContent, { streaming: isStreaming, syncRoot: fileSyncRoot })
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
      reference: classifyChatMediaReference(url, matchingFile, { syncRoot: fileSyncRoot }),
    };
  });
  const generatedMediaUrlReferences = !isUser
    ? mediaUrlReferences.flatMap(({ sourceUrl, reference }) => (
      reference.kind === "workspace" ? [{ sourceUrl, ...reference.media }] : []
    ))
    : [];
  const messageFilePaths = new Set(messageFiles.map((file) => normalizeOpenClawWorkspaceFilePath(file.path)));
  const contentMediaFilePreviews = extractedContentMedia.mediaFiles.filter(({ file }) => (
    !messageFilePaths.has(normalizeOpenClawWorkspaceFilePath(file.path))
  ));
  const contentMediaDisplayPaths = new Set(extractedContentMedia.mediaFiles.map(({ displayPath }) => displayPath));
  const generatedMediaUrlPreviews = generatedMediaUrlReferences.filter(({ displayPath, file }) => (
    !contentMediaDisplayPaths.has(displayPath) &&
    !messageFilePaths.has(normalizeOpenClawWorkspaceFilePath(file.path))
  ));
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
    || directMediaReferences.some(({ reference }) => (
      reference.kind === "audio" &&
      getChatFileLabel({ path: inlineAudioFile.path }).toLowerCase() === reference.fileName.toLowerCase()
    ))
  ));
  const hasAudioPresentation = Boolean(
    inlineAudioFile ||
    shouldRenderAudioFilePreviews ||
    contentMediaFilePreviews.some(({ file }) => isAudioFileReference(file)) ||
    generatedMediaUrlReferences.some(({ file }) => isAudioFileReference(file)) ||
    directMediaReferences.some(({ reference }) => reference.kind === "audio"),
  );
  const sanitizedContentMediaText = !isUser
    ? dropIncompleteMediaSentinelLines(extractedContentMedia.content)
    : extractedContentMedia.content;
  const displayContent = hasAudioPresentation && (
    (!isUser && isAudioReplyCarrierText(extractedContentMedia.content)) ||
    (isUser && isVoiceNoteTranscriptionInstruction(extractedContentMedia.content))
  )
    ? ""
    : sanitizedContentMediaText;
  const contentDirectoryListing = !showStreamingDot && !isUser && displayContent
    ? parseDirectoryVisualization(displayContent)
    : null;
  const hasToolCalls = (message.toolCalls?.length ?? 0) > 0;
  const toolCallTranscript = stackToolCalls ? (
    <ToolCallStackDisclosure
      toolCalls={message.toolCalls ?? []}
      themeVariant={themeVariant}
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
          isStreaming={isStreaming}
        />
      );
    })
  );
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
            <UserMessageAvatar
              name={effectiveName}
              avatarUrl={userAvatarUrl}
              sizeClass="mt-0.5 flex-shrink-0 w-7 h-7"
              initialClass="text-[10px] font-bold text-text-muted"
              sizes="28px"
            />
          );
        }
        return (
          <AgentMessageAvatar
            name={effectiveName}
            meta={agentMeta}
            avatarUrl={agentAvatarUrl}
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
                <UserMessageAvatar
                  name={effectiveName}
                  avatarUrl={userAvatarUrl}
                  sizeClass="w-5 h-5"
                  initialClass="text-[9px] font-bold text-text-muted"
                  sizes="20px"
                />
                <span className="block min-w-0 max-w-full truncate text-[11px] text-text-muted">{effectiveName}</span>
              </div>
            );
          }
          return (
            <div className="mb-1 flex max-w-full min-w-0 items-center gap-1.5">
              <AgentMessageAvatar name={effectiveName} meta={agentMeta} avatarUrl={agentAvatarUrl} sizeClass="w-5 h-5" iconClass="w-3 h-3" />
              <span className="block min-w-0 max-w-full truncate text-[11px] text-text-muted">{effectiveName}</span>
            </div>
          );
        })()}

        {!isUser && message.reasoning?.text && <AssistantReasoningDisclosure reasoning={message.reasoning} />}

        {!isUser && message.progress?.text && <AssistantProgressNote progress={message.progress} />}

        {/* Tool calls */}
        {!displayContent && toolCallTranscript}

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
                    <ChatTooltipText className="truncate" label={file.name}>{file.name}</ChatTooltipText>
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

        {contentMediaFilePreviews.length > 0 && (
          <div className="mb-2 flex max-w-full flex-wrap gap-2">
            {contentMediaFilePreviews.map(({ file, displayPath }, i) => (
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
                      <ChatTooltipText className="truncate" label={matchingFile.name}>{matchingFile.name}</ChatTooltipText>
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
                if (matchingFile && shouldRenderAudioFilePreviews) return null;
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
                if (onReadGatewayMediaBytesFromChat && isGatewayManagedMediaUrl(reference.url)) {
                  return (
                    <GatewayManagedImagePreview
                      key={`${sourceKey}-${i}`}
                      mediaUrl={reference.url}
                      alt={reference.fileName}
                      readGatewayMediaBytes={onReadGatewayMediaBytesFromChat}
                    />
                  );
                }
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

              if (reference.kind === "file") {
                if (matchingFile) return null;
                return (
                  <div
                    key={`${sourceKey}-${i}`}
                    className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0" />
                    <ChatTooltipText className="truncate" label={reference.fileName}>{reference.fileName}</ChatTooltipText>
                  </div>
                );
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
            {isIncompleteReply ? (
              <div
                role="status"
                aria-label="Incomplete reply"
                className="w-fit max-w-full rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm leading-6 text-text-secondary"
              >
                {displayContent}
              </div>
            ) : contentDirectoryListing ? (
              <DirectoryVisualization
                title="Directory"
                rootPath={contentDirectoryListing.rootPath}
                entries={contentDirectoryListing.entries}
                truncated={contentDirectoryListing.truncated}
              />
            ) : showStreamingDot && displayContent ? (
              <div
                data-chat-streaming-text="true"
                data-testid={hasToolCalls ? "agent-assistant-commentary" : undefined}
                className={`prose-chat whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${hasToolCalls ? "mb-2 max-w-[70ch] text-[13px] leading-5 text-text-secondary" : "leading-relaxed"}`}
              >
                {displayContent}
              </div>
            ) : displayContent && (
              <div data-testid={hasToolCalls ? "agent-assistant-commentary" : undefined}>
                <MarkdownContent
                  content={displayContent}
                  typewriter={false}
                  className={hasToolCalls ? "relative mb-2 max-w-[70ch] text-[13px] leading-5 text-text-secondary" : "relative"}
                  onOpenWorkspaceFile={!isUser ? onOpenFileFromChat : undefined}
                />
              </div>
            )}
            <StreamingStatusAnchor active={showStreamingDot} />
          </div>
        )}

        {displayContent && toolCallTranscript}

        {onRetryFailedReply && !isUser ? (
          <FailedReplyRetryButton
            onRetry={onRetryFailedReply}
            disabled={retryFailedReplyDisabled}
            retrying={retryingFailedReply}
          />
        ) : null}

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
          <div ref={inlineAudioVisibilityRef}>
            <AudioPlayer
              src={inlineAudioState.url}
              title={getChatFileLabel({ path: standaloneInlineAudioFile.path }) || "Voice message"}
              loading={inlineAudioState.loading}
              error={inlineAudioState.failed}
              downloadHref={inlineAudioState.url ?? undefined}
              downloadFileName={getChatFileLabel({ path: standaloneInlineAudioFile.path }) || "voice-message.webm"}
              className="mt-2"
            />
          </div>
        )}

        <TimestampDisplay timestamp={message.timestamp} variant={timestampVariant} placement="inside" isUser={isUser} />
        <TimestampDisplay timestamp={message.timestamp} variant={timestampVariant} placement="outside" isUser={isUser} />
      </div>
    </motion.div>
  );
}

export function ChatThinkingIndicator({
  variant = "off",
  label = "Thinking",
  description,
  ariaLabel,
  descriptionOnHover = false,
}: {
  variant?: FeatureVariant;
  label?: string;
  description?: string;
  ariaLabel?: string;
  descriptionOnHover?: boolean;
} = {}) {
  void variant; // accepted for future style options
  return (
    <motion.div
      role="status"
      aria-label={ariaLabel ?? label}
      aria-live="polite"
      className="group relative flex w-fit max-w-full justify-start"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {description && descriptionOnHover ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 w-max max-w-[min(22rem,80vw)] translate-y-1 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[10px] leading-4 text-text-muted opacity-0 shadow-lg transition-[opacity,transform] duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
        >
          {description}
        </span>
      ) : null}
      <div
        tabIndex={description && descriptionOnHover ? 0 : undefined}
        className="relative flex max-w-full items-center gap-2.5 overflow-hidden rounded-2xl border border-primary/20 bg-surface-low/60 px-4 py-2.5 backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        {/* Subtle shimmer background */}
        <motion.div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-r from-transparent via-primary/8 to-transparent"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }}
          style={{ width: "60%" }}
        />
        <span className="min-w-0">
          <span className="block text-xs font-medium text-text-secondary">{label}</span>
          {description && !descriptionOnHover ? (
            <span
              aria-hidden="true"
              className="mt-0.5 block text-[10px] leading-4 text-text-muted"
            >
              {description}
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-primary"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
          />
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-primary"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut", delay: 0.18 }}
          />
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-primary"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut", delay: 0.36 }}
          />
        </span>
      </div>
    </motion.div>
  );
}
