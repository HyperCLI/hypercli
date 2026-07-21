"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  LockKeyhole,
  Mail,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";

import { useAgentAuth } from "@/hooks/useAgentAuth";

function accountName(user: ReturnType<typeof useAgentAuth>["user"]): string {
  const explicitName = user?.fullName?.trim() || user?.name?.trim() || user?.username?.trim();
  if (explicitName) return explicitName;

  const emailName = user?.email?.split("@")[0]?.trim();
  return emailName || "Your account";
}

function accountInitials(name: string, email?: string): string {
  const parts = name === "Your account" ? [] : name.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || email?.slice(0, 2) || "YO").toUpperCase();
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof UsersRound;
  accent?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-low/35 p-4">
      {accent ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.09)] blur-2xl"
        />
      ) : null}
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">{label}</p>
          <p className={`mt-2 text-2xl font-semibold tracking-tight ${accent ? "text-[var(--selection-accent)]" : "text-foreground"}`}>
            {value}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{detail}</p>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
          accent
            ? "border-[rgb(var(--selection-accent-rgb)_/_0.25)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]"
            : "border-border bg-background/40 text-text-secondary"
        }`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

export function MembersSection({ compact = false }: { compact?: boolean }) {
  const { isLoading, user } = useAgentAuth();
  const [query, setQuery] = useState("");
  const name = accountName(user);
  const email = user?.email?.trim() || "Email unavailable";
  const initials = accountInitials(name, user?.email);
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = Boolean(user) && (
    !normalizedQuery || name.toLowerCase().includes(normalizedQuery) || email.toLowerCase().includes(normalizedQuery)
  );

  if (compact) {
    return (
      <section className="flex min-h-[356px] flex-col overflow-hidden rounded-lg border border-border bg-surface-low">
        <div className="flex h-[70px] items-center justify-between border-b border-border px-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Members</h2>
            <p className="mt-0.5 text-[11px] text-text-muted">Account access visible in this session</p>
          </div>
          <Link
            href="/dashboard/agents?section=members"
            className="text-[11px] font-medium text-text-muted transition-colors hover:text-foreground"
          >
            Manage
          </Link>
        </div>
        <div className="flex flex-1 flex-col justify-center px-5 py-6">
          {isLoading ? (
            <div role="status" className="flex items-center gap-3 text-[12px] text-text-muted">
              <span className="h-9 w-9 animate-pulse rounded-full bg-surface-high" />
              Loading account identity
            </div>
          ) : user ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-background/35 px-4 py-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-[11px] font-semibold text-[var(--selection-accent)]">
                {initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground">{name}</span>
                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
                  <Mail className="h-3 w-3 shrink-0" />
                  <span className="truncate">{email}</span>
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-low px-2.5 py-1 text-[10px] font-medium text-text-secondary">
                <Check className="h-3 w-3 text-[var(--selection-accent)]" /> You
              </span>
            </div>
          ) : (
            <div role="status" className="text-center">
              <UserRound className="mx-auto h-5 w-5 text-text-muted" />
              <p className="mt-2 text-[12px] font-medium text-foreground">Account details are unavailable</p>
              <p className="mt-1 text-[11px] text-text-muted">Refresh the page or sign in again.</p>
            </div>
          )}
          <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-[rgb(var(--selection-accent-rgb)_/_0.06)] px-3.5 py-3">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--selection-accent)]" />
            <p className="text-[11px] leading-relaxed text-text-muted">
              Additional people, roles, and invitations are not available from the current account data.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="members-title" className="mx-auto w-full max-w-[1120px] space-y-6 pb-10">
      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)] shadow-[0_10px_30px_rgb(var(--selection-accent-rgb)_/_0.08)]">
            <UsersRound className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Workspace administration</p>
            <h1 id="members-title" className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-foreground">Members</h1>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-text-muted">
              View the account identity available in your current session.
            </p>
          </div>
        </div>
        <span className="inline-flex h-8 w-fit shrink-0 items-center gap-2 rounded-full border border-border bg-surface-low/45 px-3 text-[11px] font-medium text-text-secondary">
          <LockKeyhole className="h-3.5 w-3.5 text-[var(--selection-accent)]" />
          Account access
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Visible accounts"
          value={isLoading ? "-" : user ? "1" : "0"}
          detail="Current authenticated identity"
          icon={UsersRound}
          accent
        />
        <SummaryCard
          label="Session"
          value={isLoading ? "-" : user ? "Current" : "None"}
          detail="No presence data for other people"
          icon={UserRound}
        />
        <SummaryCard
          label="Team access"
          value="Unavailable"
          detail="No invitations or workspace roles"
          icon={ShieldCheck}
        />
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-[rgb(var(--selection-accent-rgb)_/_0.2)] bg-[rgb(var(--selection-accent-rgb)_/_0.06)] px-4 py-3.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--selection-accent)]" />
        <div>
          <p className="text-[12px] font-semibold text-foreground">Current account only</p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
            This is not a complete member directory. Other people, invitations, roles, and access status are not available in this workspace.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface-low/20">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-[14px] font-semibold text-foreground">Workspace access</h2>
            <p className="mt-0.5 text-[11px] text-text-muted">The authenticated account visible in this session.</p>
          </div>
          <label className="relative block w-full sm:w-64">
            <span className="sr-only">Search members</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search members"
              disabled={isLoading || !user}
              className="h-9 w-full rounded-xl border border-border bg-background/45 pl-9 pr-3 text-[12px] text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-foreground/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-55"
            />
          </label>
        </div>

        <div role="table" aria-label="Visible workspace accounts">
          <div role="row" className="sr-only md:not-sr-only md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(130px,0.65fr)_minmax(110px,0.5fr)] md:gap-4 md:border-b md:border-border md:bg-background/20 md:px-5 md:py-2.5">
            <span id="members-column-account" role="columnheader" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Account</span>
            <span id="members-column-access" role="columnheader" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Access</span>
            <span id="members-column-session" role="columnheader" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Session</span>
          </div>

          {isLoading ? (
            <div role="row">
              <div role="cell" aria-colspan={3} className="flex items-center gap-3 px-5 py-6 text-[12px] text-text-muted">
                <span className="h-8 w-8 animate-pulse rounded-full bg-surface-high" />
                <span role="status">Loading account identity</span>
              </div>
            </div>
          ) : !user ? (
            <div role="row">
              <div role="cell" aria-colspan={3} className="px-5 py-8 text-center">
                <div role="status">
                  <UserRound className="mx-auto h-5 w-5 text-text-muted" />
                  <p className="mt-2 text-[12px] font-medium text-foreground">Account details are unavailable</p>
                  <p className="mt-1 text-[11px] text-text-muted">Refresh the page or sign in again.</p>
                </div>
              </div>
            </div>
          ) : matchesQuery ? (
            <div role="row" className="grid gap-4 px-4 py-4 transition-colors hover:bg-surface-low/45 sm:px-5 md:grid-cols-[minmax(0,1.5fr)_minmax(130px,0.65fr)_minmax(110px,0.5fr)] md:items-center">
              <div role="cell" className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-[11px] font-semibold text-[var(--selection-accent)]">
                  {initials}
                </span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">{name}</span>
                    <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-text-muted">You</span>
                  </span>
                  <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
                    <Mail className="h-3 w-3 shrink-0" />
                    <span className="truncate">{email}</span>
                  </span>
                </span>
              </div>
              <div role="cell" className="flex items-center justify-between gap-3 md:block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted md:hidden">Access</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/45 px-2.5 py-1 text-[10px] font-medium text-text-secondary">
                  <LockKeyhole className="h-3 w-3" /> Current account
                </span>
              </div>
              <div role="cell" className="flex items-center justify-between gap-3 md:block">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted md:hidden">Session</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.1)] px-2.5 py-1 text-[10px] font-medium text-[var(--selection-accent)]">
                  <Check className="h-3 w-3" /> Signed in
                </span>
              </div>
            </div>
          ) : (
            <div role="row">
              <div role="cell" aria-colspan={3} className="px-5 py-8 text-center">
                <div role="status">
                  <Search className="mx-auto h-5 w-5 text-text-muted" />
                  <p className="mt-2 text-[12px] font-medium text-foreground">No accounts found</p>
                  <p className="mt-1 text-[11px] text-text-muted">Try a different name or email.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
