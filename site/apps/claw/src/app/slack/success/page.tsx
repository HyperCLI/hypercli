"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

const DEFAULT_SLACK_RETURN_PATH = "/dashboard/settings/";

function integrationReturnUrl(searchParams: Pick<URLSearchParams, "get">): string {
  const base = new URL(DEFAULT_SLACK_RETURN_PATH, typeof window === "undefined" ? "https://agents.hypercli.com" : window.location.origin);
  base.searchParams.set("integration", "slack");
  base.searchParams.set("slack_oauth_ok", searchParams.get("ok") === "true" ? "true" : "false");
  const teamId = searchParams.get("team_id")?.trim();
  const error = searchParams.get("error")?.trim();
  if (teamId) base.searchParams.set("slack_team_id", teamId);
  if (error) base.searchParams.set("slack_oauth_error", error);
  return `${base.pathname}${base.search}${base.hash}`;
}

function SlackSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ok = searchParams.get("ok") === "true";
  const teamId = searchParams.get("team_id")?.trim() || null;
  const error = searchParams.get("error")?.trim() || null;
  const returnUrl = useMemo(() => integrationReturnUrl(searchParams), [searchParams]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      router.replace(returnUrl);
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [returnUrl, router]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col items-center justify-center px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-surface-high">
          {ok ? (
            <CheckCircle2 className="h-5 w-5 text-[var(--selection-accent)]" />
          ) : (
            <XCircle className="h-5 w-5 text-destructive" />
          )}
        </div>
        <h1 className="mt-5 text-2xl font-semibold leading-tight">
          {ok ? "Slack connected" : "Slack connection failed"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-text-muted">
          {ok
            ? "Returning to settings in 10 seconds."
            : "Returning to settings in 10 seconds so you can retry or inspect status."}
        </p>
        {teamId ? <p className="mt-4 text-xs font-medium uppercase tracking-[0.16em] text-text-muted">Team {teamId}</p> : null}
        {error ? <p className="mt-4 text-xs font-medium uppercase tracking-[0.16em] text-destructive">Error: {error}</p> : null}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={returnUrl} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground">
            Settings
          </Link>
          <Link href="/slack/status" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground">
            Slack status
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function SlackSuccessPage() {
  return (
    <Suspense fallback={(
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col items-center justify-center px-6 py-16 text-center">
          <h1 className="text-2xl font-semibold leading-tight">Completing Slack connection</h1>
        </div>
      </main>
    )}>
      <SlackSuccessContent />
    </Suspense>
  );
}
