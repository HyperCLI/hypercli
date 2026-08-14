"use client";

import type { ComponentType, ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";

export type NoticeTone = "neutral" | "success" | "warning" | "danger" | "accent";

const noticeToneClass: Record<NoticeTone, string> = {
  neutral: "border-border bg-surface-low text-text-secondary",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  accent: "border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] text-[var(--selection-accent)]",
};

const defaultNoticeIcon: Record<NoticeTone, ComponentType<{ className?: string }>> = {
  neutral: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: AlertCircle,
  accent: Info,
};

export function StatusNotice({
  tone = "neutral",
  title,
  children,
  icon,
  className,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}) {
  const Icon = icon ?? defaultNoticeIcon[tone];

  return (
    <div className={cn("flex gap-3 rounded-xl border p-4", noticeToneClass[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="min-w-0">
        {title && <div className="text-sm font-semibold text-foreground">{title}</div>}
        {children && <div className={cn("text-sm leading-relaxed", Boolean(title) && "mt-1")}>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionIcon: ActionIcon = RefreshCw,
  actionIconPosition = "start",
  footnote,
  tone = "neutral",
  presentation = "compact",
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  actionLabel?: ReactNode;
  onAction?: () => void;
  actionIcon?: ComponentType<{ className?: string }>;
  actionIconPosition?: "start" | "end";
  footnote?: ReactNode;
  tone?: NoticeTone;
  presentation?: "compact" | "prominent";
  className?: string;
}) {
  const prominent = presentation === "prominent";
  const iconClass = tone === "danger" ? "text-destructive" : tone === "accent" ? "text-[var(--selection-accent)]" : "text-text-muted/45";

  return (
    <motion.div
      data-slot="empty-state"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        prominent
          ? "flex min-h-[28rem] flex-1 flex-col items-center justify-center px-6 py-16 text-center sm:px-10"
          : "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
        className={prominent ? "flex size-10 items-center justify-center rounded-xl border border-border bg-surface-high" : undefined}
      >
        <Icon className={cn(prominent ? "size-4 text-foreground" : "h-8 w-8", !prominent && iconClass)} />
      </motion.div>
      <div className={prominent ? "mt-4 space-y-3" : "space-y-1"}>
        {prominent ? (
          <h2 className="text-balance text-2xl font-medium tracking-[-0.03em] text-foreground sm:text-3xl">{title}</h2>
        ) : (
          <p className="text-sm font-medium text-foreground">{title}</p>
        )}
        {description ? (
          <p className={prominent ? "max-w-2xl text-sm leading-6 text-text-muted sm:text-base" : "max-w-[240px] text-[11px] leading-relaxed text-text-muted"}>
            {description}
          </p>
        ) : null}
      </div>
      {footnote && <div className="mt-1 text-[11px] text-text-muted">{footnote}</div>}
      {actionLabel && onAction && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className={prominent ? "mt-7" : "mt-1"}
        >
          <Button
            type="button"
            variant={prominent ? "default" : "outline"}
            size={prominent ? "lg" : "sm"}
            onClick={onAction}
            className={prominent ? "rounded-xl" : "h-auto rounded-lg px-3 py-1.5 text-[11px]"}
          >
            {actionIconPosition === "start" ? <ActionIcon className={prominent ? "size-4" : "size-3"} /> : null}
            {actionLabel}
            {actionIconPosition === "end" ? <ActionIcon className={prominent ? "size-4" : "size-3"} /> : null}
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}

export function LoadingState({
  title = "Loading",
  description,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <Loader2 className="h-6 w-6 animate-spin text-[var(--selection-accent)]" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="max-w-[260px] text-xs text-text-muted">{description}</p>}
      </div>
    </div>
  );
}
