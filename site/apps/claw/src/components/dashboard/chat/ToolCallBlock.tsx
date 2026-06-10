"use client";

import { useEffect, useId, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";
import { getToolCallClass, getToolCallStatusClass } from "./bubbleStyles";
import { extractImagePath, formatToolDetail, toolCallArgsLabel, toolCallResultLabel, toolCallSummary } from "./helpers";
import { AuthImage } from "./AuthImage";
import { DirectoryVisualization, parseDirectoryVisualization } from "./DirectoryVisualization";
import type { ThemeVariant } from "./types";

interface ToolCallBlockProps {
  toolCall: { id?: string; name: string; args: string; result?: string };
  index: number;
  isOpen: boolean;
  onToggle: (index: number) => void;
  themeVariant: ThemeVariant;
  agentId?: string | null;
  isStreaming?: boolean;
}

const TOOL_PENDING_TIMEOUT_MS = 45_000;

export function ToolCallBlock({ toolCall: tc, index, isOpen, onToggle, themeVariant, agentId, isStreaming = false }: ToolCallBlockProps) {
  const detailId = useId();
  const hasResult = tc.result !== undefined;
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const summary = toolCallSummary(tc);
  const imagePath = agentId ? extractImagePath(tc) : null;
  const imageFile = imagePath && agentId ? { agentId, path: imagePath } : null;
  const rawPending = !hasResult && isStreaming;
  const pending = rawPending && !pendingTimedOut;
  const argsDetail = formatToolDetail(tc.args, 280);
  const resultDetail = tc.result !== undefined ? formatToolDetail(tc.result, 520) : null;
  const directoryListing = tc.result !== undefined ? parseDirectoryVisualization(tc.result) : null;
  const argsLabel = toolCallArgsLabel(tc);
  const resultLabel = toolCallResultLabel(tc);
  const statusClass = getToolCallStatusClass(hasResult, pending);

  useEffect(() => {
    if (!rawPending) return;
    const timer = window.setTimeout(() => setPendingTimedOut(true), TOOL_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [rawPending]);

  return (
    <div className={getToolCallClass(themeVariant, hasResult, pending)}>
      <button
        type="button"
        aria-controls={detailId}
        aria-expanded={isOpen}
        onClick={() => onToggle(index)}
        className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1 text-left transition-colors hover:bg-surface-low/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.35)] focus-visible:ring-inset"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--selection-accent)]" />
        ) : hasResult ? (
          <Check className="h-3 w-3 shrink-0 text-[var(--selection-accent)] opacity-75" />
        ) : (
          <Wrench className="h-3 w-3 shrink-0 text-text-muted" />
        )}
        <span className="min-w-0 max-w-[45%] truncate font-medium text-foreground">{tc.name}</span>
        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${statusClass}`}>
          {pending ? "Running" : hasResult ? "Done" : "Called"}
        </span>
        {!isOpen && summary && (
          <span className="text-text-muted truncate ml-1 flex-1 min-w-0">{summary}</span>
        )}
        {isOpen ? (
          <ChevronDown className="w-3 h-3 text-text-muted ml-auto shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-text-muted ml-auto shrink-0" />
        )}
      </button>
      {isOpen && (
        <div id={detailId} className="space-y-2 border-t border-border px-2.5 py-1.5 text-[11px] text-text-muted">
          {argsDetail.text && (
            <div className="min-w-0">
              <p className="mb-1 font-medium text-text-secondary">{argsLabel}</p>
              <pre className="max-h-28 max-w-full overflow-y-auto whitespace-pre-wrap break-words font-mono [overflow-wrap:anywhere]">{argsDetail.text}</pre>
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
          {resultDetail?.text && !directoryListing && (
            <div className="min-w-0">
              <p className="mb-1 font-medium text-text-secondary">{resultLabel}</p>
              <pre className="max-h-36 max-w-full overflow-y-auto whitespace-pre-wrap break-words font-mono [overflow-wrap:anywhere]">{resultDetail.text}</pre>
            </div>
          )}
        </div>
      )}
      {imageFile && (
        <div className="max-w-full border-t border-border px-2.5 py-2">
          <AuthImage
            file={imageFile}
            alt={imagePath?.split("/").pop() || "generated image"}
            className="h-auto max-h-[320px] max-w-full rounded-md object-contain sm:max-w-[320px]"
          />
        </div>
      )}
    </div>
  );
}
