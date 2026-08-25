"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Blocks,
  CalendarClock,
  FolderOpen,
  Loader2,
  MessageSquare,
  ScrollText,
  Settings,
  TerminalSquare,
} from "lucide-react";
import { RecoveryState } from "@hypercli/shared-ui";
import {
  GATEWAY_LOADING_DETAIL,
  GATEWAY_LOADING_TITLE,
} from "@/components/dashboard/AgentGatewayLoadingVisual";
import { AgentStartupLoadingVisual } from "@/components/dashboard/AgentStartupLoadingVisual";
import type { AgentLifecycleStage } from "@/components/dashboard/AgentLifecycleSteps";
import type { AgentBootDisplayStatus } from "@/components/dashboard/agents/chat-boot-stage";
import { TooltipHint } from "@/components/ClawTooltip";
export { AgentLaunchPrompt } from "./AgentLaunchPrompt";

// ── Error Boundary ──

export class OpenClawErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <RecoveryState
          presentation="panel"
          title="Try again to open these settings"
          description="The settings view paused while rendering. Your saved configuration was not changed."
          technicalDetails={this.state.error.message}
          primaryAction={{ label: "Try again", onAction: () => this.setState({ error: null }) }}
          className="m-6"
        />
      );
    }
    return this.props.children;
  }
}

// ── Connection Status Indicator ──

export type AgentStatusTone = "ready" | "starting" | "stopping" | "connecting" | "disconnected" | "stopped" | "failed";

export interface AgentStatusChipModel {
  label:
    | "Ready"
    | "Creating"
    | "Restoring files"
    | "Booting"
    | "Stopping"
    | "Archiving"
    | "Preparing"
    | "Verifying"
    | "Loading"
    | "Connecting"
    | "Reconnecting"
    | "Disconnected"
    | "Stopped"
    | "Archived"
    | "Failed";
  detail: string;
  tone: AgentStatusTone;
  loading?: boolean;
}

export function getAgentWorkspaceStatus({
  connected,
  connecting,
  gatewayConnected,
  hydrating,
  conversation,
}: {
  connected: boolean;
  connecting: boolean;
  gatewayConnected: boolean;
  hydrating: boolean;
  conversation: boolean;
}): AgentStatusChipModel {
  if (hydrating || connecting) {
    if (!gatewayConnected) {
      return {
        label: "Preparing",
        detail: conversation ? "Preparing the selected conversation." : "Preparing the selected workspace.",
        tone: "connecting",
        loading: true,
      };
    }

    return {
      label: conversation ? "Verifying" : "Loading",
      detail: conversation ? "Verifying the selected conversation." : "Loading the selected workspace.",
      tone: "connecting",
      loading: true,
    };
  }

  if (connected) {
    return {
      label: "Ready",
      detail: conversation ? "Chat is available." : "Workspace is ready.",
      tone: "ready",
    };
  }

  return {
    label: "Disconnected",
    detail: "Gateway disconnected.",
    tone: "disconnected",
  };
}

const AGENT_STATUS_CHIP_STYLES: Record<AgentStatusTone, { shell: string; dot: string; text: string }> = {
  ready: {
    shell: "border-selection-accent/25 bg-selection-accent/10",
    dot: "bg-selection-accent",
    text: "text-selection-accent",
  },
  starting: {
    shell: "border-warning/25 bg-warning/10",
    dot: "bg-warning",
    text: "text-warning",
  },
  stopping: {
    shell: "border-warning/25 bg-warning/10",
    dot: "bg-warning",
    text: "text-warning",
  },
  connecting: {
    shell: "border-warning/25 bg-warning/10",
    dot: "bg-warning",
    text: "text-warning",
  },
  disconnected: {
    shell: "border-border bg-surface-low/50",
    dot: "bg-text-muted",
    text: "text-text-secondary",
  },
  stopped: {
    shell: "border-border bg-surface-low/50",
    dot: "bg-text-muted",
    text: "text-text-secondary",
  },
  failed: {
    shell: "border-warning/25 bg-warning/10",
    dot: "bg-warning",
    text: "text-warning",
  },
};

export function AgentStatusChip({ status }: { status: AgentStatusChipModel | null }) {
  if (!status) return null;
  const styles = AGENT_STATUS_CHIP_STYLES[status.tone];
  return (
    <TooltipHint label={status.detail}>
      <span
        className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${styles.shell} ${styles.text}`}
        aria-label={`${status.label}: ${status.detail}`}
        tabIndex={0}
      >
        {status.loading ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`} />
        )}
        <span className="truncate">{status.label}</span>
      </span>
    </TooltipHint>
  );
}

export function ConnectionStatusIndicator({
  status,
}: {
  status: "connected" | "connecting" | "reconnecting" | "disconnected";
}) {
  const connected = status === "connected";
  const connecting = status === "connecting" || status === "reconnecting";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium min-w-[5.25rem] ${
        connected
          ? "text-selection-accent"
          : connecting
            ? "text-warning"
            : "text-text-muted"
      }`}
    >
      {connecting ? (
        <Loader2 className="w-2 h-2 animate-spin" />
      ) : (
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            connected ? "bg-selection-accent" : "bg-text-muted"
          }`}
        />
      )}
      <span>
        {connected ? "Connected" : status === "reconnecting" ? "Reconnecting" : connecting ? "Connecting" : "Disconnected"}
      </span>
    </span>
  );
}

