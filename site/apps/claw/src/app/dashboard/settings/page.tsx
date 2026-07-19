"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare } from "lucide-react";
import { getSlackInstallStatus, type SlackInstallStatus } from "@hypercli.com/sdk/agents";

import { ProfileBillingSection } from "@/components/billing/ProfileBillingSection";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { type ConversationThread } from "@/components/dashboard/AgentsChannelsSidebar";
import { AgentList } from "@/components/dashboard/agents/AgentPanels";
import { toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createAgentClient, createOpenClawAgent } from "@/lib/agent-client";
import { SLACK_APP_HANDLE, SLACK_RELAY_BASE_URL } from "@/lib/api";
import { resolveOpenClawSessionKey } from "@/lib/openclaw-session-key";
import type { SdkAgent } from "@/types";

const AGENTS_DESKTOP_MEDIA_QUERY = "(min-width: 640px)";

function describeAgentListError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not load agents.";
}

function timestampFromIso(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function SlackSettingsSection({
  getToken,
  oauthError,
  oauthOk,
  oauthTeamId,
}: {
  getToken: () => Promise<string>;
  oauthError: string | null;
  oauthOk: boolean;
  oauthTeamId: string | null;
}) {
  const [status, setStatus] = useState<SlackInstallStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
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
    void refreshStatus();
  }, [refreshStatus]);

  const connected = status?.connected === true;
  const workspace = status?.teamName || status?.teamId || (oauthTeamId ? `Team ${oauthTeamId}` : null);

  return (
    <section className="mb-6 border-b border-border pb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-[var(--selection-accent)]" />
            <h2 className="text-lg font-semibold leading-6 text-foreground">Slack</h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            {connected ? `Connected${workspace ? ` to ${workspace}` : ""}.` : `Install the HyperCLI Slack App as @${SLACK_APP_HANDLE}.`}
          </p>
          {oauthOk ? (
            <p className="mt-2 text-xs font-medium text-[var(--selection-accent)]">
              Slack authorization completed{oauthTeamId ? ` for ${oauthTeamId}` : ""}.
            </p>
          ) : null}
          {oauthError ? (
            <p className="mt-2 text-xs font-medium text-destructive">Slack authorization failed: {oauthError}.</p>
          ) : null}
          {error ? <p className="mt-2 text-xs font-medium text-destructive">{error}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/slack/start"
            className="rounded-lg border border-[rgb(var(--selection-accent-rgb)_/_0.45)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] px-4 py-2 text-sm font-medium text-[var(--selection-accent)]"
          >
            Connect Slack
          </Link>
          <Link href="/slack/status" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground">
            Status
          </Link>
          <button
            type="button"
            onClick={() => { void refreshStatus(); }}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Refresh
          </button>
        </div>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const { getToken, logout, user } = useAgentAuth();
  const router = useRouter();
  const [slackOauthResult, setSlackOauthResult] = useState<{ ok: boolean; error: string | null; teamId: string | null } | null>(null);
  const [sdkAgents, setSdkAgents] = useState<SdkAgent[]>([]);
  const [selectedAgentId, setSelectedAgentIdState] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  const fetchAgents = useCallback(async () => {
    try {
      const token = await getToken();
      const listedAgents = await createAgentClient(token).list();
      setSdkAgents(listedAgents);
      setSelectedAgentIdState((currentId) => {
        if (currentId && listedAgents.some((agent) => agent.id === currentId)) return currentId;
        return listedAgents[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      setSdkAgents([]);
      setSelectedAgentIdState(null);
      setError(describeAgentListError(err));
    }
  }, [getToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void fetchAgents(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchAgents]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("integrationId") !== "slack") return;
    setSlackOauthResult({
      ok: searchParams.get("ok") === "true",
      error: searchParams.get("ok") === "false" ? searchParams.get("error")?.trim() || "oauth_failed" : null,
      teamId: searchParams.get("team_id")?.trim() || null,
    });
  }, []);

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
      setSdkAgents((current) => current.filter((agent) => agent.id !== pendingAgentDelete.id));
      setSelectedAgentIdState((currentId) => (currentId === pendingAgentDelete.id ? null : currentId));
      setPendingAgentDelete(null);
    } catch (err) {
      setError(describeAgentListError(err));
    } finally {
      setDeletingId(null);
    }
  }, [getToken, pendingAgentDelete]);

  const accountInitial = user?.email?.trim()[0]?.toUpperCase() || "?";
  const oauthOk = slackOauthResult?.ok === true;
  const oauthError = slackOauthResult?.error ?? null;
  const oauthTeamId = slackOauthResult?.teamId ?? null;

  return (
    <div className="flex h-full min-h-0 bg-background">
      <AgentList
        sidebarCollapsed={sidebarCollapsed}
        isDesktopViewport={isDesktopViewport}
        mobileShowChat={mobileShowChat}
        agents={agents}
        selectedAgentId={selectedAgentId}
        setSelectedAgentId={openAgentWorkspace}
        setMobileShowChat={setMobileShowChat}
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
        onLogout={logout}
      />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6 lg:px-0">
          {error ? (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#d05f5f]/25 bg-[#d05f5f]/10 px-4 py-3 text-sm text-[#ff6b6b]">
              <span>{error}</span>
              <button type="button" className="font-medium text-foreground" onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          ) : null}
          <SlackSettingsSection getToken={getToken} oauthOk={oauthOk} oauthError={oauthError} oauthTeamId={oauthTeamId} />
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
