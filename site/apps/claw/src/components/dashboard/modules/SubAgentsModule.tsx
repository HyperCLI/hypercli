"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bot, ChevronDown } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_SUB_AGENTS } from "../agentViewMockData";

interface SubAgentsModuleProps {
  variant: StyleVariant;
}

export function SubAgentsModule({ variant }: SubAgentsModuleProps) {
  const [subAgentsOpen, setSubAgentsOpen] = useState(true);

  if (MOCK_SUB_AGENTS.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.24 }}
      className="relative rounded-lg border border-border p-3 space-y-2"
    >
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>
      <motion.button
        onClick={() => setSubAgentsOpen(!subAgentsOpen)}
        whileTap={{ scale: 0.98 }}
        className="flex items-center gap-1.5 w-full text-xs font-semibold text-text-secondary uppercase tracking-wider hover:text-foreground transition-colors"
      >
        <motion.div
          animate={{ rotate: subAgentsOpen ? 0 : -90 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </motion.div>
        Sub-agents
        <span className="text-text-muted font-normal normal-case">
          ({MOCK_SUB_AGENTS.length})
        </span>
      </motion.button>
      {subAgentsOpen && (
        <div className="space-y-1">
          {MOCK_SUB_AGENTS.map((sa, idx) => (
            <motion.div
              key={sa.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 28,
                delay: idx * 0.06,
              }}
              whileHover={{ x: 3 }}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-surface-low transition-colors"
            >
              <motion.div
                animate={
                  sa.status === "RUNNING" ? { scale: [1, 1.1, 1] } : {}
                }
                transition={{
                  repeat: Infinity,
                  duration: 2.5,
                  ease: "easeInOut",
                  delay: idx * 0.4,
                }}
              >
                <Bot
                  className={`w-3.5 h-3.5 shrink-0 ${sa.status === "RUNNING" ? "text-[#38D39F]" : "text-text-muted"}`}
                />
              </motion.div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-foreground truncate">
                  {sa.name}
                </div>
                <div className="text-[10px] text-text-muted">
                  {sa.description}
                </div>
              </div>
              <motion.div
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${sa.status === "RUNNING" ? "bg-[#38D39F]" : "bg-text-muted"}`}
                animate={
                  sa.status === "RUNNING"
                    ? { scale: [0.8, 1.4, 0.8], opacity: [0.5, 1, 0.5] }
                    : {}
                }
                transition={{
                  repeat: Infinity,
                  duration: 1.2,
                  ease: "easeInOut",
                  delay: idx * 0.3,
                }}
              />
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
