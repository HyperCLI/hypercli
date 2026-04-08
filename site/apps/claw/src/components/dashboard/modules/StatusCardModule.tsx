"use client";

import { motion } from "framer-motion";
import { Bot, Clock, Cpu } from "lucide-react";
import type { AgentStatus } from "../agentViewTypes";
import { MOCK_STATUS } from "../agentViewMockData";
import { formatUptime, formatBytes } from "../agentViewUtils";

interface StatusCardModuleProps {
  agentName?: string;
  status?: AgentStatus;
}

export function StatusCardModule({ agentName = "Agent", status = MOCK_STATUS }: StatusCardModuleProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className="relative rounded-lg border border-border bg-surface-low p-3 space-y-3"
    >
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
          >
            <Bot className="w-4 h-4 text-[#38D39F]" />
          </motion.div>
          <span className="text-sm font-medium text-foreground">{agentName}</span>
        </div>
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 20, delay: 0.15 }}
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${status.state === "RUNNING" ? "bg-[#38D39F]/15 text-[#38D39F]"
              : status.state === "STOPPED" ? "bg-[#d05f5f]/15 text-[#d05f5f]"
                : "bg-[#f0c56c]/15 text-[#f0c56c]"
            }`}
        >
          <span className="flex items-center gap-1">
            <motion.span
              className={`inline-block w-1.5 h-1.5 rounded-full ${status.state === "RUNNING" ? "bg-[#38D39F]" : status.state === "STOPPED" ? "bg-[#d05f5f]" : "bg-[#f0c56c]"
                }`}
              animate={{ scale: [0.8, 1.4, 0.8], opacity: [0.6, 1, 0.6] }}
              transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
            />
            {status.state}
          </span>
        </motion.span>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex items-center gap-4 text-[10px] text-text-muted"
      >
        <span className="flex items-center gap-1">
          <motion.div animate={{ rotate: [0, 360] }} transition={{ repeat: Infinity, duration: 8, ease: "linear" }}>
            <Clock className="w-3 h-3" />
          </motion.div>
          {formatUptime(status.uptime)}
        </span>
        {status.version && <span>v{status.version}</span>}
      </motion.div>

      {/* CPU gauge */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-text-muted flex items-center gap-1">
            <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}>
              <Cpu className="w-3 h-3" />
            </motion.div>
            CPU
          </span>
          <span className="text-foreground font-mono">{status.cpu}%</span>
        </div>
        <div className="h-1.5 bg-background rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-[#38D39F] rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${status.cpu}%` }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
          />
        </div>
      </div>

      {/* Memory gauge */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-text-muted">Memory</span>
          <span className="text-foreground font-mono">{formatBytes(status.memory.used)} / {formatBytes(status.memory.total)}</span>
        </div>
        <div className="h-1.5 bg-background rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-[#38D39F] rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${(status.memory.used / status.memory.total) * 100}%` }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.45 }}
          />
        </div>
      </div>
    </motion.div>
  );
}
