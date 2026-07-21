"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Moon, Sun } from "lucide-react";

import { cn } from "../utils/cn";
import { useTheme } from "./ThemeProvider";

export type ThemeSelectorProps = Omit<ComponentPropsWithoutRef<"div">, "children">;

export function ThemeSelector({ className, ...props }: ThemeSelectorProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      {...props}
      role="group"
      aria-label={props["aria-label"] ?? "Color theme"}
      className={cn("inline-flex rounded-xl border border-border bg-background p-1", className)}
    >
      {([
        { value: "dark", label: "Dark", Icon: Moon },
        { value: "light", label: "Light", Icon: Sun },
      ] as const).map(({ value, label, Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-surface-high text-foreground shadow-sm"
                : "text-text-muted hover:bg-surface-low hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
