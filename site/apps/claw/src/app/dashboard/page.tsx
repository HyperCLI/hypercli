"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, HardDrive, Plus, UsersRound, Zap } from "lucide-react";
import { Button } from "@hypercli/shared-ui";

import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import type { ConversationThread } from "@/components/dashboard/AgentsChannelsSidebar";
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
import { AgentList } from "@/components/dashboard/agents/AgentPanels";
import { DashboardWorkspaceNavigation } from "@/components/dashboard/agents/DashboardWorkspaceNavigation";
import { toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { relativeTime } from "@/components/dashboard/agentViewUtils";
import { MembersSection } from "@/components/dashboard/members/MembersSection";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { useAgentRosterCollapsed } from "@/hooks/useAgentRosterCollapsed";
import { createAgentClient, createHyperAgentClient, createOpenClawAgent, createWorkspacesClient } from "@/lib/agent-client";
import { displayNameForDashboard } from "@/lib/dashboard-greeting";
import { integrationDisplayName } from "@/lib/integration-display-name";
import { resolveOpenClawSessionKey } from "@/lib/openclaw-session-key";
import type { SdkAgent } from "@/types";
import type { HyperAgentKeyUsage, HyperAgentUsageHistory } from "@hypercli.com/sdk/agent";

const AGENTS_DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

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

export default function DashboardPage() {
  const { getToken, isLoading: authLoading, logout, user } = useAgentAuth();
  const router = useRouter();
  const [range, setRange] = useState<DashboardTimeRange>("7d");
  const [history, setHistory] = useState<DashboardDayData[]>([]);
  const [integrations, setIntegrations] = useState<DashboardIntegrationUsage[]>([]);
  const [knowledgeFileCount, setKnowledgeFileCount] = useState<number | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [sdkAgents, setSdkAgents] = useState<SdkAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useAgentRosterCollapsed();
  const [error, setError] = useState<string | null>(null);
  const [pendingAgentDelete, setPendingAgentDelete] = useState<{ id: string; name: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
    return window.matchMedia(AGENTS_DESKTOP_MEDIA_QUERY).matches;
  });

  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(AGENTS_DESKTOP_MEDIA_QUERY);
    const apply = () => setIsDesktopViewport(mediaQuery.matches);
    apply();
    mediaQuery.addEventListener("change", apply);
    return () => mediaQuery.removeEventListener("change", apply);
  }, []);

  const fetchAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const token = await getToken();
      setSdkAgents(await createAgentClient(token).list());
      setError(null);
    } catch (cause) {
      setSdkAgents([]);
      setError(cause instanceof Error ? cause.message : "Could not load agents.");
    } finally {
      setAgentsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void fetchAgents(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchAgents]);

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

  const updateAgentName = useCallback(async (agentId: string, name: string) => {
    const token = await getToken();
    const updatedAgent = await createAgentClient(token).update(agentId, { name });
    setSdkAgents((current) => current.map((agent) => agent.id === agentId ? updatedAgent : agent));
  }, [getToken]);

  const deletePendingAgent = useCallback(async () => {
    if (!pendingAgentDelete) return;
    setDeletingId(pendingAgentDelete.id);
    try {
      const token = await getToken();
      await createAgentClient(token).delete(pendingAgentDelete.id);
      setSdkAgents((current) => current.filter((agent) => agent.id !== pendingAgentDelete.id));
      setPendingAgentDelete(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete agent.");
    } finally {
      setDeletingId(null);
    }
  }, [getToken, pendingAgentDelete]);

  const agents = useMemo(() => sdkAgents.map(toAgentViewModel), [sdkAgents]);
  const syntheticThreads = useMemo<ConversationThread[]>(() => agents.map((agent) => ({
    id: agent.id,
    sessionKey: resolveOpenClawSessionKey(agent.id),
    participants: [
      { id: "user", name: "You", type: "user" as const },
      { id: agent.id, name: agent.name || agent.id, type: "agent" as const, meta: agent.meta ?? null },
    ],
    kind: "user-agent" as const,
    title: agent.name || agent.pod_name || agent.id,
    lastMessage: agent.state === "RUNNING" ? "Connected" : agent.state.toLowerCase(),
    lastMessageBy: agent.id,
    lastMessageAt: timestampFromIso(agent.updated_at),
    messageCount: 0,
    unreadCount: 0,
    isActive: agent.state === "RUNNING",
  })), [agents]);
  const displayName = displayNameForDashboard(user);
  const workspaceName = displayName === "there" ? "Your workspace" : `${displayName}'s workspace`;
  const accountInitial = (displayName !== "there" ? displayName[0] : user?.email?.[0]) ?? "?";
  const memberCount = authLoading ? null : user ? 1 : 0;
  const periodLabel = rangePeriodLabel(range);
  const totals = useMemo(() => history.reduce((current, day) => ({
    tokens: current.tokens + day.totalTokens,
    requests: current.requests + day.requests,
  }), { tokens: 0, requests: 0 }), [history]);
  const hasUsageData = hasCollectedData(history, integrations);
  const activeIntegrationCount = integrations.filter((integration) => integration.totalTokens > 0 || integration.requests > 0).length;
  const agentRows = useMemo<DashboardAgentUsageRow[]>(() => {
    const canAttributeUsage = agents.length === 1 && hasUsageData;
    return agents.map((agent) => {
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
  }, [activeIntegrationCount, agents, hasUsageData, totals.requests, totals.tokens]);

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <div
        className="agent-desktop-navigation flex h-full min-h-0 shrink-0"
        data-roster-collapsed={sidebarCollapsed}
      >
        <AgentList
          sidebarCollapsed={sidebarCollapsed}
          isDesktopViewport={isDesktopViewport}
          mobileShowChat
          agents={agents}
          selectedAgentId={agents[0]?.id ?? null}
          setSelectedAgentId={(agentId) => router.push(`/dashboard/agents?agentId=${encodeURIComponent(agentId)}`)}
          setMobileShowChat={() => undefined}
          setSidebarCollapsed={setSidebarCollapsed}
          syntheticThreads={syntheticThreads}
          getToken={getToken}
          createOpenClawAgent={createOpenClawAgent}
          fetchAgents={fetchAgents}
          setError={setError}
          sidebarCreatorSignal={0}
          setPendingAgentDelete={setPendingAgentDelete}
          updateAgentName={updateAgentName}
          accountInitial={accountInitial}
          homeActive
          onLogout={logout}
        />
        <DashboardWorkspaceNavigation
          selectedAgent={agents[0] ?? null}
          isDesktopViewport={isDesktopViewport}
          workspaceName={workspaceName}
          workspaceInitial={accountInitial}
        />
      </div>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {error ? (
          <div role="alert" className="m-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>{error}</span>
            <button type="button" className="font-medium text-foreground" onClick={() => setError(null)}>Dismiss</button>
          </div>
        ) : null}
        <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
          <header className="mb-7 flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-base font-semibold text-[var(--selection-accent)] shadow-[0_12px_32px_rgb(var(--selection-accent-rgb)_/_0.08)]">
                {accountInitial.toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Workspace overview</p>
                <h1 className="mt-1 truncate text-[22px] font-semibold leading-tight tracking-tight text-foreground">{workspaceName}</h1>
                <p className="mt-1 text-[12px] text-text-muted">
                  {memberCount ?? "-"} {memberCount === 1 ? "member" : "members"} · {agents.length} {agents.length === 1 ? "agent" : "agents"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.push("/dashboard/agents?section=members")}
                className="min-h-9 hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high"
              >
                <UsersRound className="h-3.5 w-3.5" /> Members
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => router.push("/dashboard/agents?open=agent-launcher")}
                className="min-h-9"
              >
                <Plus className="h-3.5 w-3.5" /> New agent
              </Button>
            </div>
          </header>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <DashboardMetricCard
              title="Members"
              value={memberCount == null ? "---" : memberCount.toLocaleString()}
              periodLabel="Visible account access"
              icon={UsersRound}
              href="/dashboard/agents?section=members"
              compact
            />
            <DashboardMetricCard
              title="Agents"
              value={agentsLoading ? "---" : agents.length.toLocaleString()}
              periodLabel="Across this account"
              icon={Bot}
              href="/dashboard/agents"
              compact
            />
            <DashboardMetricCard
              title="Knowledge files"
              value={overviewLoading || knowledgeFileCount == null ? "---" : knowledgeFileCount.toLocaleString()}
              periodLabel="Across shared knowledge"
              icon={HardDrive}
              href="/dashboard/agents?section=knowledge"
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
            <MembersSection compact />
          </div>

          <div className="mt-4">
            <AgentUsageTable rows={agents.length === 0 ? [] : agentRows} />
          </div>
        </div>
      </main>

      <ConfirmDialog
        open={Boolean(pendingAgentDelete)}
        title="Delete agent"
        message={pendingAgentDelete ? `Delete agent "${pendingAgentDelete.name}"? This cannot be undone.` : ""}
        confirmLabel="Delete"
        danger
        loading={Boolean(pendingAgentDelete && deletingId === pendingAgentDelete.id)}
        onCancel={() => setPendingAgentDelete(null)}
        onConfirm={() => { void deletePendingAgent(); }}
      />
    </div>
  );
}
