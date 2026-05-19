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

export function getToolCallClass(theme: ThemeVariant, hasResult: boolean): string {
  const baseClass = "mb-2 w-full min-w-0 max-w-full overflow-hidden text-xs";
  if (theme === "v1") {
    return hasResult
      ? `${baseClass} rounded-md border border-[#38D39F]/25 bg-[#38D39F]/8`
      : `${baseClass} rounded-md border border-[#f0c56c]/25 bg-[#f0c56c]/8`;
  }
  if (theme === "v2") {
    return hasResult
      ? `${baseClass} rounded-md border-l-4 border-[#38D39F] bg-[#38D39F]/8`
      : `${baseClass} rounded-md border-l-4 border-[#f0c56c] bg-[#f0c56c]/8`;
  }
  if (theme === "v3") {
    return hasResult
      ? `${baseClass} rounded-md border border-[#38D39F]/30 bg-[#38D39F]/10`
      : `${baseClass} rounded-md border border-[#f0c56c]/30 bg-[#f0c56c]/10`;
  }
  return `${baseClass} rounded-md border border-border bg-background/50`;
}

/** Compute combined bubble classes from shape + color variants. */
export function getBubbleClasses(bubblesVariant: BubblesVariant, themeVariant: ThemeVariant, isUser: boolean): string {
  let shapeClass: string;
  if (bubblesVariant === "v1") {
    shapeClass = "min-w-0 max-w-[80%] rounded-2xl px-4 py-3 text-sm";
  } else if (bubblesVariant === "v2") {
    shapeClass = "min-w-0 max-w-[80%] rounded-3xl px-5 py-3 text-sm";
  } else if (bubblesVariant === "v3") {
    shapeClass = isUser ? "min-w-0 max-w-[80%] rounded-2xl px-4 py-3 text-sm" : "w-full min-w-0 rounded-2xl px-4 py-3 text-sm";
  } else {
    shapeClass = "min-w-0 max-w-[80%] rounded-lg px-4 py-2.5 text-sm";
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
