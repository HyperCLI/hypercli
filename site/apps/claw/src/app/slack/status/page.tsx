"use client";

import Link from "next/link";
import { DASHBOARD_VIEW_HREFS } from "@/lib/dashboard-route";
import { useEffect, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { getSlackInstallStatus, type SlackInstallStatus } from "@hypercli.com/sdk/agents";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { SLACK_APP_HANDLE, SLACK_RELAY_BASE_URL } from "@/lib/api";

type LoadState = "loading" | "ready" | "error" | "login";

export default function SlackStatusPage() {
  const { getToken, isAuthenticated, isLoading, login } = useAgentAuth();
  const [state, setState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<SlackInstallStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) {
      setState("loading");
      return;
    }
    if (!isAuthenticated) {
      setState("login");
      return;
    }
    if (!SLACK_RELAY_BASE_URL) {
      setError("Slack relay is not configured for this environment.");
      setState("error");
      return;
    }

    let cancelled = false;
    setState("loading");
    setError(null);
    void (async () => {
      try {
        const token = await getToken();
        const nextStatus = await getSlackInstallStatus({ relayBaseUrl: SLACK_RELAY_BASE_URL, token });
        if (!cancelled) {
          setStatus(nextStatus);
          setState("ready");
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load Slack status.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, isAuthenticated, isLoading]);

  const connected = status?.connected === true;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[680px] flex-col justify-center px-6 py-16">
        <div className="border-b border-border pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-high">
              {state === "loading" ? (
                <Loader2 className="h-5 w-5 animate-spin text-[var(--selection-accent)]" />
              ) : (
                <MessageSquare className="h-5 w-5 text-[var(--selection-accent)]" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-semibold leading-tight">Slack status</h1>
              <p className="mt-1 text-sm text-text-muted">@{SLACK_APP_HANDLE}</p>
            </div>
          </div>
        </div>

        <section className="border-b border-border py-6">
          {state === "login" ? (
            <div className="flex flex-col items-start gap-4">
              <p className="text-sm leading-6 text-text-muted">Sign in to inspect the Slack installation for this account.</p>
              <button
                type="button"
                onClick={login}
                className="rounded-lg border border-[rgb(var(--selection-accent-rgb)_/_0.45)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] px-4 py-2 text-sm font-medium text-[var(--selection-accent)]"
              >
                Sign in
              </button>
            </div>
          ) : state === "loading" ? (
            <p className="text-sm leading-6 text-text-muted">Checking Slack connection...</p>
          ) : state === "error" ? (
            <p className="text-sm leading-6 text-destructive">{error}</p>
          ) : (
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-text-muted">Connection</dt>
                <dd className="mt-1 font-medium">{connected ? "Connected" : "Not connected"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Workspace</dt>
                <dd className="mt-1 font-medium">{status?.teamName || status?.teamId || "None"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Team ID</dt>
                <dd className="mt-1 font-mono text-xs">{status?.teamId || "-"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Bot user</dt>
                <dd className="mt-1 font-mono text-xs">{status?.botUserId || "-"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Updated</dt>
                <dd className="mt-1 font-mono text-xs">{status?.updatedAt || "-"}</dd>
              </div>
            </dl>
          )}
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/slack/start" className="rounded-lg border border-[rgb(var(--selection-accent-rgb)_/_0.45)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] px-4 py-2 text-sm font-medium text-[var(--selection-accent)]">
            Connect Slack
          </Link>
          <Link href={DASHBOARD_VIEW_HREFS.settings} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground">
            Settings
          </Link>
        </div>
      </div>
    </main>
  );
}
