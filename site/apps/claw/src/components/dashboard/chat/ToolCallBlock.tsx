"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";
import { getToolCallClass } from "./bubbleStyles";
import { extractImagePath, formatToolDetail, toolCallSummary } from "./helpers";
import { AuthImage } from "./AuthImage";
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
  const hasResult = Boolean(tc.result);
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const summary = toolCallSummary(tc);
  const imagePath = agentId ? extractImagePath(tc) : null;
  const imageFile = imagePath && agentId ? { agentId, path: imagePath } : null;
  const rawPending = !hasResult && isStreaming;
  const pending = rawPending && !pendingTimedOut;
  const argsDetail = formatToolDetail(tc.args, 280);
  const resultDetail = tc.result ? formatToolDetail(tc.result, 520) : null;

  useEffect(() => {
    if (!rawPending) return;
    const timer = window.setTimeout(() => setPendingTimedOut(true), TOOL_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [rawPending]);

  return (
    <div className={getToolCallClass(themeVariant, hasResult)}>
      <button
        onClick={() => onToggle(index)}
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
        {isOpen ? (
          <ChevronDown className="w-3 h-3 text-text-muted ml-auto shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-text-muted ml-auto shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="space-y-2 border-t border-border px-2.5 py-1.5 text-[11px] text-text-muted">
          {argsDetail.text && (
            <div>
              <p className="mb-1 font-medium text-text-secondary">Arguments</p>
              <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-mono">{argsDetail.text}</pre>
            </div>
          )}
          {resultDetail?.text && (
            <div>
              <p className="mb-1 font-medium text-text-secondary">Result</p>
              <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words font-mono">{resultDetail.text}</pre>
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
