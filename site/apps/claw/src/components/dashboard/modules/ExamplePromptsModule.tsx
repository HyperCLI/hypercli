"use client";

import { motion } from "framer-motion";
import { ChevronRight, Lightbulb } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { EXAMPLE_PROMPTS_BY_CAPABILITY } from "../agentViewMockData";

interface ExamplePromptsModuleProps {
  variant: StyleVariant;
  prompts?: typeof EXAMPLE_PROMPTS_BY_CAPABILITY | null;
}

export function ExamplePromptsModule({ variant, prompts: promptsProp }: ExamplePromptsModuleProps) {
  const prompts = promptsProp ?? EXAMPLE_PROMPTS_BY_CAPABILITY;
  const isMock = !promptsProp;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.18 }}
      className="relative rounded-lg border border-border p-3 space-y-2">
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>}
      <div className="flex items-center gap-1.5">
        <motion.div animate={{ y: [0, -2, 0] }} transition={{ repeat: Infinity, duration: 2 }}>
          <Lightbulb className="w-3.5 h-3.5 text-[#f0c56c]" />
        </motion.div>
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Try These</span>
      </div>
      {variant === "v1" ? (
        // v1: Grouped by capability
        <div className="space-y-2.5">
          {prompts.slice(0, 3).map((group, gIdx) => {
            const GIcon = group.icon;
            return (
              <motion.div key={gIdx} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + gIdx * 0.08 }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <GIcon className="w-3 h-3 text-[#38D39F]" />
                  <span className="text-[10px] font-medium text-foreground">{group.capability}</span>
                </div>
                {group.prompts.map((p, pIdx) => (
                  <motion.button key={pIdx} whileHover={{ x: 3 }} whileTap={{ scale: 0.97 }}
                    className="block w-full text-left text-[10px] text-text-muted hover:text-foreground pl-5 py-0.5 transition-colors">
                    &quot;{p}&quot;
                  </motion.button>
                ))}
              </motion.div>
            );
          })}
        </div>
      ) : variant === "v2" ? (
        // v2: Flat card list, one prompt each
        <div className="space-y-1">
          {prompts.map((group, idx) => {
            const GIcon = group.icon;
            return (
              <motion.button key={idx} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.12 + idx * 0.05 }}
                whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border hover:border-[#38D39F]/25 hover:bg-[#38D39F]/5 transition-colors text-left">
                <div className="w-6 h-6 rounded-md bg-[#38D39F]/10 flex items-center justify-center shrink-0">
                  <GIcon className="w-3 h-3 text-[#38D39F]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-foreground font-medium">{group.capability}</div>
                  <div className="text-[9px] text-text-muted truncate">&quot;{group.prompts[0]}&quot;</div>
                </div>
                <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
              </motion.button>
            );
          })}
        </div>
      ) : (
        // v3: Random prompt carousel (just show 3 random prompts)
        <div className="space-y-1">
          {prompts.slice(0, 3).map((group, idx) => (
            <motion.div key={idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.05 }}
              className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface-low transition-colors">
              <motion.span className="inline-block w-1.5 h-1.5 rounded-full bg-[#f0c56c]"
                animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1, delay: idx * 0.2 }} />
              <span className="text-[10px] text-text-muted">&quot;{group.prompts[0]}&quot;</span>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
