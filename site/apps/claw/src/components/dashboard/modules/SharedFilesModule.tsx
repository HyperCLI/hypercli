"use client";

import { FileText } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_SHARED_FILES } from "../agentViewMockData";
import { formatBytes, relativeTime } from "../agentViewUtils";

interface SharedFilesModuleProps {
  variant: StyleVariant;
}

export function SharedFilesModule({ variant }: SharedFilesModuleProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.26 }}
      className="relative rounded-lg border border-border p-3 space-y-2"
    >
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" /> Shared Files
      </div>
      {variant === "v1" ? (
        <div className="space-y-1">
          {MOCK_SHARED_FILES.map((f, idx) => (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.06 }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-low transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <span className="text-[10px] text-foreground flex-1 truncate">{f.name}</span>
              <span className="text-[9px] text-text-muted">{f.uploader}</span>
              <span className="text-[9px] text-text-muted">{formatBytes(f.size)}</span>
              <span className="text-[9px] text-text-muted">{relativeTime(f.ts)}</span>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="grid grid-cols-3 gap-1.5">
          {MOCK_SHARED_FILES.map((f, idx) => (
            <motion.div
              key={f.id}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: idx * 0.06, type: "spring" }}
              className="flex flex-col items-center gap-1 py-2 rounded-lg border border-border"
            >
              <FileText className="w-4 h-4 text-text-muted" />
              <span className="text-[9px] text-foreground text-center truncate w-full px-1">{f.name}</span>
              <span className="text-[8px] text-text-muted">{formatBytes(f.size)}</span>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {MOCK_SHARED_FILES.map((f, idx) => (
            <motion.span
              key={f.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: idx * 0.04 }}
              className="text-[10px] px-2 py-0.5 rounded-full bg-surface-high text-foreground"
            >
              {f.name}
            </motion.span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
