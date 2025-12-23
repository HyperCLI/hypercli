"use client";

import { useRef, useEffect } from "react";
import { cn } from "@hypercli/shared-ui";
import { User, Bot } from "lucide-react";
import { marked } from "marked";

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatWindowProps {
  messages: Message[];
  isStreaming?: boolean;
}

export function ChatWindow({ messages, isStreaming = false }: ChatWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const renderMarkdown = (content: string) => {
    const html = marked.parse(content) as string;
    return { __html: html };
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 rounded-2xl bg-primary/8 flex items-center justify-center mx-auto mb-6">
            <Bot className="w-8 h-8 text-primary" strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-3 tracking-tight">
            Welcome to HyperCLI Chat
          </h2>
          <p className="text-base text-text-tertiary leading-relaxed">
            Start a conversation by typing a message below. Your
            conversations are powered by HyperCLI deployments.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden bg-background"
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="space-y-6">
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                "flex gap-3 sm:gap-4 group",
                message.role === "user" ? "flex-row-reverse" : ""
              )}
            >
              {/* Avatar */}
              <div
                className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors",
                  message.role === "user"
                    ? "bg-primary/10 text-primary"
                    : "bg-surface-high text-text-tertiary group-hover:bg-surface-high/80"
                )}
              >
                {message.role === "user" ? (
                  <User className="w-4.5 h-4.5" strokeWidth={1.75} />
                ) : (
                  <Bot className="w-4.5 h-4.5" strokeWidth={1.75} />
                )}
              </div>

              {/* Message Content */}
              <div
                className={cn(
                  "flex-1 min-w-0",
                  message.role === "user" ? "flex justify-end" : ""
                )}
              >
                <div
                  className={cn(
                    "rounded-2xl px-4 py-3 overflow-hidden break-words transition-colors",
                    message.role === "user"
                      ? "inline-block max-w-[85%] sm:max-w-[70%] bg-primary text-primary-foreground"
                      : "w-full bg-surface-low/40"
                  )}
                >
                  {message.role === "user" ? (
                    <p className="text-[15px] whitespace-pre-wrap leading-relaxed break-words">
                      {message.content}
                    </p>
                  ) : message.content ? (
                    <div
                      className="text-[15px] text-foreground markdown-content prose prose-invert prose-sm max-w-none
                        [&_p]:leading-relaxed [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0
                        [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-foreground
                        [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-foreground
                        [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-foreground
                        [&_ul]:my-2 [&_ul]:space-y-1 [&_ol]:my-2 [&_ol]:space-y-1
                        [&_li]:text-text-secondary [&_li]:leading-relaxed
                        [&_code]:bg-surface-high/60 [&_code]:text-[#7dd3fc] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-[14px] [&_code]:break-words [&_code]:font-mono [&_code]:border [&_code]:border-border/20
                        [&_pre]:bg-[#0d1117] [&_pre]:border [&_pre]:border-border/30 [&_pre]:rounded-xl [&_pre]:p-4 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:shadow-sm
                        [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[#e6edf3] [&_pre_code]:text-[13px] [&_pre_code]:border-0
                        [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-words hover:[&_a]:text-accent-hover
                        [&_strong]:font-semibold [&_strong]:text-foreground
                        [&_em]:italic [&_em]:text-text-secondary
                        [&_blockquote]:border-l-2 [&_blockquote]:border-border-medium [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-text-tertiary
                        [&_img]:!inline [&_img]:!h-[1em] [&_img]:!w-[1em] [&_img]:!max-h-[1em] [&_img]:!max-w-[1em] [&_img]:!m-0 [&_img]:!align-[-0.1em]"
                      dangerouslySetInnerHTML={renderMarkdown(message.content)}
                    />
                  ) : (
                    // Typing indicator
                    <div className="flex items-center gap-1.5 py-2 px-1">
                      <div className="w-2 h-2 bg-text-tertiary rounded-full animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1s" }} />
                      <div className="w-2 h-2 bg-text-tertiary rounded-full animate-bounce" style={{ animationDelay: "200ms", animationDuration: "1s" }} />
                      <div className="w-2 h-2 bg-text-tertiary rounded-full animate-bounce" style={{ animationDelay: "400ms", animationDuration: "1s" }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}
