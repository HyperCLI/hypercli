"use client";

import { useRef } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { TerminalWindow, type TerminalLine } from "@hypercli/shared-ui";

interface HomeTerminalDemoProps {
  title: string;
  lines: TerminalLine[];
  className?: string;
}

export function HomeTerminalDemo({ title, lines, className }: HomeTerminalDemoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const enteredView = useInView(containerRef, { once: true, amount: 0.3 });
  const reduceMotion = useReducedMotion();

  return (
    <div ref={containerRef} className="h-full">
      <TerminalWindow title={title} lines={lines} typed={enteredView && !reduceMotion} className={className} />
    </div>
  );
}
