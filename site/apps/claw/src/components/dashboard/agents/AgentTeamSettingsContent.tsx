"use client";

import Link from "next/link";
import { MessageSquare, Users } from "lucide-react";

const TEAM_SETTINGS_LINK_CLASS =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-low px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-high";

export function AgentTeamSettingsContent() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-7 md:px-8">
      <div className="mx-auto w-full max-w-[844px]">
        <h2 className="text-[20px] font-semibold leading-none text-foreground">Team</h2>
        <section className="mt-7 border-b border-foreground">
          <div className="flex min-h-[100px] items-center justify-between gap-4 border-b border-foreground py-7">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#2a2b2e]">
                <Users className="h-4 w-4 text-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold leading-5 text-foreground">Workspace members</p>
                <p className="mt-1 text-[13px] font-medium leading-5 text-text-muted">
                  Manage who can collaborate with this agent.
                </p>
              </div>
            </div>
            <Link href="/dashboard" className={TEAM_SETTINGS_LINK_CLASS}>Manage</Link>
          </div>

          <div className="flex min-h-[100px] items-center justify-between gap-4 py-7">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#2a2b2e]">
                <MessageSquare className="h-4 w-4 text-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold leading-5 text-foreground">Shared channels</p>
                <p className="mt-1 text-[13px] font-medium leading-5 text-text-muted">
                  Coordinate agent conversations with teammates.
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
