import { describe, expect, it } from "vitest";

import { formatTrialTimeRemaining, getActiveAgentTrial } from "./agent-trial";

const NOW = Date.parse("2026-08-06T12:00:00Z");

function trialSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-team-trial",
    planId: "team",
    planName: "Team",
    stripeSubscriptionId: "sub_stripe",
    isCurrent: true,
    trial: {
      active: true,
      days: 7,
      startsAt: new Date("2026-08-05T12:00:00Z"),
      endsAt: new Date("2026-08-12T12:00:00Z"),
      secondsRemaining: 6 * 86_400,
    },
    ...overrides,
  };
}

describe("agent trial state", () => {
  it("selects the active current trial and reports remaining time", () => {
    const summary = {
      activeSubscriptions: [trialSubscription()],
      subscriptions: [trialSubscription()],
    };

    expect(getActiveAgentTrial(summary as any, NOW)).toMatchObject({
      planId: "team",
      planName: "Team",
      secondsRemaining: 6 * 86_400,
      timeRemainingLabel: "6 days left",
    });
  });

  it("does not present converted, expired, or inactive trial metadata as active", () => {
    const summary = {
      activeSubscriptions: [trialSubscription({
        trial: {
          active: false,
          days: 7,
          startsAt: new Date("2026-07-01T12:00:00Z"),
          endsAt: new Date("2026-07-08T12:00:00Z"),
          secondsRemaining: 0,
        },
      })],
    };

    expect(getActiveAgentTrial(summary as any, NOW)).toBeNull();
  });

  it("anchors countdown timing to authoritative remaining seconds", () => {
    const summary = {
      activeSubscriptions: [trialSubscription({
        trial: {
          active: true,
          days: 7,
          startsAt: new Date("2026-08-05T12:00:00Z"),
          endsAt: new Date("2026-08-06T11:00:00Z"),
          secondsRemaining: 2 * 86_400,
        },
      })],
    };

    expect(getActiveAgentTrial(summary as any, NOW + 86_400_000, NOW)).toMatchObject({
      secondsRemaining: 86_400,
      timeRemainingLabel: "1 day left",
    });
  });

  it("formats the final day without claiming a full day remains", () => {
    expect(formatTrialTimeRemaining(new Date(NOW + 23 * 60 * 60 * 1000), NOW)).toBe("<1 day left");
    expect(formatTrialTimeRemaining(new Date(NOW), NOW)).toBe("Trial ended");
  });
});
