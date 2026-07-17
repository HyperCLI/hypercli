"use client";

import * as React from "react";

import {
  discardSkillDraft,
  findSkillDraftTestSession,
  loadSkillDrafts,
  saveSkillDraft,
  type SkillDraftRecord,
  type SkillDraftScope,
  type SkillDraftTestSession,
} from "./skill-draft-store";

export function useSkillDrafts(scope: SkillDraftScope) {
  const [drafts, setDrafts] = React.useState<SkillDraftRecord[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const stableScope = React.useMemo(() => ({ ownerId: scope.ownerId, agentId: scope.agentId }), [scope.agentId, scope.ownerId]);

  React.useEffect(() => {
    let cancelled = false;
    void loadSkillDrafts(stableScope).then((records) => {
      if (!cancelled && records.length > 0) {
        setDrafts(records);
      }
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load local skill drafts.");
    });
    return () => { cancelled = true; };
  }, [stableScope]);

  const save = React.useCallback(async (draft: Pick<SkillDraftRecord, "id" | "origin" | "content" | "directories">) => {
    const record = await saveSkillDraft(stableScope, draft);
    setDrafts((current) => [record, ...current.filter((item) => item.id !== record.id)]);
    return record;
  }, [stableScope]);

  const discard = React.useCallback(async (draftId: string) => {
    await discardSkillDraft(stableScope, draftId);
    setDrafts((current) => current.filter((draft) => draft.id !== draftId));
  }, [stableScope]);

  return { drafts, error, save, discard };
}

export function useSkillDraftTestSession(scope: SkillDraftScope, sessionKey: string | null | undefined) {
  const [resolved, setResolved] = React.useState<{ sessionKey: string; testSession: SkillDraftTestSession | null } | null>(null);
  const stableScope = React.useMemo(() => ({ ownerId: scope.ownerId, agentId: scope.agentId }), [scope.agentId, scope.ownerId]);
  const refresh = React.useCallback(async () => {
    if (!sessionKey?.trim()) {
      setResolved(null);
      return null;
    }
    const next = await findSkillDraftTestSession(stableScope, sessionKey);
    setResolved({ sessionKey, testSession: next });
    return next;
  }, [sessionKey, stableScope]);

  React.useEffect(() => {
    let cancelled = false;
    if (!sessionKey?.trim()) return;
    void findSkillDraftTestSession(stableScope, sessionKey).then((next) => {
      if (!cancelled) setResolved({ sessionKey, testSession: next });
    });
    return () => { cancelled = true; };
  }, [sessionKey, stableScope]);

  return { testSession: resolved && resolved.sessionKey === sessionKey ? resolved.testSession : null, refresh };
}
