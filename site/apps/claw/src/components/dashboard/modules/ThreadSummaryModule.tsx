"use client";

import { MessageSquare, Hash } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_THREAD_SUMMARIES } from "../agentViewMockData";

interface ThreadSummaryModuleProps {
  variant: StyleVariant;
}

export function ThreadSummaryModule({ variant }: ThreadSummaryModuleProps) {
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
        <MessageSquare className="w-3.5 h-3.5" /> Thread Summary
      </div>
      {variant === "v1" ? (
        <div className="space-y-1.5">
          {MOCK_THREAD_SUMMARIES.map((t, idx) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06 }}
              className="rounded-lg border border-border px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground">{t.title}</span>
                {t.active && (
                  <motion.span
                    className="w-1.5 h-1.5 rounded-full bg-[#38D39F]"
                    animate={{ scale: [0.8, 1.3, 0.8] }}
                    transition={{ repeat: Infinity, duration: 1.2 }}
                  />
                )}
                <span className="text-[9px] text-text-muted ml-auto">{t.messages} msgs</span>
              </div>
              <div className="text-[10px] text-text-muted mt-0.5">{t.summary}</div>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="space-y-1">
          {MOCK_THREAD_SUMMARIES.map((t, idx) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-surface-low transition-colors"
            >
              <Hash className="w-3 h-3 text-text-muted shrink-0" />
              <span className="text-[10px] text-foreground truncate">{t.title}</span>
              <span className="text-[9px] text-text-muted truncate flex-1">— {t.summary}</span>
              {t.active && <span className="w-1.5 h-1.5 rounded-full bg-[#38D39F] shrink-0" />}
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="space-y-0.5">
          {MOCK_THREAD_SUMMARIES.map((t, idx) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: idx * 0.04 }}
              className="flex items-center gap-1.5 text-[10px] px-1 py-0.5"
            >
              <span className="text-text-muted">{idx + 1}.</span>
              <span className="text-foreground">{t.title}</span>
              {t.active && <span className="w-1.5 h-1.5 rounded-full bg-[#38D39F]" />}
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
