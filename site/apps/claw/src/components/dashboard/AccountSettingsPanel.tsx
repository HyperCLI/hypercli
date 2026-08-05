"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { getSlackInstallStatus, type SlackInstallStatus } from "@hypercli.com/sdk/agents";
import { Badge, Button, Card, Switch, ThemeSelector } from "@hypercli/shared-ui";

import { TooltipHint } from "@/components/ClawTooltip";
import { SlackIcon } from "@/components/dashboard/BrandIcons";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { useAgentStartupExperience } from "@/hooks/useAgentStartupExperience";
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
    <Card className="mb-5 gap-0 rounded-xl bg-surface-low p-5 text-left">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--selection-accent)]" />
            ) : connected ? (
              <CheckCircle2 className="h-5 w-5 text-[var(--selection-accent)]" />
            ) : (
              <SlackIcon className="h-5 w-5" />
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
        <div className="flex shrink-0 flex-wrap gap-2 lg:pt-0.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            className="h-9 rounded-lg text-xs font-semibold text-text-secondary hover:bg-surface-high hover:text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button asChild variant="outline" size="sm" className="h-9 rounded-lg text-xs font-semibold text-text-secondary hover:bg-surface-high hover:text-foreground">
            <Link href="/slack/status">Debug</Link>
          </Button>
          {connected ? (
            <TooltipHint label="Disconnect from Slack workspace app settings." disabled>
              <Button type="button" variant="outline" size="sm" disabled className="h-9 rounded-lg text-xs font-semibold text-text-secondary">
                Disconnect Slack
              </Button>
            </TooltipHint>
          ) : null}
          <Button asChild size="sm" className="h-9 rounded-lg text-xs font-semibold">
            <Link href="/slack/start">{connected ? "Reconnect Slack" : "Connect Slack"}</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function AccountSettingsPanel() {
  const { getToken } = useAgentAuth();
  const [startupExperience, setStartupExperience] = useAgentStartupExperience();
  const startupTipsEnabled = startupExperience === "tips";

  return (
    <div className="h-full overflow-y-auto bg-background px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <Card className="mb-5 gap-0 rounded-xl bg-surface-low p-5 text-left">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Appearance</h2>
              <p className="mt-1 text-sm text-text-muted">Choose how HyperCLI looks across all apps.</p>
            </div>
            <ThemeSelector aria-label="Appearance theme" className="lg:mt-0.5" />
          </div>
        </Card>
        <Card className="mb-5 gap-0 rounded-xl bg-surface-low p-5 text-left">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">Loading screen</h2>
                <Badge variant="outline" className="rounded-full border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-2 text-[10px] font-semibold text-[var(--selection-accent)]">
                  Preview
                </Badge>
              </div>
              <p id="startup-screen-description" className="mt-1 max-w-2xl text-sm leading-6 text-text-muted">
                Choose what you see while your teammate gets ready or rejoins after a page load.
              </p>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-5 lg:min-w-[19rem] lg:justify-end">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {startupTipsEnabled ? "Helpful tips" : "Classic"}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {startupTipsEnabled ? "Warm guidance while things load" : "The original loading animation"}
                </p>
              </div>
              <Switch
                checked={startupTipsEnabled}
                onCheckedChange={(checked) => setStartupExperience(checked ? "tips" : "classic")}
                aria-label="Show helpful loading tips"
                aria-describedby="startup-screen-description"
              />
            </div>
          </div>
        </Card>
        <SlackAccountSection getToken={getToken} />
      </div>
    </div>
  );
}
