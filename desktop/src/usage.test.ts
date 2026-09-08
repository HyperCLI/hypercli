import { describe, expect, it } from "vitest";
import type { UsageDay, UsageKeyEntry, UsageAgentEntry, UsageMetrics } from "./api";
import {
  activeKeyCount,
  agentUsageRows,
  formatTokens,
  sumUsageHistory,
  usageKeyRows,
  usageRangeDays,
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
    expect(formatTokens(null)).toBe("---");
    expect(formatTokens(undefined)).toBe("---");
    expect(formatTokens(-5)).toBe("---");
    expect(formatTokens(Number.NaN)).toBe("---");
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
});

describe("usageRangeDays", () => {
  it("maps ranges to day counts", () => {
    expect(usageRangeDays("1d")).toBe(1);
    expect(usageRangeDays("7d")).toBe(7);
    expect(usageRangeDays("30d")).toBe(30);
  });
});
