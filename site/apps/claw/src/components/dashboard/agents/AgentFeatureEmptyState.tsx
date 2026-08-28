"use client";

import type { ComponentType, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
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
  actionHref?: string;
  actionIcon?: ReactNode;
  actionPending?: boolean;
  actionDisabled?: boolean;
  actionDisabledReason?: string | null;
  cardMinHeightClass?: string;
  testId?: string;
  previewImage?: {
    src: string;
    alt: string;
  };
}

function FeatureAction({
  actionLabel,
  actionHref,
  actionIcon,
  actionPending,
  actionDisabled,
  actionDisabledReason,
  onAction,
  className,
  showDefaultIcon = true,
}: Pick<AgentFeatureEmptyStateProps,
  | "actionLabel"
  | "actionHref"
  | "actionIcon"
  | "actionPending"
  | "actionDisabled"
  | "actionDisabledReason"
  | "onAction"
> & {
  className: string;
  showDefaultIcon?: boolean;
}) {
  const disabled = actionPending || actionDisabled;
  const icon = actionPending
    ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
    : actionIcon ?? (showDefaultIcon ? <ArrowRight className="h-4 w-4" /> : null);

  return (
    <TooltipHint label={disabled ? actionDisabledReason ?? actionLabel : actionLabel} disabled={disabled}>
      {actionHref && !disabled ? (
        <Link href={actionHref} data-testid="agent-launch-entry" className={className}>
          {actionLabel}
          {icon}
        </Link>
      ) : (
        <motion.button
          whileHover={disabled ? undefined : { y: -1 }}
          whileTap={disabled ? undefined : { scale: 0.98 }}
          type="button"
          data-testid="agent-launch-entry"
          onClick={onAction}
          disabled={disabled}
          className={className}
        >
          {actionLabel}
          {icon}
        </motion.button>
      )}
    </TooltipHint>
  );
}

export function AgentFeatureEmptyState({
  icon: Icon,
  title,
  description,
  examples,
  actionLabel,
  onAction,
  actionHref,
  actionIcon,
  actionPending = false,
  actionDisabled = false,
  actionDisabledReason,
  cardMinHeightClass = "md:min-h-[102px]",
  testId = "agent-feature-empty-state",
  previewImage,
}: AgentFeatureEmptyStateProps) {
  if (previewImage) {
    return (
      <div
        data-testid={testId}
        className="claw-scroll-region h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background"
      >
        <div className="flex min-h-full w-full items-center justify-center px-4 pb-[max(1.5rem,var(--claw-safe-area-bottom-effective,0px))] pt-6 sm:px-8 sm:pb-[max(2rem,var(--claw-safe-area-bottom-effective,0px))] sm:pt-8">
          <div className="w-full max-w-[650px] [container-type:inline-size]">
            <article
              data-slot="agent-anonymous-feature-preview"
              className="grid aspect-[1.1] w-full overflow-hidden rounded-[3.08cqw] border border-[#303036] bg-[#18181b] shadow-[0_3.4cqw_10.8cqw_rgba(0,0,0,0.32)] [grid-template-rows:61.8%_38.2%]"
            >
              <div className="relative min-h-0 overflow-hidden bg-[#d9828d]">
                <Image
                  src={previewImage.src}
                  alt={previewImage.alt}
                  fill
                  priority
                  unoptimized
                  sizes="(max-width: 767px) calc(100vw - 2rem), 650px"
                  className="select-none object-cover"
                />
              </div>

              <div className="flex min-h-0 flex-col bg-[#18181b] px-[3.7cqw] pb-[3.4cqw] pt-[3.4cqw] text-left">
                <h1 className="text-balance text-[4.3cqw] font-medium leading-[1.16] tracking-[-0.03em] text-[#f7f7f8]">
                  {title}
                </h1>
                <p className="mt-[1.85cqw] text-pretty text-[3.05cqw] leading-[1.45] text-[#81818a]">
                  {description}
                </p>

                <div className="mt-auto self-end">
                  <FeatureAction
                    actionLabel={actionLabel}
                    actionHref={actionHref}
                    actionIcon={actionIcon}
                    actionPending={actionPending}
                    actionDisabled={actionDisabled}
                    actionDisabledReason={actionDisabledReason}
                    onAction={onAction}
                    showDefaultIcon={false}
                    className="inline-flex h-[7.7cqw] max-w-full items-center justify-center gap-2 rounded-[1.85cqw] bg-[#5f86f7] px-[3.7cqw] text-[3.05cqw] font-medium text-[#101b3d] transition-colors hover:bg-[#7396fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9bb3ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#18181b] disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
    );
  }

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
            <FeatureAction
              actionLabel={actionLabel}
              actionHref={actionHref}
              actionIcon={actionIcon}
              actionPending={actionPending}
              actionDisabled={actionDisabled}
              actionDisabledReason={actionDisabledReason}
              onAction={onAction}
              className={`inline-flex h-12 max-w-full items-center gap-2 rounded-[8px] bg-[var(--button-primary)] px-5 text-[14px] font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--button-primary-rgb)_/_0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-background md:h-10 md:px-4 disabled:opacity-70 ${
                actionPending ? "disabled:cursor-wait" : "disabled:cursor-not-allowed"
              }`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
