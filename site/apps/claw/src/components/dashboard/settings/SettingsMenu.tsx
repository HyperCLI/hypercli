"use client";

import Link from "next/link";
import {
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  DatabaseZap,
  Globe2,
  KeyRound,
  MessageSquareText,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Button, cn } from "@hypercli/shared-ui";

export type SettingsSectionId =
  | "profile"
  | "preferences"
  | "agent"
  | "workspace"
  | "members"
  | "api-keys"
  | "billing"
  | "plans"
  | "memory-index";

const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  profile: "Profile",
  preferences: "Preferences",
  agent: "Agent",
  workspace: "Workspace",
  members: "Members",
  "api-keys": "API Keys",
  billing: "Billing",
  plans: "Plans",
  "memory-index": "Memory index",
};

const SETTINGS_SECTION_IDS = new Set<SettingsSectionId>([
  "profile",
  "preferences",
  "agent",
  "workspace",
  "members",
  "api-keys",
  "billing",
  "plans",
  "memory-index",
]);

export function resolveSettingsSectionId(value: string | null | undefined): SettingsSectionId | null {
  const normalized = value?.trim() as SettingsSectionId | undefined;
  return normalized && SETTINGS_SECTION_IDS.has(normalized) ? normalized : null;
}

interface SettingsMenuItem {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
}

const SETTINGS_GROUPS: Array<{ label: string; items: SettingsMenuItem[] }> = [
  {
    label: "Personal",
    items: [
      { id: "profile", label: SETTINGS_SECTION_LABELS.profile, icon: UserRound },
      { id: "preferences", label: SETTINGS_SECTION_LABELS.preferences, icon: SlidersHorizontal },
      { id: "agent", label: SETTINGS_SECTION_LABELS.agent, icon: Globe2 },
    ],
  },
  {
    label: "Administration",
    items: [
      { id: "workspace", label: SETTINGS_SECTION_LABELS.workspace, icon: BriefcaseBusiness },
      { id: "members", label: SETTINGS_SECTION_LABELS.members, icon: UsersRound },
      { id: "api-keys", label: SETTINGS_SECTION_LABELS["api-keys"], icon: KeyRound },
      { id: "billing", label: SETTINGS_SECTION_LABELS.billing, icon: CreditCard },
      { id: "plans", label: SETTINGS_SECTION_LABELS.plans, icon: CircleDollarSign },
      { id: "memory-index", label: SETTINGS_SECTION_LABELS["memory-index"], icon: DatabaseZap },
    ],
  },
];

interface SettingsMenuProps {
  activeSection: SettingsSectionId;
  backHref: string;
  onSectionChange: (section: SettingsSectionId) => void;
  className?: string;
}

export function SettingsMenu({
  activeSection,
  backHref,
  onSectionChange,
  className,
}: SettingsMenuProps) {
  return (
    <aside
      aria-label="Settings menu"
      className={cn(
        "flex h-full min-h-0 w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-background px-4 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))]",
        className,
      )}
    >
      <Link
        href={backHref}
        className="flex h-11 w-fit items-center gap-2 rounded-lg px-2 text-base font-medium text-foreground transition-colors hover:bg-surface-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:text-[15px]"
      >
        <ChevronLeft className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" aria-hidden="true" />
        Back to app
      </Link>

      <nav aria-label="Settings sections" className="mt-5">
        {SETTINGS_GROUPS.map((group, groupIndex) => (
          <section key={group.label} className={groupIndex === 0 ? undefined : "mt-7"}>
            <h2 className="px-2 text-sm font-medium text-text-muted sm:text-xs">{group.label}</h2>
            <ul className="mt-2 space-y-0.5">
              {group.items.map((item) => {
                const active = activeSection === item.id;
                const Icon = item.icon;

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => onSectionChange(item.id)}
                      className={cn(
                        "flex h-11 min-w-0 w-full items-center gap-3 rounded-xl px-2 text-left font-sans text-sm font-normal not-italic leading-5 text-sidebar-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8",
                        active
                          ? "bg-surface-low"
                          : "hover:bg-surface-low/70",
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" aria-hidden="true" />
                      <span className="min-w-0 whitespace-nowrap leading-5">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
    </aside>
  );
}

interface SettingsSectionHeaderProps {
  activeSection: SettingsSectionId;
  onBackToSettings?: () => void;
}

export function SettingsSectionHeader({
  activeSection,
  onBackToSettings,
}: SettingsSectionHeaderProps) {
  const label = SETTINGS_SECTION_LABELS[activeSection];
  const isStandalone = activeSection === "plans" || activeSection === "billing" || activeSection === "api-keys";

  return (
    <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 pt-[env(safe-area-inset-top)]">
      <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        {isStandalone ? (
          <>
            {onBackToSettings ? (
              <button
                type="button"
                aria-label="Back to settings"
                onClick={onBackToSettings}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
            ) : null}
            <h1 className="truncate text-sm font-medium text-foreground">{label}</h1>
          </>
        ) : (
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex min-w-0 items-center gap-1.5">
              <li className="shrink-0">
                {onBackToSettings ? (
                  <button
                    type="button"
                    aria-label="Back to settings"
                    onClick={onBackToSettings}
                    className="rounded-md text-text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Settings
                  </button>
                ) : (
                  <span className="text-text-muted">Settings</span>
                )}
              </li>
              <li aria-hidden="true" className="shrink-0 text-text-muted">
                <ChevronRight className="h-4 w-4" />
              </li>
              <li className="min-w-0">
                <h1 className="truncate text-sm font-medium text-foreground">{label}</h1>
              </li>
            </ol>
          </nav>
        )}
      </div>

      <Button asChild variant="outline" size="sm" className="h-8 shrink-0 rounded-lg bg-surface-low text-sm hover:bg-surface-medium hover:text-foreground">
        <a href="mailto:support@hypercli.com?subject=HyperCLI%20Claw%20feedback">
          <MessageSquareText className="h-4 w-4" aria-hidden="true" />
          Feedback
        </a>
      </Button>
    </header>
  );
}
