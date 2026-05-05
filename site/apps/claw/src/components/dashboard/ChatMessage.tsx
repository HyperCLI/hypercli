"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronDown, ChevronRight, Loader2, Paperclip, Pause, Play, Wrench } from "lucide-react";
import Markdown from "react-markdown";
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import type { ChatMessage as ChatMessageType } from "@/lib/openclaw-chat";
import { getStoredToken } from "@/lib/api";
import { createAgentClient } from "@/lib/agent-client";
import { agentAvatar, type AgentMeta } from "@/lib/avatar";

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
}

interface AgentFileReference {
  agentId: string;
  path: string;
}

type ToolCall = NonNullable<ChatMessageType["toolCalls"]>[number];

const THINKING_PREVIEW_LINES = 2;

/**
 * Markdown component config — lifted to module scope so the reference is stable
 * across renders. Inline objects re-mount react-markdown's internals on every
 * streamed chunk, which causes flicker. Keeping this stable lets the renderer
 * skip work where possible.
 */
const MARKDOWN_COMPONENTS: Parameters<typeof Markdown>[0]["components"] = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    return isBlock ? (
      <pre className="bg-background/50 border border-border rounded-md px-3 py-2 my-2 overflow-x-auto text-xs font-mono">
        <code>{children}</code>
      </pre>
    ) : (
      <code className="bg-background/50 text-[#f0c56c] px-1 py-0.5 rounded text-xs font-mono">{children}</code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
      {children}
    </a>
  ),
  h1: ({ children }) => <h1 className="text-lg font-bold mb-2">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-bold mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-bold mb-1">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-text-muted pl-3 italic text-text-secondary my-2">{children}</blockquote>
  ),
  hr: () => <hr className="border-border my-3" />,
  img: ({ src, alt }) => typeof src === "string" && src ? (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block my-2">
      <img src={src} alt={typeof alt === "string" ? alt : "image"} className="max-w-[320px] max-h-[320px] rounded-md object-contain" loading="lazy" />
    </a>
  ) : null,
};

/**
 * Typewriter that renders streamed markdown content character-by-character via
 * requestAnimationFrame, decoupling display speed from network arrival speed.
 *
 * Why: WebSocket + React batching coalesces chunks into single renders, making
 * messages "pop" instead of typing. This component buffers the full target text
 * and advances a display cursor at ~60 chars/sec regardless of how chunks arrive.
 */
function TypewriterMarkdown({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState("");
  const targetRef = useRef(text);
  targetRef.current = text;

  useEffect(() => {
    let raf: number;
    let last = performance.now();
    // Characters revealed per millisecond — tuned for fluid LLM-like typing.
    // ~70 chars/sec = nice middle ground; faster than reading speed but visible.
    const CHARS_PER_MS = 0.07;

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setDisplayed((cur) => {
        const target = targetRef.current;
        if (cur.length >= target.length) return cur;
        // Catch up faster if we're far behind (avoids long lag at end of stream)
        const behind = target.length - cur.length;
        const speedMultiplier = behind > 200 ? 4 : behind > 80 ? 2 : 1;
        const advance = Math.max(1, Math.ceil(dt * CHARS_PER_MS * speedMultiplier));
        return target.slice(0, cur.length + advance);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <Markdown components={MARKDOWN_COMPONENTS}>{displayed}</Markdown>;
}

function formatTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateToLines(text: string, maxLines: number): { preview: string; truncated: boolean } {
  const lines = text.split("\n").slice(0, maxLines);
  const preview = lines.join("\n").trim();
  return { preview, truncated: text.split("\n").length > maxLines || text.length > preview.length + 50 };
}

function toolCallSummary(tc: { name: string; args: string; result?: string }): string {
  if (tc.result) {
    const trimmed = tc.result.trim().slice(0, 60);
    return trimmed.length < tc.result.trim().length ? `${trimmed}…` : trimmed;
  }
  const trimmed = tc.args.trim().slice(0, 60);
  return trimmed.length < tc.args.trim().length ? `${trimmed}…` : trimmed;
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

function useAgentFileObjectUrl(file: AgentFileReference | null | undefined): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    setBlobUrl(null);
    setFailed(false);
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }

    if (!file) return;
    const token = getStoredToken();
    if (!token) { setFailed(true); return; }
    let cancelled = false;

    createAgentClient(token).fileReadBytes(file.agentId, file.path)
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([toArrayBuffer(bytes)]);
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setBlobUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      });

    return () => {
      cancelled = true;
      if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    };
  }, [file?.agentId, file?.path]);

  return failed ? null : blobUrl;
}

