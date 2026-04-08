"use client";

import { motion } from "framer-motion";
import { Eye } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_AGENT_FOCUS } from "../agentViewMockData";

interface AgentFocusModuleProps {
  variant: StyleVariant;
}

export function AgentFocusModule({ variant }: AgentFocusModuleProps) {
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
        <Eye className="w-3.5 h-3.5" /> Agent Focus
      </div>
      {variant === "v1" ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#38D39F]/10 text-[#38D39F] font-medium uppercase">
              {MOCK_AGENT_FOCUS.mode}
            </span>
          </div>
          <div>
            <div className="text-[9px] text-text-muted/60 uppercase mb-1">
              Active Tools
            </div>
            <div className="flex flex-wrap gap-1">
              {MOCK_AGENT_FOCUS.activeTools.map((tool) => (
                <span
                  key={tool}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-surface-high text-foreground font-mono"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-text-muted/60 uppercase mb-0.5">
              Instructions
            </div>
            <div className="text-[10px] text-text-muted truncate">
              {MOCK_AGENT_FOCUS.instructions}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-text-muted/60 uppercase mb-0.5">
              Context Files
            </div>
            <div className="flex flex-wrap gap-1">
              {MOCK_AGENT_FOCUS.context.map((f) => (
                <span
                  key={f}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-surface-high text-foreground"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : variant === "v2" ? (
        <div className="flex items-start gap-2 px-2 py-1.5 rounded-lg border border-border">
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#38D39F]/10 text-[#38D39F] font-medium uppercase shrink-0">
            {MOCK_AGENT_FOCUS.mode}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-foreground">
              {MOCK_AGENT_FOCUS.activeTools.length} tools &middot;{" "}
              {MOCK_AGENT_FOCUS.context.length} context files
            </div>
            <div className="text-[10px] text-text-muted truncate mt-0.5">
              {MOCK_AGENT_FOCUS.instructions}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-text-muted">
          {MOCK_AGENT_FOCUS.mode} mode &middot;{" "}
          {MOCK_AGENT_FOCUS.activeTools.length} tools &middot;{" "}
          {MOCK_AGENT_FOCUS.context.length} context files
        </div>
      )}
    </motion.div>
  );
}
