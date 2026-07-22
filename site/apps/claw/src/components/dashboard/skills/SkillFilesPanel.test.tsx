import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { SkillFilesPanel, type SkillResourceOperations } from "./SkillFilesPanel";
import type { AgentSkill } from "./provider-skills";

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

function skill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: "weather",
    name: "Weather",
    description: "Weather forecasts.",
    path: "skill:weather",
    directoryPath: "skill:weather",
    content: "# Weather",
    frontmatter: "",
    body: "# Weather",
    category: "Lookups",
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
    resourcesAvailable: true,
    resourceAccess: "read-only",
    ...overrides,
  };
}

function operations(): SkillResourceOperations {
  return {
    listResources: vi.fn(async () => [{ name: "SKILL.md", path: "SKILL.md", type: "file" as const }]),
    readResource: vi.fn(async () => new TextEncoder().encode("# Weather")),
    writeResource: vi.fn(async () => undefined),
    deleteResource: vi.fn(async () => undefined),
    createResourceDirectory: vi.fn(async () => undefined),
  };
}

describe("SkillFilesPanel", () => {
  it("loads read-only installed files using skill-relative provider operations", async () => {
    const resourceOperations = operations();

    render(
      <SkillFilesPanel
        skill={skill()}
        localPreview={false}
        connected
        isDesktopViewport
        operations={resourceOperations}
        onSkillContentChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(resourceOperations.listResources).toHaveBeenCalledWith("weather", ""));
    fireEvent.click(await screen.findByRole("button", { name: "SKILL.md" }));
    await waitFor(() => expect(resourceOperations.readResource).toHaveBeenCalledWith("weather", "SKILL.md"));
    expect(screen.queryByRole("button", { name: "Upload files" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New folder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("enables managed custom skill mutations", async () => {
    const resourceOperations = operations();

    render(
      <SkillFilesPanel
        skill={skill({ origin: "custom", editable: true, resourceAccess: "read-write" })}
        localPreview={false}
        connected
        isDesktopViewport
        operations={resourceOperations}
        onSkillContentChanged={vi.fn()}
      />,
    );

    expect(await screen.findByRole("button", { name: "Upload files" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByPlaceholderText("Folder name"), { target: { value: "references" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(resourceOperations.createResourceDirectory).toHaveBeenCalledWith("weather", "references"));
  });

  it("keeps local preview files read-only and browser-local", async () => {
    const resourceOperations = operations();
    const onLocalDirectoryCreated = vi.fn();

    render(
      <SkillFilesPanel
        skill={skill()}
        localPreview
        connected
        isDesktopViewport
        operations={resourceOperations}
        onSkillContentChanged={vi.fn()}
        onLocalDirectoryCreated={onLocalDirectoryCreated}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByPlaceholderText("Folder name"), { target: { value: "scripts" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onLocalDirectoryCreated).toHaveBeenCalledWith("scripts"));
    fireEvent.click(await screen.findByRole("button", { name: "SKILL.md" }));
    fireEvent.click(await screen.findByRole("button", { name: /^raw$/i }));
    expect(screen.getByRole("textbox", { name: /skill\.md contents/i })).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload files" })).not.toBeInTheDocument();
    expect(resourceOperations.readResource).not.toHaveBeenCalled();
    expect(resourceOperations.writeResource).not.toHaveBeenCalled();
  });
});
