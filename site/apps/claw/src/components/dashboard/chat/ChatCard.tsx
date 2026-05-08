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
  neutral: "border-l-[#7c7b82]",
  primary: "border-l-[#38D39F]",
  warning: "border-l-[#f0c56c]",
  danger: "border-l-[#d05f5f]",
  info: "border-l-[#6b9eff]",
};

const TONE_BG: Record<ChatCardTone, string> = {
  neutral: "bg-background/60",
  primary: "bg-[#38D39F]/[0.06]",
  warning: "bg-[#f0c56c]/[0.06]",
  danger: "bg-[#d05f5f]/[0.06]",
  info: "bg-[#6b9eff]/[0.06]",
};

const TONE_ICON: Record<ChatCardTone, string> = {
  neutral: "text-text-muted",
  primary: "text-[#38D39F]",
  warning: "text-[#f0c56c]",
  danger: "text-[#d05f5f]",
  info: "text-[#6b9eff]",
};

const STATUS_CLASS: Record<ChatCardTone, string> = {
  neutral: "border-white/12 bg-white/[0.05] text-foreground",
  primary: "border-[#38D39F]/30 bg-[#38D39F]/15 text-[#38D39F]",
  warning: "border-[#f0c56c]/30 bg-[#f0c56c]/15 text-[#f0c56c]",
  danger: "border-[#d05f5f]/30 bg-[#d05f5f]/15 text-[#d05f5f]",
  info: "border-[#6b9eff]/30 bg-[#6b9eff]/15 text-[#6b9eff]",
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
      className={`mb-2 overflow-hidden rounded-md border border-l-2 border-white/8 ${TONE_BORDER[tone]} ${TONE_BG[tone]}`}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
        >
          {headerInner}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2">{headerInner}</div>
      )}

      {open && children && (
        <div className="border-t border-white/8 px-3 py-2 text-xs leading-5 text-text-secondary">
          {children}
        </div>
      )}

      {actions && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/8 px-3 py-2">
          {actions}
        </div>
      )}
    </div>
  );
}
