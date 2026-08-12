"use client";

import { useRouter } from "next/navigation";

import type { Agent } from "@/app/dashboard/agents/types";
import { buildAgentWorkspaceTabHref, type AgentRouteTab } from "@/lib/agent-workspace-route";
import { buildAgentSettingsHref } from "@/lib/dashboard-route";
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
      selectedSessionKey={null}
      onOpenFiles={() => openAgentTab("files")}
      onOpenIntegrations={() => openAgentTab("integrations")}
      onOpenSkills={() => openAgentTab("skills")}
      onOpenScheduled={() => openAgentTab("scheduled")}
      onOpenDesktop={() => openAgentTab("desktop")}
      onOpenLogs={() => openAgentTab("logs")}
      onOpenShell={() => openAgentTab("shell")}
      onOpenOpenClaw={() => openAgentTab("openclaw")}
      onOpenSettings={() => router.push(buildAgentSettingsHref(selectedAgent?.id))}
      onUpgrade={() => router.push("/plans")}
    />
  );
}
