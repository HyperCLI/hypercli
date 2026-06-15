"use client";

import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

export type ChatCardTone = "neutral" | "primary" | "warning" | "danger" | "info";

export interface ChatCardStatus {
  label: string;
  tone?: ChatCardTone;
}

export interface ChatCardProps {
  /** Visual accent for the left bar / icon tint. */
  tone?: ChatCardTone;
  /** Lucide icon shown next to the title. */
  icon?: LucideIcon;
  /** Primary card title. */
  title: string;
  /** Optional muted line below the title (e.g. command name, file path). */
  subtitle?: string;
  /** Optional pill-shaped status indicator on the right side of the header. */
  status?: ChatCardStatus;
  /** Body content. Hidden when collapsed. */
  children?: ReactNode;
  /** Footer / action area (right-aligned button row). */
  actions?: ReactNode;
  /** When true, header click toggles body visibility. */
  collapsible?: boolean;
  /** Initial open state when collapsible. */
  defaultOpen?: boolean;
  /** Controlled open state. When provided, ignores defaultOpen. */
  open?: boolean;
  /** Controlled toggle handler. */
  onOpenChange?: (open: boolean) => void;
}

const TONE_BORDER: Record<ChatCardTone, string> = {
  neutral: "border-l-text-muted",
  primary: "border-l-primary",
  warning: "border-l-warning",
  danger: "border-l-destructive",
  info: "border-l-chart-2",
};

const TONE_BG: Record<ChatCardTone, string> = {
  neutral: "bg-background/60",
  primary: "bg-primary/10",
  warning: "bg-warning/10",
  danger: "bg-destructive/10",
  info: "bg-chart-2/10",
};

const TONE_ICON: Record<ChatCardTone, string> = {
  neutral: "text-text-muted",
  primary: "text-primary",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-chart-2",
};

const STATUS_CLASS: Record<ChatCardTone, string> = {
  neutral: "border-border bg-surface-low text-foreground",
  primary: "border-primary/30 bg-primary/15 text-primary",
  warning: "border-warning/30 bg-warning/15 text-warning",
  danger: "border-destructive/30 bg-destructive/15 text-destructive",
  info: "border-chart-2/30 bg-chart-2/15 text-chart-2",
};

export function ChatCard({
  tone = "neutral",
  icon: Icon,
  title,
  subtitle,
  status,
  children,
  actions,
  collapsible = false,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
}: ChatCardProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const toggle = () => {
    const next = !open;
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const headerInner = (
    <>
      {collapsible &&
        (open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        ))}
      {Icon && <Icon className={`h-3.5 w-3.5 shrink-0 ${TONE_ICON[tone]}`} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-foreground">{title}</p>
        {subtitle && (
          <p className="mt-0.5 truncate font-mono text-[11px] text-text-muted">{subtitle}</p>
        )}
      </div>
      {status && (
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
            STATUS_CLASS[status.tone ?? tone]
          }`}
        >
          {status.label}
        </span>
      )}
    </>
  );

  return (
    <div
      className={`mb-2 overflow-hidden rounded-md border border-l-2 border-border ${TONE_BORDER[tone]} ${TONE_BG[tone]}`}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-low/70"
        >
          {headerInner}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2">{headerInner}</div>
      )}

      {open && children && (
        <div className="border-t border-border px-3 py-2 text-xs leading-5 text-text-secondary">
          {children}
        </div>
      )}

      {actions && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-3 py-2">
          {actions}
        </div>
      )}
    </div>
  );
}
