"use client";

import { motion } from "framer-motion";
import { Bookmark } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_DECISION_LOG } from "../agentViewMockData";
import { relativeTime } from "../agentViewUtils";

interface DecisionLogModuleProps {
  variant: StyleVariant;
}

export function DecisionLogModule({ variant }: DecisionLogModuleProps) {
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
        <Bookmark className="w-3.5 h-3.5" /> Decision Log
      </div>
      {variant === "v1" ? (
        <div className="space-y-1.5">
          {MOCK_DECISION_LOG.map((d, idx) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06 }}
              className="rounded-lg border border-border px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-medium ${d.status === "superseded" ? "line-through text-text-muted" : "text-foreground"}`}
                >
                  {d.decision}
                </span>
                <span
                  className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${d.status === "active" ? "bg-[#38D39F]/10 text-[#38D39F]" : "bg-surface-high text-text-muted"}`}
                >
                  {d.status}
                </span>
              </div>
              <div className="text-[10px] text-text-muted mt-0.5">
                {d.rationale}
              </div>
              <div className="text-[9px] text-text-muted mt-0.5">
                {d.decidedBy} &middot; {relativeTime(d.ts)}
              </div>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="space-y-1">
          {MOCK_DECISION_LOG.map((d, idx) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="flex items-start gap-2 px-2 py-1 rounded-lg hover:bg-surface-low transition-colors"
            >
              <Bookmark className="w-3 h-3 text-text-muted shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <span
                  className={`text-[10px] ${d.status === "superseded" ? "line-through text-text-muted" : "text-foreground"}`}
                >
                  {d.decision}
                </span>
                <span className="text-[9px] text-text-muted ml-1">
                  &mdash; {d.rationale}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="space-y-0.5">
          {MOCK_DECISION_LOG.map((d, idx) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: idx * 0.04 }}
              className="text-[10px] text-text-muted px-1 py-0.5"
            >
              {idx + 1}.{" "}
              <span className={d.status === "superseded" ? "line-through" : ""}>
                {d.decision}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
