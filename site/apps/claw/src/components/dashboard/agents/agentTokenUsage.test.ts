import { describe, expect, it } from "vitest";

import { tokenUsageSnapshot } from "./agentTokenUsage";

describe("tokenUsageSnapshot", () => {
  it("keeps attributed usage in both the agent map and daily total", () => {
    expect(tokenUsageSnapshot({
      agents: [{ agentId: "agent-1", totalTokens: 12_500 }],
      unattributed: { totalTokens: 0 },
    })).toEqual({
      byAgent: { "agent-1": 12_500 },
      dailyTotal: 12_500,
    });
  });

  it("keeps unattributed runtime usage in the daily total", () => {
    expect(tokenUsageSnapshot({
      agents: [{ agentId: "agent-1", totalTokens: 0 }],
      unattributed: { totalTokens: 12_500 },
    })).toEqual({
      byAgent: { "agent-1": 0 },
      dailyTotal: 12_500,
    });
  });

  it("adds attributed and unattributed usage across agents", () => {
    expect(tokenUsageSnapshot({
      agents: [
        { agentId: "agent-1", totalTokens: 4_000 },
        { agentId: "agent-2", totalTokens: 6_000 },
      ],
      unattributed: { totalTokens: 2_500 },
    })).toEqual({
      byAgent: { "agent-1": 4_000, "agent-2": 6_000 },
      dailyTotal: 12_500,
    });
  });

  it("keeps the pooled total when the selected agent is absent", () => {
    expect(tokenUsageSnapshot({
      agents: [{ agentId: "other-agent", totalTokens: 9_000 }],
      unattributed: { totalTokens: 3_500 },
    }).dailyTotal).toBe(12_500);
  });

  it("accepts a lower authoritative total after a daily reset", () => {
    expect(tokenUsageSnapshot({
      agents: [{ agentId: "agent-1", totalTokens: 20 }],
      unattributed: { totalTokens: 0 },
    }).dailyTotal).toBe(20);
  });

  it("keeps finite account usage while sanitizing the agent map", () => {
    expect(tokenUsageSnapshot({
      agents: [
        { agentId: "agent-1", totalTokens: "invalid" },
        { agentId: "agent-2", totalTokens: -100 },
        { agentId: "", totalTokens: 5 },
      ],
      unattributed: null,
    })).toEqual({
      byAgent: { "agent-1": 0, "agent-2": 0 },
      dailyTotal: 5,
    });
  });
});
