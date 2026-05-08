import { describe, expect, it } from "vitest";

import { buildSdkAgent } from "@/test/factories";
import { normalizeAgentState, toAgentViewModel } from "./agentViewModel";

describe("agentViewModel", () => {
  it("maps legacy ERROR agent state to FAILED", () => {
    expect(normalizeAgentState("ERROR")).toBe("FAILED");
    expect(toAgentViewModel(buildSdkAgent({ state: "ERROR" as never })).state).toBe("FAILED");
  });

  it("maps unknown string states to FAILED instead of inventing an unsupported state", () => {
    expect(normalizeAgentState("crashed")).toBe("FAILED");
  });

  it("keeps missing state as STOPPED", () => {
    expect(normalizeAgentState(null)).toBe("STOPPED");
  });
});
