"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";
import { getToolCallClass } from "./bubbleStyles";
import { extractImagePath, formatToolDetail, toolCallSummary } from "./helpers";
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

  useEffect(() => {
    if (!rawPending) return;
    const timer = window.setTimeout(() => setPendingTimedOut(true), TOOL_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [rawPending]);

  return (
    <div className={getToolCallClass(themeVariant, hasResult)}>
      <button
        onClick={() => onToggle(index)}
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
        {isOpen ? (
          <ChevronDown className="w-3 h-3 text-text-muted ml-auto shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-text-muted ml-auto shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="space-y-2 border-t border-border px-2.5 py-1.5 text-[11px] text-text-muted">
          {argsDetail.text && (
            <div className="min-w-0">
              <p className="mb-1 font-medium text-text-secondary">Arguments</p>
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
              <p className="mb-1 font-medium text-text-secondary">Result</p>
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
