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
    launching?: boolean;
    launchBlocked?: boolean;
    launchBlockedReason?: string | null;
    onLaunchAction?: () => void;
  };
  const emptyStateButton = (regionLabel: string, defaultButtonLabel: string) => {
    function EmptyStateButton({ onCreate, launchLabel, launching, launchBlocked, launchBlockedReason, onLaunchAction }: EmptyStateMockProps) {
      return (
        <section aria-label={regionLabel}>
          <button
            type="button"
            onClick={onLaunchAction ?? onCreate}
            disabled={Boolean(launching || launchBlocked)}
            title={launchBlockedReason ?? undefined}
          >
            {launching ? "Starting agent" : launchLabel ?? defaultButtonLabel}
          </button>
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
    AgentScheduledEmptyState: () => (
      <section aria-label="Scheduled coming soon">
        <p>Coming Soon</p>
        <p>Your work, on autopilot</p>
      </section>
    ),
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

  it("does not show the first-agent empty state while another agent is available", () => {
    renderAgentMainPanel({
      selectedAgent: null,
      hasAgents: true,
    });

    expect(screen.getByText("Selecting agent")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /first agent empty state/i })).not.toBeInTheDocument();
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
      currentPanel: "files",
      stoppedTabLabel: "Files",
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

  it("lets the chat panel own startup boot stages", () => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({ state: "PENDING" }));
    renderAgentMainPanel({
      selectedAgent,
      isSelectedTransitioning: true,
      isSelectedRunning: false,
      currentPanel: "chat",
      panelContent: <div>Chat-owned boot state</div>,
    });

    expect(screen.getByText("Chat-owned boot state")).toBeInTheDocument();
    expect(screen.queryByText("Provisioning runtime")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start agent/i })).not.toBeInTheDocument();
  });

  it("keeps non-chat panels covered by the outer startup stage", () => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({ state: "PENDING" }));
    renderAgentMainPanel({
      selectedAgent,
      isSelectedTransitioning: true,
      isSelectedRunning: false,
      currentPanel: "files",
      stoppedTabLabel: "Files",
      panelContent: <div>Files panel</div>,
    });

    expect(screen.getByText("Provisioning runtime")).toBeInTheDocument();
    expect(screen.queryByText("Files panel")).not.toBeInTheDocument();
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

  it("shows the scheduled coming soon panel without a start CTA", () => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({ state: "RUNNING" }));
    renderAgentMainPanel({
      selectedAgent,
      currentPanel: "scheduled",
      stoppedTabLabel: "Scheduled",
      isSelectedRunning: true,
      panelContent: <div>Live panel</div>,
    });

    expect(screen.getByRole("region", { name: /scheduled coming soon/i })).toBeInTheDocument();
    expect(screen.getByText("Coming Soon")).toBeInTheDocument();
    expect(screen.getByText("Your work, on autopilot")).toBeInTheDocument();
    expect(screen.queryByText("Live panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^start agent$/i })).not.toBeInTheDocument();
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

  it("blocks restart cooldown without showing the stopped empty state as starting", () => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({ state: "STOPPED" }));
    renderAgentMainPanel({
      selectedAgent,
      recentlyStoppedIds: new Set([selectedAgent.id]),
      currentPanel: "chat",
      stoppedTabLabel: "Chat",
    });

    const startButton = screen.getByRole("button", { name: /^start agent$/i });
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveAttribute("title", "Agent is finishing shutdown. Try again shortly.");
    expect(screen.queryByRole("button", { name: /starting agent/i })).not.toBeInTheDocument();
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
