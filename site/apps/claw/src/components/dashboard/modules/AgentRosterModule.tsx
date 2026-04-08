"use client";

import { motion } from "framer-motion";
import { Bot, Pause, Play } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_AGENT_ROSTER } from "../agentViewMockData";

interface AgentRosterModuleProps {
  variant: StyleVariant;
}

export function AgentRosterModule({ variant }: AgentRosterModuleProps) {
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
        <Bot className="w-3.5 h-3.5" /> Agent Roster
      </div>
      {variant === "v1" ? (
        <div className="space-y-1.5">
          {MOCK_AGENT_ROSTER.map((a, idx) => (
            <motion.div
              key={a.id}
              initial={{ x: -16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.15 + idx * 0.06 }}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-low transition-colors"
            >
              <Bot
                className={`w-4 h-4 shrink-0 ${a.status === "working" ? "text-[#38D39F]" : a.status === "waiting" ? "text-[#f0c56c]" : "text-text-muted"}`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-foreground font-mono">
                  {a.name}
                </div>
                <div className="text-[10px] text-text-muted">
                  {a.model}
                  {a.task ? ` \u00b7 ${a.task}` : ""}
                </div>
              </div>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${a.status === "working" ? "bg-[#38D39F]/10 text-[#38D39F]" : a.status === "waiting" ? "bg-[#f0c56c]/10 text-[#f0c56c]" : "bg-surface-high text-text-muted"}`}
              >
                {a.status}
              </span>
              <button className="text-text-muted hover:text-foreground">
                {a.status === "working" ? (
                  <Pause className="w-3 h-3" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
              </button>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="grid grid-cols-3 gap-1.5">
          {MOCK_AGENT_ROSTER.map((a, idx) => (
            <motion.div
              key={a.id}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: idx * 0.06, type: "spring" }}
              className={`flex flex-col items-center gap-1 py-2 rounded-lg border ${a.status === "working" ? "border-[#38D39F]/30 border-t-[#38D39F]" : a.status === "waiting" ? "border-[#f0c56c]/30 border-t-[#f0c56c]" : "border-border border-t-text-muted"}`}
              style={{ borderTopWidth: "2px" }}
            >
              <Bot
                className={`w-4 h-4 ${a.status === "working" ? "text-[#38D39F]" : a.status === "waiting" ? "text-[#f0c56c]" : "text-text-muted"}`}
              />
              <span className="text-[9px] text-foreground font-mono">
                {a.name}
              </span>
              <span className="text-[8px] text-text-muted">{a.model}</span>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {MOCK_AGENT_ROSTER.map((a, idx) => (
            <motion.span
              key={a.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: idx * 0.04 }}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-surface-high"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${a.status === "working" ? "bg-[#38D39F]" : a.status === "waiting" ? "bg-[#f0c56c]" : "bg-text-muted"}`}
              />
              <span className="text-foreground">{a.name}</span>
            </motion.span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
