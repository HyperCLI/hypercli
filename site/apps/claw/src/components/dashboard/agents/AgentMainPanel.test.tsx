import type { ComponentProps } from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildSdkAgent } from "@/test/factories";
import { renderWithClient } from "@/test/utils";
import { toAgentViewModel } from "./agentViewModel";
import { AgentMainPanel } from "./AgentMainPanel";

vi.mock("@/components/dashboard/agents/AgentPanels", () => ({
  AgentEmptyState: ({ onCreate }: { onCreate: () => void }) => (
    <button type="button" onClick={onCreate}>Create new agent</button>
  ),
  AgentFilesEmptyState: ({ onCreate }: { onCreate: () => void }) => (
    <button type="button" onClick={onCreate}>Launch files agent</button>
  ),
  AgentIntegrationsEmptyState: ({ onCreate }: { onCreate: () => void }) => (
    <button type="button" onClick={onCreate}>Launch integrations agent</button>
  ),
  AgentSkillsEmptyState: ({ onCreate }: { onCreate: () => void }) => (
    <button type="button" onClick={onCreate}>Launch skills agent</button>
  ),
  AgentScheduledEmptyState: ({ onCreate }: { onCreate: () => void }) => (
    <button type="button" onClick={onCreate}>Launch scheduled agent</button>
  ),
}));

function renderAgentMainPanel(overrides: Partial<ComponentProps<typeof AgentMainPanel>> = {}) {
  const selectedAgent = "selectedAgent" in overrides
    ? overrides.selectedAgent ?? null
    : toAgentViewModel(buildSdkAgent({ state: "STOPPED" }));
  const props: ComponentProps<typeof AgentMainPanel> = {
    isDesktopViewport: true,
    mobileShowChat: true,
    selectedAgent,
    isSelectedTransitioning: false,
    isSelectedRunning: selectedAgent?.state === "RUNNING",
    burstAgentId: null,
    onBurstComplete: vi.fn(),
    activeConnectionStatus: null,
    chatConnected: false,
    chatConnecting: false,
    startingId: null,
    recentlyStoppedIds: new Set(),
    selectedAgentLaunchBlocked: false,
    currentPanel: "chat",
    stoppedTabLabel: "Chat",
    panelContent: <div>Chat panel</div>,
    onCreate: vi.fn(),
    onShowList: vi.fn(),
    onShowInspector: vi.fn(),
    onStart: vi.fn(),
    onReconnect: vi.fn(),
    ...overrides,
  };

  return renderWithClient(<AgentMainPanel {...props} />);
}

describe("AgentMainPanel", () => {
  it("waits for the first agent load before showing the empty state", () => {
    renderAgentMainPanel({
      selectedAgent: null,
      loadingInitialAgents: true,
    });

    expect(screen.getByText("Loading agents")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create new agent/i })).not.toBeInTheDocument();
  });

  it("shows the files empty state when files is selected before an agent exists", () => {
    renderAgentMainPanel({
      selectedAgent: null,
      currentPanel: "files",
      stoppedTabLabel: "Files",
    });

    expect(screen.getByRole("button", { name: /launch files agent/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create new agent/i })).not.toBeInTheDocument();
  });

  it("shows the integrations empty state when integrations is selected before an agent exists", () => {
    renderAgentMainPanel({
      selectedAgent: null,
      currentPanel: "integrations",
      stoppedTabLabel: "Integrations",
    });

    expect(screen.getByRole("button", { name: /launch integrations agent/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create new agent/i })).not.toBeInTheDocument();
  });

  it("shows the skills empty state when skills is selected before an agent exists", () => {
    renderAgentMainPanel({
      selectedAgent: null,
      currentPanel: "integrations",
      skillsPanelActive: true,
      stoppedTabLabel: "Integrations",
    });

    expect(screen.getByRole("button", { name: /launch skills agent/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /launch integrations agent/i })).not.toBeInTheDocument();
  });

  it("shows the scheduled empty state when scheduled is selected before an agent exists", () => {
    renderAgentMainPanel({
      selectedAgent: null,
      currentPanel: "scheduled",
      stoppedTabLabel: "Scheduled",
    });

    expect(screen.getByRole("button", { name: /launch scheduled agent/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create new agent/i })).not.toBeInTheDocument();
  });

  it("renders STOPPING as a non-launchable transition state", () => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({ state: "STOPPING" }));
    renderAgentMainPanel({
      selectedAgent,
      isSelectedTransitioning: true,
      isSelectedRunning: false,
      agentStatus: {
        label: "Stopping",
        detail: "Stopping the runtime and cleaning up the workspace.",
        tone: "stopping",
        loading: true,
      },
    });

    expect(screen.getByText("Stopping agent")).toBeInTheDocument();
    expect(screen.getByText("Stopping the runtime and cleaning up the workspace.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start agent/i })).not.toBeInTheDocument();
  });

  it("does not render the boot animation for a stopped agent with a stale burst id", () => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({ state: "STOPPED" }));
    renderAgentMainPanel({
      selectedAgent,
      burstAgentId: selectedAgent.id,
    });

    expect(screen.getByText("Start Agent to Use Chat")).toBeInTheDocument();
    expect(screen.queryByText("Provisioning runtime")).not.toBeInTheDocument();
    expect(screen.queryByText("Booting agent")).not.toBeInTheDocument();
  });

  it("keeps the files panel available for a stopped agent", () => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({ state: "STOPPED" }));
    renderAgentMainPanel({
      selectedAgent,
      currentPanel: "files",
      stoppedTabLabel: "Files",
      panelContent: <div>Files panel</div>,
    });

    expect(screen.getByText("Files panel")).toBeInTheDocument();
    expect(screen.queryByText("Start Agent to Use Files")).not.toBeInTheDocument();
  });

  it("does not render files, settings, or start actions in the header", () => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({ state: "STOPPED" }));
    renderAgentMainPanel({
      selectedAgent,
      currentPanel: "files",
      stoppedTabLabel: "Files",
      panelContent: <div>Files panel</div>,
    });

    expect(screen.queryByTitle("Open workspace files")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Settings")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^start agent$/i })).not.toBeInTheDocument();
    expect(screen.getByText("Files panel")).toBeInTheDocument();
  });
});
