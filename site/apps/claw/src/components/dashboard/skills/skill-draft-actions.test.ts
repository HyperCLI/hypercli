import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveSkillDraftFromTest } from "./skill-draft-actions";
import { findSkillDraftTestSession, linkSkillDraftTestSession, loadSkillDraft, saveSkillDraft, type SkillDraftScope } from "./skill-draft-store";

const scope: SkillDraftScope = { ownerId: "save-test@example.com", agentId: "save-test-agent" };

beforeEach(() => {
  vi.stubGlobal("indexedDB", undefined);
  window.localStorage.clear();
});

async function setup() {
  const draft = await saveSkillDraft(scope, { id: "release-helper", origin: "created", content: "# Release Helper", directories: ["scripts"] });
  const testSession = await linkSkillDraftTestSession(scope, {
    draftId: draft.id,
    revisionId: `${draft.id}:revision`,
    skillId: draft.id,
    skillName: "Release Helper",
    requestedSessionKey: "session-draft-test",
  });
  return { draft, testSession };
}

describe("saveSkillDraftFromTest", () => {
  it("saves the draft, closes its test session, removes local data, and opens the saved skill", async () => {
    const { testSession } = await setup();
    const createSkill = vi.fn(async () => ({ skillId: "release-helper" }));
    const closeSession = vi.fn(async () => undefined);
    const openSkill = vi.fn();

    await expect(saveSkillDraftFromTest({ scope, testSession, createSkill, closeSession, openSkill })).resolves.toBe("release-helper");

    expect(createSkill).toHaveBeenCalledWith({ id: "release-helper", content: "# Release Helper", directories: ["scripts"] });
    expect(closeSession).toHaveBeenCalledWith("session-draft-test");
    expect(openSkill).toHaveBeenCalledWith("release-helper");
    await expect(loadSkillDraft(scope, "release-helper")).resolves.toBeNull();
    await expect(findSkillDraftTestSession(scope, "session-draft-test")).resolves.toBeNull();
  });

  it("still opens the saved skill and clears the draft when session cleanup fails", async () => {
    const { testSession } = await setup();
    const openSkill = vi.fn();

    await expect(saveSkillDraftFromTest({
      scope,
      testSession,
      createSkill: vi.fn(async () => ({ skillId: "release-helper" })),
      closeSession: vi.fn(async () => { throw new Error("gateway unavailable"); }),
      openSkill,
    })).rejects.toThrow(/skill was saved/i);

    expect(openSkill).toHaveBeenCalledWith("release-helper");
    await expect(loadSkillDraft(scope, "release-helper")).resolves.toBeNull();
  });

  it("keeps the draft when saving fails", async () => {
    const { testSession } = await setup();
    const closeSession = vi.fn(async () => undefined);
    const openSkill = vi.fn();

    await expect(saveSkillDraftFromTest({
      scope,
      testSession,
      createSkill: vi.fn(async () => { throw new Error("storage unavailable"); }),
      closeSession,
      openSkill,
    })).rejects.toThrow("storage unavailable");

    expect(closeSession).not.toHaveBeenCalled();
    expect(openSkill).not.toHaveBeenCalled();
    await expect(loadSkillDraft(scope, "release-helper")).resolves.toMatchObject({ id: "release-helper" });
  });
});
