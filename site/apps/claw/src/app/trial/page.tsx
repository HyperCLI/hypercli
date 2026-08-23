"use client";

import { useState } from "react";
import { HyperCLILogo, PrivyLoginPanel, RecoveryState } from "@hypercli/shared-ui";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import {
  createPlanCheckoutAttemptId,
  createTeamTrialCheckoutState,
  writePendingPlanCheckout,
} from "@/lib/plan-checkout-state";
import { startTrial } from "@/lib/trial-checkout";

type TrialClaimState = "idle" | "claiming";
type TrialRecovery = { title: string; description: string };

function buildDashboardTrialReturnUrl(
  status: "success" | "cancelled",
  attemptId?: string | null,
): string {
  const url = new URL("/dashboard/agents", window.location.href);
  url.searchParams.set("checkout", status);
  if (attemptId?.trim()) url.searchParams.set("checkout_attempt", attemptId.trim());
  if (status === "success") {
    const separator = url.search ? "&" : "?";
    return `${url.toString()}${separator}session_id={CHECKOUT_SESSION_ID}`;
  }
  return url.toString();
}

export default function TrialPage() {
  const { getToken, isAuthenticated, isLoading, user } = useAgentAuth();
  const [claimState, setClaimState] = useState<TrialClaimState>("idle");
  const [error, setError] = useState<TrialRecovery | null>(null);

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
            description="Sign in to continue. A card is required to verify the trial."
            tokenStorageKey="claw_auth_token"
            securityNote="A secure one-time code will be sent to your email."
            errorMessage="Sign-in did not finish. Retry to reopen the session."
            errorTone="neutral"
          />
        </div>
      </main>
    );
  }

  const claimTrial = async () => {
    if (claimState === "claiming") return;
    setClaimState("claiming");
    setError(null);
    try {
      const principalId = user?.id;
      if (!principalId) throw new Error("Sign in again before starting the trial.");
      const token = await getToken();
      const checkoutAttemptId = createPlanCheckoutAttemptId();
      const { checkout, pending } = await createTeamTrialCheckoutState(
        { startTrial: (request) => startTrial(token, request) },
        {
          successUrl: buildDashboardTrialReturnUrl("success", checkoutAttemptId),
          cancelUrl: buildDashboardTrialReturnUrl("cancelled", checkoutAttemptId),
        },
        {
          principalId,
          summary: null,
          checkoutAttemptId,
        },
      );
      writePendingPlanCheckout(pending);
      window.location.href = checkout.checkoutUrl;
    } catch {
      setClaimState("idle");
      setError({
        title: "Retry to open secure checkout",
        description: "Checkout did not open. Retry when you are ready to continue.",
      });
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
            Start seven days of trial access with a card on file. You will not be charged until the trial ends.
          </p>

          <div className="mt-8">
            <button
              id="claim-trial-button"
              className="claim-trial-button btn-primary inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold disabled:cursor-wait disabled:opacity-70"
              type="button"
              disabled={claimState === "claiming"}
              onClick={() => void claimTrial()}
            >
              {claimState === "claiming" ? "Opening checkout..." : "Start free trial"}
            </button>
            {error ? (
              <RecoveryState
                id="trial-claim-error"
                presentation="compact"
                announcement="assertive"
                title={error.title}
                description={error.description}
                primaryAction={{ label: "Retry checkout", onAction: () => { void claimTrial(); } }}
                className="trial-claim-error mt-4"
              />
            ) : null}
          </div>
        </section>
      </main>
    </DashboardShell>
  );
}
