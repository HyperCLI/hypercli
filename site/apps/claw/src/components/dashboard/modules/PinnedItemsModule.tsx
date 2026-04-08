"use client";

import { Pin } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_PINNED_ITEMS } from "../agentViewMockData";
import { relativeTime } from "../agentViewUtils";

interface PinnedItemsModuleProps {
  variant: StyleVariant;
}

export function PinnedItemsModule({ variant }: PinnedItemsModuleProps) {
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
        <Pin className="w-3.5 h-3.5" /> Pinned Items
      </div>
      {variant === "v1" ? (
        <div className="space-y-1.5">
          {MOCK_PINNED_ITEMS.map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06 }}
              className={`rounded-lg border px-3 py-2 border-l-2 ${item.type === "decision" ? "border-l-[#f0c56c]" : item.type === "message" ? "border-l-[#4A9EFF]" : "border-l-[#38D39F]"} border-border`}
            >
              <div className="flex items-center gap-1.5">
                <Pin className="w-3 h-3 text-text-muted shrink-0" />
                <span className="text-xs text-foreground">{item.text}</span>
              </div>
              <div className="text-[9px] text-text-muted mt-0.5">
                {item.author} · {relativeTime(item.ts)}
              </div>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="space-y-1">
          {MOCK_PINNED_ITEMS.map((item, idx) => {
            const prefix = item.type === "decision" ? "\u{1F536}" : item.type === "message" ? "\u{1F4AC}" : "\u{1F4CE}";
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-surface-low transition-colors"
              >
                <span className="text-[10px]">{prefix}</span>
                <span className="text-[10px] text-foreground flex-1 truncate">{item.text}</span>
                <span className="text-[9px] text-text-muted">{item.author}</span>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-0.5">
          {MOCK_PINNED_ITEMS.map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: idx * 0.04 }}
              className="text-[10px] text-text-muted px-1 py-0.5"
            >
              {idx + 1}. {item.text}
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
