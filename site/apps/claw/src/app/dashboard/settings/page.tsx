"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, MessageSquare, RefreshCw } from "lucide-react";
import { getSlackInstallStatus, type SlackInstallStatus } from "@hypercli.com/sdk/agents";
import { ThemeSelector } from "@hypercli/shared-ui";

import { ProfileBillingSection } from "@/components/billing/ProfileBillingSection";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { type ConversationThread } from "@/components/dashboard/AgentsChannelsSidebar";
import { AgentList } from "@/components/dashboard/agents/AgentPanels";
import { toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { DashboardWorkspaceNavigation } from "@/components/dashboard/agents/DashboardWorkspaceNavigation";
import { TooltipHint } from "@/components/ClawTooltip";
import { useWorkspace, workspaceAgentCreationDisabledReason } from "@/components/dashboard/WorkspaceContext";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { useAgentRosterCollapsed } from "@/hooks/useAgentRosterCollapsed";
import { createAgentClient, createOpenClawAgent } from "@/lib/agent-client";
import { SLACK_APP_HANDLE, SLACK_RELAY_BASE_URL } from "@/lib/api";
import { resolveOpenClawSessionKey } from "@/lib/openclaw-session-key";
import type { SdkAgent } from "@/types";

const AGENTS_DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

function describeAgentListError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not load agents.";
}

