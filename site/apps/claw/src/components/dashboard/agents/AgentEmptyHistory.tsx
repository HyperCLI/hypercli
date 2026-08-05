"use client";

import { Button } from "@hypercli/shared-ui";
import {
  Fingerprint,
  HeartHandshake,
  MessageCircle,
  MessagesSquare,
  Plug,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import type { AgentSlashCommandActions } from "@/components/dashboard/agents/AgentSlashCommandMenu";

type AgentEmptyHistoryActions = Pick<
  AgentSlashCommandActions,
  "onOpenFiles" | "onOpenIntegrations" | "onOpenIntegrationChatCard" | "onOpenSkills" | "onOpenScheduled"
>;

interface AgentEmptyHistoryProps {
  onSayHello: () => void | Promise<void>;
  hasPriorInteraction?: boolean;
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
}

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
  onSayHello,
  hasPriorInteraction = false,
  userName,
  salutationSeed,
  actions,
}: AgentEmptyHistoryProps) {
  const heading = hasPriorInteraction
    ? returningAgentSalutation(salutationSeed, userName)
    : "Meet your new AI teammate.";
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
        label: "Browse integrations",
        ariaLabel: "Open Integrations",
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
      actions: actions?.onOpenIntegrationChatCard ? [{
        label: "Connect Slack",
        ariaLabel: "Connect Slack",
        onClick: () => actions.onOpenIntegrationChatCard?.("slack"),
      }] : [],
    },
  ];

  return (
    <section
      aria-labelledby="agent-empty-history-title"
      className="agent-empty-history w-full max-w-[44rem] px-3 py-4 text-foreground sm:px-5"
    >
      <header className="text-center">
        <div
          aria-hidden="true"
          className="agent-empty-history-logo mx-auto flex size-14 items-center justify-center rounded-[1.125rem] border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)] shadow-[0_12px_36px_rgb(var(--selection-accent-rgb)_/_0.1)]"
        >
          <HeartHandshake className="size-7" />
        </div>
        <h2
          id="agent-empty-history-title"
          className="agent-empty-history-title mt-4 text-balance text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.035em] text-foreground"
        >
          {heading}
        </h2>
        {!hasPriorInteraction ? (
          <>
            <p className="agent-empty-history-intro mx-auto mt-2 max-w-[38rem] text-sm leading-6 text-text-secondary">
              Let&apos;s spend a few minutes getting to know each other so I can learn how you work and become a valuable member of your team.
            </p>
            <Button
              type="button"
              size="lg"
              onClick={() => { void onSayHello(); }}
              className="agent-empty-history-cta mt-5 h-11 rounded-xl px-5 text-sm font-semibold shadow-[0_12px_28px_rgb(var(--button-primary-rgb)_/_0.22)] hover:-translate-y-0.5 focus-visible:ring-[rgb(var(--button-primary-rgb)_/_0.5)] motion-reduce:transform-none"
            >
              <MessageCircle aria-hidden="true" className="size-4" />
              Say hello
            </Button>
          </>
        ) : null}
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
              {capability.actions.length > 0 ? (
                <div className="agent-empty-history-capability-actions col-start-2 flex flex-wrap items-center gap-1.5">
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
