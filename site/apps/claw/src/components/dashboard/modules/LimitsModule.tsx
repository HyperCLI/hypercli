"use client";

import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { AGENT_LIMITS } from "../agentViewMockData";

interface LimitsModuleProps {
  variant: StyleVariant;
  limits?: typeof AGENT_LIMITS | null;
}

export function LimitsModule({ variant, limits: limitsProp }: LimitsModuleProps) {
  const limits = limitsProp ?? AGENT_LIMITS;
  const isMock = !limitsProp;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.2 }}
      className="relative rounded-lg border border-border p-3 space-y-2"
    >
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>}
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
        Limits
      </div>
      {variant === "v1" ? (
        // v1: 2-col grid with icons
        <div className="grid grid-cols-2 gap-1.5">
          {limits.map((lim, idx) => {
            const LimIcon = lim.icon;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.15 + idx * 0.04, type: "spring" }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-low"
              >
                <LimIcon className="w-3 h-3 text-text-muted shrink-0" />
                <div className="min-w-0">
                  <div className="text-[9px] text-text-muted">{lim.label}</div>
                  <div className="text-[10px] text-foreground font-mono font-medium">
                    {lim.value}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : variant === "v2" ? (
        // v2: Single row chips
        <div className="flex flex-wrap gap-1">
          {limits.map((lim, idx) => (
            <motion.span
              key={idx}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.04 }}
              className="text-[9px] px-2 py-0.5 rounded-full bg-surface-low text-text-muted font-mono"
            >
              {lim.label}: <span className="text-foreground">{lim.value}</span>
            </motion.span>
          ))}
        </div>
      ) : (
        // v3: Compact vertical list
        <div className="space-y-0.5">
          {limits.map((lim, idx) => {
            const LimIcon = lim.icon;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.03 }}
                className="flex items-center justify-between px-1.5 py-0.5 text-[10px]"
              >
                <span className="flex items-center gap-1.5 text-text-muted">
                  <LimIcon className="w-3 h-3" />
                  {lim.label}
                </span>
                <span className="font-mono text-foreground">{lim.value}</span>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
