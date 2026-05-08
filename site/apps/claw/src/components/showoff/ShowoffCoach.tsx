"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";

import type { ShowoffStep } from "./types";

type CompletedStepIds = Set<string> | readonly string[];

export interface ShowoffCoachProps {
  title: string;
  steps: ShowoffStep[];
  open: boolean;
  activeIndex: number;
  completedIds: CompletedStepIds;
  runningActionId?: string | null;
  error?: string | null;
  onOpen: () => void;
  onClose: () => void;
  onRestart: () => void;
  onSelectStep: (index: number) => void;
  onBack: () => void;
  onNext: () => void;
  onRunAction: (step: ShowoffStep) => void | Promise<void>;
}

function toCompletedSet(completedIds: CompletedStepIds) {
  return completedIds instanceof Set ? completedIds : new Set(completedIds);
}

export function ShowoffCoach({
  title,
  steps,
  open,
  activeIndex,
  completedIds,
  runningActionId,
  error,
  onOpen,
  onClose,
  onRestart,
  onSelectStep,
  onBack,
  onNext,
  onRunAction,
}: ShowoffCoachProps) {
  const activeStep = steps[activeIndex] ?? steps[0] ?? null;
  const completedSet = toCompletedSet(completedIds);
  const completedCount = steps.filter((step) => completedSet.has(step.id)).length;
  const progress = steps.length === 0 ? 0 : Math.round((completedCount / steps.length) * 100);
  const activeStepCompleted = activeStep ? completedSet.has(activeStep.id) : false;
  const runningActiveAction = Boolean(activeStep && runningActionId === activeStep.id);

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-background px-3 py-2 text-sm font-semibold text-primary shadow-[0_18px_48px_rgba(0,0,0,0.35)] hover:bg-surface-low"
      >
        <Sparkles className="h-4 w-4" />
        Showoff
      </button>
    );
  }

  return (
    <>
      <section
        aria-label={title}
        className="fixed bottom-5 right-5 z-50 max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-primary/30 bg-background shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
      >
        <div className="h-1 bg-border">
          <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
        <div className="max-h-[calc(100dvh-2.25rem)] overflow-y-auto p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                {title}
              </div>
              <p className="mt-1 text-sm text-text-muted">
                {completedCount} of {steps.length} complete
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onRestart}
                className="rounded-md p-1.5 text-text-muted hover:bg-surface-low hover:text-foreground"
                title="Restart showoff"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1.5 text-text-muted hover:bg-surface-low hover:text-foreground"
                title="Close showoff"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            {steps.map((step, index) => {
              const selected = index === activeIndex;
              const complete = completedSet.has(step.id);
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => onSelectStep(index)}
                  className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition ${
                    selected
                      ? "border-primary/50 bg-primary/10"
                      : "border-border bg-surface-low/50 hover:border-primary/30 hover:bg-surface-low"
                  }`}
                  aria-current={selected ? "step" : undefined}
                >
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    complete
                      ? "border-primary bg-primary text-primary-foreground"
                      : selected
                        ? "border-primary text-primary"
                        : "border-border text-text-muted"
                  }`}>
                    {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="text-[10px] font-semibold">{index + 1}</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold uppercase text-primary">{step.eyebrow}</span>
                    <span className="block text-sm font-semibold text-foreground">{step.title}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {activeStep ? (
            <div className="mt-4 border-t border-border pt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-primary">{activeStep.eyebrow}</p>
                  <h2 className="mt-1 text-base font-semibold text-foreground">{activeStep.title}</h2>
                </div>
                {activeStepCompleted ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Done
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{activeStep.body}</p>

              {activeStep.capabilities?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {activeStep.capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="rounded-full border border-border bg-surface-low px-2 py-1 text-xs font-medium text-text-secondary"
                    >
                      {capability}
                    </span>
                  ))}
                </div>
              ) : null}

              {error ? (
                <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  {activeStep.actionLabel ? (
                    <button
                      type="button"
                      onClick={() => { void onRunAction(activeStep); }}
                      disabled={runningActiveAction}
                      className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60"
                    >
                      {runningActiveAction ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {activeStep.actionLabel}
                    </button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onBack}
                    disabled={activeIndex === 0}
                    className="btn-secondary inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </button>
                  <button type="button" onClick={onNext} className="btn-primary inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold">
                    {activeIndex === steps.length - 1 ? "Finish" : "Next"}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
