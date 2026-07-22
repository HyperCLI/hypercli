"use client";

import { useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import { ArrowLeft, ArrowRight, BookOpenText, Check, Sparkles, UserRound } from "lucide-react";

export interface JourneyIntroPanelProps {
  agentName?: string | null;
  suggestedUserName?: string | null;
  onStartBrief: (starterDirection?: string, preferredName?: string) => void;
}

interface StarterBriefSeed {
  label: string;
  direction: string;
}

interface TextRevealLine {
  text: string;
  className?: string;
}

interface TextRevealProps {
  lines: TextRevealLine[];
  className?: string;
  delay?: number;
  as?: "div" | "h2";
  lineAs?: "p" | "span";
}

const STARTER_BRIEF_SEEDS: StarterBriefSeed[] = [
  {
    label: "Track project follow-ups",
    direction: "Help me track decisions, blockers, owners, due dates, and next steps so this project keeps moving.",
  },
  {
    label: "Turn notes into next steps",
    direction: "Help me turn messy notes into a clear summary, open questions, decisions, and next actions.",
  },
  {
    label: "Review work before I send it",
    direction: "Help me review drafts for clarity, gaps, risks, and what should be improved before I share them.",
  },
  {
    label: "Prepare status updates",
    direction: "Help me prepare concise status updates with progress, risks, blockers, and asks.",
  },
  {
    label: "Catch loose ends",
    direction: "Help me notice missing details, unanswered questions, risks, and follow-ups before work moves forward.",
  },
  {
    label: "Plan a piece of work",
    direction: "Help me break a goal into a practical plan with milestones, owners, dependencies, and a safe first step.",
  },
];

const SLIDE_COUNT = 4;

function TextReveal({ lines, className, delay = 0, as = "div", lineAs = "p" }: TextRevealProps) {
  const reducedMotion = useReducedMotion();
  const Container = as === "h2" ? "h2" : "div";
  const containerVariants: Variants = {
    hidden: {},
    visible: { transition: { delayChildren: delay, staggerChildren: 0.045 } },
  };
  const lineVariants: Variants = {
    hidden: { opacity: 0, y: 6 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.22, ease: "easeOut" },
    },
  };

  if (reducedMotion) {
    return (
      <Container className={className}>
        {lines.map((line) => (
          lineAs === "span" ? (
            <span key={line.text} className={line.className}>{line.text}</span>
          ) : (
            <p key={line.text} className={line.className}>{line.text}</p>
          )
        ))}
      </Container>
    );
  }

  const content = lines.map((line) => (
    lineAs === "span" ? (
      <motion.span key={line.text} className={line.className} variants={lineVariants}>{line.text}</motion.span>
    ) : (
      <motion.p key={line.text} className={line.className} variants={lineVariants}>{line.text}</motion.p>
    )
  ));

  return as === "h2" ? (
    <motion.h2 className={className} initial="hidden" animate="visible" variants={containerVariants}>{content}</motion.h2>
  ) : (
    <motion.div className={className} initial="hidden" animate="visible" variants={containerVariants}>{content}</motion.div>
  );
}

