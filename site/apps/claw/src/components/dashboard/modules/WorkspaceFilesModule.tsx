"use client";

import { FolderOpen, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_WORKSPACE_FILES } from "../agentViewMockData";
import { FileRow } from "../files/FileRow";
import type { FileEntry } from "../files/types";

interface WorkspaceFilesModuleProps {
  variant: StyleVariant;
  files?: typeof MOCK_WORKSPACE_FILES | null;
  /** Open the full file browser route. */
  onOpenFiles?: () => void;
}

const PREVIEW_LIMIT = 5;

export function WorkspaceFilesModule({ variant: _variant, files: filesProp, onOpenFiles }: WorkspaceFilesModuleProps) {
  const files = filesProp ?? MOCK_WORKSPACE_FILES;
  const isMock = !filesProp;
  const fileCount = files.filter((f) => f.type === "file").length;
  const dirCount = files.filter((f) => f.type === "directory").length;

  // Promote directories first, then files (matches the files page tree)
  const sorted: FileEntry[] = [...files]
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((f) => ({ name: f.name, path: f.name, type: f.type, size: f.size }));

  const previewFiles = sorted.slice(0, PREVIEW_LIMIT);
  const overflowCount = Math.max(0, sorted.length - PREVIEW_LIMIT);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.36 }}
      className="relative rounded-lg border border-border p-3 space-y-2"
    >
      {isMock && (
        <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
          mock
        </span>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          Workspace Files
        </span>
        <span className="text-[10px] text-text-muted">
          {fileCount} {fileCount === 1 ? "file" : "files"}
          {dirCount > 0 && ` · ${dirCount} ${dirCount === 1 ? "dir" : "dirs"}`}
        </span>
      </div>

      {/* File list — matches files page (FileRow with extension-aware icons) */}
      {sorted.length === 0 ? (
        <div className="text-[10px] text-text-muted py-2 text-center">
          No files yet
        </div>
      ) : (
        <div className="-mx-1">
          {previewFiles.map((entry) => (
            <FileRow
              key={entry.path}
              entry={entry}
              onOpen={() => onOpenFiles?.()}
            />
          ))}
          {overflowCount > 0 && (
            <div className="text-[10px] text-text-muted px-2 py-1">+{overflowCount} more</div>
          )}
        </div>
      )}

      {/* Footer — open full file browser */}
      {onOpenFiles && (
        <button
          onClick={onOpenFiles}
          className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-md border border-border text-[11px] font-medium text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>Open file browser</span>
          <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </motion.div>
  );
}
