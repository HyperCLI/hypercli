"use client";

import React from "react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { INTERACTION_PATTERNS } from "../agentViewMockData";

interface InteractionPatternsModuleProps {
  variant: StyleVariant;
  patterns?: typeof INTERACTION_PATTERNS | null;
}

export function InteractionPatternsModule({ variant, patterns: patternsProp }: InteractionPatternsModuleProps) {
  const patterns = patternsProp ?? INTERACTION_PATTERNS;
  const isMock = !patternsProp;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.16 }}
      className="relative rounded-lg border border-border p-3 space-y-2">
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>}
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">What your agent does</div>
      {variant === "v1" ? (
        // v1: Stacked progress bars
        <div className="space-y-2">
          {patterns.map((pat, idx) => (
            <motion.div key={pat.label} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + idx * 0.06 }}>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-foreground">{pat.label}</span>
                <span className="font-mono" style={{ color: pat.color }}>{pat.pct}%</span>
              </div>
              <div className="h-1.5 bg-background rounded-full overflow-hidden">
                <motion.div className="h-full rounded-full" style={{ backgroundColor: pat.color }} initial={{ width: 0 }}
                  animate={{ width: `${pat.pct}%` }} transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 + idx * 0.08 }} />
              </div>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        // v2: Donut-style segmented ring
        <div className="flex items-center gap-3">
          <div className="relative w-16 h-16 shrink-0">
            <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
              {patterns.reduce<{ offset: number; elements: React.ReactNode[] }>((acc, pat, idx) => {
                const el = (
                  <motion.circle key={idx} cx="18" cy="18" r="15.9" fill="none" stroke={pat.color} strokeWidth="3"
                    strokeDasharray={`${pat.pct} ${100 - pat.pct}`} strokeDashoffset={-acc.offset}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 + idx * 0.15 }} />
                );
                return { offset: acc.offset + pat.pct, elements: [...acc.elements, el] };
              }, { offset: 0, elements: [] }).elements}
            </svg>
          </div>
          <div className="flex-1 space-y-1">
            {patterns.map((pat, idx) => (
              <motion.div key={idx} initial={{ x: -8, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.2 + idx * 0.06 }}
                className="flex items-center gap-1.5 text-[10px]">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: pat.color }} />
                <span className="text-foreground">{pat.label}</span>
                <span className="text-text-muted ml-auto font-mono">{pat.pct}%</span>
              </motion.div>
            ))}
          </div>
        </div>
      ) : (
        // v3: Horizontal stacked bar
        <div>
          <div className="flex h-3 rounded-full overflow-hidden mb-2">
            {patterns.map((pat, idx) => (
              <motion.div key={idx} style={{ backgroundColor: pat.color }} initial={{ width: 0 }}
                animate={{ width: `${pat.pct}%` }} transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 + idx * 0.1 }}
                className="h-full first:rounded-l-full last:rounded-r-full" />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {patterns.map((pat) => (
              <span key={pat.label} className="flex items-center gap-1 text-[9px] text-text-muted">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: pat.color }} />{pat.label} {pat.pct}%
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
