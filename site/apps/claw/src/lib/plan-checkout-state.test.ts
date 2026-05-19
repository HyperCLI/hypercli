import { describe, expect, it } from "vitest";

import {
  checkoutReflectedInSummary,
  getAvailableLaunchSlotCountFromSummary,
  getCheckoutReflectionStatus,
  getEffectivePlanName,
  getGrantedLaunchSlotCountFromSummary,
  getPlanOwnedCountFromSummary,
} from "./plan-checkout-state";

describe("plan checkout state", () => {
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
    const pending = { planId: "catalog-pro", planName: "Pro", ownedCount: 0, startedAt: 1 };

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

  it("reports checkout reflected only when launch slots are ready", () => {
    const pending = { planId: "catalog-pro", planName: "Pro", ownedCount: 0, startedAt: 1 };

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
