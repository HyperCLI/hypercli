"use client";

import { motion } from "framer-motion";
import {
  Bot,
  PanelLeft,
  PanelLeftClose,
  Plus,
  RefreshCw,
} from "lucide-react";
import { agentAvatar, type AgentMeta } from "@/lib/avatar";
import { formatCpu, formatMemory, formatTokens } from "@/lib/format";

type AgentState = "PENDING" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "FAILED";

interface SidebarAgent {
  id: string;
  name: string;
  pod_name: string | null;
  state: AgentState;
  cpu_millicores: number;
  memory_mib: number;
  last_error: string | null;
  meta?: AgentMeta | null;
}

interface SidebarBudget {
  slots: Record<string, { granted: number; used: number; available: number }>;
  pooled_tpd: number;
}

export interface LegacyAgentSidebarProps {
  agents: SidebarAgent[];
  selectedAgentId: string | null;
  loading: boolean;
  budget: SidebarBudget | null;
  agentClusterUnavailable: boolean;
  sidebarCollapsed: boolean;
  isDesktopViewport: boolean;
  mobileShowChat: boolean;
  onSelectAgent: (id: string) => void;
  onToggleCollapse: () => void;
  onRefresh: () => void;
  onCreateAgent: () => void;
}

function stateClass(state: AgentState): string {
  if (state === "RUNNING") return "bg-[#38D39F]/15 text-[#38D39F]";
  if (state === "FAILED") return "bg-[#d05f5f]/15 text-[#d05f5f]";
  if (state === "STOPPED") return "bg-surface-low text-text-muted";
  return "bg-[#f0c56c]/15 text-[#f0c56c]";
}

