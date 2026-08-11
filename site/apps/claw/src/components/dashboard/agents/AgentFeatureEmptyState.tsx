"use client";

import type { ComponentType, ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Check, Loader2 } from "lucide-react";

import { TooltipHint } from "@/components/ClawTooltip";

interface AgentFeatureEmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  examples: readonly string[];
  actionLabel: string;
  onAction: () => void;
  actionIcon?: ReactNode;
  actionPending?: boolean;
  actionDisabled?: boolean;
  actionDisabledReason?: string | null;
  cardMinHeightClass?: string;
  testId?: string;
}

export function AgentFeatureEmptyState({
  icon: Icon,
  title,
  description,
  examples,
  actionLabel,
  onAction,
  actionIcon,
  actionPending = false,
  actionDisabled = false,
  actionDisabledReason,
  cardMinHeightClass = "md:min-h-[102px]",
  testId = "agent-feature-empty-state",
}: AgentFeatureEmptyStateProps) {
  const disabled = actionPending || actionDisabled;

  return (
    <div
      data-testid={testId}
      className="claw-scroll-region h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background"
    >
      <div className="flex min-h-full w-full items-center justify-center px-5 pb-[max(2rem,var(--claw-safe-area-bottom-effective,0px))] pt-8 sm:px-6 sm:pb-[max(2.5rem,var(--claw-safe-area-bottom-effective,0px))] sm:pt-10 md:px-8">
        <div className="flex w-full min-w-0 max-w-[700px] flex-col items-center text-center">
          <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-[9px] border border-border bg-surface-low text-foreground">
            <Icon className="h-[18px] w-[18px]" />
          </div>

          <h1 className="max-w-[20ch] text-balance break-words text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground md:text-[38px]">
            {title}
          </h1>
          <p className="mt-4 max-w-[60ch] text-pretty break-words text-[14px] font-medium leading-[21px] text-text-muted md:text-[15px] md:leading-6">
            {description}
          </p>

          <div className="mt-7 grid w-full min-w-0 grid-cols-1 gap-3 md:mt-9 md:grid-cols-3 md:gap-4">
            {examples.map((example, index) => (
              <motion.div
                key={example}
                data-slot="agent-feature-empty-state-example"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05, duration: 0.18, ease: "easeOut" }}
                className={`flex min-h-16 min-w-0 ${cardMinHeightClass} items-center gap-3 rounded-[9px] border border-foreground bg-background px-4 py-3.5 text-left text-[13px] font-semibold leading-[19px] text-text-muted md:flex-col md:justify-center md:gap-0 md:px-4 md:py-5 md:text-center md:leading-5`}
              >
                <Check className="h-[18px] w-[18px] shrink-0 text-foreground md:mb-3" />
                <span className="min-w-0 break-words">{example}</span>
              </motion.div>
            ))}
          </div>

          <div className="mt-7 max-w-full md:mt-9">
            <TooltipHint label={disabled ? actionDisabledReason ?? actionLabel : actionLabel} disabled={disabled}>
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                type="button"
                data-testid="agent-launch-entry"
                onClick={onAction}
                disabled={disabled}
                className={`inline-flex h-12 max-w-full items-center gap-2 rounded-[8px] bg-[var(--button-primary)] px-5 text-[14px] font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--button-primary-rgb)_/_0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-background md:h-10 md:px-4 ${
                  actionPending ? "disabled:cursor-wait" : "disabled:cursor-not-allowed"
                }`}
              >
                {actionLabel}
                {actionPending ? <Loader2 className="h-4 w-4 animate-spin" /> : actionIcon ?? <ArrowRight className="h-4 w-4" />}
              </motion.button>
            </TooltipHint>
          </div>
        </div>
      </div>
    </div>
  );
}
