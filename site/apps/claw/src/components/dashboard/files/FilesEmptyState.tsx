"use client";

import {
  FolderOpen,
  Search,
  WifiOff,
  AlertCircle,
  Upload,
} from "lucide-react";
import { EmptyState } from "@hypercli/shared-ui";
import { AgentGatewayLoadingVisual } from "@/components/dashboard/AgentGatewayLoadingVisual";

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
      <div className="flex h-full min-h-0 items-center justify-center py-4">
        <AgentGatewayLoadingVisual
          title={title ?? "Loading workspace"}
          detail={description ?? "Fetching workspace files."}
          animationClassName="h-[clamp(6.5rem,22vh,9rem)] w-[clamp(6.5rem,22vh,9rem)]"
        />
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
