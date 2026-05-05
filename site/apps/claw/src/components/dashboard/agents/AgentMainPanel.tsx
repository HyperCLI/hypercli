"use client";

import React from "react";
import { FolderOpen, Gauge, Loader2, PanelLeft, Play, RefreshCw } from "lucide-react";

import type { Agent } from "@/app/dashboard/agents/types";
import type { HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";
import { agentAvatar } from "@/lib/avatar";
import { AgentHatchAnimation } from "@/components/dashboard/AgentHatchAnimation";
import { AgentEmptyState } from "@/components/dashboard/agents/AgentPanels";
import { AgentLaunchPrompt, AgentLoadingState, AgentStatusChip, ConnectionStatusIndicator, type AgentStatusChipModel, type CenterPanel, GearDropdown } from "@/components/dashboard/agents/page-helpers";
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
  fileCount: number;
  openingDesktopId: string | null;
  startingId: string | null;
  recentlyStoppedIds: Set<string>;
  selectedAgentLaunchBlocked: boolean;
  selectedAgentStartGuidanceTitle?: string | null;
  blockedMessage?: string | null;
  suggestedTierActions?: Array<{ label: string; onSelect: () => void }>;
  currentPanel: CenterPanel;
  stoppedTabLabel: string;
  panelContent: React.ReactNode;
  onCreate: () => void;
  onCreateAgent?: (params: { name: string; iconIndex: number; size: string }) => Promise<string | null>;
  budget?: {
    slots: SlotInventory;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: HyperAgentSubscriptionSummary | null;
  onShowList: () => void;
  onOpenFiles: () => void;
  onOpenDesktop: () => void;
  onDelete: () => void;
  onShowInspector: () => void;
  showInspectorButton?: boolean;
  onStart: () => void;
  onReconnect: () => void;
  onSelectPanel: (panel: CenterPanel) => void;
  onOpenSettings: () => void;
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
  fileCount,
  openingDesktopId,
  startingId,
  recentlyStoppedIds,
  selectedAgentLaunchBlocked,
  selectedAgentStartGuidanceTitle,
  blockedMessage,
  suggestedTierActions,
  currentPanel,
  stoppedTabLabel,
  panelContent,
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
  onShowList,
  onOpenFiles,
  onOpenDesktop,
  onDelete,
  onShowInspector,
  showInspectorButton = true,
  onStart,
  onReconnect,
  onSelectPanel,
  onOpenSettings,
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
  const canUsePanelWhileStopped = currentPanel === "files" || currentPanel === "settings";

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
        <AgentEmptyState
          onCreate={onCreate}
          onCreateAgent={onCreateAgent}
          budget={budget}
          subscriptionSummary={subscriptionSummary}
        />
      ) : (
        <>
          <div className="relative px-4 h-14 border-b border-border flex items-center gap-3 min-w-0">
            <button
              onClick={onShowList}
              className={`${isDesktopViewport ? "hidden" : "block"} text-text-muted hover:text-foreground`}
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

            <div className="flex-1 min-w-0 text-center">
              <p className="text-sm font-medium text-foreground truncate">
                {selectedAgent.name || selectedAgent.pod_name || "Agent"}
              </p>
              {!chatConnected && (
                <p className="text-xs text-text-muted">
                  {chatConnecting ? "Connecting gateway" : selectedAgent.state === "RUNNING" ? "Gateway disconnected" : selectedAgent.state}
                </p>
              )}
            </div>

            <button
              onClick={onOpenFiles}
              className="relative z-10 flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-muted transition-all hover:border-text-muted/30 hover:bg-surface-low hover:text-foreground flex-shrink-0"
              title="Open workspace files"
            >
              <FolderOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Files</span>
              {fileCount > 0 && (
                <span className="text-[9px] tabular-nums px-1.5 py-0.5 rounded-full bg-surface-low text-text-muted">
                  {fileCount}
                </span>
              )}
            </button>

            <div className="relative z-10 flex items-center gap-2 flex-shrink-0">
              <div className={`${isDesktopViewport ? "hidden" : "flex"} items-center gap-1`}>
                {(selectedAgent.state === "STOPPED" || selectedAgent.state === "FAILED") && (
                  <button
                    onClick={onStart}
                    disabled={startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id) || selectedAgentLaunchBlocked}
                    className="flex items-center gap-1 rounded-full border border-border-medium px-2.5 py-1 text-xs text-foreground hover:bg-surface-low disabled:opacity-60"
                    aria-label="Start agent"
                    title={selectedAgentStartGuidanceTitle || (recentlyStoppedIds.has(selectedAgent.id) ? "Cleaning up…" : "Start")}
                  >
                    {startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    <span className="hidden xl:inline">Start</span>
                  </button>
                )}
              </div>

              <div className={`${isDesktopViewport ? "flex" : "hidden"} items-center gap-2`}>
                <div className="flex items-center gap-1">
                  {(selectedAgent.state === "STOPPED" || selectedAgent.state === "FAILED") && (
                    <button
                      onClick={onStart}
                      disabled={startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id) || selectedAgentLaunchBlocked}
                      className="flex items-center gap-1 rounded-full border border-border-medium px-2.5 py-1 text-xs text-foreground hover:bg-surface-low disabled:opacity-60"
                      aria-label="Start agent"
                      title={selectedAgentStartGuidanceTitle || (recentlyStoppedIds.has(selectedAgent.id) ? "Cleaning up…" : "Start")}
                    >
                      {startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      <span className="hidden xl:inline">Start</span>
                    </button>
                  )}

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

              <GearDropdown
                currentPanel={currentPanel}
                onSelectPanel={onSelectPanel}
                onOpenSettings={onOpenSettings}
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {isStopping ? (
              <div className="h-full flex items-center justify-center p-6">
                <div className="max-w-md text-center">
                  <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-[#f0c56c]" />
                  <p className="text-base text-foreground">Stopping agent</p>
                  <p className="mt-2 text-sm text-text-muted">Stopping the runtime and cleaning up the workspace.</p>
                </div>
              </div>
            ) : shouldShowStartupAnimation ? (
              <div className="h-full flex items-center justify-center">
                <AgentHatchAnimation
                  state={selectedAgent.state === "RUNNING" ? "RUNNING" : selectedAgent.state as "PENDING" | "STARTING"}
                  onBurstComplete={onBurstComplete}
                />
              </div>
            ) : !isSelectedRunning && !canUsePanelWhileStopped ? (
              <AgentLaunchPrompt
                label={stoppedTabLabel}
                launching={startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id)}
                onLaunch={onStart}
                blockedTitle={selectedAgentStartGuidanceTitle}
                blockedMessage={blockedMessage}
                suggestedTierActions={suggestedTierActions}
              />
            ) : panelContent}
          </div>
        </>
      )}
    </div>
  );
}
