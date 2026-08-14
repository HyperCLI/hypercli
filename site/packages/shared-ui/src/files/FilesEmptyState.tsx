"use client";

import {
  Loader2,
  FolderOpen,
  Search,
  WifiOff,
  AlertCircle,
  Upload,
} from "lucide-react";
import { EmptyState } from "../components/patterns/feedback";
import { RecoveryState } from "../components/patterns/recovery";
import { formatFileTechnicalDetails } from "./error-details";

// ── Types ──

export type FilesEmptyStateKind = "no-files" | "no-results" | "error" | "offline" | "loading";

export interface FilesEmptyStateProps {
  kind: FilesEmptyStateKind;
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
          className="elevation-shadow-soft flex w-full max-w-[240px] items-center gap-3 rounded-xl border border-border bg-popover px-3 py-2.5 text-left"
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

  if (kind === "error") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <RecoveryState
          presentation="empty"
          icon={AlertCircle}
          title={title ?? "Try again to load this folder"}
          description={description ?? "Your workspace is unchanged. Check the connection, then try once more."}
          technicalDetails={formatFileTechnicalDetails(errorMessage)}
          detailsLabel="Technical details"
          primaryAction={onRetry ? { label: "Retry", onAction: onRetry } : undefined}
          headingLevel={3}
          className="min-h-72 max-w-none px-4 py-8"
        />
      </div>
    );
  }

  const config: Record<Exclude<FilesEmptyStateKind, "loading" | "error">, {
    icon: typeof FolderOpen;
    title: string;
    description: string;
  }> = {
    "no-files": {
      icon: FolderOpen,
      title: "No files yet",
      description: "This workspace is empty - upload files or let your agent create them",
    },
    "no-results": {
      icon: Search,
      title: `No files matching '${searchQuery ?? ""}'`,
      description: "Try a different search term or clear the filter",
    },
    offline: {
      icon: WifiOff,
      title: "Agent offline",
      description: "Start your agent to browse its workspace files",
    },
  };

  const c = config[kind];
  return (
    <EmptyState
      icon={c.icon}
      title={title ?? c.title}
      description={description ?? c.description}
      tone="neutral"
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
