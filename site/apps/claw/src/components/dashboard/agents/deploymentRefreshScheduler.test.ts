import { describe, expect, it, vi } from "vitest";

import { createDeploymentRefreshScheduler } from "./deploymentRefreshScheduler";

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
});
