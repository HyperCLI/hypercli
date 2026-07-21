import { describe, expect, it } from "vitest";

import { buildAgentWorkspaceTabHref, resolveAgentRouteTab } from "./agent-workspace-route";

describe("agent workspace routes", () => {
  it("accepts supported workspace tabs and rejects unrelated sections", () => {
    expect(resolveAgentRouteTab(" files ")).toBe("files");
    expect(resolveAgentRouteTab("settings")).toBe("settings");
    expect(resolveAgentRouteTab("members")).toBeNull();
    expect(resolveAgentRouteTab("openclaw")).toBe("openclaw");
    expect(resolveAgentRouteTab(null)).toBeNull();
  });

  it("builds encoded deep links and omits the default chat tab", () => {
    expect(buildAgentWorkspaceTabHref("agent/one", "files")).toBe(
      "/dashboard/agents?agentId=agent%2Fone&tab=files",
    );
    expect(buildAgentWorkspaceTabHref("agent-1", "chat")).toBe(
      "/dashboard/agents?agentId=agent-1",
    );
  });
});
