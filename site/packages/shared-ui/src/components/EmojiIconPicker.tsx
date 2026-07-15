"use client";

import * as React from "react";

import { cn } from "../utils/cn";

export interface EmojiIconOption {
  value: string;
  label: string;
}

export const SKILL_EMOJI_ICON_OPTIONS: EmojiIconOption[] = [
  { value: "\u{1F527}", label: "Wrench" },
  { value: "\u2699\uFE0F", label: "Gear" },
  { value: "\u{1F4CA}", label: "Chart" },
  { value: "\u{1F4AC}", label: "Chat" },
  { value: "\u{1F419}", label: "Octopus" },
  { value: "\u2614", label: "Umbrella" },
  { value: "\u{1F9ED}", label: "Compass" },
  { value: "\u{1F50D}", label: "Search" },
  { value: "\u{1F4C1}", label: "Folder" },
  { value: "\u{1F3A8}", label: "Palette" },
  { value: "\u26A1", label: "Lightning" },
  { value: "\u{1F6E0}\uFE0F", label: "Tools" },
  { value: "\u{1F4CB}", label: "Clipboard" },
  { value: "\u{1F916}", label: "Robot" },
];

export const KNOWLEDGE_EMOJI_ICON_OPTIONS: EmojiIconOption[] = [
  { value: "\u{1F4DA}", label: "Books" },
  { value: "\u{1F4D8}", label: "Manual" },
  { value: "\u{1F5C2}\uFE0F", label: "Folder index" },
  { value: "\u{1F4C1}", label: "Folder" },
  { value: "\u{1F4CB}", label: "Clipboard" },
  { value: "\u{1F4DD}", label: "Memo" },
  { value: "\u{1F50D}", label: "Search" },
  { value: "\u{1F9ED}", label: "Compass" },
  { value: "\u{1F3A8}", label: "Palette" },
  { value: "\u{1F517}", label: "Link" },
  { value: "\u{1F512}", label: "Lock" },
  { value: "\u2699\uFE0F", label: "Gear" },
  { value: "\u2728", label: "Sparkles" },
  { value: "\u{1F916}", label: "Robot" },
];

export const DEFAULT_EMOJI_ICON_OPTIONS: EmojiIconOption[] = [
  ...KNOWLEDGE_EMOJI_ICON_OPTIONS,
  ...SKILL_EMOJI_ICON_OPTIONS.filter((option) => !KNOWLEDGE_EMOJI_ICON_OPTIONS.some((item) => item.value === option.value)),
];

export interface EmojiIconPickerProps {
  selectedIcon: string;
  onSelectIcon: (icon: string) => void;
  options?: EmojiIconOption[];
  ariaLabel?: string;
  className?: string;
  buttonClassName?: string;
}

export function EmojiIconPicker({
  selectedIcon,
  onSelectIcon,
  options = DEFAULT_EMOJI_ICON_OPTIONS,
  ariaLabel = "Icon",
  className,
  buttonClassName,
}: EmojiIconPickerProps) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = selectedIcon === option.value;
        return (
          <button
            key={`${option.label}-${option.value}`}
            type="button"
            aria-label={`Use icon ${option.label}`}
            aria-pressed={active}
            title={option.label}
            onClick={() => onSelectIcon(option.value)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg border text-[15px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "border-selection-accent/60 bg-selection-accent/15 text-foreground shadow-[0_0_0_1px_color-mix(in_srgb,var(--selection-accent)_20%,transparent)]"
                : "border-transparent text-foreground hover:border-border hover:bg-surface-low",
              buttonClassName,
            )}
          >
            <span aria-hidden="true">{option.value}</span>
          </button>
        );
      })}
    </div>
  );
}
