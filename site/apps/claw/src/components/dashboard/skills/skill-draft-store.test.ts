import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSkillDraftRevision,
  discardSkillDraft,
  findSkillDraftTestSession,
  linkSkillDraftTestSession,
  loadSkillDraft,
  loadSkillDrafts,
  saveSkillDraft,
  type SkillDraftScope,
} from "./skill-draft-store";

const scope: SkillDraftScope = { ownerId: "draft-test@example.com", agentId: "agent-draft-test" };

beforeEach(() => {
  vi.stubGlobal("indexedDB", undefined);
  window.localStorage.clear();
});

describe("skill draft store", () => {
  it("persists drafts by user and agent scope", async () => {
    await saveSkillDraft(scope, {
      id: "release-helper",
      origin: "created",
      content: "# Release Helper",
      directories: ["scripts", "references"],
    });

    await expect(loadSkillDrafts(scope)).resolves.toEqual([
      expect.objectContaining({ id: "release-helper", content: "# Release Helper", directories: ["references", "scripts"] }),
    ]);
    await expect(loadSkillDraft({ ...scope, agentId: "another-agent" }, "release-helper")).resolves.toBeNull();
  });

  it("deduplicates immutable revisions and resolves scoped session aliases", async () => {
    const draft = await saveSkillDraft(scope, {
      id: "release-helper",
      origin: "created",
      content: "# Release Helper",
      directories: ["scripts"],
    });
    const first = await createSkillDraftRevision(scope, draft);
    const second = await createSkillDraftRevision(scope, draft);
    expect(second).toEqual(first);

    await linkSkillDraftTestSession(scope, {
      draftId: draft.id,
      revisionId: first.id,
      skillId: draft.id,
      skillName: "Release Helper",
      requestedSessionKey: "session-test-123",
    });

    await expect(findSkillDraftTestSession(scope, "agent:default:session-test-123")).resolves.toMatchObject({
      draftId: "release-helper",
      revisionId: first.id,
    });
  });

  it("discards the draft and its local test association together", async () => {
    const draft = await saveSkillDraft(scope, { id: "release-helper", origin: "created", content: "# Release Helper", directories: [] });
    const revision = await createSkillDraftRevision(scope, draft);
    await linkSkillDraftTestSession(scope, {
      draftId: draft.id,
      revisionId: revision.id,
      skillId: draft.id,
      skillName: "Release Helper",
      requestedSessionKey: "session-test-123",
    });

    await discardSkillDraft(scope, draft.id);

    await expect(loadSkillDraft(scope, draft.id)).resolves.toBeNull();
    await expect(findSkillDraftTestSession(scope, "session-test-123")).resolves.toBeNull();
  });
});
