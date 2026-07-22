"use client";

import { Button } from "@hypercli/shared-ui";
import {
  Blocks,
  CalendarClock,
  Check,
  Codepen,
  FileText,
  FolderOpen,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { HyperCLILogoMark } from "@/components/HyperCLILogoLink";
import { SlackIcon } from "@/components/dashboard/BrandIcons";
import type { AgentSlashCommandActions } from "@/components/dashboard/agents/AgentSlashCommandMenu";

type AgentEmptyHistoryActions = Pick<
  AgentSlashCommandActions,
  "onOpenFiles" | "onOpenIntegrations" | "onOpenIntegrationChatCard" | "onOpenSkills" | "onOpenScheduled"
>;

interface AgentEmptyHistoryProps {
  onPromptSelect: (prompt: string) => void;
  actions?: AgentEmptyHistoryActions;
}

interface StarterPrompt {
  id: string;
  label: string;
  description: string;
  prompt: string;
  icon: LucideIcon;
}

const STARTER_PROMPTS: StarterPrompt[] = [
  {
    id: "explain",
    label: "Map this workspace",
    description: "Get a plain-English tour of the files, structure, and moving parts.",
    prompt: "Explain the current workspace or selected file in plain language.",
    icon: FileText,
  },
  {
    id: "test",
    label: "Run the checks",
    description: "Use the project's own toolchain and report what passes or breaks.",
    prompt: "Run the relevant checks for this workspace and summarize the results.",
    icon: Check,
  },
  {
    id: "diff",
    label: "Read the diff",
    description: "Turn workspace changes into a clear review of risks and next steps.",
    prompt: "Review workspace changes and summarize the diff.",
    icon: Wrench,
  },
];

interface WorkspaceAction {
  id: string;
  label: string;
  description: string;
  ariaLabel: string;
  action: "onOpenFiles" | "onOpenIntegrations" | "onOpenSkills" | "onOpenScheduled";
  icon: LucideIcon;
}

const WORKSPACE_ACTIONS: WorkspaceAction[] = [
  {
    id: "files",
    label: "Bring in context",
    description: "Open workspace files, notes, and generated output.",
    ariaLabel: "Open Workspace files",
    action: "onOpenFiles",
    icon: FolderOpen,
  },
  {
    id: "integrations",
    label: "Connect your tools",
    description: "GitHub, Telegram, Discord, WhatsApp, and more.",
    ariaLabel: "Open Integrations",
    action: "onOpenIntegrations",
    icon: Blocks,
  },
  {
    id: "skills",
    label: "Teach it a skill",
    description: "Browse reusable skills or create one for this agent.",
    ariaLabel: "Open Skills",
    action: "onOpenSkills",
    icon: Codepen,
  },
  {
    id: "scheduled",
    label: "Put work on repeat",
    description: "Run a prompt automatically on a recurring schedule.",
    ariaLabel: "Open Scheduled work",
    action: "onOpenScheduled",
    icon: CalendarClock,
  },
];

export function AgentEmptyHistory({
  onPromptSelect,
  actions,
}: AgentEmptyHistoryProps) {
  const availableWorkspaceActions = WORKSPACE_ACTIONS.filter(({ action }) => Boolean(actions?.[action]));

  return (
    <section
      aria-labelledby="agent-empty-history-title"
      className="w-full max-w-[50rem] px-3 py-5 text-foreground sm:px-6 sm:py-8"
    >
      <header className="text-center">
        <div
          aria-hidden="true"
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] shadow-[0_16px_48px_rgb(var(--selection-accent-rgb)_/_0.08)]"
        >
          <HyperCLILogoMark className="h-7 w-7" />
        </div>
        <h2
          id="agent-empty-history-title"
          className="mt-4 text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl"
        >
          Your agent is ready for real work
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-text-muted">
          Inspect the workspace, run its checks, then connect Slack, GitHub, and the routines that keep work moving.
        </p>
      </header>

      {actions?.onOpenIntegrationChatCard || availableWorkspaceActions.length > 0 ? (
        <div className="mt-7">
          <div className="mb-3 text-center">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
              Build out the workspace
            </h3>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              Bring in context, connect your stack, and automate repeat work.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            {actions?.onOpenIntegrationChatCard ? (
              <Button
                type="button"
                variant="ghost"
                aria-label="Connect Slack"
                onClick={() => actions.onOpenIntegrationChatCard?.("slack")}
                className="group col-span-2 h-auto min-h-[8.75rem] w-full flex-col justify-start gap-2.5 whitespace-normal rounded-xl px-4 py-3 text-center text-text-secondary hover:-translate-y-0.5 hover:bg-surface-low/55 hover:text-foreground dark:hover:bg-surface-low/55"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--selection-accent-rgb)_/_0.1)] shadow-[0_6px_18px_rgb(var(--selection-accent-rgb)_/_0.06)] transition-all group-hover:scale-105 group-hover:bg-[rgb(var(--selection-accent-rgb)_/_0.14)]">
                  <SlackIcon aria-hidden="true" className="size-5" />
                </span>
                <span className="flex max-w-[15rem] flex-col items-center gap-1">
                  <span className="text-[13px] font-semibold leading-4 text-foreground">Connect Slack</span>
                  <span className="text-[10px] font-normal leading-4 text-text-muted">Guided setup for channels, conversations, and direct messages.</span>
                </span>
              </Button>
            ) : null}
            {availableWorkspaceActions.map((workspaceAction) => {
              const Icon = workspaceAction.icon;
              const onSelect = actions?.[workspaceAction.action];
              return (
                <Button
                  key={workspaceAction.id}
                  type="button"
                  variant="ghost"
                  aria-label={workspaceAction.ariaLabel}
                  onClick={() => onSelect?.()}
                  className="group h-auto min-h-[8.75rem] w-full flex-col justify-start gap-2.5 whitespace-normal rounded-xl px-3 py-3 text-center text-text-secondary hover:-translate-y-0.5 hover:bg-surface-low/55 hover:text-foreground dark:hover:bg-surface-low/55"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-surface-low text-text-muted transition-colors group-hover:text-[var(--selection-accent)]">
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                  </span>
                  <span className="flex max-w-[12rem] flex-col items-center gap-1">
                    <span className="text-xs font-semibold leading-4 text-foreground">{workspaceAction.label}</span>
                    <span className="text-[10px] font-normal leading-4 text-text-muted">{workspaceAction.description}</span>
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-7">
        <div className="mb-3 text-center">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
            Start with something concrete
          </h3>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            Pick a prompt, add any missing context, then send it when you are ready.
          </p>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {STARTER_PROMPTS.map((prompt) => {
            const Icon = prompt.icon;
            return (
              <Button
                key={prompt.id}
                type="button"
                variant="ghost"
                onClick={() => onPromptSelect(prompt.prompt)}
                className="group h-auto min-h-[9rem] w-full flex-col gap-3 whitespace-normal rounded-xl px-4 py-4 text-center text-foreground hover:-translate-y-0.5 hover:bg-surface-low/55 hover:text-foreground dark:hover:bg-surface-low/55"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--selection-accent-rgb)_/_0.08)] text-[var(--selection-accent)] transition-colors group-hover:bg-[rgb(var(--selection-accent-rgb)_/_0.14)]">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="flex max-w-[12rem] flex-col items-center gap-1">
                  <span className="text-sm font-semibold leading-5">{prompt.label}</span>
                  <span className="text-[11px] font-normal leading-[1.1rem] text-text-muted">{prompt.description}</span>
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
