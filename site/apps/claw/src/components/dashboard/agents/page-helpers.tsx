"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Play,
  Plus,
  MessageSquare,
  ScrollText,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
} from "lucide-react";

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

// ── Agent Launch Prompt ──

interface AgentLaunchPromptProps {
  label: string;
  launching: boolean;
  onLaunch: () => void;
  blockedTitle?: string | null;
  blockedMessage?: string | null;
  suggestedTierActions?: Array<{ label: string; onSelect: () => void }> | null;
}

export function AgentLaunchPrompt({
  label,
  launching,
  onLaunch,
  blockedTitle,
  blockedMessage,
  suggestedTierActions,
}: AgentLaunchPromptProps) {
  const blocked = Boolean(blockedMessage);
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <button
          onClick={onLaunch}
          disabled={launching || blocked}
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center text-text-muted transition-colors hover:text-foreground disabled:opacity-60"
          aria-label={`Launch agent to use ${label}`}
          title={blockedTitle || "Launch Agent"}
        >
          {launching ? <Loader2 className="h-6 w-6 animate-spin" /> : <Play className="h-6 w-6" />}
        </button>
        <p className="text-base text-foreground">Launch Agent to Use {label}</p>
        <button
          onClick={onLaunch}
          disabled={launching || blocked}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-muted transition-colors hover:text-foreground hover:bg-surface-low disabled:opacity-60"
        >
          {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          <span>Launch Agent</span>
        </button>
        {blockedMessage && (
          <div className="mt-4 rounded-xl border border-[#f0c56c]/20 bg-[#f0c56c]/10 px-4 py-3 text-left">
            <p className="text-sm font-medium text-[#f0c56c]">{blockedTitle || "Launch blocked"}</p>
            <p className="mt-1 text-sm text-text-secondary">{blockedMessage}</p>
            {suggestedTierActions && suggestedTierActions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestedTierActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={action.onSelect}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-low"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-sm text-text-muted">Files remain available while stopped.</p>
      </div>
    </div>
  );
}

// ── Connection Status Indicator ──

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

// ── Tab Loading State (for logs/shell) ──

export function TabLoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-[#0c1016] text-[#8b95a6]">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-6 w-6 animate-spin" />
        <div className="space-y-1">
          <p className="text-sm text-[#d8dde7]">{label}</p>
          <p className="text-xs text-[#8b95a6]">Establishing connection...</p>
        </div>
      </div>
    </div>
  );
}

// ── Gear Dropdown — center-panel selector + modal openers ──

export type CenterPanel = "chat" | "logs" | "shell";

interface GearDropdownProps {
  currentPanel: CenterPanel;
  onSelectPanel: (panel: CenterPanel) => void;
  onOpenConfig: () => void;
  onOpenSettings: () => void;
}

export function GearDropdown({
  currentPanel,
  onSelectPanel,
  onOpenConfig,
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
    { key: "logs", label: "Logs", icon: ScrollText, action: () => onSelectPanel("logs"), active: currentPanel === "logs" },
    { key: "shell", label: "Shell", icon: TerminalSquare, action: () => onSelectPanel("shell"), active: currentPanel === "shell" },
    { key: "div1", label: "", icon: Settings, action: () => {}, divider: true },
    { key: "openclaw", label: "OpenClaw Config", icon: SlidersHorizontal, action: onOpenConfig },
    { key: "settings", label: "Settings & Integrations", icon: Settings, action: onOpenSettings },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
          open
            ? "bg-surface-low text-foreground"
            : "text-text-muted hover:text-foreground hover:bg-surface-low"
        }`}
        title="Settings"
      >
        <Settings className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-border bg-[#111113] shadow-2xl py-1">
          {items.map((item) =>
            item.divider ? (
              <div key={item.key} className="my-1 border-t border-border" />
            ) : (
              <button
                key={item.key}
                onClick={() => { item.action(); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left ${
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
