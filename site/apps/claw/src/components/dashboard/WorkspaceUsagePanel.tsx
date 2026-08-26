"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HyperAgentAgentUsage,
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
  rangeDays,
  rangePeriodLabel,
  type DashboardAgentUsageRow,
  type DashboardDataStatus,
  type DashboardDayData,
  type DashboardIntegrationUsage,
  type DashboardTimeRange,
} from "@/components/dashboard/DashboardAnalytics";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createHyperAgentClient } from "@/lib/agent-client";
import {
  dashboardAgentUsageRows,
  normalizeDashboardKeyUsage,
  normalizeDashboardUsageHistory,
  sumDashboardUsageHistory,
  validateDashboardAgentUsage,
} from "@/components/dashboard/dashboard-usage";

type WorkspaceUsagePanelProps = {
  accountAgents: Agent[];
  rosterError?: string | null;
};

type UsageState = {
  history: DashboardDayData[];
  historyStatus: DashboardDataStatus;
  keys: DashboardIntegrationUsage[];
  keysStatus: DashboardDataStatus;
  agents: HyperAgentAgentUsage | null;
  agentsStatus: DashboardDataStatus;
};

function loadingUsageState(): UsageState {
  return {
    history: [],
    historyStatus: "loading",
    keys: [],
    keysStatus: "loading",
    agents: null,
    agentsStatus: "loading",
  };
}

export default function WorkspaceUsagePanel({
  accountAgents,
  rosterError = null,
}: WorkspaceUsagePanelProps) {
  const { getToken, user } = useAgentAuth();
  const [range, setRange] = useState<DashboardTimeRange>("7d");
  const [usageState, setUsageState] = useState<UsageState>(loadingUsageState);
  const requestGenerationRef = useRef(0);
  const principalId = user?.id ?? null;

  const fetchData = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    setUsageState(loadingUsageState());

    if (!principalId) {
      setUsageState({
        history: [],
        historyStatus: "unavailable",
        keys: [],
        keysStatus: "unavailable",
        agents: null,
        agentsStatus: "unavailable",
      });
      return;
    }

    try {
      const token = await getToken();
      const hyperAgent = createHyperAgentClient(token);
      const days = rangeDays(range);
      const [historyResult, keysResult, agentsResult] = await Promise.allSettled([
        hyperAgent.usageHistory(days).then((value) => normalizeDashboardUsageHistory(value, days)),
        hyperAgent.keyUsage(days).then((value) => normalizeDashboardKeyUsage(value, days)),
        hyperAgent.agentUsage(days).then((value) => validateDashboardAgentUsage(value, days)),
      ]);

      if (generation !== requestGenerationRef.current) return;
      setUsageState({
        history: historyResult.status === "fulfilled" ? historyResult.value : [],
        historyStatus: historyResult.status === "fulfilled" ? "ready" : "unavailable",
        keys: keysResult.status === "fulfilled" ? keysResult.value : [],
        keysStatus: keysResult.status === "fulfilled" ? "ready" : "unavailable",
        agents: agentsResult.status === "fulfilled" ? agentsResult.value : null,
        agentsStatus: agentsResult.status === "fulfilled" ? "ready" : "unavailable",
      });
    } catch {
      if (generation !== requestGenerationRef.current) return;
      setUsageState({
        history: [],
        historyStatus: "unavailable",
        keys: [],
        keysStatus: "unavailable",
        agents: null,
        agentsStatus: "unavailable",
      });
    }
  }, [getToken, principalId, range]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void fetchData(); }, 0);
    return () => {
      window.clearTimeout(timeout);
      requestGenerationRef.current += 1;
    };
  }, [fetchData]);

  const periodLabel = rangePeriodLabel(range);
  const totals = useMemo(() => sumDashboardUsageHistory(usageState.history), [usageState.history]);
  const activeKeyCount = usageState.keys.filter((key) => key.totalTokens > 0 || key.requests > 0).length;
  const agentRows = useMemo<DashboardAgentUsageRow[]>(
    () => dashboardAgentUsageRows(usageState.agents, accountAgents),
    [accountAgents, usageState.agents],
  );
  const usageUnavailable = usageState.historyStatus === "unavailable"
    || usageState.keysStatus === "unavailable"
    || usageState.agentsStatus === "unavailable";

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6 lg:px-0">
        {rosterError ? (
          <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>{rosterError}</span>
          </div>
        ) : null}
        {usageUnavailable ? (
          <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>Some usage data could not be loaded. Available sections are shown.</span>
            <button type="button" className="rounded px-1 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void fetchData()}>Retry</button>
          </div>
        ) : null}
        <div className="dashboard-overview-toolbar mb-6 border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Account usage</h1>
            <p className="mt-1 text-sm text-text-muted">Token activity across this account, grouped by UTC day.</p>
          </div>
          <DashboardTimeRangeControl value={range} onChange={setRange} />
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <DashboardMetricCard
            title="Tokens"
            value={usageState.historyStatus === "loading" ? "Loading" : usageState.historyStatus === "unavailable" ? "Unavailable" : formatDashboardTokens(totals.tokens)}
            periodLabel={periodLabel}
            icon={dashboardMetricIcons.tokens}
          />
          <DashboardMetricCard
            title="Requests"
            value={usageState.historyStatus === "loading" ? "Loading" : usageState.historyStatus === "unavailable" ? "Unavailable" : totals.requests.toLocaleString()}
            periodLabel={periodLabel}
            icon={dashboardMetricIcons.requests}
          />
          <DashboardMetricCard
            title="API keys used"
            value={usageState.keysStatus === "loading" ? "Loading" : usageState.keysStatus === "unavailable" ? "Unavailable" : activeKeyCount.toLocaleString()}
            periodLabel={periodLabel}
            icon={dashboardMetricIcons.integrations}
          />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <TokenUsagePanel history={usageState.history} periodLabel={periodLabel} status={usageState.historyStatus} />
          <IntegrationUsagePanel integrations={usageState.keys} periodLabel={periodLabel} status={usageState.keysStatus} />
        </div>

        <div className="mt-6">
          <AgentUsageTable rows={agentRows} status={usageState.agentsStatus} />
        </div>
      </div>
    </div>
  );
}
