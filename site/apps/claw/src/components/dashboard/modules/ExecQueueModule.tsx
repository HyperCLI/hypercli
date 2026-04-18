"use client";

import { motion } from "framer-motion";
import { Shield, Terminal } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_EXEC_QUEUE } from "../agentViewMockData";
import { relativeTime } from "../agentViewUtils";

interface ExecQueueModuleProps {
  variant: StyleVariant;
  queue?: typeof MOCK_EXEC_QUEUE | null;
}

export function ExecQueueModule({ variant, queue: queueProp }: ExecQueueModuleProps) {
  const queue = queueProp ?? MOCK_EXEC_QUEUE;
  const isMock = !queueProp;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.3 }}
      className="relative rounded-lg border border-[#f0c56c]/25 bg-[#f0c56c]/5 p-3 space-y-2">
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>}
      <div className="flex items-center gap-1.5">
        <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 1.5 }}>
          <Shield className="w-3.5 h-3.5 text-[#f0c56c]" />
        </motion.div>
        <span className="text-xs font-semibold text-[#f0c56c] uppercase tracking-wider">Pending Approval</span>
        <motion.span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f0c56c]/20 text-[#f0c56c] font-bold"
          animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
          {queue.length}
        </motion.span>
      </div>
      {variant === "v1" ? (
        <div className="space-y-1.5">
          {queue.map((exec, idx) => (
            <motion.div key={exec.id} initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.15 + idx * 0.08 }}
              className="rounded-md border border-[#f0c56c]/20 bg-background/50 px-2.5 py-2 space-y-1.5">
              <code className="text-[10px] font-mono text-foreground block truncate">{exec.command}</code>
              <div className="flex items-center gap-1.5">
                <motion.button whileTap={{ scale: 0.9 }} className="text-[10px] px-2 py-0.5 rounded bg-[#38D39F]/15 text-[#38D39F] hover:bg-[#38D39F]/25 font-medium">Approve</motion.button>
                <motion.button whileTap={{ scale: 0.9 }} className="text-[10px] px-2 py-0.5 rounded bg-[#d05f5f]/15 text-[#d05f5f] hover:bg-[#d05f5f]/25 font-medium">Deny</motion.button>
                <span className="text-[9px] text-text-muted ml-auto">{relativeTime(exec.requestedAt)}</span>
              </div>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="space-y-1">
          {queue.map((exec, idx) => (
            <motion.div key={exec.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.06 }}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-background/50 transition-colors">
              <Terminal className="w-3 h-3 text-[#f0c56c] shrink-0" />
              <code className="text-[10px] font-mono text-foreground flex-1 truncate">{exec.command}</code>
              <motion.button whileTap={{ scale: 0.85 }} className="text-[10px] text-[#38D39F]">&#x2713;</motion.button>
              <motion.button whileTap={{ scale: 0.85 }} className="text-[10px] text-[#d05f5f]">&#x2715;</motion.button>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[10px]">
          <motion.span className="w-1.5 h-1.5 rounded-full bg-[#f0c56c]"
            animate={{ scale: [0.75, 1.35, 0.75] }} transition={{ repeat: Infinity, duration: 1 }} />
          <span className="text-text-muted">{queue.length} commands awaiting approval</span>
          <motion.button whileTap={{ scale: 0.9 }} className="text-[#f0c56c] font-medium ml-auto hover:underline">Review</motion.button>
        </div>
      )}
    </motion.div>
  );
}
