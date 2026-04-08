"use client";

import { motion } from "framer-motion";
import { GitBranch, Link2, Mail, Plus, Sparkles } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";

interface ConnectionRecsModuleProps {
  variant: StyleVariant;
}

const recs = [
  { name: "Gmail", reason: "Your agent mentions email often", icon: Mail },
  {
    name: "GitHub",
    reason: "Detected code-related tasks",
    icon: GitBranch,
  },
];

export function ConnectionRecsModule({ variant }: ConnectionRecsModuleProps) {
  if (variant === "v1") {
    return (
      <div className="relative rounded-lg border border-[#4285f4]/20 bg-[#4285f4]/5 p-3 space-y-2">
        <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
          mock
        </span>
        <div className="flex items-center gap-1.5">
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
          >
            <Sparkles className="w-3.5 h-3.5 text-[#4285f4]" />
          </motion.div>
          <span className="text-xs font-medium text-foreground">
            Suggested Connections
          </span>
        </div>
        {recs.map((r, idx) => {
          const RecIcon = r.icon;
          return (
            <motion.div
              key={idx}
              initial={{ x: -12, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: idx * 0.1 }}
              className="flex items-center gap-2.5 py-1"
            >
              <RecIcon className="w-3.5 h-3.5 text-[#4285f4]" />
              <div className="flex-1 min-w-0">
                <span className="text-xs text-foreground">{r.name}</span>
                <span className="text-[10px] text-text-muted ml-1">
                  &mdash; {r.reason}
                </span>
              </div>
              <motion.button
                whileTap={{ scale: 0.9 }}
                className="text-[10px] px-2 py-0.5 rounded-full bg-[#4285f4]/15 text-[#4285f4] hover:bg-[#4285f4]/25"
              >
                Connect
              </motion.button>
            </motion.div>
          );
        })}
      </div>
    );
  }

  if (variant === "v2") {
    return (
      <div className="relative space-y-1 rounded-lg border border-border p-3">
        <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
          mock
        </span>
        {recs.map((r, idx) => {
          const RecIcon = r.icon;
          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.08 }}
              className="rounded-lg border border-border px-3 py-2 flex items-center gap-2 hover:border-[#4285f4]/25 transition-colors"
            >
              <div className="w-7 h-7 rounded-lg bg-[#4285f4]/10 flex items-center justify-center">
                <RecIcon className="w-3.5 h-3.5 text-[#4285f4]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-foreground">{r.name}</div>
                <div className="text-[10px] text-text-muted">{r.reason}</div>
              </div>
              <Plus className="w-3.5 h-3.5 text-[#4285f4]" />
            </motion.div>
          );
        })}
      </div>
    );
  }

  // v3: Inline banner
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative flex items-center gap-2 px-3 py-2 rounded-lg bg-[#4285f4]/5 border border-[#4285f4]/15"
    >
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>
      <Link2 className="w-3.5 h-3.5 text-[#4285f4] shrink-0" />
      <span className="text-[10px] text-text-muted flex-1">
        Connect{" "}
        <span className="text-[#4285f4] font-medium">
          {recs.map((r) => r.name).join(", ")}
        </span>{" "}
        based on your agent&apos;s activity
      </span>
      <motion.button
        whileTap={{ scale: 0.9 }}
        className="text-[10px] text-[#4285f4] font-medium hover:underline shrink-0"
      >
        Add
      </motion.button>
    </motion.div>
  );
}
