"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, HardDrive, Plus, UsersRound, Zap } from "lucide-react";
import { Button } from "@hypercli/shared-ui";
import type { HyperAgentKeyUsage, HyperAgentUsageHistory } from "@hypercli.com/sdk/agent";

import type { Agent } from "@/app/dashboard/agents/types";
import { TooltipHint } from "@/components/ClawTooltip";
import {
  AgentUsageTable,
  DashboardMetricCard,
  DashboardTimeRangeControl,
  TokenUsagePanel,
  formatDashboardTokens,
  hasCollectedData,
  rangeDays,
  rangePeriodLabel,
  type DashboardAgentUsageRow,
  type DashboardDayData,
  type DashboardIntegrationUsage,
  type DashboardTimeRange,
} from "@/components/dashboard/DashboardAnalytics";
import { MembersSection } from "@/components/dashboard/members/MembersSection";
import { useWorkspace, workspaceDisplayName } from "@/components/dashboard/WorkspaceContext";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createHyperAgentClient, createWorkspacesClient } from "@/lib/agent-client";
import { integrationDisplayName } from "@/lib/integration-display-name";
import { relativeTime } from "@/components/dashboard/agentViewUtils";

type WorkspaceOverviewPanelProps = {
  accountAgents: Agent[];
  workspaceAgents: Agent[];
  agentsLoading: boolean;
  workspaceAgentsLoading: boolean;
  agentCreationDisabledReason: string | null;
  agentsHref: string;
  knowledgeHref: string;
  membersHref: string;
  onOpenMembers: () => void;
  onOpenAgentLauncher: () => void;
};

function timestampFromIso(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
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
  const [range, setRange] = useState<DashboardTimeRange>("7d");
  const [history, setHistory] = useState<DashboardDayData[]>([]);
  const [integrations, setIntegrations] = useState<DashboardIntegrationUsage[]>([]);
  const [knowledgeFileCount, setKnowledgeFileCount] = useState<number | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const token = await getToken();
      const hyperAgent = createHyperAgentClient(token);
      const [historyResult, integrationsResult, knowledgeResult] = await Promise.allSettled([
        hyperAgent.usageHistory(rangeDays(range)),
        hyperAgent.keyUsage(rangeDays(range)),
        countSharedKnowledgeFiles(token),
      ]);
      setHistory(historyResult.status === "fulfilled" ? normalizeHistory(historyResult.value) : []);
      setIntegrations(integrationsResult.status === "fulfilled" ? normalizeKeyUsage(integrationsResult.value) : []);
      setKnowledgeFileCount(knowledgeResult.status === "fulfilled" ? knowledgeResult.value : null);
    } catch {
      setHistory([]);
      setIntegrations([]);
      setKnowledgeFileCount(null);
    } finally {
      setOverviewLoading(false);
    }
  }, [getToken, range]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void fetchOverview(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchOverview]);

  const workspaceName = selectedWorkspace ? workspaceDisplayName(selectedWorkspace) : "Workspace";
  const workspaceInitial = workspaceName.trim()[0] ?? "?";
  const memberCount = authLoading ? null : user ? 1 : 0;
  const periodLabel = rangePeriodLabel(range);
  const totals = useMemo(() => history.reduce((current, day) => ({
    tokens: current.tokens + day.totalTokens,
    requests: current.requests + day.requests,
  }), { tokens: 0, requests: 0 }), [history]);
  const hasUsageData = hasCollectedData(history, integrations);
  const activeIntegrationCount = integrations.filter((integration) => integration.totalTokens > 0 || integration.requests > 0).length;
  const agentRows = useMemo<DashboardAgentUsageRow[]>(() => {
    const canAttributeUsage = accountAgents.length === 1 && hasUsageData;
    return workspaceAgents.map((agent) => {
      const updatedAt = timestampFromIso(agent.updated_at ?? agent.started_at);
      return {
        id: agent.id,
        name: agent.name || agent.id,
        status: agent.state,
        integrations: canAttributeUsage ? activeIntegrationCount : null,
        requests: canAttributeUsage ? totals.requests : null,
        tokens: canAttributeUsage ? totals.tokens : null,
        lastActivity: updatedAt > 0 ? relativeTime(updatedAt) : null,
      };
    });
  }, [accountAgents.length, activeIntegrationCount, hasUsageData, totals.requests, totals.tokens, workspaceAgents]);

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-7 flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-base font-semibold text-[var(--selection-accent)]">
              {workspaceInitial.toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Workspace overview</p>
              <h1 className="mt-1 truncate text-[22px] font-semibold leading-tight tracking-tight text-foreground">{workspaceName}</h1>
              <p className="mt-1 text-[12px] text-text-muted">
                {memberCount ?? "-"} {memberCount === 1 ? "member" : "members"} · {workspaceAgentsLoading ? "-" : workspaceAgents.length} {workspaceAgents.length === 1 ? "agent" : "agents"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenMembers}
              className="min-h-9 hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high"
            >
              <UsersRound className="h-3.5 w-3.5" /> Members
            </Button>
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

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <DashboardMetricCard
            title="Members"
            value={memberCount == null ? "---" : memberCount.toLocaleString()}
            periodLabel="Visible account access"
            icon={UsersRound}
            href={membersHref}
            compact
          />
          <DashboardMetricCard
            title="Agents"
            value={workspaceAgentsLoading ? "---" : workspaceAgents.length.toLocaleString()}
            periodLabel="In this Workspace"
            icon={Bot}
            href={agentsHref}
            compact
          />
          <DashboardMetricCard
            title="Knowledge files"
            value={overviewLoading || knowledgeFileCount == null ? "---" : knowledgeFileCount.toLocaleString()}
            periodLabel="Across shared knowledge"
            icon={HardDrive}
            href={knowledgeHref}
            compact
          />
          <DashboardMetricCard
            title="Tokens"
            value={overviewLoading || totals.tokens === 0 ? "---" : formatDashboardTokens(totals.tokens)}
            periodLabel={periodLabel}
            icon={Zap}
            compact
            accent
          />
        </div>

        <div className="mt-5 flex justify-end">
          <DashboardTimeRangeControl value={range} onChange={setRange} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TokenUsagePanel history={overviewLoading ? [] : history} periodLabel={periodLabel} />
          <MembersSection compact agents={accountAgents} agentsLoading={agentsLoading} />
        </div>

        <div className="mt-4">
          <AgentUsageTable rows={workspaceAgents.length === 0 ? [] : agentRows} />
        </div>
      </div>
    </div>
  );
}
