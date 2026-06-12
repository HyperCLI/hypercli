"use client";

import type { ComponentType, ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "../ui/utils";

export type ResourceCardStatus = "available" | "connected" | "pending" | "built-in" | "coming-soon" | "saving" | "active";

const statusClasses: Record<ResourceCardStatus, string> = {
  available: "border-border hover:border-[rgb(var(--selection-accent-rgb)_/_0.2)] hover:bg-surface-low hover:shadow-[0_0_8px_rgb(var(--selection-accent-rgb)_/_0.04)]",
  connected: "border-[rgb(var(--selection-accent-rgb)_/_0.3)] border-l-2 border-l-[var(--selection-accent)] bg-[rgb(var(--selection-accent-rgb)_/_0.05)] hover:bg-[rgb(var(--selection-accent-rgb)_/_0.08)] hover:border-[rgb(var(--selection-accent-rgb)_/_0.5)] hover:border-l-[var(--selection-accent)] hover:shadow-[0_0_12px_rgb(var(--selection-accent-rgb)_/_0.08)]",
  pending: "border-warning/30 border-l-2 border-l-warning bg-warning/5 hover:bg-warning/10 hover:border-warning/50 hover:border-l-warning",
  "built-in": "border-[rgb(var(--selection-accent-rgb)_/_0.15)] border-l-2 border-l-[rgb(var(--selection-accent-rgb)_/_0.4)] bg-[rgb(var(--selection-accent-rgb)_/_0.03)] hover:bg-[rgb(var(--selection-accent-rgb)_/_0.06)] hover:border-[rgb(var(--selection-accent-rgb)_/_0.3)] hover:border-l-[rgb(var(--selection-accent-rgb)_/_0.6)] hover:shadow-[0_0_12px_rgb(var(--selection-accent-rgb)_/_0.06)]",
  "coming-soon": "border-border bg-transparent opacity-50 cursor-default",
  saving: "border-border bg-surface-low opacity-70 pointer-events-none",
  active: "border-[rgb(var(--selection-accent-rgb)_/_0.3)] border-l-2 border-l-[var(--selection-accent)] bg-[rgb(var(--selection-accent-rgb)_/_0.05)] hover:bg-[rgb(var(--selection-accent-rgb)_/_0.08)] hover:border-[rgb(var(--selection-accent-rgb)_/_0.5)]",
};

const iconClasses: Record<ResourceCardStatus, string> = {
  available: "bg-surface-high text-text-secondary",
  connected: "bg-[rgb(var(--selection-accent-rgb)_/_0.15)] text-[var(--selection-accent)]",
  pending: "bg-warning/15 text-warning",
  "built-in": "bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]",
  "coming-soon": "bg-surface-high text-text-secondary",
  saving: "bg-surface-high text-text-secondary",
  active: "bg-[rgb(var(--selection-accent-rgb)_/_0.15)] text-[var(--selection-accent)]",
};

export interface ResourceCardProps {
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  status?: ResourceCardStatus;
  statusText?: ReactNode;
  description?: ReactNode;
  ctaLabel?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function ResourceCard({
  icon: Icon,
  title,
  status = "available",
  statusText,
  description,
  ctaLabel,
  trailing,
  onClick,
  disabled = false,
  className,
}: ResourceCardProps) {
  const isDisabled = disabled || status === "coming-soon";

  return (
    <motion.button
      type="button"
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      className={cn("w-full rounded-xl border p-4 text-left transition-all duration-200", statusClasses[status], className)}
      whileHover={isDisabled ? undefined : { scale: 1.01 }}
      whileTap={isDisabled ? undefined : { scale: 0.99 }}
      transition={{ duration: 0.15 }}
    >
      <div className="flex items-start gap-3">
        <div className={cn("flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg", iconClasses[status])}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{title}</span>
              {status === "connected" && <span className="h-2 w-2 rounded-full bg-[var(--selection-accent)]" />}
              {status === "pending" && <span className="h-2 w-2 animate-pulse rounded-full bg-warning" />}
              {status === "built-in" && <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.6)]" />}
              {status === "coming-soon" && <span className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Soon</span>}
            </div>
            {trailing}
          </div>
          {statusText && <p className="mt-0.5 truncate text-xs text-text-secondary">{statusText}</p>}
          {description && <p className="mt-1 line-clamp-2 text-xs text-text-tertiary">{description}</p>}
          {ctaLabel && !isDisabled && <span className="mt-2 inline-block text-xs font-medium text-[var(--primary)]">{ctaLabel}</span>}
        </div>
      </div>
    </motion.button>
  );
}
