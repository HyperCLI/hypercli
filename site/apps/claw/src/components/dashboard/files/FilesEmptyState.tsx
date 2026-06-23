"use client";

import {
  Loader2,
  FolderOpen,
  Search,
  WifiOff,
  AlertCircle,
  Upload,
} from "lucide-react";
import { EmptyState } from "@hypercli/shared-ui";

// ── Types ──

type EmptyStateKind = "no-files" | "no-results" | "error" | "offline" | "loading";

interface FilesEmptyStateProps {
  kind: EmptyStateKind;
  searchQuery?: string;
  errorMessage?: string;
  title?: string;
  description?: string;
  onRetry?: () => void;
}

// ── Component ──

export function FilesEmptyState({ kind, searchQuery, errorMessage, title, description, onRetry }: FilesEmptyStateProps) {
  if (kind === "loading") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-4 py-4">
        <div
          role="status"
          aria-live="polite"
          aria-label={`${title ?? "Loading files"} ${description ?? "Fetching folders and files."}`}
          className="flex w-full max-w-[240px] items-center gap-3 rounded-xl border border-border bg-popover/80 px-3 py-2.5 text-left shadow-[0_14px_36px_color-mix(in_srgb,var(--foreground)_10%,transparent)]"
        >
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface-low text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">{title ?? "Loading files"}</p>
            <p className="truncate text-[11px] text-text-muted">{description ?? "Fetching folders and files."}</p>
          </div>
        </div>
      </div>
    );
  }

  const config: Record<Exclude<EmptyStateKind, "loading">, {
    icon: typeof FolderOpen;
    title: string;
    description: string;
    iconColor: string;
  }> = {
    "no-files": {
      icon: FolderOpen,
      title: "No files yet",
      description: "This workspace is empty - upload files or let your agent create them",
      iconColor: "text-text-muted/40",
    },
    "no-results": {
      icon: Search,
      title: `No files matching '${searchQuery ?? ""}'`,
      description: "Try a different search term or clear the filter",
      iconColor: "text-text-muted/40",
    },
    error: {
      icon: AlertCircle,
      title: "Failed to load files",
      description: errorMessage ?? "Something went wrong while loading workspace files",
      iconColor: "text-destructive",
    },
    offline: {
      icon: WifiOff,
      title: "Agent offline",
      description: "Start your agent to browse its workspace files",
      iconColor: "text-text-muted/40",
    },
  };

  const c = config[kind as Exclude<EmptyStateKind, "loading">];
  return (
    <EmptyState
      icon={c.icon}
      title={title ?? c.title}
      description={description ?? c.description}
      tone={kind === "error" ? "danger" : "neutral"}
      actionLabel={kind === "error" && onRetry ? "Retry" : undefined}
      onAction={kind === "error" ? onRetry : undefined}
      footnote={
        kind === "no-files" ? (
          <span className="inline-flex items-center gap-1.5">
            <Upload className="h-3 w-3" />
            Drag files here to upload
          </span>
        ) : undefined
      }
    />
  );
}
