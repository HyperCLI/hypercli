import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { SkillsPanel } from "./SkillsPanel";
import type { AgentSkill } from "./provider-skills";
import { loadSkillDraft, saveSkillDraft } from "./skill-draft-store";

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  window.localStorage.clear();
});

function providerSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "notion",
    name: "Notion",
    description: "Notion workspace pages.",
    path: "skill:notion",
    directoryPath: "skill:notion",
    content: "---\nname: notion\ndescription: Notion workspace pages.\n---\n# Notion\n\nUse Notion pages.",
    frontmatter: "name: notion\ndescription: Notion workspace pages.",
    body: "# Notion\n\nUse Notion pages.",
    category: "General",
    requiresEnv: [],
    requiresBins: [],
    os: [],
    missingRequirements: { env: [], bins: [], os: [] },
    installHints: [],
    disabled: false,
    availability: "active",
    ready: true,
    documentState: "loaded",
    hasScripts: false,
    hasReferences: false,
    hasAssets: false,
    origin: "built-in",
    resourcesAvailable: false,
    resourceAccess: "read-only",
    contentLoaded: true,
    ...overrides,
  };
}

const generatedSkillResponse = JSON.stringify({
  schema: "hypercli.skill-draft.v1",
  draft: {
    name: "github-helper",
    description: "Search GitHub repositories and inspect results.",
    emoji: "",
    homepage: "https://github.com",
    instructions: "# GitHub Helper\n\nUse GitHub search to find repositories. Confirm before making changes.",
    requiresBins: [],
    requiresEnv: [],
    os: [],
  },
});

function renderPanel(overrides: Partial<ComponentProps<typeof SkillsPanel>> = {}) {
  return renderWithClient(
    <SkillsPanel
      agentName="Agent"
      draftScope={{ ownerId: "test@example.com", agentId: "agent-1" }}
      connected
      installedSkills={[]}
      loading={false}
      error={null}
      onGenerateSkill={vi.fn(async () => generatedSkillResponse)}
      onUpdateSkill={vi.fn(async () => undefined)}
      onTestSkill={vi.fn(async () => undefined)}
      {...overrides}
    />,
  );
}

