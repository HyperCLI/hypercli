"use client";

import { Network } from "lucide-react";
import { motion } from "framer-motion";
import type { StyleVariant } from "../agentViewTypes";
import { MOCK_GATEWAY_STATUS } from "../agentViewMockData";
import { formatUptime } from "../agentViewUtils";

interface GatewayStatusModuleProps {
  variant: StyleVariant;
  gatewayStatus?: typeof MOCK_GATEWAY_STATUS | null;
}

export function GatewayStatusModule({ variant, gatewayStatus: gatewayStatusProp }: GatewayStatusModuleProps) {
  const gw = gatewayStatusProp ?? MOCK_GATEWAY_STATUS;
  const isMock = !gatewayStatusProp;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.34 }}
      className="relative rounded-lg border border-border p-3 space-y-2"
    >
      {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>}
      <div className="flex items-center gap-1.5">
        <motion.div
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          <Network className="w-3.5 h-3.5 text-[#38D39F]" />
        </motion.div>
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          Gateway
        </span>
        <motion.span
          className="w-1.5 h-1.5 rounded-full bg-[#38D39F] ml-auto"
          animate={{ scale: [0.8, 1.4, 0.8], opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 1 }}
        />
      </div>
      {variant === "v1" ? (
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: "Protocol", value: `v${gw.protocol}` },
            { label: "Version", value: gw.version },
            {
              label: "Uptime",
              value: formatUptime(gw.uptime),
            },
            {
              label: "Streams",
              value: String(gw.activeStreams),
            },
          ].map((item, idx) => (
            <motion.div
              key={idx}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15 + idx * 0.04 }}
              className="px-2 py-1.5 rounded-md bg-surface-low text-center"
            >
              <div className="text-[9px] text-text-muted">{item.label}</div>
              <div className="text-[10px] text-foreground font-mono font-medium">
                {item.value}
              </div>
            </motion.div>
          ))}
        </div>
      ) : variant === "v2" ? (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
          <span className="text-text-muted">
            Protocol{" "}
            <span className="text-foreground font-mono">
              v{gw.protocol}
            </span>
          </span>
          <span className="text-text-muted">
            Version{" "}
            <span className="text-foreground font-mono">
              {gw.version}
            </span>
          </span>
          <span className="text-text-muted">
            Uptime{" "}
            <span className="text-foreground font-mono">
              {formatUptime(gw.uptime)}
            </span>
          </span>
          <span className="text-text-muted">
            Streams{" "}
            <span className="text-foreground font-mono">
              {gw.activeStreams}
            </span>
          </span>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-[10px] font-mono text-text-muted"
        >
          gw v{gw.protocol} ·{" "}
          {gw.version} ·{" "}
          {formatUptime(gw.uptime)} ·{" "}
          {gw.activeStreams} stream
          {gw.activeStreams !== 1 ? "s" : ""}
        </motion.div>
      )}
    </motion.div>
  );
}
