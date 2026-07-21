"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Reorder } from "framer-motion";
import { Plus } from "lucide-react";
import {
  AgentsChannelsSidebar,
  AgentsSidebarDashboardLinks,
  type ConversationThread,
} from "@/components/dashboard/AgentsChannelsSidebar";
import { isAgentOffline } from "@/app/dashboard/agents/types";
import { CollapsedAgentReorderItem } from "@/components/dashboard/agents/CollapsedAgentReorderItem";
import { HyperCLILogoMark } from "@/components/HyperCLILogoLink";
import { ResourceImage } from "@/components/ResourceImage";
import { agentAvatar, type AgentMeta } from "@/lib/avatar";
import { resolveOpenClawSessionKey } from "@/lib/openclaw-session-key";
import { moveAgentInRosterOrder, useAgentRosterOrder } from "@/hooks/useAgentRosterOrder";

const AGENT_LAUNCHER_HREF = "/dashboard/agents?open=agent-launcher";

export interface DashboardRailAgent {
  id: string;
  name: string;
  state?: string | null;
  meta?: AgentMeta | null;
  updatedAt?: string | null;
}

interface DashboardAgentRailProps {
  agents: DashboardRailAgent[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  accountInitial?: string;
  onLogout?: () => void | Promise<void>;
}

function stateDotClass(state: string | null | undefined) {
  switch (state) {
    case "RUNNING":
      return "bg-primary";
    case "FAILED":
    case "RESTORE_FAILED":
    case "SYNC_FAILED":
      return "bg-destructive";
    case "STOPPED":
      return "bg-text-muted";
    default:
      return "bg-warning";
  }
}

export function DashboardAgentRail({
  agents,
  collapsed,
  onCollapsedChange,
  accountInitial = "?",
  onLogout,
}: DashboardAgentRailProps) {
  const router = useRouter();
  const [showOfflineAgents, setShowOfflineAgents] = useState(false);
  const initial = accountInitial.trim()[0]?.toUpperCase() || "?";
  const agentIds = useMemo(() => agents.map((agent) => agent.id), [agents]);
  const { orderedAgentIds, setVisibleAgentOrder } = useAgentRosterOrder(agentIds);
  const orderedAgents = useMemo(() => {
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    return orderedAgentIds
      .map((agentId) => agentById.get(agentId))
      .filter((agent): agent is DashboardRailAgent => Boolean(agent));
  }, [agents, orderedAgentIds]);
  const offlineAgentCount = useMemo(
    () => orderedAgents.filter((agent) => isAgentOffline(agent.state)).length,
    [orderedAgents],
  );
  const visibleAgents = useMemo(
    () => showOfflineAgents ? orderedAgents : orderedAgents.filter((agent) => !isAgentOffline(agent.state)),
    [orderedAgents, showOfflineAgents],
  );
  const visibleAgentIds = useMemo(() => visibleAgents.map((agent) => agent.id), [visibleAgents]);
  const moveVisibleAgent = useCallback(
    (agentId: string, direction: -1 | 1) => {
      setVisibleAgentOrder(moveAgentInRosterOrder(visibleAgentIds, agentId, direction));
    },
    [setVisibleAgentOrder, visibleAgentIds],
  );
  const syntheticThreads = useMemo<ConversationThread[]>(
    () =>
      visibleAgents.map((agent) => ({
        id: agent.id,
        sessionKey: resolveOpenClawSessionKey(agent.id),
        participants: [
          { id: "user", name: "You", type: "user" as const },
          { id: agent.id, name: agent.name || agent.id, type: "agent" as const, meta: agent.meta ?? null },
        ],
        kind: "user-agent" as const,
        title: agent.name || agent.id,
        lastMessage: agent.state === "RUNNING" ? "Connected" : (agent.state ?? "inactive").toLowerCase(),
        lastMessageBy: agent.id,
        lastMessageAt: agent.updatedAt ? new Date(agent.updatedAt).getTime() : 0,
        messageCount: 0,
        unreadCount: 0,
        isActive: agent.state === "RUNNING",
      })),
    [visibleAgents],
  );

  const openAgent = (agentId: string) => {
    router.push(`/dashboard/agents?agentId=${encodeURIComponent(agentId)}`);
  };

  return (
    <aside
      className="dashboard-agent-rail flex h-full flex-shrink-0 flex-col overflow-visible border-r border-border bg-surface-low transition-[width] duration-200"
      style={{ width: collapsed ? 56 : 280 }}
      aria-label="Agents"
    >
      {collapsed ? (
        <>
          <div className="flex h-14 items-center justify-center border-b border-border">
            <button
              type="button"
              aria-label="Expand agents sidebar"
              title="Expand sidebar"
              onClick={() => onCollapsedChange(false)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
            >
              <HyperCLILogoMark className="h-[17px] w-[17px]" />
            </button>
          </div>

          <div className="flex flex-1 flex-col items-center gap-3 overflow-y-auto py-3">
            <Link
              href={AGENT_LAUNCHER_HREF}
              aria-label="Create agent"
              title="Create agent"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary transition-colors hover:border-primary/45 hover:bg-primary/15"
            >
              <Plus className="h-4 w-4" />
            </Link>

            <Reorder.Group
              as="div"
              axis="y"
              values={visibleAgentIds}
              onReorder={setVisibleAgentOrder}
              className="flex flex-col items-center gap-3"
            >
              {visibleAgents.map((agent) => (
                <CollapsedAgentReorderItem
                  key={agent.id}
                  agentId={agent.id}
                  agentName={agent.name || agent.id}
                  canReorder={visibleAgents.length > 1}
                  onMove={(direction) => moveVisibleAgent(agent.id, direction)}
                >
                  <AgentAvatarLink agent={agent} compact />
                </CollapsedAgentReorderItem>
              ))}
            </Reorder.Group>
          </div>

          <AgentsSidebarDashboardLinks compact accountInitial={initial} onLogout={onLogout} />
        </>
      ) : (
        <AgentsChannelsSidebar
          variant="v3"
          showDivider={false}
          fillParent
          threads={syntheticThreads}
          selectedThreadId={null}
          showChannels={false}
          offlineAgentCount={offlineAgentCount}
          showOfflineAgents={showOfflineAgents}
          onShowOfflineAgentsChange={setShowOfflineAgents}
          onReorderAgents={setVisibleAgentOrder}
          accountInitial={initial}
          onLogout={onLogout}
          onCollapse={() => onCollapsedChange(true)}
          onSelectThread={openAgent}
          onStartAgentChat={(agent) => openAgent(agent.id)}
          onOpenAgentLauncher={() => {
            router.push(AGENT_LAUNCHER_HREF);
          }}
        />
      )}
    </aside>
  );
}

function AgentAvatarLink({
  agent,
  compact = false,
}: {
  agent: DashboardRailAgent;
  compact?: boolean;
}) {
  return (
    <Link
      href={`/dashboard/agents?agentId=${encodeURIComponent(agent.id)}`}
      aria-label={`Open ${agent.name || agent.id}`}
      title={agent.name || agent.id}
      className="transition-transform hover:scale-110"
    >
      <AgentAvatarVisual agent={agent} compact={compact} />
    </Link>
  );
}

function AgentAvatarVisual({
  agent,
  compact = false,
}: {
  agent: DashboardRailAgent;
  compact?: boolean;
}) {
  const avatar = agentAvatar(agent.name || agent.id, agent.meta);
  const Icon = avatar.icon;

  return (
    <span
      className={`relative flex flex-shrink-0 items-center justify-center rounded-full ${
        compact ? "h-8 w-8" : "h-9 w-9"
      }`}
      style={{ backgroundColor: avatar.bgColor }}
    >
      {avatar.imageUrl ? (
        <ResourceImage
          src={avatar.imageUrl}
          alt={`${agent.name || agent.id} avatar`}
          fill
          sizes={compact ? "32px" : "36px"}
          className="rounded-full object-cover"
        />
      ) : (
        <Icon className={compact ? "h-4 w-4" : "h-[18px] w-[18px]"} style={{ color: avatar.fgColor }} />
      )}
      <span
        aria-hidden
        className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-surface-low ${compact ? "h-2.5 w-2.5" : "h-3 w-3"} ${stateDotClass(agent.state)}`}
      />
    </span>
  );
}
