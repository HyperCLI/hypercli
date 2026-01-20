"use client";

import { useRef, useEffect } from "react";
import { cn, Button } from "@hypercli/shared-ui";
import { User, Bot } from "lucide-react";
import { marked } from "marked";

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

interface SelectionOption {
  id: string;
  label: string;
  description?: string | null;
}

interface RenderMeta {
  render_id: string;
  state?: string | null;
  template?: string | null;
  gpu_type?: string | null;
  result_url?: string | null;
  error?: string | null;
}

interface MessageMeta {
  options?: SelectionOption[];
  render?: RenderMeta;
}

interface Message {
  id?: number | string;
  role: "user" | "assistant";
  content: string;
  type?: string;
  meta?: MessageMeta;
}

interface ChatWindowProps {
  messages: Message[];
  isStreaming?: boolean;
  onSelectOption?: (messageId: number, option: SelectionOption) => void;
  selectionStatus?: Record<string, "pending" | "complete">;
}

function normalizeRenderPayload(payload: any): RenderMeta | null {
  if (!payload || typeof payload !== "object") return null;
  const renderId = payload.render_id || payload.id || payload.renderId;
  if (!renderId || typeof renderId !== "string") return null;

  return {
    render_id: renderId,
    state: payload.state || payload.status || null,
    template: payload.template || payload.meta?.template || payload.params?.template || null,
    gpu_type: payload.gpu_type || payload.params?.gpu_type || null,
    result_url: payload.result_url || null,
    error: payload.error || null,
  };
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim().replace(/^Tool executed:\s*/i, "");
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return null;
}

function parseRenderFromText(content: string): { render: RenderMeta; remainingText: string } | null {
  if (!content) return null;
  const trimmed = content.trim();
  if (!trimmed) return null;

  const jsonCandidate = extractJsonCandidate(trimmed);
  if (jsonCandidate) {
    try {
      const payload = JSON.parse(jsonCandidate);
      const render = normalizeRenderPayload(payload);
      if (render) {
        const remainingText = trimmed
          .replace(jsonCandidate, "")
          .replace(/^Tool executed:\s*/i, "")
          .trim();
        return { render, remainingText };
      }
    } catch {
      // Ignore JSON parse errors and fall back to text parsing
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasRenderBlock = lines.some((line) => line.toLowerCase().includes("render queued")) ||
    lines.some((line) => line.toLowerCase().startsWith("render:"));
  if (!hasRenderBlock) return null;

  const render: RenderMeta = { render_id: "" };
  let state: string | null = null;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("render queued")) {
      state = "queued";
    }

    const parts = line.split(":");
    if (parts.length < 2) continue;

    const key = parts[0].trim().toLowerCase();
    const value = parts.slice(1).join(":").trim();

    if (key === "render") {
      render.render_id = value;
    } else if (key === "gpu") {
      render.gpu_type = value;
    } else if (key === "template") {
      render.template = value;
    } else if (key === "result" || key === "result_url") {
      render.result_url = value;
    } else if (key === "status" || key === "state") {
      state = value;
    }
  }

  if (!render.render_id) return null;
  render.state = state || render.state || "queued";

  return { render, remainingText: "" };
}

function getRenderStatusStyles(status: string | null | undefined) {
  const normalized = (status || "queued").toLowerCase();
  if (normalized === "completed" || normalized === "success") {
    return "border-success/40 text-success bg-success/10";
  }
  if (normalized === "failed" || normalized === "error") {
    return "border-destructive/40 text-destructive bg-destructive/10";
  }
  if (normalized === "running") {
    return "border-primary/40 text-primary bg-primary/10";
  }
  return "border-border text-text-tertiary bg-surface-high/40";
}

