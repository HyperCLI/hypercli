"use client";

import React from "react";
import { ExternalLink, FolderOpen, Gauge, Loader2, PanelLeft, Play, RefreshCw } from "lucide-react";

import type { Agent } from "@/app/dashboard/agents/types";
import { agentAvatar } from "@/lib/avatar";
import { AgentHatchAnimation } from "@/components/dashboard/AgentHatchAnimation";
import { AgentEmptyState } from "@/components/dashboard/agents/AgentPanels";
import { AgentLaunchPrompt, ConnectionStatusIndicator, type CenterPanel, GearDropdown } from "@/components/dashboard/agents/page-helpers";

interface AgentMainPanelProps {
  isDesktopViewport: boolean;
  mobileShowChat: boolean;
  selectedAgent: Agent | null;
  isSelectedTransitioning: boolean;
  isSelectedRunning: boolean;
  burstAgentId: string | null;
  onBurstComplete: () => void;
  activeConnectionStatus: "connected" | "connecting" | "disconnected" | null;
  chatConnected: boolean;
  chatConnecting: boolean;
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
  onShowList: () => void;
  onOpenFiles: () => void;
  onOpenDesktop: () => void;
  onDelete: () => void;
  onShowInspector: () => void;
  onStart: () => void;
  onReconnect: () => void;
  onSelectPanel: (panel: CenterPanel) => void;
  onOpenConfig: () => void;
  onOpenSettings: () => void;
}

export function AgentMainPanel({
  isDesktopViewport,
  mobileShowChat,
  selectedAgent,
  isSelectedTransitioning,
  isSelectedRunning,
  burstAgentId,
  onBurstComplete,
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
  onShowList,
  onOpenFiles,
  onOpenDesktop,
  onDelete,
  onShowInspector,
  onStart,
  onReconnect,
  onSelectPanel,
  onOpenConfig,
  onOpenSettings,
}: AgentMainPanelProps) {
  return (
    <div className={`flex-1 flex-col min-w-0 ${!mobileShowChat && !isDesktopViewport ? "hidden" : "flex"}`}>
      {!selectedAgent ? (
        <AgentEmptyState onCreate={onCreate} />
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
              {activeConnectionStatus && <ConnectionStatusIndicator status={activeConnectionStatus} />}
            </div>

            <div className="flex-1 min-w-0 text-center">
              <p className="text-sm font-medium text-foreground truncate">
                {selectedAgent.name || selectedAgent.pod_name || "Agent"}
              </p>
              {!chatConnected && (
                <p className="text-xs text-text-muted">
                  {chatConnecting ? "Connecting to gateway..." : selectedAgent.state === "RUNNING" ? "Disconnected" : selectedAgent.state}
                </p>
              )}
            </div>

            <button
              onClick={onOpenFiles}
              className="relative z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-text-muted hover:text-foreground hover:border-text-muted/30 hover:bg-surface-low transition-all flex-shrink-0"
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
                    className="px-2 py-1 rounded text-xs border border-border-medium text-foreground hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
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
                      className="px-2 py-1 rounded text-xs border border-border-medium text-foreground hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
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
                      className="p-1 text-text-muted hover:text-foreground transition-colors"
                      title="Reconnect"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {!isDesktopViewport && (
                <button
                  onClick={onShowInspector}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
                  title="Agent details"
                >
                  <Gauge className="w-3.5 h-3.5" />
                </button>
              )}

              <GearDropdown
                currentPanel={currentPanel}
                onSelectPanel={onSelectPanel}
                onOpenConfig={onOpenConfig}
                onOpenSettings={onOpenSettings}
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {(isSelectedTransitioning || burstAgentId === selectedAgent.id) ? (
              <div className="h-full flex items-center justify-center">
                <AgentHatchAnimation
                  state={selectedAgent.state === "RUNNING" ? "RUNNING" : selectedAgent.state as "PENDING" | "STARTING"}
                  onBurstComplete={onBurstComplete}
                />
              </div>
            ) : !isSelectedRunning ? (
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
