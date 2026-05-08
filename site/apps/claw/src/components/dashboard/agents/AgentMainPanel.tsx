"use client";

import React from "react";
import { Gauge, Loader2, PanelLeft, RefreshCw } from "lucide-react";

import type { Agent } from "@/app/dashboard/agents/types";
import type { HyperAgentPlan, HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";
import { agentAvatar } from "@/lib/avatar";
import { AgentHatchAnimation } from "@/components/dashboard/AgentHatchAnimation";
import { AgentEmptyState, AgentFilesEmptyState, AgentIntegrationsEmptyState, AgentScheduledEmptyState, AgentSkillsEmptyState, LaunchFirstAgentEmptyState } from "@/components/dashboard/agents/AgentPanels";
import { AgentLaunchPrompt, AgentLoadingState, AgentStatusChip, ConnectionStatusIndicator, type AgentStatusChipModel, type CenterPanel } from "@/components/dashboard/agents/page-helpers";
import type { SlotInventory } from "@/lib/format";

interface AgentMainPanelProps {
  isDesktopViewport: boolean;
  mobileShowChat: boolean;
  selectedAgent: Agent | null;
  loadingInitialAgents?: boolean;
  isSelectedTransitioning: boolean;
  isSelectedRunning: boolean;
  burstAgentId: string | null;
  onBurstComplete: () => void;
  agentStatus?: AgentStatusChipModel | null;
  activeConnectionStatus?: "connected" | "connecting" | "disconnected" | null;
  chatConnected?: boolean;
  chatConnecting?: boolean;
  startingId: string | null;
  recentlyStoppedIds: Set<string>;
  selectedAgentLaunchBlocked: boolean;
  selectedAgentStartGuidanceTitle?: string | null;
  blockedMessage?: string | null;
  suggestedTierActions?: Array<{ label: string; onSelect: () => void }>;
  currentPanel: CenterPanel;
  skillsPanelActive?: boolean;
  stoppedTabLabel: string;
  panelContent: React.ReactNode;
  onCreate: () => void;
  onCreateAgent?: (params: { name: string; iconIndex: number; size: string }) => Promise<string | null>;
  budget?: {
    slots: SlotInventory;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: HyperAgentSubscriptionSummary | null;
  catalogPlans?: HyperAgentPlan[] | null;
  onOpenPlanCatalog?: () => void | Promise<void>;
  onShowList: () => void;
  onShowInspector: () => void;
  showInspectorButton?: boolean;
  onStart: () => void;
  onReconnect: () => void;
}

export function AgentMainPanel({
  isDesktopViewport,
  mobileShowChat,
  selectedAgent,
  loadingInitialAgents = false,
  isSelectedTransitioning,
  isSelectedRunning,
  burstAgentId,
  onBurstComplete,
  agentStatus,
  activeConnectionStatus,
  chatConnected,
  chatConnecting,
  startingId,
  recentlyStoppedIds,
  selectedAgentLaunchBlocked,
  selectedAgentStartGuidanceTitle,
  blockedMessage,
  suggestedTierActions,
  currentPanel,
  skillsPanelActive = false,
  stoppedTabLabel,
  panelContent,
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
  catalogPlans,
  onOpenPlanCatalog,
  onShowList,
  onShowInspector,
  showInspectorButton = true,
  onStart,
  onReconnect,
}: AgentMainPanelProps) {
  const isStopping = selectedAgent?.state === "STOPPING";
  const lifecycleAgentStatus: AgentStatusChipModel | null = (() => {
    if (!selectedAgent) return null;
    if (selectedAgent.state === "FAILED") {
      return {
        label: "Failed",
        detail: selectedAgent.last_error || "Needs attention before it can run.",
        tone: "failed",
      };
    }
    if (selectedAgent.state === "STOPPED") {
      return {
        label: "Stopped",
        detail: "Start the agent to chat.",
        tone: "stopped",
      };
    }
    if (selectedAgent.state === "PENDING") {
      return {
        label: "Provisioning",
        detail: "Reserving compute and preparing the workspace.",
        tone: "starting",
        loading: true,
      };
    }
    if (selectedAgent.state === "STARTING") {
      return {
        label: "Booting",
        detail: "Starting the container and OpenClaw services.",
        tone: "starting",
        loading: true,
      };
    }
    if (selectedAgent.state === "STOPPING") {
      return {
        label: "Stopping",
        detail: "Stopping the runtime and cleaning up the workspace.",
        tone: "stopping",
        loading: true,
      };
    }
    return null;
  })();
  const connectionAgentStatus: AgentStatusChipModel | null = activeConnectionStatus
    ? {
        label: activeConnectionStatus === "connected" ? "Ready" : activeConnectionStatus === "connecting" ? "Connecting" : "Disconnected",
        detail: activeConnectionStatus === "connected"
          ? "Gateway connected."
          : activeConnectionStatus === "connecting" || chatConnecting
            ? "Opening the gateway connection."
            : chatConnected === false
              ? "Gateway disconnected."
              : "Gateway is not connected yet.",
        tone: activeConnectionStatus === "connected" ? "ready" : activeConnectionStatus === "connecting" ? "connecting" : "disconnected",
        loading: activeConnectionStatus === "connecting",
      }
    : null;
  const effectiveAgentStatus = agentStatus ?? lifecycleAgentStatus ?? connectionAgentStatus;
  const legacyConnectionStatus = activeConnectionStatus ?? null;
  const shouldShowStartupAnimation =
    (isSelectedTransitioning && (selectedAgent?.state === "PENDING" || selectedAgent?.state === "STARTING")) ||
    (selectedAgent?.state === "RUNNING" && burstAgentId === selectedAgent.id);
  const stoppedLaunchBusy = Boolean(selectedAgent && startingId === selectedAgent.id);
  const stoppedLaunchCooldown = Boolean(selectedAgent && recentlyStoppedIds.has(selectedAgent.id));
  const stoppedLaunchBlocked = selectedAgentLaunchBlocked || stoppedLaunchCooldown;
  const stoppedLaunchBlockedReason = stoppedLaunchCooldown
    ? "Agent is finishing shutdown. Try again shortly."
    : selectedAgentStartGuidanceTitle;
  const stoppedEmptyStateProps = {
    onCreate,
    onCreateAgent,
    budget,
    subscriptionSummary,
    catalogPlans,
    onOpenPlanCatalog,
    launchLabel: "Start agent",
    launching: stoppedLaunchBusy,
    launchBlocked: stoppedLaunchBlocked,
    launchBlockedReason: stoppedLaunchBlockedReason,
    onLaunchAction: onStart,
  };
  const stoppedPanelContent = (() => {
    if (selectedAgent?.state !== "STOPPED") return null;
    if (currentPanel === "chat") {
      return <AgentEmptyState {...stoppedEmptyStateProps} />;
    }
    if (currentPanel === "files") {
      return <AgentFilesEmptyState {...stoppedEmptyStateProps} />;
    }
    if (currentPanel === "integrations") {
      return skillsPanelActive ? (
        <AgentSkillsEmptyState {...stoppedEmptyStateProps} />
      ) : (
        <AgentIntegrationsEmptyState {...stoppedEmptyStateProps} />
      );
    }
    if (currentPanel === "scheduled") {
      return <AgentScheduledEmptyState {...stoppedEmptyStateProps} />;
    }
    return null;
  })();
  const renderSelectedPanelContent = () => {
    const activeAgent = selectedAgent;
    if (!activeAgent) return null;

    if (isStopping) {
      return (
        <div className="h-full flex items-center justify-center p-6">
          <div className="max-w-md text-center">
            <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-[#f0c56c]" />
            <p className="text-base text-foreground">Stopping agent</p>
            <p className="mt-2 text-sm text-text-muted">Stopping the runtime and cleaning up the workspace.</p>
          </div>
        </div>
      );
    }

    if (shouldShowStartupAnimation) {
      return (
        <div className="h-full flex items-center justify-center">
          <AgentHatchAnimation
            state={activeAgent.state === "RUNNING" ? "RUNNING" : activeAgent.state as "PENDING" | "STARTING"}
            onBurstComplete={onBurstComplete}
          />
        </div>
      );
    }

    if (stoppedPanelContent) {
      return stoppedPanelContent;
    }

    if (currentPanel === "settings") {
      return panelContent;
    }

    if (!isSelectedRunning) {
      return (
        <AgentLaunchPrompt
          label={stoppedTabLabel}
          launching={stoppedLaunchBusy}
          onLaunch={onStart}
          blockedTitle={selectedAgentStartGuidanceTitle}
          blockedMessage={blockedMessage}
          suggestedTierActions={suggestedTierActions}
        />
      );
    }

    return panelContent;
  };

  return (
    <div className={`flex-1 flex-col min-w-0 ${!mobileShowChat && !isDesktopViewport ? "hidden" : "flex"}`}>
      {loadingInitialAgents && !selectedAgent ? (
        <div className="flex-1 min-h-0">
          <AgentLoadingState
            title="Loading agents"
            detail="Checking your workspace before selecting an agent."
            tone="loading"
            stage="complete"
          />
        </div>
      ) : !selectedAgent ? (
        <LaunchFirstAgentEmptyState
          onCreate={onCreate}
          onCreateAgent={onCreateAgent}
          budget={budget}
          subscriptionSummary={subscriptionSummary}
          catalogPlans={catalogPlans}
          onOpenPlanCatalog={onOpenPlanCatalog}
        />
      ) : (
        <>
          <div className="relative px-4 h-14 border-b border-border flex items-center gap-3 min-w-0">
            <button
              onClick={onShowList}
              className={`${isDesktopViewport ? "hidden" : "block"} relative z-10 flex-shrink-0 text-text-muted hover:text-foreground`}
              aria-label="Show agents list"
            >
              <PanelLeft className="w-5 h-5" />
            </button>

            <div className="relative z-10 flex items-center gap-2 min-w-0 flex-shrink-0">
              {(() => {
                const avatar = agentAvatar(selectedAgent.name || selectedAgent.id, selectedAgent.meta);
                const AvatarIcon = avatar.icon;
                return (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: avatar.bgColor }}>
                    {avatar.imageUrl ? (
                      <img src={avatar.imageUrl} alt={`${selectedAgent.name} avatar`} className="w-full h-full object-cover" />
                    ) : (
                      <AvatarIcon className="w-3.5 h-3.5" style={{ color: avatar.fgColor }} />
                    )}
                  </div>
                );
              })()}
              {effectiveAgentStatus ? (
                <AgentStatusChip status={effectiveAgentStatus} />
              ) : legacyConnectionStatus ? (
                <ConnectionStatusIndicator status={legacyConnectionStatus} />
              ) : (
                null
              )}
            </div>

            <div className="pointer-events-none absolute inset-y-0 left-1/2 z-0 flex w-[min(46vw,420px)] -translate-x-1/2 flex-col items-center justify-center px-2 text-center">
              <p className="max-w-full truncate text-sm font-medium text-foreground">
                {selectedAgent.name || selectedAgent.pod_name || "Agent"}
              </p>
              {!chatConnected && (
                <p className="max-w-full truncate text-xs text-text-muted">
                  {chatConnecting ? "Connecting gateway" : selectedAgent.state === "RUNNING" ? "Gateway disconnected" : selectedAgent.state}
                </p>
              )}
            </div>

            <div className="relative z-10 flex items-center gap-2 flex-shrink-0">
              <div className={`${isDesktopViewport ? "flex" : "hidden"} items-center gap-2`}>
                <div className="flex items-center gap-1">
                  {(currentPanel === "logs" || currentPanel === "shell") && (
                    <button
                      onClick={onReconnect}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
                      title="Reconnect"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {!isDesktopViewport && showInspectorButton && (
                <button
                  onClick={onShowInspector}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
                  title="Agent details"
                >
                  <Gauge className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {renderSelectedPanelContent()}
          </div>
        </>
      )}
    </div>
  );
}
