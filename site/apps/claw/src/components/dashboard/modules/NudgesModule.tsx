"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_NUDGES } from "../agentViewMockData";

interface NudgesModuleProps {
  variant: StyleVariant;
  nudges?: typeof MOCK_NUDGES | null;
}

export function NudgesModule({ variant, nudges: nudgesProp }: NudgesModuleProps) {
  const nudges = nudgesProp ?? MOCK_NUDGES;
  const isMock = !nudgesProp;
  const [dismissedNudges, setDismissedNudges] = useState<Set<string>>(new Set());

  const visibleNudges = nudges.filter((n) => !dismissedNudges.has(n.id));

  if (visibleNudges.length === 0) return null;

  return (
    <div className="relative space-y-1.5 rounded-lg border border-border p-3">
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>}
      {visibleNudges.map((nudge, idx) => {
        const NudgeIcon = nudge.icon;
        if (variant === "v1") {
          return (
            <motion.div key={nudge.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }}
              className="rounded-lg bg-surface-low border border-border px-3 py-2 flex items-start gap-2">
              <motion.div animate={{ y: [0, -2, 0] }} transition={{ repeat: Infinity, duration: 2, delay: idx * 0.3 }}>
                <NudgeIcon className="w-3.5 h-3.5 text-[#38D39F] mt-0.5 shrink-0" />
              </motion.div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-foreground">{nudge.text}</div>
                <button className="text-[10px] text-[#38D39F] mt-0.5 hover:underline">{nudge.action} →</button>
              </div>
              <button onClick={() => setDismissedNudges((prev) => new Set(prev).add(nudge.id))} className="text-text-muted hover:text-foreground text-[10px] mt-0.5">&#x2715;</button>
            </motion.div>
          );
        }
        if (variant === "v2") {
          return (
            <motion.div key={nudge.id} initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: idx * 0.08 }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#38D39F]/5 border border-[#38D39F]/15">
              <NudgeIcon className="w-3 h-3 text-[#38D39F]" />
              <span className="text-[10px] text-foreground flex-1 truncate">{nudge.text}</span>
              <button onClick={() => setDismissedNudges((prev) => new Set(prev).add(nudge.id))} className="text-text-muted hover:text-foreground text-[10px]">&#x2715;</button>
            </motion.div>
          );
        }
        // v3: Minimal line
        return (
          <motion.div key={nudge.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.05 }}
            className="flex items-center gap-2 px-2 py-1 group">
            <motion.span className="inline-block w-1.5 h-1.5 rounded-full bg-[#38D39F]"
              animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1 }} />
            <span className="text-[10px] text-text-muted flex-1">{nudge.text}</span>
            <button onClick={() => setDismissedNudges((prev) => new Set(prev).add(nudge.id))}
              className="text-text-muted hover:text-foreground text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">&#x2715;</button>
          </motion.div>
        );
      })}
    </div>
  );
}
