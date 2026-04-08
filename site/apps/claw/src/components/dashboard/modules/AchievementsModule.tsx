"use client";

import { Trophy } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { RECENT_ACHIEVEMENTS } from "../agentViewMockData";

interface AchievementsModuleProps {
  variant: StyleVariant;
}

export function AchievementsModule({ variant }: AchievementsModuleProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.22 }}
      className="relative rounded-lg border border-border p-3 space-y-2"
    >
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>
      <div className="flex items-center gap-1.5">
        <motion.div
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ repeat: Infinity, duration: 3 }}
        >
          <Trophy className="w-3.5 h-3.5 text-[#f0c56c]" />
        </motion.div>
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          This Week
        </span>
      </div>
      {variant === "v1" ? (
        // v1: Stats grid with animated counters
        <div className="grid grid-cols-3 gap-1.5">
          {RECENT_ACHIEVEMENTS.slice(0, 6).map((ach, idx) => {
            const AchIcon = ach.icon;
            return (
              <motion.div
                key={idx}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  delay: 0.15 + idx * 0.06,
                  type: "spring",
                  stiffness: 500,
                  damping: 22,
                }}
                className="flex flex-col items-center py-2 rounded-lg bg-surface-low"
              >
                <motion.div
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{
                    repeat: Infinity,
                    duration: 3,
                    delay: idx * 0.5,
                  }}
                >
                  <AchIcon className="w-4 h-4 text-[#38D39F] mb-1" />
                </motion.div>
                <motion.span
                  className="text-sm font-bold text-foreground"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 + idx * 0.08 }}
                >
                  {ach.value}
                </motion.span>
                <span className="text-[8px] text-text-muted text-center leading-tight mt-0.5">
                  {ach.label}
                </span>
              </motion.div>
            );
          })}
        </div>
      ) : variant === "v2" ? (
        // v2: Horizontal scroll numbers
        <div className="flex gap-3 overflow-x-auto pb-1">
          {RECENT_ACHIEVEMENTS.map((ach, idx) => {
            const AchIcon = ach.icon;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.06 }}
                className="flex items-center gap-1.5 shrink-0"
              >
                <AchIcon className="w-3 h-3 text-[#38D39F]" />
                <span className="text-xs font-bold text-foreground">
                  {ach.value}
                </span>
                <span className="text-[9px] text-text-muted">{ach.label}</span>
              </motion.div>
            );
          })}
        </div>
      ) : (
        // v3: Single line summary
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]"
        >
          {RECENT_ACHIEVEMENTS.map((ach, idx) => (
            <span key={idx} className="text-text-muted">
              <span className="text-foreground font-bold">{ach.value}</span>{" "}
              {ach.label}
              {idx < RECENT_ACHIEVEMENTS.length - 1 && (
                <span className="ml-2">&middot;</span>
              )}
            </span>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}
