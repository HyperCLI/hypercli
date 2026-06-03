"use client";

import { useState } from "react";
import {
  ArrowRight,
  BookOpenText,
  Check,
  ChevronDown,
  FolderOpen,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface JourneyIntroPanelProps {
  agentName?: string | null;
  onStartBrief: () => void;
  onAddSource: () => void;
  onSetRules: () => void;
  onTryWork: () => void;
}

interface IntroAction {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  shortLabel: string;
  icon: LucideIcon;
  onSelect: () => void;
}

export function JourneyIntroPanel({
  agentName,
  onStartBrief,
  onAddSource,
  onSetRules,
  onTryWork,
}: JourneyIntroPanelProps) {
  const [activeActionIndex, setActiveActionIndex] = useState(0);
  const [showAllActions, setShowAllActions] = useState(false);
  const displayName = agentName?.trim() || "your agent";
  const actions: IntroAction[] = [
    {
      id: "brief",
      title: "Give it a brief",
      description: "Tell it what kind of work it should help with and what outcome matters.",
      actionLabel: "Start the brief",
      shortLabel: "Brief",
      icon: BookOpenText,
      onSelect: onStartBrief,
    },
    {
      id: "source",
      title: "Show it what matters",
      description: "Add one file, note, or example your agent should rely on.",
      actionLabel: "Add a source",
      shortLabel: "Source",
      icon: FolderOpen,
      onSelect: onAddSource,
    },
    {
      id: "rules",
      title: "Set the rules",
      description: "Decide when your agent should act, pause, or ask before moving forward.",
      actionLabel: "Set boundaries",
      shortLabel: "Rules",
      icon: ShieldCheck,
      onSelect: onSetRules,
    },
    {
      id: "real-work",
      title: "Try real work",
      description: "Give it one useful task from today and see what it needs from you.",
      actionLabel: "Draft first task",
      shortLabel: "Real work",
      icon: MessageSquare,
      onSelect: onTryWork,
    },
  ];
  const safeActiveActionIndex = Math.min(activeActionIndex, actions.length - 1);
  const activeAction = actions[safeActiveActionIndex];
  const ActiveIcon = activeAction.icon;
  const completedActions = actions.slice(0, safeActiveActionIndex);
  const upcomingActions = actions.slice(safeActiveActionIndex + 1);
  const nextActionLabel = upcomingActions[0]?.actionLabel ?? null;

  function selectAction(action: IntroAction, index: number) {
    action.onSelect();
    if (index === safeActiveActionIndex) {
      setActiveActionIndex((current) => Math.min(current + 1, actions.length - 1));
    }
  }

  return (
    <section className="w-full max-w-[42rem] px-4 py-6 text-foreground sm:px-6">
      <div className="relative overflow-hidden rounded-[1.45rem] border border-white/10 bg-[#141415]/92 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.28)] sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.12)] blur-3xl" />

        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.22)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--selection-accent)]">
            <Sparkles className="h-3.5 w-3.5" />
            Welcome
          </div>

          <h2 className="mt-5 text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-foreground sm:text-[2.45rem]">
            Welcome to {displayName}
          </h2>
          <p className="mt-4 max-w-[35rem] text-[15px] leading-7 text-text-secondary sm:text-base">
            Let&apos;s turn this agent into a useful teammate. Start with one clear move, then add context only when it helps.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {completedActions.map((action) => (
              <span key={action.id} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-xs font-medium text-text-secondary">
                <Check className="h-3 w-3 text-[var(--selection-accent)]" />
                {action.shortLabel}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] px-2.5 py-1 text-xs font-semibold text-[var(--selection-accent)]">
              Step {safeActiveActionIndex + 1} of {actions.length}: {activeAction.shortLabel}
            </span>
            {nextActionLabel ? (
              <span className="text-xs text-text-muted">Next: {nextActionLabel}</span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => selectAction(activeAction, safeActiveActionIndex)}
            className="group mt-5 flex w-full items-start gap-4 rounded-[1.25rem] border border-[rgb(var(--selection-accent-rgb)_/_0.34)] bg-[rgb(var(--selection-accent-rgb)_/_0.09)] p-4 text-left transition-colors hover:bg-[rgb(var(--selection-accent-rgb)_/_0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.55)] focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-5"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--selection-accent)] text-black shadow-[0_10px_28px_rgb(var(--selection-accent-rgb)_/_0.22)]">
              <ActiveIcon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold tracking-[-0.02em] text-foreground">{activeAction.title}</span>
              <span className="mt-1.5 block text-sm leading-6 text-text-secondary">{activeAction.description}</span>
              <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--selection-accent)]">
                {activeAction.actionLabel}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </span>
          </button>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/15">
            <button
              type="button"
              onClick={() => setShowAllActions((open) => !open)}
              aria-expanded={showAllActions}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-text-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.5)] focus-visible:ring-inset"
            >
              <span>Show all actions</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showAllActions ? "rotate-180" : ""}`} />
            </button>

            {showAllActions ? (
              <div className="grid gap-2 border-t border-white/10 p-2">
                {actions.map((action, index) => {
                  const Icon = action.icon;
                  const active = index === safeActiveActionIndex;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => selectAction(action, index)}
                      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.5)] ${
                        active
                          ? "bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-foreground"
                          : "text-text-secondary hover:bg-white/[0.045] hover:text-foreground"
                      }`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/25 text-text-muted group-hover:text-[var(--selection-accent)]">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{action.actionLabel}</span>
                        <span className="mt-0.5 block text-xs text-text-muted">{action.title}</span>
                      </span>
                      {index < safeActiveActionIndex ? <Check className="h-4 w-4 text-[var(--selection-accent)]" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
