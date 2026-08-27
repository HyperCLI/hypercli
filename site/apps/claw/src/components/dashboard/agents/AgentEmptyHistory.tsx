"use client";

import { Button } from "@hypercli/shared-ui";
import {
  Fingerprint,
  MessagesSquare,
  Plug,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import type { AgentSlashCommandActions } from "@/components/dashboard/agents/AgentSlashCommandMenu";
import { TooltipHint } from "@/components/ClawTooltip";
import { INTEGRATION_BRAND_LOGOS } from "@/components/dashboard/integrations/integration-brand-icons";

type AgentEmptyHistoryActions = Pick<
  AgentSlashCommandActions,
  "onOpenFiles" | "onOpenIntegrations" | "onOpenIntegrationChatCard" | "onOpenSkills" | "onOpenScheduled"
>;

interface AgentEmptyHistoryProps {
  userName?: string | null;
  salutationSeed?: string | null;
  actions?: AgentEmptyHistoryActions;
}

interface CapabilityAction {
  label: string;
  ariaLabel: string;
  onClick: () => void;
}

interface Capability {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  actions: CapabilityAction[];
  showIntegrationIcons?: boolean;
}

export const FEATURED_AGENT_INTEGRATIONS = [
  { id: "github", label: "GitHub" },
  { id: "discord", label: "Discord" },
  { id: "telegram", label: "Telegram" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "slack", label: "Slack" },
] as const;

export const RETURNING_AGENT_SALUTATIONS = [
  "What are we working on today",
  "What should we tackle today",
  "What's on the agenda today",
  "Where should we start",
  "What would you like to make progress on",
  "What's the priority today",
  "What are we solving today",
  "What should we get done today",
  "What would make today productive",
  "What can we move forward today",
] as const;

export function returningAgentSalutation(
  seed: string | null | undefined,
  userName: string | null | undefined,
): string {
  const normalizedSeed = seed?.trim() ?? "";
  let hash = 0;
  for (let index = 0; index < normalizedSeed.length; index += 1) {
    hash = (Math.imul(hash, 31) + normalizedSeed.charCodeAt(index)) >>> 0;
  }
  const salutation = RETURNING_AGENT_SALUTATIONS[
    normalizedSeed ? hash % RETURNING_AGENT_SALUTATIONS.length : 0
  ];
  const firstName = userName?.trim().split(/\s+/)[0] || null;
  return `${salutation}${firstName ? `, ${firstName}` : ""}?`;
}

export function AgentEmptyHistory({
  userName,
  salutationSeed,
  actions,
}: AgentEmptyHistoryProps) {
  const heading = returningAgentSalutation(salutationSeed, userName);
  const capabilities: Capability[] = [
    {
      id: "personalize",
      title: "Make It Yours",
      description: "Teach your agent your knowledge, workflows, and way of working.",
      icon: Fingerprint,
      actions: [
        ...(actions?.onOpenFiles ? [{
          label: "Add context",
          ariaLabel: "Open Workspace files",
          onClick: () => actions.onOpenFiles?.(),
        }] : []),
        ...(actions?.onOpenSkills ? [{
          label: "Browse skills",
          ariaLabel: "Open Skills",
          onClick: () => actions.onOpenSkills?.(),
        }] : []),
        ...(actions?.onOpenScheduled ? [{
          label: "Schedule work",
          ariaLabel: "Open Scheduled work",
          onClick: () => actions.onOpenScheduled?.(),
        }] : []),
      ],
    },
    {
      id: "tools",
      title: "Uses Your Tools",
      description: "Securely connect to your apps, APIs, and accounts so your agent can work across the software you already use.",
      icon: Plug,
      actions: actions?.onOpenIntegrations ? [{
        label: "Connect Any Tool",
        ariaLabel: "Connect Any Tool",
        onClick: () => actions.onOpenIntegrations?.(),
      }] : [],
    },
    {
      id: "team",
      title: "Empower Your Team",
      description: "Share your agent across the organization so everyone has access to the same knowledge, skills, and capabilities.",
      icon: UsersRound,
      actions: [],
    },
    {
      id: "channels",
      title: "Works Where You Work",
      description: "Available in the tools your team already uses.",
      icon: MessagesSquare,
      showIntegrationIcons: true,
      actions: [],
    },
  ];

  return (
    <section
      aria-labelledby="agent-empty-history-title"
      data-testid="agent-empty-history"
      className="agent-empty-history w-full max-w-[44rem] px-3 py-4 text-foreground sm:px-5"
    >
      <header className="text-center">
        <h2
          id="agent-empty-history-title"
          data-testid="agent-empty-history-title"
          className="agent-empty-history-title text-balance text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.035em] text-foreground"
        >
          {heading}
        </h2>
      </header>

      <div className="agent-empty-history-capabilities mt-6 divide-y divide-border border-y border-border">
        {capabilities.map((capability) => {
          const Icon = capability.icon;
          return (
            <div
              key={capability.id}
              className="agent-empty-history-capability-row grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-3.5"
            >
              <span className="agent-empty-history-capability-icon flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-low text-text-muted">
                <Icon aria-hidden="true" className="size-[1.125rem]" />
              </span>
              <div className="min-w-0 self-center">
                <h3 className="text-sm font-semibold leading-5 text-foreground">{capability.title}</h3>
                <p className="mt-0.5 text-xs leading-[1.15rem] text-text-secondary">{capability.description}</p>
              </div>
              {capability.actions.length > 0 || (capability.showIntegrationIcons && actions?.onOpenIntegrationChatCard) ? (
                <div className="agent-empty-history-capability-actions col-start-2 flex flex-wrap items-center gap-1.5">
                  {capability.showIntegrationIcons && actions?.onOpenIntegrationChatCard ? (
                    <ul aria-label="Featured integrations" className="mr-1 flex -space-x-1">
                      {FEATURED_AGENT_INTEGRATIONS.map(({ id, label }) => {
                        const integration = INTEGRATION_BRAND_LOGOS[id];
                        const IntegrationIcon = integration.icon;
                        return (
                          <li key={id} className="relative size-7">
                            <TooltipHint label={`Open ${label} setup`}>
                              <button
                                type="button"
                                aria-label={`Open ${label} setup`}
                                onClick={() => actions.onOpenIntegrationChatCard?.(id)}
                                className="relative flex size-7 items-center justify-center rounded-full border border-background bg-surface-high shadow-[0_2px_8px_rgb(0_0_0_/_0.16)] transition-[background-color,transform] hover:z-10 hover:-translate-y-0.5 hover:bg-secondary focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.55)] motion-reduce:hover:translate-y-0"
                              >
                                <IntegrationIcon className="size-3.5" style={{ color: integration.color }} />
                              </button>
                            </TooltipHint>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {capability.actions.map((action) => (
                    <Button
                      key={action.ariaLabel}
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={action.ariaLabel}
                      onClick={action.onClick}
                      className="agent-empty-history-secondary-action h-9 rounded-lg border border-border bg-transparent px-2.5 text-[11px] font-medium text-text-secondary shadow-none hover:border-[var(--selection-accent-border)] hover:bg-[var(--selection-accent-soft)] hover:text-foreground"
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
