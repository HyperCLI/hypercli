"use client";

import { useEffect, useId, useState } from "react";
import { Check, ChevronRight, Loader2, Wrench } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { getToolCallClass, getToolCallStatusClass } from "./bubbleStyles";
import { ToolCallBlock } from "./ToolCallBlock";
import type { ChatMessageType, ThemeVariant } from "./types";

type ToolCall = NonNullable<ChatMessageType["toolCalls"]>[number];

interface ToolCallStackProps {
  toolCalls: ToolCall[];
  themeVariant: ThemeVariant;
  agentId?: string | null;
  isStreaming?: boolean;
}

export const TOOL_CALL_STACK_THRESHOLD = 3;

const TOOL_STACK_PENDING_TIMEOUT_MS = 45_000;

export function shouldStackToolCalls(toolCalls: ToolCall[] | undefined): boolean {
  return (toolCalls?.length ?? 0) > TOOL_CALL_STACK_THRESHOLD;
}

function toolNamesSummary(toolCalls: ToolCall[]): string {
  const names = Array.from(new Set(toolCalls.map((tc) => tc.name).filter(Boolean)));
  if (names.length === 0) return "";
  const visible = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${visible} +${names.length - 3}` : visible;
}

export function ToolCallStack({ toolCalls, themeVariant, agentId, isStreaming = false }: ToolCallStackProps) {
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState<Record<number, boolean>>({});
  const [pendingTimedOut, setPendingTimedOut] = useState(false);

  const pendingCount = toolCalls.filter((tc) => tc.result === undefined).length;
  const completedCount = toolCalls.length - pendingCount;
  const rawPending = pendingCount > 0 && isStreaming;
  const pending = rawPending && !pendingTimedOut;
  const allDone = completedCount === toolCalls.length;
  const summary = toolNamesSummary(toolCalls);
  const statusLabel = pending ? "Running" : allDone ? "Done" : "Called";
  const progressPercent = toolCalls.length === 0 ? 0 : Math.round((completedCount / toolCalls.length) * 100);
  const statusClass = getToolCallStatusClass(allDone, pending);

  useEffect(() => {
    if (!rawPending) return;
    const timer = window.setTimeout(() => setPendingTimedOut(true), TOOL_STACK_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [rawPending]);

  const toggleToolCall = (index: number) => {
    setToolsOpen((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <motion.div
      layout
      className={`${getToolCallClass(themeVariant, allDone, pending)} relative shadow-[0_8px_22px_rgba(0,0,0,0.12)] ring-1 ring-border/55`}
      transition={{ layout: { duration: 0.2, ease: "easeOut" } }}
    >
      <button
        type="button"
        aria-controls={detailId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-low/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.35)] focus-visible:ring-inset"
      >
        <motion.span
          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-surface-low/35"
          animate={pending ? { scale: [1, 1.02, 1] } : { scale: 1 }}
          transition={pending ? { repeat: Infinity, duration: 1.6, ease: "easeInOut" } : { duration: 0.16 }}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--selection-accent)]" />
          ) : allDone ? (
            <Check className="h-3.5 w-3.5 text-[var(--selection-accent)] opacity-75" />
          ) : (
            <Wrench className="h-3.5 w-3.5 text-text-muted" />
          )}
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-surface-high px-1 text-[9px] font-bold leading-none text-foreground"
          >
            {toolCalls.length}
          </span>
        </motion.span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate font-medium text-foreground">{toolCalls.length} tool calls</span>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusClass}`}>
              {statusLabel}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-text-muted">
            {summary}
            {!allDone && ` - ${completedCount}/${toolCalls.length} done`}
          </span>
        </span>
        <motion.span
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted"
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </motion.span>
      </button>
      <div className="relative h-px bg-border/50">
        <motion.div
          className="h-px bg-[rgb(var(--selection-accent-rgb)_/_0.62)]"
          initial={false}
          animate={{ width: `${progressPercent}%` }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="stack-body"
            id={detailId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden border-t border-border"
          >
            <motion.div
              className="max-h-[420px] overflow-y-auto px-2 py-2"
              initial="closed"
              animate="open"
              exit="closed"
              variants={{
                open: { transition: { staggerChildren: 0.035, delayChildren: 0.03 } },
                closed: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
              }}
            >
              {toolCalls.map((tc, index) => (
                <motion.div
                  key={`${tc.id ?? tc.name}-${index}`}
                  variants={{
                    closed: { opacity: 0, y: -6, scale: 0.99 },
                    open: { opacity: 1, y: 0, scale: 1 },
                  }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                >
                  <ToolCallBlock
                    toolCall={tc}
                    index={index}
                    isOpen={!!toolsOpen[index]}
                    onToggle={toggleToolCall}
                    themeVariant={themeVariant}
                    agentId={agentId}
                    isStreaming={isStreaming && !pendingTimedOut}
                  />
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
