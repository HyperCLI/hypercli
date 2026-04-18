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
  if (theme === "v1") {
    return hasResult
      ? "mb-2 text-xs bg-[#38D39F]/8 border border-[#38D39F]/25 rounded-md overflow-hidden"
      : "mb-2 text-xs bg-[#f0c56c]/8 border border-[#f0c56c]/25 rounded-md overflow-hidden";
  }
  if (theme === "v2") {
    return hasResult
      ? "mb-2 text-xs bg-[#38D39F]/8 border-l-4 border-[#38D39F] rounded-md overflow-hidden"
      : "mb-2 text-xs bg-[#f0c56c]/8 border-l-4 border-[#f0c56c] rounded-md overflow-hidden";
  }
  if (theme === "v3") {
    return hasResult
      ? "mb-2 text-xs bg-[#38D39F]/10 border border-[#38D39F]/30 rounded-md overflow-hidden"
      : "mb-2 text-xs bg-[#f0c56c]/10 border border-[#f0c56c]/30 rounded-md overflow-hidden";
  }
  return "mb-2 text-xs bg-background/50 border border-border rounded-md overflow-hidden";
}

/** Compute combined bubble classes from shape + color variants. */
export function getBubbleClasses(bubblesVariant: BubblesVariant, themeVariant: ThemeVariant, isUser: boolean): string {
  let shapeClass: string;
  if (bubblesVariant === "v1") {
    shapeClass = "max-w-[80%] rounded-2xl px-4 py-3 text-sm";
  } else if (bubblesVariant === "v2") {
    shapeClass = "max-w-[80%] rounded-3xl px-5 py-3 text-sm";
  } else if (bubblesVariant === "v3") {
    shapeClass = isUser ? "max-w-[80%] rounded-2xl px-4 py-3 text-sm" : "rounded-2xl px-4 py-3 text-sm w-full";
  } else {
    shapeClass = "max-w-[80%] rounded-lg px-4 py-2.5 text-sm";
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

  return [shapeClass, colorClass, "text-foreground"].filter(Boolean).join(" ");
}
