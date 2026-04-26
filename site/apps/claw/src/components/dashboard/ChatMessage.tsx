"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronDown, ChevronRight, Loader2, Paperclip, Pause, Play, Wrench,
  TriangleAlert, ClockFading, RotateCcw
} from "lucide-react";
import Markdown from "react-markdown";
import { motion, type HTMLMotionProps } from "framer-motion";
import type { ChatMessage as ChatMessageType, ChatAttachment } from "@/lib/openclaw-chat";
import { getStoredToken, API_BASE_URL } from "@/lib/api";
import { createAgentClient } from "@/lib/agent-client";
import { agentAvatar } from "@/lib/avatar";

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

function encodePath(path: string): string {
  return path.split("/").filter(Boolean).map((part) => encodeURIComponent(part)).join("/");
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
  inlineAudioUrl?: string | null;
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
  senderName?: string;
  isGroupChat?: boolean;
}

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

export function AuthImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const blobRef = useRef<string | null>(null);

  function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }

  function parseAgentFileUrl(rawSrc: string): { agentId: string; path: string } | null {
    try {
      const url = new URL(rawSrc, typeof window !== "undefined" ? window.location.origin : "https://agents.hypercli.com");
      const match = url.pathname.match(/\/deployments\/([^/]+)\/files\/(.+)$/);
      if (!match) return null;
      const [, agentId, encodedPath] = match;
      const path = encodedPath
        .split("/")
        .filter(Boolean)
        .map((part) => decodeURIComponent(part))
        .join("/");
      if (!agentId || !path) return null;
      return { agentId, path };
    } catch {
      return null;
    }
  }

  useEffect(() => {
    setBlobUrl(null);
    setFailed(false);
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }

    const token = getStoredToken();
    if (!token) { setFailed(true); return; }
    const target = parseAgentFileUrl(src);
    if (!target) { setFailed(true); return; }

    createAgentClient(token).fileReadBytes(target.agentId, target.path)
      .then((bytes) => {
        const blob = new Blob([toArrayBuffer(bytes)]);
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setBlobUrl(url);
      })
      .catch(() => {
        setFailed(true);
      });

    return () => {
      if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    };
  }, [src]);

  if (failed || !blobUrl) return null;

  return (
    <a href={blobUrl} target="_blank" rel="noopener noreferrer">
      <img src={blobUrl} alt={alt} className={className} loading="lazy" />
    </a>
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

export function ChatMessageBubble({
  message,
  inlineAudioUrl = null,
  agentId = null,
  timestampVariant = "off",
  nameVariant = "off",
  bubblesVariant = "off",
  animationVariant = "off",
  themeVariant = "off",
  streamingVariant = "off",
  isStreaming = false,
  agentName,
  senderName,
  isGroupChat = false,
}: ChatMessageProps) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState<Record<number, boolean>>({});
  const [inlineAudioPlaying, setInlineAudioPlaying] = useState(false);
  const inlineAudioRef = useRef<HTMLAudioElement | null>(null);

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
        const av = agentAvatar(effectiveName);
        return (
          <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: av.bgColor }}>
            <span className="text-[10px] font-bold" style={{ color: av.fgColor }}>{effectiveName[0]?.toUpperCase() ?? "A"}</span>
          </div>
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
          const av = agentAvatar(effectiveName);
          return (
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: av.bgColor }}>
                <span className="text-[9px] font-bold" style={{ color: av.fgColor }}>{effectiveName[0]?.toUpperCase() ?? "A"}</span>
              </div>
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
        {message.toolCalls?.map((tc, j) => {
          const hasResult = Boolean(tc.result);
          const summary = toolCallSummary(tc);
          const imagePath = agentId ? extractImagePath(tc) : null;
          const imageUrl = imagePath && agentId
            ? `${API_BASE_URL}/deployments/${agentId}/files/${encodePath(imagePath)}`
            : null;
          return (
            <div
              key={j}
              className="mb-2 w-full text-xs bg-background/50 border border-border rounded-md overflow-hidden"
            >
              <button
                onClick={() =>
                  setToolsOpen((prev) => ({ ...prev, [j]: prev[j] === false }))
                }
                className="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-surface-low transition-colors text-left"
              >
                {hasResult ? (
                  <Check className="w-3 h-3 text-[#38D39F] shrink-0" />
                ) : (
                  <Loader2 className="w-3 h-3 text-[#f0c56c] animate-spin shrink-0" />
                )}
                <Wrench className="w-3 h-3 text-[#f0c56c] shrink-0" />
                <span className="text-[#f0c56c] font-medium">{tc.name}</span>
                {toolsOpen[j] === false && summary && (
                  <span className="text-text-muted truncate ml-1 flex-1 min-w-0">{summary}</span>
                )}
                {toolsOpen[j] === false ? (
                  <ChevronRight className="w-3 h-3 text-text-muted ml-auto shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-text-muted ml-auto shrink-0" />
                )}
              </button>
              {toolsOpen[j] !== false && (
                <pre className="px-2.5 py-1.5 text-text-muted whitespace-pre-wrap border-t border-border font-mono">
                  {tc.args}
                  {tc.result && (
                    <>
                      {"\n"}
                      <span className="text-text-secondary">{tc.result}</span>
                    </>
                  )}
                </pre>
              )}
              {imageUrl && (
                <div className="px-2.5 py-2 border-t border-border">
                  <AuthImage
                    src={imageUrl}
                    alt={imagePath?.split("/").pop() || "generated image"}
                    className="max-w-[320px] max-h-[320px] rounded-md object-contain"
                  />
                </div>
              )}
            </div>
          );
        })}

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
        {message.content && (
          <div
            className="leading-relaxed prose-chat relative"
            style={isStreaming ? { willChange: "contents", transform: "translateZ(0)" } : undefined}
          >
            {isStreaming && !isUser ? (
              <TypewriterMarkdown text={message.content} />
            ) : (
              <Markdown components={MARKDOWN_COMPONENTS}>{message.content}</Markdown>
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

interface ChatStateIndicatorProps{
  hasErrorOccurred: boolean;
  hasTimeoutOccurred: boolean;
  retryMessage: () => void;
  variant?: string;
}

export function ChatStateIndicator({
  hasErrorOccurred,
  hasTimeoutOccurred,
  retryMessage,
  variant = "off",
}: ChatStateIndicatorProps) {
  void variant;

  const isError = hasErrorOccurred;
  const isTimeout = !isError && hasTimeoutOccurred;
  const isThinking = !isError && !isTimeout;

  let Icon = Brain;
  let text = "Thinking";
  let iconColor = "text-[#38D39F]";
  let textColor = "text-text-secondary";
  let borderColor = "border-[#38D39F]/20";
  let shimmerColor = "via-[#38D39F]/8";

  if (isError) {
    Icon = TriangleAlert;
    text = "Error occurred";
    iconColor = "text-red-500";
    textColor = "text-red-400";
    borderColor = "border-red-500/20";
    shimmerColor = "via-red-500/10";
  } else if (isTimeout) {
    Icon = ClockFading;
    text = "Timeout occurred";
    iconColor = "text-gray-400";
    textColor = "text-gray-400";
    borderColor = "border-gray-400/20";
    shimmerColor = "via-gray-400/10";
  }

  return (
    <motion.div
      className="flex justify-start"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div
        className={`relative bg-surface-low/60 backdrop-blur-sm rounded-2xl px-4 py-2.5 flex items-center gap-3 border overflow-hidden ${borderColor}`}
      >
        {/* Shimmer only for thinking */}
        {isThinking && (
          <motion.div
            aria-hidden
            className={`absolute inset-0 -z-10 bg-gradient-to-r from-transparent ${shimmerColor} to-transparent`}
            animate={{ x: ["-100%", "100%"] }}
            transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }}
            style={{ width: "60%" }}
          />
        )}

        {/* Icon */}
        <motion.div
          animate={isThinking ? { scale: [1, 1.08, 1] } : {}}
          transition={
            isThinking
              ? { repeat: Infinity, duration: 1.4, ease: "easeInOut" }
              : {}
          }
        >
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </motion.div>

        {/* Text */}
        <span className={`text-xs font-medium ${textColor}`}>{text}</span>

        {/* Thinking dots */}
        {isThinking && (
          <span className="flex items-center gap-1">
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-[#38D39F]"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
            />
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-[#38D39F]"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
              transition={{ repeat: Infinity, duration: 1.2, delay: 0.18 }}
            />
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-[#38D39F]"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
              transition={{ repeat: Infinity, duration: 1.2, delay: 0.36 }}
            />
          </span>
        )}

        {/* Retry button for error/timeout */}
        {(isError || isTimeout) && (
          <button
            onClick={retryMessage}
            className="ml-2 flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md border border-white/10 hover:bg-white/5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Retry
          </button>
        )}
      </div>
    </motion.div>
  );
}