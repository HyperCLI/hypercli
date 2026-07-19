"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { startSlackOAuth } from "@hypercli.com/sdk/agents";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { SLACK_APP_HANDLE, SLACK_RELAY_BASE_URL } from "@/lib/api";

type StartState = "checking" | "login" | "starting" | "error";

const SLACK_OAUTH_RETURN_STORAGE_KEY = "hypercli.slack.oauth.returnTo";
const DEFAULT_SLACK_RETURN_PATH = "/dashboard/settings/";

function safeReturnTo(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
}

export default function SlackStartPage() {
  const { getToken, isAuthenticated, isLoading, login } = useAgentAuth();
  const [state, setState] = useState<StartState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState(DEFAULT_SLACK_RETURN_PATH);

  useEffect(() => {
    const requestedReturnTo = typeof window === "undefined"
      ? null
      : safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
    if (requestedReturnTo) {
      setReturnTo(requestedReturnTo);
      try {
        window.sessionStorage.setItem(SLACK_OAUTH_RETURN_STORAGE_KEY, requestedReturnTo);
      } catch {}
    }
    if (isLoading) {
      setState("checking");
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
    setState("starting");
    setError(null);
    void (async () => {
      try {
        const token = await getToken();
        const oauth = await startSlackOAuth({
          relayBaseUrl: SLACK_RELAY_BASE_URL,
          token,
        });
        if (!cancelled) window.location.assign(oauth.authorizeUrl);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not start Slack OAuth.");
        setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken, isAuthenticated, isLoading]);

  const title = state === "login" ? "Sign in to connect Slack" : state === "error" ? "Slack setup needs attention" : "Opening Slack";
  const description = state === "login"
    ? "Sign in before authorizing the HyperCLI Slack App."
    : state === "error"
      ? error ?? "Slack setup could not start."
      : `Preparing the @${SLACK_APP_HANDLE} Slack installation.`;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col items-center justify-center px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-surface-high">
          {state === "checking" || state === "starting" ? (
            <Loader2 className="h-5 w-5 animate-spin text-[var(--selection-accent)]" />
          ) : (
            <MessageSquare className="h-5 w-5 text-[var(--selection-accent)]" />
          )}
        </div>
        <h1 className="mt-5 text-2xl font-semibold leading-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-text-muted">{description}</p>
        {state === "login" ? (
          <button
            type="button"
            onClick={login}
            className="mt-6 rounded-lg border border-[rgb(var(--selection-accent-rgb)_/_0.45)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] px-4 py-2 text-sm font-medium text-[var(--selection-accent)]"
          >
            Sign in
          </button>
        ) : null}
        {state === "error" ? (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href={returnTo} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground">
              Integrations
            </Link>
            <Link href="/slack/status" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground">
              Slack status
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}
