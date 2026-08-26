import { describe, expect, it } from "vitest";

import { toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { buildSdkAgent } from "@/test/factories";
import {
  dashboardAgentUsageRows,
  normalizeDashboardKeyUsage,
  normalizeDashboardUsageHistory,
  validateDashboardAgentUsage,
} from "./dashboard-usage";

const emptyMetrics = {
  totalTokens: 0,
  promptTokens: 0,
  completionTokens: 0,
  requests: 0,
};

describe("dashboard usage data", () => {
  it("accepts exact consecutive UTC history and rejects incomplete periods", () => {
    const history = {
      days: 2,
      history: [
        { date: "2026-08-24", ...emptyMetrics },
        { date: "2026-08-25", totalTokens: 10, promptTokens: 6, completionTokens: 4, requests: 1 },
      ],
    };

    expect(normalizeDashboardUsageHistory(history, 2)).toEqual(history.history);
    expect(() => normalizeDashboardUsageHistory({
      ...history,
      history: [history.history[0], { ...history.history[1], date: "2026-08-26" }],
    }, 2)).toThrow("non-consecutive dates");
    expect(() => normalizeDashboardUsageHistory({
      ...history,
      history: [{ ...history.history[0], date: "2026-02-30" }, history.history[1]],
    }, 2)).toThrow("invalid date");
    expect(() => normalizeDashboardUsageHistory({
      ...history,
      history: [history.history[0], { ...history.history[1], promptTokens: 7, completionTokens: 4 }],
    }, 2)).toThrow("invalid token breakdown");
    expect(() => normalizeDashboardUsageHistory({ ...history, days: 7 }, 2)).toThrow("unexpected period");
  });

  it("adds stable references only when API-key names are ambiguous", () => {
    const keys = normalizeDashboardKeyUsage({
      days: 7,
      keys: [
        {
          keyHash: "abcdef1234567890",
          name: "cli KEY",
          totalTokens: 10,
          promptTokens: 6,
          completionTokens: 4,
          requests: 1,
        },
        {
          keyHash: "123456abcdef7890",
          name: "CLI key",
          totalTokens: 20,
          promptTokens: 12,
          completionTokens: 8,
          requests: 2,
        },
        {
          keyHash: "unique-key-hash",
          name: "Dashboard",
          totalTokens: 30,
          promptTokens: 18,
          completionTokens: 12,
          requests: 3,
        },
        {
          keyHash: "fedcba9876543210",
          name: "fedcba987654",
          totalTokens: 40,
          promptTokens: 24,
          completionTokens: 16,
          requests: 4,
        },
      ],
    }, 7);

    expect(keys.map((entry) => entry.reference)).toEqual([
      "abcdef...7890",
      "123456...7890",
      null,
      "fedcba...3210",
    ]);
    expect(keys.map((entry) => entry.name)).toEqual(["cli KEY", "CLI key", "Dashboard", "Unnamed API key"]);
  });

  it("rejects duplicate API-key rows and mismatched key periods", () => {
    const entry = {
      keyHash: "key-hash",
      name: "CLI key",
      totalTokens: 10,
      promptTokens: 6,
      completionTokens: 4,
      requests: 1,
    };

    expect(() => normalizeDashboardKeyUsage({ days: 7, keys: [entry, entry] }, 7)).toThrow("duplicate API key reference");
    expect(() => normalizeDashboardKeyUsage({ days: 30, keys: [entry] }, 7)).toThrow("unexpected period");
  });

  it("lengthens colliding short API-key references until they differ", () => {
    const keys = normalizeDashboardKeyUsage({
      days: 7,
      keys: [
        { keyHash: "abcdef1111117890", name: "CLI key", totalTokens: 10, promptTokens: 6, completionTokens: 4, requests: 1 },
        { keyHash: "abcdef2222227890", name: "CLI key", totalTokens: 20, promptTokens: 12, completionTokens: 8, requests: 2 },
      ],
    }, 7);

    expect(keys.map((entry) => entry.reference)).toEqual(["abcdef11...7890", "abcdef22...7890"]);
  });

  it("rejects duplicate agent rows before they can double-count or reuse table keys", () => {
    const duplicateUsage = {
      days: 7,
      agents: [
        { agentId: "agent-a", name: "Alpha", managed: true, avatarUrl: null, ...emptyMetrics },
        { agentId: "agent-a", name: "Alpha copy", managed: true, avatarUrl: null, ...emptyMetrics },
      ],
      unattributed: emptyMetrics,
    };

    expect(() => validateDashboardAgentUsage(duplicateUsage, 7)).toThrow("invalid agent reference");
    expect(() => validateDashboardAgentUsage({ ...duplicateUsage, days: 30, agents: [] }, 7)).toThrow("unexpected period");
  });

  it("retains backend-only agents and explicit unattributed usage", () => {
    const rosterAgent = toAgentViewModel(buildSdkAgent({ id: "agent-a", name: "alpha", state: "RUNNING" }));
    const usage = {
      days: 7,
      agents: [
        {
          agentId: "agent-a",
          name: "Alpha",
          managed: true,
          avatarUrl: null,
          totalTokens: 100,
          promptTokens: 60,
          completionTokens: 40,
          requests: 2,
        },
        {
          agentId: "agent-backend-only",
          name: "Backend only",
          managed: true,
          avatarUrl: null,
          totalTokens: 50,
          promptTokens: 30,
          completionTokens: 20,
          requests: 1,
        },
      ],
      unattributed: { totalTokens: 7, promptTokens: 3, completionTokens: 4, requests: 1 },
    };

    const rows = dashboardAgentUsageRows(validateDashboardAgentUsage(usage, 7), [rosterAgent]);

    expect(rows).toMatchObject([
      { id: "agent-a", status: "RUNNING", tokens: 100 },
      { id: "agent-backend-only", status: null, tokens: 50 },
      { id: "usage:unattributed", kind: "unattributed", tokens: 7 },
    ]);
  });
});
