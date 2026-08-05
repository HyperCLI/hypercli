"use client";

import Link from "next/link";

import { DASHBOARD_VIEW_HREFS } from "@/lib/dashboard-route";
import { MessageSquare, Users } from "lucide-react";

const TEAM_SETTINGS_LINK_CLASS =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-low px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AgentTeamSettingsContent() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-7 md:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <h2 className="text-xl font-semibold leading-none text-foreground">Team</h2>
        <section className="mt-7 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-low/30 px-4 sm:px-5">
          <div className="flex min-h-[100px] items-center justify-between gap-4 py-6">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-high">
                <Users className="h-4 w-4 text-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-5 text-foreground">Domain members</p>
                <p className="mt-1 text-sm leading-5 text-text-muted">
                  Manage who can collaborate with this agent.
                </p>
              </div>
            </div>
            <Link href={DASHBOARD_VIEW_HREFS.overview} className={TEAM_SETTINGS_LINK_CLASS}>Manage</Link>
          </div>

          <div className="flex min-h-[100px] items-center justify-between gap-4 py-6">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-high">
                <MessageSquare className="h-4 w-4 text-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-5 text-foreground">Shared channels</p>
                <p className="mt-1 text-sm leading-5 text-text-muted">
                  Coordinate agent projects with teammates.
                </p>
              </div>
            </div>
            <Link href="/dashboard/agents" className={TEAM_SETTINGS_LINK_CLASS}>Open</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
