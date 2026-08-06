import { describe, expect, it } from "vitest";

import {
  countPendingSlotReleasesByTier,
  markPendingSlotReleaseComplete,
  reconcileCompletedSlotReleases,
  registerPendingSlotRelease,
  type PendingSlotReleaseMap,
} from "./pendingSlotReleases";

describe("pending slot release reconciliation", () => {
  it("retains an event snapshot that arrives before the delete response", () => {
    const pending: PendingSlotReleaseMap = new Map();
    registerPendingSlotRelease(pending, "agent-1:large", "large");

    expect(reconcileCompletedSlotReleases(pending, 4)).toBe(false);
    expect(countPendingSlotReleasesByTier(pending)).toEqual({ large: 1 });

    expect(markPendingSlotReleaseComplete(pending, "agent-1:large", 5)).toBe(true);
    expect(reconcileCompletedSlotReleases(pending, 4)).toBe(false);
    expect(reconcileCompletedSlotReleases(pending, 5)).toBe(true);
    expect(countPendingSlotReleasesByTier(pending)).toEqual({});
  });

  it("clears by completed release identity regardless of aggregate slot reuse", () => {
    const pending: PendingSlotReleaseMap = new Map();
    registerPendingSlotRelease(pending, "deleted-agent:medium", "medium");
    registerPendingSlotRelease(pending, "still-deleting:medium", "medium");
    markPendingSlotReleaseComplete(pending, "deleted-agent:medium", 8);

    // Reconciliation deliberately receives no aggregate inventory. A
    // concurrent launch may make before/after totals identical even though the
    // identified delete committed successfully.
    expect(reconcileCompletedSlotReleases(pending, 8)).toBe(true);
    expect([...pending.keys()]).toEqual(["still-deleting:medium"]);
    expect(countPendingSlotReleasesByTier(pending)).toEqual({ medium: 1 });
  });

  it("does not invent completion for a missing or failed mutation", () => {
    const pending: PendingSlotReleaseMap = new Map();
    registerPendingSlotRelease(pending, "agent-1:small", "small");

    expect(markPendingSlotReleaseComplete(pending, "missing:small", 2)).toBe(false);
    pending.delete("agent-1:small");
    expect(reconcileCompletedSlotReleases(pending, 2)).toBe(false);
    expect(countPendingSlotReleasesByTier(pending)).toEqual({});
  });
});
