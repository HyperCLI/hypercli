"use client";

import { Brain } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_PROVIDERS } from "../agentViewMockData";

interface ProvidersModuleProps {
  variant: StyleVariant;
}

export function ProvidersModule({ variant }: ProvidersModuleProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.28 }}
      className="relative rounded-lg border border-border p-3 space-y-2"
    >
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>
      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
        Model Providers
      </div>
      {variant === "v1" ? (
        <div className="space-y-2">
          {MOCK_PROVIDERS.map((prov, idx) => (
            <motion.div
              key={prov.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + idx * 0.08 }}
              className="rounded-lg border border-border px-3 py-2 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  {prov.name}
                </span>
                <span className="text-[9px] text-text-muted">
                  {prov.models.length} models
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {prov.models.map((m) => (
                  <motion.span
                    key={m}
                    whileHover={{ scale: 1.05 }}
                    className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono ${m === prov.defaultModel ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-high text-text-muted"}`}
                  >
                    {m}
                    {m === prov.defaultModel && " \u2605"}
                  </motion.span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="space-y-1">
          {MOCK_PROVIDERS.flatMap((prov) =>
            prov.models.map((m) => ({
              model: m,
              provider: prov.name,
              isDefault: m === prov.defaultModel,
            })),
          ).map((item, idx) => (
            <motion.div
              key={item.model}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: idx * 0.04 }}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-low transition-colors text-[10px]"
            >
              <motion.div
                animate={item.isDefault ? { scale: [1, 1.15, 1] } : {}}
                transition={{ repeat: Infinity, duration: 2.5 }}
              >
                <Brain
                  className={`w-3 h-3 ${item.isDefault ? "text-[#38D39F]" : "text-text-muted"}`}
                />
              </motion.div>
              <span className="font-mono text-foreground">{item.model}</span>
              <span className="text-text-muted ml-auto">{item.provider}</span>
              {item.isDefault && (
                <motion.span
                  className="w-1.5 h-1.5 rounded-full bg-[#38D39F]"
                  animate={{
                    scale: [0.75, 1.35, 0.75],
                    opacity: [0.5, 1, 0.5],
                  }}
                  transition={{ repeat: Infinity, duration: 1 }}
                />
              )}
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {MOCK_PROVIDERS.flatMap((p) => p.models).map((m, idx) => (
            <motion.span
              key={m}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: idx * 0.04 }}
              className="text-[9px] px-2 py-0.5 rounded-full bg-surface-low font-mono text-text-muted"
            >
              {m}
            </motion.span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
