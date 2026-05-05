"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  FolderOpen,
  Loader2,
  MessageSquare,
  Plug,
  ScrollText,
  Settings,
  TerminalSquare,
} from "lucide-react";
import { AgentLifecycleSteps, type AgentLifecycleStage } from "@/components/dashboard/AgentLifecycleSteps";
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
        <div className="p-6 text-sm text-[#d05f5f]">
          <p className="font-semibold">OpenClaw config render error</p>
          <pre className="mt-2 text-xs whitespace-pre-wrap">{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: null })} className="mt-2 text-xs underline">Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Connection Status Indicator ──

export type AgentStatusTone = "ready" | "starting" | "stopping" | "connecting" | "disconnected" | "stopped" | "failed";

export interface AgentStatusChipModel {
  label: "Ready" | "Provisioning" | "Booting" | "Starting" | "Stopping" | "Connecting" | "Disconnected" | "Stopped" | "Failed";
  detail: string;
  tone: AgentStatusTone;
  loading?: boolean;
}

const AGENT_STATUS_CHIP_STYLES: Record<AgentStatusTone, { shell: string; dot: string; text: string }> = {
  ready: {
    shell: "border-[#38D39F]/25 bg-[#38D39F]/8",
    dot: "bg-[#38D39F]",
    text: "text-[#38D39F]",
  },
  starting: {
    shell: "border-[#f0c56c]/25 bg-[#f0c56c]/8",
    dot: "bg-[#f0c56c]",
    text: "text-[#f0c56c]",
  },
  stopping: {
    shell: "border-[#f0c56c]/25 bg-[#f0c56c]/8",
    dot: "bg-[#f0c56c]",
    text: "text-[#f0c56c]",
  },
  connecting: {
    shell: "border-[#f0c56c]/25 bg-[#f0c56c]/8",
    dot: "bg-[#f0c56c]",
    text: "text-[#f0c56c]",
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
    shell: "border-[#d05f5f]/25 bg-[#d05f5f]/8",
    dot: "bg-[#d05f5f]",
    text: "text-[#d05f5f]",
  },
};

export function AgentStatusChip({ status }: { status: AgentStatusChipModel | null }) {
  if (!status) return null;
  const styles = AGENT_STATUS_CHIP_STYLES[status.tone];
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${styles.shell} ${styles.text}`}
      title={status.detail}
      aria-label={`${status.label}: ${status.detail}`}
    >
      {status.loading ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      ) : (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`} />
      )}
      <span className="truncate">{status.label}</span>
    </span>
  );
}

export function ConnectionStatusIndicator({
  status,
}: {
  status: "connected" | "connecting" | "disconnected";
}) {
  const connected = status === "connected";
  const connecting = status === "connecting";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium min-w-[5.25rem] ${
        connected
          ? "text-[#38D39F]"
          : connecting
            ? "text-[#f0c56c]"
            : "text-text-muted"
      }`}
      title={connected ? "Connected" : connecting ? "Connecting" : "Disconnected"}
    >
      {connecting ? (
        <Loader2 className="w-2 h-2 animate-spin" />
      ) : (
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            connected ? "bg-[#38D39F]" : "bg-text-muted"
          }`}
        />
      )}
      <span>
        {connected ? "Connected" : connecting ? "Connecting" : "Disconnected"}
      </span>
    </span>
  );
}

// ── Shared Loading State ──

interface AgentLoadingStateProps {
  title: string;
  detail?: string;
  tone?: "starting" | "connecting" | "loading";
  surface?: "default" | "terminal";
  stage?: AgentLifecycleStage;
}

