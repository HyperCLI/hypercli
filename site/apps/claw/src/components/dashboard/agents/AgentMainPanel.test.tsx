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
    fileCount: 0,
    openingDesktopId: null,
    startingId: null,
    recentlyStoppedIds: new Set(),
    selectedAgentLaunchBlocked: false,
    currentPanel: "chat",
    stoppedTabLabel: "Chat",
    panelContent: <div>Chat panel</div>,
    onCreate: vi.fn(),
    onShowList: vi.fn(),
    onOpenFiles: vi.fn(),
    onOpenDesktop: vi.fn(),
    onDelete: vi.fn(),
    onShowInspector: vi.fn(),
    onStart: vi.fn(),
    onReconnect: vi.fn(),
    onSelectPanel: vi.fn(),
    onOpenSettings: vi.fn(),
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
});
