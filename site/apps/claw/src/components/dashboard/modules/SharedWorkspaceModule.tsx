"use client";

import { Layers, BarChart3, CheckSquare, FileText } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_WORKSPACE_OUTPUTS } from "../agentViewMockData";
import { relativeTime } from "../agentViewUtils";

interface SharedWorkspaceModuleProps {
  variant: StyleVariant;
}

export function SharedWorkspaceModule({ variant }: SharedWorkspaceModuleProps) {
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
        <Layers className="w-3.5 h-3.5" /> Workspace
      </div>
      {variant === "v1" ? (
        <div className="space-y-1.5">
          {MOCK_WORKSPACE_OUTPUTS.map((item, idx) => {
            const TypeIcon = item.type === "table" ? BarChart3 : item.type === "checklist" ? CheckSquare : FileText;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.06 }}
                className="rounded-lg border border-border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <TypeIcon className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  <span className="text-xs text-foreground flex-1">{item.title}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-high text-text-muted">
                    {item.type}
                  </span>
                </div>
                <div className="text-[9px] text-text-muted mt-0.5">
                  {item.rows > 0 ? `${item.rows} rows · ` : ""}
                  {item.updatedBy} · {relativeTime(item.ts)}
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : variant === "v2" ? (
        <div className="grid grid-cols-3 gap-1.5">
          {MOCK_WORKSPACE_OUTPUTS.map((item, idx) => {
            const TypeIcon = item.type === "table" ? BarChart3 : item.type === "checklist" ? CheckSquare : FileText;
            return (
              <motion.div
                key={item.id}
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: idx * 0.06, type: "spring" }}
                className="flex flex-col items-center gap-1 py-2 rounded-lg border border-border"
              >
                <TypeIcon className="w-4 h-4 text-text-muted" />
                <span className="text-[9px] text-foreground text-center truncate w-full px-1">
                  {item.title}
                </span>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="text-[10px] text-text-muted">
          {MOCK_WORKSPACE_OUTPUTS.length} items · last updated{" "}
          {relativeTime(Math.min(...MOCK_WORKSPACE_OUTPUTS.map((i) => i.ts)))}
        </div>
      )}
    </motion.div>
  );
}
