"use client";

import { Loader2, LockKeyhole } from "lucide-react";
import { useId } from "react";

import type { OpenClawTemporaryChatState } from "@/hooks/useOpenClawSession";
import { TooltipHint } from "@/components/ClawTooltip";

interface AgentPrivateChatControlProps {
  state: OpenClawTemporaryChatState;
  disabled?: boolean;
  disabledReason?: string;
  compact?: boolean;
  onStart: () => void | Promise<void>;
  onEnd: () => void | Promise<void>;
}

export function AgentPrivateChatControl({
  state,
  disabled = false,
  disabledReason,
  compact = false,
  onStart,
  onEnd,
}: AgentPrivateChatControlProps) {
  const descriptionId = useId();
  const active = state === "active" || state === "ending";
  const busy = state === "starting" || state === "ending";
  const label = state === "starting"
    ? "Starting private chat"
    : state === "ending"
      ? "Ending private chat"
      : active
        ? "End private chat"
        : "Start private chat";
  const tooltipLabel = disabledReason ?? (active
    ? "End private chat and discard this transcript"
    : "Start a temporary chat hidden from Sessions and browser storage");

  return (
    <TooltipHint label={tooltipLabel} disabled={disabled || busy}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        aria-busy={busy}
        aria-describedby={disabledReason ? descriptionId : undefined}
        disabled={disabled || busy}
        onClick={() => {
          const action = active ? onEnd : onStart;
          void Promise.resolve(action()).catch(() => undefined);
        }}
        className={`${compact ? "h-10 w-10 rounded-lg" : "h-8 rounded-full px-3"} inline-flex shrink-0 items-center justify-center gap-1.5 border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] disabled:cursor-not-allowed disabled:opacity-45 ${
          active
            ? "border-[rgb(var(--selection-accent-rgb)_/_0.4)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-[var(--selection-accent)]"
            : "border-border bg-surface-low/45 text-text-secondary hover:bg-surface-low hover:text-foreground"
        }`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockKeyhole className="h-3.5 w-3.5" />}
        {!compact ? <span>Private</span> : null}
        {disabledReason ? <span id={descriptionId} className="sr-only">{disabledReason}</span> : null}
      </button>
    </TooltipHint>
  );
}
