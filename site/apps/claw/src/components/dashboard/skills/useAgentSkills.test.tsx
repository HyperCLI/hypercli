import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentSkillSummary, AgentSkillsProvider } from "@hypercli.com/sdk/skills";

import { useAgentSkills } from "./useAgentSkills";

const summary: AgentSkillSummary = {
  id: "weather",
  name: "Weather",
  description: "Check forecasts.",
  origin: "built-in",
  availability: "active",
  enabled: true,
  ready: true,
  documentAvailable: true,
  resourceAccess: "read-only",
  requirements: { env: [], bins: [], os: [] },
  missingRequirements: { env: [], bins: [], os: [] },
};

function provider(readDocument: AgentSkillsProvider["readDocument"]): AgentSkillsProvider {
  return {
    capabilities: { readDocument: true, configure: false, searchRegistry: false, installRegistry: false, installUpload: false, resources: false, createSkill: false },
    list: vi.fn(async () => [summary]),
    readDocument,
  };
}

describe("useAgentSkills", () => {
  it("loads document content only when requested", async () => {
    const readDocument = vi.fn(async () => ({ skillId: "weather", content: "# Weather\nUse forecasts." }));
    const skillsProvider = provider(readDocument);
    const { result } = renderHook(() => useAgentSkills({ enabled: true, connected: true, provider: skillsProvider }));

    await waitFor(() => expect(result.current.skills).toHaveLength(1));
    expect(result.current.skills[0]?.documentState).toBe("idle");
    expect(readDocument).not.toHaveBeenCalled();

    await act(async () => { await result.current.loadDocument("weather"); });

    expect(readDocument).toHaveBeenCalledWith("weather");
    expect(result.current.skills[0]).toMatchObject({ documentState: "loaded", contentLoaded: true, body: "# Weather\nUse forecasts." });
  });

  it("preserves a retryable document error", async () => {
    const readDocument = vi.fn()
      .mockRejectedValueOnce(new Error("file API unavailable"))
      .mockResolvedValueOnce({ skillId: "weather", content: "# Weather" });
    const skillsProvider = provider(readDocument);
    const { result } = renderHook(() => useAgentSkills({ enabled: true, connected: true, provider: skillsProvider }));

    await waitFor(() => expect(result.current.skills).toHaveLength(1));
    await act(async () => { await expect(result.current.loadDocument("weather")).rejects.toThrow("file API unavailable"); });
    expect(result.current.skills[0]).toMatchObject({ documentState: "error", documentError: "file API unavailable" });

    await act(async () => { await result.current.loadDocument("weather"); });
    expect(result.current.skills[0]).toMatchObject({ documentState: "loaded", contentLoaded: true });
  });

  it("exposes provider-neutral resource operations when available", async () => {
    const listResources = vi.fn(async () => [{ name: "SKILL.md", path: "SKILL.md", type: "file" as const }]);
    const readResource = vi.fn(async () => new Uint8Array());
    const skillsProvider = provider(vi.fn(async () => null));
    skillsProvider.capabilities.resources = true;
    skillsProvider.listResources = listResources;
    skillsProvider.readResource = readResource;
    const { result } = renderHook(() => useAgentSkills({ enabled: true, connected: true, provider: skillsProvider }));

    await waitFor(() => expect(result.current.skills).toHaveLength(1));
    await result.current.resourceOperations?.listResources("weather", "references");
    expect(listResources).toHaveBeenCalledWith("weather", "references");
  });

  it("creates a skill through the provider without hiding creation failures", async () => {
    const createSkill = vi.fn(async () => ({ skillId: "release-helper" }));
    const skillsProvider = provider(vi.fn(async () => null));
    skillsProvider.capabilities.createSkill = true;
    skillsProvider.createSkill = createSkill;
    const { result } = renderHook(() => useAgentSkills({ enabled: true, connected: true, provider: skillsProvider }));
    const request = { id: "release-helper", content: "# Release Helper", directories: ["scripts"] };

    await act(async () => { await expect(result.current.create(request)).resolves.toEqual({ skillId: "release-helper" }); });
    expect(createSkill).toHaveBeenCalledWith(request);
  });
});
