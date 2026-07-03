"use client";

import { motion } from "framer-motion";
import { PulsingDotIndicator } from "@/components/dashboard/PulsingDotIndicator";
import type { StreamingVariant } from "./types";

interface StreamingIndicatorProps {
  variant: StreamingVariant;
  isStreaming: boolean;
  isUser: boolean;
}

export function StreamingIndicator({ variant, isStreaming, isUser }: StreamingIndicatorProps) {
  if (!isStreaming || isUser) return null;

  return (
    <>
      {variant === "v1" && (
        <motion.span
          className="inline-block w-[2px] h-[0.85em] bg-foreground/70 ml-0.5 align-text-bottom rounded-sm"
          animate={{ opacity: [1, 0, 1] }}
          transition={{ repeat: Infinity, duration: 0.75, ease: "linear" }}
        />
      )}
      {variant === "v2" && (
        <PulsingDotIndicator className="ml-1.5 align-middle" />
      )}
      {variant === "v3" && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(105deg, transparent 30%, rgb(var(--selection-accent-rgb) / 0.08) 50%, transparent 70%)",
          }}
          animate={{ x: ["-120%", "140%"] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}
        />
      )}
    </>
  );
}
