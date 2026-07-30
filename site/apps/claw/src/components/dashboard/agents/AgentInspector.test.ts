import { describe, expect, it } from "vitest";

import { buildSdkAgent } from "@/test/factories";
import { buildAgentStatus } from "./AgentInspector";
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
});
