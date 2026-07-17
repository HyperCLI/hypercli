import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildSdkAgent } from "@/test/factories";
import { renderWithClient } from "@/test/utils";
import { toAgentViewModel } from "./agentViewModel";

vi.mock("@hypercli/shared-ui", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipContent: ({ children }: { children: unknown }) => children,
  TooltipTrigger: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/components/dashboard/AgentsChannelsSidebar", () => ({
  AgentsChannelsSidebar: () => null,
}));

vi.mock("@/components/dashboard/modules/AgentCardModule", () => ({
  AgentCardTooltip: () => null,
}));

vi.mock("./FirstAgentSetupWizard", () => ({
  FirstAgentSetupWizard: () => null,
}));

import { OpenClawConfigPanel, OpenClawSettingsPanel } from "./AgentPanels";

function renderOpenClawConfigPanel(overrides: Partial<React.ComponentProps<typeof OpenClawConfigPanel>> = {}) {
  const chat = {
    connected: true,
    connecting: false,
    config: { model: "old-model" },
    configSchema: null,
    models: [],
    saveConfig: vi.fn().mockResolvedValue(undefined),
    saveFullConfig: vi.fn().mockResolvedValue(undefined),
    channelsStatus: vi.fn().mockResolvedValue({}),
    activityFeed: [],
    files: [],
  };

  const props: React.ComponentProps<typeof OpenClawConfigPanel> = {
    agent: toAgentViewModel(buildSdkAgent({ state: "RUNNING" })),
    onClose: vi.fn(),
    openclawSections: [],
    openclawSchemaBundle: null,
    effectiveOpenclawSection: null,
    setActiveOpenclawSection: vi.fn(),
    activeOpenclawSectionLabel: null,
    openclawSaving: false,
    openclawDraft: { model: "old-model" },
    openclawError: null,
    openclawSuccess: null,
    chat,
    visibleOpenclawSections: [],
    renderOpenclawField: vi.fn(),
    saveOpenclawSection: vi.fn(),
    saveAllOpenclaw: vi.fn(),
    openclawPaneRef: React.createRef<HTMLDivElement>(),
    ...overrides,
  };

  return {
    props,
    chat,
    ...renderWithClient(<OpenClawConfigPanel {...props} />),
  };
}

describe("OpenClawConfigPanel", () => {
  it("renders openclaw.json as an inline editor and saves parsed JSON", async () => {
    const { chat, container } = renderOpenClawConfigPanel();

    expect(screen.getAllByText("openclaw.json").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sections")).not.toBeInTheDocument();
    expect(container.querySelector(".fixed")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: JSON.stringify({ model: "new-model" }, null, 2) },
    });
    fireEvent.click(screen.getByTitle("Save"));

    await waitFor(() => expect(chat.saveFullConfig).toHaveBeenCalledWith({ model: "new-model" }));
    expect(chat.saveConfig).not.toHaveBeenCalled();
  });

  it("rejects invalid openclaw.json before saving", async () => {
    const { chat } = renderOpenClawConfigPanel();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "{ invalid json" },
    });
    fireEvent.click(screen.getByTitle("Save"));

    expect(await screen.findByText(/Invalid JSON:/)).toBeInTheDocument();
    expect(chat.saveFullConfig).not.toHaveBeenCalled();
  });

  it("shows a read-only editor when the gateway is disconnected", () => {
    renderOpenClawConfigPanel({
      chat: {
        connected: false,
        connecting: false,
        config: { model: "old-model" },
        configSchema: null,
        models: [],
        saveConfig: vi.fn().mockResolvedValue(undefined),
        saveFullConfig: vi.fn().mockResolvedValue(undefined),
        channelsStatus: vi.fn().mockResolvedValue({}),
        activityFeed: [],
        files: [],
      },
    });

    expect(screen.getByText("Reconnect the gateway before editing openclaw.json.")).toBeInTheDocument();
    expect(screen.queryByTitle("Save")).not.toBeInTheDocument();
  });
});