export function AgentLoadingState({
  title,
  detail,
  tone = "connecting",
  surface = "default",
  stage,
}: AgentLoadingStateProps) {
  const accent = tone === "loading" ? "#38D39F" : "#f0c56c";
  const secondaryAccent = tone === "loading" ? "#7ef7c9" : "#4ea7ff";
  const lifecycleStage = stage ?? (tone === "loading" ? "complete" : "gateway");
  const ringOpacity = lifecycleStage === "gateway" ? 0.86 : 0.68;
  return (
    <div
      className={`flex h-full items-center justify-center ${
        surface === "terminal" ? "bg-[#0c1016] text-[#8b95a6]" : "text-text-muted"
      }`}
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative h-24 w-24" aria-hidden="true">
          <motion.span
            className="absolute inset-0 rounded-full opacity-25"
            animate={{
              boxShadow: [
                `0 0 20px ${accent}`,
                `0 0 46px ${accent}`,
                `0 0 20px ${accent}`,
              ],
              scale: [0.96, 1.05, 0.96],
            }}
            transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.span
            className="absolute inset-0 rounded-full border-2 border-transparent"
            style={{
              borderTopColor: accent,
              borderRightColor: `${secondaryAccent}cc`,
              opacity: ringOpacity,
              filter: `drop-shadow(0 0 5px ${accent})`,
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
          />
          <motion.span
            className="absolute inset-3 rounded-full border-2 border-transparent"
            style={{
              borderBottomColor: accent,
              borderLeftColor: `${secondaryAccent}aa`,
              opacity: ringOpacity * 0.78,
            }}
            animate={{ rotate: -360 }}
            transition={{ duration: 1.85, repeat: Infinity, ease: "linear" }}
          />
          <motion.span
            className="absolute inset-6 rounded-full border border-transparent"
            style={{
              borderTopColor: secondaryAccent,
              borderRightColor: `${accent}bb`,
              opacity: ringOpacity,
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.25, repeat: Infinity, ease: "linear" }}
          />
          <motion.span
            className="absolute inset-[1.8rem] rounded-full opacity-80"
            style={{
              background: `radial-gradient(circle, #ffffff 0%, ${accent} 45%, ${secondaryAccent} 100%)`,
              boxShadow: `0 0 14px ${accent}`,
            }}
            animate={{ scale: [0.82, 1.14, 0.82], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 1.15, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.span
            className="absolute inset-[1.35rem] rounded-full border"
            style={{ borderColor: `${secondaryAccent}55` }}
            animate={{ scale: [0.9, 1.16, 0.9], opacity: [0.25, 0.64, 0.25] }}
            transition={{ duration: 1.65, repeat: Infinity, ease: "easeInOut", delay: 0.1 }}
          />
        </div>
        <div className="space-y-1">
          <p className={surface === "terminal" ? "text-sm text-[#d8dde7]" : "text-sm font-medium text-foreground"}>
            {title}
          </p>
          {detail && (
            <p className={surface === "terminal" ? "text-xs text-[#8b95a6]" : "text-xs text-text-muted"}>
              {detail}
            </p>
          )}
        </div>
        <AgentLifecycleSteps stage={lifecycleStage} />
      </div>
    </div>
  );
}

// ── Tab Loading State (for logs/shell) ──

export function TabLoadingState({ label, detail, stage = "gateway" }: { label: string; detail?: string; stage?: AgentLifecycleStage }) {
  return (
    <AgentLoadingState
      title={label}
      detail={detail ?? "Opening a gateway stream."}
      tone="connecting"
      surface="terminal"
      stage={stage}
    />
  );
}

// ── Gear Dropdown — center-panel selector + modal openers ──

export type CenterPanel = "chat" | "files" | "integrations" | "logs" | "shell" | "settings";

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
    { key: "integrations", label: "Integrations", icon: Plug, action: () => onSelectPanel("integrations"), active: currentPanel === "integrations" },
    { key: "logs", label: "Logs", icon: ScrollText, action: () => onSelectPanel("logs"), active: currentPanel === "logs" },
    { key: "shell", label: "Shell", icon: TerminalSquare, action: () => onSelectPanel("shell"), active: currentPanel === "shell" },
    { key: "div1", label: "", icon: Settings, action: () => {}, divider: true },
    { key: "settings", label: "Settings", icon: Settings, action: onOpenSettings, active: currentPanel === "settings" },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          open
            ? "bg-surface-low text-foreground"
            : "text-text-muted hover:text-foreground hover:bg-surface-low"
        }`}
        title="Settings"
      >
        <Settings className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-2xl border border-border bg-[#111113] p-1.5 shadow-2xl">
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
