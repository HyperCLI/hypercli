import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_PAGE_HREFS,
  DASHBOARD_VIEW_HREFS,
  KNOWLEDGE_HUB_HREF,
  buildAgentLauncherHref,
  buildAgentTrialHref,
  buildAuthenticatedClawHomeHref,
  buildDashboardAgentsRedirectHref,
  buildDashboardViewHref,
  buildDashboardViewRedirectHref,
  buildKnowledgeHubHref,
  resolveDashboardView,
  syncDashboardSearchParams,
} from "./dashboard-route";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("dashboard routes", () => {
  it("resolves supported dashboard views", () => {
    expect(resolveDashboardView(" overview ")).toBe("overview");
    expect(resolveDashboardView("alt-home")).toBeNull();
    expect(resolveDashboardView("usage")).toBe("usage");
    expect(resolveDashboardView("settings")).toBe("settings");
    expect(resolveDashboardView("agents")).toBeNull();
    expect(resolveDashboardView(null)).toBeNull();
  });

  it("builds canonical view links with optional agent selection", () => {
    expect(KNOWLEDGE_HUB_HREF).toBe("/dashboard/agents?section=knowledge-hub");
    expect(DASHBOARD_VIEW_HREFS.overview).toBe("/dashboard/agents?view=overview");
    expect(buildDashboardViewHref("usage", {
      agentId: "agent/one",
      session: "session focus",
    })).toBe(
      "/dashboard/agents?view=usage&agentId=agent%2Fone&session=session+focus",
    );
  });

  it("builds the canonical agent launcher entry", () => {
    expect(buildAgentLauncherHref()).toBe("/dashboard/agents?open=agent-launcher");
    expect(buildAgentLauncherHref(" pro/annual ")).toBe(
      "/dashboard/agents?open=agent-launcher&plan=pro%2Fannual",
    );
  });

  it("builds and preserves an explicit Team trial entry", () => {
    expect(buildAgentTrialHref()).toBe("/dashboard/agents?intent=trial&plan=team");
    expect(buildAuthenticatedClawHomeHref("?intent=trial&plan=team")).toBe(
      "/dashboard/agents?intent=trial&plan=team",
    );
    expect(buildAuthenticatedClawHomeHref("?plan=team")).toBe(
      "/dashboard/agents?intent=trial&plan=team",
    );
    expect(buildAuthenticatedClawHomeHref("?plan=pro")).toBe(
      "/dashboard/agents?open=agent-launcher&plan=pro",
    );
  });

  it("builds a Knowledge Hub link with an owned Domain selection", () => {
    expect(buildKnowledgeHubHref({
      domainId: "domain/marketing",
      agentId: "agent-1",
      session: "focus session",
    })).toBe(
      "/dashboard/agents?section=knowledge-hub&agentId=agent-1&session=focus+session&domainId=domain%2Fmarketing",
    );
  });

  it("keeps account management pages outside the persistent dashboard views", () => {
    expect(ACCOUNT_PAGE_HREFS).toEqual({
      apiKeys: "/keys",
      plans: "/plans",
      billing: "/dashboard/billing",
    });
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

  it("shallowly replaces dashboard search params without changing the deployed pathname", () => {
    window.history.replaceState(null, "", "/dashboard/agents/?view=overview#chat");
    const replaceState = vi.spyOn(window.history, "replaceState");

    syncDashboardSearchParams(new URLSearchParams({
      agentId: "agent-1",
      session: "focus session",
    }));

    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/dashboard/agents/?agentId=agent-1&session=focus+session#chat",
    );
    expect(window.location.pathname).toBe("/dashboard/agents/");
  });

  it("can add a shallow dashboard history entry", () => {
    window.history.replaceState(null, "", "/dashboard/agents?agentId=agent-1");
    const pushState = vi.spyOn(window.history, "pushState");

    syncDashboardSearchParams(new URLSearchParams({ view: "settings" }), true);

    expect(pushState).toHaveBeenCalledWith(null, "", "/dashboard/agents?view=settings");
  });
});