describe("OpenClawSettingsPanel", () => {
  function buildSettingsPanelProps(overrides: Partial<React.ComponentProps<typeof OpenClawSettingsPanel>> = {}) {
    const sectionSchema = {
      title: "Model settings",
      description: "Configure provider and model behavior.",
      type: "object",
    };
    const skillsSchema = {
      title: "Skills",
      description: "Configure reusable skills.",
      type: "object",
    };
    const scheduleSchema = {
      title: "Schedule",
      description: "Configure recurring work.",
      type: "object",
    };

    return {
      agent: toAgentViewModel(buildSdkAgent({ state: "RUNNING" })),
      openclawSections: [
        ["llm", sectionSchema],
        ["skills", skillsSchema],
        ["schedule", scheduleSchema],
      ] as Array<[string, unknown]>,
      openclawSchemaBundle: null,
      effectiveOpenclawSection: "llm",
      setActiveOpenclawSection: vi.fn(),
      activeOpenclawSectionLabel: "Model settings",
      openclawSaving: false,
      openclawDraft: { llm: { model: "gpt-test" }, skills: {}, schedule: {} },
      openclawError: null,
      openclawSuccess: null,
      chat: {
        connected: true,
        connecting: false,
        config: { llm: { model: "gpt-test" }, skills: {}, schedule: {} },
        configSchema: null,
        models: [],
        saveConfig: vi.fn().mockResolvedValue(undefined),
        saveFullConfig: vi.fn().mockResolvedValue(undefined),
        channelsStatus: vi.fn().mockResolvedValue({}),
        activityFeed: [],
        files: [],
      },
      visibleOpenclawSections: [["llm", sectionSchema]] as Array<[string, unknown]>,
      renderOpenclawField: vi.fn((_schemaRaw: unknown, path: string[]) => (
        <div>Rendered {path.join(".")}</div>
      )),
      saveOpenclawSection: vi.fn().mockResolvedValue(undefined),
      saveAllOpenclaw: vi.fn().mockResolvedValue(undefined),
      openclawPaneRef: React.createRef<HTMLDivElement>(),
      isDesktopViewport: true,
      ...overrides,
    };
  }

  it("renders the prod-style section editor and saves the active section", async () => {
    const baseProps = buildSettingsPanelProps();

    renderWithClient(<OpenClawSettingsPanel {...baseProps} />);

    expect(screen.getByText("Sections")).toBeInTheDocument();
    expect(screen.getAllByText("Model settings").length).toBeGreaterThan(0);
    expect(screen.getByText("Configure provider and model behavior.")).toBeInTheDocument();
    expect(screen.getByText("Rendered llm")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save section/i }));
    await waitFor(() => expect(baseProps.saveOpenclawSection).toHaveBeenCalledWith("llm"));
  });

  it("lets every schema section be selected from the settings drawer", () => {
    const baseProps = buildSettingsPanelProps();

    renderWithClient(<OpenClawSettingsPanel {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    expect(baseProps.setActiveOpenclawSection).toHaveBeenNthCalledWith(1, "skills");
    expect(baseProps.setActiveOpenclawSection).toHaveBeenNthCalledWith(2, "schedule");
  });

  it("keeps section saves disabled while the gateway is disconnected", () => {
    const baseProps = buildSettingsPanelProps({
      chat: {
        connected: false,
        connecting: false,
        config: { llm: { model: "gpt-test" } },
        configSchema: null,
        models: [],
        saveConfig: vi.fn().mockResolvedValue(undefined),
        saveFullConfig: vi.fn().mockResolvedValue(undefined),
        channelsStatus: vi.fn().mockResolvedValue({}),
        activityFeed: [],
        files: [],
      },
    });

    renderWithClient(<OpenClawSettingsPanel {...baseProps} />);

    expect(screen.getByRole("button", { name: /save section/i })).toBeDisabled();
    expect(screen.getByText("Connect the agent gateway to edit OpenClaw settings.")).toBeInTheDocument();
  });
});
