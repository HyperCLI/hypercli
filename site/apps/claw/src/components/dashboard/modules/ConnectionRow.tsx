"use client";

import type { Connection, StyleVariant } from "../agentViewTypes";

export function ConnectionRow({ connection, selected, onClick, variant = "off" }: { connection: Connection; selected: boolean; onClick: () => void; variant?: StyleVariant }) {
  const Icon = connection.icon;

  if (variant === "v1") {
    return (
      <button onClick={onClick} className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left transition-colors ${selected ? "bg-primary/10 text-primary" : "hover:bg-surface-low text-foreground"}`}>
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="text-xs truncate flex-1">{connection.name}</span>
        {connection.connected && <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
      </button>
    );
  }
  if (variant === "v2") {
    return (
      <button onClick={onClick} className={`w-full px-3 py-2.5 rounded-xl text-left transition-colors border ${selected ? "bg-primary/8 border-primary/25" : "hover:bg-surface-low border-border"}`}>
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${connection.connected ? "bg-primary/15 text-primary" : "bg-surface-high text-text-muted"}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{connection.name}</div>
            <div className="text-[10px] text-text-muted mt-0.5 line-clamp-1">{connection.description}</div>
          </div>
          {connection.connected && <div className="w-2 h-2 rounded-full bg-primary shrink-0" />}
        </div>
      </button>
    );
  }
  if (variant === "v3") {
    return (
      <button onClick={onClick} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-left transition-colors border ${selected ? "bg-primary/10 border-primary/30 text-primary" : connection.connected ? "bg-surface-low border-primary/20 text-foreground hover:bg-surface-high" : "bg-surface-low border-border text-text-muted hover:text-foreground hover:bg-surface-high"}`}>
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="text-xs font-medium">{connection.name}</span>
        {connection.connected && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">on</span>}
      </button>
    );
  }
  return (
    <button onClick={onClick} className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors ${selected ? "bg-primary/10 border border-primary/25" : "hover:bg-surface-low border border-transparent"}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${connection.connected ? "bg-primary/15 text-primary" : "bg-surface-high text-text-muted"}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate">{connection.name}</div>
        <div className="text-[10px] text-text-muted truncate">{connection.category}</div>
      </div>
      {connection.connected && <div className="w-2 h-2 rounded-full bg-primary shrink-0" />}
    </button>
  );
}
