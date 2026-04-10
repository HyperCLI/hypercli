"use client";

import { FolderOpen, FileText } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_WORKSPACE_FILES } from "../agentViewMockData";
import { formatBytes } from "../agentViewUtils";

interface WorkspaceFilesModuleProps {
  variant: StyleVariant;
  files?: typeof MOCK_WORKSPACE_FILES | null;
}

export function WorkspaceFilesModule({ variant, files: filesProp }: WorkspaceFilesModuleProps) {
  const files = filesProp ?? MOCK_WORKSPACE_FILES;
  const isMock = !filesProp;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.36 }}
      className="relative rounded-lg border border-border p-3 space-y-2"
    >
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>}
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
        Workspace
      </div>
      {variant === "v1" ? (
        <div className="space-y-0.5">
          {files.map((f, idx) => (
            <motion.div
              key={f.name}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.12 + idx * 0.04 }}
              whileHover={{ x: 3 }}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-low transition-colors text-[10px]"
            >
              <motion.div whileHover={{ scale: 1.15 }}>
                {f.type === "directory" ? (
                  <FolderOpen className="w-3 h-3 text-[#f0c56c]" />
                ) : (
                  <FileText className="w-3 h-3 text-text-muted" />
                )}
              </motion.div>
              <span className="font-mono text-foreground">{f.name}</span>
              {f.size > 0 && (
                <span className="text-text-muted ml-auto">
                  {formatBytes(f.size)}
                </span>
              )}
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="flex flex-wrap gap-1">
          {files.map((f, idx) => (
            <motion.span
              key={f.name}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: idx * 0.04 }}
              whileHover={{ scale: 1.05 }}
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-mono ${f.type === "directory" ? "bg-[#f0c56c]/10 text-[#f0c56c]" : "bg-surface-low text-text-muted"}`}
            >
              {f.type === "directory" ? (
                <FolderOpen className="w-3 h-3" />
              ) : (
                <FileText className="w-3 h-3" />
              )}
              {f.name}
            </motion.span>
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-[10px] font-mono text-text-muted"
        >
          {files.filter((f) => f.type === "file").length} files
          ·{" "}
          {files.filter((f) => f.type === "directory").length}{" "}
          dirs
        </motion.div>
      )}
    </motion.div>
  );
}