// ── Shared Loading State ──

interface AgentLoadingStateProps {
  heading?: string;
  note?: string;
  title?: string;
  detail?: string;
  tone?: "starting" | "connecting" | "loading";
  surface?: "default" | "terminal";
  stage?: AgentLifecycleStage;
  bootStatus?: AgentBootDisplayStatus;
  actionLabel?: string;
  onAction?: () => void;
}

export function AgentLoadingState({
  heading,
  note,
  title,
  detail,
  surface = "default",
  stage = "gateway",
  bootStatus,
  actionLabel,
  onAction,
}: AgentLoadingStateProps) {
  const resolvedTitle = bootStatus?.title ?? title ?? GATEWAY_LOADING_TITLE;
  const resolvedDetail = bootStatus?.detail ?? detail ?? GATEWAY_LOADING_DETAIL;
  const resolvedStage = bootStatus?.stage ?? stage;
  const resolvedStatus = bootStatus?.status ?? "loading";

  return (
    <div
      className="flex h-full min-h-0 items-center justify-center overflow-hidden px-4 py-3 sm:px-5 sm:py-4"
      data-loading-surface={surface}
      data-loading-stage={resolvedStage}
    >
      <AgentStartupLoadingVisual
        heading={heading}
        note={note}
        title={resolvedTitle}
        detail={resolvedDetail}
        technicalDetails={bootStatus?.status === "error" ? bootStatus.technicalDetail : undefined}
        status={resolvedStatus}
        actionLabel={actionLabel}
        onAction={onAction}
      />
    </div>
  );
}

// ── Tab Loading State (for logs/shell) ──

export function TabLoadingState({
  label,
  detail,
  stage = "gateway",
  bootStatus,
  onAction,
}: {
  label: string;
  detail?: string;
  stage?: AgentLifecycleStage;
  bootStatus?: AgentBootDisplayStatus;
  onAction?: () => void;
}) {
  return (
    <AgentLoadingState
      title={label}
      detail={detail ?? "Opening a gateway stream."}
      tone="connecting"
      surface="terminal"
      stage={stage}
      bootStatus={bootStatus}
      actionLabel={bootStatus?.status === "error" ? "Retry" : undefined}
      onAction={onAction}
    />
  );
}

// ── Gear Dropdown — center-panel selector + modal openers ──

export type CenterPanel = "chat" | "files" | "desktop" | "integrations" | "skills" | "knowledge-hub" | "knowledge" | "members" | "scheduled" | "logs" | "shell" | "settings";

interface GearDropdownProps {
  currentPanel: CenterPanel;
  onSelectPanel: (panel: CenterPanel) => void;
  onOpenSettings: () => void;
}

export function GearDropdown({
  currentPanel,
  onSelectPanel,
  onOpenSettings,
}: GearDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const items: Array<{
    key: string;
    label: string;
    icon: typeof Settings;
    action: () => void;
    active?: boolean;
    divider?: boolean;
  }> = [
    { key: "chat", label: "Chat", icon: MessageSquare, action: () => onSelectPanel("chat"), active: currentPanel === "chat" },
    { key: "files", label: "Files", icon: FolderOpen, action: () => onSelectPanel("files"), active: currentPanel === "files" },
    { key: "integrations", label: "Integrations", icon: Blocks, action: () => onSelectPanel("integrations"), active: currentPanel === "integrations" },
    { key: "scheduled", label: "Scheduled", icon: CalendarClock, action: () => onSelectPanel("scheduled"), active: currentPanel === "scheduled" },
    { key: "logs", label: "Logs", icon: ScrollText, action: () => onSelectPanel("logs"), active: currentPanel === "logs" },
    { key: "shell", label: "Shell", icon: TerminalSquare, action: () => onSelectPanel("shell"), active: currentPanel === "shell" },
    { key: "div1", label: "", icon: Settings, action: () => {}, divider: true },
    { key: "settings", label: "Settings", icon: Settings, action: onOpenSettings, active: currentPanel === "settings" },
  ];

  return (
    <div ref={ref} className="relative">
      <TooltipHint label="Settings">
        <button
          aria-label="Settings"
          onClick={() => setOpen((v) => !v)}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
            open
              ? "bg-surface-low text-foreground"
              : "text-text-muted hover:text-foreground hover:bg-surface-low"
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </TooltipHint>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-2xl border border-border bg-popover p-1.5 shadow-2xl">
          {items.map((item) =>
            item.divider ? (
              <div key={item.key} className="my-1 border-t border-border" />
            ) : (
              <button
                key={item.key}
                onClick={() => { item.action(); setOpen(false); }}
                className={`w-full flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition-colors text-left ${
                  item.active
                    ? "bg-surface-low text-foreground font-medium"
                    : "text-text-muted hover:text-foreground hover:bg-surface-low/50"
                }`}
              >
                <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{item.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
