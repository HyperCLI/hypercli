"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createAgentClient, createHyperAgentClient } from "@/lib/agent-client";
import { type AgentMeta } from "@/lib/avatar";
import {
  displayNameForDashboard,
  greetingForDate,
  resolveBrowserTimeZone,
} from "@/lib/dashboard-greeting";
import { integrationDisplayName } from "@/lib/integration-display-name";
import { DashboardAgentRail, type DashboardRailAgent } from "@/components/dashboard/DashboardAgentRail";
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
import type {
  HyperAgentKeyUsage,
  HyperAgentUsageHistory,
  HyperAgentUsageSummary,
} from "@hypercli.com/sdk/agent";
import type { Agent as SdkAgent } from "@hypercli.com/sdk/agents";

type AgentState =
  | "PENDING"
  | "RESTORING"
  | "RESTORE_FAILED"
  | "SYNCING"
  | "SYNC_FAILED"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "FAILED";

interface UsageInfo {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
  activeKeys: number;
}

interface Agent {
  id: string;
  name: string;
  state: AgentState;
  startedAt: string | null;
  updatedAt: string | null;
  meta?: AgentMeta | null;
}

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

function normalizeAgent(agent: SdkAgent): Agent {
  return {
    id: agent.id,
    name: agent.name ?? agent.id,
    state: agent.state as AgentState,
    startedAt: agent.startedAt?.toISOString() ?? null,
    updatedAt: agent.updatedAt?.toISOString() ?? null,
    meta: agent.meta ?? null,
  };
}

function relativeTime(value: string | null) {
  if (!value) return null;
  const diffMs = Date.now() - new Date(value).getTime();
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

function buildAgentRows({
  agents,
  integrations,
  totals,
  hasData,
}: {
  agents: Agent[];
  integrations: DashboardIntegrationUsage[];
  totals: ReturnType<typeof sumHistory>;
  hasData: boolean;
}): DashboardAgentUsageRow[] {
  if (!hasData || agents.length === 0) return [];

  const activeIntegrationCount = integrations.filter((integration) => integration.totalTokens > 0 || integration.requests > 0).length;
  const canAttributeUsage = agents.length === 1;

  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    status: agent.state,
    integrations: canAttributeUsage ? activeIntegrationCount : null,
    requests: canAttributeUsage ? totals.requests : null,
    tokens: canAttributeUsage ? totals.tokens : null,
    lastActivity: relativeTime(agent.updatedAt ?? agent.startedAt),
  }));
}

export default function DashboardPage() {
  const { getToken, user, logout } = useAgentAuth();
  const [range, setRange] = useState<DashboardTimeRange>("7d");
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [history, setHistory] = useState<DashboardDayData[]>([]);
  const [integrations, setIntegrations] = useState<DashboardIntegrationUsage[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [localizedGreeting, setLocalizedGreeting] = useState(() => greetingForDate(new Date()));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const hyperAgent = createHyperAgentClient(token);
      const deployments = createAgentClient(token);
      const days = rangeDays(range);
      const [usageData, historyData, integrationData, agentData] = await Promise.allSettled([
        hyperAgent.usageSummary(),
        hyperAgent.usageHistory(days),
        hyperAgent.keyUsage(days),
        deployments.list(),
      ]);

      if (usageData.status === "fulfilled") setUsage(normalizeUsage(usageData.value));
      if (historyData.status === "fulfilled") setHistory(normalizeHistory(historyData.value));
      if (integrationData.status === "fulfilled") setIntegrations(normalizeKeyUsage(integrationData.value));
      if (agentData.status === "fulfilled") setAgents(agentData.value.map(normalizeAgent));
    } catch {
      setUsage(null);
      setHistory([]);
      setIntegrations([]);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [getToken, range]);

  useEffect(() => {
    void fetchData();
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
  const agentRows = useMemo(
    () => buildAgentRows({ agents, integrations, totals, hasData }),
    [agents, hasData, integrations, totals],
  );
  const railAgents: DashboardRailAgent[] = useMemo(
    () => agents.map((agent) => ({ id: agent.id, name: agent.name, state: agent.state, meta: agent.meta, updatedAt: agent.updatedAt })),
    [agents],
  );
  const displayName = displayNameForDashboard(user);
  const accountInitial = (displayName !== "there" ? displayName[0] : user?.email?.[0]) ?? "?";

  return (
    <div className="flex h-full bg-background text-foreground">
      <DashboardAgentRail
        agents={railAgents}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        accountInitial={accountInitial}
        onLogout={logout}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6 lg:px-0">
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
        </main>
      </div>
    </div>
  );
}
