import type { AnimationVariant, BubblesVariant, ThemeVariant, HTMLMotionProps } from "./types";
import type { ToolCallViewStatus } from "./helpers";

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

export function getToolCallClass(theme: ThemeVariant, status: ToolCallViewStatus): string {
  const baseClass = "mb-1.5 w-full min-w-0 max-w-full overflow-hidden text-xs";
  const doneClass = "border-border bg-surface-low/35";
  const failedClass = "border-destructive/35 bg-destructive/8";
  const runningClass = "border-success/35 bg-success/8";
  const neutralClass = "border-border bg-surface-low/35";
  const stateClass = status === "failed" ? failedClass : status === "done" ? doneClass : status === "running" ? runningClass : neutralClass;

  if (theme === "v2") {
    const leftBorder = status === "failed"
      ? "border-l-destructive/70"
      : status === "running"
      ? "border-l-success/70"
      : status === "done"
        ? "border-l-border"
        : "border-l-border";
    return `${baseClass} rounded-lg border border-l-2 ${leftBorder} ${stateClass}`;
  }

  return `${baseClass} rounded-lg border ${stateClass}`;
}

export function getToolCallStatusClass(status: ToolCallViewStatus): string {
  if (status === "running") {
    return "border-success/35 bg-success/10 text-success";
  }

  if (status === "failed") {
    return "border-destructive/35 bg-destructive/8 text-destructive";
  }

  if (status === "done") {
    return "border-border/70 bg-background/25 text-text-secondary";
  }

  return "border-border/60 bg-background/20 text-text-muted";
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
      ? "bg-surface-high border border-warning/25"
      : "border-l-2 border-primary/40";
  } else if (themeVariant === "v2") {
    colorClass = isUser
      ? "bg-primary/10 border border-primary/25"
      : "bg-surface-low border border-border";
  } else if (themeVariant === "v3") {
    colorClass = isUser
      ? "bg-warning/10 border border-warning/20"
      : "bg-surface-low border-l-2 border-[#4285f4]/60";
  } else {
    if (bubblesVariant === "v1") colorClass = isUser ? "bg-surface-high" : "";
    else if (bubblesVariant === "v2") colorClass = isUser ? "bg-surface-high" : "";
    else if (bubblesVariant === "v3") colorClass = isUser ? "bg-surface-high border border-border" : "";
    else colorClass = isUser ? "bg-surface-high" : "bg-surface-low";
  }

  return [shapeClass, colorClass, "max-w-full text-foreground"].filter(Boolean).join(" ");
}
