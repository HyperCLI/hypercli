"use client";

import React from "react";
import { Check, Loader2, PenLine, X } from "lucide-react";

import type { Agent } from "@/app/dashboard/agents/types";
import { TooltipHint } from "@/components/ClawTooltip";
import { agentDisplayLabel } from "@/components/dashboard/agents/agentViewModel";

interface AgentDisplayNameEditorProps {
  agent: Agent;
  onUpdate?: (agentId: string, displayName: string) => Promise<void> | void;
  className?: string;
}

export function AgentDisplayNameEditor({
  agent,
  onUpdate,
  className,
}: AgentDisplayNameEditorProps) {
  const displayName = agentDisplayLabel(agent);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();

  const beginEditing = () => {
    setDraft(displayName);
    setError(null);
    setEditing(true);
  };
  const cancelEditing = () => {
    if (saving) return;
    setEditing(false);
    setError(null);
  };
  const saveDisplayName = async () => {
    if (!onUpdate || saving) return;
    const nextDisplayName = draft.trim();
    if (!nextDisplayName) {
      setError("Display name is required.");
      return;
    }
    if (nextDisplayName === displayName) {
      cancelEditing();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onUpdate(agent.id, nextDisplayName);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the display name.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`relative flex min-w-0 max-w-full justify-center text-center ${className ?? ""}`}>
      {editing ? (
        <form
          className="flex h-8 w-full max-w-72 min-w-0 items-center justify-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void saveDisplayName();
          }}
        >
          <input
            autoFocus
            aria-label="Agent display name"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            value={draft}
            maxLength={agent.managed === false ? 255 : 64}
            spellCheck={agent.managed === false}
            disabled={saving}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEditing();
              }
            }}
            className="h-8 min-w-0 flex-1 rounded-lg border border-border-strong bg-background px-2 text-center text-sm font-medium text-foreground outline-none transition-colors focus:border-[rgb(var(--selection-accent-rgb)_/_0.65)] focus:ring-2 focus:ring-[rgb(var(--selection-accent-rgb)_/_0.16)] disabled:opacity-60"
          />
          <button
            type="submit"
            aria-label="Save agent display name"
            disabled={saving || !draft.trim() || draft.trim() === displayName}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--selection-accent)] transition-colors hover:bg-[rgb(var(--selection-accent-rgb)_/_0.12)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Cancel editing agent display name"
            disabled={saving}
            onClick={cancelEditing}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      ) : onUpdate ? (
        <TooltipHint label="Edit display name">
          <button
            type="button"
            aria-label="Edit agent display name"
            onClick={beginEditing}
            className="group relative grid h-8 max-w-full min-w-0 place-items-center rounded-full px-7 text-sm font-medium text-foreground transition-colors hover:bg-surface-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)]"
          >
            <span className="min-w-0 max-w-full truncate">{displayName}</span>
            <PenLine className="pointer-events-none absolute right-2.5 h-3 w-3 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>
        </TooltipHint>
      ) : (
        <p className="max-w-full truncate text-sm font-medium text-foreground">{displayName}</p>
      )}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="absolute left-1/2 top-full z-50 mt-1 w-max max-w-[min(22rem,80vw)] -translate-x-1/2 rounded-lg border border-destructive/30 bg-popover px-2.5 py-1.5 text-left text-xs font-normal text-destructive shadow-lg"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
