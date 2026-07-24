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
    description: "Get a plain-English tour of the files and structure.",
    prompt: "Explain the current workspace or selected file in plain language.",
    icon: FileText,
  },
  {
    id: "test",
    label: "Run the checks",
    description: "Use the project toolchain and report what breaks.",
    prompt: "Run the relevant checks for this workspace and summarize the results.",
    icon: Check,
  },
  {
    id: "diff",
    label: "Read the diff",
    description: "Review workspace changes, risks, and next steps.",
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
    description: "Open files, notes, and generated output.",
    ariaLabel: "Open Workspace files",
    action: "onOpenFiles",
    icon: FolderOpen,
  },
  {
    id: "integrations",
    label: "Browse integrations",
    description: "Add GitHub, Telegram, Discord, WhatsApp, and more.",
    ariaLabel: "Open Integrations",
    action: "onOpenIntegrations",
    icon: Blocks,
  },
  {
    id: "skills",
    label: "Teach it a skill",
    description: "Browse reusable skills or create one.",
    ariaLabel: "Open Skills",
    action: "onOpenSkills",
    icon: Codepen,
  },
  {
    id: "scheduled",
    label: "Put work on repeat",
    description: "Run prompts automatically on a schedule.",
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
      className="agent-empty-history w-full max-w-[50rem] px-3 py-5 text-foreground sm:px-6 sm:py-8"
    >
      <header className="text-center">
        <div
          aria-hidden="true"
          className="agent-empty-history-logo mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] shadow-[0_16px_48px_rgb(var(--selection-accent-rgb)_/_0.08)]"
        >
          <HyperCLILogoMark className="h-7 w-7" />
        </div>
        <h2
          id="agent-empty-history-title"
          className="agent-empty-history-title mt-4 text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl"
        >
          Your agent is ready for real work
        </h2>
        <p className="agent-empty-history-intro mx-auto mt-2 max-w-xl text-sm leading-6 text-text-muted">
          Connect the tools your agent needs, add workspace context, then give it a concrete first task.
        </p>
      </header>

      {actions?.onOpenIntegrationChatCard || availableWorkspaceActions.length > 0 ? (
        <div className="agent-empty-history-group mt-7">
          <div className="agent-empty-history-group-header mb-3 text-center">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
              Build out the workspace
            </h3>
            <p className="agent-empty-history-section-copy mt-1 text-xs leading-5 text-text-muted">
              Connect Slack, add context, and automate repeat work.
            </p>
          </div>
          <div className="agent-empty-history-workspace-grid grid grid-cols-2 gap-2 md:grid-cols-6">
            {actions?.onOpenIntegrationChatCard ? (
              <Button
                type="button"
                variant="ghost"
                aria-label="Connect Slack"
                onClick={() => actions.onOpenIntegrationChatCard?.("slack")}
                className="agent-empty-history-workspace-card group col-span-2 h-auto min-h-24 w-full flex-col justify-start gap-1.5 whitespace-normal rounded-xl px-4 py-2 text-center text-text-secondary hover:-translate-y-0.5 hover:bg-surface-low/55 hover:text-foreground focus-visible:bg-surface-low/55 motion-reduce:transform-none md:min-h-[8.75rem] md:gap-2.5 md:py-3 dark:hover:bg-surface-low/55"
              >
                <span className="agent-empty-history-workspace-icon flex size-10 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--selection-accent-rgb)_/_0.1)] shadow-[0_6px_18px_rgb(var(--selection-accent-rgb)_/_0.06)] transition-all group-hover:scale-105 group-hover:bg-[rgb(var(--selection-accent-rgb)_/_0.14)] motion-reduce:transform-none md:size-12">
                  <SlackIcon aria-hidden="true" className="size-5" />
                </span>
                <span className="flex max-w-[15rem] flex-col items-center gap-1">
                  <span className="text-[13px] font-semibold leading-4 text-foreground">Connect Slack</span>
                  <span className="agent-empty-history-card-description text-[11px] font-normal leading-[1.1rem] text-text-muted">Set up channels, conversations, and direct messages.</span>
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
                  className="agent-empty-history-workspace-card group h-auto min-h-24 w-full flex-col justify-start gap-1.5 whitespace-normal rounded-xl px-3 py-2 text-center text-text-secondary hover:-translate-y-0.5 hover:bg-surface-low/55 hover:text-foreground focus-visible:bg-surface-low/55 motion-reduce:transform-none md:min-h-[8.75rem] md:gap-2.5 md:py-3 dark:hover:bg-surface-low/55"
                >
                  <span className="agent-empty-history-workspace-icon flex size-10 shrink-0 items-center justify-center md:size-12">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-surface-low text-text-muted transition-colors group-hover:text-[var(--selection-accent)] md:size-9">
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                  </span>
                  <span className="flex max-w-[12rem] flex-col items-center gap-1">
                    <span className="text-[13px] font-semibold leading-4 text-foreground">{workspaceAction.label}</span>
                    <span className="agent-empty-history-card-description text-[11px] font-normal leading-[1.1rem] text-text-muted">{workspaceAction.description}</span>
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="agent-empty-history-group mt-6 sm:mt-7">
        <div className="agent-empty-history-group-header mb-3 text-center">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
            Start with something concrete
          </h3>
          <p className="agent-empty-history-section-copy mt-1 text-xs leading-5 text-text-muted">
            Pick a prompt, add any missing context, then send it when you are ready.
          </p>
        </div>
        <div className="agent-empty-history-starter-grid grid gap-1.5 sm:grid-cols-3 sm:gap-2.5">
          {STARTER_PROMPTS.map((prompt) => {
            const Icon = prompt.icon;
            return (
              <Button
                key={prompt.id}
                type="button"
                variant="ghost"
                onClick={() => onPromptSelect(prompt.prompt)}
                className="agent-empty-history-starter-card group h-auto min-h-[4.5rem] w-full flex-row justify-start gap-3 whitespace-normal rounded-xl px-3 py-2 text-left text-foreground hover:-translate-y-0.5 hover:bg-surface-low/55 hover:text-foreground focus-visible:bg-surface-low/55 motion-reduce:transform-none sm:min-h-[9rem] sm:flex-col sm:justify-center sm:px-4 sm:py-4 sm:text-center dark:hover:bg-surface-low/55"
              >
                <span className="agent-empty-history-starter-icon flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-low text-text-muted transition-colors group-hover:text-[var(--selection-accent)] sm:size-10 sm:rounded-xl">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="flex max-w-[18rem] flex-col items-start gap-0.5 sm:max-w-[12rem] sm:items-center sm:gap-1">
                  <span className="text-[13px] font-semibold leading-4 sm:text-sm sm:leading-5">{prompt.label}</span>
                  <span className="agent-empty-history-card-description text-[11px] font-normal leading-[1.1rem] text-text-muted sm:text-center">{prompt.description}</span>
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
