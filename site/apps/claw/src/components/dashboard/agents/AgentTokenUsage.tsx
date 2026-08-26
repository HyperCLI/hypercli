"use client";

import { AlertCircle, CalendarClock, Gauge, Loader2, Sparkles } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hypercli/shared-ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ClawTooltip";
import type { ActiveAgentTrial } from "@/lib/agent-trial";
import { formatTokens } from "@/lib/format";

const APPROACHING_DAILY_TOKEN_LIMIT_RATIO = 0.8;
const DAILY_TOKEN_RESET_LABEL = "00:00 UTC";

export type AgentTokenUsageState = "unavailable" | "normal" | "approaching" | "reached";

export interface AgentTokenUsageSnapshot {
  tokensUsed: number | null;
  tokenTotal: number | null;
  progress: number;
  state: AgentTokenUsageState;
  label: string;
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

export function resolveAgentTokenUsage(
  tokenUsed: number | null | undefined,
  tokenLimit: number | null | undefined,
): AgentTokenUsageSnapshot {
  const tokensUsed = finiteNonNegative(tokenUsed);
  const normalizedLimit = finiteNonNegative(tokenLimit);
  const tokenTotal = normalizedLimit && normalizedLimit > 0 ? normalizedLimit : null;
  const ratio = tokenTotal && tokensUsed != null ? tokensUsed / tokenTotal : 0;
  const progress = Math.min(100, Math.max(0, ratio * 100));
  const state: AgentTokenUsageState = !tokenTotal || tokensUsed == null
    ? "unavailable"
    : ratio >= 1
      ? "reached"
      : ratio >= APPROACHING_DAILY_TOKEN_LIMIT_RATIO
        ? "approaching"
        : "normal";
  const label = tokenTotal
    ? `${tokensUsed == null ? "--" : formatTokens(tokensUsed)} / ${formatTokens(tokenTotal)}`
    : `${tokensUsed == null ? "--" : formatTokens(tokensUsed)} / --`;

  return { tokensUsed, tokenTotal, progress, state, label };
}

interface AgentTokenUsageProps {
  tokenUsed?: number | null;
  tokenLimit?: number | null;
  isAuthenticated?: boolean;
  activeTrial?: ActiveAgentTrial | null;
  canStartTrial?: boolean;
  trialCheckoutPending?: boolean;
  capacityActionLabel?: string;
  onUpgrade: () => void;
  onStartTrial?: () => void;
  onManageTrial?: () => void;
  collapsed?: boolean;
  renderMobile?: boolean;
}

export function AgentTokenUsage({
  tokenUsed,
  tokenLimit,
  isAuthenticated = true,
  activeTrial = null,
  canStartTrial = false,
  trialCheckoutPending = false,
  capacityActionLabel = "Upgrade",
  onUpgrade,
  onStartTrial,
  onManageTrial,
  collapsed = false,
  renderMobile = false,
}: AgentTokenUsageProps) {
  const usage = resolveAgentTokenUsage(tokenUsed, tokenLimit);
  const trialOfferVisible = !activeTrial && (!isAuthenticated || canStartTrial);
  const needsAttention = usage.state === "approaching" || usage.state === "reached";
  const onUsageAction = trialOfferVisible
    ? onStartTrial ?? onUpgrade
    : activeTrial && !needsAttention
      ? onManageTrial ?? onUpgrade
      : onUpgrade;
  const usageActionLabel = trialCheckoutPending
    ? "Starting trial..."
    : trialOfferVisible
      ? "Start free trial"
      : activeTrial && !needsAttention
        ? "Manage trial"
        : needsAttention
          ? capacityActionLabel
          : "Upgrade";
  const collapsedUsageLabel = trialCheckoutPending
    ? "Starting free trial"
    : usage.state === "reached"
      ? `Daily token limit reached. Resets at ${DAILY_TOKEN_RESET_LABEL}. ${usageActionLabel}.`
      : usage.state === "approaching"
        ? `Daily token limit is near. Resets at ${DAILY_TOKEN_RESET_LABEL}. ${usageActionLabel}.`
        : activeTrial
          ? `${activeTrial.planName} trial: ${activeTrial.timeRemainingLabel}`
          : trialOfferVisible
            ? "Start free trial"
            : `Daily tokens: ${usage.label}`;
  const progressTone = usage.state === "reached"
    ? "bg-destructive"
    : usage.state === "approaching"
      ? "bg-warning"
      : usage.state === "normal"
        ? "bg-[var(--selection-accent)]"
        : "bg-foreground/30";
  const statusTone = usage.state === "reached" ? "text-destructive" : "text-warning";

  if (collapsed) {
    return (
      <>
        {needsAttention ? <span className="sr-only" role="status" aria-live="polite">{collapsedUsageLabel}</span> : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onUsageAction}
              aria-label={collapsedUsageLabel}
              disabled={trialCheckoutPending}
              data-token-usage-state={usage.state}
              className={`flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-surface-low hover:text-foreground disabled:cursor-wait disabled:opacity-70 ${
                usage.state === "reached" ? "text-destructive" : usage.state === "approaching" ? "text-warning" : "text-text-muted"
              }`}
            >
              {trialCheckoutPending ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : usage.state === "reached" ? (
                <AlertCircle data-testid="token-usage-state-icon" className="h-4 w-4" />
              ) : usage.state === "approaching" ? (
                <Gauge data-testid="token-usage-state-icon" className="h-4 w-4" />
              ) : activeTrial ? (
                <CalendarClock className="h-4 w-4" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{collapsedUsageLabel}</TooltipContent>
        </Tooltip>
      </>
    );
  }

  return (
    <div className="space-y-2" data-testid="agent-token-usage-panel" data-token-usage-state={usage.state}>
      {activeTrial ? (
        <div className="flex w-full items-center justify-center gap-1.5 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.36)] bg-[rgb(var(--selection-accent-rgb)_/_0.06)] px-2 py-1 text-[10px] font-semibold leading-none text-[var(--selection-accent)]">
          <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">{activeTrial.planName} trial · {activeTrial.timeRemainingLabel}</span>
        </div>
      ) : trialOfferVisible ? (
        <div className="flex w-full items-center justify-center gap-1.5 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.36)] bg-[rgb(var(--selection-accent-rgb)_/_0.06)] px-2 py-1 text-[10px] font-semibold leading-none text-[var(--selection-accent)]">
          <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">7-day free trial on Team</span>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-1.5 text-[11px] leading-none">
        <span className="shrink-0 whitespace-nowrap text-text-muted">Daily tokens</span>
        <span data-testid="agent-token-usage" className="shrink-0 whitespace-nowrap font-medium tabular-nums text-foreground">{usage.label}</span>
      </div>

      {isAuthenticated ? (
        <div
          role="progressbar"
          aria-label="Daily token usage"
          aria-valuemin={0}
          aria-valuemax={usage.tokenTotal ?? undefined}
          aria-valuenow={usage.tokensUsed != null && usage.tokenTotal ? Math.min(usage.tokensUsed, usage.tokenTotal) : undefined}
          aria-valuetext={`${usage.label}${usage.state === "approaching" ? ". Near daily limit." : usage.state === "reached" ? ". Daily limit reached." : "."}`}
          aria-busy={usage.tokensUsed == null || undefined}
          className="h-1 overflow-hidden rounded-full bg-surface-high"
        >
          <div
            className={`h-full rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none ${progressTone}`}
            style={{ width: `${usage.progress}%` }}
          />
        </div>
      ) : null}

      {needsAttention ? (
        <div
          role="status"
          aria-live="polite"
          className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] font-medium leading-4 ${statusTone}`}
        >
          <span>{usage.state === "reached" ? "Daily limit reached" : "Near daily limit"}</span>
          <span className="whitespace-nowrap text-text-muted">Resets {DAILY_TOKEN_RESET_LABEL}</span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onUsageAction}
        disabled={trialCheckoutPending}
        className={`flex w-full items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70 ${
          renderMobile ? "h-10 rounded-[10px] text-sm" : isAuthenticated ? "h-8 rounded-full text-xs" : "h-9 rounded-[9px] text-xs"
        } ${needsAttention ? "btn-primary border border-transparent" : "border border-border bg-background text-foreground hover:bg-surface-low"}`}
      >
        {trialCheckoutPending ? (
          <Loader2 className={`${renderMobile ? "h-5 w-5" : "h-3.5 w-3.5"} animate-spin motion-reduce:animate-none`} aria-hidden="true" />
        ) : activeTrial && !needsAttention ? (
          <CalendarClock className={renderMobile ? "h-5 w-5" : "h-3.5 w-3.5"} aria-hidden="true" />
        ) : (
          <Sparkles className={renderMobile ? "h-5 w-5" : "h-3.5 w-3.5"} aria-hidden="true" />
        )}
        {usageActionLabel}
      </button>
    </div>
  );
}

export function DailyTokenLimitDialog({
  open,
  actionLabel,
  onOpenChange,
  onAction,
}: {
  open: boolean;
  actionLabel: string;
  onOpenChange: (open: boolean) => void;
  onAction: () => void;
}) {
  const recoveryCopy = actionLabel === "Add capacity"
    ? "Add capacity to continue before the reset."
    : actionLabel === "Start free trial"
      ? "Start your free trial to continue before the reset."
      : "Choose a higher plan to continue before the reset.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="daily-token-limit-dialog"
        closeLabel="Close daily token limit notice"
        overlayClassName="z-[10000] bg-background/80 backdrop-blur-sm"
        className="z-[10001] gap-0 overflow-hidden border-border bg-background p-0 sm:max-w-lg"
      >
        <DialogHeader className="gap-0 border-b border-border px-5 py-5 pr-12 text-left sm:px-6">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-destructive/25 bg-destructive/10 text-destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 pt-0.5">
              <DialogTitle className="text-base leading-5 text-foreground">Daily token limit reached</DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-6 text-text-secondary">
                Your account&apos;s shared token allowance has been used for today, so this action can&apos;t continue. It resets at {DAILY_TOKEN_RESET_LABEL}. {recoveryCopy}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2 bg-surface-low/55 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Wait for reset
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onAction();
            }}
            className="btn-primary inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {actionLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
