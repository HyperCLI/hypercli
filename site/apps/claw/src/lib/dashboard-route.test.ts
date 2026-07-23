import { describe, expect, it } from "vitest";

import {
  DASHBOARD_VIEW_HREFS,
  buildDashboardAgentsRedirectHref,
  buildDashboardViewHref,
  buildDashboardViewRedirectHref,
  resolveDashboardView,
} from "./dashboard-route";

describe("dashboard routes", () => {
  it("resolves supported dashboard views", () => {
    expect(resolveDashboardView(" overview ")).toBe("overview");
    expect(resolveDashboardView("usage")).toBe("usage");
    expect(resolveDashboardView("settings")).toBe("settings");
    expect(resolveDashboardView("agents")).toBeNull();
    expect(resolveDashboardView(null)).toBeNull();
  });

  it("builds canonical view links with optional agent selection", () => {
    expect(DASHBOARD_VIEW_HREFS.overview).toBe("/dashboard/agents?view=overview");
    expect(buildDashboardViewHref("usage", {
      agentId: "agent/one",
      session: "session focus",
    })).toBe(
      "/dashboard/agents?view=usage&agentId=agent%2Fone&session=session+focus",
    );
  });

  it("preserves compatible parameters in legacy redirects", () => {
    expect(buildDashboardViewRedirectHref("settings", {
      agentId: "agent-1",
      integration: "slack",
      slack_oauth_ok: "true",
      section: "members",
    })).toBe(
      "/dashboard/agents?view=settings&agentId=agent-1&integration=slack&slack_oauth_ok=true",
    );
    expect(buildDashboardAgentsRedirectHref({ agentId: "agent-1", tag: ["one", "two"] })).toBe(
      "/dashboard/agents?agentId=agent-1&tag=one&tag=two",
    );
  });
});
