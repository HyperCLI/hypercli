"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Moon, Sun } from "lucide-react";

import { cn } from "../utils/cn";
import { composeTheme, type ThemeMode } from "../utils/theme";
import { useTheme } from "./ThemeProvider";

export interface ThemeSelectorProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  menu?: boolean;
}

const MODE_OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const satisfies readonly { value: ThemeMode; label: string; Icon: typeof Sun }[];

const optionClassName =
  "inline-flex min-h-8 min-w-0 items-center justify-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium leading-none transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export function ThemeSelector({ className, menu = false, ...props }: ThemeSelectorProps) {
  const { mode, setTheme } = useTheme();
  const selectionProps = (selected: boolean) => ({
    role: menu ? "menuitemradio" as const : undefined,
    "aria-checked": menu ? selected : undefined,
    "aria-pressed": menu ? undefined : selected,
  });

  return (
    <div
      {...props}
      role="group"
      aria-label={props["aria-label"] ?? "Color theme"}
      className={cn(
        "inline-grid min-w-40 grid-cols-2 gap-1 rounded-xl border border-border bg-surface-low/70 p-1 shadow-sm",
        className,
      )}
    >
      {MODE_OPTIONS.map(({ value, label, Icon }) => {
        const selected = mode === value;
        return (
          <button
            key={value}
            type="button"
            title={`${label} mode`}
            aria-label={label}
            {...selectionProps(selected)}
            onClick={() => setTheme(composeTheme("aurora", value))}
            className={cn(
              optionClassName,
              selected
                ? "border-border-medium bg-background text-foreground shadow-sm"
                : "border-transparent text-text-muted hover:border-border hover:bg-background/65 hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
