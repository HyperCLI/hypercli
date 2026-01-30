"use client";

import { useRef, useEffect, useState } from "react";
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
  render_type?: string | null;
  width?: number | null;
  height?: number | null;
  prompt?: string | null;
  model?: string | null;
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
  meta?: MessageMeta | null;
  status?: string;
  error?: string | null;
}

interface ChatWindowProps {
  messages: Message[];
  isStreaming?: boolean;
  onSelectOption?: (messageId: number, option: SelectionOption) => void;
  selectionStatus?: Record<string, "pending" | "complete">;
  onSuggestedPromptClick?: (prompt: string) => void;
  onCancelRender?: (renderId: string) => void;
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
    render_type: payload.render_type || payload.type || null,
    width: payload.width || payload.params?.width || null,
    height: payload.height || payload.params?.height || null,
    prompt: payload.prompt || payload.params?.prompt || null,
    model: payload.model || null,
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

// Export for use in parent components
export { parseRenderFromText };

function getRenderStatusStyles(status: string | null | undefined) {
  const normalized = (status || "queued").toLowerCase();
  if (normalized === "completed" || normalized === "success") {
    return "border-success/40 text-success bg-success/10";
  }
  if (normalized === "failed" || normalized === "error") {
    return "border-destructive/40 text-destructive bg-destructive/10";
  }
  if (normalized === "running" || normalized === "processing") {
    return "border-primary/40 text-primary bg-primary/10";
  }
  if (normalized === "pending" || normalized === "queued") {
    return "border-yellow-500/40 text-yellow-500 bg-yellow-500/10";
  }
  return "border-border text-text-tertiary bg-surface-high/40";
}

function LoadingSpinner() {
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-4 h-4">
        <div className="absolute inset-0 border-2 border-primary/20 rounded-full"></div>
        <div className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
      <span className="text-xs text-text-tertiary">Working on it...</span>
    </div>
  );
}