function timestampFromIso(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function SlackAccountSection({ getToken }: { getToken: () => Promise<string> }) {
  const [status, setStatus] = useState<SlackInstallStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!SLACK_RELAY_BASE_URL) {
      setStatus(null);
      setError("Slack relay is not configured for this environment.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      setStatus(await getSlackInstallStatus({ relayBaseUrl: SLACK_RELAY_BASE_URL, token }));
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Could not load Slack status.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const connected = status?.connected === true;
  return (
    <section className="mb-5 rounded-[12px] border border-border bg-surface-low p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--selection-accent)]" />
            ) : connected ? (
              <CheckCircle2 className="h-5 w-5 text-[var(--selection-accent)]" />
            ) : (
              <MessageSquare className="h-5 w-5 text-text-secondary" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Slack</h2>
            <p className="mt-1 text-sm leading-6 text-text-muted">
              {connected
                ? `@${SLACK_APP_HANDLE} is connected${status?.teamName ? ` to ${status.teamName}` : ""}.`
                : `Connect @${SLACK_APP_HANDLE} once, then attach individual agents from their Slack integration page.`}
            </p>
            {status?.teamId ? <p className="mt-2 font-mono text-xs text-text-muted">Team {status.teamId}</p> : null}
            {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <Link href="/slack/status" className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground">
            Debug
          </Link>
          {connected ? (
            <TooltipHint label="Disconnect from Slack workspace app settings." disabled>
              <button type="button" disabled className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-text-secondary opacity-60">
                Disconnect Slack
              </button>
            </TooltipHint>
          ) : null}
          <Link href="/slack/start" className="inline-flex h-9 items-center rounded-lg border border-[rgb(var(--selection-accent-rgb)_/_0.45)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] px-3 text-xs font-semibold text-[var(--selection-accent)] transition-colors hover:bg-[rgb(var(--selection-accent-rgb)_/_0.18)]">
            {connected ? "Reconnect Slack" : "Connect Slack"}
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const { getToken, logout, user } = useAgentAuth();
  const {
    selectedWorkspace,
    selectedWorkspaceAgentIds,
    isAgentRosterLoading,
    agentRosterError,
    associateAgentWithSelectedWorkspace,
  } = useWorkspace();
  const router = useRouter();
  const [sdkAgents, setSdkAgents] = useState<SdkAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [selectedAgentId, setSelectedAgentIdState] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useAgentRosterCollapsed();
  const [mobileShowChat, setMobileShowChat] = useState(true);
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

  const accountAgents = useMemo(() => sdkAgents.map(toAgentViewModel), [sdkAgents]);
  const selectedWorkspaceAgentIdSet = useMemo(
    () => new Set(selectedWorkspaceAgentIds),
    [selectedWorkspaceAgentIds],
  );
  const workspaceAgents = useMemo(
    () => isAgentRosterLoading || agentRosterError
      ? []
      : accountAgents.filter((agent) => selectedWorkspaceAgentIdSet.has(agent.id)),
    [accountAgents, agentRosterError, isAgentRosterLoading, selectedWorkspaceAgentIdSet],
  );
  const syntheticThreads = useMemo<ConversationThread[]>(() => workspaceAgents.map((agent) => ({
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
  })), [workspaceAgents]);

  const fetchAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const token = await getToken();
      const listedAgents = await createAgentClient(token).list();
      setSdkAgents(listedAgents);
      setError(null);
      return true;
    } catch (err) {
      setSdkAgents([]);
      setSelectedAgentIdState(null);
      setError(describeAgentListError(err));
      return false;
    } finally {
      setAgentsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void fetchAgents(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchAgents]);

  const openAgentWorkspace = useCallback((agentId: string) => {
    setSelectedAgentIdState(agentId);
    router.push(`/dashboard/agents?agentId=${encodeURIComponent(agentId)}`);
  }, [router]);

  const updateAgentName = useCallback(async (agentId: string, name: string) => {
    const token = await getToken();
    const updatedAgent = await createAgentClient(token).update(agentId, { name });
    setSdkAgents((current) => current.map((agent) => (agent.id === agentId ? updatedAgent : agent)));
  }, [getToken]);

  const deletePendingAgent = useCallback(async () => {
    if (!pendingAgentDelete) return;
    setDeletingId(pendingAgentDelete.id);
    try {
      const token = await getToken();
      await createAgentClient(token).delete(pendingAgentDelete.id);
      const nextSelectedAgentId = workspaceAgents.find((agent) => agent.id !== pendingAgentDelete.id)?.id ?? null;
      setSdkAgents((current) => current.filter((agent) => agent.id !== pendingAgentDelete.id));
      setSelectedAgentIdState((currentId) => {
        const currentWorkspaceAgentId = currentId && workspaceAgents.some((agent) => agent.id === currentId)
          ? currentId
          : workspaceAgents[0]?.id ?? null;
        return currentWorkspaceAgentId === pendingAgentDelete.id ? nextSelectedAgentId : currentWorkspaceAgentId;
      });
      setPendingAgentDelete(null);
    } catch (err) {
      setError(describeAgentListError(err));
    } finally {
      setDeletingId(null);
    }
  }, [getToken, pendingAgentDelete, workspaceAgents]);

  const accountInitial = user?.email?.trim()[0]?.toUpperCase() || "?";
  const selectedWorkspaceAgent = workspaceAgents.find((agent) => agent.id === selectedAgentId) ?? workspaceAgents[0] ?? null;
  const pageError = agentRosterError || error;
  const agentCreationDisabledReason = workspaceAgentCreationDisabledReason(selectedWorkspace, agentRosterError);

  return (
    <div className="flex h-full min-h-0 bg-background">
      <div
        className={`agent-desktop-navigation relative flex h-full min-h-0 shrink-0 flex-col pt-14 ${isDesktopViewport ? "w-64" : "w-0"}`}
        data-roster-collapsed={sidebarCollapsed}
        data-expanded-section={sidebarCollapsed ? "workspace" : "agents"}
      >
        <div className="agent-desktop-navigation-sections relative isolate mt-2 flex min-h-0 w-full flex-1">
        <AgentList
          sidebarCollapsed={sidebarCollapsed}
          isDesktopViewport={isDesktopViewport}
          mobileShowChat={mobileShowChat}
          agents={workspaceAgents}
          rosterLoading={agentsLoading || isAgentRosterLoading}
          rosterOrderScope={selectedWorkspace?.id}
          selectedAgentId={selectedWorkspaceAgent?.id ?? null}
          setSelectedAgentId={openAgentWorkspace}
          setMobileShowChat={setMobileShowChat}
          setSidebarCollapsed={setSidebarCollapsed}
          syntheticThreads={syntheticThreads}
          getToken={getToken}
          createOpenClawAgent={createOpenClawAgent}
          associateCreatedAgent={associateAgentWithSelectedWorkspace}
          agentCreationDisabledReason={agentCreationDisabledReason}
          fetchAgents={fetchAgents}
          setError={setError}
          sidebarCreatorSignal={0}
          setPendingAgentDelete={setPendingAgentDelete}
          updateAgentName={updateAgentName}
          accountInitial={accountInitial}
          embeddedInNavigation
          onLogout={logout}
        />
        <DashboardWorkspaceNavigation
          selectedAgent={selectedWorkspaceAgent}
          isDesktopViewport={isDesktopViewport}
          agentRosterCollapsed={sidebarCollapsed}
          onAgentRosterCollapsedChange={setSidebarCollapsed}
        />
        <div aria-hidden="true" className="pointer-events-none absolute -top-2 bottom-0 right-0 z-[60] w-px bg-border" />
        </div>
      </div>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6 lg:px-0">
          {pageError ? (
            <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <span>{pageError}</span>
              {!agentRosterError ? <button type="button" className="font-medium text-foreground" onClick={() => setError(null)}>
                Dismiss
              </button> : null}
            </div>
          ) : null}
          <section className="mb-5 rounded-xl border border-border bg-surface-low p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Appearance</h2>
                <p className="mt-1 text-sm text-text-muted">Choose how HyperCLI looks across all apps.</p>
              </div>
              <ThemeSelector aria-label="Appearance theme" />
            </div>
          </section>
          <SlackAccountSection getToken={getToken} />
          <ProfileBillingSection getToken={getToken} />
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
