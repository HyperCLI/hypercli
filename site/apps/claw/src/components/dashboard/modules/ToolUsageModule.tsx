"use client";

import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { TOOL_USAGE_STATS } from "../agentViewMockData";

interface ToolUsageModuleProps {
  variant: StyleVariant;
  stats?: typeof TOOL_USAGE_STATS | null;
}

export function ToolUsageModule({ variant, stats: statsProp }: ToolUsageModuleProps) {
  const stats = statsProp ?? TOOL_USAGE_STATS;
  const isMock = !statsProp;
  const maxCalls = Math.max(...stats.map((t) => t.calls));

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.14 }}
      className="relative rounded-lg border border-border p-3 space-y-2">
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>}
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Tool Usage</div>
      {variant === "v1" ? (
        // v1: Horizontal bars
        <div className="space-y-2">
          {stats.map((tool, idx) => {
            const ToolIcon = tool.icon;
            return (
              <motion.div key={tool.name} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + idx * 0.06 }}>
                <div className="flex items-center justify-between text-[10px] mb-0.5">
                  <span className="flex items-center gap-1.5 text-foreground">
                    <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ repeat: Infinity, duration: 4, delay: idx * 0.6 }}>
                      <ToolIcon className="w-3 h-3 text-[#38D39F]" />
                    </motion.div>
                    <span className="font-mono">{tool.name}</span>
                  </span>
                  <span className="text-text-muted font-mono">{tool.calls}</span>
                </div>
                <div className="h-1.5 bg-background rounded-full overflow-hidden">
                  <motion.div className="h-full bg-[#38D39F] rounded-full" initial={{ width: 0 }}
                    animate={{ width: `${(tool.calls / maxCalls) * 100}%` }}
                    transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 + idx * 0.08 }} />
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : variant === "v2" ? (
        // v2: Mini vertical bar chart
        <div className="flex items-end gap-2 h-16 px-1">
          {stats.map((tool, idx) => {
            const ToolIcon = tool.icon;
            const h = (tool.calls / maxCalls) * 100;
            return (
              <motion.div key={tool.name} className="flex-1 flex flex-col items-center gap-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.08 }}>
                <span className="text-[9px] font-mono text-text-muted">{tool.calls}</span>
                <motion.div className="w-full rounded-t bg-[#38D39F] min-h-[2px]" initial={{ height: 0 }} animate={{ height: `${h}%` }}
                  transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 + idx * 0.08 }} />
                <motion.div whileHover={{ scale: 1.2 }}><ToolIcon className="w-3 h-3 text-text-muted" /></motion.div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        // v3: Inline counts
        <div className="flex flex-wrap gap-1.5">
          {stats.map((tool, idx) => {
            const ToolIcon = tool.icon;
            return (
              <motion.div key={tool.name} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: idx * 0.04, type: "spring" }} whileHover={{ scale: 1.06 }}
                className="flex items-center gap-1 px-2 py-1 rounded-full bg-surface-low text-[10px]">
                <ToolIcon className="w-3 h-3 text-[#38D39F]" />
                <span className="font-mono text-foreground">{tool.name}</span>
                <span className="font-mono text-[#38D39F] font-medium">{tool.calls}</span>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
