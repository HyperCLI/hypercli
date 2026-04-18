"use client";

import { ChevronRight, Home } from "lucide-react";

interface PanelFileBreadcrumbsProps {
  path: string;
  onNavigate: (path: string) => void;
}

export function PanelFileBreadcrumbs({ path, onNavigate }: PanelFileBreadcrumbsProps) {
  const segments = path.split("/").filter(Boolean);

  return (
    <div className="flex items-center gap-0.5 text-[11px] min-w-0 overflow-x-auto scrollbar-none">
      <button
        onClick={() => onNavigate("")}
        className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
        title="Root"
      >
        <Home className="w-3 h-3" />
      </button>
      {segments.map((segment, idx) => {
        const segmentPath = segments.slice(0, idx + 1).join("/");
        const isLast = idx === segments.length - 1;
        return (
          <div key={segmentPath} className="flex items-center gap-0.5 min-w-0">
            <ChevronRight className="w-3 h-3 text-text-muted/40 flex-shrink-0" />
            {isLast ? (
              <span className="text-foreground font-medium truncate">{segment}</span>
            ) : (
              <button onClick={() => onNavigate(segmentPath)} className="text-text-muted hover:text-foreground transition-colors truncate max-w-[100px]">{segment}</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
