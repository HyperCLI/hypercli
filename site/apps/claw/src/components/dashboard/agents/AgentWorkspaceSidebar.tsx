"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Blocks,
  CalendarClock,
  ChevronUp,
  Codepen,
  FolderOpen,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Settings,
  Sparkles,
  SlidersHorizontal,
  TerminalSquare,
  X,
} from "lucide-react";

import type { Agent, AgentState } from "@/app/dashboard/agents/types";
import type { AgentMainTab } from "@/components/dashboard/DashboardMobileAgentMenuContext";
import type { HyperAgentPlan, HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";
import { Tooltip, TooltipContent, TooltipTrigger } from "@hypercli/shared-ui";
import { formatTokens } from "@/lib/format";
import { ClawThemePicker } from "@/components/ClawThemePicker";
import { AgentPlanSummary } from "./AgentPlanSummary";

const WORKSPACE_COLLAPSED_KEY = "agents.workspaceCollapsed.v2";

interface AgentWorkspaceSidebarProps {
  selectedAgent: Agent | null;
  activeTab: AgentMainTab;
  skillsActive?: boolean;
  planName?: string | null;
  subscriptionSummary?: HyperAgentSubscriptionSummary | null;
  catalogPlans?: HyperAgentPlan[] | null;
  tokenUsed?: number | null;
  tokenLimit?: number | null;
  disabled?: boolean;
  disabledReason?: string;
  scheduledDisabled?: boolean;
  scheduledDisabledReason?: string;
  isDesktopViewport: boolean;
  onSelectChat: () => void;
  onOpenFiles: () => void;
  onOpenIntegrations: () => void;
  onOpenSkills: () => void;
  onOpenScheduled: () => void;
  onOpenLogs: () => void;
  onOpenShell: () => void;
  onOpenOpenClaw: () => void;
  onOpenSettings: () => void;
  onUpgrade: () => void;
  renderMobile?: boolean;
  forceExpanded?: boolean;
  fillParent?: boolean;
  onClose?: () => void;
}

type WorkspaceItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
};

