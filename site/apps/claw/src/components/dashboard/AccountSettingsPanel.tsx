"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, MessageSquare, RefreshCw } from "lucide-react";
import { getSlackInstallStatus, type SlackInstallStatus } from "@hypercli.com/sdk/agents";
import { ThemeSelector } from "@hypercli/shared-ui";

import { TooltipHint } from "@/components/ClawTooltip";
import { ProfileBillingSection } from "@/components/billing/ProfileBillingSection";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { SLACK_APP_HANDLE, SLACK_RELAY_BASE_URL } from "@/lib/api";

function SlackAccountSection({ getToken }: { getToken: () => Promise<string> }) {
  const [status, setStatus] = useState<SlackInstallStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!SLACK_RELAY_BASE_URL) {
      setStatus(null);
      setError("Slack relay is not configured for this environment.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      setStatus(await getSlackInstallStatus({ relayBaseUrl: SLACK_RELAY_BASE_URL, token }));
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error ? cause.message : "Could not load Slack status.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const connected = status?.connected === true;
  return (
    <section className="mb-5 rounded-[12px] border border-border bg-surface-low p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--selection-accent)]" />
            ) : connected ? (
              <CheckCircle2 className="h-5 w-5 text-[var(--selection-accent)]" />
            ) : (
              <MessageSquare className="h-5 w-5 text-text-secondary" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Slack</h2>
            <p className="mt-1 text-sm leading-6 text-text-muted">
              {connected
                ? `@${SLACK_APP_HANDLE} is connected${status?.teamName ? ` to ${status.teamName}` : ""}.`
                : `Connect @${SLACK_APP_HANDLE} once, then attach individual agents from their Slack integration page.`}
            </p>
            {status?.teamId ? <p className="mt-2 font-mono text-xs text-text-muted">Team {status.teamId}</p> : null}
            {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <Link href="/slack/status" className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground">
            Debug
          </Link>
          {connected ? (
            <TooltipHint label="Disconnect from Slack workspace app settings." disabled>
              <button type="button" disabled className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-text-secondary opacity-60">
                Disconnect Slack
              </button>
            </TooltipHint>
          ) : null}
          <Link href="/slack/start" className="inline-flex h-9 items-center rounded-lg border border-[rgb(var(--selection-accent-rgb)_/_0.45)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] px-3 text-xs font-semibold text-[var(--selection-accent)] transition-colors hover:bg-[rgb(var(--selection-accent-rgb)_/_0.18)]">
            {connected ? "Reconnect Slack" : "Connect Slack"}
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function AccountSettingsPanel() {
  const { getToken } = useAgentAuth();

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6 lg:px-0">
        <section className="mb-5 rounded-xl border border-border bg-surface-low p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Appearance</h2>
              <p className="mt-1 text-sm text-text-muted">Choose how HyperCLI looks across all apps.</p>
            </div>
            <ThemeSelector aria-label="Appearance theme" />
          </div>
        </section>
        <SlackAccountSection getToken={getToken} />
        <ProfileBillingSection getToken={getToken} />
      </div>
    </div>
  );
}
