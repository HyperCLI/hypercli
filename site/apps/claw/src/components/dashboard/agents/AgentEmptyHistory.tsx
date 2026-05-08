"use client";

import React from "react";
import { CalendarDays, Mail, Search, type LucideIcon } from "lucide-react";

interface AgentEmptyHistoryProps {
  onPromptSelect: (prompt: string) => void;
}

interface StarterPrompt {
  id: string;
  label: string;
  icon: LucideIcon;
}

const STARTER_PROMPTS: StarterPrompt[] = [
  {
    id: "email",
    label: "Summarize unread emails from this morning",
    icon: Mail,
  },
  {
    id: "changelog",
    label: "Find the latest Next.js 16 changelog",
    icon: Search,
  },
  {
    id: "meetings",
    label: "Help me prep for my meetings tomorrow",
    icon: CalendarDays,
  },
];

export function AgentEmptyHistory({
  onPromptSelect,
}: AgentEmptyHistoryProps) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-8 text-foreground sm:px-6">
      <div className="w-full max-w-[42rem]">
        <h2 className="mb-4 text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
          Try these
        </h2>
        <div className="flex flex-col gap-2.5">
          {STARTER_PROMPTS.map((prompt) => {
            const Icon = prompt.icon;
            return (
              <button
                key={prompt.id}
                type="button"
                onClick={() => onPromptSelect(prompt.label)}
                className="group flex min-h-[3.25rem] w-full items-center gap-3 rounded-lg border border-border bg-[#2f2f2f]/55 px-3.5 py-2.5 text-left text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-high hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38D39F]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-text-muted transition-colors group-hover:border-[#38D39F]/30 group-hover:text-[#38D39F]">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 leading-5">{prompt.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
