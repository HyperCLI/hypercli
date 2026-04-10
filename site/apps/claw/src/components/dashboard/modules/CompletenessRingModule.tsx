"use client";

import { motion } from "framer-motion";
import { Check, type LucideIcon } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { CAPABILITY_SEGMENTS } from "../agentViewMockData";

export interface CapabilitySegment {
  label: string;
  complete: boolean;
  icon: LucideIcon;
}

interface CompletenessRingModuleProps {
  variant: StyleVariant;
  segments?: CapabilitySegment[] | null;
}

export function CompletenessRingModule({ variant, segments: segmentsProp }: CompletenessRingModuleProps) {
  const segments = segmentsProp ?? CAPABILITY_SEGMENTS;
  const isMock = !segmentsProp;
  const complete = segments.filter((s) => s.complete).length;
  const total = segments.length;
  const pct = (complete / total) * 100;

  if (variant === "v1") {
    // v1: Circular ring with segments
    return (
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="relative rounded-lg border border-border p-3">
        {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>}
        <div className="flex items-center gap-3">
          <div className="relative w-14 h-14 shrink-0">
            <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="2" className="text-surface-high" />
              <motion.circle cx="18" cy="18" r="15.9" fill="none" stroke="#38D39F" strokeWidth="2.5" strokeLinecap="round"
                strokeDasharray="100" initial={{ strokeDashoffset: 100 }} animate={{ strokeDashoffset: 100 - pct }}
                transition={{ duration: 1.2, ease: "easeOut" }} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-bold text-foreground">{complete}/{total}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-foreground mb-1">Agent Readiness</div>
            <div className="flex flex-wrap gap-1">
              {segments.map((seg, idx) => {
                const SegIcon = seg.icon;
                return (
                  <motion.div key={idx} whileHover={{ scale: 1.15 }} title={seg.label}
                    className={`w-5 h-5 rounded flex items-center justify-center ${seg.complete ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-high text-text-muted"}`}>
                    <SegIcon className="w-3 h-3" />
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  if (variant === "v2") {
    // v2: Horizontal progress bar with labels
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="relative rounded-lg border border-border p-3 space-y-2">
        {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">Readiness</span>
          <span className="text-[10px] font-mono text-[#38D39F]">{complete}/{total}</span>
        </div>
        <div className="h-2 bg-surface-high rounded-full overflow-hidden">
          <motion.div className="h-full bg-[#38D39F] rounded-full" initial={{ width: 0 }} animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }} />
        </div>
        <div className="grid grid-cols-4 gap-1">
          {segments.map((seg, idx) => {
            const SegIcon = seg.icon;
            return (
              <motion.div key={idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.05 }}
                className={`flex flex-col items-center gap-0.5 py-1 rounded text-center ${seg.complete ? "text-[#38D39F]" : "text-text-muted"}`}>
                <SegIcon className="w-3 h-3" />
                <span className="text-[8px] leading-tight">{seg.label}</span>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    );
  }

  // v3: Checklist style
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative rounded-lg border border-border p-3 space-y-1.5">
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>
      <div className="text-xs font-medium text-foreground mb-1">Setup Checklist — {complete}/{total}</div>
      {CAPABILITY_SEGMENTS.map((seg, idx) => {
        const SegIcon = seg.icon;
        return (
          <motion.div key={idx} initial={{ x: -12, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: idx * 0.04 }}
            className="flex items-center gap-2 py-0.5">
            <motion.div animate={seg.complete ? {} : { opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 2 }}>
              {seg.complete ? <Check className="w-3 h-3 text-[#38D39F]" /> : <div className="w-3 h-3 rounded-full border border-text-muted" />}
            </motion.div>
            <SegIcon className={`w-3 h-3 ${seg.complete ? "text-[#38D39F]" : "text-text-muted"}`} />
            <span className={`text-[11px] ${seg.complete ? "text-foreground" : "text-text-muted"}`}>{seg.label}</span>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
