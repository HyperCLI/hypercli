"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Moon, Sun } from "lucide-react";

import { cn } from "../utils/cn";
import { useTheme } from "./ThemeProvider";

export interface ThemeToggleProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
  showLabel?: boolean;
}

export function ThemeToggle({ showLabel = false, className, onClick, type = "button", ...props }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const target = theme === "light" ? "dark" : "light";
  const label = `Switch to ${target} mode`;
  const Icon = target === "light" ? Sun : Moon;

  return (
    <button
      {...props}
      type={type}
      aria-label={props["aria-label"] ?? label}
      title={props.title ?? label}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) toggleTheme();
      }}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        showLabel ? "min-w-0" : "w-9 px-0",
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      {showLabel ? <span className="truncate">{label}</span> : null}
    </button>
  );
}
