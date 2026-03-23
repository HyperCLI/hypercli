"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronDown, ChevronRight, Loader2, Paperclip, Pause, Play, Wrench } from "lucide-react";
import Markdown from "react-markdown";
import type { ChatMessage as ChatMessageType, ChatAttachment } from "@/hooks/useGatewayChat";

interface ChatMessageProps {
  message: ChatMessageType;
  inlineAudioUrl?: string | null;
}

const THINKING_PREVIEW_LINES = 2;

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

export function ChatMessageBubble({ message, inlineAudioUrl = null }: ChatMessageProps) {
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

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} group`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
          isUser
            ? "bg-surface-high text-foreground"
            : "bg-surface-low text-foreground"
        }`}
      >
        {/* Thinking block */}
        {message.thinking && (
          <div className="mb-2 border-l-2 border-[#38D39F]/40 pl-3">
            <button
              onClick={() => setThinkingOpen(!thinkingOpen)}
              className="flex items-center gap-1.5 text-xs text-[#38D39F]/70 hover:text-[#38D39F] transition-colors"
            >
              <Brain className="w-3 h-3" />
              {thinkingOpen ? (
                <>
                  <span>Hide reasoning</span>
                  <ChevronDown className="w-3 h-3" />
                </>
              ) : (
                <>
                  <span>Show reasoning</span>
                  <ChevronRight className="w-3 h-3" />
                </>
              )}
            </button>
            {!thinkingOpen && thinkingPreview && (
              <pre className="text-xs text-text-muted whitespace-pre-wrap mt-1 italic leading-relaxed line-clamp-2">
                {thinkingPreview.preview}{thinkingPreview.truncated ? "…" : ""}
              </pre>
            )}
            {thinkingOpen && (
              <pre className="text-xs text-text-muted whitespace-pre-wrap mt-1 italic leading-relaxed">
                {message.thinking}
              </pre>
            )}
          </div>
        )}

        {/* Tool calls */}
        {message.toolCalls?.map((tc, j) => {
          const hasResult = Boolean(tc.result);
          const summary = toolCallSummary(tc);
          return (
            <div
              key={j}
              className="mb-2 text-xs bg-background/50 border border-border rounded-md overflow-hidden"
            >
              <button
                onClick={() =>
                  setToolsOpen((prev) => ({ ...prev, [j]: !prev[j] }))
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
                {!toolsOpen[j] && summary && (
                  <span className="text-text-muted truncate ml-1 flex-1 min-w-0">{summary}</span>
                )}
                {toolsOpen[j] ? (
                  <ChevronDown className="w-3 h-3 text-text-muted ml-auto shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-text-muted ml-auto shrink-0" />
                )}
              </button>
              {toolsOpen[j] && (
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
          <div className="leading-relaxed prose-chat">
            <Markdown
              components={{
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
              }}
            >
              {message.content}
            </Markdown>
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
    </div>
  );
}

export function ChatThinkingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-surface-low rounded-lg px-4 py-3 flex items-center gap-3 border-l-2 border-[#38D39F]/50">
        <Brain className="w-4 h-4 text-[#38D39F]" />
        <span className="text-sm text-text-secondary">Thinking</span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#38D39F] animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-[#38D39F] animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-[#38D39F] animate-bounce" style={{ animationDelay: "300ms" }} />
        </span>
      </div>
    </div>
  );
}
