"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  HyperAgentKeyUsage,
  HyperAgentUsageHistory,
  HyperAgentUsageSummary,
} from "@hypercli.com/sdk/agent";

import type { Agent } from "@/app/dashboard/agents/types";
import {
  AgentUsageTable,
  DashboardMetricCard,
  DashboardTimeRangeControl,
  IntegrationUsagePanel,
  TokenUsagePanel,
  dashboardMetricIcons,
  formatDashboardTokens,
  hasCollectedData,
  rangeDays,
  rangePeriodLabel,
  type DashboardAgentUsageRow,
  type DashboardDayData,
  type DashboardIntegrationUsage,
  type DashboardTimeRange,
} from "@/components/dashboard/DashboardAnalytics";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createHyperAgentClient } from "@/lib/agent-client";
import {
  displayNameForDashboard,
  greetingForDate,
  resolveBrowserTimeZone,
} from "@/lib/dashboard-greeting";
import { integrationDisplayName } from "@/lib/integration-display-name";
import { agentDisplayLabel } from "@/components/dashboard/agents/agentViewModel";

type WorkspaceUsagePanelProps = {
  accountAgentCount: number;
  workspaceAgents: Agent[];
  rosterError?: string | null;
};

type UsageInfo = {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
  activeKeys: number;
};

function normalizeUsage(usage: HyperAgentUsageSummary): UsageInfo {
  return {
    totalTokens: usage.totalTokens,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    requestCount: usage.requestCount,
    activeKeys: usage.activeKeys,
  };
}

function normalizeHistory(history: HyperAgentUsageHistory): DashboardDayData[] {
  return history.history.map((entry) => ({
    date: entry.date,
    totalTokens: entry.totalTokens,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    requests: entry.requests,
  }));
}

function normalizeKeyUsage(keyUsage: HyperAgentKeyUsage): DashboardIntegrationUsage[] {
  return keyUsage.keys.map((entry) => ({
    id: entry.keyHash,
    name: integrationDisplayName(entry.name, entry.keyHash),
    totalTokens: entry.totalTokens,
    requests: entry.requests,
  }));
}

function timestampFromIso(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function relativeTime(value: string | null) {
  const timestamp = timestampFromIso(value);
  if (!timestamp) return null;
  const diffMs = Date.now() - timestamp;
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  const minutes = Math.max(1, Math.floor(diffMs / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function sumHistory(history: DashboardDayData[]) {
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

export default function WorkspaceUsagePanel({
  accountAgentCount,
  workspaceAgents,
  rosterError = null,
}: WorkspaceUsagePanelProps) {
  const { getToken, user } = useAgentAuth();
  const [range, setRange] = useState<DashboardTimeRange>("7d");
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [history, setHistory] = useState<DashboardDayData[]>([]);
  const [integrations, setIntegrations] = useState<DashboardIntegrationUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localizedGreeting, setLocalizedGreeting] = useState(() => greetingForDate(new Date()));

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const hyperAgent = createHyperAgentClient(token);
      const days = rangeDays(range);
      const [usageData, historyData, integrationData] = await Promise.allSettled([
        hyperAgent.usageSummary(),
        hyperAgent.usageHistory(days),
        hyperAgent.keyUsage(days),
      ]);

      setUsage(usageData.status === "fulfilled" ? normalizeUsage(usageData.value) : null);
      setHistory(historyData.status === "fulfilled" ? normalizeHistory(historyData.value) : []);
      setIntegrations(integrationData.status === "fulfilled" ? normalizeKeyUsage(integrationData.value) : []);
      if ([usageData, historyData, integrationData].every((result) => result.status === "rejected")) {
        setError("Usage data could not be loaded.");
      }
    } catch (cause) {
      setUsage(null);
      setHistory([]);
      setIntegrations([]);
      setError(cause instanceof Error ? cause.message : "Usage data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [getToken, range]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void fetchData(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchData]);

  useEffect(() => {
    const updateGreeting = () => {
      setLocalizedGreeting(greetingForDate(new Date(), resolveBrowserTimeZone()));
    };
    updateGreeting();
    const intervalId = window.setInterval(updateGreeting, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const periodLabel = rangePeriodLabel(range);
  const totals = useMemo(() => sumHistory(history), [history]);
  const hasData = hasCollectedData(history, integrations);
  const activeIntegrationCount = integrations.filter((integration) => integration.totalTokens > 0 || integration.requests > 0).length;
  const integrationMetric = activeIntegrationCount || usage?.activeKeys || 0;
  const agentRows = useMemo<DashboardAgentUsageRow[]>(() => {
    if (!hasData) return [];
    const canAttributeUsage = accountAgentCount === 1;
    return workspaceAgents.map((agent) => ({
      id: agent.id,
      name: agentDisplayLabel(agent),
      status: agent.state,
      integrations: canAttributeUsage ? activeIntegrationCount : null,
      requests: canAttributeUsage ? totals.requests : null,
      tokens: canAttributeUsage ? totals.tokens : null,
      lastActivity: relativeTime(agent.updated_at ?? agent.started_at),
    }));
  }, [accountAgentCount, activeIntegrationCount, hasData, totals.requests, totals.tokens, workspaceAgents]);
  const displayName = displayNameForDashboard(user);
  const pageError = rosterError || error;

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6 lg:px-0">
        {pageError ? (
          <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>{pageError}</span>
            {!rosterError ? <button type="button" className="font-medium text-foreground" onClick={() => setError(null)}>Dismiss</button> : null}
          </div>
        ) : null}
        <div className="dashboard-overview-toolbar mb-6 border-b border-border pb-4">
          <p className="text-base font-medium text-foreground">
            {localizedGreeting}, {displayName} <span aria-hidden>👋</span>
          </p>
          <DashboardTimeRangeControl value={range} onChange={setRange} />
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <DashboardMetricCard
            title="Tokens"
            value={loading || totals.tokens === 0 ? "---" : formatDashboardTokens(totals.tokens)}
            periodLabel={periodLabel}
            icon={dashboardMetricIcons.tokens}
          />
          <DashboardMetricCard
            title="Requests"
            value={loading || totals.requests === 0 ? "---" : totals.requests.toLocaleString()}
            periodLabel={periodLabel}
            icon={dashboardMetricIcons.requests}
          />
          <DashboardMetricCard
            title="Integrations"
            value={loading || integrationMetric === 0 ? "---" : integrationMetric.toLocaleString()}
            periodLabel={periodLabel}
            icon={dashboardMetricIcons.integrations}
          />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <TokenUsagePanel history={loading ? [] : history} periodLabel={periodLabel} />
          <IntegrationUsagePanel integrations={loading ? [] : integrations} periodLabel={periodLabel} />
        </div>

        <div className="mt-6">
          <AgentUsageTable rows={loading ? [] : agentRows} />
        </div>
      </div>
    </div>
  );
}
