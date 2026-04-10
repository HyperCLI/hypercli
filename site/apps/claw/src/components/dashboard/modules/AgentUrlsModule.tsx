"use client";

import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_AGENT_URLS } from "../agentViewMockData";

interface AgentUrlsModuleProps {
  variant: StyleVariant;
  urls?: typeof MOCK_AGENT_URLS | null;
}

export function AgentUrlsModule({ variant, urls: urlsProp }: AgentUrlsModuleProps) {
  const urls = urlsProp ?? MOCK_AGENT_URLS;
  const isMock = !urlsProp;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.32 }}
      className="relative rounded-lg border border-border p-3 space-y-2"
    >
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>}
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
        Endpoints
      </div>
      {variant === "v1" ? (
        <div className="space-y-1">
          {urls.map((u, idx) => {
            const UIcon = u.icon;
            return (
              <motion.a
                key={idx}
                href="#"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.12 + idx * 0.06 }}
                whileHover={{ x: 3 }}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-low transition-colors"
              >
                <UIcon className="w-3.5 h-3.5 text-[#38D39F]" />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-foreground">{u.label}</div>
                  <div className="text-[9px] text-text-muted truncate font-mono">
                    {u.url}
                  </div>
                </div>
              </motion.a>
            );
          })}
        </div>
      ) : variant === "v2" ? (
        <div className="flex flex-wrap gap-1">
          {urls.map((u, idx) => {
            const UIcon = u.icon;
            return (
              <motion.a
                key={idx}
                href="#"
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: idx * 0.05 }}
                whileHover={{ scale: 1.05 }}
                className="flex items-center gap-1 px-2 py-1 rounded-full bg-surface-low text-[10px] text-foreground hover:bg-surface-high transition-colors"
              >
                <UIcon className="w-3 h-3 text-[#38D39F]" />
                {u.label}
              </motion.a>
            );
          })}
        </div>
      ) : (
        <div className="space-y-0.5">
          {urls.map((u, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: idx * 0.03 }}
              className="flex items-center gap-2 px-1.5 py-0.5 text-[10px]"
            >
              <span className="text-text-muted">{u.label}:</span>
              <span className="font-mono text-[#38D39F] truncate">{u.url}</span>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
