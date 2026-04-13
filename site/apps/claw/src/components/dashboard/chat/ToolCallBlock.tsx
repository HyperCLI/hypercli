"use client";

import { Check, ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import { getToolCallClass } from "./bubbleStyles";
import { extractImagePath, encodePath, toolCallSummary } from "./helpers";
import { AuthImage } from "./AuthImage";
import type { ThemeVariant } from "./types";

interface ToolCallBlockProps {
  toolCall: { id?: string; name: string; args: string; result?: string };
  index: number;
  isOpen: boolean;
  onToggle: (index: number) => void;
  themeVariant: ThemeVariant;
  agentId?: string | null;
}

export function ToolCallBlock({ toolCall: tc, index, isOpen, onToggle, themeVariant, agentId }: ToolCallBlockProps) {
  const hasResult = Boolean(tc.result);
  const summary = toolCallSummary(tc);
  const imagePath = agentId ? extractImagePath(tc) : null;
  const imageUrl = imagePath && agentId
    ? `${API_BASE_URL}/deployments/${agentId}/files/${encodePath(imagePath)}`
    : null;

  return (
    <div className={getToolCallClass(themeVariant, hasResult)}>
      <button
        onClick={() => onToggle(index)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-surface-low transition-colors text-left"
      >
        {hasResult ? (
          <Check className="w-3 h-3 text-[#38D39F] shrink-0" />
        ) : (
          <Loader2 className="w-3 h-3 text-[#f0c56c] animate-spin shrink-0" />
        )}
        <Wrench className="w-3 h-3 text-[#f0c56c] shrink-0" />
        <span className="text-[#f0c56c] font-medium">{tc.name}</span>
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
        <pre className="px-2.5 py-1.5 text-text-muted whitespace-pre-wrap border-t border-border font-mono max-h-48 overflow-y-auto">
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
}
