import type { AgentSkillCreateRequest } from "@hypercli.com/sdk/skills";

import { discardSkillDraft, loadSkillDraft, type SkillDraftScope, type SkillDraftTestSession } from "./skill-draft-store";

export interface SaveSkillDraftFromTestOptions {
  scope: SkillDraftScope;
  testSession: SkillDraftTestSession;
  createSkill: (request: AgentSkillCreateRequest) => Promise<unknown>;
  closeSession: (sessionKey: string) => Promise<void>;
  openSkill: (skillId: string) => void;
}

export async function saveSkillDraftFromTest(options: SaveSkillDraftFromTestOptions): Promise<string> {
  const draft = await loadSkillDraft(options.scope, options.testSession.draftId);
  if (!draft) throw new Error("This skill draft is no longer available in this browser.");

  await options.createSkill({ id: draft.id, content: draft.content, directories: draft.directories });
  let cleanupError: unknown = null;
  try {
    await options.closeSession(options.testSession.requestedSessionKey);
  } catch (cause) {
    cleanupError = cause;
  }
  await discardSkillDraft(options.scope, draft.id);
  options.openSkill(draft.id);
  if (cleanupError) throw new Error("The skill was saved, but the test session could not be closed.");
  return draft.id;
}
