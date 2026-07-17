"use client";

import * as React from "react";
import { FlaskConical, Loader2, Save } from "lucide-react";
import { Button, toast } from "@hypercli/shared-ui";

import type { SkillDraftTestSession } from "./skill-draft-store";

export interface SkillDraftTestBannerProps {
  testSession: SkillDraftTestSession;
  onOpenDraft: () => void;
  onSaveDraft?: () => Promise<void>;
}

export function SkillDraftTestBanner({ testSession, onOpenDraft, onSaveDraft }: SkillDraftTestBannerProps) {
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    if (!onSaveDraft || saving) return;
    setSaving(true);
    try {
      await onSaveDraft();
      toast.success(`${testSession.skillName} saved to the agent.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the skill draft.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-primary/20 bg-primary/8 px-3 py-2 sm:px-4">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-background/65"><FlaskConical className="h-3.5 w-3.5 text-primary" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold text-foreground">Testing draft: {testSession.skillName}</p>
          <p className="text-[9px] text-text-muted">Simulation only. This draft is not installed on the agent.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onOpenDraft} className="h-7 min-h-0 px-2 text-[10px] hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high">Open draft</Button>
        {onSaveDraft && <Button type="button" size="sm" disabled={saving} onClick={() => void handleSave()} className="h-7 min-h-0 px-2 text-[10px]">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}{saving ? "Saving..." : "Save to agent"}</Button>}
      </div>
    </div>
  );
}
