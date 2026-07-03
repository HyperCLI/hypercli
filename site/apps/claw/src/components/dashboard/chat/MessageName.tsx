"use client";

import { Sparkles } from "lucide-react";
import { agentAvatar, type AgentMeta } from "@/lib/avatar";
import { ResourceImage } from "@/components/ResourceImage";
import type { NameVariant } from "./types";

interface MessageNameProps {
  variant: NameVariant;
  placement: "avatar-left" | "above-bubble" | "text-above";
  isUser: boolean;
  effectiveName: string;
  agentMeta?: AgentMeta | null;
}

function AgentAvatarMark({
  name,
  meta,
  sizeClass,
  iconClass,
}: {
  name: string;
  meta?: AgentMeta | null;
  sizeClass: string;
  iconClass: string;
}) {
  const avatar = agentAvatar(name, meta);
  const AvatarIcon = avatar.icon;
  return (
    <div className={`relative ${sizeClass} rounded-full flex items-center justify-center overflow-hidden`} style={{ backgroundColor: avatar.bgColor }}>
      {avatar.imageUrl ? (
        <ResourceImage
          src={avatar.imageUrl}
          alt={`${name} avatar`}
          fill
          sizes="28px"
          className="object-cover"
        />
      ) : (
        <AvatarIcon className={iconClass} style={{ color: avatar.fgColor }} />
      )}
    </div>
  );
}

export function MessageName({ variant, placement, isUser, effectiveName, agentMeta }: MessageNameProps) {
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
    return (
      <AgentAvatarMark
        name={effectiveName}
        meta={agentMeta}
        sizeClass="mt-0.5 flex-shrink-0 w-7 h-7"
        iconClass="w-3.5 h-3.5"
      />
    );
  }

  // v2: text label above bubble (paired with avatar-left)
  if (variant === "v2" && placement === "text-above") {
    return <span className="mb-0.5 block max-w-full truncate text-[11px] text-text-muted">{effectiveName}</span>;
  }

  // v1: monogram + muted label above bubble
  if (variant === "v1" && placement === "above-bubble") {
    if (isUser) {
      return (
        <div className="mb-1 flex max-w-full min-w-0 items-center gap-1.5 flex-row-reverse">
          <div className="w-5 h-5 rounded-full bg-surface-low flex items-center justify-center">
            <span className="text-[9px] font-bold text-text-muted">{initial}</span>
          </div>
          <span className="block min-w-0 max-w-full truncate text-[11px] text-text-muted">{effectiveName}</span>
        </div>
      );
    }
    return (
      <div className="mb-1 flex max-w-full min-w-0 items-center gap-1.5">
        <AgentAvatarMark name={effectiveName} meta={agentMeta} sizeClass="w-5 h-5" iconClass="w-3 h-3" />
        <span className="block min-w-0 max-w-full truncate text-[11px] text-text-muted">{effectiveName}</span>
      </div>
    );
  }

  // v3: gradient sparkle circle + bold name above bubble
  if (variant === "v3" && placement === "above-bubble") {
    if (isUser) {
      return (
        <div className="mb-1 flex max-w-full min-w-0 items-center gap-1.5 flex-row-reverse">
          <div className="w-5 h-5 rounded-full bg-surface-low flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-text-muted" />
          </div>
          <span className="block min-w-0 max-w-full truncate text-[11px] font-semibold text-foreground">{effectiveName}</span>
        </div>
      );
    }
    return (
      <div className="mb-1 flex max-w-full min-w-0 items-center gap-1.5">
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#4285f4] via-primary to-[#f0c56c] flex items-center justify-center">
          <Sparkles className="w-3 h-3 text-white" />
        </div>
        <span className="block min-w-0 max-w-full truncate text-[11px] font-semibold text-foreground">{effectiveName}</span>
      </div>
    );
  }

  return null;
}
