import type { AnimationVariant, BubblesVariant, ThemeVariant, HTMLMotionProps } from "./types";

/** Returns framer-motion props for the bubble entrance animation. */
export function getEntranceProps(variant: AnimationVariant, isUser: boolean): HTMLMotionProps<"div"> {
  if (variant === "v1") {
    return {
      initial: { opacity: 0, y: 10 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.22, ease: "easeOut" },
    };
  }
  if (variant === "v2") {
    return {
      initial: { opacity: 0, x: isUser ? 28 : -28 },
      animate: { opacity: 1, x: 0 },
      transition: { type: "spring", stiffness: 380, damping: 28 },
    };
  }
  if (variant === "v3") {
    return {
      initial: { opacity: 0, scale: 0.88, y: 6 },
      animate: { opacity: 1, scale: 1, y: 0 },
      transition: { type: "spring", stiffness: 460, damping: 22 },
    };
  }
  return {};
}

export function getToolCallClass(theme: ThemeVariant, hasResult: boolean, isRunning = false): string {
  const baseClass = "mb-1.5 w-full min-w-0 max-w-full overflow-hidden text-xs";
  const activeClass = "border-border bg-surface-low/40";
  const runningClass = "border-[rgb(var(--selection-accent-rgb)_/_0.32)] bg-surface-low/45";
  const neutralClass = "border-border bg-surface-low/35";
  const stateClass = hasResult ? activeClass : isRunning ? runningClass : neutralClass;

  if (theme === "v2") {
    const leftBorder = isRunning
      ? "border-l-[rgb(var(--selection-accent-rgb)_/_0.72)]"
      : hasResult
        ? "border-l-[rgb(var(--selection-accent-rgb)_/_0.45)]"
        : "border-l-border";
    return `${baseClass} rounded-lg border border-l-2 ${leftBorder} ${stateClass}`;
  }

  return `${baseClass} rounded-lg border ${stateClass}`;
}

export function getToolCallStatusClass(hasResult: boolean, isRunning = false): string {
  if (isRunning) {
    return "border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] text-[var(--selection-accent)]";
  }

  if (hasResult) {
    return "border-border bg-background/35 text-text-secondary";
  }

  return "border-border bg-background/35 text-text-muted";
}

/** Compute combined bubble classes from shape + color variants. */
export function getBubbleClasses(bubblesVariant: BubblesVariant, themeVariant: ThemeVariant, isUser: boolean): string {
  let shapeClass: string;
  if (bubblesVariant === "v1") {
    shapeClass = "min-w-0 max-w-full rounded-2xl px-4 py-3 text-sm";
  } else if (bubblesVariant === "v2") {
    shapeClass = "min-w-0 max-w-full rounded-3xl px-5 py-3 text-sm";
  } else if (bubblesVariant === "v3") {
    shapeClass = isUser ? "min-w-0 max-w-full rounded-2xl px-4 py-3 text-sm" : "w-full min-w-0 rounded-2xl px-4 py-3 text-sm";
  } else {
    shapeClass = "min-w-0 max-w-full rounded-lg px-4 py-2.5 text-sm";
  }

  let colorClass: string;
  if (themeVariant === "v1") {
    colorClass = isUser
      ? "bg-[#1e1c1a] border border-[#f0c56c]/25"
      : "border-l-2 border-[#38D39F]/40";
  } else if (themeVariant === "v2") {
    colorClass = isUser
      ? "bg-[#38D39F]/10 border border-[#38D39F]/25"
      : "bg-[#0d0d0f] border border-[#2a2a2c]";
  } else if (themeVariant === "v3") {
    colorClass = isUser
      ? "bg-[#f0c56c]/10 border border-[#f0c56c]/20"
      : "bg-[#141416] border-l-2 border-[#4285f4]/60";
  } else {
    if (bubblesVariant === "v1") colorClass = isUser ? "bg-[#303030]" : "";
    else if (bubblesVariant === "v2") colorClass = isUser ? "bg-[#2f2f2f]" : "";
    else if (bubblesVariant === "v3") colorClass = isUser ? "bg-surface-high border border-border" : "";
    else colorClass = isUser ? "bg-surface-high" : "bg-surface-low";
  }

  return [shapeClass, colorClass, "max-w-full text-foreground"].filter(Boolean).join(" ");
}
