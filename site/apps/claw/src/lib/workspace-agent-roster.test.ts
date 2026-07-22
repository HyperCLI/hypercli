import { describe, expect, it } from "vitest";

import { resolveWorkspaceAgentSelection } from "./workspace-agent-roster";

describe("resolveWorkspaceAgentSelection", () => {
  it("prefers an associated agent requested by the route", () => {
    expect(resolveWorkspaceAgentSelection(
      ["agent-current", "agent-requested"],
      "agent-requested",
      "agent-current",
    )).toBe("agent-requested");
  });

  it("retains the current agent when the route has no associated agent", () => {
    expect(resolveWorkspaceAgentSelection(
      ["agent-current", "agent-next"],
      "agent-other-workspace",
      "agent-current",
    )).toBe("agent-current");
  });

  it("falls back to the first associated agent or clears selection", () => {
    expect(resolveWorkspaceAgentSelection(["agent-next"], null, "agent-other-workspace")).toBe("agent-next");
    expect(resolveWorkspaceAgentSelection([], "agent-other-workspace", "agent-current")).toBeNull();
  });
});
