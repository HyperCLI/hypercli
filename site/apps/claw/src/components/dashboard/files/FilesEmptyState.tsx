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

// ── Types ──

type EmptyStateKind = "no-files" | "no-results" | "error" | "offline" | "loading";

interface FilesEmptyStateProps {
  kind: EmptyStateKind;
  searchQuery?: string;
  errorMessage?: string;
  onRetry?: () => void;
}

// ── Skeleton loader ──

function FilesSkeleton() {
  return (
    <div className="space-y-2 px-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-2">
          <div className="w-5 h-5 rounded bg-surface-low animate-pulse" />
          <div className="flex-1 space-y-1">
            <div
              className="h-3 rounded bg-surface-low animate-pulse"
              style={{ width: `${50 + Math.random() * 40}%`, animationDelay: `${i * 80}ms` }}
            />
            <div
              className="h-2 rounded bg-surface-low/60 animate-pulse"
              style={{ width: `${30 + Math.random() * 20}%`, animationDelay: `${i * 80 + 40}ms` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Component ──

export function FilesEmptyState({ kind, searchQuery, errorMessage, onRetry }: FilesEmptyStateProps) {
  if (kind === "loading") {
    return <FilesSkeleton />;
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center py-12 px-6 gap-3"
    >
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
      >
        <Icon className={`w-8 h-8 ${c.iconColor}`} />
      </motion.div>

      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">{c.title}</p>
        <p className="text-[11px] text-text-muted leading-relaxed max-w-[220px]">
          {c.description}
        </p>
      </div>

      {kind === "no-files" && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex items-center gap-1.5 text-[11px] text-text-muted mt-1"
        >
          <Upload className="w-3 h-3" />
          <span>Drag files here to upload</span>
        </motion.div>
      )}

      {(kind === "error") && onRetry && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-surface-low transition-colors text-[11px] font-medium text-foreground mt-1"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </motion.button>
      )}
    </motion.div>
  );
}
