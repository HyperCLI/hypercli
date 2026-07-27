"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Codepen, RotateCcw, Sparkles } from "lucide-react";

import { agentAvatar } from "@/lib/avatar";
import type { FirstAgentSetupDraft } from "@/hooks/useFirstAgentSetupDraft";

interface AnonymousAgentLaunchStateProps {
  draft: FirstAgentSetupDraft | null;
  onResume: () => void;
  onStartFresh: () => void;
}

function AnonymousAgentLaunchFrame({
  titleId,
  reducedMotion,
  children,
}: {
  titleId: string;
  reducedMotion: boolean | null;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={titleId}
      data-slot="anonymous-agent-launch-state"
      className="relative flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden bg-background px-4 py-6 sm:px-8"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgb(var(--selection-accent-rgb)_/_0.07),transparent_44%)]" />
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reducedMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
        data-slot="anonymous-agent-launch-card"
        data-agent-launch-surface
        className="relative h-[546px] w-full max-w-[660px] overflow-hidden rounded-[24px] border border-border bg-surface-low shadow-[0_24px_80px_rgb(0_0_0_/_0.3)] sm:!h-[428px]"
      >
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgb(var(--selection-accent-rgb)_/_0.9),transparent)]" />
        <div className="relative h-full px-5 pb-5 pt-5 sm:px-7 sm:pb-7 sm:pt-6">
          {children}
        </div>
      </motion.div>
    </section>
  );
}

function agentUrlSlug(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return normalized || "agent";
}

