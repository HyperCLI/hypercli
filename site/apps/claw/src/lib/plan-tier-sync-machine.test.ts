import { beforeEach, describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({
  plans: vi.fn(),
  subscriptionSummary: vi.fn(),
}));

vi.mock("@hypercli.com/sdk/browser", () => ({
  BrowserHyperCLI: class {
    agent = {
      plans: sdkMocks.plans,
      subscriptionSummary: sdkMocks.subscriptionSummary,
    };
  },
}));

import {
  claimPlanTierProviderMount,
  invalidatePlanTierSnapshot,
  requestPlanTierSnapshot,
} from "../../../../packages/shared-ui/src/utils/plan-tier-sync-machine";

const MACHINE_KEY = "__hypercliPlanTierSyncMachine";

function resetMachine(): void {
  delete (globalThis as Record<string, unknown>)[MACHINE_KEY];
}

function currentPlan(id: string) {
  return {
    effectivePlanId: id,
    activeSubscriptions: [],
    entitlementItems: [],
    entitlements: { effectivePlanId: id },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

const ENV = "https://api.machine-test.hypercli.com";

describe("plan-tier sync machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMachine();
    process.env.NEXT_PUBLIC_API_BASE_URL = `${ENV}/api`;
    sdkMocks.plans.mockResolvedValue([{ id: "team", name: "Team", contractVersion: "2026-08" }]);
    sdkMocks.subscriptionSummary.mockResolvedValue(currentPlan("team"));
  });

  it("mounts in order: first claim wins, second no-ops, ownership transfers on release", () => {
    const first = claimPlanTierProviderMount();
    expect(first).toBeTypeOf("function");

    expect(claimPlanTierProviderMount()).toBeNull();

    first!();
    const third = claimPlanTierProviderMount();
    expect(third).toBeTypeOf("function");
    third!();
  });

  it("fails a re-mount while owned (failing re-mount)", () => {
    const first = claimPlanTierProviderMount();
    expect(claimPlanTierProviderMount()).toBeNull();
    expect(claimPlanTierProviderMount()).toBeNull();
    first!();
  });

  it("re-mounts cleanly after release (unmount -> remount)", async () => {
    const first = claimPlanTierProviderMount();
    first!();

    const second = claimPlanTierProviderMount();
    expect(second).toBeTypeOf("function");
    const snapshot = await requestPlanTierSnapshot({ token: "t", subject: "s", environment: ENV });
    expect(snapshot.summary.effectivePlanId).toBe("team");
    second!();
  });

  it("serializes concurrent requests for the same subject into one fetch", async () => {
    const pending = deferred<ReturnType<typeof currentPlan>>();
    sdkMocks.subscriptionSummary.mockReturnValue(pending.promise);

    const a = requestPlanTierSnapshot({ token: "t", subject: "s", environment: ENV });
    const b = requestPlanTierSnapshot({ token: "t", subject: "s", environment: ENV, force: true });
    const c = requestPlanTierSnapshot({ token: "t", subject: "s", environment: ENV });

    pending.resolve(currentPlan("team"));
    const [ra, rb, rc] = await Promise.all([a, b, c]);

    // One in-flight plus at most one coalesced follow-up — never three.
    expect(sdkMocks.subscriptionSummary.mock.calls.length).toBeLessThanOrEqual(2);
    expect(ra.summary.effectivePlanId).toBe("team");
    expect(rb.summary.effectivePlanId).toBe("team");
    expect(rc.summary.effectivePlanId).toBe("team");
  });

  it("serves the shared snapshot cache within TTL and drains non-forced pendings from it", async () => {
    const first = await requestPlanTierSnapshot({ token: "t", subject: "s", environment: ENV });
    expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(1);

    const second = await requestPlanTierSnapshot({ token: "t", subject: "s", environment: ENV });
    expect(second).toBe(first);
    expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(1);
  });

  it("refetches after invalidation", async () => {
    await requestPlanTierSnapshot({ token: "t", subject: "s", environment: ENV });
    expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(1);

    invalidatePlanTierSnapshot("s", ENV);
    await requestPlanTierSnapshot({ token: "t", subject: "s", environment: ENV });
    expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(2);
  });

  it("force bypasses the cache but not the serialization", async () => {
    await requestPlanTierSnapshot({ token: "t", subject: "s", environment: ENV });
    expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(1);

    const pending = deferred<ReturnType<typeof currentPlan>>();
    sdkMocks.subscriptionSummary.mockReturnValue(pending.promise);

    const a = requestPlanTierSnapshot({ token: "t", subject: "s", environment: ENV, force: true });
    const b = requestPlanTierSnapshot({ token: "t", subject: "s", environment: ENV, force: true });
    pending.resolve(currentPlan("team"));
    await Promise.all([a, b]);

    // initial + forced + one coalesced follow-up (uncoalesced would be 4)
    expect(sdkMocks.subscriptionSummary).toHaveBeenCalledTimes(3);
  });
});
