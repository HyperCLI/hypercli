"use client";

import React from "react";
import { ArrowLeft, Gauge, PanelLeft, RefreshCw } from "lucide-react";

import type { Agent } from "@/app/dashboard/agents/types";
import { isAgentStartable, isAgentTransitionalState } from "@/app/dashboard/agents/types";
import type { HyperAgentPlan, HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";
import { agentAvatar, agentProfileImageUrl } from "@/lib/avatar";
import { ResourceImage } from "@/components/ResourceImage";
import { AgentDesktopEmptyState, AgentEmptyState, AgentFilesEmptyState, AgentIntegrationsEmptyState, AgentScheduledEmptyState, AgentSkillsEmptyState, LaunchFirstAgentEmptyState } from "@/components/dashboard/agents/AgentPanels";
import { AgentLaunchPrompt, AgentLoadingState, AgentStatusChip, ConnectionStatusIndicator, type AgentStatusChipModel, type CenterPanel } from "@/components/dashboard/agents/page-helpers";
import type { ShellStatus } from "@/hooks/useAgentShell";
import type { SlotInventory } from "@/lib/format";
import type { AgentCreationSetupCreateParams } from "@/components/dashboard/agents/AgentCreationSetupWizard";
import { TooltipHint } from "@/components/ClawTooltip";
import { agentDisplayLabel } from "@/components/dashboard/agents/agentViewModel";
import { AgentDisplayNameEditor } from "@/components/dashboard/agents/AgentDisplayNameEditor";

export type DashboardSurfaceHeader = {
  title: string;
  subtitle?: string;
  description?: string;
  icon?: React.ReactNode;
  controlsTargetId?: string;
  metrics?: Array<{ label: string; value: string; tone?: "default" | "warning" | "danger" }>;
};

interface AgentMainPanelProps {
  isDesktopViewport: boolean;
  mobileShowChat: boolean;
  selectedAgent: Agent | null;
  isAuthenticated?: boolean;
  showAgentlessSectionPreviews?: boolean;
  showAgentlessDesktopPreview?: boolean;
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
  launcherContent?: React.ReactNode;
  persistentPanelContent?: React.ReactNode;
  headerAction?: React.ReactNode;
  surfaceHeader?: DashboardSurfaceHeader | null;
  onUpdateAgentDisplayName?: (agentId: string, displayName: string) => Promise<void> | void;
  onCreate: () => void;
  onCreateAgent?: (params: AgentCreationSetupCreateParams) => Promise<string | null>;
  budget?: {
    slots: SlotInventory;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: HyperAgentSubscriptionSummary | null;
  catalogPlans?: HyperAgentPlan[] | null;
  onOpenPlanCatalog?: (planId?: string) => void | Promise<void>;
  preferredPlanId?: string | null;
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
  onStop?: () => void;
  onReconnect: () => void;
}

export function AgentMainPanel({
  isDesktopViewport,
  mobileShowChat,
  selectedAgent,
  isAuthenticated = true,
  showAgentlessSectionPreviews = false,
  showAgentlessDesktopPreview = false,
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
  launcherContent,
  persistentPanelContent,
  headerAction,
  surfaceHeader = null,
  onUpdateAgentDisplayName,
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
  catalogPlans,
  onOpenPlanCatalog,
  preferredPlanId,
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
  onStop,
  onReconnect,
}: AgentMainPanelProps) {
  const selectedAgentState = selectedAgent?.state ?? null;
  const selectedAgentDisplayName = selectedAgent ? agentDisplayLabel(selectedAgent) : "Agent";
  const isLifecycleBusy = isAgentTransitionalState(selectedAgentState);
  const isStartable = Boolean(selectedAgent && isAgentStartable(selectedAgent));
  const lifecycleAgentStatus: AgentStatusChipModel | null = (() => {
    if (!selectedAgent) return null;
    if (selectedAgent.state === "FAILED") {
      return {
        label: "Failed",
        detail: "Needs attention before it can run.",
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
    if (selectedAgent.state === "ARCHIVED") {
      return {
        label: "Archived",
        detail: "Start the agent to restore its verified archive.",
        tone: "stopped",
      };
    }
    if (selectedAgent.state === "CREATING") {
      return {
        label: "Creating",
        detail: "Preparing persistent storage and admitting the runtime.",
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
    if (selectedAgent.state === "ARCHIVING") {
      return {
        label: "Archiving",
        detail: "Verifying the cold archive before releasing runtime resources.",
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
    selectedAgentState === "CREATING" ||
    selectedAgentState === "RESTORING" ||
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
    preferredPlanId,
    pendingSlotReleases,
    launchLabel: selectedAgent?.state === "ARCHIVED" ? "Restore agent" : "Start agent",
    launching: stoppedLaunchBusy,
    launchBlocked: stoppedLaunchBlocked,
    launchBlockedReason: stoppedLaunchBlockedReason,
    onLaunchAction: onStart,
  };
  const stoppedPanelContent = (() => {
    if (!isStartable) return null;
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
    if (currentPanel === "knowledge-hub" || currentPanel === "members") return panelContent;

    const chatPanelOwnsBootState =
      currentPanel === "chat" &&
      (
        isLifecycleBusy ||
        (activeAgent.state === "RUNNING" && shouldShowStartupAnimation)
      );

    if (chatPanelOwnsBootState) {
      return panelContent;
    }

    if (selectedAgentState === "STOPPING" || selectedAgentState === "ARCHIVING") {
      return (
        <AgentLoadingState
          title={selectedAgentState === "ARCHIVING" ? "Archiving agent" : "Stopping agent"}
          detail={selectedAgentState === "ARCHIVING"
            ? "Verifying the cold archive before releasing runtime resources."
            : "Stopping the runtime and cleaning up the workspace."}
          tone="loading"
          stage="complete"
        />
      );
    }

    if (shouldShowStartupAnimation) {
      const startupCopy =
        activeAgent.state === "CREATING"
          ? {
              title: "Creating agent",
              detail: "Preparing persistent storage and admitting the runtime.",
              stage: "runtime" as const,
            }
          : activeAgent.state === "RESTORING"
            ? {
                title: "Restoring files",
                detail: "Restoring the agent home directory before boot.",
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
          guided
          actionLabel={onStop ? "Stop agent" : undefined}
          onAction={onStop}
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

  const desktopSurfaceHeader = isDesktopViewport && surfaceHeader ? (
    <div data-slot="dashboard-surface-header" className="relative z-20 flex min-h-[76px] min-w-0 items-center justify-between gap-6 border-b border-border bg-surface-low/20 px-5 py-3 lg:px-6">
      <div className="flex min-w-0 items-center gap-3.5">
        {surfaceHeader.icon ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]">
            {surfaceHeader.icon}
          </span>
        ) : null}
        <div className="min-w-0 text-left">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[16px] font-semibold tracking-[-0.02em] text-foreground">{surfaceHeader.title}</p>
            {surfaceHeader.subtitle ? <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[9px] font-medium text-text-muted">{surfaceHeader.subtitle}</span> : null}
          </div>
          {surfaceHeader.description ? <p className="mt-1 max-w-[64ch] truncate text-[11px] leading-relaxed text-text-muted">{surfaceHeader.description}</p> : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-[1_1_36rem] items-center justify-end gap-4">
        {surfaceHeader.controlsTargetId ? <div id={surfaceHeader.controlsTargetId} className="flex w-full min-w-0 items-center justify-end" /> : null}
        {surfaceHeader.metrics?.length ? (
          <dl className="hidden shrink-0 items-center divide-x divide-border md:flex">
            {surfaceHeader.metrics.map((metric) => (
              <div key={metric.label} className="min-w-[76px] px-4 text-right first:pl-0 last:pr-0">
                <dt className="text-[9px] font-medium text-text-muted">{metric.label}</dt>
                <dd className={`mt-1 text-xs font-semibold tabular-nums ${metric.tone === "danger" ? "text-destructive" : metric.tone === "warning" ? "text-warning" : "text-foreground"}`}>{metric.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${!mobileShowChat && !isDesktopViewport ? "hidden" : "flex"}`}>
      {launcherContent ? (
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {persistentPanelContent}
          <div className="relative z-20 flex min-h-0 min-w-0 flex-1 bg-background">{launcherContent}</div>
        </div>
      ) : !selectedAgent && (!isAuthenticated || showAgentlessSectionPreviews) ? (
        <div className="flex-1 min-h-0">
          {showAgentlessDesktopPreview ? (
            <AgentDesktopEmptyState
              onCreate={onCreate}
              onLaunchAction={onCreate}
              launchLabel="Launch agent"
            />
          ) : currentPanel === "files" ? (
            <AgentFilesEmptyState
              onCreate={onCreate}
              onLaunchAction={onCreate}
              launchLabel="Launch agent"
            />
          ) : currentPanel === "integrations" ? (
            <AgentIntegrationsEmptyState
              onCreate={onCreate}
              onLaunchAction={onCreate}
              launchLabel="Launch agent"
            />
          ) : currentPanel === "skills" ? (
            <AgentSkillsEmptyState
              onCreate={onCreate}
              onLaunchAction={onCreate}
              launchLabel="Launch agent"
            />
          ) : currentPanel === "scheduled" ? (
            <AgentScheduledEmptyState
              onCreate={onCreate}
              onLaunchAction={onCreate}
              launchLabel="Launch agent"
            />
          ) : (
            <AgentEmptyState
              onCreate={onCreate}
              onLaunchAction={onCreate}
              launchLabel="Launch agent"
            />
          )}
        </div>
      ) : !selectedAgent && (currentPanel === "knowledge-hub" || currentPanel === "knowledge" || currentPanel === "members") ? (
        <>
          {desktopSurfaceHeader}
          <div className="flex-1 min-h-0">{panelContent}</div>
        </>
      ) : loadingInitialAgents && !selectedAgent ? (
        <div className="flex-1 min-h-0">
          <AgentLoadingState
            heading="Rejoining your teammate"
            note="Restoring your dashboard and recent conversation."
            title="Loading agents"
            detail="Checking who is available before opening your teammate."
            tone="loading"
            stage="complete"
            guided
          />
        </div>
      ) : !selectedAgent && hasAgents ? (
        <div className="flex-1 min-h-0">
          <AgentLoadingState
            heading="Rejoining your teammate"
            note="Restoring your dashboard and recent conversation."
            title="Selecting agent"
            detail="Opening the next available agent."
            tone="loading"
            stage="complete"
            guided
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
          preferredPlanId={preferredPlanId}
          workspaceName={workspaceName}
          hasAccountAgents={hasAccountAgents}
          creationDisabledReason={creationDisabledReason}
          onCreateWorkspace={onCreateWorkspace}
          onOpenMembers={onOpenMembers}
        />
      ) : (
        <>
          {desktopSurfaceHeader ?? (isDesktopViewport && (
            <div className="relative z-20 grid h-14 min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] items-center gap-3 border-b border-border bg-background px-4">
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
                  const avatar = agentAvatar(
                    selectedAgentDisplayName,
                    selectedAgent.meta,
                    agentProfileImageUrl(selectedAgent),
                  );
                  const AvatarIcon = avatar.icon;
                  return (
                    <div className="relative w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: avatar.bgColor }}>
                      {avatar.imageUrl ? (
                        <ResourceImage src={avatar.imageUrl} alt={`${selectedAgentDisplayName} avatar`} fill sizes="28px" className="object-cover" />
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

              <div className="z-0 flex w-[min(42vw,420px)] min-w-0 flex-col items-center justify-center px-2 text-center">
                <AgentDisplayNameEditor
                  key={selectedAgent.id}
                  agent={selectedAgent}
                  onUpdate={onUpdateAgentDisplayName}
                  className="w-full"
                />
                {!chatConnected && (
                  <p className="max-w-full truncate text-center text-xs text-text-muted">
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
          ))}

          <div className="relative flex-1 min-h-0 overflow-hidden">
            {persistentPanelContent}
            {renderSelectedPanelContent()}
          </div>
        </>
      )}
    </div>
  );
}
