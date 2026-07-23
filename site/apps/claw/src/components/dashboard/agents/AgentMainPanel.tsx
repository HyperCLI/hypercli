"use client";

import React from "react";
import { ArrowLeft, Gauge, PanelLeft, RefreshCw } from "lucide-react";

import type { Agent } from "@/app/dashboard/agents/types";
import { isAgentFailureState, isAgentTransitionalState } from "@/app/dashboard/agents/types";
import type { HyperAgentPlan, HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";
import { agentAvatar } from "@/lib/avatar";
import { ResourceImage } from "@/components/ResourceImage";
import { AgentEmptyState, AgentIntegrationsEmptyState, AgentSkillsEmptyState, LaunchFirstAgentEmptyState } from "@/components/dashboard/agents/AgentPanels";
import { AgentLaunchPrompt, AgentLoadingState, AgentStatusChip, ConnectionStatusIndicator, type AgentStatusChipModel, type CenterPanel } from "@/components/dashboard/agents/page-helpers";
import type { ShellStatus } from "@/hooks/useAgentShell";
import type { SlotInventory } from "@/lib/format";
import type { AgentCreationSetupCreateParams } from "@/components/dashboard/agents/AgentCreationSetupWizard";
import { TooltipHint } from "@/components/ClawTooltip";

interface AgentMainPanelProps {
  isDesktopViewport: boolean;
  mobileShowChat: boolean;
  selectedAgent: Agent | null;
  hasAgents?: boolean;
  loadingInitialAgents?: boolean;
  isSelectedRunning: boolean;
  burstAgentId: string | null;
  onBurstComplete: () => void;
  agentStatus?: AgentStatusChipModel | null;
  activeConnectionStatus?: ShellStatus | null;
  chatConnected?: boolean;
  chatConnecting?: boolean;
  sessionReturnTarget?: {
    label: string;
    onSelect: () => void;
  } | null;
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
  persistentPanelContent?: React.ReactNode;
  headerAction?: React.ReactNode;
  onCreate: () => void;
  onCreateAgent?: (params: AgentCreationSetupCreateParams) => Promise<string | null>;
  budget?: {
    slots: SlotInventory;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: HyperAgentSubscriptionSummary | null;
  catalogPlans?: HyperAgentPlan[] | null;
  onOpenPlanCatalog?: () => void | Promise<void>;
  pendingSlotReleases?: Record<string, number>;
  workspaceName?: string | null;
  hasAccountAgents?: boolean;
  creationDisabledReason?: string | null;
  onCreateWorkspace?: () => void;
  onOpenMembers?: () => void;
  onShowList: () => void;
  showMobileListButton?: boolean;
  onShowInspector: () => void;
  showInspectorButton?: boolean;
  onStart: () => void;
  onReconnect: () => void;
}

export function AgentMainPanel({
  isDesktopViewport,
  mobileShowChat,
  selectedAgent,
  hasAgents = false,
  loadingInitialAgents = false,
  isSelectedRunning,
  burstAgentId,
  onBurstComplete,
  agentStatus,
  activeConnectionStatus,
  chatConnected,
  chatConnecting,
  sessionReturnTarget = null,
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
  persistentPanelContent,
  headerAction,
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
  catalogPlans,
  onOpenPlanCatalog,
  pendingSlotReleases,
  workspaceName,
  hasAccountAgents = false,
  creationDisabledReason,
  onCreateWorkspace,
  onOpenMembers,
  onShowList,
  showMobileListButton = true,
  onShowInspector,
  showInspectorButton = true,
  onStart,
  onReconnect,
}: AgentMainPanelProps) {
  const selectedAgentState = selectedAgent?.state ?? null;
  const isLifecycleBusy = isAgentTransitionalState(selectedAgentState);
  const isStartable = selectedAgentState === "STOPPED" || isAgentFailureState(selectedAgentState);
  const lifecycleAgentStatus: AgentStatusChipModel | null = (() => {
    if (!selectedAgent) return null;
    if (selectedAgent.state === "FAILED") {
      return {
        label: "Failed",
        detail: selectedAgent.last_error || "Needs attention before it can run.",
        tone: "failed",
      };
    }
    if (selectedAgent.state === "RESTORE_FAILED") {
      return {
        label: "Restore failed",
        detail: selectedAgent.last_error || "File restore failed before the agent could boot.",
        tone: "failed",
      };
    }
    if (selectedAgent.state === "SYNC_FAILED") {
      return {
        label: "Sync failed",
        detail: selectedAgent.last_error?.replace(/\bworkspaces?\b/gi, "shared knowledge") || "Shared knowledge sync failed before the agent could boot.",
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
    if (selectedAgent.state === "RESTORING") {
      return {
        label: "Restoring files",
        detail: "Restoring the agent home directory before boot.",
        tone: "starting",
        loading: true,
      };
    }
    if (selectedAgent.state === "SYNCING") {
      return {
        label: "Syncing shared knowledge",
        detail: "Syncing shared knowledge Markdown before boot.",
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
        label: activeConnectionStatus === "connected" ? "Ready" : activeConnectionStatus === "reconnecting" ? "Reconnecting" : activeConnectionStatus === "connecting" ? "Connecting" : "Disconnected",
        detail: activeConnectionStatus === "connected"
          ? "Chat is available."
          : activeConnectionStatus === "reconnecting"
            ? "Reopening the gateway connection."
          : activeConnectionStatus === "connecting" || chatConnecting
            ? "Preparing chat."
            : chatConnected === false
              ? "Gateway disconnected."
              : "Gateway is not connected yet.",
        tone: activeConnectionStatus === "connected" ? "ready" : activeConnectionStatus === "connecting" || activeConnectionStatus === "reconnecting" ? "connecting" : "disconnected",
        loading: activeConnectionStatus === "connecting" || activeConnectionStatus === "reconnecting",
      }
    : null;
  const effectiveAgentStatus = agentStatus ?? lifecycleAgentStatus ?? connectionAgentStatus;
  const legacyConnectionStatus = activeConnectionStatus ?? null;
  const isStartupState =
    selectedAgentState === "PENDING" ||
    selectedAgentState === "RESTORING" ||
    selectedAgentState === "SYNCING" ||
    selectedAgentState === "STARTING";
  const shouldShowStartupAnimation =
    isStartupState ||
    (selectedAgentState === "RUNNING" && selectedAgent !== null && burstAgentId === selectedAgent.id);
  React.useEffect(() => {
    if (selectedAgent?.state !== "RUNNING" || burstAgentId !== selectedAgent.id) return;

    const timeout = window.setTimeout(onBurstComplete, 900);
    return () => window.clearTimeout(timeout);
  }, [burstAgentId, onBurstComplete, selectedAgent?.id, selectedAgent?.state]);

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
    pendingSlotReleases,
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
    if (currentPanel === "skills") {
      return <AgentSkillsEmptyState {...stoppedEmptyStateProps} />;
    }
    if (currentPanel === "integrations") {
      return skillsPanelActive ? (
        <AgentSkillsEmptyState {...stoppedEmptyStateProps} />
      ) : (
        <AgentIntegrationsEmptyState {...stoppedEmptyStateProps} />
      );
    }
    return null;
  })();
  const renderSelectedPanelContent = () => {
    const activeAgent = selectedAgent;
    if (!activeAgent) return null;
    if (currentPanel === "members") return panelContent;

    const chatPanelOwnsBootState =
      currentPanel === "chat" &&
      (
        isLifecycleBusy ||
        (activeAgent.state === "RUNNING" && shouldShowStartupAnimation)
      );

    if (chatPanelOwnsBootState) {
      return panelContent;
    }

    if (selectedAgentState === "STOPPING") {
      return (
        <AgentLoadingState
          title="Stopping agent"
          detail="Stopping the runtime and cleaning up the workspace."
          tone="loading"
          stage="complete"
        />
      );
    }

    if (shouldShowStartupAnimation) {
      const startupCopy =
        activeAgent.state === "PENDING"
          ? {
              title: "Provisioning runtime",
              detail: "Reserving compute and preparing the workspace.",
              stage: "runtime" as const,
            }
          : activeAgent.state === "RESTORING"
            ? {
                title: "Restoring files",
                detail: "Restoring the agent home directory before boot.",
                stage: "runtime" as const,
              }
          : activeAgent.state === "SYNCING"
            ? {
                title: "Syncing shared knowledge",
                detail: "Syncing shared knowledge Markdown before boot.",
                stage: "runtime" as const,
              }
          : activeAgent.state === "STARTING"
            ? {
                title: "Booting agent",
                detail: "Starting the container and OpenClaw services.",
                stage: "agent" as const,
              }
            : {
                title: "Runtime ready",
                detail: "Opening the gateway connection.",
                stage: "complete" as const,
              };

      return (
        <AgentLoadingState
          title={startupCopy.title}
          detail={startupCopy.detail}
          tone="starting"
          stage={startupCopy.stage}
        />
      );
    }

    if (currentPanel === "scheduled") {
      return panelContent;
    }

    if (currentPanel === "files") {
      return panelContent;
    }

    if (currentPanel === "knowledge") {
      return panelContent;
    }

    if (stoppedPanelContent) {
      return stoppedPanelContent;
    }

    if (currentPanel === "settings") {
      return panelContent;
    }

    if (!isSelectedRunning && isStartable) {
      return (
        <AgentLaunchPrompt
          label={stoppedTabLabel}
          launching={stoppedLaunchBusy}
          onLaunch={onStart}
          blockedTitle={selectedAgentStartGuidanceTitle}
          blockedMessage={blockedMessage}
          suggestedTierActions={suggestedTierActions}
          footnote={currentPanel === "shell" ? "Start the agent to open a terminal session." : undefined}
        />
      );
    }

    return panelContent;
  };

  return (
    <div className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${!mobileShowChat && !isDesktopViewport ? "hidden" : "flex"}`}>
      {!selectedAgent && (currentPanel === "knowledge" || currentPanel === "members") ? (
        <div className="flex-1 min-h-0">{panelContent}</div>
      ) : loadingInitialAgents && !selectedAgent ? (
        <div className="flex-1 min-h-0">
          <AgentLoadingState
            title="Loading agents"
            detail="Checking your workspace before selecting an agent."
            tone="loading"
            stage="complete"
          />
        </div>
      ) : !selectedAgent && hasAgents ? (
        <div className="flex-1 min-h-0">
          <AgentLoadingState
            title="Selecting agent"
            detail="Opening the next available agent."
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
          pendingSlotReleases={pendingSlotReleases}
          onOpenPlanCatalog={onOpenPlanCatalog}
          workspaceName={workspaceName}
          hasAccountAgents={hasAccountAgents}
          creationDisabledReason={creationDisabledReason}
          onCreateWorkspace={onCreateWorkspace}
          onOpenMembers={onOpenMembers}
        />
      ) : (
        <>
          {isDesktopViewport && (
            <div className="grid h-14 min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] items-center gap-3 border-b border-border px-4">
              <div className="relative z-10 flex min-w-0 items-center gap-2">
                {showMobileListButton && (
                  <button
                    onClick={onShowList}
                    className="hidden flex-shrink-0 text-text-muted hover:text-foreground"
                    aria-label="Show agents list"
                  >
                    <PanelLeft className="w-5 h-5" />
                  </button>
                )}
                {(() => {
                  const avatar = agentAvatar(selectedAgent.name || selectedAgent.id, selectedAgent.meta);
                  const AvatarIcon = avatar.icon;
                  return (
                    <div className="relative w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: avatar.bgColor }}>
                      {avatar.imageUrl ? (
                        <ResourceImage src={avatar.imageUrl} alt={`${selectedAgent.name} avatar`} fill sizes="28px" className="object-cover" />
                      ) : (
                        <AvatarIcon className="w-3.5 h-3.5" style={{ color: avatar.fgColor }} />
                      )}
                    </div>
                  );
                })()}
                {sessionReturnTarget ? (
                  <button
                    type="button"
                    onClick={sessionReturnTarget.onSelect}
                    aria-label={`Open ${sessionReturnTarget.label}`}
                    className="inline-flex h-8 min-w-0 max-w-[10rem] flex-shrink items-center gap-1.5 rounded-full border border-border bg-surface-low/45 px-2.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)]"
                  >
                    <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{sessionReturnTarget.label}</span>
                  </button>
                ) : null}
                <div className="flex min-w-0">
                  {effectiveAgentStatus ? (
                    <AgentStatusChip status={effectiveAgentStatus} />
                  ) : legacyConnectionStatus ? (
                    <ConnectionStatusIndicator status={legacyConnectionStatus} />
                  ) : (
                    null
                  )}
                </div>
              </div>

              <div className="pointer-events-none z-0 flex w-[min(42vw,420px)] min-w-0 flex-col items-center justify-center px-2 text-center">
                <p className="max-w-full truncate text-sm font-medium text-foreground">
                  {selectedAgent.name || selectedAgent.pod_name || "Agent"}
                </p>
                {!chatConnected && (
                  <p className="max-w-full truncate text-xs text-text-muted">
                    {chatConnecting ? "Preparing chat" : selectedAgent.state === "RUNNING" ? "Gateway disconnected" : selectedAgent.state}
                  </p>
                )}
              </div>

              <div className="relative z-10 flex min-w-0 items-center justify-end gap-2">
                {headerAction}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    {(currentPanel === "logs" || currentPanel === "shell") && (
                      <TooltipHint label="Reconnect">
                        <button aria-label="Reconnect" onClick={onReconnect} className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-low hover:text-foreground">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </TooltipHint>
                    )}
                  </div>
                </div>

                {showInspectorButton && (
                  <TooltipHint label="Agent details">
                    <button aria-label="Agent details" onClick={onShowInspector} className="hidden w-8 h-8 rounded-full items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors">
                      <Gauge className="w-3.5 h-3.5" />
                    </button>
                  </TooltipHint>
                )}
              </div>
            </div>
          )}

          <div className="relative flex-1 min-h-0 overflow-hidden">
            {persistentPanelContent}
            {renderSelectedPanelContent()}
          </div>
        </>
      )}
    </div>
  );
}
