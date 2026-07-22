"use client";

import { useRouter } from "next/navigation";

import type { Agent } from "@/app/dashboard/agents/types";
import { buildAgentWorkspaceTabHref, type AgentRouteTab } from "@/lib/agent-workspace-route";
import { resolveOpenClawSessionKey } from "@/lib/openclaw-session-key";
import { AgentWorkspaceSidebar } from "./AgentWorkspaceSidebar";

export function DashboardWorkspaceNavigation({
  selectedAgent,
  isDesktopViewport,
  agentRosterCollapsed,
  onAgentRosterCollapsedChange,
}: {
  selectedAgent: Agent | null;
  isDesktopViewport: boolean;
  agentRosterCollapsed: boolean;
  onAgentRosterCollapsedChange: (collapsed: boolean) => void;
}) {
  const router = useRouter();
  const openAgentTab = (tab: AgentRouteTab) => {
    if (!selectedAgent) return;
    router.push(buildAgentWorkspaceTabHref(selectedAgent.id, tab));
  };

  return (
    <AgentWorkspaceSidebar
      selectedAgent={selectedAgent}
      activeTab="workspace"
      isDesktopViewport={isDesktopViewport}
      collapsed={!agentRosterCollapsed}
      onCollapsedChange={(collapsed) => onAgentRosterCollapsedChange(!collapsed)}
      embeddedInNavigation
      sessions={null}
      sessionsFetched={false}
      sessionsUnavailableReason="Open the agent workspace to load sessions."
      selectedSessionKey={selectedAgent ? resolveOpenClawSessionKey(selectedAgent.id) : null}
      showDesktop={false}
      onOpenFiles={() => openAgentTab("files")}
      onOpenIntegrations={() => openAgentTab("integrations")}
      onOpenSkills={() => openAgentTab("skills")}
      onOpenScheduled={() => openAgentTab("scheduled")}
      onOpenLogs={() => openAgentTab("logs")}
      onOpenShell={() => openAgentTab("shell")}
      onOpenOpenClaw={() => openAgentTab("openclaw")}
      onOpenSettings={() => openAgentTab("settings")}
      onUpgrade={() => router.push("/plans")}
    />
  );
}