export function AuthImage({
  file,
  alt,
  className,
}: {
  file: AgentFileReference;
  alt: string;
  className?: string;
}) {
  const blobUrl = useAgentFileObjectUrl(file);

  if (!blobUrl) return null;

  return (
    <a href={blobUrl} target="_blank" rel="noopener noreferrer">
      <img src={blobUrl} alt={alt} className={className} loading="lazy" />
    </a>
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
    <div className={`${sizeClass} rounded-full flex items-center justify-center overflow-hidden`} style={{ backgroundColor: avatar.bgColor }}>
      {avatar.imageUrl ? (
        <span
          aria-label={`${name} avatar`}
          className="h-full w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${JSON.stringify(avatar.imageUrl)})` }}
        />
      ) : (
        <AvatarIcon className={iconClass} style={{ color: avatar.fgColor }} />
      )}
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
  if (theme === "v1") {
    return hasResult
      ? "mb-2 text-xs bg-[#38D39F]/8 border border-[#38D39F]/25 rounded-md overflow-hidden"
      : "mb-2 text-xs bg-[#f0c56c]/8 border border-[#f0c56c]/25 rounded-md overflow-hidden";
  }
  if (theme === "v2") {
    return hasResult
      ? "mb-2 text-xs bg-[#38D39F]/8 border-l-4 border-[#38D39F] rounded-md overflow-hidden"
      : "mb-2 text-xs bg-[#f0c56c]/8 border-l-4 border-[#f0c56c] rounded-md overflow-hidden";
  }
  if (theme === "v3") {
    return hasResult
      ? "mb-2 text-xs bg-[#38D39F]/10 border border-[#38D39F]/30 rounded-md overflow-hidden"
      : "mb-2 text-xs bg-[#f0c56c]/10 border border-[#f0c56c]/30 rounded-md overflow-hidden";
  }
  return "mb-2 text-xs bg-background/50 border border-border rounded-md overflow-hidden";
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

  useEffect(() => {
    if (!rawPending) return;
    const timer = window.setTimeout(() => setPendingTimedOut(true), TOOL_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [rawPending]);

  return (
    <div className={getToolCallClass(themeVariant, hasResult)}>
      <button
        onClick={() => onToggle(index, defaultOpen)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-surface-low transition-colors text-left"
      >
        {pending ? (
          <Loader2 className="w-3 h-3 text-[#f0c56c] animate-spin shrink-0" />
        ) : hasResult ? (
          <Check className="w-3 h-3 text-[#38D39F] shrink-0" />
        ) : (
          <Wrench className="w-3 h-3 text-text-muted shrink-0" />
        )}
        <span className="text-[#f0c56c] font-medium">{tc.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-text-muted">
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
            <div>
              <p className="mb-1 font-medium text-text-secondary">Arguments</p>
              <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-mono">{argsDetail}</pre>
            </div>
          )}
          {resultDetail && (
            <div>
              <p className="mb-1 font-medium text-text-secondary">Result</p>
              <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words font-mono">{resultDetail}</pre>
            </div>
          )}
        </div>
      )}
      {imageFile && (
        <div className="px-2.5 py-2 border-t border-border">
          <AuthImage
            file={imageFile}
            alt={imagePath?.split("/").pop() || "generated image"}
            className="max-w-[320px] max-h-[320px] rounded-md object-contain"
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
        className="relative flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
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
            <span className="font-medium text-[#f0c56c]">{toolCalls.length} tool calls</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusClass}`}>
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
}: ChatMessageProps) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState<Record<number, boolean>>({});
  const [inlineAudioPlaying, setInlineAudioPlaying] = useState(false);
  const inlineAudioRef = useRef<HTMLAudioElement | null>(null);
  const inlineAudioUrl = useAgentFileObjectUrl(inlineAudioFile);

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
      <div className="flex justify-center">
        <div className="max-w-[85%] rounded-lg px-4 py-2 text-sm bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-[#d05f5f]">
          {message.content}
        </div>
      </div>
    );
  }

  const thinkingPreview = message.thinking ? truncateToLines(message.thinking, THINKING_PREVIEW_LINES) : null;

  // Compute name display logic
  const showV1Name = nameVariant === "v1";
  const showV2Name = nameVariant === "v2";
  const effectiveName = isUser ? (senderName ?? "You") : (agentName ?? "Agent");
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

  return (
    <motion.div
      className={`flex ${isUser ? "justify-end" : "justify-start"} items-start gap-2 group`}
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

      <div className={`flex flex-col min-w-0 ${isUser ? "items-end" : "items-start flex-1"}`}>

        {/* v1 name: monogram + muted label above bubble */}
        {showV1Name && (() => {
          if (isUser) {
            return (
              <div className="flex items-center gap-1.5 mb-1 flex-row-reverse">
                <div className="w-5 h-5 rounded-full bg-surface-low flex items-center justify-center">
                  <span className="text-[9px] font-bold text-text-muted">{effectiveName[0]?.toUpperCase() ?? "Y"}</span>
                </div>
                <span className="text-[11px] text-text-muted">{effectiveName}</span>
              </div>
            );
          }
          return (
            <div className="flex items-center gap-1.5 mb-1">
              <AgentMessageAvatar name={effectiveName} meta={agentMeta} sizeClass="w-5 h-5" iconClass="w-3 h-3" />
              <span className="text-[11px] text-text-muted">{effectiveName}</span>
            </div>
          );
        })()}

        {/* Thinking — subtle italic quote with left accent, click to expand */}
        {message.thinking && !isUser && (
          <button
            onClick={() => setThinkingOpen((v) => !v)}
            className="group/think w-full max-w-full mb-2 text-left text-xs italic text-text-muted/70 hover:text-text-muted transition-colors pl-2.5 border-l border-[#38D39F]/30 hover:border-[#38D39F]/60"
          >
            {thinkingOpen ? (
              <span className="whitespace-pre-wrap leading-relaxed block">{message.thinking}</span>
            ) : (
              <span className="line-clamp-2 leading-relaxed">
                {thinkingPreview?.preview ?? message.thinking}
                {thinkingPreview?.truncated && (
                  <span className="text-[#38D39F]/60 ml-1 not-italic font-medium opacity-0 group-hover/think:opacity-100 transition-opacity">show more</span>
                )}
              </span>
            )}
          </button>
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
          <div className="flex flex-wrap gap-2 mb-2">
            {message.attachments.map((att, i) => (
              <img
                key={i}
                src={`data:${att.mimeType};base64,${att.content}`}
                alt={att.fileName || "attachment"}
                className="max-w-[240px] max-h-[240px] rounded-md object-cover cursor-pointer"
                onClick={() => window.open(`data:${att.mimeType};base64,${att.content}`, "_blank")}
              />
            ))}
          </div>
        )}

        {message.files && message.files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.files.map((file, i) => (
              <div
                key={`${file.name}-${i}`}
                className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{file.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Agent-sent media (URLs) */}
        {message.mediaUrls && message.mediaUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {message.mediaUrls.map((url, i) => {
              const isImage = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(url) || url.startsWith("data:image/");
              if (isImage) {
                return (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={url}
                      alt="media"
                      className="max-w-[320px] max-h-[320px] rounded-md object-contain"
                      loading="lazy"
                    />
                  </a>
                );
              }
              // Non-image media: render as link
              return (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline text-xs"
                >
                  {url.split("/").pop() || "media"}
                </a>
              );
            })}
          </div>
        )}

        {/* Content */}
        {effectiveContent && (
          <div
            className="leading-relaxed prose-chat relative"
            style={isStreaming ? { willChange: "contents", transform: "translateZ(0)" } : undefined}
          >
            {isStreaming && !isUser ? (
              <TypewriterMarkdown text={effectiveContent} />
            ) : (
              <Markdown components={MARKDOWN_COMPONENTS}>{effectiveContent}</Markdown>
            )}
            {isStreaming && !isUser && (
              <motion.span
                aria-label="streaming"
                className="inline-block w-[7px] h-[7px] align-middle ml-1 rounded-full bg-[#38D39F]"
                style={{ boxShadow: "0 0 6px rgba(56, 211, 159, 0.6)" }}
                animate={{ scale: [0.85, 1.15, 0.85], opacity: [0.6, 1, 0.6] }}
                transition={{ repeat: Infinity, duration: 1.1, ease: "easeInOut" }}
              />
            )}
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
