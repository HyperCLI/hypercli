"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Check, Plus } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_CAPABILITY_DIFFS } from "../agentViewMockData";
import { relativeTime } from "../agentViewUtils";

interface CapabilityDiffModuleProps {
  variant: StyleVariant;
}

export function CapabilityDiffModule({ variant }: CapabilityDiffModuleProps) {
  if (MOCK_CAPABILITY_DIFFS.length === 0) return null;

  return (
    <div className="relative space-y-1 rounded-lg border border-border p-3">
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>
      {MOCK_CAPABILITY_DIFFS.map((diff, idx) => {
        const isAdd = diff.action === "enabled" || diff.action === "connected";
        if (variant === "v1") {
          return (
            <motion.div
              key={diff.id}
              initial={{ x: -16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: idx * 0.08 }}
              className={`rounded-lg px-3 py-2 border flex items-center gap-2 ${isAdd ? "bg-[#38D39F]/5 border-[#38D39F]/20" : "bg-[#d05f5f]/5 border-[#d05f5f]/20"}`}
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 20 }}
              >
                {isAdd ? (
                  <Check className="w-3.5 h-3.5 text-[#38D39F]" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-[#d05f5f]" />
                )}
              </motion.div>
              <span className="text-xs text-foreground flex-1">
                {diff.message}
              </span>
              <span className="text-[10px] text-text-muted">
                {relativeTime(diff.timestamp)}
              </span>
            </motion.div>
          );
        }
        if (variant === "v2") {
          return (
            <motion.div
              key={diff.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 px-2 py-1"
            >
              <motion.span
                className={`inline-block w-1.5 h-1.5 rounded-full ${isAdd ? "bg-[#38D39F]" : "bg-[#d05f5f]"}`}
                animate={{ scale: [0.75, 1.35, 0.75] }}
                transition={{ repeat: Infinity, duration: 1 }}
              />
              <span className="text-[10px] text-text-muted">
                {diff.message}
              </span>
            </motion.div>
          );
        }
        // v3: Pill badge
        return (
          <motion.div
            key={diff.id}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium mr-1 ${isAdd ? "bg-[#38D39F]/10 text-[#38D39F]" : "bg-[#d05f5f]/10 text-[#d05f5f]"}`}
          >
            {isAdd ? (
              <Plus className="w-2.5 h-2.5" />
            ) : (
              <AlertTriangle className="w-2.5 h-2.5" />
            )}
            {diff.capability}
          </motion.div>
        );
      })}
    </div>
  );
}