function RenderCard({ render }: { render: RenderMeta }) {
  const status = (render.state || "queued").toLowerCase();
  const shortId = render.render_id.slice(0, 8);
  const hasMedia = Boolean(render.result_url);
  const isVideo = Boolean(render.result_url && /\.(mp4|webm|mov|avi)(\?|$)/i.test(render.result_url));

  return (
    <div className="rounded-2xl border border-border/60 bg-surface-low/70 p-4 space-y-3 shadow-md shadow-black/20">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-foreground">Render</div>
        <span className={cn("text-xs font-medium px-2 py-1 rounded-full border", getRenderStatusStyles(status))}>
          {status}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="text-text-tertiary">
          <span className="text-text-muted">Template</span>
          <div className="text-foreground text-sm">{render.template || "Unknown"}</div>
        </div>
        <div className="text-text-tertiary">
          <span className="text-text-muted">GPU</span>
          <div className="text-foreground text-sm">{render.gpu_type || "Auto"}</div>
        </div>
        <div className="text-text-tertiary">
          <span className="text-text-muted">Render ID</span>
          <div className="text-foreground text-sm font-mono">{shortId}</div>
        </div>
      </div>
      {hasMedia && render.result_url && (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-background">
          {isVideo ? (
            <video
              controls
              src={render.result_url}
              className="w-full max-h-[360px] object-contain bg-black"
            />
          ) : (
            <img src={render.result_url} alt="Render result" className="w-full object-contain" />
          )}
        </div>
      )}
      {render.error && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {render.error}
        </div>
      )}
      {render.result_url && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={render.result_url} target="_blank" rel="noreferrer">
              Open
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

export function ChatWindow({
  messages,
  isStreaming = false,
  onSelectOption,
  selectionStatus,
}: ChatWindowProps) {
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
        <div className="text-center max-w-lg px-6 animate-fade-up">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary/10">
            <Bot className="w-8 h-8 text-primary" strokeWidth={1.5} />
          </div>
          <h2 className="text-3xl font-semibold text-foreground mb-3 tracking-tight">
            Build, render, and explore with HyperCLI.
          </h2>
          <p className="text-base text-text-tertiary leading-relaxed">
            Ask for image generation, deployments, or rapid prototyping — all in one place.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 text-left">
            {[
              "Generate a minimal black line on white background",
              "Summarize my latest render jobs",
              "Spin up a GPU job and explain the cost",
              "Draft a product changelog from commit notes",
            ].map((prompt) => (
              <div key={prompt} className="rounded-xl border border-border/60 bg-surface-high/60 px-4 py-3 text-sm text-text-secondary">
                {prompt}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={scrollContainerRef}
      className="flex-1 flex-shrink overflow-y-auto overflow-x-hidden bg-background chat-scrollbar"
      style={{
        // Reserve space for fixed composer + keyboard offset
        paddingBottom: 'calc(64px + var(--keyboard-offset))',
      }}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="space-y-6">
          {messages.map((message, index) => {
            const selectionOptions = message.meta?.options || [];
            const isSelection = message.type === "selection" && selectionOptions.length > 0;
            const renderFromMeta = message.meta?.render;
            const parsedRender = renderFromMeta ? null : parseRenderFromText(message.content);
            const render = renderFromMeta || parsedRender?.render || null;
            const remainingText = parsedRender?.remainingText ?? message.content;
            const selectionId = typeof message.id === "number" ? message.id : Number(message.id);
            const hasSelectionId = Number.isFinite(selectionId);
            const selectionKey = hasSelectionId ? String(selectionId) : "";
            const selectionState = selectionKey ? selectionStatus?.[selectionKey] : undefined;
            const selectionDisabled = !onSelectOption || !hasSelectionId || selectionState !== undefined;

            return (
            <div
              key={message.id ?? index}
              className={cn(
                "flex gap-3 sm:gap-4 group animate-fade-up",
                message.role === "user" ? "flex-row-reverse" : ""
              )}
            >
              {/* Avatar */}
              <div
                className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors border border-border/60",
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
                    "rounded-2xl px-4 py-3 overflow-hidden break-words transition-colors shadow-sm",
                    message.role === "user"
                      ? "inline-block max-w-[85%] sm:max-w-[70%] bg-primary text-primary-foreground shadow-primary/20"
                      : "w-full max-w-[760px] bg-surface-low/60 border border-border/60"
                  )}
                >
                  {message.role === "user" ? (
                    <p className="text-[15px] whitespace-pre-wrap leading-relaxed break-words">
                      {message.content}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {render && <RenderCard render={render} />}
                      {isSelection ? (
                        <div className="space-y-3">
                          {message.content && (
                            <p className="text-[15px] text-foreground leading-relaxed">
                              {message.content}
                            </p>
                          )}
                          <div className="flex flex-col gap-2">
                            {selectionOptions.map((option) => (
                              <Button
                                key={option.id}
                                variant={option.id === "proceed" ? "default" : "outline"}
                                size="sm"
                                disabled={selectionDisabled}
                                className="justify-start rounded-xl"
                                onClick={() => {
                                  if (!selectionDisabled && onSelectOption) {
                                    onSelectOption(selectionId, option);
                                  }
                                }}
                              >
                                <div className="flex flex-col items-start">
                                  <span>{option.label}</span>
                                  {option.description && (
                                    <span className="text-xs text-text-tertiary">{option.description}</span>
                                  )}
                                </div>
                              </Button>
                            ))}
                          </div>
                        </div>
                      ) : remainingText ? (
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
                          dangerouslySetInnerHTML={renderMarkdown(remainingText)}
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
                  )}
                </div>
              </div>
            </div>
          )})}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}
