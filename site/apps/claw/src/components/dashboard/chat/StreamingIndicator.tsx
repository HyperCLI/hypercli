"use client";

import { motion } from "framer-motion";
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
        <motion.span
          className="inline-block w-2 h-2 rounded-full bg-[#38D39F] ml-1.5 align-middle"
          animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 1.0, ease: "easeInOut" }}
        />
      )}
      {variant === "v3" && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(105deg, transparent 30%, rgba(56,211,159,0.08) 50%, transparent 70%)",
          }}
          animate={{ x: ["-120%", "140%"] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}
        />
      )}
    </>
  );
}
