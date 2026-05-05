"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Box,
  CalendarClock,
  ChevronUp,
  FolderOpen,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Plug,
  Settings,
  Sparkles,
  TerminalSquare,
} from "lucide-react";

import type { Agent, AgentState } from "@/app/dashboard/agents/types";
import type { AgentMainTab } from "@/components/dashboard/DashboardMobileAgentMenuContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@hypercli/shared-ui";
import { formatTokens } from "@/lib/format";

const WORKSPACE_COLLAPSED_KEY = "agents.workspaceCollapsed.v2";

interface AgentWorkspaceSidebarProps {
  selectedAgent: Agent | null;
  activeTab: AgentMainTab;
  skillsActive?: boolean;
  planName?: string | null;
  tokenUsed?: number | null;
  tokenLimit?: number | null;
  disabled?: boolean;
  disabledReason?: string;
  mobileShowChat: boolean;
  isDesktopViewport: boolean;
  onSelectChat: () => void;
  onOpenFiles: () => void;
  onOpenIntegrations: () => void;
  onOpenSkills: () => void;
  onOpenScheduled: () => void;
  onOpenLogs: () => void;
  onOpenShell: () => void;
  onOpenSettings: () => void;
  onUpgrade: () => void;
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

function inferPlanLabel(tokenTotal: number | null): string {
  if (!tokenTotal) return "Current";
  if (tokenTotal >= 500_000_000) return "Team";
  if (tokenTotal >= 250_000_000) return "Pro";
  if (tokenTotal >= 50_000_000) return "Starter";
  return "Free";
}

function formatPlanLabel(label: string): string {
  return /\bplan\b/i.test(label) ? label : `${label} plan`;
}

function WorkspaceButton({ item, collapsed }: { item: WorkspaceItem; collapsed?: boolean }) {
  const Icon = item.icon;
  const disabled = Boolean(item.disabled);
  const buttonClassName = `flex h-9 ${
    collapsed ? "w-9 justify-center" : "w-full gap-3 px-3 text-left"
  } items-center rounded-full text-sm transition-colors ${
    disabled
      ? "cursor-not-allowed text-text-muted/45"
      : item.active
        ? "bg-surface-low text-foreground"
        : "text-text-secondary hover:bg-surface-low/60 hover:text-foreground"
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
            <Icon className="h-4 w-4 shrink-0" />
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
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

export function AgentWorkspaceSidebar({
  selectedAgent,
  activeTab,
  skillsActive = false,
  planName,
  tokenUsed,
  tokenLimit,
  disabled = false,
  disabledReason = "Workspace is loading",
  mobileShowChat,
  isDesktopViewport,
  onSelectChat,
  onOpenFiles,
  onOpenIntegrations,
  onOpenSkills,
  onOpenScheduled,
  onOpenLogs,
  onOpenShell,
  onOpenSettings,
  onUpgrade,
}: AgentWorkspaceSidebarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(WORKSPACE_COLLAPSED_KEY) === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(WORKSPACE_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);
  const isCollapsed = collapsed && isDesktopViewport;
  const tokensUsed = typeof tokenUsed === "number" && Number.isFinite(tokenUsed) ? Math.max(0, tokenUsed) : null;
  const tokenTotal = tokenLimit && tokenLimit > 0 ? tokenLimit : null;
  const tokenProgress = tokenTotal && tokensUsed != null ? Math.min(100, Math.round((tokensUsed / tokenTotal) * 100)) : 0;
  const planLabel = planName?.trim() || inferPlanLabel(tokenTotal);
  const planDisplay = formatPlanLabel(planLabel);
  const tokenUsageLabel = tokenTotal
    ? `${tokensUsed == null ? "--" : formatTokens(tokensUsed)} / ${formatTokens(tokenTotal)}`
    : `${tokensUsed == null ? "0" : formatTokens(tokensUsed)} / --`;

  const agentState: AgentState | undefined = selectedAgent?.state;
  const agentNotRunning = agentState !== "RUNNING";
  const stoppedReason = "Agent must be running";

  const disabledItemProps = disabled ? { disabled: true, disabledReason } : {};
  const unavailableItemProps = disabled
    ? disabledItemProps
    : { disabled: true, disabledReason: "Coming soon" };
  const workspaceItems: WorkspaceItem[] = [
    { id: "chat", label: "Chat", icon: MessageSquare, active: activeTab === "chat", onClick: onSelectChat, ...disabledItemProps },
    {
      id: "files",
      label: "Files",
      icon: FolderOpen,
      active: activeTab === "files",
      onClick: onOpenFiles,
      ...(disabled ? disabledItemProps : agentNotRunning ? { disabled: true, disabledReason: stoppedReason } : {}),
    },
    { id: "integrations", label: "Integrations", icon: Plug, active: activeTab === "integrations" && !skillsActive, onClick: onOpenIntegrations, ...disabledItemProps },
    { id: "skills", label: "Skills", icon: Box, active: skillsActive, onClick: onOpenSkills, ...disabledItemProps },
    { id: "scheduled", label: "Scheduled", icon: CalendarClock, onClick: onOpenScheduled, ...unavailableItemProps },
  ];

  const advancedDisabled = disabled ? disabledItemProps : agentNotRunning ? { disabled: true, disabledReason: stoppedReason } : {};
  const advancedItems: WorkspaceItem[] = [
    { id: "logs", label: "Logs", icon: TerminalSquare, active: activeTab === "logs", onClick: onOpenLogs, ...advancedDisabled },
    { id: "shell", label: "Shell", icon: TerminalSquare, active: activeTab === "shell", onClick: onOpenShell, ...advancedDisabled },
    { id: "settings", label: "Settings", icon: Settings, active: activeTab === "settings", onClick: onOpenSettings, ...disabledItemProps },
  ];

  return (
    <motion.aside
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={`${mobileShowChat && !isDesktopViewport ? "hidden" : "flex"} ${
        isCollapsed ? "w-12" : "w-52"
      } relative h-full shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 ease-out`}
    >
      {disabled && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 px-3 text-center backdrop-blur-[1px]"
          role="status"
          aria-live="polite"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {!isCollapsed && (
            <div className="rounded-xl border border-[#f0c56c]/25 bg-[#f0c56c]/10 px-3 py-2">
              <p className="text-xs font-medium text-[#f0c56c]">Workspace loading</p>
              <p className="mt-1 text-[11px] leading-snug text-text-muted">{disabledReason}</p>
            </div>
          )}
        </div>
      )}
      <div
        className={`flex h-14 shrink-0 items-center border-b border-border ${
          isCollapsed ? "justify-center px-0" : "justify-between px-4"
        }`}
      >
        {!isCollapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {selectedAgent?.name || selectedAgent?.pod_name || "Agent name"}
            </p>
          </div>
        )}
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
      </div>

      <div className={`flex-1 overflow-y-auto py-5 ${isCollapsed ? "px-1.5" : "px-3"}`}>
        {!isCollapsed && (
          <div className="mb-2 flex items-center justify-between gap-2 px-3">
            <p className="text-xs text-text-muted">Workspace</p>
            {disabled && <p className="truncate text-[10px] text-[#f0c56c]">Loading</p>}
          </div>
        )}
        <nav className={`space-y-1 ${isCollapsed ? "flex flex-col items-center" : ""}`}>
          {workspaceItems.map((item) => (
            <WorkspaceButton key={item.id} item={item} collapsed={isCollapsed} />
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
              onClick={disabled ? undefined : () => setAdvancedOpen((open) => !open)}
              disabled={disabled}
              aria-disabled={disabled}
              title={disabled ? disabledReason : undefined}
              className={`flex h-9 w-full items-center justify-between rounded-full px-3 text-sm transition-colors ${
                disabled
                  ? "cursor-not-allowed text-text-muted/45"
                  : "text-foreground hover:bg-surface-low/60"
              }`}
            >
              <span className="inline-flex items-center gap-3">
                <Settings className="h-4 w-4" />
                Advanced
              </span>
              <ChevronUp className={`h-4 w-4 transition-transform ${advancedOpen ? "" : "rotate-180"}`} />
            </button>
            {advancedOpen && (
              <div className="ml-7 mt-1 border-l border-border pl-3">
                {advancedItems.map((item) => (
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
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className={isCollapsed ? "p-1.5" : "p-3"}>
        {isCollapsed ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onUpgrade}
                aria-label="Upgrade plan"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
              >
                <Sparkles className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {planDisplay} · {tokenUsageLabel}
            </TooltipContent>
          </Tooltip>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">{planDisplay}</p>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-text-muted">Tokens today</span>
              <span className="font-medium text-foreground">{tokenUsageLabel}</span>
            </div>
            <div className="h-1 rounded-full bg-surface-low">
              <div className="h-full rounded-full bg-primary" style={{ width: `${tokenProgress}%` }} />
            </div>
            <button
              type="button"
              onClick={onUpgrade}
              className="flex h-8 w-full items-center justify-center gap-2 rounded-full border border-border bg-background text-xs font-medium text-foreground transition-colors hover:bg-surface-low"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Upgrade
            </button>
          </div>
        )}
      </div>
    </motion.aside>
  );
}
