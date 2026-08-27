import { beforeEach, describe, expect, it } from "vitest";

import { createOpenClawBootstrapDraft } from "@/lib/openclaw-bootstrap-pack";
import {
  FIRST_AGENT_SETUP_DRAFT_KEY,
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

  it("reads the canonical knowledge Collection identifier", () => {
    const draft = parseFirstAgentSetupDraft(JSON.stringify({
      source: "first-agent-setup",
      name: "canonical-collection-agent",
      knowledgeCollectionId: " collection-1 ",
    }));

    expect(draft?.knowledgeCollectionId).toBe("collection-1");
    expect(draft).not.toHaveProperty("knowledgeDomainId");
  });

  it("falls back to the legacy knowledgeDomainId identifier", () => {
    const draft = parseFirstAgentSetupDraft(JSON.stringify({
      source: "first-agent-setup",
      name: "legacy-collection-agent",
      knowledgeDomainId: " legacy-collection ",
    }));

    expect(draft?.knowledgeCollectionId).toBe("legacy-collection");
    expect(draft).not.toHaveProperty("knowledgeDomainId");
  });

  it("prefers the canonical knowledge Collection identifier over the legacy alias", () => {
    const draft = parseFirstAgentSetupDraft(JSON.stringify({
      source: "first-agent-setup",
      name: "precedence-agent",
      knowledgeCollectionId: "collection-new",
      knowledgeDomainId: "collection-old",
    }));

    expect(draft?.knowledgeCollectionId).toBe("collection-new");
    expect(draft).not.toHaveProperty("knowledgeDomainId");
  });

  it("keeps a stable setup identity and full launch snapshot when the paid plan changes", async () => {
    const bootstrapDraft = await createOpenClawBootstrapDraft("Tern");
    bootstrapDraft.files[0] = {
      ...bootstrapDraft.files[0],
      content: "# Custom instructions\n\nKeep this exact setup.",
    };

    writeFirstAgentSetupDraft({
      principalId: "user-1",
      workspaceId: "workspace-1",
      knowledgeCollectionId: "collection-1",
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
      knowledgeCollectionId: "collection-1",
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
    expect(JSON.parse(window.sessionStorage.getItem(FIRST_AGENT_SETUP_DRAFT_KEY) ?? "null")).toMatchObject({
      knowledgeCollectionId: "collection-1",
      knowledgeDomainId: "collection-1",
    });
  });

  it("normalizes the saved agent type and defaults legacy drafts to openclaw", () => {
    expect(parseFirstAgentSetupDraft(JSON.stringify({
      source: "first-agent-setup",
      name: "legacy-type-agent",
    }))?.agentType).toBe("openclaw");
    expect(parseFirstAgentSetupDraft(JSON.stringify({
      source: "first-agent-setup",
      name: "hermes-agent",
      agentType: "hermes",
    }))?.agentType).toBe("hermes");
    expect(parseFirstAgentSetupDraft(JSON.stringify({
      source: "first-agent-setup",
      name: "unknown-type-agent",
      agentType: "something-else",
    }))?.agentType).toBe("openclaw");
  });

  it("clears persisted account and workspace ownership when explicitly set to null", () => {
    const input = {
      knowledgeCollectionId: null,
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
