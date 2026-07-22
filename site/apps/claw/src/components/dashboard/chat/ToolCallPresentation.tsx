"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

import { getToolCallStatusClass } from "./bubbleStyles";
import type { ToolCallView, ToolCallViewSection, ToolCallViewStatus } from "./helpers";
import { TooltipHint } from "@/components/ClawTooltip";

export function ToolCallStatusFrame({ status }: { status: ToolCallViewStatus }) {
  const label = status === "running" ? "Running" : status === "failed" ? "Failed" : status === "done" ? "Done" : "Called";

  return (
    <span className={`shrink-0 rounded-[4px] border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${getToolCallStatusClass(status)}`}>
      {label}
    </span>
  );
}

export function ToolCallDisclosureButton({
  view,
  isOpen,
  detailId,
  onClick,
}: {
  view: ToolCallView;
  isOpen: boolean;
  detailId: string;
  onClick: () => void;
}) {
  return (
    <TooltipHint label={view.title}>
      <button
        type="button"
        aria-controls={detailId}
        aria-expanded={isOpen}
        onClick={onClick}
        className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1 text-left transition-colors hover:bg-surface-low/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.35)] focus-visible:ring-inset"
      >
        <span className="min-w-0 max-w-[45%] truncate font-medium text-foreground">
          {view.displayName}
        </span>
        <ToolCallStatusFrame status={view.status} />
        {!isOpen && view.summary && (
          <span className="ml-1 min-w-0 flex-1 truncate text-text-muted">{view.summary}</span>
        )}
        {isOpen ? (
          <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-text-muted" />
        ) : (
          <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-text-muted" />
        )}
      </button>
    </TooltipHint>
  );
}

export function ToolCallSection({ section }: { section: ToolCallViewSection }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 font-medium text-text-secondary">{section.label}</p>
      {section.code ? (
        <pre className="max-h-36 max-w-full overflow-y-auto whitespace-pre-wrap break-words font-mono [overflow-wrap:anywhere]">{section.text}</pre>
      ) : (
        <div className="max-h-36 max-w-full overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
          {section.text}
        </div>
      )}
    </div>
  );
}

export function ToolCallSectionList({ sections }: { sections: Array<ToolCallViewSection | null> }) {
  const visibleSections = sections.filter((section): section is ToolCallViewSection => Boolean(section));
  if (visibleSections.length === 0) return null;

  return (
    <>
      {visibleSections.map((section, index) => (
        <ToolCallSection key={`${section.label}-${index}`} section={section} />
      ))}
    </>
  );
}
