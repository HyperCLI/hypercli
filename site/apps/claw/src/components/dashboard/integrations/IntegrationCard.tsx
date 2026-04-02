"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

export type CardStatus = "connected" | "pending" | "available" | "coming-soon" | "built-in";

interface IntegrationCardProps {
  icon: LucideIcon;
  name: string;
  status: CardStatus;
  statusText?: string;
  description?: string;
  ctaLabel?: string;
  onClick?: () => void;
}

export function IntegrationCard({
  icon: Icon,
  name,
  status,
  statusText,
  description,
  ctaLabel,
  onClick,
}: IntegrationCardProps) {
  const isDisabled = status === "coming-soon";

  return (
    <motion.button
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      className={`text-left p-4 rounded-xl border transition-all duration-200 w-full ${
        status === "connected"
          ? "border-[var(--primary)]/30 border-l-2 border-l-[var(--primary)] bg-[var(--primary)]/5 hover:bg-[var(--primary)]/8 hover:border-[var(--primary)]/50 hover:border-l-[var(--primary)] hover:shadow-[0_0_12px_rgba(56,211,159,0.08)]"
          : status === "pending"
            ? "border-amber-500/30 border-l-2 border-l-amber-500 bg-amber-500/5 hover:bg-amber-500/8 hover:border-amber-500/50 hover:border-l-amber-500"
            : status === "built-in"
              ? "border-[var(--primary)]/15 border-l-2 border-l-[var(--primary)]/40 bg-[var(--primary)]/3 hover:bg-[var(--primary)]/6 hover:border-[var(--primary)]/30 hover:border-l-[var(--primary)]/60 hover:shadow-[0_0_12px_rgba(56,211,159,0.06)]"
              : status === "coming-soon"
                ? "border-[var(--border)] bg-transparent opacity-50 cursor-default"
                : "border-[var(--border)] hover:border-[var(--primary)]/20 hover:bg-[var(--surface-low)] hover:shadow-[0_0_8px_rgba(56,211,159,0.04)]"
      }`}
      whileHover={isDisabled ? undefined : { scale: 1.01 }}
      whileTap={isDisabled ? undefined : { scale: 0.99 }}
      transition={{ duration: 0.15 }}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
            status === "connected"
              ? "bg-[var(--primary)]/15 text-[var(--primary)]"
              : status === "pending"
                ? "bg-amber-500/15 text-amber-500"
                : status === "built-in"
                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "bg-[var(--surface-high)] text-[var(--text-secondary)]"
          }`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{name}</span>
            {status === "connected" && (
              <span className="w-2 h-2 rounded-full bg-[var(--primary)]" />
            )}
            {status === "pending" && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            )}
            {status === "built-in" && (
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]/60" />
            )}
            {status === "coming-soon" && (
              <span className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
                Soon
              </span>
            )}
          </div>
          {statusText && (
            <p className="text-xs text-text-secondary mt-0.5 truncate">{statusText}</p>
          )}
          {description && (
            <p className="text-xs text-text-tertiary mt-1 line-clamp-2">{description}</p>
          )}
          {ctaLabel && !isDisabled && (
            <span className="text-xs text-[var(--primary)] font-medium mt-2 inline-block">
              {ctaLabel}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}