export function AnonymousAgentLaunchState({ draft, onResume, onStartFresh }: AnonymousAgentLaunchStateProps) {
  const reducedMotion = useReducedMotion();

  if (!draft) {
    return (
      <AnonymousAgentLaunchFrame titleId="anonymous-agent-launch-title" reducedMotion={reducedMotion}>
        <div className="grid items-center gap-5 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-7">
          <div className="relative mx-auto flex h-[116px] w-[116px] items-center justify-center sm:h-[132px] sm:w-[132px]">
            <div aria-hidden="true" className="absolute inset-[10px] rounded-full border border-border bg-[radial-gradient(circle_at_35%_30%,rgb(var(--selection-accent-rgb)_/_0.16),transparent_65%)]" />
            {!reducedMotion ? [0, 1].map((ripple) => (
              <motion.span
                key={ripple}
                aria-hidden="true"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: [0, 0.34, 0], scale: [0.9, 1.08, 1.8] }}
                transition={{
                  duration: 3.2,
                  delay: ripple * 1.6,
                  ease: "easeOut",
                  repeat: Infinity,
                }}
                className="pointer-events-none absolute h-[68px] w-[68px] rounded-[20px] border border-[rgb(var(--selection-accent-rgb)_/_0.5)] shadow-[0_0_24px_rgb(var(--selection-accent-rgb)_/_0.16)]"
              />
            )) : null}
            <motion.div
              animate={reducedMotion ? undefined : { scale: [1, 1.035, 1] }}
              transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity }}
              className="relative flex h-[66px] w-[66px] items-center justify-center rounded-[20px] border border-[rgb(var(--selection-accent-rgb)_/_0.35)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-[var(--selection-accent)] shadow-[0_12px_30px_rgb(0_0_0_/_0.35)]"
            >
              <Codepen className="h-7 w-7" />
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-surface-low bg-[var(--selection-accent)] text-[var(--selection-accent-foreground)]">
                <Sparkles className="h-3 w-3" />
              </span>
            </motion.div>
          </div>

          <div className="min-w-0 text-center sm:text-left">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">A new teammate</p>
            <h1 id="anonymous-agent-launch-title" className="mt-2 whitespace-nowrap text-[clamp(1.2rem,5.25vw,1.875rem)] font-semibold leading-[1.05] tracking-[-0.025em] text-foreground">
              Launch your first agent
            </h1>
            <p className="mt-3 text-[13px] font-medium leading-5 text-text-secondary sm:text-[14px] sm:leading-6">
              Shape its identity, choose its power, and bring it online in a few focused steps.
            </p>
          </div>
        </div>

        <div className="mt-6 flex min-h-[78px] items-center rounded-[16px] border border-border bg-background/70 p-3.5 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.025)] sm:p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-border bg-surface-high text-[var(--selection-accent)]">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-foreground">Your setup is saved as you go</p>
              <p className="mt-0.5 text-[11px] font-medium leading-4 text-text-muted">Start now, sign in when prompted, and pick up without losing your place.</p>
            </div>
          </div>
        </div>

        <div
          role="progressbar"
          aria-label="Agent setup progress"
          aria-valuemin={0}
          aria-valuemax={3}
          aria-valuenow={0}
          aria-valuetext="Agent setup is ready to begin."
          className="mt-5 grid grid-cols-3 gap-2"
        >
          {["Identity", "Power", "Online"].map((label, stepIndex) => (
            <div key={label} className="min-w-0">
              <div className={`relative h-1 overflow-hidden rounded-full ${stepIndex === 0 ? "bg-[var(--selection-accent)] shadow-[0_0_10px_rgb(var(--selection-accent-rgb)_/_0.16)]" : "bg-border"}`}>
                {stepIndex === 0 && !reducedMotion ? (
                  <motion.span
                    aria-hidden="true"
                    initial={{ x: "-140%" }}
                    animate={{ x: "360%" }}
                    transition={{ duration: 2.2, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.9 }}
                    className="absolute inset-y-0 w-1/3 bg-[linear-gradient(90deg,transparent,rgb(255_255_255_/_0.9),transparent)]"
                  />
                ) : null}
              </div>
              <p className={`mt-1.5 text-center text-[9px] font-bold uppercase tracking-[0.12em] ${stepIndex === 0 ? "text-foreground" : "text-text-muted"}`}>
                {label}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <motion.button
            type="button"
            onClick={onResume}
            whileHover={reducedMotion ? undefined : { y: -1 }}
            whileTap={reducedMotion ? undefined : { scale: 0.99 }}
            className="group inline-flex h-11 w-full items-center justify-between rounded-[11px] bg-[var(--button-primary)] px-4 text-[14px] font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--button-primary-rgb)_/_0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-low"
          >
            <span className="inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Create an agent
            </span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </motion.button>
        </div>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] font-medium text-text-muted">
          <Sparkles className="h-3 w-3 shrink-0" />
          <span>Every plan starts with a 7-day free trial — nothing charged today.</span>
        </p>
      </AnonymousAgentLaunchFrame>
    );
  }

  const avatar = agentAvatar(draft.name, { ui: { avatar: { icon_index: draft.iconIndex } } });
  const AvatarIcon = avatar.icon;
  const enabledCapabilities = [
    draft.enableDesktop ? "Browser" : null,
    draft.enableMemoryIndex ? "Memory" : null,
  ].filter((capability): capability is string => Boolean(capability));
  const hasSelectedPlan = Boolean(draft.plan);
  const agentUrl = `${agentUrlSlug(draft.name)}.hypercli.com`;

  return (
    <AnonymousAgentLaunchFrame titleId="anonymous-agent-draft-title" reducedMotion={reducedMotion}>
          <div className="grid items-center gap-5 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-7">
            <div className="relative mx-auto flex h-[116px] w-[116px] items-center justify-center sm:h-[132px] sm:w-[132px]">
              <div aria-hidden="true" className="absolute inset-[10px] rounded-full border border-border bg-[radial-gradient(circle_at_35%_30%,rgb(var(--selection-accent-rgb)_/_0.16),transparent_65%)]" />
              {!reducedMotion ? [0, 1].map((ripple) => (
                <motion.span
                  key={ripple}
                  aria-hidden="true"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: [0, 0.42, 0], scale: [0.9, 1.08, 1.8] }}
                  transition={{
                    duration: 3.2,
                    delay: ripple * 1.6,
                    ease: "easeOut",
                    repeat: Infinity,
                  }}
                  className="pointer-events-none absolute h-[68px] w-[68px] rounded-[20px] border border-[rgb(var(--selection-accent-rgb)_/_0.65)] shadow-[0_0_24px_rgb(var(--selection-accent-rgb)_/_0.18)]"
                />
              )) : null}
              <motion.div
                animate={reducedMotion ? undefined : { scale: [1, 1.035, 1] }}
                transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity }}
                className="relative flex h-[66px] w-[66px] items-center justify-center rounded-[20px] border border-[rgb(var(--selection-accent-rgb)_/_0.35)] shadow-[0_12px_30px_rgb(0_0_0_/_0.35)]"
                style={{ backgroundColor: avatar.bgColor, color: avatar.fgColor }}
              >
                <AvatarIcon className="h-7 w-7" />
                <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-surface-low bg-[var(--selection-accent)] text-[var(--selection-accent-foreground)]">
                  <Check className="h-3 w-3" />
                </span>
              </motion.div>
            </div>

            <div className="min-w-0 text-center sm:text-left">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">Waiting in the wings</p>
              <h1 id="anonymous-agent-draft-title" className="mt-2 whitespace-nowrap text-[clamp(1.2rem,5.25vw,1.875rem)] font-semibold leading-[1.05] tracking-[-0.025em] text-foreground">
                Your agent has a head start.
              </h1>
              <p className="mt-3 text-[13px] font-medium leading-5 text-text-secondary sm:text-[14px] sm:leading-6">
                {hasSelectedPlan
                  ? "Its identity and power are set. Sign in and bring it online."
                  : "Its identity is saved. Choose its power, sign in, and bring it online."}
              </p>
            </div>
          </div>

          <div className="mt-6 min-h-[78px] rounded-[16px] border border-border bg-background/70 p-3.5 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.025)] sm:p-4">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-foreground">{draft.name}</p>
              <p className="mt-0.5 truncate text-[11px] font-medium text-text-muted">{agentUrl}</p>
            </div>
            {enabledCapabilities.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                {enabledCapabilities.map((capability) => (
                  <span key={capability} className="inline-flex items-center gap-1 rounded-full bg-surface-high px-2 py-1 text-[10px] font-semibold text-text-secondary">
                    <Check className="h-2.5 w-2.5 text-[var(--selection-accent)]" />
                    {capability} ready
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div
            role="progressbar"
            aria-label="Agent setup progress"
            aria-valuemin={0}
            aria-valuemax={3}
            aria-valuenow={hasSelectedPlan ? 2 : 1}
            aria-valuetext={hasSelectedPlan ? "Identity and plan saved. Sign in next." : "Identity saved. Plan selection next."}
            className="mt-5 grid grid-cols-3 gap-2"
          >
            {[
              { label: "Identity", state: "complete" },
              { label: "Power", state: hasSelectedPlan ? "complete" : "active" },
              { label: "Online", state: "upcoming" },
            ].map((step, stepIndex) => (
              <div key={step.label} className="min-w-0">
                <div className={`relative h-1 overflow-hidden rounded-full ${step.state === "upcoming" ? "bg-border" : "bg-[var(--selection-accent)] shadow-[0_0_10px_rgb(var(--selection-accent-rgb)_/_0.16)]"}`}>
                  {step.state !== "upcoming" && !reducedMotion ? (
                    <motion.span
                      aria-hidden="true"
                      initial={{ x: "-140%" }}
                      animate={{ x: "360%" }}
                      transition={{
                        duration: 2.2,
                        delay: stepIndex * 0.32,
                        ease: "easeInOut",
                        repeat: Infinity,
                        repeatDelay: 0.9,
                      }}
                      className="absolute inset-y-0 w-1/3 bg-[linear-gradient(90deg,transparent,rgb(255_255_255_/_0.9),transparent)]"
                    />
                  ) : null}
                </div>
                <p className={`mt-1.5 text-center text-[9px] font-bold uppercase tracking-[0.12em] ${step.state === "upcoming" ? "text-text-muted" : "text-foreground"}`}>
                  {step.label}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onStartFresh}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] border border-border bg-background px-4 text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Start fresh
            </button>
            <motion.button
              type="button"
              onClick={onResume}
              whileHover={reducedMotion ? undefined : { y: -1 }}
              whileTap={reducedMotion ? undefined : { scale: 0.99 }}
              className="group inline-flex h-11 flex-1 items-center justify-between rounded-[11px] bg-[var(--button-primary)] px-4 text-[14px] font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--button-primary-rgb)_/_0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-low"
            >
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Finish the launch
              </span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </motion.button>
          </div>

          <p className="mt-3 flex items-center justify-center gap-2 text-center text-[11px] font-medium text-text-muted">
            <span>7-day trial</span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-text-muted" />
            <span>Nothing charged today</span>
          </p>
    </AnonymousAgentLaunchFrame>
  );
}
