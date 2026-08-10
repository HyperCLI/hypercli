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

  it("offers cleanup rather than restart while failed resources still exist", () => {
    const agent = toAgentViewModel(buildSdkAgent({ state: "FAILED", resourcesExist: true }));

    expect(buildAgentInspectorActionState(agent)).toEqual({
      canStart: false,
      canStop: true,
      cleanupRequired: true,
    });
  });

  it("offers restart once failed resources are gone", () => {
    const agent = toAgentViewModel(buildSdkAgent({ state: "FAILED", resourcesExist: false }));

    expect(buildAgentInspectorActionState(agent)).toEqual({
      canStart: true,
      canStop: false,
      cleanupRequired: false,
    });
  });
});
