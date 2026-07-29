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
  agentAvatarUrl?: string | null;
  userAvatarUrl?: string | null;
}

function AgentAvatarMark({
  name,
  meta,
  avatarUrl,
  sizeClass,
  iconClass,
}: {
  name: string;
  meta?: AgentMeta | null;
  avatarUrl?: string | null;
  sizeClass: string;
  iconClass: string;
}) {
  const avatar = agentAvatar(name, meta, avatarUrl);
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

function UserAvatarMark({
  avatarUrl,
  initial,
  sizeClass,
  initialClass = "text-[9px] font-bold text-text-muted",
  sparkle = false,
}: {
  avatarUrl?: string | null;
  initial: string;
  sizeClass: string;
  initialClass?: string;
  sparkle?: boolean;
}) {
  return (
    <div className={`relative ${sizeClass} rounded-full bg-surface-low flex items-center justify-center overflow-hidden`}>
      {avatarUrl ? (
        <ResourceImage src={avatarUrl} alt="Profile avatar" fill sizes="28px" className="object-cover" />
      ) : sparkle ? (
        <Sparkles className="w-3 h-3 text-text-muted" />
      ) : (
        <span className={initialClass}>{initial}</span>
      )}
    </div>
  );
}

export function MessageName({ variant, placement, isUser, effectiveName, agentMeta, agentAvatarUrl, userAvatarUrl }: MessageNameProps) {
  const initial = effectiveName[0]?.toUpperCase() ?? (isUser ? "Y" : "A");

  // v2: avatar circle to the left of the bubble
  if (variant === "v2" && placement === "avatar-left") {
    if (isUser) {
      return (
        <UserAvatarMark
          avatarUrl={userAvatarUrl}
          initial={initial}
          sizeClass="mt-0.5 flex-shrink-0 w-7 h-7"
          initialClass="text-[10px] font-bold text-text-muted"
        />
      );
    }
    return (
      <AgentAvatarMark
        name={effectiveName}
        meta={agentMeta}
        avatarUrl={agentAvatarUrl}
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
          <UserAvatarMark avatarUrl={userAvatarUrl} initial={initial} sizeClass="w-5 h-5" />
          <span className="block min-w-0 max-w-full truncate text-[11px] text-text-muted">{effectiveName}</span>
        </div>
      );
    }
    return (
      <div className="mb-1 flex max-w-full min-w-0 items-center gap-1.5">
        <AgentAvatarMark name={effectiveName} meta={agentMeta} avatarUrl={agentAvatarUrl} sizeClass="w-5 h-5" iconClass="w-3 h-3" />
        <span className="block min-w-0 max-w-full truncate text-[11px] text-text-muted">{effectiveName}</span>
      </div>
    );
  }

  // v3: gradient sparkle circle + bold name above bubble
  if (variant === "v3" && placement === "above-bubble") {
    if (isUser) {
      return (
        <div className="mb-1 flex max-w-full min-w-0 items-center gap-1.5 flex-row-reverse">
          <UserAvatarMark avatarUrl={userAvatarUrl} initial={initial} sizeClass="w-5 h-5" sparkle />
          <span className="block min-w-0 max-w-full truncate text-[11px] font-semibold text-foreground">{effectiveName}</span>
        </div>
      );
    }
    return (
      <div className="mb-1 flex max-w-full min-w-0 items-center gap-1.5">
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-info via-primary to-warning flex items-center justify-center">
          <Sparkles className="w-3 h-3 text-info-foreground" />
        </div>
        <span className="block min-w-0 max-w-full truncate text-[11px] font-semibold text-foreground">{effectiveName}</span>
      </div>
    );
  }

  return null;
}
