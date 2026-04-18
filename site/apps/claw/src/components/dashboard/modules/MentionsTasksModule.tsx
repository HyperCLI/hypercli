"use client";

import { AtSign, CheckSquare } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_MENTIONS_TASKS } from "../agentViewMockData";

interface MentionsTasksModuleProps {
  variant: StyleVariant;
}

export function MentionsTasksModule({ variant }: MentionsTasksModuleProps) {
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
        <AtSign className="w-3.5 h-3.5" /> Mentions & Tasks
      </div>
      {variant === "v1" ? (
        <div className="space-y-1">
          {MOCK_MENTIONS_TASKS.map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.06 }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-low transition-colors"
            >
              {item.type === "task" ? (
                <CheckSquare className={`w-3.5 h-3.5 shrink-0 ${item.done ? "text-[#38D39F]" : "text-text-muted"}`} />
              ) : (
                <AtSign className="w-3.5 h-3.5 text-[#4A9EFF] shrink-0" />
              )}
              <span className={`text-[10px] flex-1 ${item.done ? "line-through text-text-muted" : "text-foreground"}`}>
                {item.text}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-high text-text-muted">
                {item.assignee}
              </span>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="space-y-2">
          {Array.from(new Set(MOCK_MENTIONS_TASKS.map((m) => m.assignee))).map((assignee) => (
            <div key={assignee}>
              <div className="text-[9px] font-medium text-text-muted/60 uppercase mb-0.5">{assignee}</div>
              {MOCK_MENTIONS_TASKS.filter((m) => m.assignee === assignee).map((item, idx) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.04 }}
                  className="flex items-center gap-1.5 text-[10px] px-1 py-0.5"
                >
                  {item.type === "task" ? (
                    <CheckSquare className="w-3 h-3 text-text-muted shrink-0" />
                  ) : (
                    <AtSign className="w-3 h-3 text-[#4A9EFF] shrink-0" />
                  )}
                  <span className={item.done ? "line-through text-text-muted" : "text-foreground"}>
                    {item.text}
                  </span>
                </motion.div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-0.5">
          {Array.from(new Set(MOCK_MENTIONS_TASKS.map((m) => m.assignee))).map((assignee) => {
            const tasks = MOCK_MENTIONS_TASKS.filter((m) => m.assignee === assignee);
            const done = tasks.filter((t) => t.done).length;
            return (
              <div key={assignee} className="text-[10px] text-text-muted px-1 py-0.5">
                {assignee}: {done}/{tasks.length} done
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
