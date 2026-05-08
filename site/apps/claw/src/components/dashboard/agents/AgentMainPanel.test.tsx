import type { ComponentProps } from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildSdkAgent } from "@/test/factories";
import { renderWithClient } from "@/test/utils";
import { toAgentViewModel } from "./agentViewModel";
import { AgentMainPanel } from "./AgentMainPanel";

vi.mock("@/components/dashboard/agents/AgentPanels", () => {
  type EmptyStateMockProps = {
    onCreate: () => void;
    launchLabel?: string;
    onLaunchAction?: () => void;
  };
  const emptyStateButton = (regionLabel: string, defaultButtonLabel: string) => {
    function EmptyStateButton({ onCreate, launchLabel, onLaunchAction }: EmptyStateMockProps) {
      return (
        <section aria-label={regionLabel}>
          <button type="button" onClick={onLaunchAction ?? onCreate}>{launchLabel ?? defaultButtonLabel}</button>
        </section>
      );
    }
    return EmptyStateButton;
  };

  return {
    AgentEmptyState: emptyStateButton("Chat empty state", "Create new agent"),
    AgentFilesEmptyState: emptyStateButton("Files empty state", "Launch files agent"),
    AgentIntegrationsEmptyState: emptyStateButton("Integrations empty state", "Launch integrations agent"),
    AgentSkillsEmptyState: emptyStateButton("Skills empty state", "Launch skills agent"),
    AgentScheduledEmptyState: emptyStateButton("Scheduled empty state", "Launch scheduled agent"),
    LaunchFirstAgentEmptyState: emptyStateButton("First agent empty state", "Create an agent"),
  };
});

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

  it("shows the first-agent empty state before an agent exists", () => {
    const onCreate = vi.fn();
    renderAgentMainPanel({
      selectedAgent: null,
      onCreate,
    });

    const emptyState = screen.getByRole("region", { name: /first agent empty state/i });
    fireEvent.click(within(emptyState).getByRole("button", { name: /create an agent/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("shows the first-agent empty state when files is selected before an agent exists", () => {
    renderAgentMainPanel({
      selectedAgent: null,
      currentPanel: "files",
      stoppedTabLabel: "Files",
    });

    expect(screen.getByRole("region", { name: /first agent empty state/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /files empty state/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create new agent/i })).not.toBeInTheDocument();
  });

  it("shows the first-agent empty state when integrations is selected before an agent exists", () => {
    renderAgentMainPanel({
      selectedAgent: null,
      currentPanel: "integrations",
      stoppedTabLabel: "Integrations",
    });

    expect(screen.getByRole("region", { name: /first agent empty state/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /integrations empty state/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create new agent/i })).not.toBeInTheDocument();
  });

  it("shows the first-agent empty state when skills is selected before an agent exists", () => {
    renderAgentMainPanel({
      selectedAgent: null,
      currentPanel: "integrations",
      skillsPanelActive: true,
      stoppedTabLabel: "Integrations",
    });

    expect(screen.getByRole("region", { name: /first agent empty state/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /skills empty state/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /integrations empty state/i })).not.toBeInTheDocument();
  });

  it("shows the first-agent empty state when scheduled is selected before an agent exists", () => {
    renderAgentMainPanel({
      selectedAgent: null,
      currentPanel: "scheduled",
      stoppedTabLabel: "Scheduled",
    });

    expect(screen.getByRole("region", { name: /first agent empty state/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /scheduled empty state/i })).not.toBeInTheDocument();
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

    expect(screen.getByRole("region", { name: /chat empty state/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^start agent$/i })).toBeInTheDocument();
    expect(screen.queryByText("Provisioning runtime")).not.toBeInTheDocument();
    expect(screen.queryByText("Booting agent")).not.toBeInTheDocument();
  });

  it.each([
    { currentPanel: "chat" as const, skillsPanelActive: false, regionName: /chat empty state/i },
    { currentPanel: "files" as const, skillsPanelActive: false, regionName: /files empty state/i },
    { currentPanel: "integrations" as const, skillsPanelActive: false, regionName: /integrations empty state/i },
    { currentPanel: "integrations" as const, skillsPanelActive: true, regionName: /skills empty state/i },
    { currentPanel: "scheduled" as const, skillsPanelActive: false, regionName: /scheduled empty state/i },
  ])("shows the section empty state with a start CTA for a stopped agent", ({ currentPanel, skillsPanelActive, regionName }) => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({ state: "STOPPED" }));
    const onStart = vi.fn();
    renderAgentMainPanel({
      selectedAgent,
      currentPanel,
      skillsPanelActive,
      stoppedTabLabel: "Workspace",
      panelContent: <div>Live panel</div>,
      onStart,
    });

    const emptyState = screen.getByRole("region", { name: regionName });
    expect(screen.queryByText("Live panel")).not.toBeInTheDocument();
    fireEvent.click(within(emptyState).getByRole("button", { name: /^start agent$/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("keeps settings content available for a stopped agent", () => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({ state: "STOPPED" }));
    renderAgentMainPanel({
      selectedAgent,
      currentPanel: "settings",
      stoppedTabLabel: "Settings",
      panelContent: <div>Settings panel</div>,
    });

    expect(screen.getByText("Settings panel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^start agent$/i })).not.toBeInTheDocument();
  });

  it("does not render files or settings actions in the header", () => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({ state: "STOPPED" }));
    renderAgentMainPanel({
      selectedAgent,
      currentPanel: "files",
      stoppedTabLabel: "Files",
      panelContent: <div>Files panel</div>,
    });

    expect(screen.queryByTitle("Open workspace files")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Settings")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^start agent$/i })).toBeInTheDocument();
    expect(screen.queryByText("Files panel")).not.toBeInTheDocument();
  });
});
