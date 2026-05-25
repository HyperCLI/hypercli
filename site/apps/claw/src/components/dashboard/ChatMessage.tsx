"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronDown, ChevronRight, Download, FolderOpen, Loader2, Paperclip, Pause, Play, Wrench } from "lucide-react";
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import type { ChatMessage as ChatMessageType, ChatPendingFile } from "@/lib/openclaw-chat";
import { getStoredToken } from "@/lib/api";
import { createAgentClient } from "@/lib/agent-client";
import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import { agentAvatar, type AgentMeta } from "@/lib/avatar";
import { ResourceImage } from "@/components/ResourceImage";
import { ChatImageViewer } from "@/components/dashboard/chat/ChatImageViewer";
import { DirectoryVisualization, parseDirectoryVisualization } from "@/components/dashboard/chat/DirectoryVisualization";
import { CHAT_MARKDOWN_IMAGE_CLASS, MarkdownContent } from "@/components/dashboard/chat/MarkdownContent";

// ── Helpers ──

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

function extractImagePath(tc: { name: string; args: string; result?: string }): string | null {
  try {
    const args = JSON.parse(tc.args);
    const path = args.file_path || args.path || "";
    if (typeof path === "string" && IMAGE_EXTENSIONS.test(path)) return path;
  } catch { /* ignore */ }
  return null;
}

function isImageFileReference(file: { name: string; path: string; type: string }): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name) || IMAGE_EXTENSIONS.test(file.path);
}

function fileLabel(file: { name?: string; path?: string }): string {
  return file.name || file.path?.split("/").filter(Boolean).pop() || "file";
}

function mediaFileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://hypercli.local");
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : "media";
  } catch {
    return url.split(/[?#]/)[0].split("/").filter(Boolean).pop() || "media";
  }
}

interface ChatFileActionsProps {
  file: ChatPendingFile;
  onOpenFile?: (path: string) => void;
  onDownloadFile?: (file: ChatPendingFile) => void | Promise<void>;
}

function ChatFileActions({ file, onOpenFile, onDownloadFile }: ChatFileActionsProps) {
  if (!onOpenFile && !onDownloadFile) return null;

  const label = fileLabel(file);
  const buttonClass = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background/60 text-text-muted transition-colors hover:border-[#38D39F]/50 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38D39F]";

  return (
    <span className="ml-1 inline-flex shrink-0 items-center gap-1">
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

function useAgentFileObjectUrl(
  file: AgentFileReference | null | undefined,
  readFileBytes?: (path: string) => Promise<Uint8Array>,
): string | null {
  return useAgentFileObjectState(file, readFileBytes).url;
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
  const [inlineAudioPlaying, setInlineAudioPlaying] = useState(false);
  const inlineAudioRef = useRef<HTMLAudioElement | null>(null);
  const inlineAudioUrl = useAgentFileObjectUrl(inlineAudioFile, onReadFileBytesFromChat);

  useEffect(() => {
    if (!inlineAudioUrl) return;
    const audio = new Audio(inlineAudioUrl);
    audio.addEventListener("ended", () => setInlineAudioPlaying(false));
    audio.addEventListener("pause", () => setInlineAudioPlaying(false));
    audio.addEventListener("play", () => setInlineAudioPlaying(true));
    inlineAudioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
      inlineAudioRef.current = null;
      setInlineAudioPlaying(false);
    };
  }, [inlineAudioUrl]);

  const toggleInlineAudio = useCallback(() => {
    const audio = inlineAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      return;
    }
    audio.pause();
  }, []);

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
  const effectiveContent = contentIsJson ? "" : message.content;
  const contentDirectoryListing = !isUser && effectiveContent ? parseDirectoryVisualization(effectiveContent) : null;
  const messageFiles = message.files ?? [];
  const hasInlineImageAttachments = (message.attachments?.length ?? 0) > 0;
  const imageFiles = messageFiles.filter(isImageFileReference);
  const imagePreviewAgentId = agentId ?? "";
  const shouldRenderImageFilePreviews = Boolean(imagePreviewAgentId && imageFiles.length > 0 && !hasInlineImageAttachments);
  const fileChips = messageFiles.filter((file) => (
    !isImageFileReference(file) || (!hasInlineImageAttachments && !shouldRenderImageFilePreviews)
  ));
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
              return (
                <ChatImageViewer
                  key={i}
                  src={attachmentSrc}
                  alt={att.fileName || "attachment"}
                  width={240}
                  height={240}
                  sizes="(max-width: 640px) 100vw, 240px"
                  className="h-auto max-h-[240px] max-w-full rounded-md object-cover sm:max-w-[240px]"
                  downloadHref={attachmentSrc}
                  downloadFileName={att.fileName || "attachment"}
                />
              );
            })}
          </div>
        )}

        {messageFiles.length > 0 && (
          <>
            {shouldRenderImageFilePreviews && (
              <div className="mb-2 flex max-w-full flex-wrap gap-2">
                {imageFiles.map((file, i) => (
                  <AuthImage
                    key={`${file.path}-${i}`}
                    file={{ agentId: imagePreviewAgentId, path: file.path }}
                    alt={file.name || "attachment"}
                    className="h-auto max-h-[240px] max-w-full rounded-md object-contain sm:max-w-[240px]"
                    readFileBytes={onReadFileBytesFromChat}
                    onOpenFile={onOpenFileFromChat ? () => onOpenFileFromChat(file.path) : undefined}
                    onDownload={onDownloadFileFromChat ? () => onDownloadFileFromChat(file) : undefined}
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

        {/* Agent-sent media (URLs) */}
        {message.mediaUrls && message.mediaUrls.length > 0 && (
          <div className="mb-2 flex max-w-full flex-wrap gap-2">
            {message.mediaUrls.map((url, i) => {
              const isImage = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(url) || url.startsWith("data:image/");
              if (isImage) {
                return (
                  <ChatImageViewer
                    key={i}
                    src={url}
                    alt="media"
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
              return (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-full break-words text-xs text-accent hover:underline [overflow-wrap:anywhere]"
                >
                  {url.split("/").pop() || "media"}
                </a>
              );
            })}
          </div>
        )}

        {/* Content */}
        {(effectiveContent || showStreamingDot) && (
          <div className={`relative w-full min-w-0 max-w-full ${showStreamingDot ? "pb-5" : ""}`}>
            {contentDirectoryListing ? (
              <DirectoryVisualization
                title="Directory"
                rootPath={contentDirectoryListing.rootPath}
                entries={contentDirectoryListing.entries}
                truncated={contentDirectoryListing.truncated}
              />
            ) : effectiveContent && (
              <MarkdownContent
                content={effectiveContent}
                typewriter={isStreaming && !isUser}
                className="relative"
                style={isStreaming ? { willChange: "contents", transform: "translateZ(0)" } : undefined}
              />
            )}
            <StreamingStatusAnchor active={showStreamingDot} />
          </div>
        )}


        {inlineAudioUrl && (
          <button
            type="button"
            onClick={toggleInlineAudio}
            className="mt-2 inline-flex items-center justify-center rounded-md border border-border bg-background/50 p-1.5 text-text-muted hover:text-foreground"
            title={inlineAudioPlaying ? "Pause voice message" : "Play voice message"}
          >
            {inlineAudioPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
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
