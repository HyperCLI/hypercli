import { describe, expect, it, vi } from "vitest";
import type { AgentSkillSummary, AgentSkillsProvider } from "@hypercli.com/sdk/skills";

import { buildSkillTestPrompt, loadProviderSkills, parseSkillFile, skillFromProviderSummary } from "./provider-skills";

const summaries: AgentSkillSummary[] = [
  {
    id: "weather",
    name: "Weather",
    description: "Check forecasts.",
    origin: "built-in",
    availability: "active",
    enabled: true,
    ready: true,
    documentAvailable: true,
    resourceAccess: "read-only",
    requirements: { env: ["WEATHER_API_KEY"], bins: ["curl"], os: [] },
    missingRequirements: { env: [], bins: [], os: [] },
  },
  {
    id: "browser-automation",
    name: "Browser Automation",
    description: "Automate browser tasks.",
    origin: "extension",
    availability: "active",
    enabled: true,
    ready: true,
    documentAvailable: true,
    resourceAccess: "read-only",
    requirements: { env: [], bins: [], os: [] },
    missingRequirements: { env: [], bins: [], os: [] },
  },
];

function provider(overrides: Partial<AgentSkillsProvider> = {}): AgentSkillsProvider {
  return {
    capabilities: { readDocument: true, configure: true, searchRegistry: false, installRegistry: false, installUpload: false, resources: false, createSkill: false },
    list: vi.fn(async () => summaries),
    readDocument: vi.fn(async (skillId) => skillId === "weather" ? null : { skillId, content: "# Browser Automation\n" }),
    update: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("provider skills", () => {
  it("maps generic provider metadata without filesystem knowledge", () => {
    const skill = skillFromProviderSummary(summaries[1], "---\nemoji: 🌐\n---\n# Browser Automation\n");

    expect(skill).toMatchObject({
      id: "browser-automation",
      origin: "extension",
      category: "General",
      resourcesAvailable: true,
      resourceAccess: "read-only",
      editable: false,
      contentLoaded: true,
    });
    expect(skill.path).toBe("skill:browser-automation");
  });

  it("loads catalog metadata without eagerly reading every document", async () => {
    const skillsProvider = provider();
    const skills = await loadProviderSkills(skillsProvider);

    expect(skillsProvider.readDocument).not.toHaveBeenCalled();
    expect(skills.map((skill) => skill.id)).toEqual(["browser-automation", "weather"]);
    expect(skills.find((skill) => skill.id === "weather")?.documentState).toBe("idle");
  });

  it("preserves needs-setup separately from disabled", () => {
    const skill = skillFromProviderSummary({ ...summaries[0], availability: "needs-setup", ready: false });

    expect(skill.disabled).toBe(false);
    expect(skill.availability).toBe("needs-setup");
  });

  it("builds a provider-aware first-run prompt with safe setup guidance", () => {
    const skill = skillFromProviderSummary(summaries[0], "# Weather\n");
    const prompt = buildSkillTestPrompt(skill);

    expect(prompt).toContain('try the "Weather" skill (skill ID: weather)');
    expect(prompt).toContain("First confirm that this exact skill is available, enabled, and ready");
    expect(prompt).toContain("WEATHER_API_KEY");
    expect(prompt).toContain("Do not ask me to reveal secret values in chat");
    expect(prompt).toContain("external, destructive, billable, or privacy-sensitive action");
  });

  it("keeps local draft testing explicit, bounded, and separate from installed skills", () => {
    const parsed = parseSkillFile("draft", "draft", "---\nname: Draft\ndescription: Test draft.\n---\n# Draft");
    const draft = { ...parsed, localPreview: true };
    const prompt = buildSkillTestPrompt(draft);

    expect(prompt).toContain("local draft skill");
    expect(prompt).toContain("not installed or available as an agent skill");
    expect(prompt).toContain("untrusted, user-provided task instructions");
    expect(prompt).toContain("Draft SKILL.md (JSON-encoded)");
    expect(prompt).toContain(JSON.stringify(draft.content));
  });
});
