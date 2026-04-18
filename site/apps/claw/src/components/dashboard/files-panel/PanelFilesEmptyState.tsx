"use client";

import { motion } from "framer-motion";
import {
  FolderOpen,
  Search,
  WifiOff,
  AlertCircle,
  Upload,
  RefreshCw,
} from "lucide-react";

type EmptyStateKind = "no-files" | "no-results" | "error" | "offline" | "loading";

interface PanelFilesEmptyStateProps {
  kind: EmptyStateKind;
  searchQuery?: string;
  errorMessage?: string;
  onRetry?: () => void;
}

function PanelFilesSkeleton() {
  return (
    <div className="flex gap-4 px-4 py-6">
      {/* Tree skeleton */}
      <div className="w-48 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-surface-low animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
            <div className="h-3 rounded bg-surface-low animate-pulse flex-1" style={{ width: `${50 + Math.random() * 40}%`, animationDelay: `${i * 60}ms` }} />
          </div>
        ))}
      </div>
      {/* Preview skeleton */}
      <div className="flex-1 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-3 rounded bg-surface-low/60 animate-pulse" style={{ width: `${30 + Math.random() * 60}%`, animationDelay: `${i * 50}ms` }} />
        ))}
      </div>
    </div>
  );
}

export function PanelFilesEmptyState({ kind, searchQuery, errorMessage, onRetry }: PanelFilesEmptyStateProps) {
  if (kind === "loading") return <PanelFilesSkeleton />;

  const config: Record<Exclude<EmptyStateKind, "loading">, {
    icon: typeof FolderOpen;
    title: string;
    description: string;
    iconColor: string;
  }> = {
    "no-files": {
      icon: FolderOpen,
      title: "No files yet",
      description: "This workspace is empty — upload files or let your agent create them",
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
      iconColor: "text-[#d05f5f]",
    },
    offline: {
      icon: WifiOff,
      title: "Agent offline",
      description: "Start your agent to browse its workspace files",
      iconColor: "text-text-muted/40",
    },
  };

  const c = config[kind as Exclude<EmptyStateKind, "loading">];
  const Icon = c.icon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center py-10 px-6 gap-3"
    >
      <Icon className={`w-7 h-7 ${c.iconColor}`} />
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">{c.title}</p>
        <p className="text-[11px] text-text-muted leading-relaxed max-w-[280px]">{c.description}</p>
      </div>
      {kind === "no-files" && (
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted mt-1">
          <Upload className="w-3 h-3" />
          <span>Drag files here to upload</span>
        </div>
      )}
      {kind === "error" && onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-surface-low transition-colors text-[11px] font-medium text-foreground mt-1"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      )}
    </motion.div>
  );
}
