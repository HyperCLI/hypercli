"use client";

import { useState } from "react";
import { Sparkles, Wrench, Zap } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_TOOL_DISCOVERIES } from "../agentViewMockData";

interface ToolDiscoveryModuleProps {
  variant: StyleVariant;
  discoveries?: typeof MOCK_TOOL_DISCOVERIES | null;
}

export function ToolDiscoveryModule({ variant, discoveries: discoveriesProp }: ToolDiscoveryModuleProps) {
  const discoveries = discoveriesProp ?? MOCK_TOOL_DISCOVERIES;
  const isMock = !discoveriesProp;
  const [dismissedDiscoveries, setDismissedDiscoveries] = useState<Set<string>>(
    new Set(),
  );

  const visibleDiscoveries = discoveries.filter(
    (d) => !dismissedDiscoveries.has(d.id),
  );

  if (visibleDiscoveries.length === 0) return null;

  return (
    <div className="relative space-y-1.5 rounded-lg border border-border p-3">
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>}
      {visibleDiscoveries.map((disc, idx) => {
        if (variant === "v1") {
          return (
            <motion.div
              key={disc.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="rounded-lg bg-[#f0c56c]/8 border border-[#f0c56c]/20 px-3 py-2 flex items-start gap-2"
            >
              <motion.div
                animate={{ rotate: [0, 15, -15, 0] }}
                transition={{ repeat: Infinity, duration: 2 }}
              >
                <Sparkles className="w-3.5 h-3.5 text-[#f0c56c] mt-0.5 shrink-0" />
              </motion.div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-foreground">{disc.message}</div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  See all tools &rarr;
                </div>
              </div>
              <button
                onClick={() =>
                  setDismissedDiscoveries(
                    (prev) => new Set(prev).add(disc.id),
                  )
                }
                className="text-text-muted hover:text-foreground text-[10px]"
              >
                &#10005;
              </button>
            </motion.div>
          );
        }
        if (variant === "v2") {
          return (
            <motion.div
              key={disc.id}
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#f0c56c]/10 border border-[#f0c56c]/15"
            >
              <Wrench className="w-3 h-3 text-[#f0c56c]" />
              <span className="text-[10px] text-foreground flex-1 truncate">
                {disc.message}
              </span>
              <button
                onClick={() =>
                  setDismissedDiscoveries(
                    (prev) => new Set(prev).add(disc.id),
                  )
                }
                className="text-text-muted hover:text-foreground text-[10px]"
              >
                &#10005;
              </button>
            </motion.div>
          );
        }
        // v3: Toast style bottom-aligned
        return (
          <motion.div
            key={disc.id}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="rounded-md bg-[#1a1a1c] border border-[#f0c56c]/20 shadow-lg px-3 py-2 flex items-center gap-2"
          >
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            >
              <Zap className="w-3.5 h-3.5 text-[#f0c56c]" />
            </motion.div>
            <span className="text-[10px] text-foreground flex-1">
              {disc.message}
            </span>
            <button
              onClick={() =>
                setDismissedDiscoveries(
                  (prev) => new Set(prev).add(disc.id),
                )
              }
              className="text-text-muted hover:text-foreground text-[10px]"
            >
              &#10005;
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}
