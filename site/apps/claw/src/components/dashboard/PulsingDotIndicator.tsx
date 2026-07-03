"use client";

import { motion } from "framer-motion";

interface PulsingDotIndicatorProps {
  className?: string;
  "aria-label"?: string;
}

export function PulsingDotIndicator({ className = "", "aria-label": ariaLabel }: PulsingDotIndicatorProps) {
  return (
    <motion.span
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={`inline-block h-2 w-2 rounded-full bg-primary ${className}`.trim()}
      animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }}
      transition={{ repeat: Infinity, duration: 1.0, ease: "easeInOut" }}
    />
  );
}
