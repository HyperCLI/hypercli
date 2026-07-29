"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Moon, Sun } from "lucide-react";

import { cn } from "../utils/cn";
import { useTheme } from "./ThemeProvider";

export interface ThemeSelectorProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  menu?: boolean;
}

export function ThemeSelector({ className, menu = false, ...props }: ThemeSelectorProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      {...props}
      role="group"
      aria-label={props["aria-label"] ?? "Color theme"}
      className={cn("inline-flex items-center rounded-lg bg-background p-0.5", className)}
    >
      {([
        { value: "light", label: "Light", Icon: Sun },
        { value: "dark", label: "Dark", Icon: Moon },
      ] as const).map(({ value, label, Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            role={menu ? "menuitemradio" : undefined}
            aria-checked={menu ? selected : undefined}
            aria-pressed={menu ? undefined : selected}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              selected
                ? "border-border bg-surface-low text-foreground shadow-sm"
                : "border-transparent text-text-muted hover:bg-surface-low hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
