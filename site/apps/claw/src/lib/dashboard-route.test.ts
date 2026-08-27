import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_PAGE_HREFS,
  DASHBOARD_VIEW_HREFS,
  KNOWLEDGE_HUB_HREF,
  buildAgentLauncherHref,
  buildAgentSettingsHref,
  buildAgentTrialHref,
  buildAuthenticatedClawHomeHref,
  buildDashboardAgentsRedirectHref,
  buildDashboardViewHref,
  buildDashboardViewRedirectHref,
  buildKnowledgeHubHref,
  isTeamTrialDashboardEntry,
  resolveDashboardView,
  resolveKnowledgeCollectionId,
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

  it("builds generic and agent-scoped settings links", () => {
    expect(buildAgentSettingsHref()).toBe("/dashboard/agents?view=settings&settings=agent");
    expect(buildAgentSettingsHref(" agent/one ")).toBe(
      "/dashboard/agents?view=settings&settings=agent&agentId=agent%2Fone",
    );
  });

  it("builds the canonical agent launcher entry", () => {
    expect(buildAgentLauncherHref()).toBe("/dashboard/agents?open=agent-launcher");
    expect(buildAgentLauncherHref(" pro/annual ")).toBe(
      "/dashboard/agents?open=agent-launcher&plan=pro%2Fannual",
    );
  });

  it("lands Team trial links on the Free dashboard", () => {
    expect(buildAgentTrialHref()).toBe("/dashboard/agents?view=overview");
    expect(buildAuthenticatedClawHomeHref("?intent=trial&plan=team")).toBe(
      "/dashboard/agents?view=overview",
    );
    expect(buildAuthenticatedClawHomeHref("?plan=team")).toBe(
      "/dashboard/agents?view=overview",
    );
    expect(buildAuthenticatedClawHomeHref("?plan=pro")).toBe(
      "/dashboard/agents?open=agent-launcher&plan=pro",
    );
  });

  it("recognizes only Team trial dashboard handoffs", () => {
    expect(isTeamTrialDashboardEntry(new URLSearchParams("intent=trial&plan=team"))).toBe(true);
    expect(isTeamTrialDashboardEntry(new URLSearchParams("intent=TRIAL"))).toBe(true);
    expect(isTeamTrialDashboardEntry(new URLSearchParams("intent=trial&plan=pro"))).toBe(false);
    expect(isTeamTrialDashboardEntry(new URLSearchParams("plan=team"))).toBe(false);
  });

  it("builds a canonical Knowledge Hub link with a Collection selection", () => {
    expect(buildKnowledgeHubHref({
      collectionId: "collection/marketing",
      agentId: "agent-1",
      session: "focus session",
    })).toBe(
      "/dashboard/agents?section=knowledge-hub&agentId=agent-1&session=focus+session&collectionId=collection%2Fmarketing",
    );
  });

  it("resolves canonical and legacy Knowledge Hub Collection selections", () => {
    expect(resolveKnowledgeCollectionId(new URLSearchParams(
      "collectionId=collection-new&domainId=collection-old",
    ))).toBe("collection-new");
    expect(resolveKnowledgeCollectionId(new URLSearchParams(
      "domainId=legacy-collection",
    ))).toBe("legacy-collection");
    expect(resolveKnowledgeCollectionId(new URLSearchParams())).toBeNull();
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