function AgentStateBadge({ state, pulsing }: { state: AgentState; pulsing: boolean }) {
  const color =
    state === "RUNNING" ? "bg-[#38D39F]" :
    state === "FAILED" ? "bg-[#d05f5f]" :
    state === "STOPPED" ? "bg-text-muted" : "bg-[#f0c56c]";
  return (
    <motion.span
      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${color}`}
      animate={pulsing ? { scale: [1, 1.25, 1] } : { scale: 1 }}
      transition={pulsing ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : {}}
    />
  );
}

function BudgetBar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted">{used}/{total}</span>
      </div>
      <div className="h-1 bg-surface-low rounded-full overflow-hidden">
        <div className="h-full bg-[#38D39F]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function titleizeTier(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Legacy agent-list sidebar from the pre-redesign /dashboard/agents page.
 * Kept for reference and rollback. The new layout uses AgentsChannelsSidebar instead.
 */
export function LegacyAgentSidebar({
  agents,
  selectedAgentId,
  loading,
  budget,
  agentClusterUnavailable,
  sidebarCollapsed,
  isDesktopViewport,
  mobileShowChat,
  onSelectAgent,
  onToggleCollapse,
  onRefresh,
  onCreateAgent,
}: LegacyAgentSidebarProps) {
  return (
    <div className={`border-r border-border bg-background flex-shrink-0 transition-all duration-200 ${
      sidebarCollapsed
        ? (isDesktopViewport ? "w-16 overflow-hidden" : "w-0 overflow-hidden")
        : (isDesktopViewport ? "w-[280px]" : "w-full")
    } ${mobileShowChat && !isDesktopViewport ? "hidden" : "flex"} flex-col`}>
      <div className="px-3 h-14 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleCollapse}
            className="text-text-muted transition-colors hover:text-foreground"
            aria-label={sidebarCollapsed ? "Expand agents sidebar" : "Collapse agents sidebar"}
          >
            {sidebarCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
          {!sidebarCollapsed && <span className="text-xs text-text-muted font-medium uppercase tracking-wider">Agents</span>}
        </div>
        {!sidebarCollapsed && (
          <button onClick={onRefresh} className="text-text-muted hover:text-foreground transition-colors p-1">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-center text-text-muted text-sm">Loading...</div>
        ) : agents.length === 0 ? (
          <div className="p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-surface-low flex items-center justify-center mx-auto mb-4">
              <Bot className="w-8 h-8 text-text-muted" />
            </div>
            {agentClusterUnavailable ? (
              <>
                <p className="text-text-secondary text-sm mb-1">Agent cluster assignment pending</p>
                <p className="text-xs text-text-muted mb-4">
                  Your account is not attached to an agent cluster yet, so agent creation is temporarily unavailable.
                </p>
                <button onClick={onRefresh} className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium">Retry</button>
              </>
            ) : (
              <>
                <p className="text-text-secondary text-sm mb-1">No agents yet</p>
                <p className="text-xs text-text-muted mb-4">Deploy a persistent Linux container with AI capabilities</p>
                <button onClick={onCreateAgent} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium">
                  Create Your First Agent
                </button>
              </>
            )}
          </div>
        ) : (
          <div>
            {agents.map((agent) => {
              const isSelected = selectedAgentId === agent.id;
              const isTransitioning = ["PENDING", "STARTING", "STOPPING"].includes(agent.state);
              const avatar = agentAvatar(agent.name || agent.id, agent.meta);
              const AvatarIcon = avatar.icon;

              if (sidebarCollapsed) {
                return (
                  <button
                    key={agent.id}
                    onClick={() => onSelectAgent(agent.id)}
                    className={`w-full p-3 flex flex-col items-center gap-1 transition-colors ${
                      isSelected ? "bg-surface-low" : "hover:bg-surface-low/50"
                    }`}
                    title={agent.name}
                  >
                    <div className="relative">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: avatar.bgColor }}>
                        {avatar.imageUrl ? (
                          <img src={avatar.imageUrl} alt={`${agent.name} avatar`} className="w-full h-full object-cover" />
                        ) : (
                          <AvatarIcon className="w-4 h-4" style={{ color: avatar.fgColor }} />
                        )}
                      </div>
                      <AgentStateBadge state={agent.state} pulsing={isTransitioning} />
                    </div>
                  </button>
                );
              }

              return (
                <button
                  key={agent.id}
                  onClick={() => onSelectAgent(agent.id)}
                  className={`w-full p-3 flex items-start gap-3 text-left transition-colors ${
                    isSelected ? "bg-surface-low" : "hover:bg-surface-low/50"
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: avatar.bgColor }}>
                      {avatar.imageUrl ? (
                        <img src={avatar.imageUrl} alt={`${agent.name} avatar`} className="w-full h-full object-cover" />
                      ) : (
                        <AvatarIcon className="w-4 h-4" style={{ color: avatar.fgColor }} />
                      )}
                    </div>
                    <AgentStateBadge state={agent.state} pulsing={isTransitioning} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{agent.name || agent.pod_name || agent.id}</p>
                      <motion.span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${stateClass(agent.state)}`}
                        animate={isTransitioning ? { opacity: [0.6, 1, 0.6] } : { opacity: 1 }}
                        transition={isTransitioning ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : {}}
                      >
                        {agent.state}
                      </motion.span>
                    </div>
                    <p className="text-xs text-text-muted mt-0.5">
                      {formatCpu(agent.cpu_millicores)} · {formatMemory(agent.memory_mib)}
                    </p>
                    {agent.last_error && agent.state === "FAILED" && (
                      <p className="text-xs text-[#d05f5f] mt-0.5 truncate">{agent.last_error}</p>
                    )}
                  </div>
                </button>
              );
            })}

            {sidebarCollapsed ? (
              <button
                onClick={onCreateAgent}
                disabled={agentClusterUnavailable}
                className="w-full p-3 flex flex-col items-center gap-1 transition-colors hover:bg-surface-low/50 disabled:opacity-40 disabled:cursor-not-allowed"
                title={agentClusterUnavailable ? "Agent cluster assignment pending" : "New Agent"}
              >
                <div className="w-9 h-9 rounded-full border border-dashed border-text-muted flex items-center justify-center">
                  <Plus className="w-4 h-4 text-text-muted" />
                </div>
              </button>
            ) : (
              <button
                onClick={onCreateAgent}
                disabled={agentClusterUnavailable}
                className="w-full p-3 flex items-center gap-3 text-left transition-colors hover:bg-surface-low/50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="flex-shrink-0 w-9 h-9 rounded-full border border-dashed border-text-muted flex items-center justify-center">
                  <Plus className="w-4 h-4 text-text-muted" />
                </div>
                <span className="text-sm text-text-bright">New Agent</span>
              </button>
            )}
          </div>
        )}
      </div>

      {budget && !sidebarCollapsed && (
        <div className="px-3 py-3 border-t border-border flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">Pooled inference</span>
            <span className="text-text-muted">{formatTokens(budget.pooled_tpd)} / day</span>
          </div>
          {Object.entries(budget.slots || {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([tier, entry]) => (
              <BudgetBar key={tier} label={titleizeTier(tier)} used={entry.used} total={entry.granted} />
            ))}
        </div>
      )}
    </div>
  );
}
