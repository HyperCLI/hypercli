"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Sparkles } from "lucide-react";
import { MOCK_NUDGES, MOCK_CONNECTIONS, EXAMPLE_PROMPTS_BY_CAPABILITY } from "../agentViewMockData";

interface WhatCanIDoPanelProps {
  open: boolean;
  onToggle: () => void;
  /** Insert a suggested prompt into the chat input. */
  onPromptClick?: (prompt: string) => void;
}

export function WhatCanIDoPanel({ open, onToggle, onPromptClick }: WhatCanIDoPanelProps) {
  const [dismissedNudges, setDismissedNudges] = useState<Set<string>>(new Set());

  return (
    <>
      {/* Slide-up panel -- covers the scroll area */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 34 }}
            className="absolute inset-0 z-20 bg-background flex flex-col"
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-[#38D39F]" />
                <span className="text-xs font-semibold text-foreground">What can your agent do?</span>
              </div>
              <button
                onClick={onToggle}
                className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            {/* Panel content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {/* Nudges / Suggestions */}
              {MOCK_NUDGES.filter((n) => !dismissedNudges.has(n.id)).length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted/60">Suggestions</span>
                  {MOCK_NUDGES.filter((n) => !dismissedNudges.has(n.id)).map((nudge, idx) => {
                    const NudgeIcon = nudge.icon;
                    return (
                      <motion.div
                        key={nudge.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 + idx * 0.06 }}
                        className="rounded-lg bg-[#38D39F]/5 border border-[#38D39F]/15 px-3 py-2 flex items-start gap-2.5 group cursor-pointer hover:bg-[#38D39F]/10 transition-colors"
                      >
                        <motion.div animate={{ y: [0, -2, 0] }} transition={{ repeat: Infinity, duration: 2, delay: idx * 0.3 }}>
                          <NudgeIcon className="w-3.5 h-3.5 text-[#38D39F] mt-0.5 shrink-0" />
                        </motion.div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-foreground">{nudge.text}</div>
                          <button className="text-[10px] text-[#38D39F] mt-0.5 hover:underline">{nudge.action} →</button>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDismissedNudges((prev) => new Set(prev).add(nudge.id)); }}
                          className="text-text-muted hover:text-foreground text-[10px] mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >✕</button>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Connect services */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted/60">Connect Services</span>
                {MOCK_CONNECTIONS.filter((c) => !c.connected).map((conn, idx) => {
                  const ConnIcon = conn.icon;
                  return (
                    <motion.div
                      key={conn.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15 + idx * 0.05 }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border hover:bg-surface-low/50 transition-colors cursor-pointer"
                    >
                      <div className="w-7 h-7 rounded-lg bg-surface-low flex items-center justify-center shrink-0">
                        <ConnIcon className="w-3.5 h-3.5 text-text-muted" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-foreground">{conn.name}</div>
                        <div className="text-[10px] text-text-muted truncate">{conn.description}</div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#38D39F]/10 text-[#38D39F] font-medium shrink-0">Connect</span>
                    </motion.div>
                  );
                })}
              </div>

              {/* Active connections */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted/60">Active</span>
                {MOCK_CONNECTIONS.filter((c) => c.connected).map((conn, idx) => {
                  const ConnIcon = conn.icon;
                  return (
                    <motion.div
                      key={conn.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 + idx * 0.05 }}
                      className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg"
                    >
                      <div className="w-6 h-6 rounded-full bg-[#38D39F]/10 flex items-center justify-center shrink-0">
                        <ConnIcon className="w-3 h-3 text-[#38D39F]" />
                      </div>
                      <span className="text-[11px] text-foreground flex-1">{conn.name}</span>
                      <div className="w-1.5 h-1.5 rounded-full bg-[#38D39F]" />
                    </motion.div>
                  );
                })}
              </div>

              {/* Example prompts */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted/60">Try Asking</span>
                {EXAMPLE_PROMPTS_BY_CAPABILITY.slice(0, 3).map((cap, idx) => {
                  const CapIcon = cap.icon;
                  return (
                    <motion.div
                      key={cap.capability}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.25 + idx * 0.06 }}
                      className="space-y-1"
                    >
                      <div className="flex items-center gap-1.5">
                        <CapIcon className="w-3 h-3 text-text-muted" />
                        <span className="text-[10px] font-medium text-text-secondary">{cap.capability}</span>
                      </div>
                      {cap.prompts.map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => { onPromptClick?.(prompt); onToggle(); }}
                          className="w-full text-left px-3 py-1.5 rounded-md text-[11px] text-text-muted hover:text-foreground hover:bg-surface-low/50 transition-colors truncate"
                        >
                          &quot;{prompt}&quot;
                        </button>
                      ))}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fixed bottom trigger button */}
      <div className="flex-shrink-0 border-t border-border px-3 py-2">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#38D39F]/8 border border-[#38D39F]/20 hover:bg-[#38D39F]/15 transition-colors"
        >
          <motion.div animate={open ? {} : { rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 3 }}>
            <Sparkles className="w-3.5 h-3.5 text-[#38D39F]" />
          </motion.div>
          <span className="text-xs font-medium text-[#38D39F]">What can you do?</span>
          <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-3 h-3 text-[#38D39F]" />
          </motion.div>
        </motion.button>
      </div>
    </>
  );
}
