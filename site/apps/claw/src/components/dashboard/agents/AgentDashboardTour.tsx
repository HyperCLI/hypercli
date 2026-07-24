"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import {
  ArrowRight,
  Bot,
  Brain,
  Check,
  Database,
  FileText,
  Link2,
  MessageSquare,
  Rocket,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@hypercli/shared-ui";

import { HyperCLILogoMark } from "@/components/HyperCLILogoLink";

export interface AgentDashboardTourProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartCreating: () => void;
}

interface AgentTourStep {
  eyebrow: string;
  title: string;
  description: string;
  highlights: string[];
  visualLabel: string;
}

const TOUR_STEPS: AgentTourStep[] = [
  {
    eyebrow: "A persistent workspace",
    title: "Build a teammate, not another chat window.",
    description: "Your agent gets a dedicated workspace where files, instructions, and ongoing work stay together between conversations.",
    highlights: ["Its own files and memory", "Tools ready when work starts", "A private place to keep context"],
    visualLabel: "Workspace online",
  },
  {
    eyebrow: "Context that compounds",
    title: "Start with a purpose. Add knowledge as you go.",
    description: "Name the role, bring the sources that matter, and connect the places where work happens. You can refine everything later.",
    highlights: ["Upload working documents", "Connect channels and tools", "Shape clear duties and boundaries"],
    visualLabel: "Context connected",
  },
  {
    eyebrow: "Ready for real work",
    title: "Choose capacity, then put your agent to work.",
    description: "Start with the plan that fits today. Your setup stays editable, and you can add more capability whenever the role grows.",
    highlights: ["Start free or choose more power", "Launch into a ready workspace", "Grow without rebuilding the role"],
    visualLabel: "Ready to launch",
  },
];

const slideVariants: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction > 0 ? 22 : -22 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction > 0 ? -18 : 18 }),
};

function StatusPill({ icon: Icon, children, className = "" }: {
  icon: typeof Check;
  children: string;
  className?: string;
}) {
  return (
    <div className={`absolute flex items-center gap-2 rounded-xl border border-border bg-background/90 px-3 py-2 text-[11px] font-semibold text-foreground shadow-[0_12px_32px_rgba(0,0,0,0.18)] backdrop-blur-md ${className}`}>
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-[var(--selection-accent)]">
        <Icon className="h-3.5 w-3.5" />
      </span>
      {children}
    </div>
  );
}

function WorkspaceIllustration() {
  return (
    <div className="relative h-[250px] w-[300px] max-w-full scale-[0.78] sm:scale-90 md:scale-100">
      <div className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.18)]" />
      <div className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rotate-6 rounded-[30px] border border-[rgb(var(--selection-accent-rgb)_/_0.32)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)]" />
      <div className="absolute left-1/2 top-1/2 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[26px] border border-border bg-background shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
        <HyperCLILogoMark className="h-12 w-12" />
        <span className="absolute bottom-3 right-3 h-3 w-3 rounded-full border-2 border-background bg-[var(--selection-accent)]" />
      </div>
      <StatusPill icon={FileText} className="left-0 top-7">Files in reach</StatusPill>
      <StatusPill icon={MessageSquare} className="bottom-7 right-0">Context kept</StatusPill>
      <StatusPill icon={Zap} className="right-1 top-2">Always ready</StatusPill>
      <div className="absolute bottom-4 left-12 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--selection-accent)]" />
        Agent workspace
      </div>
    </div>
  );
}

function ContextIllustration() {
  return (
    <div className="relative h-[250px] w-[310px] max-w-full scale-[0.78] sm:scale-90 md:scale-100">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 310 250" fill="none" aria-hidden="true">
        <path d="M55 62 C100 62 105 125 145 125" stroke="rgb(var(--selection-accent-rgb) / 0.36)" strokeWidth="1.5" strokeDasharray="4 6" />
        <path d="M55 188 C100 188 105 125 145 125" stroke="rgb(var(--selection-accent-rgb) / 0.36)" strokeWidth="1.5" strokeDasharray="4 6" />
        <path d="M255 62 C210 62 205 125 165 125" stroke="rgb(var(--selection-accent-rgb) / 0.36)" strokeWidth="1.5" strokeDasharray="4 6" />
        <path d="M255 188 C210 188 205 125 165 125" stroke="rgb(var(--selection-accent-rgb) / 0.36)" strokeWidth="1.5" strokeDasharray="4 6" />
      </svg>
      <div className="absolute left-1/2 top-1/2 z-10 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.36)] bg-background shadow-[0_0_0_12px_rgb(var(--selection-accent-rgb)_/_0.07),0_22px_55px_rgba(0,0,0,0.24)]">
        <Brain className="h-9 w-9 text-[var(--selection-accent)]" />
      </div>
      {[
        { Icon: FileText, label: "Docs", position: "left-2 top-7" },
        { Icon: MessageSquare, label: "Chats", position: "bottom-6 left-2" },
        { Icon: Link2, label: "Tools", position: "right-2 top-7" },
        { Icon: Database, label: "Memory", position: "bottom-6 right-2" },
      ].map(({ Icon, label, position }) => (
        <div key={label} className={`absolute ${position} flex h-[70px] w-[74px] flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-background/90 text-text-secondary shadow-[0_12px_32px_rgba(0,0,0,0.16)] backdrop-blur-md`}>
          <Icon className="h-5 w-5 text-[var(--selection-accent)]" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">{label}</span>
        </div>
      ))}
      <div className="absolute left-1/2 top-[14px] -translate-x-1/2 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--selection-accent)]">
        One shared context
      </div>
    </div>
  );
}

