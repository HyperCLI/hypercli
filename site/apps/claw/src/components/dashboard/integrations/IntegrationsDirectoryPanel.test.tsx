import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import type { WorkspaceSkill } from "../directory/workspace-skills";
import { IntegrationsDirectoryPanel } from "./IntegrationsDirectoryPanel";

const configSchema: OpenClawConfigSchemaResponse = {
  schema: {},
  uiHints: {
    "channels.telegram": {},
  },
};

function schemaWithHints(...hints: string[]): OpenClawConfigSchemaResponse {
  return {
    schema: {},
    uiHints: Object.fromEntries(hints.map((hint) => [hint, {}])),
  };
}

function renderPanel(overrides: Partial<ComponentProps<typeof IntegrationsDirectoryPanel>> = {}) {
  return renderWithClient(
    <IntegrationsDirectoryPanel
      initialCategory="channels"
      initialPluginId="telegram"
      agentName="Agent"
      config={null}
      configSchema={configSchema}
      connected
      onSaveConfig={vi.fn(async () => undefined)}
      onChannelProbe={vi.fn(async () => ({}))}
      onOpenShell={vi.fn()}
      {...overrides}
    />,
  );
}

function workspaceSkill(overrides: Partial<WorkspaceSkill> = {}): WorkspaceSkill {
  return {
    id: "notion",
    name: "Notion",
    description: "Notion workspace pages.",
    path: "/app/skills/notion/SKILL.md",
    directoryPath: "/app/skills/notion",
    content: "---\nname: notion\ndescription: Notion workspace pages.\n---\n# Notion\n\nUse Notion pages.",
    frontmatter: "name: notion\ndescription: Notion workspace pages.",
    body: "# Notion\n\nUse Notion pages.",
    category: "Platform",
    requiresEnv: [],
    requiresBins: [],
    os: [],
    installHints: [],
    disabled: false,
    hasScripts: false,
    hasReferences: false,
    hasAssets: false,
    ...overrides,
  };
}

