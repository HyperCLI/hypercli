"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { Check, Leaf, Palette, Sparkles } from "lucide-react";

import { useClawTheme } from "@/hooks/useClawTheme";
import type { ClawTheme } from "@/lib/claw-theme";

interface ThemeOption {
  label: string;
  theme: ClawTheme;
  icon: ComponentType<{ className?: string }>;
  swatchClassName: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    label: "Default",
    theme: "default",
    icon: Palette,
    swatchClassName: "from-[#101012] via-[#1c1c1f] to-[#38d39f]",
  },
  {
    label: "Green",
    theme: "green",
    icon: Leaf,
    swatchClassName: "from-[#101012] via-[#1c1c1f] to-[#63E452]",
  },
  {
    label: "Purple",
    theme: "purple",
    icon: Sparkles,
    swatchClassName: "from-[#101012] via-[#1c1c1f] to-[#4A20FF]",
  },
];

interface ClawThemePickerProps {
  className?: string;
  menuAlign?: "start" | "end";
  menuClassName?: string;
  size?: "sm" | "md";
}

export function ClawThemePicker({
  className = "",
  menuAlign = "end",
  menuClassName = "",
  size = "md",
}: ClawThemePickerProps) {
  const { theme, setTheme } = useClawTheme();
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const selectedOption = THEME_OPTIONS.find((option) => option.theme === theme) ?? THEME_OPTIONS[0];
  const TriggerIcon = selectedOption.icon;
  const triggerSizeClassName = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const triggerIconClassName = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const menuAlignClassName = menuAlign === "start" ? "left-0" : "right-0";

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={pickerRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        aria-label={`Theme: ${selectedOption.label}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className={`${triggerSizeClassName} inline-flex items-center justify-center rounded-xl border transition-colors ${
          open
            ? "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]"
            : "border-border bg-surface-low/70 text-text-secondary hover:border-border-medium hover:bg-surface-high hover:text-foreground"
        }`}
      >
        <TriggerIcon className={triggerIconClassName} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Theme"
          className={`absolute ${menuAlignClassName} top-[calc(100%+0.5rem)] z-[90] w-48 rounded-xl border border-border bg-popover p-1 shadow-[0_18px_60px_rgba(0,0,0,0.38)] ${menuClassName}`}
        >
          {THEME_OPTIONS.map((option) => {
            const active = option.theme === theme;
            const Icon = option.icon;

            return (
              <button
                key={option.theme}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(option.theme);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                  active
                    ? "bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]"
                    : "text-text-secondary hover:bg-surface-low hover:text-foreground"
                }`}
              >
                <span className={`h-5 w-5 shrink-0 rounded-full bg-gradient-to-br ${option.swatchClassName} ring-1 ring-white/10`} />
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                {active && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