function LaunchIllustration() {
  return (
    <div className="relative h-[250px] w-[310px] max-w-full scale-[0.78] sm:scale-90 md:scale-100">
      <div className="absolute inset-x-6 bottom-8 top-7 rotate-[-2deg] rounded-[28px] border border-border bg-background/75 shadow-[0_24px_60px_rgba(0,0,0,0.22)] backdrop-blur-md" />
      <div className="absolute inset-x-9 bottom-11 top-4 rotate-[2deg] rounded-[26px] border border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-surface-high/90 p-5 shadow-[0_20px_55px_rgba(0,0,0,0.2)]">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-text-muted">Launch brief</div>
            <div className="mt-1 text-lg font-semibold tracking-[-0.03em] text-foreground">Research agent</div>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--selection-accent)] text-[var(--selection-accent-foreground)]">
            <Rocket className="h-5 w-5" />
          </span>
        </div>
        <div className="mt-5 space-y-2.5">
          {["Workspace prepared", "Knowledge attached", "Capacity selected"].map((label) => (
            <div key={label} className="flex items-center justify-between rounded-xl border border-border bg-background/70 px-3 py-2">
              <span className="text-[11px] font-medium text-text-secondary">{label}</span>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-[var(--selection-accent)]">
                <Check className="h-3 w-3" />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="absolute bottom-0 right-0 flex items-center gap-2 rounded-xl border border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-background px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.2)]">
        <Sparkles className="h-4 w-4 text-[var(--selection-accent)]" />
        <span className="text-[11px] font-semibold text-foreground">Ready for work</span>
      </div>
    </div>
  );
}

function StepIllustration({ stepIndex }: { stepIndex: number }) {
  if (stepIndex === 1) return <ContextIllustration />;
  if (stepIndex === 2) return <LaunchIllustration />;
  return <WorkspaceIllustration />;
}

export function AgentDashboardTour({ open, onOpenChange, onStartCreating }: AgentDashboardTourProps) {
  const reducedMotion = useReducedMotion();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const step = TOUR_STEPS[stepIndex];
  const lastStep = stepIndex === TOUR_STEPS.length - 1;

  function goToStep(nextIndex: number) {
    const clampedIndex = Math.min(Math.max(nextIndex, 0), TOUR_STEPS.length - 1);
    setDirection(clampedIndex >= stepIndex ? 1 : -1);
    setStepIndex(clampedIndex);
  }

  function handleContinue() {
    if (lastStep) {
      setStepIndex(0);
      onStartCreating();
      return;
    }
    goToStep(stepIndex + 1);
  }

  function handleSkip() {
    setStepIndex(0);
    onStartCreating();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setStepIndex(0);
    onOpenChange(nextOpen);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button, input, textarea, select, a")) return;
    if (event.key === "ArrowLeft" && stepIndex > 0) {
      event.preventDefault();
      goToStep(stepIndex - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      handleContinue();
    }
  }

  const transition = reducedMotion ? { duration: 0 } : { duration: 0.24, ease: "easeOut" as const };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeLabel="Close agent tour"
        overlayClassName="z-[79] bg-black/70 backdrop-blur-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          headingRef.current?.focus();
        }}
        className="z-[80] h-[min(760px,calc(100dvh-1rem))] w-[min(1040px,calc(100vw-1rem))] max-w-none grid-rows-[minmax(210px,0.78fr)_minmax(0,1.22fr)] gap-0 overflow-hidden rounded-[24px] border-border bg-background p-0 shadow-[0_32px_100px_rgba(0,0,0,0.48)] sm:h-[min(720px,calc(100dvh-2rem))] sm:w-[min(1040px,calc(100vw-2rem))] sm:max-w-none md:h-[min(650px,calc(100dvh-2.5rem))] md:grid-cols-[0.92fr_1.08fr] md:grid-rows-1"
      >
        <DialogTitle className="sr-only">A quick tour of your agent workspace</DialogTitle>
        <DialogDescription className="sr-only">
          Learn how agent workspaces, context, and launch plans fit together before creating your agent.
        </DialogDescription>

        <div onKeyDown={handleKeyDown} className="contents">
          <div
            aria-hidden="true"
            className="relative flex min-h-0 flex-col overflow-hidden border-b border-border bg-surface-low md:border-b-0 md:border-r"
            style={{
              backgroundImage: "radial-gradient(circle at 52% 48%, rgb(var(--selection-accent-rgb) / 0.16), transparent 34%), linear-gradient(color-mix(in srgb, var(--foreground) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--foreground) 4%, transparent) 1px, transparent 1px)",
              backgroundSize: "auto, 28px 28px, 28px 28px",
            }}
          >
            <div className="relative z-10 flex items-center gap-2 px-5 pt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted sm:px-7 sm:pt-7">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)]">
                <Bot className="h-3.5 w-3.5 text-[var(--selection-accent)]" />
              </span>
              Agent briefing
            </div>
            <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center">
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                  key={stepIndex}
                  custom={direction}
                  variants={slideVariants}
                  initial={reducedMotion ? false : "enter"}
                  animate="center"
                  exit={reducedMotion ? undefined : "exit"}
                  transition={transition}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <StepIllustration stepIndex={stepIndex} />
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="relative z-10 hidden items-center justify-between px-7 pb-7 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted sm:flex">
              <span>{String(stepIndex + 1).padStart(2, "0")} / {String(TOUR_STEPS.length).padStart(2, "0")}</span>
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--selection-accent)] shadow-[0_0_0_4px_rgb(var(--selection-accent-rgb)_/_0.1)]" />
                {step.visualLabel}
              </span>
            </div>
          </div>

          <section className="flex min-h-0 flex-col px-5 pb-5 pt-6 sm:px-8 sm:pb-7 sm:pt-8 md:px-10 md:pb-9 md:pt-10 lg:px-12">
            <div className="flex items-center justify-between gap-4 pr-8">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--selection-accent)]">How it works</span>
              <span className="font-mono text-[11px] font-medium tabular-nums text-text-muted" aria-label={`Step ${stepIndex + 1} of ${TOUR_STEPS.length}`}>
                {stepIndex + 1} / {TOUR_STEPS.length}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto py-5 sm:py-7 md:flex md:items-center">
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                  key={stepIndex}
                  custom={direction}
                  variants={slideVariants}
                  initial={reducedMotion ? false : "enter"}
                  animate="center"
                  exit={reducedMotion ? undefined : "exit"}
                  transition={transition}
                  className="w-full"
                  aria-live="polite"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">{step.eyebrow}</p>
                  <h2
                    ref={stepIndex === 0 ? headingRef : undefined}
                    tabIndex={stepIndex === 0 ? -1 : undefined}
                    className="mt-3 max-w-[31rem] text-[clamp(1.7rem,4.2vw,2.65rem)] font-semibold leading-[1.05] tracking-[-0.045em] text-foreground outline-none"
                  >
                    {step.title}
                  </h2>
                  <p className="mt-4 max-w-[31rem] text-[13px] leading-6 text-text-secondary sm:text-[15px] sm:leading-7">
                    {step.description}
                  </p>
                  <div className="mt-5 grid gap-2 sm:mt-6">
                    {step.highlights.map((highlight, index) => (
                      <motion.div
                        key={highlight}
                        initial={reducedMotion ? false : { opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={reducedMotion ? { duration: 0 } : { delay: 0.08 + index * 0.04, duration: 0.18 }}
                        className="flex items-center gap-3 text-[12px] font-medium text-text-secondary sm:text-[13px]"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] text-[var(--selection-accent)]">
                          {stepIndex === 2 && index === 0 ? <Rocket className="h-3 w-3" /> : stepIndex === 0 && index === 2 ? <Shield className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                        </span>
                        {highlight}
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border pt-4 sm:pt-5">
              <Button type="button" variant="ghost" onClick={handleSkip} className="h-10 rounded-xl px-2 text-text-muted hover:text-foreground sm:px-3">
                Skip tour
              </Button>
              <div className="flex items-center gap-1.5" role="group" aria-label="Tour steps">
                {TOUR_STEPS.map((tourStep, index) => (
                  <button
                    key={tourStep.title}
                    type="button"
                    onClick={() => goToStep(index)}
                    aria-label={`Open tour step ${index + 1}`}
                    aria-current={index === stepIndex ? "step" : undefined}
                    className={`h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.5)] focus-visible:ring-offset-2 focus-visible:ring-offset-background ${index === stepIndex ? "w-6 bg-[var(--selection-accent)]" : "w-2 bg-border-strong hover:bg-text-muted"}`}
                  />
                ))}
              </div>
              <Button type="button" onClick={handleContinue} className="h-10 rounded-xl px-4 font-semibold sm:px-5">
                {lastStep ? "Create my agent" : "Continue"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </footer>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
