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
import { AgentLifecycleSteps } from "@/components/dashboard/AgentLifecycleSteps";

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

// ── Skeleton loader ──

const FILES_SKELETON_ROWS = [
  { primary: 74, secondary: 42 },
  { primary: 58, secondary: 36 },
  { primary: 86, secondary: 48 },
  { primary: 66, secondary: 32 },
  { primary: 79, secondary: 44 },
  { primary: 54, secondary: 38 },
];

function FilesSkeleton() {
  return (
    <div className="space-y-2 px-1">
      {FILES_SKELETON_ROWS.map((row, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-2">
          <div className="w-5 h-5 rounded bg-surface-low animate-pulse" />
          <div className="flex-1 space-y-1">
            <div
              className="h-3 rounded bg-surface-low animate-pulse"
              style={{ width: `${row.primary}%`, animationDelay: `${i * 80}ms` }}
            />
            <div
              className="h-2 rounded bg-surface-low/60 animate-pulse"
              style={{ width: `${row.secondary}%`, animationDelay: `${i * 80 + 40}ms` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Component ──

export function FilesEmptyState({ kind, searchQuery, errorMessage, title, description, onRetry }: FilesEmptyStateProps) {
  if (kind === "loading") {
    return (
      <div className="space-y-5 py-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="relative h-16 w-16" aria-hidden="true">
            <motion.span
              className="absolute inset-0 rounded-full opacity-25"
              animate={{ boxShadow: ["0 0 18px #38D39F", "0 0 34px #38D39F", "0 0 18px #38D39F"], scale: [0.96, 1.04, 0.96] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.span
              className="absolute inset-1 rounded-full border-2 border-transparent border-t-[#38D39F] border-r-[#7ef7c9]"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
            />
            <motion.span
              className="absolute inset-4 rounded-full border border-transparent border-b-[#7ef7c9] border-l-[#38D39F]"
              animate={{ rotate: -360 }}
              transition={{ duration: 1.15, repeat: Infinity, ease: "linear" }}
            />
            <motion.span
              className="absolute inset-[1.35rem] rounded-full"
              style={{ background: "radial-gradient(circle, #ffffff 0%, #38D39F 48%, #7ef7c9 100%)", boxShadow: "0 0 12px #38D39F" }}
              animate={{ scale: [0.82, 1.12, 0.82], opacity: [0.72, 1, 0.72] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{title ?? "Loading workspace"}</p>
            <p className="text-[11px] text-text-muted">{description ?? "Fetching files from the agent gateway."}</p>
          </div>
          <AgentLifecycleSteps stage="complete" />
        </div>
        <FilesSkeleton />
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
        <p className="text-sm font-medium text-foreground">{title ?? c.title}</p>
        <p className="text-[11px] text-text-muted leading-relaxed max-w-[220px]">
          {description ?? c.description}
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
