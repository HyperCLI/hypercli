"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { StyleVariant } from "../agentViewTypes";
import { MODEL_CAPABILITIES } from "../agentViewMockData";

interface ModelCapsModuleProps {
  variant: StyleVariant;
  capabilities?: typeof MODEL_CAPABILITIES | null;
}

export function ModelCapsModule({ variant, capabilities: capabilitiesProp }: ModelCapsModuleProps) {
  const caps = capabilitiesProp ?? MODEL_CAPABILITIES;
  const isMock = !capabilitiesProp;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.12 }}
      className="relative rounded-lg border border-border p-3 space-y-2">
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>}
      <div className="flex items-center gap-1.5">
        <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ repeat: Infinity, duration: 4 }}>
          <Sparkles className="w-3.5 h-3.5 text-[#38D39F]" />
        </motion.div>
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Model Capabilities</span>
      </div>
      {variant === "v1" ? (
        // v1: Grid of capability badges
        <div className="grid grid-cols-2 gap-1.5">
          {caps.map((cap, idx) => {
            const CapIcon = cap.icon;
            return (
              <motion.div key={idx} initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.15 + idx * 0.05, type: "spring", stiffness: 460, damping: 22 }}
                whileHover={{ y: -2 }}
                className={`rounded-lg p-2 border ${cap.enabled ? "border-[#38D39F]/20 bg-[#38D39F]/5" : "border-border"}`}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <motion.div animate={cap.enabled ? { scale: [1, 1.1, 1] } : {}} transition={{ repeat: Infinity, duration: 3, delay: idx * 0.4 }}>
                    <CapIcon className={`w-3 h-3 ${cap.enabled ? "text-[#38D39F]" : "text-text-muted"}`} />
                  </motion.div>
                  <span className="text-[10px] font-medium text-foreground">{cap.label}</span>
                </div>
                <p className="text-[9px] text-text-muted leading-tight">{cap.desc}</p>
              </motion.div>
            );
          })}
        </div>
      ) : variant === "v2" ? (
        // v2: Horizontal chip row
        <div className="flex flex-wrap gap-1">
          {caps.map((cap, idx) => {
            const CapIcon = cap.icon;
            return (
              <motion.div key={idx} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.12 + idx * 0.04 }} whileHover={{ scale: 1.05 }}
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${cap.enabled ? "bg-[#38D39F]/10 text-[#38D39F]" : "bg-surface-high text-text-muted"}`}>
                <CapIcon className="w-3 h-3" />
                {cap.label}
                {cap.enabled && <motion.span className="w-1 h-1 rounded-full bg-[#38D39F]"
                  animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1, delay: idx * 0.15 }} />}
              </motion.div>
            );
          })}
        </div>
      ) : (
        // v3: Compact list
        <div className="space-y-0.5">
          {caps.map((cap, idx) => {
            const CapIcon = cap.icon;
            return (
              <motion.div key={idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.03 }}
                className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface-low transition-colors">
                <CapIcon className={`w-3 h-3 ${cap.enabled ? "text-[#38D39F]" : "text-text-muted"}`} />
                <span className="text-[10px] text-foreground">{cap.label}</span>
                <span className="text-[9px] text-text-muted hidden group-hover:inline ml-auto">{cap.desc}</span>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
