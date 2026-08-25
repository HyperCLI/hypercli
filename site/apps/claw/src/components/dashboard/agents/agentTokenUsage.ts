import type { TokenUsageSnapshot } from "./tokenUsageRefreshScheduler";

interface AgentUsageInput {
  agents?: Array<{ agentId?: unknown; totalTokens?: unknown }>;
  unattributed?: { totalTokens?: unknown } | null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function agentTokenUsageMap(usage: AgentUsageInput | null | undefined): Record<string, number> | null {
  if (!Array.isArray(usage?.agents)) return null;
  return Object.fromEntries(usage.agents.flatMap((entry) => {
    const agentId = typeof entry.agentId === "string" ? entry.agentId.trim() : "";
    return agentId ? [[agentId, Math.max(finiteNumber(entry.totalTokens), 0)]] : [];
  }));
}

export function dailyTokenUsageTotal(usage: AgentUsageInput | null | undefined): number | null {
  if (!usage) return null;
  const attributed = Array.isArray(usage.agents)
    ? usage.agents.reduce((total, entry) => total + Math.max(finiteNumber(entry.totalTokens), 0), 0)
    : 0;
  return attributed + Math.max(finiteNumber(usage.unattributed?.totalTokens), 0);
}

export function tokenUsageSnapshot(usage: AgentUsageInput): TokenUsageSnapshot {
  return {
    byAgent: agentTokenUsageMap(usage) ?? {},
    dailyTotal: dailyTokenUsageTotal(usage) ?? 0,
  };
}