describe("SkillsPanel", () => {
  it("uses the Claw loading layout while skills load", () => {
    renderPanel({ loading: true });
    expect(screen.getByRole("status", { name: /loading skills reading available app skills/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /agent workspace loading/i })).toBeInTheDocument();
  });

  it("renders built-in skills and opens details", () => {
    renderPanel({ installedSkills: [providerSkill({ id: "weather", name: "Weather", description: "Weather forecasts.", hasScripts: true, hasReferences: true, hasAssets: true })] });
    expect(screen.getByText("Create Skill")).toBeInTheDocument();
    expect(screen.getByText("Skills are instruction packs that teach your agent how and when to use tools.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search skills/i)).toBeInTheDocument();
    expect(screen.getByText("Weather")).toBeInTheDocument();
    expect(screen.getAllByText("Built-in").length).toBeGreaterThan(0);
    const weatherCard = screen.getByText("Weather").closest("article");
    expect(weatherCard).not.toHaveTextContent("Built-in");
    expect(weatherCard).not.toHaveTextContent("General");
    expect(weatherCard).not.toHaveTextContent("Scripts");
    expect(weatherCard).not.toHaveTextContent("Active");
    const cardFooter = weatherCard?.querySelector('[data-slot="skill-card-footer"]');
    expect(cardFooter).toHaveClass("items-center");
    expect(cardFooter?.querySelector('[data-slot="skill-card-metadata"]')).not.toBeInTheDocument();
    expect(cardFooter?.querySelector('[data-slot="skill-card-actions"]')).toBeInTheDocument();
    expect(cardFooter?.querySelector('[data-slot="skill-card-actions"]')?.parentElement).toBe(cardFooter);
    expect(screen.getByRole("switch", { name: /disable weather skill/i })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /view details/i }));
    expect(screen.getByText("This skill is available for this agent.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "SKILL.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /test in new session/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to skills/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search skills/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to skills/i }));
    expect(screen.getByPlaceholderText(/search skills/i)).toBeInTheDocument();
    expect(screen.getByText("Weather")).toBeInTheDocument();
  });

  it("opens a requested skill from a peer panel", () => {
    renderPanel({ installedSkills: [providerSkill()], requestedSkillId: "notion" });
    expect(screen.getByText("This skill is available for this agent.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "SKILL.md" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back to skills/i }));
    expect(screen.getByPlaceholderText(/search skills/i)).toBeInTheDocument();
  });

  it("opens provider resources in a read-only Files tab", async () => {
    const listResources = vi.fn(async () => [{ name: "SKILL.md", path: "SKILL.md", type: "file" as const }]);
    const readResource = vi.fn(async () => new TextEncoder().encode("# Notion"));
    renderPanel({
      installedSkills: [providerSkill({ resourcesAvailable: true })],
      requestedSkillId: "notion",
      skillResourceOperations: { listResources, readResource },
    });

    expect(screen.getByRole("tab", { name: /overview/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /files/i }));
    await waitFor(() => expect(listResources).toHaveBeenCalledWith("notion", ""));
    expect(await screen.findByRole("button", { name: "SKILL.md" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search files...").closest("aside")).toHaveClass("border-r");
    expect(document.querySelector('[data-slot="skill-files-panel"]')).toHaveClass("h-full", "min-h-0");
    expect(screen.queryByTitle("Upload files")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit instructions/i })).not.toBeInTheDocument();
  });

  it("loads an installed skill document on demand and exposes retry", async () => {
    const onLoadSkillDocument = vi.fn(async () => undefined);
    const { rerender } = renderPanel({
      installedSkills: [providerSkill({ content: "", body: "", contentLoaded: false, documentState: "idle" })],
      requestedSkillId: "notion",
      onLoadSkillDocument,
    });

    await waitFor(() => expect(onLoadSkillDocument).toHaveBeenCalledWith("notion"));
    expect(screen.getByRole("status")).toHaveTextContent("Loading instructions");

    rerender(
      <SkillsPanel
        agentName="Agent"
        draftScope={{ ownerId: "test@example.com", agentId: "agent-1" }}
        connected
        installedSkills={[providerSkill({ content: "", body: "", contentLoaded: false, documentState: "error", documentError: "file API unavailable" })]}
        loading={false}
        error={null}
        requestedSkillId="notion"
        onUpdateSkill={vi.fn(async () => undefined)}
        onLoadSkillDocument={onLoadSkillDocument}
        onTestSkill={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByText("file API unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onLoadSkillDocument).toHaveBeenCalledTimes(2));
  });

  it("toggles built-in skills through the provider", async () => {
    const onUpdateSkill = vi.fn(async () => undefined);
    renderPanel({
      onUpdateSkill,
      installedSkills: [providerSkill({ id: "weather", name: "Weather", category: "Lookups", requiresEnv: ["WEATHER_TOKEN"] })],
    });
    fireEvent.click(screen.getByRole("switch", { name: /disable weather skill/i }));
    await waitFor(() => expect(onUpdateSkill).toHaveBeenCalledWith("weather", { enabled: false, env: {} }));
    expect(screen.getByRole("switch", { name: /activate weather skill/i })).not.toBeChecked();
  });

  it("shows unmet requirements as needs setup without disabling the skill", () => {
    renderPanel({
      installedSkills: [providerSkill({
        id: "weather",
        name: "Weather",
        availability: "needs-setup",
        ready: false,
        requiresBins: ["weather-cli"],
        missingRequirements: { env: [], bins: ["weather-cli"], os: [] },
      })],
    });

    const needsSetupStatus = screen.getByText("Needs setup");
    expect(needsSetupStatus.closest('[data-slot="skill-card-status"]')).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /disable weather skill/i })).toBeChecked();
  });

  it("combines source and category filters with counts", () => {
    renderPanel({
      installedSkills: [
        providerSkill({ id: "notion", name: "Notion", category: "Platform", origin: "custom" }),
        providerSkill({ id: "weather", name: "Weather", category: "Lookups", origin: "built-in", path: "skill:weather", directoryPath: "skill:weather" }),
      ],
    });
    const filterCheckboxes = screen.getAllByRole("checkbox");
    expect(filterCheckboxes[0]).toHaveAccessibleName(/all skills.*2/i);
    expect(filterCheckboxes[0]).toBeChecked();
    expect(filterCheckboxes[1]).toHaveAccessibleName(/my skills.*1/i);
    fireEvent.click(screen.getByRole("checkbox", { name: /built-in.*1/i }));
    expect(screen.getByText("Weather")).toBeInTheDocument();
    expect(screen.queryByText("Notion")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /lookups.*1/i }));
    expect(screen.getByText("Weather")).toBeInTheDocument();
    expect(screen.queryByText("Notion")).not.toBeInTheDocument();
  });

  it("reviews and organizes loose workspace skill files", async () => {
    const onRecoverSkill = vi.fn(async () => ({ skillId: "chat-helper" }));
    const onRefreshSkills = vi.fn(async () => []);
    renderPanel({
      recoveryCandidates: [{
        id: "workspace-skills-root",
        name: "Chat Helper",
        description: "Created through chat.",
        suggestedSkillId: "chat-helper",
        entries: [
          { name: "scripts", path: "scripts", type: "directory", selectedByDefault: true, selectable: true },
          { name: "notes.txt", path: "notes.txt", type: "file", selectedByDefault: false, selectable: true },
          { name: "existing-skill", path: "existing-skill", type: "directory", selectedByDefault: false, selectable: false, reason: "This folder is already a separate skill." },
        ],
      }],
      onRecoverSkill,
      onRefreshSkills,
    });

    fireEvent.click(screen.getByRole("button", { name: /review files/i }));
    expect(screen.getByRole("dialog", { name: /organize workspace skill/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /include skill.md/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /include scripts/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /include notes.txt/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /include existing-skill/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /move to skills/i }));

    await waitFor(() => expect(onRecoverSkill).toHaveBeenCalledWith({
      candidateId: "workspace-skills-root",
      skillId: "chat-helper",
      paths: ["scripts"],
    }));
    expect(onRefreshSkills).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /organize workspace skill/i })).not.toBeInTheDocument());
  });

  it("uses the structured create stepper with validation and preview", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /create skill/i }));
    fireEvent.click(screen.getByRole("button", { name: /structured form/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Name is required.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "github-helper" } });
    fireEvent.change(screen.getByLabelText(/^description/i), { target: { value: "Use GitHub CLI for repository and pull request tasks." } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("heading", { name: "Instructions" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Instructions are required.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /workflow/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("heading", { name: "Dependencies" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));
    expect(screen.getByText("Generated SKILL.md")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save skill/i }));
    const keepPreview = await screen.findByRole("button", { name: /keep as preview/i });
    await waitFor(() => expect(keepPreview).toBeEnabled());
    fireEvent.click(keepPreview);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Github Helper", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /my skills.*1/i })).toBeInTheDocument();
  });

  it("restores persisted drafts and removes them only after explicit discard", async () => {
    const draftScope = { ownerId: "persistent@example.com", agentId: "agent-persistent" };
    await saveSkillDraft(draftScope, {
      id: "release-helper",
      origin: "created",
      content: "---\nname: release-helper\ndescription: Prepare releases.\n---\n# Release Helper",
      directories: ["scripts"],
    });
    renderPanel({ draftScope });

    expect(await screen.findByText("Release Helper", { selector: "h3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(screen.getByRole("alertdialog", { name: /discard skill draft/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /discard draft/i }));

    await waitFor(() => expect(screen.queryByText("Release Helper", { selector: "h3" })).not.toBeInTheDocument());
    await expect(loadSkillDraft(draftScope, "release-helper")).resolves.toBeNull();
  });

  it("disables agent generation until chat is ready", () => {
    renderPanel({ onGenerateSkill: undefined });
    fireEvent.click(screen.getByRole("button", { name: /create skill/i }));

    expect(screen.getByRole("button", { name: /describe with ai/i })).toBeDisabled();
    expect(screen.getByText(/connect to the agent to generate/i)).toBeInTheDocument();
  });

  it("generates skills in a temporary agent session and adds them as previews", async () => {
    const onGenerateSkill = vi.fn(async () => generatedSkillResponse);
    renderPanel({ onGenerateSkill });
    fireEvent.click(screen.getByRole("button", { name: /create skill/i }));
    fireEvent.click(screen.getByRole("button", { name: /describe with ai/i }));
    fireEvent.change(screen.getByPlaceholderText(/i want a skill/i), { target: { value: "Search GitHub repos" } });
    fireEvent.click(screen.getByRole("button", { name: /generate skill/i }));
    await waitFor(() => expect(onGenerateSkill).toHaveBeenCalledWith(
      expect.stringContaining('User request (JSON string): "Search GitHub repos"'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    fireEvent.click(await screen.findByRole("button", { name: /save skill/i }));
    fireEvent.click(await screen.findByRole("button", { name: /keep as preview/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Github Helper", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("opens AI-generated skills in preview mode and tests the persisted draft directly", async () => {
    const onTestSkill = vi.fn(async () => undefined);
    renderPanel({ onTestSkill });
    fireEvent.click(screen.getByRole("button", { name: /create skill/i }));
    fireEvent.click(screen.getByRole("button", { name: /describe with ai/i }));
    fireEvent.change(screen.getByPlaceholderText(/i want a skill/i), { target: { value: "Search GitHub repos" } });
    fireEvent.click(screen.getByRole("button", { name: /generate skill/i }));

    expect(await screen.findByRole("button", { name: /^preview$/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^raw$/i })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));

    await waitFor(() => expect(onTestSkill).toHaveBeenCalledWith(expect.objectContaining({
      id: "github-helper",
      localPreview: true,
    })));
    await expect(loadSkillDraft({ ownerId: "test@example.com", agentId: "agent-1" }, "github-helper")).resolves.toEqual(expect.objectContaining({
      id: "github-helper",
      content: expect.stringContaining("# GitHub Helper"),
    }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancels temporary skill generation when leaving the AI step", async () => {
    let generationSignal: AbortSignal | undefined;
    const onGenerateSkill = vi.fn((_prompt: string, options: { signal: AbortSignal }) => {
      generationSignal = options.signal;
      return new Promise<string>(() => undefined);
    });
    renderPanel({ onGenerateSkill });
    fireEvent.click(screen.getByRole("button", { name: /create skill/i }));
    fireEvent.click(screen.getByRole("button", { name: /describe with ai/i }));
    fireEvent.change(screen.getByPlaceholderText(/i want a skill/i), { target: { value: "Search GitHub repos" } });
    fireEvent.click(screen.getByRole("button", { name: /generate skill/i }));

    await waitFor(() => expect(generationSignal).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    expect(generationSignal?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: /describe with ai/i })).toBeInTheDocument();
  });

  it("persists a created skill and refreshes the provider catalog", async () => {
    const onCreateSkill = vi.fn(async () => ({ skillId: "github-helper" }));
    const onRefreshSkills = vi.fn(async () => []);
    renderPanel({ onCreateSkill, onRefreshSkills });

    fireEvent.click(screen.getByRole("button", { name: /create skill/i }));
    fireEvent.click(screen.getByRole("button", { name: /describe with ai/i }));
    fireEvent.change(screen.getByPlaceholderText(/i want a skill/i), { target: { value: "Search GitHub repos" } });
    fireEvent.click(screen.getByRole("button", { name: /generate skill/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save skill/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save to agent/i }));

    await waitFor(() => expect(onCreateSkill).toHaveBeenCalledWith(expect.objectContaining({
      id: "github-helper",
      content: expect.stringContaining("name: github-helper"),
      directories: [],
    })));
    expect(onRefreshSkills).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Github Helper", { selector: "h3" })).not.toBeInTheDocument();
  });

  it("keeps a created preview when saving to the agent fails", async () => {
    const onCreateSkill = vi.fn(async () => { throw new Error("managed storage unavailable"); });
    renderPanel({ onCreateSkill, onRefreshSkills: vi.fn(async () => []) });

    fireEvent.click(screen.getByRole("button", { name: /create skill/i }));
    fireEvent.click(screen.getByRole("button", { name: /describe with ai/i }));
    fireEvent.change(screen.getByPlaceholderText(/i want a skill/i), { target: { value: "Search GitHub repos" } });
    fireEvent.click(screen.getByRole("button", { name: /generate skill/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save skill/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save to agent/i }));

    expect(await screen.findByText("managed storage unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /keep as preview/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /keep as preview/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Github Helper", { selector: "h3" })).toBeInTheDocument();
  });

  it("saves preview folders from the detail view with the skill", async () => {
    const onCreateSkill = vi.fn(async () => ({ skillId: "github-helper" }));
    renderPanel({ onCreateSkill, onRefreshSkills: vi.fn(async () => []) });
    fireEvent.click(screen.getByRole("button", { name: /create skill/i }));
    fireEvent.click(screen.getByRole("button", { name: /describe with ai/i }));
    fireEvent.change(screen.getByPlaceholderText(/i want a skill/i), { target: { value: "Search GitHub repos" } });
    fireEvent.click(screen.getByRole("button", { name: /generate skill/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save skill/i }));
    fireEvent.click(await screen.findByRole("button", { name: /keep as preview/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    fireEvent.click(screen.getByRole("tab", { name: /files/i }));
    fireEvent.click(await screen.findByTitle("New folder"));
    fireEvent.change(screen.getByPlaceholderText("Folder name"), { target: { value: "scripts" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "scripts" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save to agent/i }));

    await waitFor(() => expect(onCreateSkill).toHaveBeenCalledWith(expect.objectContaining({
      id: "github-helper",
      directories: ["scripts"],
    })));
  });

  it("imports skill files and can test the result", async () => {
    const onTestSkill = vi.fn(async () => undefined);
    renderPanel({ onTestSkill });
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    expect(screen.getByRole("button", { name: /^cancel$/i })).toHaveClass("max-w-full");
    expect(screen.getByRole("button", { name: /^cancel$/i })).not.toHaveClass("w-full");
    const file = new File(["---\nname: imported-skill\ndescription: Imported skill preview.\n---\n# Imported Skill\n"], "imported-skill.md", { type: "text/markdown" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toHaveAttribute("accept", ".md,.txt");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(await screen.findByRole("button", { name: /review \(1\)/i }));
    expect(screen.getByRole("button", { name: /^back$/i })).toHaveClass("max-w-full");
    expect(screen.getByRole("button", { name: /import \(1\)/i })).not.toHaveClass("w-full");
    expect(screen.getByRole("button", { name: /^preview$/i })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /import \(1\)/i }));
    expect(await screen.findByRole("button", { name: /keep as preview/i })).not.toHaveClass("w-full");
    fireEvent.click(await screen.findByRole("button", { name: /test skill/i }));
    await waitFor(() => expect(onTestSkill).toHaveBeenCalledWith(expect.objectContaining({ id: "imported-skill" })));
    expect(screen.getByRole("checkbox", { name: /my skills.*1/i })).toBeInTheDocument();
  });

  it("persists imported skill files to the agent", async () => {
    const onCreateSkill = vi.fn(async () => ({ skillId: "imported-skill" }));
    renderPanel({ onCreateSkill, onRefreshSkills: vi.fn(async () => []) });
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    const content = "Use this skill to summarize release notes.";
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([content], "imported-skill.md", { type: "text/markdown" })] } });
    fireEvent.click(await screen.findByRole("button", { name: /review \(1\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /import \(1\)/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save to agent/i }));

    await waitFor(() => expect(onCreateSkill).toHaveBeenCalledWith({
      id: "imported-skill",
      content: expect.stringMatching(/^---\nname: imported-skill\ndescription: "Imported skill from imported-skill\.md\."\n---\nUse this skill/),
      directories: [],
    }));
  });

  it("rejects files other than Markdown and plain text", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["archive"], "skill.zip", { type: "application/zip" })] } });
    expect(await screen.findByText(/only \.md and \.txt files are supported/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review \(0\)/i })).toBeDisabled();
  });

  it("accepts plain-text skill files", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["Use this skill to summarize release notes."], "release-notes.txt", { type: "text/plain" })] } });
    fireEvent.click(await screen.findByRole("button", { name: /review \(1\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /^raw$/i }));
    expect(screen.getByRole("textbox", { name: /release-notes\.txt contents/i })).toHaveValue("Use this skill to summarize release notes.");
  });

  it("routes a card test into a new chat session", async () => {
    const onTestSkill = vi.fn(async () => undefined);
    renderPanel({ installedSkills: [providerSkill({ id: "weather", name: "Weather" })], onTestSkill });
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
    await waitFor(() => expect(onTestSkill).toHaveBeenCalledWith(expect.objectContaining({ id: "weather", name: "Weather" })));
  });
});
