import { describe, expect, it } from "vitest";

import { buildSdkAgent } from "@/test/factories";
import { buildAgentInspectorActionState, buildAgentStatus } from "./AgentInspector";
import { toAgentViewModel } from "./agentViewModel";

describe("AgentInspector lifecycle status", () => {
  it("preserves STOPPING instead of presenting cleanup as startup", () => {
    const agent = toAgentViewModel(buildSdkAgent({ state: "STOPPING" }));

    expect(buildAgentStatus(agent, false)).toMatchObject({
      state: "STOPPING",
      uptime: 0,
      cpu: 0,
    });
  });

  it("offers cleanup rather than restart after a failed launch", () => {
    const agent = toAgentViewModel(buildSdkAgent({ state: "FAILED" }));

    expect(buildAgentInspectorActionState(agent)).toEqual({
      canStart: false,
      canStop: true,
      cleanupRequired: true,
    });
  });

  it("offers restart once cleanup reaches stopped", () => {
    const agent = toAgentViewModel(buildSdkAgent({ state: "STOPPED" }));

    expect(buildAgentInspectorActionState(agent)).toEqual({
      canStart: true,
      canStop: false,
      cleanupRequired: false,
    });
  });
});
