"use client";

import { ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { QUICK_ACTIONS } from "../agentViewMockData";

interface QuickActionsModuleProps {
  variant: StyleVariant;
  actions?: typeof QUICK_ACTIONS | null;
}

export function QuickActionsModule({ variant, actions: actionsProp }: QuickActionsModuleProps) {
  const actions = actionsProp ?? QUICK_ACTIONS;
  const isMock = !actionsProp;

  if (variant === "v1") {
    // v1: Horizontal scroll chips
    return (
      <div className="relative rounded-lg border border-border p-3 space-y-2">
        {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
          mock
        </span>}
        <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          Quick Actions
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {actions.map((qa, idx) => {
            const QaIcon = qa.icon;
            return (
              <motion.button
                key={idx}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.06 }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[#38D39F]/8 text-[#38D39F] text-[10px] font-medium whitespace-nowrap hover:bg-[#38D39F]/15 transition-colors shrink-0"
              >
                <QaIcon className="w-3 h-3" /> {qa.label}
              </motion.button>
            );
          })}
        </div>
      </div>
    );
  }

  if (variant === "v2") {
    // v2: Grid of icon cards
    return (
      <div className="relative rounded-lg border border-border p-3 space-y-2">
        {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
          mock
        </span>}
        <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          Try asking
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {actions.slice(0, 6).map((qa, idx) => {
            const QaIcon = qa.icon;
            return (
              <motion.button
                key={idx}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.95 }}
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.05 }}
                className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg hover:bg-surface-low transition-colors"
              >
                <motion.div
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{
                    repeat: Infinity,
                    duration: 3,
                    delay: idx * 0.4,
                  }}
                >
                  <QaIcon className="w-4 h-4 text-[#38D39F]" />
                </motion.div>
                <span className="text-[9px] text-text-muted text-center leading-tight">
                  {qa.label}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    );
  }

  // v3: Stacked suggestion cards
  return (
    <div className="relative space-y-1 rounded-lg border border-border p-3">
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>}
      {actions.slice(0, 3).map((qa, idx) => {
        const QaIcon = qa.icon;
        return (
          <motion.button
            key={idx}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.08 }}
            whileHover={{ x: 4 }}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg border border-border hover:border-[#38D39F]/25 hover:bg-[#38D39F]/5 transition-colors text-left"
          >
            <QaIcon className="w-4 h-4 text-[#38D39F] shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-foreground">{qa.label}</div>
              <div className="text-[10px] text-text-muted truncate">
                {qa.prompt}
              </div>
            </div>
            <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
          </motion.button>
        );
      })}
    </div>
  );
}
