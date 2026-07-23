"use client";

import * as React from "react";
import type { AgentSkillRecoverRequest, AgentSkillRecoverResult, AgentSkillRecoveryCandidate } from "@hypercli.com/sdk/skills";
import { AlertTriangle, File, Folder, Loader2 } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@hypercli/shared-ui";

export interface SkillsRecoveryModalProps {
  candidate: AgentSkillRecoveryCandidate;
  onClose: () => void;
  onRecover: (request: AgentSkillRecoverRequest) => Promise<AgentSkillRecoverResult>;
}

export function SkillsRecoveryModal({ candidate, onClose, onRecover }: SkillsRecoveryModalProps) {
  const [skillId, setSkillId] = React.useState(candidate.suggestedSkillId);
  const [selectedPaths, setSelectedPaths] = React.useState<string[]>(
    candidate.entries.filter((entry) => entry.selectable && entry.selectedByDefault).map((entry) => entry.path),
  );
  const [recovering, setRecovering] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const validSkillId = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(skillId);

  const handleRecover = async () => {
    if (recovering || !validSkillId) return;
    setRecovering(true);
    setError(null);
    try {
      await onRecover({ candidateId: candidate.id, skillId, paths: selectedPaths });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not organize the workspace skill.");
    } finally {
      setRecovering(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !recovering) onClose(); }}>
      <DialogContent closeLabel="Close workspace skill review" overlayClassName="z-[79] bg-background/70 backdrop-blur-sm" className="z-[80] flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden rounded-2xl border-border bg-background p-0 shadow-2xl sm:max-w-[560px]">
        <DialogHeader className="gap-0 border-b border-border px-5 py-3 pr-12 text-left">
          <DialogTitle className="text-sm leading-normal text-foreground">Organize workspace skill</DialogTitle>
          <DialogDescription className="mt-0.5 text-[11px] leading-snug text-text-muted">
            Review the files created beside SKILL.md before moving them into the Skills library.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div>
                  <p className="text-xs font-semibold text-foreground">Unorganized skill found</p>
                  <p className="mt-1 text-[11px] leading-snug text-text-secondary">{candidate.description}</p>
                </div>
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">Skill ID</span>
              <input
                value={skillId}
                onChange={(event) => { setSkillId(event.target.value.trim().toLowerCase()); setError(null); }}
                disabled={recovering}
                className="h-9 w-full rounded-xl border border-border bg-surface-low/45 px-3 font-mono text-xs text-foreground outline-none transition-colors focus:border-primary/50 disabled:opacity-60"
                aria-invalid={!validSkillId}
              />
              {!validSkillId && <span className="mt-1.5 block text-[10px] text-error">Use lowercase letters, numbers, and single hyphens.</span>}
            </label>

            <div>
              <div className="mb-2 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold text-text-secondary">Files to include</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">SKILL.md is required. Review other workspace items before including them.</p>
                </div>
                <span className="shrink-0 text-[10px] text-text-muted">{selectedPaths.length + 1} selected</span>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-surface-low/25">
                <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
                  <input type="checkbox" checked disabled aria-label="Include SKILL.md" className="h-3.5 w-3.5 accent-primary" />
                  <File className="h-3.5 w-3.5 text-primary" />
                  <span className="min-w-0 flex-1 font-mono text-[11px] text-foreground">SKILL.md</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-primary">Required</span>
                </div>
                {candidate.entries.map((entry) => {
                  const checked = selectedPaths.includes(entry.path);
                  return (
                    <label key={entry.path} className={`flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0 ${recovering ? "cursor-wait" : entry.selectable ? "cursor-pointer hover:bg-surface-high/45" : "cursor-not-allowed opacity-55"}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!entry.selectable || recovering}
                        onChange={(event) => setSelectedPaths((current) => event.target.checked ? [...current, entry.path] : current.filter((path) => path !== entry.path))}
                        aria-label={`Include ${entry.name}`}
                        className="mt-0.5 h-3.5 w-3.5 accent-primary"
                      />
                      {entry.type === "directory" ? <Folder className="mt-0.5 h-3.5 w-3.5 text-warning" /> : <File className="mt-0.5 h-3.5 w-3.5 text-text-secondary" />}
                      <span className="min-w-0 flex-1">
                        <span className="block break-all font-mono text-[11px] text-foreground">{entry.name}</span>
                        {entry.reason && <span className="mt-0.5 block text-[9px] leading-snug text-text-muted">{entry.reason}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {error && <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>}
        </div>

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" size="sm" disabled={recovering} onClick={onClose} className="hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high">Cancel</Button>
          <Button type="button" size="sm" disabled={!validSkillId || recovering} onClick={() => void handleRecover()}>
            {recovering && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {recovering ? "Moving skill..." : "Move to Skills"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
