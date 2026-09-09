/**
 * State labels must be the SDK's own state string, rendered once and the same
 * everywhere: the sidebar said "booting" for STARTING while the chat header
 * said "Starting…". There is no alias list — just the lowercased state.
 */
import { describe, expect, it } from "vitest";
import { AGENT_TRANSITIONAL_STATES } from "../../ts-sdk/src/agents.ts";
import { agentStateLabel } from "./agent-utils";

describe("agentStateLabel", () => {
  it("renders the lowercased canonical SDK state", () => {
    expect(agentStateLabel("STARTING")).toBe("starting");
    expect(agentStateLabel("RESTORING")).toBe("restoring");
    expect(agentStateLabel("FAILED")).toBe("failed");
  });

  it("never aliases a transitional state", () => {
    for (const state of AGENT_TRANSITIONAL_STATES) {
      expect(agentStateLabel(state)).toBe(state.toLowerCase());
    }
    expect(agentStateLabel("STARTING")).not.toBe("booting");
  });
});
