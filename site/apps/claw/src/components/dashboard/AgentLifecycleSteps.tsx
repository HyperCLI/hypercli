"use client";

import { motion } from "framer-motion";

export type AgentLifecycleStage = "runtime" | "agent" | "gateway" | "complete";

interface AgentLifecycleStepsProps {
  stage: AgentLifecycleStage;
  className?: string;
}

const STEPS: Array<{ id: Exclude<AgentLifecycleStage, "complete">; label: string }> = [
  { id: "runtime", label: "Runtime" },
  { id: "agent", label: "Agent" },
  { id: "gateway", label: "Gateway" },
];

const STAGE_INDEX: Record<AgentLifecycleStage, number> = {
  runtime: 0,
  agent: 1,
  gateway: 2,
  complete: STEPS.length,
};

export function AgentLifecycleSteps({ stage, className = "" }: AgentLifecycleStepsProps) {
  const activeIndex = STAGE_INDEX[stage];
  const summary = STEPS
    .map((step, index) => {
      if (stage === "complete" || index < activeIndex) return `${step.label} complete`;
      if (index === activeIndex) return `${step.label} active`;
      return `${step.label} pending`;
    })
    .join(", ");

  return (
    <div className={`flex items-center gap-1.5 ${className}`} aria-label={`Agent startup progress: ${summary}`}>
      {STEPS.map((step, index) => {
        const complete = stage === "complete" || index < activeIndex;
        const active = stage !== "complete" && index === activeIndex;
        const barStyle = complete
          ? {
              background: "linear-gradient(90deg, rgba(56, 211, 159, 0.78), rgba(126, 247, 201, 1))",
              boxShadow: "0 0 14px rgba(56, 211, 159, 0.38)",
            }
          : active
            ? {
                background: "linear-gradient(90deg, rgba(240, 197, 108, 0.95), rgba(78, 167, 255, 0.78))",
                boxShadow: "0 0 16px rgba(240, 197, 108, 0.48)",
              }
            : undefined;
        return (
          <motion.span
            key={step.id}
            className={`relative h-2 overflow-hidden rounded-full border transition-colors duration-300 ${
              complete
                ? "w-6 border-[#38D39F]/40"
                : active
                  ? "w-8 border-[#f0c56c]/45"
                  : "w-2 border-border bg-surface-low"
            }`}
            style={barStyle}
            animate={active ? { scale: [1, 1.08, 1], opacity: [0.88, 1, 0.88] } : { scale: 1, opacity: complete ? 1 : 0.65 }}
            transition={active ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.25 }}
            title={`${step.label} ${complete ? "complete" : active ? "active" : "pending"}`}
          >
            {(complete || active) && (
              <motion.span
                className="absolute inset-y-0 w-3 rounded-full bg-white/70 blur-[2px]"
                initial={{ x: "-150%" }}
                animate={{ x: active ? ["-150%", "260%"] : ["-120%", "220%"] }}
                transition={{
                  duration: active ? 1.35 : 2.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: index * 0.12,
                }}
              />
            )}
          </motion.span>
        );
      })}
    </div>
  );
}
