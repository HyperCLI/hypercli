"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, HardDrive, Plus, UsersRound, Zap } from "lucide-react";
import { Button } from "@hypercli/shared-ui";
import type { HyperAgentAgentUsage } from "@hypercli.com/sdk/agent";

import type { Agent } from "@/app/dashboard/agents/types";
import { TooltipHint } from "@/components/ClawTooltip";
import {
  AgentUsageTable,
  DashboardMetricCard,
  DashboardTimeRangeControl,
  TokenUsagePanel,
  formatDashboardTokens,
  rangeDays,
  rangePeriodLabel,
  type DashboardAgentUsageRow,
  type DashboardDataStatus,
  type DashboardDayData,
  type DashboardTimeRange,
} from "@/components/dashboard/DashboardAnalytics";
import { MembersSection } from "@/components/dashboard/members/MembersSection";
import { useWorkspace, workspaceDisplayName } from "@/components/dashboard/WorkspaceContext";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createHyperAgentClient, createWorkspacesClient } from "@/lib/agent-client";
import { isDashboardReleaseSurfaceAvailable } from "@/lib/dashboard-release-boundary";
import {
  dashboardAgentUsageRows,
  normalizeDashboardUsageHistory,
  sumDashboardUsageHistory,
  validateDashboardAgentUsage,
} from "@/components/dashboard/dashboard-usage";

type WorkspaceOverviewPanelProps = {
  accountAgents: Agent[];
  workspaceAgents: Agent[];
  agentsLoading: boolean;
  workspaceAgentsLoading: boolean;
  agentCreationDisabledReason: string | null;
  agentsHref: string;
  knowledgeHref: string;
  membersHref: string;
  onOpenMembers?: () => void;
  onOpenAgentLauncher: () => void;
};

async function countSharedKnowledgeFiles(token: string): Promise<number> {
  const workspaces = createWorkspacesClient(token);
  const listed = await workspaces.list();
  const files = await Promise.all(listed.map((workspace) => workspaces.listFiles(workspace.slug)));
  return files.reduce((total, entries) => total + entries.length, 0);
}