function RenderCard({ render, onCancel }: { render: RenderMeta; onCancel?: (renderId: string) => void }) {
  const status = (render.state || "queued").toLowerCase();
  const shortId = render.render_id.slice(0, 8);
  const hasMedia = Boolean(render.result_url);
  const isVideo = Boolean(render.result_url && /\.(mp4|webm|mov|avi)(\?|$)/i.test(render.result_url));
  const isLoading = status === "queued" || status === "pending" || status === "running" || status === "processing" || !render.state;
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isCancelling, setIsCancelling] = useState(false);
  
  // Track elapsed time for loading renders
  useEffect(() => {
    if (!isLoading) return;
    
    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isLoading]);

  // Format elapsed time as mm:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCancel = async () => {
    if (isCancelling || !onCancel) return;
    setIsCancelling(true);
    onCancel(render.render_id);
  };
  
  const getProgressMessageWithTime = (): string => {
    const normalized = status;
    const templateName = render.template || "image";
    
    if (normalized === "queued" || normalized === "pending") {
      if (elapsedTime < 3) return "Initializing render queue...";
      if (elapsedTime < 10) return "Allocating GPU resources...";
      return `Waiting in queue...`;
    }
    
    if (normalized === "running" || normalized === "processing") {
      if (elapsedTime < 5) return `Starting ${templateName} generation...`;
      if (elapsedTime < 15) return `Rendering ${templateName}...`;
      if (elapsedTime < 30) return `Processing ${templateName}... Almost there`;
      return `Still working on ${templateName}...`;
    }
    
    if (normalized === "completed" || normalized === "success") {
      return "Render complete";
    }
    if (normalized === "failed" || normalized === "error") {
      return "Render failed";
    }
    return "Processing...";
  };
  
  const progressMessage = getProgressMessageWithTime();
  const isComplete = status === "success" || status === "completed" || status === "complete";
  const isFailed = status === "failed" || status === "error";
  const isCancelled = status === "cancelled";

  return (
    <div className={cn(
      "rounded-xl border border-border/60 bg-surface-low/70 p-3 space-y-2 shadow-md shadow-black/20 transition-all",
      isLoading && "ring-2 ring-primary/20 animate-pulse"
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-foreground">Render</div>
          {isLoading && (
            <span className="text-xs font-mono text-text-muted bg-surface-high/60 px-1.5 py-0.5 rounded">
              {formatTime(elapsedTime)}
            </span>
          )}
        </div>
        <span className={cn("text-xs font-medium px-2 py-1 rounded-full border", getRenderStatusStyles(status))}>
          {isCancelling ? "cancelling" : status}
        </span>
      </div>
      
      {/* Progress message with loading indicator */}
      {isLoading && (
        <div className="flex items-center justify-between gap-2 bg-primary/5 border border-primary/20 rounded-lg px-2.5 py-1.5">
          <span className="text-xs text-foreground font-medium">{progressMessage}</span>
          <LoadingSpinner />
        </div>
      )}
      
      {/* Success message */}
      {isComplete && (
        <div className="flex items-center gap-2 bg-success/5 border border-success/20 rounded-lg px-2.5 py-1.5">
          <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-xs text-success font-medium">Render complete!</span>
        </div>
      )}

      {/* Cancelled message */}
      {isCancelled && (
        <div className="flex items-center gap-2 bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-2.5 py-1.5">
          <svg className="w-4 h-4 text-yellow-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="text-xs text-yellow-500 font-medium">Cancelled</span>
        </div>
      )}
      
      {/* Error message */}
      {isFailed && !render.error && (
        <div className="flex items-center gap-2 bg-destructive/5 border border-destructive/20 rounded-lg px-2.5 py-1.5">
          <svg className="w-4 h-4 text-destructive flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="text-xs text-destructive font-medium">Failed</span>
        </div>
      )}
      
      {/* Render parameters - inline for loading, grid for complete */}
      {isLoading ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          {render.model && <span>{render.model}</span>}
          {(render.width || render.height) && <span>{render.width || 1024}×{render.height || 1024}</span>}
          <span className="capitalize">{render.render_type || render.template || "Image"}</span>
          <span className="font-mono text-text-tertiary">{shortId}</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {render.model && (
            <div className="text-text-tertiary">
              <span className="text-text-muted">Model</span>
              <div className="text-foreground text-xs font-medium">{render.model}</div>
            </div>
          )}
          {(render.width || render.height) && (
            <div className="text-text-tertiary">
              <span className="text-text-muted">Size</span>
              <div className="text-foreground text-xs">{render.width || 1024}×{render.height || 1024}</div>
            </div>
          )}
          <div className="text-text-tertiary">
            <span className="text-text-muted">Type</span>
            <div className="text-foreground text-xs capitalize">{render.render_type || render.template || "Image"}</div>
          </div>
          <div className="text-text-tertiary">
            <span className="text-text-muted">Render ID</span>
            <div className="text-foreground text-xs font-mono">{shortId}</div>
          </div>
        </div>
      )}
      
      {/* Show prompt if available - only when not loading to save space */}
      {render.prompt && !isLoading && (
        <div className="text-xs">
          <span className="text-text-muted">Prompt</span>
          <div className="text-text-secondary text-xs mt-0.5 line-clamp-2">{render.prompt}</div>
        </div>
      )}
      
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
      
      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {render.result_url && (
          <Button variant="outline" size="sm" asChild>
            <a href={render.result_url} target="_blank" rel="noreferrer">
              Open
            </a>
          </Button>
        )}
        {isLoading && onCancel && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleCancel}
            disabled={isCancelling}
            className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
          >
            {isCancelling ? "Cancelling..." : "Cancel"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ChatWindow({
  messages,
  isStreaming = false,
  onSelectOption,
  selectionStatus,
  onSuggestedPromptClick,
  onCancelRender,
}: ChatWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const renderMarkdown = (content: string) => {
    // Remove empty code blocks before rendering
    const cleanedContent = content.replace(/```\s*```/g, '').replace(/`\s*`/g, '');
    const html = marked.parse(cleanedContent) as string;
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
              <button
                key={prompt}
                onClick={() => onSuggestedPromptClick?.(prompt)}
                className="rounded-xl border border-border/60 bg-surface-high/60 px-4 py-3 text-sm text-text-secondary hover:bg-surface-high hover:border-border transition-colors cursor-pointer text-left"
              >
                {prompt}
              </button>
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
            
            // Determine if this is an error message
            const isError = message.content?.startsWith("__ERROR__") || message.status === "error" || !!message.error;
            // Check if content is just a placeholder (dots, ellipsis, etc.)
            const trimmedContent = remainingText?.trim() || "";
            const isPlaceholderText = /^\.{1,3}$|^…$/.test(trimmedContent);
            // Determine if we should show loading (empty assistant message with no render, or placeholder text)
            const isLoading = message.role === "assistant" && (!trimmedContent || isPlaceholderText) && !render && !isSelection && !isError;
            // Only show remaining text if it's actual content (not empty, not placeholder, not error)
            const hasDisplayableText = trimmedContent && !isPlaceholderText && !isError;

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
                      {render && <RenderCard render={render} onCancel={onCancelRender} />}
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
                      ) : isError ? (
                        // Error message display - CHECK FIRST before any content rendering
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
                            <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-red-400 mb-1">Something went wrong</p>
                            <p className="text-sm text-red-300/80 leading-relaxed">
                              {message.error || message.content?.replace("__ERROR__", "") || "An unexpected error occurred"}
                            </p>
                            <p className="text-xs text-text-tertiary mt-2">
                              Try selecting a different model or check your balance
                            </p>
                          </div>
                        </div>
                      ) : isLoading ? (
                        // Loading indicator - shown when assistant message has no content yet
                        <div className="flex items-center gap-3 py-1">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          </div>
                          <span className="text-sm text-text-tertiary">Thinking...</span>
                        </div>
                      ) : hasDisplayableText ? (
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
                      ) : !render ? (
                        // Fallback - show empty state if no render card either
                        <div className="flex items-center gap-3 py-1">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          </div>
                          <span className="text-sm text-text-tertiary">Processing...</span>
                        </div>
                      ) : null}
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
