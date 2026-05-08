"use client";

import { useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AgentLifecycleSteps } from "@/components/dashboard/AgentLifecycleSteps";

type HatchState = "PENDING" | "STARTING" | "RUNNING";

interface AgentHatchAnimationProps {
  state: HatchState;
  /** Called after the burst animation completes on RUNNING arrival */
  onBurstComplete?: () => void;
}

const STATUS_TEXT: Record<HatchState, { title: string; detail: string }> = {
  PENDING: {
    title: "Provisioning runtime",
    detail: "Reserving compute and preparing the workspace.",
  },
  STARTING: {
    title: "Booting agent",
    detail: "Starting the container and OpenClaw services.",
  },
  RUNNING: {
    title: "Runtime ready",
    detail: "Opening the gateway connection.",
  },
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
  const id = useId().replace(/:/g, "");
  const isPending = state === "PENDING";
  const isStarting = state === "STARTING";
  const isRunning = state === "RUNNING";
  const accent = isRunning ? "#38D39F" : "#f0c56c";
  const secondaryAccent = isRunning ? "#7ef7c9" : "#4ea7ff";
  const lifecycleStage = state === "PENDING" ? "runtime" : state === "STARTING" ? "agent" : "complete";
  const ringGradientId = `agent-hatch-ring-${id}`;
  const coreGradientId = `agent-hatch-core-${id}`;

  // Ring config per state
  const outerDuration = isPending ? 6 : isStarting ? 2.6 : 1.2;
  const middleDuration = isPending ? 8.5 : isStarting ? 2.1 : 0.9;
  const innerDuration = isPending ? 10 : isStarting ? 1.7 : 0.75;

  const outerOpacity = isPending ? 0.32 : isStarting ? 0.62 : 0.72;
  const middleOpacity = isPending ? 0.22 : isStarting ? 0.5 : 0.72;
  const innerOpacity = isPending ? 0.18 : isStarting ? 0.46 : 0.72;

  const coreSize = isPending ? 7 : isStarting ? 11 : 16;
  const coreOpacity = isPending ? 0.58 : isStarting ? 0.86 : 1;
  const glowSpread = isPending ? 24 : isStarting ? 36 : 52;
  const glowOpacity = isPending ? 0.26 : isStarting ? 0.5 : 0.68;

  // For collapse on RUNNING
  const outerR = isRunning ? 30 : 50;
  const middleR = isRunning ? 25 : 38;
  const innerR = isRunning ? 20 : 26;

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-8">
      <div className="relative h-[132px] w-[132px]">
        {/* Glow background */}
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{
            boxShadow: [
              `0 0 ${glowSpread * 0.65}px ${isRunning ? `rgba(56, 211, 159, ${glowOpacity * 0.75})` : `rgba(240, 197, 108, ${glowOpacity * 0.75})`}`,
              `0 0 ${glowSpread}px ${isRunning ? `rgba(56, 211, 159, ${glowOpacity})` : `rgba(240, 197, 108, ${glowOpacity})`}`,
              `0 0 ${glowSpread * 0.65}px ${isRunning ? `rgba(56, 211, 159, ${glowOpacity * 0.75})` : `rgba(240, 197, 108, ${glowOpacity * 0.75})`}`,
            ],
            scale: [0.98, 1.04, 0.98],
          }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />

        <svg viewBox="0 0 120 120" className="w-full h-full">
          <defs>
            <linearGradient id={ringGradientId} x1="18" y1="18" x2="102" y2="102" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor={secondaryAccent} />
              <stop offset="48%" stopColor={accent} />
              <stop offset="100%" stopColor={isRunning ? "#ffffff" : "#ffe6a3"} />
            </linearGradient>
            <radialGradient id={coreGradientId} cx="50%" cy="45%" r="55%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="42%" stopColor={accent} />
              <stop offset="100%" stopColor={secondaryAccent} stopOpacity="0.9" />
            </radialGradient>
          </defs>
          {/* Outer ring */}
          <motion.circle
            cx="60"
            cy="60"
            r={outerR}
            fill="none"
            stroke={`url(#${ringGradientId})`}
            strokeWidth="2.5"
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
            stroke={`url(#${ringGradientId})`}
            strokeWidth="2.25"
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
            stroke={`url(#${ringGradientId})`}
            strokeWidth="1.8"
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

          {/* Fast energy sweep */}
          <motion.circle
            cx="60"
            cy="60"
            r={isRunning ? 34 : 48}
            fill="none"
            stroke={secondaryAccent}
            strokeWidth="3"
            strokeDasharray="18 284"
            strokeLinecap="round"
            animate={{
              rotate: 360,
              opacity: isPending ? [0.25, 0.55, 0.25] : [0.45, 0.95, 0.45],
            }}
            transition={{
              rotate: { duration: isPending ? 3.4 : 1.35, repeat: Infinity, ease: "linear" },
              opacity: { duration: 1.4, repeat: Infinity, ease: "easeInOut" },
            }}
            style={{ transformOrigin: "60px 60px", filter: `drop-shadow(0 0 5px ${secondaryAccent})` }}
          />

          {/* Core dot */}
          <motion.circle
            cx="60"
            cy="60"
            fill={`url(#${coreGradientId})`}
            animate={{
              r: coreSize,
              opacity: coreOpacity,
            }}
            transition={{
              r: { duration: 0.6, type: "spring", stiffness: 200, damping: 15 },
              opacity: { duration: 0.4 },
            }}
          />

          {/* Pulsing halo on core */}
          <motion.circle
            cx="60"
            cy="60"
            fill="none"
            stroke={accent}
            strokeWidth="1"
            animate={{ opacity: [0.18, 0.58, 0.18], r: [coreSize + 3, coreSize + 13, coreSize + 3] }}
            transition={{ duration: isPending ? 2 : 1.35, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.circle
            cx="60"
            cy="60"
            fill="none"
            stroke={secondaryAccent}
            strokeWidth="1"
            animate={{ opacity: [0.05, 0.34, 0.05], r: [coreSize + 7, coreSize + 21, coreSize + 7] }}
            transition={{ duration: isPending ? 2.4 : 1.65, repeat: Infinity, ease: "easeInOut", delay: 0.18 }}
          />
        </svg>

        {/* Burst flash on RUNNING arrival */}
        <AnimatePresence>
          {isRunning && (
            <motion.div
              key="running-burst"
              className="absolute inset-0 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(126,247,201,0.74) 28%, rgba(56,211,159,0.22) 58%, transparent 72%)" }}
              initial={{ opacity: 0.7, scale: 0.5 }}
              animate={{ opacity: 0, scale: 2.5 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              onAnimationComplete={onBurstComplete}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Status text with transition */}
      <AnimatePresence mode="wait">
        <motion.div
          key={state}
          className="text-center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
        >
          <p className="text-sm font-medium text-foreground">{STATUS_TEXT[state].title}</p>
          <p className="mt-1 max-w-xs text-xs text-text-muted">{STATUS_TEXT[state].detail}</p>
        </motion.div>
      </AnimatePresence>
      <AgentLifecycleSteps stage={lifecycleStage} />
    </div>
  );
}
