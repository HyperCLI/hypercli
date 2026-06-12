"use client";

import { useEffect, useId, useState } from "react";
import { getToolCallClass } from "./bubbleStyles";
import { buildToolCallView, extractImagePath } from "./helpers";
import { ToolCallDisclosureButton, ToolCallSectionList } from "./ToolCallPresentation";
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
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const rawPending = tc.result === undefined && isStreaming;
  const view = buildToolCallView(tc, { isStreaming, pendingTimedOut });
  const imagePath = agentId ? extractImagePath(tc) : null;
  const imageFile = imagePath && agentId ? { agentId, path: imagePath } : null;
  const directoryListing = tc.result !== undefined ? parseDirectoryVisualization(tc.result) : null;

  useEffect(() => {
    if (!rawPending) return;
    const timer = window.setTimeout(() => setPendingTimedOut(true), TOOL_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [rawPending]);

  return (
    <div className={getToolCallClass(themeVariant, view.status)}>
      <ToolCallDisclosureButton view={view} isOpen={isOpen} detailId={detailId} onClick={() => onToggle(index)} />
      {isOpen && (
        <div id={detailId} className="space-y-2 border-t border-border px-2.5 py-1.5 text-[11px] text-text-muted">
          <ToolCallSectionList sections={[view.argsSection]} />
          {directoryListing && (
            <DirectoryVisualization
              title="Directory result"
              rootPath={directoryListing.rootPath}
              entries={directoryListing.entries}
              truncated={directoryListing.truncated}
            />
          )}
          <ToolCallSectionList sections={[directoryListing ? null : view.resultSection]} />
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
