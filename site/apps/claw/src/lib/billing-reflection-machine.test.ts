import { describe, expect, it } from "vitest";

import {
  billingReflectionReducer,
  checkoutSyncBannerFromBillingState,
  initialBillingReflectionState,
} from "./billing-reflection-machine";

describe("billing reflection machine", () => {
  it("starts idle and produces no banner", () => {
    expect(checkoutSyncBannerFromBillingState(initialBillingReflectionState)).toBeNull();
  });

  it("transitions from syncing to ready", () => {
    const pending = { principalId: "user-1", planId: "pro", planName: "Pro", ownedCount: 0, startedAt: 1 };
    const syncing = billingReflectionReducer(initialBillingReflectionState, {
      type: "SYNC_STARTED",
      pending,
      message: "Payment received. Finalizing Pro plan setup...",
    });

    expect(checkoutSyncBannerFromBillingState(syncing)).toEqual({
      status: "syncing",
      message: "Payment received. Finalizing Pro plan setup...",
    });

    expect(
      checkoutSyncBannerFromBillingState(
        billingReflectionReducer(syncing, {
          type: "REFLECTION_RECEIVED",
          pending,
          reflectionStatus: "ready",
        }),
      ),
    ).toEqual({
      status: "success",
      message: "Pro is active. Agent slots and limits are updated.",
    });
  });

  it("uses a generic success message when there is no pending checkout", () => {
    expect(
      checkoutSyncBannerFromBillingState(
        billingReflectionReducer(initialBillingReflectionState, {
          type: "REFLECTION_RECEIVED",
          pending: null,
          reflectionStatus: "ready",
        }),
      ),
    ).toEqual({
      status: "success",
      message: "Your plan is active. Agent slots and limits are updated.",
    });
  });

  it("models waiting-payment as a pending billing state", () => {
    const pending = { principalId: "user-1", planId: "pro", planName: "Pro", ownedCount: 0, startedAt: 1 };

    expect(
      billingReflectionReducer(initialBillingReflectionState, {
        type: "REFLECTION_RECEIVED",
        pending,
        reflectionStatus: "waiting-payment",
      }),
    ).toMatchObject({
      status: "pending",
      reason: "waiting-payment",
      message: "Payment succeeded. Billing is still updating, so this page will keep showing the latest plan data.",
    });
  });

  it("models entitlement provisioning and cancellation", () => {
    const pending = { principalId: "user-1", planId: "pro", planName: "Pro", ownedCount: 0, startedAt: 1 };

    expect(
      billingReflectionReducer(initialBillingReflectionState, {
        type: "REFLECTION_RECEIVED",
        pending,
        reflectionStatus: "waiting-entitlement",
      }),
    ).toMatchObject({
      status: "pending",
      reason: "waiting-entitlement",
    });

    expect(
      checkoutSyncBannerFromBillingState(
        billingReflectionReducer(initialBillingReflectionState, { type: "CHECKOUT_CANCELLED" }),
      ),
    ).toEqual({
      status: "cancelled",
      message: "Checkout cancelled. No plan changes were made.",
    });
  });

  it("dismisses any visible state back to idle", () => {
    const pending = { principalId: "user-1", planId: "pro", planName: "Pro", ownedCount: 0, startedAt: 1 };
    const syncing = billingReflectionReducer(initialBillingReflectionState, {
      type: "SYNC_STARTED",
      pending,
      message: "Refreshing Pro entitlements from billing...",
    });

    expect(billingReflectionReducer(syncing, { type: "DISMISS" })).toEqual(initialBillingReflectionState);
  });
});