describe("IntegrationsDirectoryPanel", () => {
  it("uses the integrations back label by default", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: /back to integrations/i })).toBeInTheDocument();
  });

  it("uses the chat back label and callback for chat-opened details", () => {
    const onDetailBack = vi.fn();
    renderPanel({
      detailBackLabel: "Back to chat",
      onDetailBack,
    });

    fireEvent.click(screen.getByRole("button", { name: /back to chat/i }));

    expect(onDetailBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /back to chat/i })).not.toBeInTheDocument();
  });

  it("uses the shared loading visual while app skills load", async () => {
    renderPanel({
      initialCategory: "skills",
      initialPluginId: null,
      onLoadSkills: vi.fn(() => new Promise<never>(() => undefined)),
    });

    expect(await screen.findByRole("status", { name: /loading skills reading available app skills/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /agent workspace loading/i })).toBeInTheDocument();
  });

  it("renders installed skills with the shared card layout and opens details", async () => {
    renderPanel({
      initialCategory: "skills",
      initialPluginId: null,
      onLoadSkills: vi.fn(async () => [workspaceSkill({ id: "weather", name: "Weather", description: "Weather forecasts." })]),
    });

    expect(await screen.findByText("Create Skill")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search installed skills/i)).toBeInTheDocument();
    expect(screen.getByText("Weather")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /configure/i }));

    expect(await screen.findByText("This skill is bundled and ready for this agent.")).toBeInTheDocument();
  });

  it("uses the structured create stepper with validation and preview", async () => {
    renderPanel({
      initialCategory: "skills",
      initialPluginId: null,
      onLoadSkills: vi.fn(async () => []),
    });

    fireEvent.click(await screen.findByRole("button", { name: /create skill/i }));
    fireEvent.click(screen.getByRole("button", { name: /structured form/i }));

    expect(screen.getByText("Identity")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /linux/i }));
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));

    expect(screen.getByText("Generated SKILL.md")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save skill/i }));

    expect(await screen.findByText("This is a local UI preview. It has not been installed on the agent yet.")).toBeInTheDocument();
  });

  it("adds locally generated skills as mocked previews", async () => {
    renderPanel({
      initialCategory: "skills",
      initialPluginId: null,
      onLoadSkills: vi.fn(async () => []),
    });

    fireEvent.click(await screen.findByRole("button", { name: /create skill/i }));
    fireEvent.click(screen.getByRole("button", { name: /describe with ai/i }));
    fireEvent.change(screen.getByPlaceholderText(/i want a skill/i), { target: { value: "Search GitHub repos" } });
    fireEvent.click(screen.getByRole("button", { name: /generate skill/i }));

    expect(await screen.findByRole("status", { name: /generating skill preview/i })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /save skill/i }));

    expect(await screen.findByText("This is a local UI preview. It has not been installed on the agent yet.")).toBeInTheDocument();
    expect(screen.getAllByText(/local preview/i).length).toBeGreaterThan(0);
  });

  it("imports skill files as mocked previews", async () => {
    renderPanel({
      initialCategory: "skills",
      initialPluginId: null,
      onLoadSkills: vi.fn(async () => []),
    });

    fireEvent.click(await screen.findByRole("button", { name: /^import$/i }));
    const file = new File([
      "---\nname: imported-skill\ndescription: Imported skill preview.\n---\n# Imported Skill\n",
    ], "imported-skill.md", { type: "text/markdown" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });

    expect(await screen.findByText("imported-skill.md")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /import \(1\)/i }));

    expect(await screen.findByText("This is a local UI preview. It has not been installed on the agent yet.")).toBeInTheDocument();
  });

  it("searches and installs library skills through SDK callbacks", async () => {
    const onSearchLibrarySkills = vi.fn(async () => ({
      results: [{ score: 1, slug: "code-review", displayName: "Code Review", summary: "Review code changes.", version: "1.0.0" }],
    }));
    const onInstallLibrarySkill = vi.fn(async () => ({ ok: true, slug: "code-review", message: "Installed Code Review." }));
    const onLoadSkills = vi.fn(async () => []);

    renderPanel({
      initialCategory: "skills",
      initialPluginId: null,
      onLoadSkills,
      onSearchLibrarySkills,
      onInstallLibrarySkill,
    });

    fireEvent.click(await screen.findByRole("button", { name: /library/i }));
    expect(await screen.findByText("Code Review")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add to agent/i }));

    await waitFor(() => {
      expect(onInstallLibrarySkill).toHaveBeenCalledWith({ source: "clawhub", slug: "code-review" });
    });
  });

  it("shows truthful tier one states for service connectors", () => {
    renderPanel({ initialCategory: null, initialPluginId: null });

    expect(screen.getByText("HubSpot")).toBeInTheDocument();
    expect(screen.getByText("Google Drive")).toBeInTheDocument();
    expect(screen.getAllByText("Needs OAuth").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("Planned").length).toBeGreaterThan(0);
    expect(screen.queryByText(/connect via chat/i)).not.toBeInTheDocument();
  });

  it("opens the skill drawer from a skill-backed service card", async () => {
    renderPanel({
      initialCategory: null,
      initialPluginId: null,
      onLoadSkills: vi.fn(async () => [workspaceSkill()]),
    });

    expect(await screen.findByText("Available as skill")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /notion/i }));

    expect(await screen.findByText("This skill is bundled and ready for this agent.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "SKILL.md" })).toBeInTheDocument();
  });

  it("opens the GitHub connector when gateway capability is advertised", async () => {
    const onIntegrationAuthStart = vi.fn(async () => ({
      authId: "auth-1",
      verificationUri: "https://github.com/login/device",
      userCode: "ABCD-1234",
      intervalMs: 30_000,
    }));
    const onIntegrationStatus = vi.fn(async () => ({
      integrations: {
        github: { configured: false, authenticated: false, usable: false },
      },
    }));

    renderPanel({
      initialCategory: null,
      initialPluginId: null,
      configSchema: schemaWithHints("integrations.github"),
      onIntegrationAuthStart,
      onIntegrationAuthStatus: vi.fn(async () => ({ status: "pending" })),
      onIntegrationStatus,
      onIntegrationDisconnect: vi.fn(async () => ({ ok: true })),
    });

    const githubCard = screen.getByText("GitHub").closest("button");
    expect(githubCard).not.toBeNull();
    fireEvent.click(githubCard!);

    fireEvent.click(await screen.findByRole("button", { name: /connect github/i }));

    expect(onIntegrationAuthStart).toHaveBeenCalledWith({ integrationId: "github", scopes: ["repo", "read:org", "gist"] });
    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open github/i })).toHaveAttribute("href", "https://github.com/login/device");
  });

  it("marks a fulfilled service connector as connected in the grid", async () => {
    const onIntegrationStatus = vi.fn(async () => ({
      integrations: {
        github: {
          configured: true,
          authenticated: true,
          usable: true,
          accountDisplayName: "octocat",
        },
      },
    }));

    renderPanel({
      initialCategory: null,
      initialPluginId: null,
      configSchema: schemaWithHints("integrations.github"),
      onIntegrationAuthStart: vi.fn(async () => ({ authId: "auth-1" })),
      onIntegrationAuthStatus: vi.fn(async () => ({ status: "pending" })),
      onIntegrationStatus,
    });

    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("GitHub").closest("button")).toHaveTextContent("Connected");
    expect(onIntegrationStatus).toHaveBeenCalledWith({ probe: false });
  });
});