function WorkspaceButton({
  item,
  collapsed,
  mobileMode = false,
}: {
  item: WorkspaceItem;
  collapsed?: boolean;
  mobileMode?: boolean;
}) {
  const Icon = item.icon;
  const disabled = Boolean(item.disabled);
  const buttonSizeClass = collapsed
    ? "h-9 w-9 justify-center"
    : mobileMode
      ? "h-10 w-full gap-3.5 px-3.5 text-left"
      : "h-9 w-full gap-3 px-3 text-left";
  const iconClassName = mobileMode && !collapsed ? "h-5 w-5 shrink-0" : "h-4 w-4 shrink-0";
  const roundedClassName = "rounded-full";
  const buttonClassName = `flex ${buttonSizeClass} items-center ${roundedClassName} text-sm transition-colors ${
    disabled
      ? "cursor-not-allowed text-text-muted/45"
      : item.active
        ? mobileMode
          ? "border border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]"
          : "bg-surface-low text-foreground"
        : `${mobileMode ? "border border-transparent" : ""} text-text-secondary hover:bg-surface-low/60 hover:text-foreground`
  }`;

  if (collapsed) {
    return (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={disabled ? undefined : item.onClick}
            disabled={disabled}
            aria-label={item.label}
            aria-disabled={disabled}
            className={buttonClassName}
          >
            <Icon className={iconClassName} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{item.disabledReason ?? item.label}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <button
      type="button"
      onClick={disabled ? undefined : item.onClick}
      disabled={disabled}
      aria-disabled={disabled}
      title={item.disabledReason}
      className={buttonClassName}
    >
      <Icon className={iconClassName} />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

export function AgentWorkspaceSidebar({
  selectedAgent,
  activeTab,
  skillsActive = false,
  planName,
  subscriptionSummary,
  catalogPlans,
  tokenUsed,
  tokenLimit,
  disabled = false,
  disabledReason = "Workspace is loading",
  scheduledDisabled = false,
  scheduledDisabledReason = "Scheduled workflows are not available yet.",
  isDesktopViewport,
  onSelectChat,
  onOpenFiles,
  onOpenIntegrations,
  onOpenSkills,
  onOpenScheduled,
  onOpenLogs,
  onOpenShell,
  onOpenOpenClaw,
  onOpenSettings,
  onUpgrade,
  renderMobile = false,
  forceExpanded = false,
  fillParent = false,
  onClose,
}: AgentWorkspaceSidebarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(() => Boolean(selectedAgent));
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(WORKSPACE_COLLAPSED_KEY) === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(WORKSPACE_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);
  const isCollapsed = forceExpanded ? false : !isDesktopViewport || collapsed;
  const tokensUsed = typeof tokenUsed === "number" && Number.isFinite(tokenUsed) ? Math.max(0, tokenUsed) : null;
  const tokenTotal = tokenLimit && tokenLimit > 0 ? tokenLimit : null;
  const tokenProgress = tokenTotal && tokensUsed != null ? Math.min(100, Math.round((tokensUsed / tokenTotal) * 100)) : 0;
  const tokenUsageLabel = tokenTotal
    ? `${tokensUsed == null ? "--" : formatTokens(tokensUsed)} / ${formatTokens(tokenTotal)}`
    : `${tokensUsed == null ? "0" : formatTokens(tokensUsed)} / --`;
  const selectedAgentName = selectedAgent?.name?.trim() || selectedAgent?.id || "";

  const agentState: AgentState | undefined = selectedAgent?.state;
  const noSelectedAgent = !selectedAgent;
  const agentNotRunning = agentState !== "RUNNING";
  const stoppedReason = "Agent must be running";
  const emptyStateReason = "Select or create an agent first.";

  const disabledItemProps = disabled
    ? { disabled: true, disabledReason }
    : noSelectedAgent
      ? { disabled: true, disabledReason: emptyStateReason }
      : {};
  const workspaceItems: WorkspaceItem[] = [
    { id: "chat", label: "Chat", icon: MessageSquare, active: activeTab === "chat", onClick: onSelectChat, ...disabledItemProps },
    {
      id: "files",
      label: "Files",
      icon: FolderOpen,
      active: activeTab === "files",
      onClick: onOpenFiles,
      ...disabledItemProps,
    },
    { id: "integrations", label: "Integrations", icon: Blocks, active: activeTab === "integrations" && !skillsActive, onClick: onOpenIntegrations, ...disabledItemProps },
    { id: "skills", label: "Skills", icon: Codepen, active: skillsActive, onClick: onOpenSkills, ...disabledItemProps },
    {
      id: "scheduled",
      label: "Scheduled",
      icon: CalendarClock,
      active: activeTab === "scheduled",
      onClick: onOpenScheduled,
      ...(scheduledDisabled ? { disabled: true, disabledReason: scheduledDisabledReason } : disabledItemProps),
    },
  ];

  const advancedDropdownDisabled = disabled || noSelectedAgent;
  const advancedDropdownDisabledReason = disabled ? disabledReason : emptyStateReason;
  const advancedItemsOpen = advancedOpen && !advancedDropdownDisabled;
  const advancedDisabled = disabled
    ? disabledItemProps
    : noSelectedAgent
      ? { disabled: true, disabledReason: emptyStateReason }
      : agentNotRunning
        ? { disabled: true, disabledReason: stoppedReason }
        : {};
  const advancedItems: WorkspaceItem[] = [
    { id: "logs", label: "Logs", icon: TerminalSquare, active: activeTab === "logs", onClick: onOpenLogs, ...advancedDisabled },
    { id: "shell", label: "Shell", icon: TerminalSquare, active: activeTab === "shell", onClick: onOpenShell, ...advancedDisabled },
    { id: "openclaw", label: "OpenClaw settings", icon: SlidersHorizontal, active: activeTab === "openclaw", onClick: onOpenOpenClaw, ...(disabled || noSelectedAgent ? { disabled: true, disabledReason: advancedDropdownDisabledReason } : {}) },
    { id: "settings", label: "Settings", icon: Settings, active: activeTab === "settings", onClick: onOpenSettings, ...(disabled || noSelectedAgent ? { disabled: true, disabledReason: advancedDropdownDisabledReason } : {}) },
  ];

  if (!isDesktopViewport && !renderMobile) return null;

  return (
    <motion.aside
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={`flex ${
        fillParent ? "w-full" : isCollapsed ? "w-12" : "w-52"
      } relative h-full shrink-0 flex-col border-r border-border bg-[#232323] transition-[width] duration-200 ease-out`}
    >
      <div
        className={`flex h-14 shrink-0 items-center border-b border-border ${
          isCollapsed ? "justify-center px-0" : "gap-2 px-4"
        }`}
      >
        {!isCollapsed && !onClose && <ClawThemePicker menuAlign="start" size="sm" />}
        {!isCollapsed && (
          <div className="min-w-0 flex-1">
            {selectedAgentName ? (
              <p className="truncate text-[13px] font-medium leading-tight text-foreground" title={selectedAgentName}>
                {selectedAgentName}
              </p>
            ) : null}
          </div>
        )}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close workspace sidebar"
            className="flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        ) : isDesktopViewport ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                aria-label={isCollapsed ? "Expand workspace sidebar" : "Collapse workspace sidebar"}
                className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
              >
                {isCollapsed ? <PanelRight className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isCollapsed ? "Expand workspace" : "Collapse workspace"}
            </TooltipContent>
          </Tooltip>
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted"
            title="Workspace navigation"
            aria-hidden="true"
          >
            <PanelRight className={renderMobile ? "h-5 w-5" : "h-4 w-4"} />
          </div>
        )}
      </div>

      <div className={`flex-1 overflow-y-auto py-5 ${isCollapsed ? "px-1.5" : "px-3"}`}>
        {!isCollapsed && (
          <div className="mb-2 flex items-center justify-between gap-2 px-3">
            <p className="text-xs text-text-muted">Workspace</p>
          </div>
        )}
        <nav className={`space-y-1 ${isCollapsed ? "flex flex-col items-center" : ""}`}>
          {workspaceItems.map((item) => (
            <WorkspaceButton key={item.id} item={item} collapsed={isCollapsed} mobileMode={renderMobile} />
          ))}
        </nav>
      </div>

      <div className={`border-b border-border pb-4 ${isCollapsed ? "px-1.5" : "px-3"}`}>
        {isCollapsed ? (
          <div className="flex flex-col items-center space-y-1">
            {advancedItems.map((item) => (
              <WorkspaceButton key={item.id} item={item} collapsed />
            ))}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={advancedDropdownDisabled ? undefined : () => setAdvancedOpen((open) => !open)}
              disabled={advancedDropdownDisabled}
              aria-disabled={advancedDropdownDisabled}
              title={advancedDropdownDisabled ? advancedDropdownDisabledReason : undefined}
              className={`flex ${renderMobile ? "h-10 rounded-full px-3.5" : "h-9 rounded-full px-3"} w-full items-center justify-between text-sm transition-colors ${
                advancedDropdownDisabled
                  ? "cursor-not-allowed text-text-muted/45"
                  : "text-foreground hover:bg-surface-low/60"
              }`}
            >
              <span className={`inline-flex items-center ${renderMobile ? "gap-3.5" : "gap-3"}`}>
                <Settings className={renderMobile ? "h-5 w-5" : "h-4 w-4"} />
                Advanced
              </span>
              <ChevronUp className={`${renderMobile ? "h-5 w-5" : "h-4 w-4"} transition-transform ${advancedItemsOpen ? "" : "rotate-180"}`} />
            </button>
            {advancedItemsOpen && (
              <div className={renderMobile ? "mt-1 space-y-1" : "ml-7 mt-1 border-l border-border pl-3"}>
                {advancedItems.map((item) => (
                  renderMobile ? (
                    <WorkspaceButton key={item.id} item={item} mobileMode />
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.disabled ? undefined : item.onClick}
                      disabled={item.disabled}
                      aria-disabled={item.disabled}
                      title={item.disabledReason}
                      className={`block w-full rounded-full px-3 py-2 text-left text-sm transition-colors ${
                        item.disabled
                          ? "cursor-not-allowed text-text-muted/45"
                          : item.active
                          ? "bg-surface-low text-foreground"
                          : "text-text-secondary hover:bg-surface-low/60 hover:text-foreground"
                      }`}
                    >
                      {item.label}
                    </button>
                  )
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className={isCollapsed ? "p-1.5" : "p-3"}>
        {isCollapsed ? (
          <AgentPlanSummary
            planName={planName}
            subscriptionSummary={subscriptionSummary}
            catalogPlans={catalogPlans}
            tokenLimit={tokenTotal}
            tokenUsageLabel={tokenUsageLabel}
            tooltipSide="right"
            trigger={
              <button
                type="button"
                onClick={onUpgrade}
                aria-label="Upgrade plan"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
              >
                <Sparkles className="h-4 w-4" />
              </button>
            }
          />
        ) : (
          <div className="space-y-2">
            <AgentPlanSummary
              planName={planName}
              subscriptionSummary={subscriptionSummary}
              catalogPlans={catalogPlans}
              tokenLimit={tokenTotal}
              tokenUsageLabel={tokenUsageLabel}
            />
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-text-muted">Tokens today</span>
              <span className="font-medium text-foreground">{tokenUsageLabel}</span>
            </div>
            <div className="h-1 rounded-full bg-surface-low">
              <div className="h-full rounded-full bg-foreground/45" style={{ width: `${tokenProgress}%` }} />
            </div>
            <button
              type="button"
              onClick={onUpgrade}
              className={`flex w-full items-center justify-center gap-2 border border-border bg-background font-medium text-foreground transition-colors hover:bg-surface-low ${
                renderMobile ? "h-10 rounded-full text-sm" : "h-8 rounded-full text-xs"
              }`}
            >
              <Sparkles className={renderMobile ? "h-5 w-5" : "h-3.5 w-3.5"} />
              Upgrade
            </button>
          </div>
        )}
      </div>
    </motion.aside>
  );
}
