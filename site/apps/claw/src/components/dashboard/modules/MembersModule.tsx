"use client";

import { motion } from "framer-motion";
import { Users } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_CHANNEL_MEMBERS } from "../agentViewMockData";

interface MembersModuleProps {
  variant: StyleVariant;
}

export function MembersModule({ variant }: MembersModuleProps) {
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
        <Users className="w-3.5 h-3.5" /> Members
      </div>
      {variant === "v1" ? (
        <div className="space-y-1.5">
          {MOCK_CHANNEL_MEMBERS.map((m, idx) => (
            <motion.div
              key={m.id}
              initial={{ x: -16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.15 + idx * 0.06 }}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-low transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-surface-high flex items-center justify-center text-[10px] font-bold text-foreground">
                {m.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-foreground">{m.name}</span>
              </div>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${m.role === "owner" ? "bg-[#38D39F]/10 text-[#38D39F]" : m.role === "contributor" ? "bg-[#f0c56c]/10 text-[#f0c56c]" : "bg-surface-high text-text-muted"}`}
              >
                {m.role}
              </span>
              <motion.div
                className={`w-1.5 h-1.5 rounded-full ${m.online ? "bg-[#38D39F]" : "bg-text-muted"}`}
                animate={
                  m.online
                    ? { scale: [0.8, 1.4, 0.8], opacity: [0.5, 1, 0.5] }
                    : {}
                }
                transition={{
                  repeat: Infinity,
                  duration: 1.2,
                  delay: idx * 0.3,
                }}
              />
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="flex gap-2">
          {MOCK_CHANNEL_MEMBERS.map((m, idx) => (
            <motion.div
              key={m.id}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: idx * 0.06, type: "spring" }}
              className="flex flex-col items-center gap-1"
            >
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-surface-high flex items-center justify-center text-xs font-bold text-foreground">
                  {m.avatar}
                </div>
                <div
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${m.online ? "bg-[#38D39F]" : "bg-text-muted"}`}
                />
              </div>
              <span className="text-[9px] text-text-muted">{m.name}</span>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-text-muted">
          {MOCK_CHANNEL_MEMBERS.length} members &middot;{" "}
          {MOCK_CHANNEL_MEMBERS.filter((m) => m.online).length} online
        </div>
      )}
    </motion.div>
  );
}