export function WorkspaceOverviewPanel({
  accountAgents,
  workspaceAgents,
  agentsLoading,
  workspaceAgentsLoading,
  agentCreationDisabledReason,
  agentsHref,
  knowledgeHref,
  membersHref,
  onOpenMembers,
  onOpenAgentLauncher,
}: WorkspaceOverviewPanelProps) {
  const { getToken, isLoading: authLoading, user } = useAgentAuth();
  const { selectedWorkspace } = useWorkspace();
  const membersAvailable = isDashboardReleaseSurfaceAvailable("members");
  const [range, setRange] = useState<DashboardTimeRange>("7d");
  const [history, setHistory] = useState<DashboardDayData[]>([]);
  const [historyStatus, setHistoryStatus] = useState<DashboardDataStatus>("loading");
  const [agentUsage, setAgentUsage] = useState<HyperAgentAgentUsage | null>(null);
  const [agentUsageStatus, setAgentUsageStatus] = useState<DashboardDataStatus>("loading");
  const [knowledgeFileCount, setKnowledgeFileCount] = useState<number | null>(null);
  const [knowledgeStatus, setKnowledgeStatus] = useState<DashboardDataStatus>("loading");
  const requestGenerationRef = useRef(0);
  const principalId = user?.id ?? null;

  const fetchOverview = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    setHistoryStatus("loading");
    setAgentUsageStatus("loading");
    setKnowledgeStatus("loading");
    if (!principalId) {
      setHistory([]);
      setHistoryStatus("unavailable");
      setAgentUsage(null);
      setAgentUsageStatus("unavailable");
      setKnowledgeFileCount(null);
      setKnowledgeStatus("unavailable");
      return;
    }
    try {
      const token = await getToken();
      const hyperAgent = createHyperAgentClient(token);
      const days = rangeDays(range);
      const [historyResult, agentUsageResult, knowledgeResult] = await Promise.allSettled([
        hyperAgent.usageHistory(days).then((value) => normalizeDashboardUsageHistory(value, days)),
        hyperAgent.agentUsage(days).then((value) => validateDashboardAgentUsage(value, days)),
        countSharedKnowledgeFiles(token),
      ]);
      if (generation !== requestGenerationRef.current) return;
      setHistory(historyResult.status === "fulfilled" ? historyResult.value : []);
      setHistoryStatus(historyResult.status === "fulfilled" ? "ready" : "unavailable");
      setAgentUsage(agentUsageResult.status === "fulfilled" ? agentUsageResult.value : null);
      setAgentUsageStatus(agentUsageResult.status === "fulfilled" ? "ready" : "unavailable");
      setKnowledgeFileCount(knowledgeResult.status === "fulfilled" ? knowledgeResult.value : null);
      setKnowledgeStatus(knowledgeResult.status === "fulfilled" ? "ready" : "unavailable");
    } catch {
      if (generation !== requestGenerationRef.current) return;
      setHistory([]);
      setHistoryStatus("unavailable");
      setAgentUsage(null);
      setAgentUsageStatus("unavailable");
      setKnowledgeFileCount(null);
      setKnowledgeStatus("unavailable");
    }
  }, [getToken, principalId, range]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void fetchOverview(); }, 0);
    return () => {
      window.clearTimeout(timeout);
      requestGenerationRef.current += 1;
    };
  }, [fetchOverview]);

  const workspaceName = selectedWorkspace ? workspaceDisplayName(selectedWorkspace) : "Knowledge Hub";
  const workspaceInitial = workspaceName.trim()[0] ?? "?";
  const memberCount = authLoading ? null : user ? 1 : 0;
  const periodLabel = rangePeriodLabel(range);
  const totals = useMemo(() => sumDashboardUsageHistory(history), [history]);
  const agentRows = useMemo<DashboardAgentUsageRow[]>(
    () => dashboardAgentUsageRows(agentUsage, accountAgents),
    [accountAgents, agentUsage],
  );
  const overviewUnavailable = historyStatus === "unavailable"
    || agentUsageStatus === "unavailable"
    || knowledgeStatus === "unavailable";

  return (
    <div className="h-full overflow-y-auto bg-background px-4 py-7 text-left text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-7 flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-base font-semibold text-[var(--selection-accent)]">
              {workspaceInitial.toUpperCase()}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-semibold leading-tight tracking-tight text-foreground">{workspaceName}</h1>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {membersAvailable && onOpenMembers ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenMembers}
                className="min-h-9 hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high"
              >
                <UsersRound className="h-3.5 w-3.5" /> Members
              </Button>
            ) : null}
            <TooltipHint label={agentCreationDisabledReason ?? "New agent"} disabled={Boolean(agentCreationDisabledReason)}>
              <Button
                type="button"
                size="sm"
                onClick={onOpenAgentLauncher}
                disabled={Boolean(agentCreationDisabledReason)}
                className="min-h-9"
              >
                <Plus className="h-3.5 w-3.5" /> New agent
              </Button>
            </TooltipHint>
          </div>
        </header>

        {overviewUnavailable ? (
          <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>Some overview data could not be loaded. Available sections are shown.</span>
            <button type="button" className="rounded px-1 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void fetchOverview()}>Retry</button>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {membersAvailable ? (
            <DashboardMetricCard
              title="Members"
              value={memberCount == null ? "---" : memberCount.toLocaleString()}
              periodLabel="Visible account access"
              icon={UsersRound}
              href={membersHref}
              compact
            />
          ) : null}
          <DashboardMetricCard
            title="Agents"
            value={workspaceAgentsLoading ? "---" : workspaceAgents.length.toLocaleString()}
            periodLabel="In this Collection"
            icon={Bot}
            href={agentsHref}
            compact
          />
          <DashboardMetricCard
            title="Knowledge files"
            value={knowledgeStatus === "loading" ? "Loading" : knowledgeStatus === "unavailable" || knowledgeFileCount == null ? "Unavailable" : knowledgeFileCount.toLocaleString()}
            periodLabel="Across Knowledge Hub"
            icon={HardDrive}
            href={knowledgeHref}
            compact
          />
          <DashboardMetricCard
            title="Account tokens"
            value={historyStatus === "loading" ? "Loading" : historyStatus === "unavailable" ? "Unavailable" : formatDashboardTokens(totals.tokens)}
            periodLabel={`${periodLabel}, across account`}
            icon={Zap}
            compact
            accent
          />
        </div>

        <div className="mt-5 flex justify-end">
          <DashboardTimeRangeControl value={range} onChange={setRange} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TokenUsagePanel history={history} periodLabel={periodLabel} status={historyStatus} title="Account token usage" />
          {membersAvailable ? <MembersSection compact agents={accountAgents} agentsLoading={agentsLoading} /> : null}
        </div>

        <div className="mt-4">
          <AgentUsageTable rows={agentRows} status={agentUsageStatus} title="Account usage by agent" />
        </div>
      </div>
    </div>
  );
}
