import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  catalogPlanOffersTeamTrial,
  checkoutReflectedInSummary,
  clearPendingPlanCheckout,
  createTeamTrialCheckoutState,
  getAvailableLaunchSlotCountFromSummary,
  getCheckoutReflectionStatus,
  getCheckoutOwnedCountFromSummary,
  getEffectivePlanName,
  getGrantedLaunchSlotCountFromSummary,
  getPlanOwnedCountFromSummary,
  getTeamTrialEligibility,
  isTeamTrialCheckoutFlow,
  markPendingPlanCheckoutReturned,
  readPendingPlanCheckout,
  readStripeCheckoutReturnState,
  summaryCanStartTeamTrial,
  writePendingPlanCheckout,
} from "./plan-checkout-state";

function pendingCheckoutStorageKey(principalId: string): string {
  return `hyperclaw.pendingPlanCheckout.v1:${encodeURIComponent(principalId)}`;
}

describe("plan checkout state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/plans");
  });

  it("scopes pending checkout state to the initiating account", () => {
    writePendingPlanCheckout({
      principalId: "user-1",
      planId: "pro",
      planName: "Pro",
      ownedCount: 1,
      startedAt: 1,
      checkoutSessionId: "cs_123",
    });

    expect(readPendingPlanCheckout("user-2")).toBeNull();
    expect(markPendingPlanCheckoutReturned("user-2", "cs_wrong")).toBeNull();
    expect(markPendingPlanCheckoutReturned("user-1", "cs_123")?.returnSessionId).toBe("cs_123");

    writePendingPlanCheckout({
      principalId: "user-2",
      planId: "starter",
      planName: "Starter",
      ownedCount: 0,
      startedAt: 2,
    });
    expect(readPendingPlanCheckout("user-1")?.planId).toBe("pro");
    expect(readPendingPlanCheckout("user-2")?.planId).toBe("starter");
  });

  it("round-trips first-agent launch correlation without applying it to generic checkout", () => {
    writePendingPlanCheckout({
      principalId: "user-1",
      planId: "pro",
      planName: "Pro",
      ownedCount: 0,
      startedAt: 1,
      flow: "first-agent-setup",
      setupId: "setup-1",
      workspaceId: "workspace-1",
      knowledgeCollectionId: "collection-1",
      agentSize: "large",
    });

    expect(readPendingPlanCheckout("user-1")).toMatchObject({
      flow: "first-agent-setup",
      setupId: "setup-1",
      workspaceId: "workspace-1",
      knowledgeCollectionId: "collection-1",
      agentSize: "large",
    });
    expect(readPendingPlanCheckout("user-1")).not.toHaveProperty("knowledgeDomainId");
    expect(JSON.parse(window.localStorage.getItem(pendingCheckoutStorageKey("user-1")) ?? "null")).toMatchObject({
      knowledgeCollectionId: "collection-1",
      knowledgeDomainId: "collection-1",
    });

    writePendingPlanCheckout({
      principalId: "user-2",
      planId: "pro",
      planName: "Pro",
      ownedCount: 0,
      startedAt: 1,
    });
    expect(readPendingPlanCheckout("user-2")).not.toHaveProperty("flow");
  });

  it("falls back to a legacy checkout knowledgeDomainId identifier", () => {
    window.localStorage.setItem(pendingCheckoutStorageKey("user-1"), JSON.stringify({
      principalId: "user-1",
      planId: "pro",
      planName: "Pro",
      ownedCount: 0,
      startedAt: 1,
      flow: "first-agent-setup",
      setupId: "setup-1",
      knowledgeDomainId: "legacy-collection",
      agentSize: "large",
    }));

    const pending = readPendingPlanCheckout("user-1");
    expect(pending?.knowledgeCollectionId).toBe("legacy-collection");
    expect(pending).not.toHaveProperty("knowledgeDomainId");
  });

  it("prefers the canonical checkout knowledge Collection identifier", () => {
    window.localStorage.setItem(pendingCheckoutStorageKey("user-1"), JSON.stringify({
      principalId: "user-1",
      planId: "pro",
      planName: "Pro",
      ownedCount: 0,
      startedAt: 1,
      flow: "first-agent-trial",
      setupId: "setup-1",
      knowledgeCollectionId: "collection-new",
      knowledgeDomainId: "collection-old",
      agentSize: "large",
    }));

    const pending = readPendingPlanCheckout("user-1");
    expect(pending?.knowledgeCollectionId).toBe("collection-new");
    expect(pending).not.toHaveProperty("knowledgeDomainId");
  });

  it("round-trips a Team trial checkout flow", () => {
    writePendingPlanCheckout({
      principalId: "user-1",
      planId: "team",
      planName: "Team",
      ownedCount: 0,
      startedAt: 1,
      flow: "team-trial",
    });

    expect(readPendingPlanCheckout("user-1")).toMatchObject({
      planId: "team",
      flow: "team-trial",
    });
  });

  it("keeps concurrent checkout attempts isolated for the same account", () => {
    const first = {
      principalId: "user-1",
      planId: "solo",
      planName: "Solo",
      ownedCount: 0,
      startedAt: 1,
      checkoutAttemptId: "attempt-1",
      checkoutSessionId: "cs_1",
    };
    const second = {
      principalId: "user-1",
      planId: "team",
      planName: "Team",
      ownedCount: 0,
      startedAt: 2,
      checkoutAttemptId: "attempt-2",
      checkoutSessionId: "cs_2",
    };

    writePendingPlanCheckout(first);
    writePendingPlanCheckout(second);

    expect(readPendingPlanCheckout("user-1")?.planId).toBe("team");
    expect(readPendingPlanCheckout("user-1", {
      sessionId: "cs_1",
      attemptId: "attempt-1",
    })).toMatchObject(first);
    expect(readPendingPlanCheckout("user-1", {
      sessionId: "cs_1",
      attemptId: "attempt-2",
    })).toBeNull();

    const returned = markPendingPlanCheckoutReturned("user-1", "cs_1", "attempt-1");
    expect(returned).toMatchObject({ ...first, returnSessionId: "cs_1" });
    expect(readPendingPlanCheckout("user-1")).toMatchObject({
      planId: "solo",
      returnSessionId: "cs_1",
    });

    clearPendingPlanCheckout("user-1", returned);
    expect(readPendingPlanCheckout("user-1", {
      sessionId: "cs_1",
      attemptId: "attempt-1",
    })).toBeNull();
    expect(readPendingPlanCheckout("user-1")).toMatchObject(second);
  });

  it("recovers a legacy session-only Stripe return without weakening attempt matching", () => {
    writePendingPlanCheckout({
      principalId: "user-1",
      planId: "pro",
      planName: "Pro",
      ownedCount: 0,
      startedAt: 1,
    });

    expect(readPendingPlanCheckout("user-1", { sessionId: "cs_legacy" })).toMatchObject({
      planId: "pro",
    });
    expect(readPendingPlanCheckout("user-1", { attemptId: "attempt-unknown" })).toBeNull();
    expect(readPendingPlanCheckout("user-1", {
      sessionId: "cs_legacy",
      attemptId: "attempt-unknown",
    })).toBeNull();
    expect(markPendingPlanCheckoutReturned("user-1", "cs_legacy")).toMatchObject({
      checkoutSessionId: "cs_legacy",
      returnSessionId: "cs_legacy",
    });
  });

  it("creates a Team trial checkout without querying the plan catalog", async () => {
    const client = {
      startTrial: vi.fn().mockResolvedValue({
        checkoutUrl: "https://checkout.stripe.com/trial",
        checkoutSessionId: null,
        checkoutAttemptId: null,
      }),
      plans: vi.fn().mockRejectedValue(new Error("catalog unavailable")),
    };

    const result = await createTeamTrialCheckoutState(
      client,
      { successUrl: "https://agents.example/success", cancelUrl: "https://agents.example/cancel" },
      { principalId: "user-1", summary: null, startedAt: 10 },
    );

    expect(client.startTrial).toHaveBeenCalledOnce();
    expect(client.startTrial).toHaveBeenCalledWith({
      successUrl: "https://agents.example/success",
      cancelUrl: "https://agents.example/cancel",
    });
    expect(client.plans).not.toHaveBeenCalled();
    expect(result.pending).toMatchObject({
      principalId: "user-1",
      planId: "team",
      planName: "Team",
      ownedCount: 0,
      startedAt: 10,
      flow: "team-trial",
    });
    expect(result.pending).not.toHaveProperty("bundle");
    expect(result.pending).not.toHaveProperty("baselineGrantedSlots");
  });

  it("uses already-loaded Team catalog data only to enrich pending checkout state", async () => {
    const client = {
      startTrial: vi.fn().mockResolvedValue({
        checkoutUrl: "https://checkout.stripe.com/trial",
        checkoutSessionId: "cs_trial",
        checkoutAttemptId: "attempt-original",
      }),
    };

    const result = await createTeamTrialCheckoutState(
      client,
      {},
      {
        principalId: "user-1",
        summary: {
          activeSubscriptions: [],
          entitlements: {
            slotInventory: { medium: { granted: 1, used: 0, available: 1 } },
          },
        } as any,
        catalogProduct: { name: "Team Display Name", bundle: { medium: 3 } },
        checkoutAttemptId: "attempt-trial",
        startedAt: 10,
      },
    );

    expect(result.pending).toMatchObject({
      planId: "team",
      planName: "Team Display Name",
      bundle: { medium: 3 },
      baselineGrantedSlots: { medium: 1 },
      checkoutAttemptId: "attempt-original",
      checkoutSessionId: "cs_trial",
    });
  });

  it("preserves first-agent setup through a Team trial checkout", async () => {
    const client = {
      startTrial: vi.fn().mockResolvedValue({
        checkoutUrl: "https://checkout.stripe.com/trial",
        checkoutSessionId: null,
        checkoutAttemptId: null,
      }),
    };
    const result = await createTeamTrialCheckoutState(
      client,
      {},
      {
        principalId: "user-1",
        summary: null,
        catalogProduct: { name: "Team", bundle: { medium: 3 } },
        firstAgentSetup: {
          setupId: "setup-1",
          workspaceId: "workspace-1",
          knowledgeCollectionId: "collection-1",
          agentSize: "medium",
        },
        startedAt: 10,
      },
    );

    expect(result.pending).toMatchObject({
      flow: "first-agent-trial",
      setupId: "setup-1",
      workspaceId: "workspace-1",
      knowledgeCollectionId: "collection-1",
      agentSize: "medium",
      bundle: { medium: 3 },
    });
    expect(isTeamTrialCheckoutFlow(result.pending)).toBe(true);

    writePendingPlanCheckout(result.pending);
    expect(readPendingPlanCheckout("user-1")).toMatchObject(result.pending);
  });

  it("offers the trial only on an unowned Team catalog card", () => {
    expect(catalogPlanOffersTeamTrial("team", 0, true)).toBe(true);
    expect(catalogPlanOffersTeamTrial("TEAM", 0, true)).toBe(true);
    expect(catalogPlanOffersTeamTrial("team", 1, true)).toBe(false);
    expect(catalogPlanOffersTeamTrial("pro", 0, true)).toBe(false);
    expect(catalogPlanOffersTeamTrial("team", 0, false)).toBe(false);
  });

  it("requires Stripe's returned session id before accepting success", () => {
    window.history.replaceState(null, "", "/plans?checkout=success");
    expect(readStripeCheckoutReturnState()).toBeNull();

    window.history.replaceState(null, "", "/plans?checkout=success&session_id=cs_123");
    expect(readStripeCheckoutReturnState()).toEqual({
      status: "success",
      sessionId: "cs_123",
      attemptId: null,
    });
  });

  it("counts owned plans from nested direct entitlement summaries", () => {
    const summary = {
      effectivePlanId: "",
      activeSubscriptions: [],
      activeEntitlementCount: 1,
      entitlements: {
        effectivePlanId: "catalog-pro",
        activeEntitlementCount: 1,
        slotInventory: {
          large: { granted: 1, used: 0, available: 1 },
        },
      },
    };

    expect(getPlanOwnedCountFromSummary(summary as any, "catalog-pro")).toBe(1);
  });

  it("counts available and granted launch slots across top-level and nested inventories", () => {
    const summary = {
      slotInventory: {
        large: { granted: 1, used: 0, available: 1 },
      },
      entitlements: {
        slotInventory: {
          medium: { granted: 2, used: 1, available: 1 },
        },
      },
    };

    expect(getGrantedLaunchSlotCountFromSummary(summary as any)).toBe(3);
    expect(getAvailableLaunchSlotCountFromSummary(summary as any)).toBe(2);
  });

  it("classifies checkout reflection states", () => {
    const pending = { principalId: "user-1", planId: "catalog-pro", planName: "Pro", ownedCount: 0, startedAt: 1 };

    expect(getCheckoutReflectionStatus(null, pending)).toBe("waiting-payment");
    expect(
      getCheckoutReflectionStatus({
        effectivePlanId: "catalog-pro",
        activeSubscriptions: [],
        activeEntitlementCount: 1,
        entitlements: {
          activeEntitlementCount: 1,
          slotInventory: {},
        },
      } as any, pending),
    ).toBe("waiting-entitlement");
    expect(
      getCheckoutReflectionStatus({
        effectivePlanId: "catalog-pro",
        activeSubscriptions: [],
        activeEntitlementCount: 1,
        entitlements: {
          activeEntitlementCount: 1,
          slotInventory: {
            large: { granted: 1, used: 0, available: 1 },
          },
        },
      } as any, pending),
    ).toBe("ready");
  });

  it("does not reflect a Team trial from Team capacity without an active trial", () => {
    const pending = {
      principalId: "user-1",
      planId: "team",
      planName: "Team",
      bundle: { medium: 1 },
      baselineGrantedSlots: { medium: 0 },
      ownedCount: 0,
      startedAt: 1,
      flow: "team-trial" as const,
    };
    const summary = {
      effectivePlanId: "team",
      activeSubscriptionCount: 1,
      activeEntitlementCount: 1,
      activeSubscriptions: [{
        id: "sub-team",
        planId: "team",
        quantity: 1,
        trial: null,
      }],
      subscriptions: [],
      entitlements: {
        activeEntitlementCount: 1,
        slotInventory: { medium: { granted: 1, used: 0, available: 1 } },
      },
    } as any;

    expect(getCheckoutReflectionStatus(summary, pending)).toBe("waiting-payment");
  });

  it("reflects a matching active Team trial once its slots are ready", () => {
    const pending = {
      principalId: "user-1",
      planId: "team",
      planName: "Team",
      bundle: { medium: 1 },
      baselineGrantedSlots: { medium: 0 },
      ownedCount: 0,
      startedAt: 1,
      flow: "team-trial" as const,
    };
    const summary = {
      effectivePlanId: "team",
      activeSubscriptionCount: 1,
      activeEntitlementCount: 1,
      activeSubscriptions: [{
        id: "sub-team",
        planId: "team",
        quantity: 1,
        trial: {
          active: true,
          days: 7,
          startsAt: new Date("2026-08-06T00:00:00Z"),
          endsAt: new Date("2026-08-13T00:00:00Z"),
          secondsRemaining: 604_800,
        },
        slotGrants: { medium: 1 },
      }],
      subscriptions: [],
      entitlements: {
        activeEntitlementCount: 1,
        slotInventory: { medium: { granted: 1, used: 0, available: 1 } },
      },
    } as any;

    expect(getCheckoutReflectionStatus(summary, pending)).toBe("ready");
  });

  it("waits for slots on the trial subscription instead of accepting unrelated capacity", () => {
    const pending = {
      principalId: "user-1",
      planId: "team",
      planName: "Team",
      ownedCount: 0,
      startedAt: 1,
      flow: "team-trial" as const,
    };
    const summary = {
      effectivePlanId: "team",
      activeSubscriptionCount: 1,
      activeEntitlementCount: 2,
      activeSubscriptions: [{
        id: "sub-team-trial",
        planId: "team",
        quantity: 1,
        slotGrants: {},
        meta: { checkout_bundle: { medium: 3 } },
        trial: {
          active: true,
          endsAt: new Date("2026-08-13T00:00:00Z"),
          secondsRemaining: 604_800,
        },
      }],
      subscriptions: [],
      entitlements: {
        activeEntitlementCount: 2,
        slotInventory: { large: { granted: 1, used: 0, available: 1 } },
      },
    } as any;

    expect(getCheckoutReflectionStatus(summary, pending)).toBe("waiting-entitlement");
  });

  it("accepts trial slots from matching top-level entitlement details", () => {
    const pending = {
      principalId: "user-1",
      planId: "team",
      planName: "Team",
      bundle: { medium: 3 },
      ownedCount: 0,
      startedAt: 1,
      flow: "team-trial" as const,
    };
    const summary = {
      activeSubscriptions: [{
        id: "sub-team-trial",
        planId: "team",
        slotGrants: null,
        agentSlots: [],
        trial: { active: true },
      }],
      subscriptions: [],
      entitlementItems: [{
        id: "ent-team-trial",
        subscriptionId: "sub-team-trial",
        status: "ACTIVE",
        slotGrants: { medium: 3 },
        agentSlots: [],
      }],
    } as any;

    expect(getCheckoutReflectionStatus(summary, pending)).toBe("ready");
  });

  it("accepts provisioned trial slots when unrelated baseline slots expire during checkout", () => {
    const pending = {
      principalId: "user-1",
      planId: "team",
      planName: "Team",
      ownedCount: 0,
      startedAt: 1,
      flow: "team-trial" as const,
      bundle: { medium: 3 },
      baselineGrantedSlots: { medium: 1 },
    };
    const summary = {
      effectivePlanId: "team",
      activeSubscriptionCount: 1,
      activeEntitlementCount: 1,
      activeSubscriptions: [{
        id: "sub-team-trial",
        planId: "team",
        quantity: 1,
        slotGrants: { medium: 3 },
        trial: {
          active: true,
          endsAt: new Date("2026-08-13T00:00:00Z"),
          secondsRemaining: 604_800,
        },
      }],
      subscriptions: [],
      entitlements: {
        activeEntitlementCount: 1,
        slotInventory: { medium: { granted: 3, used: 0, available: 3 } },
      },
    } as any;

    expect(getCheckoutReflectionStatus(summary, pending)).toBe("ready");
  });

  it("offers the Team trial only when every subscription view confirms no history", () => {
    expect(summaryCanStartTeamTrial({
      subscriptions: [],
      activeSubscriptions: [],
      activeSubscriptionCount: 0,
    } as any)).toBe(true);
    expect(summaryCanStartTeamTrial({
      subscriptions: [],
      activeSubscriptions: [{ id: "sub-paid" }],
      activeSubscriptionCount: 1,
    } as any)).toBe(false);
    expect(summaryCanStartTeamTrial(null)).toBe(false);
  });

  it("resolves Team trial eligibility across the eligibility categories", () => {
    const eligibleSummary = {
      subscriptions: [],
      activeSubscriptions: [],
      activeSubscriptionCount: 0,
    } as any;
    // An ended or converted trial remains in subscription history even though it
    // is no longer active, so the history check must reject a restart.
    const priorTrialSummary = {
      subscriptions: [{
        id: "sub-team-trial",
        planId: "team",
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
    } as any;
    const paidSummary = {
      subscriptions: [],
      activeSubscriptions: [{ id: "sub-pro", planId: "pro", isCurrent: true }],
      activeSubscriptionCount: 1,
    } as any;
    const grantBackedSummary = {
      // Activation-code grants carry no subscription or payment history.
      subscriptions: [],
      activeSubscriptions: [],
      activeSubscriptionCount: 0,
      activeEntitlementCount: 1,
    } as any;

    const cases: Array<[
      string,
      string | null | undefined,
      string | null | undefined,
      any,
      "loading" | "eligible" | "ineligible",
    ]> = [
      ["clean summary for the current principal", "user-1", "user-1", eligibleSummary, "eligible"],
      ["summary still loading (principal marker unset)", "user-1", null, null, "loading"],
      ["billing error reset the principal marker", "user-1", null, eligibleSummary, "loading"],
      ["billing data belongs to another principal", "user-1", "user-2", eligibleSummary, "loading"],
      ["missing principal", null, null, eligibleSummary, "loading"],
      ["undefined principal", undefined, undefined, eligibleSummary, "loading"],
      ["prior, expired, or converted trial history", "user-1", "user-1", priorTrialSummary, "ineligible"],
      ["active paid subscription", "user-1", "user-1", paidSummary, "ineligible"],
      ["subscription history in the non-active view", "user-1", "user-1", {
        ...eligibleSummary,
        subscriptions: [{ id: "sub-previous" }],
      }, "ineligible"],
      ["grant-backed access (history check alone would pass)", "user-1", "user-1", grantBackedSummary, "eligible"],
    ];

    for (const [label, principalId, billingDataPrincipalId, summary, expected] of cases) {
      expect(getTeamTrialEligibility(principalId, billingDataPrincipalId, summary), label).toBe(expected);
    }
  });

  it("uses equivalent bundles for both checkout baseline and reflection", () => {
    const summary = {
      activeSubscriptions: [{
        id: "sub-1",
        planId: "legacy-pro",
        quantity: 2,
        meta: { checkout_bundle: { large: 1 } },
      }],
      entitlements: {
        slotInventory: { large: { granted: 2, used: 0, available: 2 } },
      },
    } as any;
    const pending = {
      principalId: "user-1",
      planId: "pro",
      planName: "Pro",
      bundle: { large: 1 },
      ownedCount: 1,
      startedAt: 1,
    };

    expect(getCheckoutOwnedCountFromSummary(summary, pending)).toBe(2);
    expect(getCheckoutReflectionStatus(summary, pending)).toBe("ready");
  });

  it("waits for additive checkout slots to exceed the pre-checkout inventory", () => {
    const pending = {
      principalId: "user-1",
      planId: "pro",
      planName: "Pro",
      bundle: { large: 1 },
      ownedCount: 1,
      baselineGrantedSlots: { large: 1 },
      startedAt: 1,
    };
    const summary = (granted: number) => ({
      activeSubscriptions: [{ id: "sub-1", planId: "pro", quantity: 2 }],
      entitlements: {
        slotInventory: { large: { granted, used: 0, available: granted } },
      },
    }) as any;

    expect(getCheckoutReflectionStatus(summary(1), pending)).toBe("waiting-entitlement");
    expect(getCheckoutReflectionStatus(summary(2), pending)).toBe("ready");
  });

  it("reports checkout reflected only when launch slots are ready", () => {
    const pending = { principalId: "user-1", planId: "catalog-pro", planName: "Pro", ownedCount: 0, startedAt: 1 };

    expect(
      checkoutReflectedInSummary({
        effectivePlanId: "catalog-pro",
        activeSubscriptions: [],
        activeEntitlementCount: 1,
        entitlements: {
          activeEntitlementCount: 1,
          slotInventory: {
            large: { granted: 1, used: 0, available: 1 },
          },
        },
      } as any, pending),
    ).toBe(true);
  });

  it("gets effective plan names from nested entitlement ids", () => {
    expect(
      getEffectivePlanName(
        {
          effectivePlanId: "",
          activeSubscriptions: [],
          entitlements: {
            effectivePlanId: "catalog-pro",
          },
        } as any,
        null,
        [{ id: "catalog-pro", name: "Pro" } as any],
      ),
    ).toBe("Pro");
  });
});
