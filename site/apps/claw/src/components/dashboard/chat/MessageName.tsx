"use client";

import { Sparkles } from "lucide-react";
import { agentAvatar } from "@/lib/avatar";
import type { NameVariant } from "./types";

interface MessageNameProps {
  variant: NameVariant;
  placement: "avatar-left" | "above-bubble" | "text-above";
  isUser: boolean;
  effectiveName: string;
}

export function MessageName({ variant, placement, isUser, effectiveName }: MessageNameProps) {
  const initial = effectiveName[0]?.toUpperCase() ?? (isUser ? "Y" : "A");

  // v2: avatar circle to the left of the bubble
  if (variant === "v2" && placement === "avatar-left") {
    if (isUser) {
      return (
        <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full bg-surface-low flex items-center justify-center">
          <span className="text-[10px] font-bold text-text-muted">{initial}</span>
        </div>
      );
    }
    const av = agentAvatar(effectiveName);
    return (
      <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: av.bgColor }}>
        <span className="text-[10px] font-bold" style={{ color: av.fgColor }}>{initial}</span>
      </div>
    );
  }

  // v2: text label above bubble (paired with avatar-left)
  if (variant === "v2" && placement === "text-above") {
    return <span className="text-[11px] text-text-muted mb-0.5">{effectiveName}</span>;
  }

  // v1: monogram + muted label above bubble
  if (variant === "v1" && placement === "above-bubble") {
    if (isUser) {
      return (
        <div className="flex items-center gap-1.5 mb-1 flex-row-reverse">
          <div className="w-5 h-5 rounded-full bg-surface-low flex items-center justify-center">
            <span className="text-[9px] font-bold text-text-muted">{initial}</span>
          </div>
          <span className="text-[11px] text-text-muted">{effectiveName}</span>
        </div>
      );
    }
    const av = agentAvatar(effectiveName);
    return (
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: av.bgColor }}>
          <span className="text-[9px] font-bold" style={{ color: av.fgColor }}>{initial}</span>
        </div>
        <span className="text-[11px] text-text-muted">{effectiveName}</span>
      </div>
    );
  }

  // v3: gradient sparkle circle + bold name above bubble
  if (variant === "v3" && placement === "above-bubble") {
    if (isUser) {
      return (
        <div className="flex items-center gap-1.5 mb-1 flex-row-reverse">
          <div className="w-5 h-5 rounded-full bg-surface-low flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-text-muted" />
          </div>
          <span className="text-[11px] font-semibold text-foreground">{effectiveName}</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#4285f4] via-[#38D39F] to-[#f0c56c] flex items-center justify-center">
          <Sparkles className="w-3 h-3 text-white" />
        </div>
        <span className="text-[11px] font-semibold text-foreground">{effectiveName}</span>
      </div>
    );
  }

  return null;
}
