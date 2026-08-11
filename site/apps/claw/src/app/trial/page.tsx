"use client";

import Link from "next/link";
import { useState } from "react";
import { HyperCLILogo, PrivyLoginPanel, notifyBillingPlanChanged } from "@hypercli/shared-ui";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createHyperAgentClient } from "@/lib/agent-client";

type TrialClaimState = "idle" | "claiming" | "success";

function trialClaimErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "detail" in error) {
    const detail = String((error as { detail?: unknown }).detail ?? "").trim();
    if (detail) return detail;
  }
  return error instanceof Error && error.message
    ? error.message
    : "Trial access could not be started. Try again.";
}

export default function TrialPage() {
  const { getToken, isAuthenticated, isLoading } = useAgentAuth();
  const [claimState, setClaimState] = useState<TrialClaimState>("idle");
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <main id="trial-page-loading" className="trial-page-loading flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-text-muted">Loading…</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main id="trial-page-login" className="trial-page-login flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="flex w-full max-w-sm flex-col items-center gap-8">
          <HyperCLILogo />
          <PrivyLoginPanel
            title="Start your free trial"
            description="Sign in to continue. No payment method is required."
            tokenStorageKey="claw_auth_token"
          />
        </div>
      </main>
    );
  }

  const claimTrial = async () => {
    if (claimState === "claiming" || claimState === "success") return;
    setClaimState("claiming");
    setError(null);
    try {
      const client = createHyperAgentClient(await getToken());
      await client.claimTrialEntitlement();
      await client.subscriptionSummary().catch(() => null);
      notifyBillingPlanChanged();
      setClaimState("success");
    } catch (claimError) {
      setClaimState("idle");
      setError(trialClaimErrorMessage(claimError));
    }
  };

  return (
    <DashboardShell>
      <main id="trial-page" className="trial-page mx-auto flex w-full max-w-3xl flex-1 items-center px-5 py-12 sm:px-8">
        <section className="trial-claim-card w-full rounded-2xl border border-border bg-surface-low p-6 shadow-sm sm:p-10" aria-labelledby="trial-page-heading">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Free trial</p>
          <h1 id="trial-page-heading" className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Try HyperCLI Agents
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-text-secondary sm:text-base">
            Start seven days of trial access. No card, checkout, or purchase is required. Eligibility is verified securely when you continue.
          </p>

          {claimState === "success" ? (
            <div id="trial-claim-success" className="trial-claim-success mt-8 rounded-xl border border-success/30 bg-success/10 p-5" role="status">
              <h2 className="text-lg font-semibold text-foreground">Trial access is ready</h2>
              <p className="mt-2 text-sm text-text-secondary">Your account limits and agent capacity have been refreshed.</p>
              <Link id="trial-continue-button" className="trial-continue-button btn-primary mt-5 inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold" href="/dashboard/agents">
                Continue to Agents
              </Link>
            </div>
          ) : (
            <div className="mt-8">
              <button
                id="claim-trial-button"
                className="claim-trial-button btn-primary inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold disabled:cursor-wait disabled:opacity-70"
                type="button"
                disabled={claimState === "claiming"}
                onClick={() => void claimTrial()}
              >
                {claimState === "claiming" ? "Starting trial…" : "Start free trial"}
              </button>
              {error ? (
                <p id="trial-claim-error" className="trial-claim-error mt-4 text-sm text-destructive" role="alert">{error}</p>
              ) : null}
            </div>
          )}
        </section>
      </main>
    </DashboardShell>
  );
}
