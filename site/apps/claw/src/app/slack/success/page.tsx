"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo } from "react";
import { CheckCircle2 } from "lucide-react";
import { RecoveryState } from "@hypercli/shared-ui";
import { DASHBOARD_VIEW_HREFS } from "@/lib/dashboard-route";

const DEFAULT_SLACK_RETURN_PATH = DASHBOARD_VIEW_HREFS.settings;

export function slackOAuthResultMessage(ok: boolean, error: string | null): string {
  if (ok) return "Returning to settings in 10 seconds.";
  if (error === "workspace_already_connected") {
    return "This Slack workspace is already connected to another HyperCLI account. Ask the current owner to disconnect it or contact an admin to transfer ownership.";
  }
  return "Returning to settings in 10 seconds so you can retry or inspect status.";
}

export function normalizeSlackOAuthError(error: string | null): string | null {
  return error === "workspace_already_connected" || error === "access_denied" ? error : null;
}

function integrationReturnUrl(searchParams: Pick<URLSearchParams, "get">): string {
  const base = new URL(DEFAULT_SLACK_RETURN_PATH, typeof window === "undefined" ? "https://agents.hypercli.com" : window.location.origin);
  base.searchParams.set("integration", "slack");
  base.searchParams.set("slack_oauth_ok", searchParams.get("ok") === "true" ? "true" : "false");
  const error = normalizeSlackOAuthError(searchParams.get("error")?.trim() || null);
  if (error) base.searchParams.set("slack_oauth_error", error);
  return `${base.pathname}${base.search}${base.hash}`;
}

function SlackSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ok = searchParams.get("ok") === "true";
  const hasTeamReference = Boolean(searchParams.get("team_id")?.trim());
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
            <span className="h-2.5 w-2.5 rounded-full bg-text-muted" aria-hidden="true" />
          )}
        </div>
        {ok ? (
          <>
            <h1 className="mt-5 text-2xl font-semibold leading-tight">Slack connected</h1>
            <p className="mt-3 text-sm leading-6 text-text-muted">{slackOAuthResultMessage(ok, error)}</p>
          </>
        ) : (
          <>
            <h1 className="sr-only">Slack connection failed</h1>
            <RecoveryState
              presentation="empty"
              announcement="assertive"
              title="Retry to connect Slack"
              description={slackOAuthResultMessage(ok, error)}
              primaryAction={{ label: "Retry in settings", onAction: () => router.replace(returnUrl) }}
              className="min-h-0 px-0 py-5"
            />
          </>
        )}
        {hasTeamReference ? <p className="mt-4 text-xs text-text-muted">Workspace connection recorded.</p> : null}
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
