"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type HatchState = "PENDING" | "STARTING" | "RUNNING";

interface AgentHatchAnimationProps {
  state: HatchState;
  /** Called after the burst animation completes on RUNNING arrival */
  onBurstComplete?: () => void;
}

const STATUS_TEXT: Record<HatchState, string> = {
  PENDING: "Provisioning resources\u2026",
  STARTING: "Booting container\u2026",
  RUNNING: "Agent is live",
};

/**
 * "Energy Coalescing" animation for agent startup.
 *
 * 3 concentric SVG ring segments using stroke-dasharray + rotation.
 * PENDING  -> outer ring spins slowly, inner rings dim, tiny pulsing core
 * STARTING -> all rings spin faster, core grows, glow intensifies
 * RUNNING  -> rings collapse inward, core bursts, green flash
 */
export function AgentHatchAnimation({ state, onBurstComplete }: AgentHatchAnimationProps) {
  const [showBurst, setShowBurst] = useState(false);

  useEffect(() => {
    if (state === "RUNNING") {
      setShowBurst(true);
      const t = setTimeout(() => {
        setShowBurst(false);
        onBurstComplete?.();
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [state, onBurstComplete]);

  const isPending = state === "PENDING";
  const isStarting = state === "STARTING";
  const isRunning = state === "RUNNING";

  // Ring config per state
  const outerDuration = isPending ? 8 : isStarting ? 3 : 1;
  const middleDuration = isPending ? 12 : isStarting ? 2.5 : 0.8;
  const innerDuration = isPending ? 16 : isStarting ? 2 : 0.6;

  const outerOpacity = isPending ? 0.15 : isStarting ? 0.4 : 0.6;
  const middleOpacity = isPending ? 0.1 : isStarting ? 0.3 : 0.6;
  const innerOpacity = isPending ? 0.08 : isStarting ? 0.25 : 0.6;

  const coreSize = isPending ? 6 : isStarting ? 10 : 16;
  const coreOpacity = isPending ? 0.4 : isStarting ? 0.7 : 1;
  const glowSpread = isPending ? 10 : isStarting ? 20 : 40;
  const glowOpacity = isPending ? 0.15 : isStarting ? 0.35 : 0.6;

  // For collapse on RUNNING
  const outerR = isRunning && showBurst ? 30 : 50;
  const middleR = isRunning && showBurst ? 25 : 38;
  const innerR = isRunning && showBurst ? 20 : 26;

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-8">
      <div className="relative w-[120px] h-[120px]">
        {/* Glow background */}
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{
            boxShadow: `0 0 ${glowSpread}px rgba(56, 211, 159, ${glowOpacity})`,
          }}
          transition={{ duration: 0.6 }}
        />

        <svg viewBox="0 0 120 120" className="w-full h-full">
          {/* Outer ring */}
          <motion.circle
            cx="60"
            cy="60"
            r={outerR}
            fill="none"
            stroke="#38D39F"
            strokeWidth="2"
            strokeDasharray="80 240"
            strokeLinecap="round"
            animate={{
              rotate: 360,
              opacity: outerOpacity,
              r: outerR,
            }}
            transition={{
              rotate: { duration: outerDuration, repeat: Infinity, ease: "linear" },
              opacity: { duration: 0.5 },
              r: { duration: 0.6, type: "spring", stiffness: 200, damping: 20 },
            }}
            style={{ transformOrigin: "60px 60px" }}
          />

          {/* Middle ring */}
          <motion.circle
            cx="60"
            cy="60"
            r={middleR}
            fill="none"
            stroke="#38D39F"
            strokeWidth="2"
            strokeDasharray="60 180"
            strokeLinecap="round"
            animate={{
              rotate: -360,
              opacity: middleOpacity,
              r: middleR,
            }}
            transition={{
              rotate: { duration: middleDuration, repeat: Infinity, ease: "linear" },
              opacity: { duration: 0.5 },
              r: { duration: 0.6, type: "spring", stiffness: 200, damping: 20 },
            }}
            style={{ transformOrigin: "60px 60px" }}
          />

          {/* Inner ring */}
          <motion.circle
            cx="60"
            cy="60"
            r={innerR}
            fill="none"
            stroke="#38D39F"
            strokeWidth="1.5"
            strokeDasharray="40 120"
            strokeLinecap="round"
            animate={{
              rotate: 360,
              opacity: innerOpacity,
              r: innerR,
            }}
            transition={{
              rotate: { duration: innerDuration, repeat: Infinity, ease: "linear" },
              opacity: { duration: 0.5 },
              r: { duration: 0.6, type: "spring", stiffness: 200, damping: 20 },
            }}
            style={{ transformOrigin: "60px 60px" }}
          />

          {/* Core dot */}
          <motion.circle
            cx="60"
            cy="60"
            fill="#38D39F"
            animate={{
              r: coreSize,
              opacity: coreOpacity,
            }}
            transition={{
              r: { duration: 0.6, type: "spring", stiffness: 200, damping: 15 },
              opacity: { duration: 0.4 },
            }}
          />

          {/* Pulsing halo on core (PENDING only) */}
          {isPending && (
            <motion.circle
              cx="60"
              cy="60"
              r="8"
              fill="none"
              stroke="#38D39F"
              strokeWidth="1"
              animate={{ opacity: [0.2, 0.5, 0.2], r: [8, 14, 8] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </svg>

        {/* Burst flash on RUNNING arrival */}
        <AnimatePresence>
          {showBurst && isRunning && (
            <motion.div
              className="absolute inset-0 rounded-full bg-[#38D39F]"
              initial={{ opacity: 0.7, scale: 0.5 }}
              animate={{ opacity: 0, scale: 2.5 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Status text with transition */}
      <AnimatePresence mode="wait">
        <motion.p
          key={state}
          className="text-sm text-text-secondary font-medium"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
        >
          {STATUS_TEXT[state]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
