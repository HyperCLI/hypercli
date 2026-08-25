import { describe, expect, it } from "vitest";
import type { HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";

import { getActiveAgentTrial } from "@/lib/agent-trial";
import {
  canStartTeamTrialForPrincipal,
  type TeamTrialStartState,
} from "@/lib/plan-checkout-state";

// AgentsPageContent is a large client component that is impractical to render in
// a unit test. This suite pins the pure trial-surfacing resolver used by the page.
//
// Contract: an authenticated Start trial action surfaces only when there is no
// active trial, getTeamTrialEligibility(currentPrincipal, billingDataPrincipalId,
// summary) is "eligible", there is no active plan or direct grant entitlement,
// and billing history is authoritatively false. Loading, error, and principal
// mismatch states, payment/subscription history, prior/expired/converted
// trials, paid plans, and grant-backed access are all ineligible. Anonymous
// entry is out of scope here: the sidebar shows the offer pre-auth
// (!isAuthenticated || canStartTrial) and routes it into authentication, so
// this resolver only governs the authenticated decision.
//
const NOW = Date.parse("2026-08-25T12:00:00Z");

function eligibleSummary() {
  return {
    subscriptions: [],
    activeSubscriptions: [],
    activeSubscriptionCount: 0,
    activeEntitlementCount: 0,
  } as unknown as HyperAgentSubscriptionSummary;
}

function activeTrialSummary() {
  return {
    subscriptions: [],
    activeSubscriptions: [{
      id: "sub-team-trial",
      planId: "team",
      planName: "Team",
      isCurrent: true,
      trial: {
        active: true,
        days: 7,
        startsAt: new Date("2026-08-24T12:00:00Z"),
        endsAt: new Date("2026-08-31T12:00:00Z"),
        secondsRemaining: 6 * 86_400,
      },
    }],
    activeSubscriptionCount: 1,
    activeEntitlementCount: 1,
  } as unknown as HyperAgentSubscriptionSummary;
}

function priorTrialSummary() {
  return {
    subscriptions: [{
      id: "sub-team-trial",
      planId: "team",
      planName: "Team",
      isCurrent: false,
      trial: {
        active: false,
        days: 7,
        startsAt: new Date("2026-07-01T12:00:00Z"),
        endsAt: new Date("2026-07-08T12:00:00Z"),
        secondsRemaining: 0,
      },
    }],
    activeSubscriptions: [],
    activeSubscriptionCount: 0,
    activeEntitlementCount: 0,
  } as unknown as HyperAgentSubscriptionSummary;
}

function paidSubscriptionSummary() {
  return {
    subscriptions: [],
    activeSubscriptions: [{ id: "sub-pro", planId: "pro", planName: "Pro", isCurrent: true }],
    activeSubscriptionCount: 1,
    activeEntitlementCount: 1,
  } as unknown as HyperAgentSubscriptionSummary;
}

function grantBackedSummary() {
  // Activation-code grants create active direct entitlements with no
  // subscription or payment history.
  return {
    subscriptions: [],
    activeSubscriptions: [],
    activeSubscriptionCount: 0,
    activeEntitlementCount: 1,
  } as unknown as HyperAgentSubscriptionSummary;
}

describe("agents page Team trial surfacing", () => {
  const cases: Array<[string, TeamTrialStartState, boolean]> = [
    ["billing summary still loading (no summary yet)", {
      principalId: "user-1",
      billingDataPrincipalId: null,
      summary: null,
      hasBillingHistory: false,
      now: NOW,
    }, false],
    ["billing error reset the principal marker after a clean summary", {
      principalId: "user-1",
      billingDataPrincipalId: null,
      summary: eligibleSummary(),
      hasBillingHistory: false,
      now: NOW,
    }, false],
    ["billing data belongs to another principal", {
      principalId: "user-1",
      billingDataPrincipalId: "user-2",
      summary: eligibleSummary(),
      hasBillingHistory: false,
      now: NOW,
    }, false],
    ["billing history still loading (null is not confirmed-empty)", {
      principalId: "user-1",
      billingDataPrincipalId: "user-1",
      summary: eligibleSummary(),
      hasBillingHistory: null,
      now: NOW,
    }, false],
    ["account has payment or subscription history", {
      principalId: "user-1",
      billingDataPrincipalId: "user-1",
      summary: eligibleSummary(),
      hasBillingHistory: true,
      now: NOW,
    }, false],
    ["confirmed eligible account", {
      principalId: "user-1",
      billingDataPrincipalId: "user-1",
      summary: eligibleSummary(),
      hasBillingHistory: false,
      now: NOW,
    }, true],
    ["prior, expired, or converted trial in history", {
      principalId: "user-1",
      billingDataPrincipalId: "user-1",
      summary: priorTrialSummary(),
      hasBillingHistory: false,
      now: NOW,
    }, false],
    ["active paid subscription", {
      principalId: "user-1",
      billingDataPrincipalId: "user-1",
      summary: paidSubscriptionSummary(),
      hasBillingHistory: false,
      now: NOW,
    }, false],
    ["grant-backed plan access without billing history", {
      principalId: "user-1",
      billingDataPrincipalId: "user-1",
      summary: grantBackedSummary(),
      hasBillingHistory: false,
      now: NOW,
    }, false],
    ["trial already active", {
      principalId: "user-1",
      billingDataPrincipalId: "user-1",
      summary: activeTrialSummary(),
      hasBillingHistory: false,
      now: NOW,
    }, false],
    ["missing principal even with otherwise clean state", {
      principalId: null,
      billingDataPrincipalId: null,
      summary: eligibleSummary(),
      hasBillingHistory: false,
      now: NOW,
    }, false],
  ];

  it.each(cases)("%s", (_label, state, expected) => {
    expect(canStartTeamTrialForPrincipal(state)).toBe(expected);
  });

  it("keeps an active trial on the management path regardless of history shape", () => {
    const state = {
      principalId: "user-1",
      billingDataPrincipalId: "user-1",
      summary: activeTrialSummary(),
      hasBillingHistory: false,
      now: NOW,
    };

    const activeTrial = getActiveAgentTrial(state.summary, state.now);
    expect(activeTrial).toMatchObject({ planId: "team" });
    expect(activeTrial?.timeRemainingLabel).not.toBe("Trial ended");
    expect(canStartTeamTrialForPrincipal(state)).toBe(false);
  });
});
