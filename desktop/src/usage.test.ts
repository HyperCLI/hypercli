import { describe, expect, it } from "vitest";
import type { UsageDay, UsageKeyEntry, UsageAgentEntry, UsageMetrics } from "./api";
import {
  activeKeyCount,
  agentUsageRows,
  formatCostAmount,
  formatTokens,
  sumUsageHistory,
  usageKeyRows,
  usageRangeDays,
  usageUpdateText,
} from "./usage";

function day(date: string, values: Partial<UsageDay> = {}): UsageDay {
  return {
    date,
    total_tokens: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    requests: 0,
    ...values,
  };
}

describe("formatTokens", () => {
  it("formats token counts into compact units", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(120_000)).toBe("120k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
    expect(formatTokens(3_000_000_000)).toBe("3.0B");
    expect(formatTokens(1_500_000_000_000)).toBe("1.5T");
  });

  it("renders invalid values as a placeholder", () => {
    expect(formatTokens(null)).toBe("—");
    expect(formatTokens(undefined)).toBe("—");
    expect(formatTokens(-5)).toBe("—");
    expect(formatTokens(Number.NaN)).toBe("—");
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatTokens(Number.NEGATIVE_INFINITY)).toBe("—");
  });
});

describe("sumUsageHistory", () => {
  it("sums token and request counts across days", () => {
    const totals = sumUsageHistory([
      day("2026-09-05", { total_tokens: 100, prompt_tokens: 60, completion_tokens: 40, requests: 2 }),
      day("2026-09-06", { total_tokens: 300, prompt_tokens: 200, completion_tokens: 100, requests: 5 }),
    ]);
    expect(totals).toEqual({
      total_tokens: 400,
      prompt_tokens: 260,
      completion_tokens: 140,
      requests: 7,
    });
  });

  it("returns zeroes for an empty history", () => {
    expect(sumUsageHistory([])).toEqual({
      total_tokens: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      requests: 0,
    });
  });
});

describe("usageKeyRows", () => {
  function key(keyHash: string, name: string, totalTokens = 0, requests = 0): UsageKeyEntry {
    return {
      key_hash: keyHash,
      name,
      total_tokens: totalTokens,
      prompt_tokens: 0,
      completion_tokens: 0,
      requests,
    };
  }

  it("labels unnamed and hash-prefixed keys without a name", () => {
    const [row] = usageKeyRows([key("abcdef1234567890", "")]);
    expect(row.name).toBe("Unnamed API key");
    expect(row.reference).toBe("abcdef...7890");

    const [prefixed] = usageKeyRows([key("abcdef1234567890", "abcdef123456")]);
    expect(prefixed.name).toBe("Unnamed API key");
  });

  it("keeps unique names without references", () => {
    const [row] = usageKeyRows([key("abcdef1234567890", "CLI")]);
    expect(row.name).toBe("CLI");
    expect(row.reference).toBeNull();
  });

  it("disambiguates duplicate names with unique short references", () => {
    const rows = usageKeyRows([
      key("aaaaaa1111xxxx", "CLI"),
      key("bbbbbb2222xxxx", "CLI"),
    ]);
    expect(rows[0].reference).toBe("aaaaaa...xxxx");
    expect(rows[1].reference).toBe("bbbbbb...xxxx");
    expect(rows[0].reference).not.toBe(rows[1].reference);
  });
});

describe("activeKeyCount", () => {
  it("counts keys with any activity", () => {
    const keys: UsageKeyEntry[] = [
      { key_hash: "a", name: "", total_tokens: 10, prompt_tokens: 0, completion_tokens: 0, requests: 1 },
      { key_hash: "b", name: "", total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, requests: 0 },
      { key_hash: "c", name: "", total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, requests: 3 },
    ];
    expect(activeKeyCount(keys)).toBe(2);
  });
});

describe("agentUsageRows", () => {
  const metrics: UsageMetrics = {
    total_tokens: 100,
    prompt_tokens: 60,
    completion_tokens: 40,
    requests: 2,
  };

  it("maps agent entries and falls back to the id for blank names", () => {
    const agents: UsageAgentEntry[] = [
      { agent_id: "agent-1", name: "", managed: true, avatar_url: null, ...metrics },
    ];
    const rows = agentUsageRows(agents, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("agent-1");
    expect(rows[0].kind).toBe("agent");
  });

  it("appends an unattributed row only when it has activity", () => {
    expect(agentUsageRows([], { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, requests: 0 })).toHaveLength(0);
    const rows = agentUsageRows([], { ...metrics, requests: 9 });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("unattributed");
    expect(rows[0].name).toBe("Unattributed usage");
    expect(rows[0].requests).toBe(9);
  });

  it("omits agents with no activity in the window", () => {
    const agents: UsageAgentEntry[] = [
      { agent_id: "idle-1", name: "Radar", managed: true, avatar_url: null, total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, requests: 0 },
      { agent_id: "busy-1", name: "Penny", managed: true, avatar_url: null, ...metrics },
    ];
    const rows = agentUsageRows(agents, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("busy-1");
  });
});

describe("usageRangeDays", () => {
  it("maps ranges to day counts", () => {
    expect(usageRangeDays("1d")).toBe(1);
    expect(usageRangeDays("7d")).toBe(7);
    expect(usageRangeDays("30d")).toBe(30);
  });
});

describe("formatCostAmount", () => {
  it("formats dollar amounts with sensible precision", () => {
    expect(formatCostAmount(1.5)).toBe("$1.50");
    expect(formatCostAmount(0.0132)).toBe("$0.0132");
    expect(formatCostAmount(0.5)).toBe("$0.50");
    expect(formatCostAmount(0)).toBe("$0.00");
  });

  it("prefixes non-USD currency codes instead of the dollar sign", () => {
    expect(formatCostAmount(0.0132, "EUR")).toBe("0.0132 EUR");
    expect(formatCostAmount(2, "EUR")).toBe("2.00 EUR");
  });

  it("omits unknown or invalid amounts", () => {
    expect(formatCostAmount(null)).toBeNull();
    expect(formatCostAmount(undefined)).toBeNull();
    expect(formatCostAmount(Number.NaN)).toBeNull();
    expect(formatCostAmount(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatCostAmount(-1)).toBeNull();
  });
});

describe("usageUpdateText", () => {
  it("renders used-of-limit with a percentage", () => {
    expect(usageUpdateText({ used: 124_000, size: 272_000 })).toBe(
      "Context 124k of 272k tokens (46%)",
    );
  });

  it("keeps used-of-limit honest when used exceeds the limit", () => {
    expect(usageUpdateText({ used: 400_000, size: 272_000 })).toBe(
      "Context 400k of 272k tokens (147%)",
    );
  });

  it("appends a cost when one is provided", () => {
    expect(
      usageUpdateText({ used: 1_500, size: 272_000, cost: { amount: 0.0132, currency: "USD" } }),
    ).toBe("Context 1.5k of 272k tokens (1%) · $0.0132");
  });

  it("renders used-only updates without a limit", () => {
    expect(usageUpdateText({ used: 500 })).toBe("Context 500 tokens used");
  });

  it("renders size-only updates without a used figure", () => {
    expect(usageUpdateText({ size: 272_000 })).toBe("Context window 272k tokens");
  });

  it("falls back to a bare note when nothing is known", () => {
    expect(usageUpdateText({})).toBe("Context usage updated");
    expect(usageUpdateText({ used: Number.NaN, size: -1, cost: { amount: Number.NaN } })).toBe(
      "Context usage updated",
    );
  });
});
