import { describe, expect, it, vi } from "vitest";

import {
  createDeploymentRefreshScheduler,
  createDeploymentSubscriptionRecovery,
} from "./deploymentRefreshScheduler";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createDeploymentRefreshScheduler", () => {
  it("coalesces a burst into an active refresh plus one trailing refresh", async () => {
    const releases: Array<() => void> = [];
    const refresh = vi.fn(() => new Promise<void>((resolve) => { releases.push(resolve); }));
    const scheduler = createDeploymentRefreshScheduler(refresh);

    scheduler.invalidate();
    scheduler.invalidate();
    scheduler.invalidate();
    expect(refresh).toHaveBeenCalledTimes(1);

    releases.shift()?.();
    await tick();
    expect(refresh).toHaveBeenCalledTimes(2);
    releases.shift()?.();
  });

  it("drops queued invalidations after disposal", async () => {
    const releases: Array<() => void> = [];
    const refresh = vi.fn(() => new Promise<void>((resolve) => { releases.push(resolve); }));
    const scheduler = createDeploymentRefreshScheduler(refresh);

    scheduler.invalidate();
    scheduler.invalidate();
    scheduler.dispose();
    releases.shift()?.();
    await tick();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("carries collection enrichment into the trailing refresh", async () => {
    const releases: Array<() => void> = [];
    const refresh = vi.fn((_includeEnrichment: boolean) => new Promise<void>((resolve) => {
      releases.push(resolve);
    }));
    const scheduler = createDeploymentRefreshScheduler(refresh);

    scheduler.invalidate(false);
    scheduler.invalidate(true);
    scheduler.invalidate(false);
    expect(refresh).toHaveBeenNthCalledWith(1, false);

    releases.shift()?.();
    await tick();
    expect(refresh).toHaveBeenNthCalledWith(2, true);
    releases.shift()?.();
  });
});

describe("createDeploymentSubscriptionRecovery", () => {
  it("refreshes once immediately and backs off repeated credential failures", () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    const recovery = createDeploymentSubscriptionRecovery({ baseDelayMs: 100, maxDelayMs: 250 });

    expect(recovery.retryAfterFailure(retry)).toBe(0);
    vi.advanceTimersByTime(0);
    expect(retry).toHaveBeenCalledTimes(1);

    expect(recovery.retryAfterFailure(retry)).toBe(100);
    vi.advanceTimersByTime(99);
    expect(retry).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(retry).toHaveBeenCalledTimes(2);

    expect(recovery.retryAfterFailure(retry)).toBe(200);
    expect(recovery.retryAfterFailure(retry)).toBe(250);
    expect(recovery.retryAfterFailure(retry)).toBe(250);
    recovery.reset();
    vi.runOnlyPendingTimers();
    expect(retry).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("restores immediate recovery after a refreshed stream receives an event", () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    const recovery = createDeploymentSubscriptionRecovery({ baseDelayMs: 100 });

    recovery.retryAfterFailure(retry);
    vi.advanceTimersByTime(0);
    expect(recovery.retryAfterFailure(retry)).toBe(100);
    recovery.markHealthy();
    expect(recovery.retryAfterFailure(retry)).toBe(0);
    vi.advanceTimersByTime(0);
    expect(retry).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
