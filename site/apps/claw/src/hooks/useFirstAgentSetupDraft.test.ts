import { beforeEach, describe, expect, it } from "vitest";

import { createOpenClawBootstrapDraft } from "@/lib/openclaw-bootstrap-pack";
import {
  parseFirstAgentSetupDraft,
  readFirstAgentSetupDraft,
  updateFirstAgentSetupDraftPlan,
  writeFirstAgentSetupDraft,
} from "./useFirstAgentSetupDraft";

describe("first agent setup draft", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("preserves an explicit blank display name while migrating legacy drafts", () => {
    expect(parseFirstAgentSetupDraft(JSON.stringify({
      source: "first-agent-setup",
      name: "bright-vector-anchor",
      displayName: "",
    }))?.displayName).toBe("");
    expect(parseFirstAgentSetupDraft(JSON.stringify({
      source: "first-agent-setup",
      name: "legacy-agent-name",
    }))?.displayName).toBe("legacy-agent-name");
  });

  it("keeps a stable setup identity and full launch snapshot when the paid plan changes", () => {
    const bootstrapDraft = createOpenClawBootstrapDraft("Tern");
    bootstrapDraft.files[0] = {
      ...bootstrapDraft.files[0],
      content: "# Custom instructions\n\nKeep this exact setup.",
    };

    writeFirstAgentSetupDraft({
      principalId: "user-1",
      workspaceId: "workspace-1",
      knowledgeDomainId: null,
      name: "Tern",
      displayName: "Release Coordinator",
      description: "Coordinates release work.",
      size: "small",
      iconIndex: 11,
      category: "Ops",
      plan: "basic",
      enableDesktop: true,
      enableMemoryIndex: true,
      enableCustomImage: false,
      customImage: "",
      bootstrapDraft,
    });

    const initial = readFirstAgentSetupDraft();
    expect(initial).toMatchObject({
      principalId: "user-1",
      workspaceId: "workspace-1",
      displayName: "Release Coordinator",
      size: "small",
      plan: "basic",
    });
    expect(initial?.setupId).toBeTruthy();

    updateFirstAgentSetupDraftPlan("pro", "large");

    const updated = readFirstAgentSetupDraft();
    expect(updated).toMatchObject({
      setupId: initial?.setupId,
      principalId: "user-1",
      workspaceId: "workspace-1",
      size: "large",
      plan: "pro",
    });
    expect(updated?.bootstrapDraft?.files[0].content).toContain("Keep this exact setup.");
  });

  it("clears persisted account and workspace ownership when explicitly set to null", () => {
    const input = {
      knowledgeDomainId: null,
      name: "Tern",
      displayName: "",
      description: "",
      size: "small",
      iconIndex: 1,
      category: "General",
      plan: "team",
      enableDesktop: false,
      enableMemoryIndex: false,
      enableCustomImage: false,
      customImage: "",
    } as const;
    writeFirstAgentSetupDraft({
      ...input,
      principalId: "user-1",
      workspaceId: "workspace-1",
    });

    writeFirstAgentSetupDraft({
      ...input,
      principalId: null,
      workspaceId: null,
    });

    expect(readFirstAgentSetupDraft()).toMatchObject({
      principalId: null,
      workspaceId: null,
    });
  });
});
