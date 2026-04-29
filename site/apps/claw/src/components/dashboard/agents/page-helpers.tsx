"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Loader2,
  MessageSquare,
  ScrollText,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
} from "lucide-react";
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
