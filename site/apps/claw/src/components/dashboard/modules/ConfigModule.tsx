"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Brain } from "lucide-react";
import { MOCK_CONFIG } from "../agentViewMockData";

export function ConfigModule() {
  const [configTools, setConfigTools] = useState(MOCK_CONFIG.tools);

  const toggleTool = useCallback((name: string) => {
    setConfigTools((prev) => prev.map((t) => t.name === name ? { ...t, enabled: !t.enabled } : t));
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.08 }}
      className="relative rounded-lg border border-border p-3 space-y-2.5"
    >
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Config</div>

      <motion.div
        className="flex items-center gap-2"
        initial={{ x: -12, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
      >
        <motion.div animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
          <Brain className="w-3.5 h-3.5 text-[#38D39F]" />
        </motion.div>
        <span className="text-xs font-mono text-foreground">{MOCK_CONFIG.model}</span>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
        <div className="text-[10px] text-text-muted mb-1">System prompt</div>
        <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3">
          {MOCK_CONFIG.systemPrompt}
        </p>
      </motion.div>

      <div>
        <div className="text-[10px] text-text-muted mb-1.5">Tools</div>
        <div className="flex flex-wrap gap-1">
          {configTools.map((tool, idx) => (
            <motion.button
              key={tool.name}
              onClick={() => toggleTool(tool.name)}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25 + idx * 0.04, type: "spring", stiffness: 500, damping: 25 }}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${tool.enabled
                  ? "bg-[#38D39F]/15 text-[#38D39F] hover:bg-[#38D39F]/25"
                  : "bg-surface-high text-text-muted hover:text-text-secondary"
                }`}
            >
              {tool.name}
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
