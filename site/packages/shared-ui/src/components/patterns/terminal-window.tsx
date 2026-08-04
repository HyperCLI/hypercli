"use client";

import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
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

function Prompt({ tone }: { tone: TerminalLineTone }) {
  if (tone !== "cmd") return null;
  return <span className="mr-2 select-none text-terminal-live">$</span>;
}

function Cursor() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-[1.05em] w-[0.55em] translate-y-[0.2em] animate-[pulse-green_1s_steps(2)_infinite] bg-terminal-live"
    />
  );
}

function StaticRow({ line }: { line: TerminalLine }) {
  const tone = line.tone ?? "output";
  return (
    <div className={cn("whitespace-pre-wrap break-words", lineClasses[tone])}>
      {line.prompt ? <span className="mr-2 select-none text-terminal-live">{line.prompt}</span> : <Prompt tone={tone} />}
      {line.text}
    </div>
  );
}

function TypedRows({ lines, cps = 55 }: { lines: TerminalLine[]; cps?: number }) {
  const totalChars = useMemo(() => lines.reduce((sum, line) => sum + line.text.length, 0), [lines]);
  const [typedChars, setTypedChars] = useState(0);

  useEffect(() => {
    if (typedChars >= totalChars) return;
    const interval = setInterval(() => {
      setTypedChars((count) => Math.min(count + 1, totalChars));
    }, 1000 / cps);
    return () => clearInterval(interval);
  }, [typedChars, totalChars, cps]);

  let remaining = typedChars;
  const done = typedChars >= totalChars;

  return (
    <>
      {lines.map((line, index) => {
        const tone = line.tone ?? "output";
        const take = Math.max(0, Math.min(line.text.length, remaining));
        const isActive = !done && take < line.text.length && (take > 0 || lines.slice(0, index).every((l) => l.text.length === 0));
        remaining -= take;
        return (
          <div key={index} className={cn("whitespace-pre-wrap break-words", lineClasses[tone])}>
            {line.prompt ? <span className="mr-2 select-none text-terminal-live">{line.prompt}</span> : <Prompt tone={tone} />}
            <span>{line.text.slice(0, take)}</span>
            {isActive && <Cursor />}
            <span className="invisible" aria-hidden="true">
              {line.text.slice(take)}
            </span>
          </div>
        );
      })}
      {done && (
        <div className="whitespace-pre-wrap break-words">
          <span className="mr-2 select-none text-terminal-live">$</span>
          <Cursor />
        </div>
      )}
    </>
  );
}

export function TerminalWindow({ title = "terminal", lines, typed = false, className }: TerminalWindowProps) {
  const reduceMotion = useReducedMotion();
  const animated = typed && !reduceMotion;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-terminal-border bg-terminal-background text-left shadow-[var(--elevation-shadow-strong)]",
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
        {animated ? <TypedRows lines={lines} /> : lines.map((line, index) => <StaticRow key={index} line={line} />)}
      </div>
    </div>
  );
}
