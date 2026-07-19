"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ProfileBillingSection } from "@/components/billing/ProfileBillingSection";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { type ConversationThread } from "@/components/dashboard/AgentsChannelsSidebar";
import { AgentList } from "@/components/dashboard/agents/AgentPanels";
import { toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createAgentClient, createOpenClawAgent } from "@/lib/agent-client";
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

export default function SettingsPage() {
  const { getToken, logout, user } = useAgentAuth();
  const router = useRouter();
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
