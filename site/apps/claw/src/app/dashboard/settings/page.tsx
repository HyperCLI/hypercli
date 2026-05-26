"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  BarChart3,
  Bot,
  CreditCard,
  KeyRound,
  LogOut,
  Mail,
  Rocket,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { useAgentAuth } from "@/hooks/useAgentAuth";

type SettingsSection = "general" | "agent" | "billing" | "usage";

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "General", description: "Profile and session", icon: User },
  { id: "agent", label: "Agent", description: "Workspace defaults", icon: Bot },
  { id: "billing", label: "Billing", description: "Plan and receipts", icon: CreditCard },
  { id: "usage", label: "Usage", description: "Limits and keys", icon: BarChart3 },
];

function compactId(value: string | undefined): string {
  if (!value) return "-";
  return value.length > 18 ? `${value.slice(0, 12)}...` : value;
}

function compactWallet(value: string | undefined): string {
  if (!value) return "Not connected";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function SettingsCard({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="glass-card p-5">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SettingsInfoRow({
  description,
  icon: Icon,
  label,
  value,
}: {
  description?: string;
  icon: LucideIcon;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-low">
        <Icon className="h-4 w-4 text-text-tertiary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</p>
        <div className="mt-0.5 min-w-0 text-sm font-medium text-foreground">{value}</div>
        {description ? <p className="mt-1 text-xs text-text-muted">{description}</p> : null}
      </div>
    </div>
  );
}

function SettingsActionLink({
  description,
  href,
  icon: Icon,
  label,
}: {
  description: string;
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-3 transition-colors hover:border-border-medium hover:bg-surface-low"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-low">
        <Icon className="h-4 w-4 text-text-secondary" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-text-muted">{description}</p>
      </div>
    </Link>
  );
}

function SettingsDetailRow({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description: string;
  label: string;
}) {
  return (
    <div className="grid gap-4 border-b border-border py-5 md:grid-cols-[240px_minmax(0,1fr)] md:items-center">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="mt-1 text-sm text-text-secondary">{description}</p>
      </div>
      <div className="min-w-0 md:justify-self-end">{children}</div>
    </div>
  );
}

function SettingsButtonLink({
  children,
  href,
  tone = "default",
}: {
  children: ReactNode;
  href: string;
  tone?: "default" | "danger";
}) {
  return (
    <Link
      href={href}
      className={`inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors ${
        tone === "danger"
          ? "border-[#d05f5f]/30 bg-[#d05f5f]/10 text-[#d05f5f] hover:bg-[#d05f5f]/20"
          : "border-border bg-background text-foreground hover:bg-surface-low"
      }`}
    >
      {children}
    </Link>
  );
}

function renderSettingsSection({
  activeSection,
  logout,
  user,
}: {
  activeSection: SettingsSection;
  logout: () => Promise<void>;
  user: ReturnType<typeof useAgentAuth>["user"];
}) {
  switch (activeSection) {
    case "general":
      return (
        <>
          <SettingsCard title="Account" description="Basic identity for this HyperCLI session.">
            <div className="space-y-3">
              <SettingsInfoRow
                icon={User}
                label="User ID"
                value={<span className="font-mono">{compactId(user?.id)}</span>}
              />
              <SettingsInfoRow
                icon={Mail}
                label="Email"
                value={user?.email || "Not provided"}
                description="Used for login and account notifications."
              />
              <SettingsInfoRow
                icon={Wallet}
                label="Wallet Address"
                value={<span className="font-mono">{compactWallet(user?.walletAddress)}</span>}
              />
            </div>
          </SettingsCard>

          <SettingsCard title="Session" description="Control access on this device.">
            <div className="flex flex-col gap-3 rounded-lg border border-[#d05f5f]/20 bg-[#d05f5f]/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Sign out</p>
                <p className="mt-1 text-sm text-text-secondary">End your HyperCLI session on this browser.</p>
              </div>
              <button
                type="button"
                onClick={() => { void logout(); }}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#d05f5f]/30 bg-[#d05f5f]/10 px-3 text-sm font-semibold text-[#d05f5f] transition-colors hover:bg-[#d05f5f]/20"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </SettingsCard>
        </>
      );
    case "agent":
      return (
        <SettingsCard title="Agent Settings" description="Workspace-level defaults live in the Agents workspace.">
          <div className="-mt-1">
            <SettingsDetailRow label="Agent name" description="Shown when users interact with this agent.">
              <SettingsButtonLink href="/agents">Manage agents</SettingsButtonLink>
            </SettingsDetailRow>
            <SettingsDetailRow label="Avatar" description="Helps identify this agent.">
              <SettingsButtonLink href="/agents">Update avatar</SettingsButtonLink>
            </SettingsDetailRow>
            <SettingsDetailRow label="Default model" description="Model used by this agent.">
              <SettingsButtonLink href="/agents">Open model settings</SettingsButtonLink>
            </SettingsDetailRow>
            <SettingsDetailRow label="Visibility" description="Who can access this agent.">
              <SettingsButtonLink href="/agents">Manage access</SettingsButtonLink>
            </SettingsDetailRow>
            <SettingsDetailRow label="Auto-archive idle conversations" description="Archive inactive chats automatically.">
              <SettingsButtonLink href="/agents">Open workspace</SettingsButtonLink>
            </SettingsDetailRow>
          </div>
        </SettingsCard>
      );
    case "billing":
      return (
        <section className="glass-card overflow-hidden p-0">
          <div className="flex flex-col gap-4 border-b border-border-medium p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-low">
                <Rocket className="h-5 w-5 text-text-secondary" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-foreground">
                  Pro Plan <span className="text-text-muted">/ Monthly</span>
                </p>
                <p className="mt-1 text-sm text-text-secondary">Your subscription will auto renew on May 21, 2026.</p>
              </div>
            </div>
            <SettingsButtonLink href="/plans">Adjust plan</SettingsButtonLink>
          </div>

          <div className="flex flex-col gap-3 border-b border-border-medium p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Payment</p>
              <p className="mt-1 text-sm text-text-secondary">Mastercard •••• 1234</p>
            </div>
            <SettingsButtonLink href="/dashboard/billing">Update</SettingsButtonLink>
          </div>

          <div className="border-b border-border-medium p-5">
            <h3 className="text-lg font-semibold text-foreground">Invoices</h3>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-2 pb-3 text-sm font-semibold text-foreground">Receipt</th>
                    <th className="px-2 pb-3 text-sm font-semibold text-foreground">Total</th>
                    <th className="px-2 pb-3 text-sm font-semibold text-foreground">Status</th>
                    <th className="px-2 pb-3 text-sm font-semibold text-foreground">Date</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/70">
                    <td className="px-2 py-3 align-top">
                      <Link href="/dashboard/billing" className="block text-sm font-semibold text-foreground hover:text-primary">
                        20689860
                      </Link>
                      <p className="mt-1 max-w-[260px] truncate text-xs text-text-muted">20689860-371b-4aeb-a0c0-98597140f345</p>
                    </td>
                    <td className="px-2 py-3 align-top text-sm font-semibold text-foreground">$79</td>
                    <td className="px-2 py-3 align-top">
                      <span className="inline-flex h-6 items-center rounded-full bg-[#0d5f38] px-3 text-xs font-medium text-[#38D39F]">
                        Completed
                      </span>
                    </td>
                    <td className="px-2 py-3 align-top text-sm font-semibold text-foreground">Apr 20, 2026</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-5">
            <h3 className="text-lg font-semibold text-foreground">Cancellation</h3>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Cancel Plan</p>
                <p className="mt-1 text-sm text-text-secondary">Mastercard •••• 1234</p>
              </div>
              <SettingsButtonLink href="/dashboard/billing" tone="danger">Cancel</SettingsButtonLink>
            </div>
          </div>
        </section>
      );
    case "usage":
      return (
        <SettingsCard title="Usage" description="Track token consumption and API-key activity.">
          <div className="grid gap-3 sm:grid-cols-2">
            <SettingsActionLink
              href="/dashboard"
              icon={BarChart3}
              label="Usage dashboard"
              description="View token usage, requests, keys, and current limits."
            />
            <SettingsActionLink
              href="/keys"
              icon={KeyRound}
              label="API keys"
              description="Manage keys and inspect key-level usage."
            />
          </div>
        </SettingsCard>
      );
    default:
      return null;
  }
}

export default function SettingsPage() {
  const { user, logout } = useAgentAuth();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const active = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0];
  const ActiveIcon = active.icon;

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-text-secondary">Manage account, agent, billing, and usage preferences.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="glass-card h-fit min-w-0 p-2">
          <nav className="flex gap-1 overflow-x-auto pb-1 xl:block xl:space-y-1 xl:overflow-visible xl:pb-0">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon;
              const selected = section.id === activeSection;
              return (
                <button
                  key={section.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveSection(section.id)}
                  className={`flex min-w-[150px] shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors xl:w-full xl:min-w-0 ${
                    selected
                      ? "bg-surface-low text-foreground"
                      : "text-text-secondary hover:bg-surface-low/70 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{section.label}</span>
                    <span className="block truncate text-xs text-text-muted">{section.description}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-low">
              <ActiveIcon className="h-5 w-5 text-text-secondary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">{active.label}</h2>
              <p className="text-sm text-text-secondary">{active.description}</p>
            </div>
          </div>

          {renderSettingsSection({ activeSection, logout, user })}
        </div>
      </div>
    </div>
  );
}
