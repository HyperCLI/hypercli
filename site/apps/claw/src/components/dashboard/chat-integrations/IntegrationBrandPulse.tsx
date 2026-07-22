"use client";

import React from "react";
import { motion, useReducedMotion } from "framer-motion";

interface IntegrationBrandPulseProps {
  active: boolean;
  accentColor: string;
  children: React.ReactNode;
  className?: string;
}

const RIPPLE_DELAYS = [0, 1.08];

export function IntegrationBrandPulse({ active, accentColor, children, className = "" }: IntegrationBrandPulseProps) {
  const reduceMotion = useReducedMotion();
  const shouldAnimate = active && !reduceMotion;
  const accentStyle = { color: accentColor } satisfies React.CSSProperties;

  return (
    <div
      className={`relative flex h-20 w-20 shrink-0 items-center justify-center sm:h-24 sm:w-24 ${className}`}
      data-integration-brand-pulse={active ? "active" : "idle"}
      style={accentStyle}
    >
      {active ? RIPPLE_DELAYS.map((delay) => (
        <motion.span
          key={delay}
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 rounded-full border sm:inset-1"
          initial={shouldAnimate ? { opacity: 0, scale: 0.82 } : { opacity: 0.14, scale: 1 }}
          animate={shouldAnimate ? { opacity: [0, 0.24, 0], scale: [0.82, 1.04, 1.32] } : { opacity: 0.14, scale: 1 }}
          transition={shouldAnimate ? { duration: 2.7, repeat: Infinity, ease: "easeOut", delay } : undefined}
          style={{ borderColor: "currentColor" }}
        />
      )) : null}
      <motion.span
        className="relative z-10 flex items-center justify-center"
        animate={shouldAnimate ? { scale: [1, 1.055, 1] } : undefined}
        transition={shouldAnimate ? { duration: 1.9, repeat: Infinity, ease: "easeInOut" } : undefined}
      >
        {children}
      </motion.span>
    </div>
  );
}
