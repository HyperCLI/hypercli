"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";
import Markdown from "react-markdown";
import type { ChatMessage as ChatMessageType, ChatAttachment } from "@/hooks/useGatewayChat";

interface ChatMessageProps {
  message: ChatMessageType;
}

function formatTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatMessageBubble({ message }: ChatMessageProps) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState<Record<number, boolean>>({});

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
          <button
            onClick={() => setThinkingOpen(!thinkingOpen)}
            className="flex items-center gap-1.5 text-xs text-text-muted mb-2 hover:text-text-secondary transition-colors"
          >
            {thinkingOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Thinking...
          </button>
        )}
        {message.thinking && thinkingOpen && (
          <pre className="text-xs text-text-muted whitespace-pre-wrap mb-2 italic leading-relaxed">
            {message.thinking}
          </pre>
        )}

        {/* Tool calls */}
        {message.toolCalls?.map((tc, j) => (
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
              <Wrench className="w-3 h-3 text-[#f0c56c]" />
              <span className="text-[#f0c56c] font-medium">{tc.name}</span>
              {toolsOpen[j] ? (
                <ChevronDown className="w-3 h-3 text-text-muted ml-auto" />
              ) : (
                <ChevronRight className="w-3 h-3 text-text-muted ml-auto" />
              )}
            </button>
            {toolsOpen[j] && (
              <pre className="px-2.5 py-1.5 text-text-muted whitespace-pre-wrap border-t border-border font-mono">
                {tc.args}
                {tc.result && (
                  <>
                    {"\n"}
                    <span className="text-text-secondary">→ {tc.result}</span>
                  </>
                )}
              </pre>
            )}
          </div>
        ))}

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
                  📎 {url.split("/").pop() || "media"}
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
      <div className="bg-surface-low rounded-lg px-4 py-2.5 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
        <span className="text-xs text-text-muted">Thinking...</span>
      </div>
    </div>
  );
}
