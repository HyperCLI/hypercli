import { beforeEach, describe, expect, it } from "vitest";

import {
  checkoutReflectedInSummary,
  getAvailableLaunchSlotCountFromSummary,
  getCheckoutReflectionStatus,
  getCheckoutOwnedCountFromSummary,
  getEffectivePlanName,
  getGrantedLaunchSlotCountFromSummary,
  getPlanOwnedCountFromSummary,
  markPendingPlanCheckoutReturned,
  readPendingPlanCheckout,
  readStripeCheckoutReturnState,
  writePendingPlanCheckout,
} from "./plan-checkout-state";

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

  it("requires Stripe's returned session id before accepting success", () => {
    window.history.replaceState(null, "", "/plans?checkout=success");
    expect(readStripeCheckoutReturnState()).toBeNull();

    window.history.replaceState(null, "", "/plans?checkout=success&session_id=cs_123");
    expect(readStripeCheckoutReturnState()).toEqual({ status: "success", sessionId: "cs_123" });
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
