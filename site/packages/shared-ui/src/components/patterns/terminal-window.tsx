"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "../ui/utils";

export type TerminalLineTone = "cmd" | "output" | "comment" | "success";

export interface TerminalLine {
  prompt?: string;
  text: string;
  tone?: TerminalLineTone;
}

export interface TerminalWindowProps {
  title?: string;
  lines: TerminalLine[];
  typed?: boolean;
  className?: string;
}

const lineClasses: Record<TerminalLineTone, string> = {
  cmd: "text-terminal-foreground",
  output: "text-terminal-muted",
  comment: "text-terminal-muted/70 italic",
  success: "text-terminal-live",
};

function TerminalLineRow({ line, showCursor }: { line: TerminalLine; showCursor?: boolean }) {
  const tone = line.tone ?? "output";
  const prompt = line.prompt ?? (tone === "cmd" ? "$" : undefined);
  return (
    <div className={cn("whitespace-pre-wrap break-words", lineClasses[tone])}>
      {prompt && <span className="mr-2 select-none text-terminal-live">{prompt}</span>}
      {line.text}
      {showCursor && <span className="ml-1 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-terminal-live" aria-hidden="true" />}
    </div>
  );
}

export function TerminalWindow({ title = "terminal", lines, typed = false, className }: TerminalWindowProps) {
  const reduceMotion = useReducedMotion();
  const animated = typed && !reduceMotion;
  const [visibleCount, setVisibleCount] = useState(animated ? 0 : lines.length);

  useEffect(() => {
    if (!animated) {
      setVisibleCount(lines.length);
      return;
    }
    setVisibleCount(0);
    const timer = setInterval(() => {
      setVisibleCount((count) => {
        if (count >= lines.length) {
          clearInterval(timer);
          return count;
        }
        return count + 1;
      });
    }, 450);
    return () => clearInterval(timer);
  }, [animated, lines.length]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-terminal-border bg-terminal-background shadow-[var(--elevation-shadow-strong)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-terminal-border bg-terminal-surface px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-text-muted/50" aria-hidden="true" />
        <span className="h-3 w-3 rounded-full bg-text-muted/40" aria-hidden="true" />
        <span className="h-3 w-3 rounded-full bg-terminal-live/70" aria-hidden="true" />
        <span className="ml-3 truncate font-mono text-xs text-terminal-muted">{title}</span>
      </div>
      <div className="space-y-1.5 p-5 font-mono text-sm leading-relaxed">
        {lines.slice(0, visibleCount).map((line, index) => {
          const isLast = index === visibleCount - 1;
          const row = <TerminalLineRow line={line} showCursor={animated && isLast} />;
          return animated ? (
            <motion.div key={index} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              {row}
            </motion.div>
          ) : (
            <div key={index}>{row}</div>
          );
        })}
      </div>
    </div>
  );
}
