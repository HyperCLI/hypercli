import type {
  HyperAgentAgentUsage,
  HyperAgentKeyUsage,
  HyperAgentUsageHistory,
  HyperAgentUsageMetrics,
} from "@hypercli.com/sdk/agent";

import type { Agent } from "@/app/dashboard/agents/types";
import { agentDisplayLabel } from "@/components/dashboard/agents/agentViewModel";
import type {
  DashboardAgentUsageRow,
  DashboardDayData,
  DashboardIntegrationUsage,
} from "@/components/dashboard/DashboardAnalytics";

function usageCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Usage data contained an invalid count");
  }
  return value;
}

function assertUsageDays(actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error("Usage data covered an unexpected period");
  }
}

function usageDate(value: string): { value: string; timestamp: number } {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Usage data contained an invalid date");
  }
  return { value, timestamp };
}

function usageKeyReference(value: string): string {
  const reference = value.trim();
  if (!reference) throw new Error("Usage data contained an invalid API key reference");
  return reference;
}

function shortKeyReference(value: string, prefixLength = 6): string {
  return value.length <= prefixLength + 4 ? value : `${value.slice(0, prefixLength)}...${value.slice(-4)}`;
}

function uniqueShortKeyReference(value: string, references: string[]): string {
  for (let prefixLength = 6; prefixLength + 4 < value.length; prefixLength += 2) {
    const shortened = shortKeyReference(value, prefixLength);
    if (references.every((candidate) => candidate === value || shortKeyReference(candidate, prefixLength) !== shortened)) {
      return shortened;
    }
  }
  return value;
}

function validateUsageMetrics(metrics: HyperAgentUsageMetrics) {
  const totalTokens = usageCount(metrics.totalTokens);
  const promptTokens = usageCount(metrics.promptTokens);
  const completionTokens = usageCount(metrics.completionTokens);
  usageCount(metrics.requests);
  if (promptTokens + completionTokens > totalTokens) {
    throw new Error("Usage data contained an invalid token breakdown");
  }
}

export function normalizeDashboardUsageHistory(
  history: HyperAgentUsageHistory,
  expectedDays: number,
): DashboardDayData[] {
  assertUsageDays(history.days, expectedDays);
  if (history.history.length !== expectedDays) {
    throw new Error("Usage history did not cover the requested period");
  }

  let previousTimestamp: number | null = null;
  return history.history.map((entry) => {
    const date = usageDate(entry.date);
    if (previousTimestamp !== null && date.timestamp - previousTimestamp !== 86_400_000) {
      throw new Error("Usage history contained non-consecutive dates");
    }
    previousTimestamp = date.timestamp;
    const normalized = {
      date: date.value,
      totalTokens: usageCount(entry.totalTokens),
      promptTokens: usageCount(entry.promptTokens),
      completionTokens: usageCount(entry.completionTokens),
      requests: usageCount(entry.requests),
    };
    validateUsageMetrics(normalized);
    return normalized;
  });
}

export function normalizeDashboardKeyUsage(
  keyUsage: HyperAgentKeyUsage,
  expectedDays: number,
): DashboardIntegrationUsage[] {
  assertUsageDays(keyUsage.days, expectedDays);
  const keyIds = new Set<string>();
  const normalized = keyUsage.keys.map((entry) => {
    const id = usageKeyReference(entry.keyHash);
    if (keyIds.has(id)) throw new Error("Usage data contained a duplicate API key reference");
    keyIds.add(id);
    const rawName = entry.name.trim();
    const name = !rawName || rawName === id.slice(0, 12) ? "Unnamed API key" : rawName;
    validateUsageMetrics(entry);
    return {
      id,
      name,
      totalTokens: entry.totalTokens,
      requests: entry.requests,
    };
  });
  const nameCounts = new Map<string, number>();
  for (const entry of normalized) {
    const key = entry.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const referencedIds = normalized
    .filter((entry) => entry.name === "Unnamed API key" || (nameCounts.get(entry.name.toLowerCase()) ?? 0) > 1)
    .map((entry) => entry.id);
  return normalized.map((entry) => ({
    ...entry,
    reference: entry.name === "Unnamed API key" || (nameCounts.get(entry.name.toLowerCase()) ?? 0) > 1
      ? uniqueShortKeyReference(entry.id, referencedIds)
      : null,
  }));
}

export function validateDashboardAgentUsage(
  usage: HyperAgentAgentUsage,
  expectedDays: number,
): HyperAgentAgentUsage {
  assertUsageDays(usage.days, expectedDays);
  const agentIds = new Set<string>();
  for (const entry of usage.agents) {
    const agentId = entry.agentId.trim();
    if (!agentId || agentId !== entry.agentId || agentIds.has(agentId)) {
      throw new Error("Usage data contained an invalid agent reference");
    }
    agentIds.add(agentId);
    validateUsageMetrics(entry);
  }
  validateUsageMetrics(usage.unattributed);
  return usage;
}

export function dashboardAgentUsageRows(
  usage: HyperAgentAgentUsage | null,
  accountAgents: Agent[],
): DashboardAgentUsageRow[] {
  if (!usage) return [];
  const agentRoster = new Map(accountAgents.map((agent) => [agent.id, agent]));
  const rows = usage.agents.map((entry): DashboardAgentUsageRow => {
    const rosterAgent = agentRoster.get(entry.agentId);
    return {
      id: entry.agentId,
      name: entry.name.trim() || (rosterAgent ? agentDisplayLabel(rosterAgent) : entry.agentId),
      status: rosterAgent?.state ?? null,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      requests: entry.requests,
      tokens: entry.totalTokens,
    };
  });
  const unattributed = usage.unattributed;
  if (
    unattributed.totalTokens > 0
    || unattributed.promptTokens > 0
    || unattributed.completionTokens > 0
    || unattributed.requests > 0
  ) {
    rows.push({
      id: "usage:unattributed",
      name: "Unattributed usage",
      status: null,
      promptTokens: unattributed.promptTokens,
      completionTokens: unattributed.completionTokens,
      requests: unattributed.requests,
      tokens: unattributed.totalTokens,
      kind: "unattributed",
    });
  }
  return rows;
}

export function sumDashboardUsageHistory(history: DashboardDayData[]) {
  return history.reduce(
    (totals, day) => ({
      tokens: totals.tokens + day.totalTokens,
      promptTokens: totals.promptTokens + day.promptTokens,
      completionTokens: totals.completionTokens + day.completionTokens,
      requests: totals.requests + day.requests,
    }),
    { tokens: 0, promptTokens: 0, completionTokens: 0, requests: 0 },
  );
}
