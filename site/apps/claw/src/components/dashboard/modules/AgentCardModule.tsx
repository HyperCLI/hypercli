"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant, AgentStatus } from "../agentViewTypes";
import {
  MOCK_CONFIG,
  MOCK_CONNECTIONS,
  MOCK_SESSIONS,
  MOCK_STATUS,
} from "../agentViewMockData";
import { formatUptime } from "../agentViewUtils";

interface AgentCardModuleProps {
  variant: StyleVariant;
  agentName?: string;
  agentStatus?: AgentStatus | null;
}

export function AgentCardModule({
  variant,
  agentName = "My Agent",
  agentStatus,
}: AgentCardModuleProps) {
  const [showAgentCard, setShowAgentCard] = useState(false);

  const status = agentStatus ?? MOCK_STATUS;
  const configTools = MOCK_CONFIG.tools;

  return (
    <div className="relative rounded-lg border border-border p-3">
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => setShowAgentCard(!showAgentCard)}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-border hover:bg-surface-low transition-colors text-xs text-text-muted hover:text-foreground"
      >
        <Bot className="w-3 h-3" /> {showAgentCard ? "Hide" : "Show"} Agent
        Card
      </motion.button>
      {showAgentCard &&
        (() => {
          const enabledTools = configTools
            .filter((t) => t.enabled)
            .map((t) => t.name);
          const connectedCount = MOCK_CONNECTIONS.filter(
            (c) => c.connected,
          ).length;
          if (variant === "v1") {
            return (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-xl border border-border bg-surface-low p-4 space-y-3"
              >
                <div className="flex items-center gap-3">
                  <motion.div
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ repeat: Infinity, duration: 3 }}
                    className="w-10 h-10 rounded-xl bg-[#38D39F]/15 flex items-center justify-center"
                  >
                    <Bot className="w-5 h-5 text-[#38D39F]" />
                  </motion.div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {agentName}
                    </div>
                    <div className="text-[10px] text-text-muted">
                      {MOCK_CONFIG.model} · v{status.version}
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-text-muted line-clamp-2">
                  {MOCK_CONFIG.systemPrompt}
                </p>
                <div className="flex flex-wrap gap-1">
                  {enabledTools.map((t) => (
                    <span
                      key={t}
                      className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#38D39F]/10 text-[#38D39F]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="flex gap-4 text-[10px] text-text-muted">
                  <span>{connectedCount} connections</span>
                  <span>{MOCK_SESSIONS.length} sessions</span>
                  <span>{formatUptime(status.uptime)} uptime</span>
                </div>
              </motion.div>
            );
          }
          if (variant === "v2") {
            return (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border border-[#38D39F]/20 bg-gradient-to-br from-[#38D39F]/5 to-transparent p-3 space-y-2"
              >
                <div className="text-xs font-medium text-foreground">
                  {agentName}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Tools", value: enabledTools.length },
                    { label: "Links", value: connectedCount },
                    { label: "Sessions", value: MOCK_SESSIONS.length },
                  ].map((stat, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: idx * 0.1, type: "spring" }}
                      className="py-1.5 rounded-md bg-background/50"
                    >
                      <div className="text-sm font-bold text-[#38D39F]">
                        {stat.value}
                      </div>
                      <div className="text-[9px] text-text-muted">
                        {stat.label}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            );
          }
          // v3: Compact inline
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-md border border-border px-3 py-2 flex items-center gap-3 text-[10px] text-text-muted"
            >
              <Bot className="w-4 h-4 text-[#38D39F] shrink-0" />
              <span className="text-foreground font-medium">{agentName}</span>
              <span>·</span>
              <span>{MOCK_CONFIG.model}</span>
              <span>·</span>
              <span>{enabledTools.length} tools</span>
              <span>·</span>
              <span>{connectedCount} connected</span>
            </motion.div>
          );
        })()}
    </div>
  );
}
