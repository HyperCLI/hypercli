import { describe, expect, it, vi } from "vitest";

vi.mock("@hypercli/shared-ui", () => ({
  NAV_URLS: {
    claw: "https://agents.example.com",
    clawDashboard: "https://agents.example.com/dashboard",
  },
}));

import { TEAM_TRIAL_HREF, agentPlanCtaHref, agentTrialHref } from "./agent-links";

describe("agent links", () => {
  it("lands Team trial offers on the dashboard overview", () => {
    const expected = "https://agents.example.com/dashboard/agents?view=overview&intent=trial&plan=team";

    expect(TEAM_TRIAL_HREF).toBe(expected);
    expect(agentTrialHref(" TEAM ")).toBe(expected);
    expect(agentPlanCtaHref("team")).toBe(expected);
  });
});
