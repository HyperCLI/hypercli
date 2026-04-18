"use client";

import { Activity, Bot, Users, Settings } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_GROUP_ACTIVITY_FEED } from "../agentViewMockData";
import { relativeTime } from "../agentViewUtils";

interface GroupActivityFeedModuleProps {
  variant: StyleVariant;
}

export function GroupActivityFeedModule({ variant }: GroupActivityFeedModuleProps) {
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
        <Activity className="w-3.5 h-3.5" /> Activity Feed
      </div>
      {variant === "v1" ? (
        <div className="space-y-1">
          {MOCK_GROUP_ACTIVITY_FEED.map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.06 }}
              className={`flex items-start gap-2 px-2 py-1.5 rounded-lg border-l-2 ${item.type === "agent" ? "border-l-[#38D39F]" : item.type === "user" ? "border-l-[#4A9EFF]" : "border-l-text-muted/40"}`}
            >
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-medium text-foreground">{item.actor}</span>
                <span className="text-[10px] text-text-muted ml-1">{item.action}</span>
              </div>
              <span className="text-[9px] text-text-muted whitespace-nowrap">{relativeTime(item.ts)}</span>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="space-y-1">
          {MOCK_GROUP_ACTIVITY_FEED.map((item, idx) => {
            const TypeIcon = item.type === "agent" ? Bot : item.type === "user" ? Users : Settings;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="flex items-center gap-2 px-2 py-1"
              >
                <TypeIcon className="w-3 h-3 text-text-muted shrink-0" />
                <span className="text-[10px] text-foreground flex-1 truncate">
                  {item.actor}: {item.action}
                </span>
                <span className="text-[9px] text-text-muted">{relativeTime(item.ts)}</span>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <div className="text-[9px] font-medium text-text-muted/60 uppercase mb-1">Just now</div>
            {MOCK_GROUP_ACTIVITY_FEED.filter((i) => Date.now() - i.ts < 600000).map((item, idx) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.04 }}
                className="text-[10px] text-text-muted px-1 py-0.5"
              >
                {item.actor}: {item.action}
              </motion.div>
            ))}
          </div>
          <div>
            <div className="text-[9px] font-medium text-text-muted/60 uppercase mb-1">Earlier</div>
            {MOCK_GROUP_ACTIVITY_FEED.filter((i) => Date.now() - i.ts >= 600000).map((item, idx) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.04 }}
                className="text-[10px] text-text-muted px-1 py-0.5"
              >
                {item.actor}: {item.action}
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