export function JourneyIntroPanel({ agentName, suggestedUserName, onStartBrief }: JourneyIntroPanelProps) {
  const reducedMotion = useReducedMotion();
  const [slideIndex, setSlideIndex] = useState(0);
  const [preferredNameOverride, setPreferredNameOverride] = useState<string | null>(null);
  const displayName = agentName?.trim() || "your agent";
  const suggestedName = suggestedUserName?.trim() ?? "";
  const preferredName = preferredNameOverride ?? suggestedName;
  const lastSlide = slideIndex === SLIDE_COUNT - 1;

  function preferredNameForBrief(): string | undefined {
    return preferredName.trim() || undefined;
  }

  function goToSlide(index: number) {
    setSlideIndex(Math.min(Math.max(index, 0), SLIDE_COUNT - 1));
  }

  function goBack() {
    goToSlide(slideIndex - 1);
  }

  function goNext() {
    if (lastSlide) {
      onStartBrief(undefined, preferredNameForBrief());
      return;
    }
    goToSlide(slideIndex + 1);
  }

  function selectStarterBrief(seed: StarterBriefSeed) {
    onStartBrief(seed.direction, preferredNameForBrief());
  }

  function handleDeckKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, button, textarea, select")) return;
    if (event.key === "ArrowLeft" && slideIndex > 0) {
      event.preventDefault();
      goBack();
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    }
  }

  return (
    <section className="w-full max-w-[36rem] px-3 py-3 text-foreground sm:px-4">
      <motion.div
        onKeyDown={handleDeckKeyDown}
        tabIndex={0}
        initial={reducedMotion ? false : { opacity: 0, y: 10, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
        className="relative overflow-visible rounded-[1.2rem] border border-border bg-surface/95 p-4 shadow-[0_20px_70px_rgba(0,0,0,0.24)] outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] sm:p-5"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[1.2rem] border border-[rgb(var(--selection-accent-rgb)_/_0.16)]" />

        <div className="relative">
          <div className="flex items-center justify-between gap-3">
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut", delay: reducedMotion ? 0 : 0.04 }}
              className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.22)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--selection-accent)]"
            >
              <Sparkles className="h-3 w-3" />
              Journey Briefing
            </motion.div>

            <div className="flex items-center gap-1.5" aria-label="Journey intro slides">
              {Array.from({ length: SLIDE_COUNT }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => goToSlide(index)}
                  aria-label={`Open intro slide ${index + 1}`}
                  aria-current={index === slideIndex ? "step" : undefined}
                  className={`h-1.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] ${
                    index === slideIndex
                      ? "w-6 bg-[var(--selection-accent)]"
                      : "w-2 bg-border hover:bg-border-strong"
                  }`}
                />
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {slideIndex === 0 ? (
              <motion.div
                key="welcome"
                initial={reducedMotion ? false : { opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, x: -10 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="min-h-[17.5rem] pt-4"
              >
                <TextReveal
                  as="h2"
                  lineAs="span"
                  delay={0.04}
                  className="text-[1.65rem] font-semibold leading-tight tracking-[-0.04em] text-foreground sm:text-[1.95rem]"
                  lines={[
                    { text: "Welcome to your Journey", className: "block" },
                    { text: `with ${displayName}`, className: "block" },
                  ]}
                />
                <TextReveal
                  delay={0.1}
                  className="mt-3 max-w-[32rem] space-y-2 text-sm leading-6 text-text-secondary"
                  lines={[
                    { text: `This starts by shaping ${displayName} into a useful teammate for the work you already know.` },
                    { text: "In a few steps, you will introduce the role, confirm how it should address you, and choose one clear first duty." },
                  ]}
                />
              </motion.div>
            ) : null}

            {slideIndex === 1 ? (
              <motion.div
                key="teammate"
                initial={reducedMotion ? false : { opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, x: -10 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="min-h-[17.5rem] pt-4"
              >
                <TextReveal
                  as="h2"
                  delay={0.04}
                  className="text-[1.45rem] font-semibold leading-tight tracking-[-0.035em] text-foreground sm:text-[1.75rem]"
                  lines={[{ text: "Introduce the teammate to its duties." }]}
                />
                <TextReveal
                  delay={0.1}
                  className="mt-3 max-w-[32rem] space-y-2 text-sm leading-6 text-text-secondary"
                  lines={[
                    { text: `Like any teammate, ${displayName} works best when you explain what it is responsible for, what good help looks like, which sources to trust, and when to pause and ask.` },
                    { text: "Journey turns that introduction into a first brief, then keeps refining it as you work together." },
                  ]}
                />
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {["Duties", "Trusted sources", "Boundaries", "Good results"].map((item) => (
                    <div key={item} className="flex items-center gap-2 rounded-xl border border-border bg-surface-high/40 px-3 py-2 text-xs font-semibold text-text-secondary">
                      <Check className="h-3.5 w-3.5 text-[var(--selection-accent)]" />
                      {item}
                    </div>
                  ))}
                </div>
              </motion.div>
            ) : null}

            {slideIndex === 2 ? (
              <motion.div
                key="name"
                initial={reducedMotion ? false : { opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, x: -10 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="min-h-[17.5rem] pt-4"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]">
                  <UserRound className="h-4.5 w-4.5" />
                </div>
                <TextReveal
                  as="h2"
                  delay={0.04}
                  className="mt-3 text-[1.45rem] font-semibold leading-tight tracking-[-0.035em] text-foreground sm:text-[1.75rem]"
                  lines={[{ text: `What should ${displayName} call you?` }]}
                />
                <div className="mt-4 rounded-[1rem] border border-border bg-surface-high/40 p-3">
                  <label htmlFor="journey-preferred-name" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    Preferred name
                  </label>
                  <input
                    id="journey-preferred-name"
                    type="text"
                    value={preferredName}
                    onChange={(event) => setPreferredNameOverride(event.target.value)}
                    placeholder="Your name"
                    className="mt-2 h-9 w-full rounded-lg border border-border bg-background/60 px-3 text-sm font-medium text-foreground placeholder:text-text-muted outline-none transition-colors focus:border-[rgb(var(--selection-accent-rgb)_/_0.45)] focus:ring-2 focus:ring-[rgb(var(--selection-accent-rgb)_/_0.18)]"
                  />
                  <p className="mt-2 text-xs leading-5 text-text-muted">
                    We&apos;ll include this in the first brief so your agent knows how to address you. You can change it before you start.
                  </p>
                </div>
              </motion.div>
            ) : null}

            {slideIndex === 3 ? (
              <motion.div
                key="duty"
                initial={reducedMotion ? false : { opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, x: -10 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="min-h-[17.5rem] pt-4"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]">
                  <BookOpenText className="h-4.5 w-4.5" />
                </div>
                <TextReveal
                  as="h2"
                  delay={0.04}
                  className="mt-3 text-[1.45rem] font-semibold leading-tight tracking-[-0.035em] text-foreground sm:text-[1.75rem]"
                  lines={[{ text: "Choose a clear first duty." }]}
                />
                <TextReveal
                  delay={0.1}
                  className="mt-2 max-w-[32rem] text-sm leading-6 text-text-secondary"
                  lines={[{ text: `Pick one example to give ${displayName} a practical starting role, or start the brief without an example.` }]}
                />
                <div className="mt-4 grid gap-2" role="group" aria-label="Starter brief directions">
                  {STARTER_BRIEF_SEEDS.map((seed, index) => (
                    <motion.button
                      key={seed.label}
                      type="button"
                      onClick={() => selectStarterBrief(seed)}
                      aria-label={`Use starter direction: ${seed.label}`}
                      initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, ease: "easeOut", delay: reducedMotion ? 0 : 0.08 + index * 0.025 }}
                      whileHover={reducedMotion ? undefined : { y: -1 }}
                      whileTap={reducedMotion ? undefined : { scale: 0.99 }}
                      className="rounded-xl border border-border bg-surface-high/40 px-3 py-2 text-left text-xs font-semibold leading-5 text-text-secondary transition-colors hover:border-[rgb(var(--selection-accent-rgb)_/_0.3)] hover:bg-[rgb(var(--selection-accent-rgb)_/_0.08)] hover:text-[var(--selection-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.5)]"
                    >
                      {seed.label}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <button
              type="button"
              onClick={goBack}
              disabled={slideIndex === 0}
              className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-text-muted transition-colors hover:bg-surface-high hover:text-foreground disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>

            <button
              type="button"
              onClick={goNext}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--selection-accent)] px-3.5 text-sm font-semibold text-[var(--selection-accent-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.55)]"
            >
              {lastSlide ? "Start the brief" : "Next"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
