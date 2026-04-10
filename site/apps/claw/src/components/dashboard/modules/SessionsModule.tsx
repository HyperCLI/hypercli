"use client";

import { motion } from "framer-motion";
import { Monitor } from "lucide-react";
import type { AgentSession } from "../agentViewTypes";
import { MOCK_SESSIONS, SESSION_ICONS } from "../agentViewMockData";
import { relativeTime } from "../agentViewUtils";

interface SessionsModuleProps {
  sessions?: AgentSession[] | null;
}

export function SessionsModule({ sessions: sessionsProp }: SessionsModuleProps) {
  const sessions = sessionsProp ?? MOCK_SESSIONS;
  const isMock = !sessionsProp;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.16 }}
      className="relative rounded-lg border border-border p-3 space-y-2"
    >
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Sessions</span>
        <motion.span
          className="text-[10px] text-text-muted flex items-center gap-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <motion.span
            className="inline-block w-1.5 h-1.5 rounded-full bg-[#38D39F]"
            animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }}
            transition={{ repeat: Infinity, duration: 1, ease: "easeInOut" }}
          />
          {sessions.length} active
        </motion.span>
      </div>
      <div className="space-y-1">
        {sessions.map((sess, idx) => {
          const SessIcon = SESSION_ICONS[sess.clientMode] || Monitor;
          return (
            <motion.div
              key={sess.key}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 28, delay: 0.22 + idx * 0.06 }}
              whileHover={{ x: 3 }}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-surface-low transition-colors"
            >
              <motion.div
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ repeat: Infinity, duration: 4, ease: "easeInOut", delay: idx * 0.8 }}
              >
                <SessIcon className="w-3.5 h-3.5 text-text-muted shrink-0" />
              </motion.div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-foreground truncate">{sess.clientDisplayName}</div>
                <div className="text-[10px] text-text-muted">{sess.clientMode}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-muted">{relativeTime(sess.lastMessageAt)}</span>
                <motion.div
                  className="w-1.5 h-1.5 rounded-full bg-[#38D39F]"
                  animate={{ scale: [0.8, 1.3, 0.8], opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut", delay: idx * 0.25 }}
                />
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
