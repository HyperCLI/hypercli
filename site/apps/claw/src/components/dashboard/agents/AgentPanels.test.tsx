import { fireEvent, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Agent } from "@/app/dashboard/agents/types";
import { renderWithClient } from "@/test/utils";

vi.mock("./FirstAgentSetupWizard", () => ({
  FirstAgentSetupWizard: () => <div>First agent setup wizard</div>,
}));

vi.mock("@hypercli/shared-ui", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { AgentList, AgentSettingsPanel } from "./AgentPanels";

const agent: Agent = {
  id: "agent-1",
  name: "Test Agent",
  user_id: "user-1",
  pod_id: "pod-1",
  pod_name: "agent-1",
  state: "RUNNING",
  cpu_millicores: 4000,
  memory_mib: 4096,
  hostname: "agent.example.com",
  started_at: "2026-05-05T00:00:00Z",
  stopped_at: null,
  last_error: null,
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
  gatewayToken: null,
  meta: null,
};

function renderAgentList(overrides: Partial<ComponentProps<typeof AgentList>> = {}) {
  const props: ComponentProps<typeof AgentList> = {
    sidebarCollapsed: true,
    isDesktopViewport: true,
    mobileShowChat: false,
    agents: [agent],
    selectedAgentId: null,
    setSelectedAgentId: vi.fn(),
    setMobileShowChat: vi.fn(),
    setSidebarCollapsed: vi.fn(),
    syntheticThreads: [
      {
        id: agent.id,
        sessionKey: agent.id,
        participants: [{ id: agent.id, name: agent.name, type: "agent" }],
        kind: "user-agent",
        lastMessage: "",
        lastMessageBy: agent.id,
        lastMessageAt: Date.now(),
        messageCount: 0,
        unreadCount: 0,
        isActive: true,
      },
    ],
    getToken: vi.fn(async () => "token"),
    createOpenClawAgent: vi.fn(async () => ({ id: "created-agent" })),
    fetchAgents: vi.fn(),
    setError: vi.fn(),
    openCreateDialog: vi.fn(),
    sidebarCreatorSignal: 0,
    setPendingAgentDelete: vi.fn(),
    updateAgentName: vi.fn(),
    ...overrides,
  };

  renderWithClient(<AgentList {...props} />);
  return props;
}

function renderAgentSettingsPanel(overrides: Partial<ComponentProps<typeof AgentSettingsPanel>> = {}) {
  const props: ComponentProps<typeof AgentSettingsPanel> = {
    agent,
    settingsName: agent.name,
    setSettingsName: vi.fn(),
    savingName: false,
    handleSaveName: vi.fn(),
    chat: {
      connected: true,
      connecting: false,
      config: null,
      configSchema: null,
      models: ["gpt-test"],
      saveConfig: vi.fn(async () => undefined),
      saveFullConfig: vi.fn(async () => undefined),
      channelsStatus: vi.fn(async () => ({})),
      activityFeed: [],
      files: [],
    },
    ...overrides,
  };

  renderWithClient(<AgentSettingsPanel {...props} />);
  return props;
}

describe("AgentList", () => {
  it("keeps the agents/channels sidebar collapsed until the explicit expand control is used", () => {
    const props = renderAgentList();

    fireEvent.click(screen.getByRole("button", { name: /select test agent/i }));
    expect(props.setSidebarCollapsed).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("Expand sidebar"));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(false);
  });

  it("only collapses the expanded agents/channels sidebar from its explicit collapse control", () => {
    const props = renderAgentList({ sidebarCollapsed: false });

    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });
});

describe("AgentSettingsPanel", () => {
  it("stops a running agent from settings", () => {
    const onStopAgent = vi.fn();
    renderAgentSettingsPanel({ onStopAgent });

    const rows = screen.getAllByText(/Agent runtime|Agent name|Default model|Visibility|Auto-archive idle conversations/);
    expect(rows[0]).toHaveTextContent("Agent runtime");
    fireEvent.click(screen.getByRole("button", { name: /stop agent/i }));
    expect(onStopAgent).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /start agent/i })).not.toBeInTheDocument();
  });

  it("starts a stopped agent from settings", () => {
    const onStartAgent = vi.fn();
    renderAgentSettingsPanel({
      agent: { ...agent, state: "STOPPED", stopped_at: "2026-05-05T01:00:00Z" },
      onStartAgent,
    });

    fireEvent.click(screen.getByRole("button", { name: /start agent/i }));
    expect(onStartAgent).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /stop agent/i })).not.toBeInTheDocument();
  });
});
