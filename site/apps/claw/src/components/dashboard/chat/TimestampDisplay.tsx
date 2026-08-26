"use client";

import { formatTime, formatRelativeTime } from "./helpers";
import type { TimestampVariant } from "./types";

interface TimestampDisplayProps {
  timestamp?: number;
  variant: TimestampVariant;
  placement: "inside" | "outside";
  isUser: boolean;
}

export function TimestampDisplay({ timestamp, variant, placement, isUser }: TimestampDisplayProps) {
  if (!timestamp) return null;

  // v2: inside bubble after content
  if (variant === "v2" && placement === "inside") {
    return (
      <div className={`mt-2 border-t border-border/20 pt-1.5 text-[10px] text-text-secondary ${isUser ? "text-right" : "text-left"}`}>
        {formatTime(timestamp)}
      </div>
    );
  }

  // All other variants render outside the bubble
  if (placement !== "outside") return null;

  if (variant === "off") {
    return null;
  }

  if (variant === "v1") {
    return (
      <div className={`text-[10px] text-text-muted mt-1 ${isUser ? "text-right" : "text-left"}`}>
        {formatTime(timestamp)}
      </div>
    );
  }

  if (variant === "v3") {
    return (
      <div className={`text-[10px] text-primary/60 mt-1 font-mono ${isUser ? "text-right" : "text-left"}`}>
        {formatRelativeTime(timestamp)}
      </div>
    );
  }

  return null;
}
