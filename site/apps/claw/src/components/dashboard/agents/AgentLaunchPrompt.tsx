"use client";

import { Loader2, Play, Plus } from "lucide-react";

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

