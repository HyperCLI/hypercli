"use client";

import { motion } from "framer-motion";
import { History, GitCommit } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_AGENT_CHANGELOG } from "../agentViewMockData";
import { relativeTime } from "../agentViewUtils";

interface AgentChangelogModuleProps {
  variant: StyleVariant;
}

export function AgentChangelogModule({ variant }: AgentChangelogModuleProps) {
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
        <History className="w-3.5 h-3.5" /> Agent Changelog
      </div>
      {variant === "v1" ? (
        <div className="space-y-1">
          {MOCK_AGENT_CHANGELOG.map((entry, idx) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.06 }}
              className="flex items-start gap-2 px-2 py-1.5"
            >
              <div className="mt-1 w-2 h-2 rounded-full bg-text-muted/40 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-[10px] text-foreground">
                  {entry.action}
                </span>
                <span className="text-[9px] text-text-muted ml-1">
                  by {entry.by}
                </span>
              </div>
              <span className="text-[9px] text-text-muted whitespace-nowrap">
                {relativeTime(entry.ts)}
              </span>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="space-y-1">
          {MOCK_AGENT_CHANGELOG.map((entry, idx) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-surface-low transition-colors"
            >
              <GitCommit className="w-3 h-3 text-text-muted shrink-0" />
              <span className="text-[10px] text-foreground flex-1 truncate">
                {entry.action}
              </span>
              <span className="text-[9px] text-text-muted">
                {relativeTime(entry.ts)}
              </span>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="space-y-0.5">
          {MOCK_AGENT_CHANGELOG.map((entry, idx) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: idx * 0.04 }}
              className="text-[10px] text-text-muted px-1 py-0.5 truncate"
            >
              {entry.action} &mdash; {entry.by} &middot;{" "}
              {relativeTime(entry.ts)}
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
