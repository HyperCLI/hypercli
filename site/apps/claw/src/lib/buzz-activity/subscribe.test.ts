import {
  BuzzActivityGapError,
  BuzzActivityRouteUnavailableError,
} from "@hypercli.com/sdk/agents";
import { describe, expect, it, vi } from "vitest";

import { mockDeployments } from "@/test/utils";

import type { BuzzActivityHandlers } from "./subscribe";
import { isBuzzActivityGapError, subscribeBuzzActivity } from "./subscribe";

function handlers(): BuzzActivityHandlers {
  return { onFrame: vi.fn() };
}

function deploymentsMock() {
  const routeSubscription = { close: vi.fn() };
  const relaySubscription = { close: vi.fn() };
  const deployments = mockDeployments({
    subscribeBuzzActivityRoute: vi.fn().mockResolvedValue(routeSubscription),
    subscribeBuzzActivity: vi.fn().mockResolvedValue(relaySubscription),
  });
  return { deployments, routeSubscription, relaySubscription };
}

describe("subscribeBuzzActivity transport selection", () => {
  it("prefers the edge route transport when the agent declares the route", async () => {
    const { deployments, routeSubscription } = deploymentsMock();

    const subscription = await subscribeBuzzActivity(deployments, "agent-1", handlers());

    expect(subscription).toBe(routeSubscription);
    expect(deployments.subscribeBuzzActivityRoute).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ onFrame: expect.any(Function) }),
    );
    expect(deployments.subscribeBuzzActivity).not.toHaveBeenCalled();
  });

  it("falls back to the relay transport when the route is unavailable", async () => {
    const { deployments, relaySubscription } = deploymentsMock();
    deployments.subscribeBuzzActivityRoute = vi
      .fn()
      .mockRejectedValue(new BuzzActivityRouteUnavailableError(
        "agent has no buzz-activity route",
      ));

    const subscription = await subscribeBuzzActivity(deployments, "agent-1", handlers());

    expect(subscription).toBe(relaySubscription);
    expect(deployments.subscribeBuzzActivity).toHaveBeenCalledWith("agent-1", expect.anything());
  });

  it("does not mask a real edge failure with a relay attempt", async () => {
    const { deployments } = deploymentsMock();
    const failure = new Error("edge token rejected");
    deployments.subscribeBuzzActivityRoute = vi.fn().mockRejectedValue(failure);

    await expect(
      subscribeBuzzActivity(deployments, "agent-1", handlers()),
    ).rejects.toBe(failure);
    expect(deployments.subscribeBuzzActivity).not.toHaveBeenCalled();
  });

  it("propagates relay transport failures after the fallback", async () => {
    const { deployments } = deploymentsMock();
    deployments.subscribeBuzzActivityRoute = vi
      .fn()
      .mockRejectedValue(new BuzzActivityRouteUnavailableError("no route"));
    deployments.subscribeBuzzActivity = vi
      .fn()
      .mockRejectedValue(new Error("Agent is not Buzz-backed: no relay url"));

    await expect(
      subscribeBuzzActivity(deployments, "agent-1", handlers()),
    ).rejects.toThrow("Agent is not Buzz-backed");
  });

  it("passes the abort signal through to the preferred transport", async () => {
    const { deployments } = deploymentsMock();
    const controller = new AbortController();

    await subscribeBuzzActivity(deployments, "agent-1", {
      ...handlers(),
      signal: controller.signal,
    });

    expect(deployments.subscribeBuzzActivityRoute).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

describe("isBuzzActivityGapError", () => {
  it("classifies the in-pod stream gap as soft", () => {
    expect(isBuzzActivityGapError(new BuzzActivityGapError(7))).toBe(true);
    expect(isBuzzActivityGapError(new Error("Buzz relay notice: slow consumer"))).toBe(false);
    expect(isBuzzActivityGapError(new BuzzActivityRouteUnavailableError("no route"))).toBe(false);
    expect(isBuzzActivityGapError(undefined)).toBe(false);
  });
});
