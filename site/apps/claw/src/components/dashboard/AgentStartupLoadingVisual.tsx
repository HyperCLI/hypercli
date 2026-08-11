"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import {
  AgentGatewayErrorVisual,
  GATEWAY_LOADING_DETAIL,
  GATEWAY_LOADING_TITLE,
} from "@/components/dashboard/AgentGatewayLoadingVisual";

export const AGENT_STARTUP_TIP_INTERVAL_MS = 5_000;

interface AgentStartupTip {
  label: string;
  text: string;
}

const AGENT_STARTUP_TIPS: AgentStartupTip[] = [
  {
    label: "Start with the finish line",
    text: "Tell your agent what a good result looks like, not only what to do.",
  },
  {
    label: "Bring the source with you",
    text: "Add a file or type @ in chat so your agent can work from the same context.",
  },
  {
    label: "Write a stronger brief",
    text: "Name the goal, the audience, trusted sources, and when your agent should pause and ask.",
  },
  {
    label: "Keep the methods that work",
    text: "When a workflow works well once, turn it into a Skill so it is ready next time.",
  },
  {
    label: "Put proven work on repeat",
    text: "Schedule repeat work after the prompt feels solid. A good one-off makes the best recurring task.",
  },
  {
    label: "Work where the work happens",
    text: "Connect the tools you already use so your agent does not have to live in a separate chat.",
  },
  {
    label: "Make decisions easy to find",
    text: "Keep durable decisions in workspace files instead of burying them in a long conversation.",
  },
  {
    label: "Share context deliberately",
    text: "Use Shared Knowledge for context several agents need. Keep private working files with each agent.",
  },
  {
    label: "Keep shaping the role",
    text: "Your first setup is not permanent. Refine instructions, connections, and context as the work grows.",
  },
  {
    label: "Feedback can stay simple",
    text: "Say what landed, what missed, and what you want changed in the next pass.",
  },
];

export interface AgentStartupLoadingVisualProps {
  heading?: string;
  note?: string;
  title?: string;
  detail?: string;
  className?: string;
  status?: "loading" | "error";
  actionLabel?: string;
  onAction?: () => void;
}

function LoadingDots() {
  const reducedMotion = useReducedMotion();

  return (
    <span
      aria-hidden="true"
      data-slot="loading-dots"
      className="ml-1.5 inline-flex items-center gap-1"
    >
      {[0, 1, 2].map((index) => (
        reducedMotion ? (
          <span key={index} className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
        ) : (
          <motion.span
            key={index}
            className="h-1.5 w-1.5 rounded-full bg-current"
            animate={{ opacity: [0.18, 1, 0.18] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: index * 0.2 }}
          />
        )
      ))}
    </span>
  );
}

export function AgentStartupTipsVisual({
  heading = "Your teammate is warming up",
  note = "Starts can take about a minute.",
  title = GATEWAY_LOADING_TITLE,
  detail = GATEWAY_LOADING_DETAIL,
  className = "",
  actionLabel,
  onAction,
}: Pick<AgentStartupLoadingVisualProps, "heading" | "note" | "title" | "detail" | "className" | "actionLabel" | "onAction">) {
  const reducedMotion = useReducedMotion();
  const [tipIndex, setTipIndex] = useState(0);
  const tip = AGENT_STARTUP_TIPS[tipIndex];
  const statusTitle = title.replace(/\s*\.+$/, "").trim();

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % AGENT_STARTUP_TIPS.length);
    }, AGENT_STARTUP_TIP_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section
      aria-label="Agent startup"
      data-slot="agent-startup-tips"
      className={`flex max-h-full min-h-0 w-full max-w-[38rem] flex-col items-center justify-center text-center ${className}`}
    >
      <div className="w-full">
        <h2 className="text-balance text-[clamp(1.35rem,4vw,1.8rem)] font-semibold leading-tight tracking-[-0.035em] text-foreground">
          {heading}
        </h2>
        <p className="mx-auto mt-2 max-w-[34rem] text-sm leading-6 text-text-muted">{note}</p>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`${statusTitle} ${detail}`}
          className="mx-auto mt-6 max-w-full"
        >
          <span className="inline-flex items-center text-base font-semibold leading-6 text-foreground">
            {statusTitle}
            <LoadingDots />
          </span>
          <span className="mt-1 block text-[13px] leading-5 text-text-muted">{detail}</span>
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="mt-5 inline-flex min-h-10 max-w-full items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="break-words">{actionLabel}</span>
          </button>
        ) : null}
      </div>

      <div className="mt-10 w-full border-t border-border pt-4 text-left" aria-live="off">
        <div className="relative min-h-[4.75rem] overflow-hidden">
          <AnimatePresence initial={false}>
            <motion.div
              key={tip.label}
              initial={reducedMotion ? false : { opacity: 0, y: 6, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -4, filter: "blur(2px)" }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.24, ease: "easeOut" }}
              className="absolute inset-x-0 top-0"
            >
              <span className="block text-sm font-semibold leading-5 text-foreground">{tip.label}</span>
              <span className="mt-1 block max-w-[58ch] text-sm leading-6 text-text-secondary">{tip.text}</span>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

export function AgentStartupLoadingVisual(props: AgentStartupLoadingVisualProps) {
  if (props.status === "error") {
    return (
      <AgentGatewayErrorVisual
        title={props.title}
        detail={props.detail}
        className={props.className}
        actionLabel={props.actionLabel}
        onAction={props.onAction}
      />
    );
  }

  return (
    <AgentStartupTipsVisual
      heading={props.heading}
      note={props.note}
      title={props.title}
      detail={props.detail}
      className={props.className}
      actionLabel={props.actionLabel}
      onAction={props.onAction}
    />
  );
}
