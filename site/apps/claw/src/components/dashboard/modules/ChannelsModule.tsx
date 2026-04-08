"use client";

import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_CHANNELS } from "../agentViewMockData";

interface ChannelsModuleProps {
  variant: StyleVariant;
}

export function ChannelsModule({ variant }: ChannelsModuleProps) {
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
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
        Channels
      </div>
      {variant === "v1" ? (
        <div className="space-y-1.5">
          {MOCK_CHANNELS.map((ch, idx) => {
            const ChIcon = ch.icon;
            return (
              <motion.div
                key={ch.id}
                initial={{ x: -16, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.15 + idx * 0.06 }}
                whileHover={{ x: 3 }}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-low transition-colors"
              >
                <motion.div
                  animate={
                    ch.status === "connected" ? { scale: [1, 1.1, 1] } : {}
                  }
                  transition={{
                    repeat: Infinity,
                    duration: 2.5,
                    delay: idx * 0.4,
                  }}
                >
                  <ChIcon
                    className={`w-4 h-4 ${ch.status === "connected" ? "text-[#38D39F]" : "text-text-muted"}`}
                  />
                </motion.div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-foreground">{ch.name}</div>
                  {ch.account && (
                    <div className="text-[10px] text-text-muted">
                      {ch.account}
                    </div>
                  )}
                </div>
                <motion.div
                  className={`w-1.5 h-1.5 rounded-full ${ch.status === "connected" ? "bg-[#38D39F]" : "bg-text-muted"}`}
                  animate={
                    ch.status === "connected"
                      ? { scale: [0.8, 1.4, 0.8], opacity: [0.5, 1, 0.5] }
                      : {}
                  }
                  transition={{
                    repeat: Infinity,
                    duration: 1.2,
                    delay: idx * 0.3,
                  }}
                />
                {ch.status !== "connected" && (
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    className="text-[10px] text-[#38D39F] hover:underline"
                  >
                    Connect
                  </motion.button>
                )}
              </motion.div>
            );
          })}
        </div>
      ) : variant === "v2" ? (
        <div className="flex gap-1.5">
          {MOCK_CHANNELS.map((ch, idx) => {
            const ChIcon = ch.icon;
            return (
              <motion.div
                key={ch.id}
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: idx * 0.06, type: "spring" }}
                whileHover={{ y: -2 }}
                className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border ${ch.status === "connected" ? "border-[#38D39F]/20 bg-[#38D39F]/5" : "border-border"}`}
              >
                <ChIcon
                  className={`w-4 h-4 ${ch.status === "connected" ? "text-[#38D39F]" : "text-text-muted"}`}
                />
                <span className="text-[9px] text-foreground">{ch.name}</span>
                <span
                  className={`text-[8px] ${ch.status === "connected" ? "text-[#38D39F]" : "text-text-muted"}`}
                >
                  {ch.status}
                </span>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {MOCK_CHANNELS.map((ch, idx) => (
            <motion.span
              key={ch.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: idx * 0.04 }}
              className={`text-[10px] px-2 py-0.5 rounded-full ${ch.status === "connected" ? "bg-[#38D39F]/10 text-[#38D39F]" : "bg-surface-high text-text-muted"}`}
            >
              {ch.name} {ch.status === "connected" ? "\u2713" : "\u2014"}
            </motion.span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
