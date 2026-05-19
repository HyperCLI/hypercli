import { describe, expect, it } from "vitest";

import {
  deriveLaunchEligibilityState,
  deriveLaunchSources,
  getEffectivePlanIdFromSummary,
  getLaunchSlotInventoryFromSummary,
  hasLaunchEntitlementSlots,
  mergeLaunchSlotInventories,
} from "./agent-launch-state";

describe("agent launch state", () => {
  it("normalizes slot inventory by taking the highest count per tier field", () => {
    expect(
      mergeLaunchSlotInventories(
        {
          large: { granted: 1, used: 0, available: 0 },
        },
        {
          large: { granted: 0, used: 1, available: 1 },
          medium: { granted: 2, used: 1, available: 1 },
        },
      ),
    ).toEqual({
      large: { granted: 1, used: 1, available: 1 },
      medium: { granted: 2, used: 1, available: 1 },
    });
  });

  it("merges nested and top-level slot inventory", () => {
    expect(
      getLaunchSlotInventoryFromSummary({
        slotInventory: {
          large: { granted: 1, used: 0, available: 1 },
        },
        entitlements: {
          slotInventory: {
            medium: { granted: 1, used: 0, available: 1 },
          },
        },
      } as any),
    ).toEqual({
      large: { granted: 1, used: 0, available: 1 },
      medium: { granted: 1, used: 0, available: 1 },
    });
  });

  it("reads nested effective plan ids", () => {
    expect(
      getEffectivePlanIdFromSummary({
        effectivePlanId: "",
        entitlements: {
          effectivePlanId: "catalog-pro",
        },
      } as any),
    ).toBe("catalog-pro");
  });

  it("reports whether any launch entitlement slots are granted", () => {
    expect(hasLaunchEntitlementSlots(null)).toBe(false);
    expect(
      hasLaunchEntitlementSlots({
        entitlements: {
          slotInventory: {
            medium: { granted: 1, used: 1, available: 0 },
          },
        },
      } as any),
    ).toBe(true);
  });

  it("derives loading and catalog-only states", () => {
    expect(
      deriveLaunchEligibilityState({
        subscriptionSummary: null,
        slotInventory: null,
        budgetLoaded: false,
      }).status,
    ).toBe("loading");

    expect(
      deriveLaunchEligibilityState({
        subscriptionSummary: null,
        slotInventory: {},
        budgetLoaded: true,
      }),
    ).toMatchObject({
      status: "catalog-only",
      sources: [],
      totalAvailableSlots: 0,
      totalGrantedSlots: 0,
    });
  });

  it("derives a ready state from direct entitlement inventory without subscriptions", () => {
    const state = deriveLaunchEligibilityState({
      subscriptionSummary: {
        effectivePlanId: "",
        activeSubscriptions: [],
      } as any,
      slotInventory: {
        large: { granted: 1, used: 0, available: 1 },
      },
      budgetLoaded: true,
    });

    expect(state.status).toBe("ready");
    expect(state.launchableTiers).toEqual(["large"]);
    expect(state.sources).toEqual([
      expect.objectContaining({
        kind: "inventory",
        tierIds: ["large"],
        availableCount: 1,
      }),
    ]);
  });

  it("derives subscription sources with slot summaries and quantities", () => {
    expect(
      deriveLaunchSources({
        subscriptionSummary: {
          activeSubscriptions: [
            {
              id: "sub-1",
              planId: "team-launch",
              planName: "Team Launch",
              quantity: 2,
              slotGrants: { medium: 1, small: 1 },
            },
          ],
        } as any,
        slotInventory: {
          medium: { granted: 1, used: 0, available: 1 },
          small: { granted: 1, used: 1, available: 0 },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        id: "sub-1",
        kind: "subscription",
        quantity: 2,
        tierIds: ["medium", "small"],
        slotSummary: "1 medium + 1 small",
        statusLabel: "1 launchable slot",
      }),
    ]);
  });

  it("derives direct activation-code entitlement sources", () => {
    expect(
      deriveLaunchSources({
        subscriptionSummary: {
          activeSubscriptions: [],
          entitlementItems: [
            {
              id: "ent-1",
              subscriptionId: null,
              planId: "catalog-pro",
              planName: "Pro",
              slotGrants: { large: 1 },
            },
          ],
        } as any,
        slotInventory: {
          large: { granted: 1, used: 0, available: 1 },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        id: "ent-1",
        kind: "direct-entitlement",
        planName: "Pro",
        tierIds: ["large"],
        statusLabel: "1 launchable slot",
      }),
    ]);
  });

  it("deduplicates direct entitlement arrays and skips subscription-backed entitlements", () => {
    expect(
      deriveLaunchSources({
        subscriptionSummary: {
          activeSubscriptions: [],
          entitlementItems: [
            {
              id: "ent-1",
              subscriptionId: null,
              planId: "catalog-pro",
              planName: "Pro",
              slotGrants: { large: 1 },
            },
            {
              id: "ent-sub-backed",
              subscriptionId: "sub-1",
              planId: "team",
              planName: "Team",
              slotGrants: { medium: 1 },
            },
          ],
          activeEntitlements: [
            {
              id: "ent-1",
              subscriptionId: null,
              planId: "catalog-pro",
              planName: "Pro",
              slotGrants: { large: 1 },
            },
          ],
        } as any,
        slotInventory: {
          large: { granted: 1, used: 0, available: 1 },
          medium: { granted: 1, used: 0, available: 1 },
        },
      }),
    ).toEqual([
      expect.objectContaining({
        id: "ent-1",
        kind: "direct-entitlement",
        tierIds: ["large"],
      }),
    ]);
  });

  it("can disable inventory fallback sources", () => {
    expect(
      deriveLaunchSources({
        subscriptionSummary: {
          activeSubscriptions: [],
        } as any,
        slotInventory: {
          large: { granted: 1, used: 0, available: 1 },
        },
        includeInventorySources: false,
      }),
    ).toEqual([]);
  });

  it("distinguishes provisioning, exhausted, and releasing launch states", () => {
    const subscriptionSummary = {
      activeSubscriptions: [
        {
          id: "sub-1",
          planId: "team",
          planName: "Team",
          slotGrants: { medium: 1 },
          quantity: 1,
        },
      ],
    } as any;

    expect(
      deriveLaunchEligibilityState({
        subscriptionSummary,
        slotInventory: {},
        budgetLoaded: true,
      }).status,
    ).toBe("waiting-entitlement");

    expect(
      deriveLaunchEligibilityState({
        subscriptionSummary,
        slotInventory: {
          medium: { granted: 1, used: 1, available: 0 },
        },
        budgetLoaded: true,
      }).status,
    ).toBe("exhausted");

    expect(
      deriveLaunchEligibilityState({
        subscriptionSummary,
        slotInventory: {
          medium: { granted: 1, used: 1, available: 0 },
        },
        pendingSlotReleases: { medium: 1 },
        budgetLoaded: true,
      }).status,
    ).toBe("releasing");
  });

  it("marks sources as releasing when no slots are available but release polling is active", () => {
    expect(
      deriveLaunchSources({
        subscriptionSummary: {
          activeSubscriptions: [
            {
              id: "sub-1",
              planId: "team",
              planName: "Team",
              slotGrants: { medium: 1 },
            },
          ],
        } as any,
        slotInventory: {
          medium: { granted: 1, used: 1, available: 0 },
        },
        pendingSlotReleases: { medium: 1 },
      }),
    ).toEqual([
      expect.objectContaining({
        statusLabel: "Releasing slot",
      }),
    ]);
  });
});
