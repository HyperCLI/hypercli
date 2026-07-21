import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "@/app/dashboard/agents/types";
import { renderWithClient } from "@/test/utils";

vi.mock("./FirstAgentSetupWizard", () => ({
  FirstAgentSetupWizard: () => <div>First agent setup wizard</div>,
}));

vi.mock("@hypercli/shared-ui", () => ({
  HyperCLILogo: ({ className }: { className?: string }) => <div aria-hidden="true" className={className} />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  ThemeToggle: () => <button type="button">Theme</button>,
  Switch: ({ checked, onCheckedChange, "aria-label": ariaLabel }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    "aria-label"?: string;
  }) => (
    <button type="button" role="switch" aria-label={ariaLabel} aria-checked={checked} onClick={() => onCheckedChange(!checked)} />
  ),
  ConfirmDialog: ({
    open,
    title,
    message,
    confirmLabel,
    loading,
    onCancel,
    onConfirm,
  }: {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    loading?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  }) => open ? (
    <div role="dialog" aria-label={title}>
      <p>{message}</p>
      <button type="button" disabled={loading} onClick={onCancel}>Cancel</button>
      <button type="button" disabled={loading} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  ) : null,
}));

const sdkMocks = vi.hoisted(() => ({
  userGet: vi.fn(),
  userUpdate: vi.fn(),
}));

const agentClientMocks = vi.hoisted(() => ({
  createAgentClient: vi.fn(() => ({ fileWriteBytes: vi.fn(async () => undefined) })),
}));

vi.mock("@hypercli.com/sdk/browser", () => ({
  BrowserHyperCLI: vi.fn(function BrowserHyperCLI() {
    return {
      user: {
        get: sdkMocks.userGet,
        update: sdkMocks.userUpdate,
      },
    };
  }),
}));

vi.mock("@/lib/agent-client", () => ({
  createAgentClient: agentClientMocks.createAgentClient,
}));

import { AgentList, AgentSettingsPanel, ErrorBanner } from "./AgentPanels";

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  sdkMocks.userGet.mockResolvedValue({
    userId: "user-1234567890abcdef",
    email: "test@example.com",
    name: "John Smith",
    isActive: true,
    createdAt: "2026-05-05T00:00:00Z",
  });
  sdkMocks.userUpdate.mockResolvedValue({
    userId: "user-1234567890abcdef",
    email: "test@example.com",
    name: "John Smith",
    isActive: true,
    createdAt: "2026-05-05T00:00:00Z",
  });
  agentClientMocks.createAgentClient.mockReturnValue({ fileWriteBytes: vi.fn(async () => undefined) });
});

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
  launchConfig: {
    image: "ghcr.io/hypercli/hypercli-openclaw:prod",
    env: {
      OPENCLAW_GATEWAY_TOKEN: "gateway-token",
      OPENCLAW_DESKTOP_ENABLED: "0",
      HYPER_API_BASE: "https://api.hypercli.com",
      HYPER_WORKSPACES_BOOT_SYNC: "1",
      HYPER_WORKSPACES_DIR: "/home/node/workspaces",
      HYPER_WORKSPACES_SYNC_READY_ONLY: "1",
      OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: "0",
      FOO: "bar",
      HYPER_CUSTOM_FLAG: "visible",
    },
    routes: {
      openclaw: { port: 18789, auth: false, prefix: "" },
    },
    sync_root: "/home/node",
    sync_enabled: true,
  },
  gatewayToken: null,
  meta: null,
};

const stoppedAgent: Agent = {
  ...agent,
  id: "agent-stopped",
  name: "Stopped Agent",
  state: "STOPPED",
};

const failedAgent: Agent = {
  ...agent,
  id: "agent-failed",
  name: "Failed Agent",
  state: "FAILED",
};

const startingAgent: Agent = {
  ...agent,
  id: "agent-starting",
  name: "Starting Agent",
  state: "STARTING",
};

function agentThread(item: Agent) {
  return {
    id: item.id,
    sessionKey: item.id,
    participants: [{ id: item.id, name: item.name, type: "agent" as const }],
    kind: "user-agent" as const,
    title: item.displayName?.trim() || item.name,
    lastMessage: item.state === "RUNNING" ? "Connected" : item.state.toLowerCase(),
    lastMessageBy: item.id,
    lastMessageAt: Date.now(),
    messageCount: 0,
    unreadCount: 0,
    isActive: item.state === "RUNNING",
  };
}

function createAgentListProps(overrides: Partial<ComponentProps<typeof AgentList>> = {}): ComponentProps<typeof AgentList> {
  return {
    sidebarCollapsed: true,
    isDesktopViewport: true,
    mobileShowChat: false,
    agents: [agent],
    selectedAgentId: null,
    setSelectedAgentId: vi.fn(),
    setMobileShowChat: vi.fn(),
    setSidebarCollapsed: vi.fn(),
    syntheticThreads: [agentThread(agent)],
    getToken: vi.fn(async () => "token"),
    createOpenClawAgent: vi.fn(async () => ({ id: "created-agent" })),
    fetchAgents: vi.fn(),
    setError: vi.fn(),
    sidebarCreatorSignal: 0,
    setPendingAgentDelete: vi.fn(),
    updateAgentName: vi.fn(),
    ...overrides,
  };
}

function renderAgentList(overrides: Partial<ComponentProps<typeof AgentList>> = {}) {
  const props = createAgentListProps(overrides);
  renderWithClient(<AgentList {...props} />);
  return props;
}

function renderAgentSettingsPanel(overrides: Partial<ComponentProps<typeof AgentSettingsPanel>> = {}) {
  const props: ComponentProps<typeof AgentSettingsPanel> = {
    agent,
    user: {
      id: "user-1234567890abcdef",
      email: "test@example.com",
      name: "John Smith",
      walletAddress: "0x1234567890abcdef",
    },
    openclawConfig: {
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5-mini",
          },
          memorySearch: {
            enabled: true,
            sync: {
              onSessionStart: false,
              onSearch: false,
              watch: false,
              watchDebounceMs: 30000,
              intervalMinutes: 0,
            },
          },
        },
      },
      models: {
        providers: {
          openai: {
            name: "OpenAI",
            models: [{ id: "gpt-5-mini", name: "GPT-5 Mini" }],
          },
          anthropic: {
            name: "Anthropic",
            models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }],
          },
        },
      },
    },
    openclawModels: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", providerId: "google", providerName: "Google" },
    ],
    onSaveOpenClawConfig: vi.fn(async () => undefined),
    onLogout: vi.fn(),
    onDeleteAgent: vi.fn(),
    ...overrides,
  };

  const renderResult = renderWithClient(<AgentSettingsPanel {...props} />);
  return { props, ...renderResult };
}

describe("AgentList", () => {
  it("does not render the desktop agents/channels sidebar below the desktop breakpoint", () => {
    renderAgentList({ isDesktopViewport: false });

    expect(screen.queryByRole("button", { name: /select test agent/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /launch agent/i })).not.toBeInTheDocument();
  });

  it("keeps the agents/channels sidebar collapsed until the explicit expand control is used", () => {
    const props = renderAgentList();

    fireEvent.click(screen.getByRole("button", { name: /select test agent/i }));
    expect(props.setSidebarCollapsed).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Expand agents sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(false);
  });

  it("only collapses the expanded agents/channels sidebar from its explicit collapse control", () => {
    const props = renderAgentList({ sidebarCollapsed: false });

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it("places My Agents or search below the desktop roster actions", () => {
    renderAgentList({ sidebarCollapsed: false });

    const rosterHeader = document.querySelector(".agents-roster-header");
    const actions = document.querySelector(".agents-roster-actions");
    const sectionHeader = document.querySelector(".agents-roster-section-header");
    const search = screen.getByRole("button", { name: "Search agents" });
    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });

    expect(actions).toContainElement(collapse);
    expect(sectionHeader).toContainElement(screen.getByRole("heading", { name: /^My Agents/ }));
    expect(screen.queryByRole("button", { name: /^My Agents/ })).not.toBeInTheDocument();
    expect(sectionHeader).toContainElement(search);
    const myAgentsLabel = screen.getByText(/^My Agents\(\d+\)$/);
    expect(myAgentsLabel).toHaveClass("text-[13px]", "text-text-secondary");
    expect(myAgentsLabel).not.toHaveClass("uppercase");
    expect(screen.getByText("Administration")).toHaveClass("text-text-secondary");
    expect(sectionHeader).toHaveClass("pl-5", "pr-3");
    expect(document.querySelector(".agents-roster-administration > div")).toHaveClass("pl-5", "pr-3");
    expect(sectionHeader?.querySelector(".h-px")).not.toBeInTheDocument();
    expect(document.querySelector(".agents-roster-administration .h-px")).not.toBeInTheDocument();
    expect(rosterHeader).not.toContainElement(search);
    expect(rosterHeader).not.toContainElement(collapse);

    fireEvent.click(search);
    const searchRow = document.querySelector(".agents-roster-search");
    expect(searchRow).toContainElement(screen.getByPlaceholderText("Search Agents"));
    expect(searchRow?.firstElementChild).toHaveClass("px-4", "pb-3", "pt-2");
    expect(sectionHeader).toContainElement(screen.getByRole("button", { name: "Close search" }));
    expect(document.querySelector(".agents-roster-section-header")).toBeInTheDocument();
  });

  it("opens the launch agent wizard from the expanded agents list button", () => {
    renderAgentList({ sidebarCollapsed: false });

    fireEvent.click(screen.getByRole("button", { name: /launch agent/i }));
    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();
  });

  it("aligns the expanded launch action with reorderable agent rows", () => {
    const agents = [agent, failedAgent];
    renderAgentList({
      sidebarCollapsed: false,
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    const launch = screen.getByRole("button", { name: "Launch agent" });
    expect(launch).toHaveClass("items-start", "border-l-2", "border-r", "border-border", "px-3", "py-2.5");
    expect(launch.children[0]).toHaveAttribute("aria-hidden", "true");
    expect(launch.children[0]).toHaveClass("-ml-2", "h-7", "w-6");
    expect(launch.children[1]).toHaveClass("h-7", "w-7", "rounded-full");
    expect(launch).toHaveTextContent("Create a new workspace");
    expect(document.querySelector(".agents-roster-section-header")).toHaveClass("pl-5", "pr-3");
    expect(document.querySelector(".agents-roster-administration > div")).toHaveClass("pl-5", "pr-3");
    expect(document.querySelector(".agents-roster-expanded .agents-roster-header")).toBeInTheDocument();
    expect(document.querySelector(".agents-roster-expanded .agents-roster-scroll")).toBeInTheDocument();
  });

  it("uses display names and omits a redundant sender from agent status", () => {
    const displayAgent: Agent = {
      ...agent,
      id: "agent-marketing",
      name: "rapid-forge-engine",
      displayName: "Marketing",
    };
    const agents = [agent, displayAgent];
    renderAgentList({
      sidebarCollapsed: false,
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    expect(screen.getByText("Marketing")).toBeInTheDocument();
    expect(screen.getByText((_, element) => (
      element?.tagName === "P" && element.textContent === "Connected"
    ))).toBeInTheDocument();
    expect(screen.queryByText("Test Agent: Connected")).not.toBeInTheDocument();
    expect(screen.getByText((_, element) => (
      element?.tagName === "P" && element.textContent === "rapid-forge-engine: Connected"
    ))).toBeInTheDocument();
  });

  it("shows the launch agent button in the collapsed rail", () => {
    renderAgentList();

    fireEvent.click(screen.getByRole("button", { name: /launch agent/i }));
    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();
  });

  it("shows Home and Shared Knowledge actions in the collapsed rail", () => {
    const onOpenHome = vi.fn();
    const onOpenKnowledge = vi.fn();
    renderAgentList({ onOpenHome, onOpenKnowledge, knowledgeActive: true });

    const home = screen.getByRole("button", { name: "Home" });
    const sharedKnowledge = screen.getByRole("button", { name: "Shared Knowledge" });
    const dividers = document.querySelectorAll(".agents-roster-rail-divider");

    expect(dividers).toHaveLength(2);
    expect(dividers[0]).toHaveAttribute("aria-hidden", "true");
    expect(dividers[1]).toHaveAttribute("aria-hidden", "true");
    expect(dividers[0]).toHaveClass("my-2");
    expect(dividers[1]).toHaveClass("my-2");
    expect(document.querySelector(".agents-roster-rail-primary")).toHaveClass("gap-2");
    expect(document.querySelector(".agents-roster-rail-agents")).toHaveClass("gap-2");
    expect(sharedKnowledge).toHaveAttribute("aria-current", "page");
    expect(sharedKnowledge).toHaveClass("text-[var(--selection-accent)]");
    fireEvent.click(home);
    fireEvent.click(sharedKnowledge);
    expect(onOpenHome).toHaveBeenCalledOnce();
    expect(onOpenKnowledge).toHaveBeenCalledOnce();
  });

  it("hides only stopped agents from the collapsed rail by default", () => {
    renderAgentList({
      agents: [agent, stoppedAgent, failedAgent, startingAgent],
      selectedAgentId: stoppedAgent.id,
      syntheticThreads: [agent, stoppedAgent, failedAgent, startingAgent].map(agentThread),
    });

    expect(screen.getByRole("button", { name: "Select Test Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Stopped Agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Failed Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Starting Agent" })).toBeInTheDocument();
  });

  it("reorders agents directly from the collapsed rail", async () => {
    const agents = [agent, failedAgent, startingAgent];
    const setSelectedAgentId = vi.fn();
    renderAgentList({
      agents,
      setSelectedAgentId,
      syntheticThreads: agents.map(agentThread),
    });

    const startingHandle = screen.getByRole("button", { name: "Move Starting Agent" });
    fireEvent.click(startingHandle);
    expect(setSelectedAgentId).not.toHaveBeenCalled();
    fireEvent.keyDown(startingHandle, { key: "ArrowUp" });

    await waitFor(() => expect(
      screen.getAllByRole("button", { name: /^Select / }).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Select Test Agent",
      "Select Starting Agent",
      "Select Failed Agent",
    ]));
  });

  it("hides agent hover cards while a collapsed reorder handle is active", () => {
    const agents = [agent, failedAgent];
    renderAgentList({
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    const handle = screen.getByRole("button", { name: "Move Test Agent" });
    expect(screen.getAllByText("agent.example.com")).toHaveLength(2);

    fireEvent.pointerDown(handle);
    expect(screen.queryByText("agent.example.com")).not.toBeInTheDocument();

    fireEvent.pointerUp(handle);
    expect(screen.getAllByText("agent.example.com")).toHaveLength(2);
  });

  it("reveals offline agents from the expanded roster and remembers the choice when collapsed", async () => {
    const agents = [agent, stoppedAgent, failedAgent, startingAgent];
    const baseProps = createAgentListProps({
      sidebarCollapsed: false,
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    function Harness() {
      const [collapsed, setCollapsed] = useState(false);
      return <AgentList {...baseProps} sidebarCollapsed={collapsed} setSidebarCollapsed={setCollapsed} />;
    }
    renderWithClient(<Harness />);

    expect(screen.queryByText("Available Agents")).not.toBeInTheDocument();
    expect(screen.queryByText("Stopped Agent")).not.toBeInTheDocument();
    expect(screen.getAllByText("Failed Agent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Starting Agent").length).toBeGreaterThan(0);

    const showOffline = screen.getByRole("switch", { name: "Show offline agents" });
    expect(showOffline).toHaveAttribute("aria-checked", "false");
    expect(showOffline.parentElement).toHaveTextContent("Show Offline(1)");
    fireEvent.click(showOffline);

    expect(screen.getAllByText("Stopped Agent").length).toBeGreaterThan(0);
    expect(screen.getByRole("switch", { name: "Show offline agents" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Select Stopped Agent" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Expand agents sidebar" }));
    const hideOffline = await screen.findByRole("switch", { name: "Show offline agents" });
    expect(screen.getAllByText("Stopped Agent").length).toBeGreaterThan(0);
    fireEvent.click(hideOffline);
    await waitFor(() => expect(screen.queryAllByText("Stopped Agent")).toHaveLength(0));
  });

  it("keeps the selected stopped agent hidden until offline agents are shown", () => {
    renderAgentList({
      sidebarCollapsed: false,
      agents: [agent, stoppedAgent],
      selectedAgentId: stoppedAgent.id,
      syntheticThreads: [agent, stoppedAgent].map(agentThread),
    });

    expect(screen.queryByText("Stopped Agent")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show offline agents" })).toBeInTheDocument();
  });

  it("reorders agents from the drag handle without selecting them", async () => {
    const agents = [agent, failedAgent, startingAgent];
    const setSelectedAgentId = vi.fn();
    const baseProps = createAgentListProps({
      sidebarCollapsed: false,
      agents,
      setSelectedAgentId,
      syntheticThreads: agents.map(agentThread),
    });

    function Harness() {
      const [collapsed, setCollapsed] = useState(false);
      return <AgentList {...baseProps} sidebarCollapsed={collapsed} setSidebarCollapsed={setCollapsed} />;
    }
    renderWithClient(<Harness />);

    expect(screen.getAllByRole("button", { name: /^Move / }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Move Test Agent",
      "Move Failed Agent",
      "Move Starting Agent",
    ]);

    const startingHandle = screen.getByRole("button", { name: "Move Starting Agent" });
    fireEvent.click(startingHandle);
    expect(setSelectedAgentId).not.toHaveBeenCalled();
    fireEvent.keyDown(startingHandle, { key: "ArrowUp" });

    await waitFor(() => expect(
      screen.getAllByRole("button", { name: /^Move / }).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Move Test Agent",
      "Move Starting Agent",
      "Move Failed Agent",
    ]));

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    await waitFor(() => expect(
      screen.getAllByRole("button", { name: /^Select / }).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Select Test Agent",
      "Select Starting Agent",
      "Select Failed Agent",
    ]));
  });

  it("opens workspace settings from the agents sidebar account menu when provided", () => {
    const onOpenSettings = vi.fn();
    renderAgentList({ sidebarCollapsed: false, onOpenSettings });

    fireEvent.click(screen.getByRole("button", { name: /account/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /settings/i }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("shows sign out as the last account menu option", () => {
    const onLogout = vi.fn();
    renderAgentList({ sidebarCollapsed: false, onLogout });

    fireEvent.click(screen.getByRole("button", { name: /account/i }));
    const menuItems = screen.getAllByRole("menuitem");

    expect(menuItems.at(-1)).toHaveTextContent("Sign out");
    fireEvent.click(menuItems[menuItems.length - 1]);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

describe("AgentSettingsPanel", () => {
  it("renders the settings sidebar with general content", () => {
    renderAgentSettingsPanel();

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /settings sections/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Billing" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByText("Full Name")).toBeInTheDocument();
    expect(screen.getByDisplayValue("John Smith")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByDisplayValue("test@example.com")).toBeDisabled();
    expect(screen.getByText("Avatar")).toBeInTheDocument();
    expect(screen.getByText("Upload Image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "Agent Settings" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("John Smith"), { target: { value: "Jane Smith" } });
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByRole("button", { name: "Agent" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("heading", { name: "Profile" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent Settings" })).toBeInTheDocument();
    expect(screen.getByText("Display name")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Test Agent");
    expect(screen.getByText("Default model")).toBeInTheDocument();
    expect(screen.getByText("Visibility")).toBeInTheDocument();
    expect(screen.getByText("Auto-archive idle projects")).toBeInTheDocument();
    expect(screen.getByText("File source tabs")).toBeInTheDocument();
    expect(screen.getByText("Agent runtime")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop agent/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Danger Zone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start agent/i })).not.toBeInTheDocument();
  });

  it("toggles the local file source tabs setting without marking agent settings dirty", () => {
    const onShowFileSourceTabsChange = vi.fn();
    renderAgentSettingsPanel({ showFileSourceTabs: true, onShowFileSourceTabsChange });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const toggle = screen.getByRole("checkbox", { name: /show source tabs/i });

    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    expect(onShowFileSourceTabsChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("opens the delete confirmation from agent settings", () => {
    const onDeleteAgent = vi.fn();
    renderAgentSettingsPanel({ onDeleteAgent });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete agent" }));

    expect(onDeleteAgent).toHaveBeenCalledTimes(1);
  });

  it("renders the mobile settings header and horizontal section tabs", () => {
    const onOpenMobileMenu = vi.fn();
    const onSessionReturn = vi.fn();
    const onOpenAgentsMenu = vi.fn();
    renderAgentSettingsPanel({
      isDesktopViewport: false,
      onSessionReturn,
      onOpenAgentsMenu,
      onOpenMobileMenu,
      showSessionReturn: true,
      mobileReturnLabel: "Main Session",
    });

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /settings sections/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open main session/i }));
    expect(onSessionReturn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /open agents sidebar/i }));
    expect(onOpenAgentsMenu).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /open workspace sidebar/i }));
    expect(onOpenMobileMenu).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    expect(screen.getByRole("button", { name: "Team" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByText("Workspace members")).toBeInTheDocument();
  });

  it("signs out from general settings", () => {
    const onLogout = vi.fn();
    renderAgentSettingsPanel({ onLogout });

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("loads and saves the profile name through the SDK", async () => {
    const getToken = vi.fn(async () => "token");
    sdkMocks.userGet.mockResolvedValueOnce({
      userId: "user-1234567890abcdef",
      email: "test@example.com",
      name: "Server Name",
      isActive: true,
      createdAt: "2026-05-05T00:00:00Z",
    });
    sdkMocks.userUpdate.mockResolvedValueOnce({
      userId: "user-1234567890abcdef",
      email: "test@example.com",
      name: "Jane Smith",
      isActive: true,
      createdAt: "2026-05-05T00:00:00Z",
    });

    renderAgentSettingsPanel({ getToken });

    expect(await screen.findByDisplayValue("Server Name")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Server Name"), { target: { value: "Jane Smith" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(sdkMocks.userUpdate).toHaveBeenCalledWith({ name: "Jane Smith" });
    });
    expect(screen.getByText("Profile updated.")).toBeInTheDocument();
  });

  it("saves the display name through the agent name update callback", async () => {
    const onUpdateAgentName = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentName });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), { target: { value: "Renamed Agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentName).toHaveBeenCalledWith("agent-1", "Renamed Agent");
    });
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("saves the display name as the managed agent name", async () => {
    const onUpdateAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentProfile });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), {
      target: { value: "Marketing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentProfile).toHaveBeenCalledWith("agent-1", { name: "Marketing" });
    });
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("saves Docker image and user additional env while preserving managed launch env", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig, reportedChannelsReady: true });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(screen.getByRole("textbox", { name: "Agent Docker image" })).toHaveValue("ghcr.io/hypercli/hypercli-openclaw:prod");
    expect(screen.getByRole("textbox", { name: "Additional env" })).toHaveValue("FOO=bar\nHYPER_CUSTOM_FLAG=visible");
    expect(screen.queryByDisplayValue(/OPENCLAW_GATEWAY_TOKEN/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/HYPER_API_BASE/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/HYPER_WORKSPACES_BOOT_SYNC/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Agent Docker image" }), {
      target: { value: "ghcr.io/hypercli/hypercli-openclaw:custom" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Additional env" }), {
      target: { value: "FOO=baz\nCUSTOM_FLAG=1\nHYPER_CUSTOM_FLAG=edited" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", {
        image: "ghcr.io/hypercli/hypercli-openclaw:custom",
        env: {
          OPENCLAW_GATEWAY_TOKEN: "gateway-token",
          OPENCLAW_DESKTOP_ENABLED: "0",
          HYPER_API_BASE: "https://api.hypercli.com",
          HYPER_WORKSPACES_BOOT_SYNC: "1",
          HYPER_WORKSPACES_DIR: "/home/node/workspaces",
          HYPER_WORKSPACES_SYNC_READY_ONLY: "1",
          OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: "0",
          FOO: "baz",
          CUSTOM_FLAG: "1",
          HYPER_CUSTOM_FLAG: "edited",
        },
        routes: {
          openclaw: { port: 18789, auth: false, prefix: "" },
        },
        sync_root: "/home/node",
        sync_enabled: true,
        workspacesSync: {
          enabled: true,
          outputDir: "/home/node/workspaces",
          readyOnly: true,
          workspace: null,
        },
      });
    });
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("removes configured channels before saving a changed Docker image", async () => {
    const onSaveOpenClawConfig = vi.fn(async () => undefined);
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      onSaveOpenClawConfig,
      onUpdateAgentLaunchConfig,
      reportedChannelsReady: true,
      reportedChannels: [
        { channelId: "telegram", configured: true, healthState: "healthy" },
        { channelId: "discord", configured: false, healthState: "unknown" },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent Docker image" }), {
      target: { value: "ghcr.io/hypercli/hypercli-openclaw:custom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("dialog", { name: "Remove channels and change image?" })).toBeInTheDocument();
    expect(screen.getByText(/permanently removing setup for Telegram/i)).toBeInTheDocument();
    expect(onSaveOpenClawConfig).not.toHaveBeenCalled();
    expect(onUpdateAgentLaunchConfig).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove channels and save" }));

    await waitFor(() => {
      expect(onSaveOpenClawConfig).toHaveBeenCalledWith({ channels: null });
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledTimes(1);
    });
    expect(onSaveOpenClawConfig.mock.invocationCallOrder[0]).toBeLessThan(
      onUpdateAgentLaunchConfig.mock.invocationCallOrder[0],
    );
  });

  it("blocks Docker image changes until the live channel preflight succeeds", () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig, reportedChannelsReady: false });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent Docker image" }), {
      target: { value: "ghcr.io/hypercli/hypercli-openclaw:custom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText(/wait for its channels to load before changing the Docker image/i)).toBeInTheDocument();
    expect(onUpdateAgentLaunchConfig).not.toHaveBeenCalled();
  });

  it("lists OpenClaw models and saves the selected default model through config patch", async () => {
    const onSaveOpenClawConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onSaveOpenClawConfig });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const modelSelect = screen.getByRole("combobox", { name: "Default model" });

    expect(modelSelect).toHaveValue("openai/gpt-5-mini");
    expect(screen.getByRole("option", { name: "GPT-5 Mini (OpenAI)" })).toHaveValue("openai/gpt-5-mini");
    expect(screen.getByRole("option", { name: "Claude Sonnet 4.5 (Anthropic)" })).toHaveValue("anthropic/claude-sonnet-4-5");
    expect(screen.getByRole("option", { name: "Gemini 2.5 Pro (Google)" })).toHaveValue("google/gemini-2.5-pro");

    fireEvent.change(modelSelect, { target: { value: "google/gemini-2.5-pro" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onSaveOpenClawConfig).toHaveBeenCalledWith({
        agents: {
          defaults: {
            model: {
              primary: "google/gemini-2.5-pro",
            },
          },
        },
      });
    });
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("renders a blocked stopped runtime as startable instead of starting", () => {
    renderAgentSettingsPanel({
      agent: { ...agent, state: "STOPPED" },
      agentStarting: false,
      agentStartBlocked: true,
      agentStartBlockedReason: "Agent is finishing shutdown",
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    const startButton = screen.getByRole("button", { name: /start agent/i });
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveTextContent("Start agent");
    expect(screen.queryByText("Starting...")).not.toBeInTheDocument();
  });

  it("saves desktop and workspace launch settings as managed config", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable desktop route" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ready files only" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Shared knowledge sync directory" }), {
      target: { value: "/home/node/TeamWorkspaces" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Shared knowledge sync selection" }), {
      target: { value: "team-docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", expect.objectContaining({
        env: expect.objectContaining({
          OPENCLAW_DESKTOP_ENABLED: "1",
          HYPER_WORKSPACES_BOOT_SYNC: "1",
          HYPER_WORKSPACES_DIR: "/home/node/TeamWorkspaces",
          HYPER_WORKSPACES_SYNC_READY_ONLY: "0",
          HYPER_WORKSPACES_SYNC_WORKSPACE: "team-docs",
        }),
        routes: expect.objectContaining({
          openclaw: { port: 18789, auth: false, prefix: "" },
          desktop: { port: 3000, auth: true, prefix: "desktop" },
        }),
        workspacesSync: {
          enabled: true,
          outputDir: "/home/node/TeamWorkspaces",
          readyOnly: false,
          workspace: "team-docs",
        },
      }));
    });
  });

  it("removes the desktop route and persists a disabled desktop env flag", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        launchConfig: {
          ...agent.launchConfig,
          env: {
            ...(agent.launchConfig?.env as Record<string, string>),
            OPENCLAW_DESKTOP_ENABLED: "1",
          },
          routes: {
            ...(agent.launchConfig?.routes as Record<string, unknown>),
            desktop: { port: 3000, auth: true, prefix: "desktop" },
          },
        },
      },
      onUpdateAgentLaunchConfig,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByRole("checkbox", { name: "Enable desktop route" })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable desktop route" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", expect.objectContaining({
        env: expect.objectContaining({
          OPENCLAW_DESKTOP_ENABLED: "0",
        }),
        routes: {
          openclaw: { port: 18789, auth: false, prefix: "" },
        },
      }));
    });
  });

  it("rehydrates the desktop toggle from saved desktop launch config after refresh", () => {
    const initialAgent = {
      ...agent,
      launchConfig: {
        ...agent.launchConfig,
        env: {
          ...(agent.launchConfig?.env as Record<string, string>),
          OPENCLAW_DESKTOP_ENABLED: "0",
        },
      },
    };
    const refreshedAgent = {
      ...initialAgent,
      launchConfig: {
        ...initialAgent.launchConfig,
        env: {
          ...(initialAgent.launchConfig?.env as Record<string, string>),
          OPENCLAW_DESKTOP_ENABLED: "1",
        },
        routes: {
          ...(initialAgent.launchConfig?.routes as Record<string, unknown>),
          desktop: { port: 3000, auth: true, prefix: "desktop" },
        },
      },
    };
    const { rerender, props } = renderAgentSettingsPanel({ agent: initialAgent });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByRole("checkbox", { name: "Enable desktop route" })).not.toBeChecked();

    rerender(<AgentSettingsPanel {...props} agent={refreshedAgent} />);

    expect(screen.getByRole("checkbox", { name: "Enable desktop route" })).toBeChecked();
  });

  it("keeps the desktop toggle disabled when saved env disables a stale desktop route", () => {
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        launchConfig: {
          ...agent.launchConfig,
          env: {
            ...(agent.launchConfig?.env as Record<string, string>),
            OPENCLAW_DESKTOP_ENABLED: "0",
          },
          routes: {
            ...(agent.launchConfig?.routes as Record<string, unknown>),
            desktop: { port: 3000, auth: true, prefix: "desktop" },
          },
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(screen.getByRole("checkbox", { name: "Enable desktop route" })).not.toBeChecked();
  });

  it("renders usage when selected", () => {
    renderAgentSettingsPanel();

    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(screen.getByRole("button", { name: "Usage" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByText("Usage dashboard")).toBeInTheDocument();
    expect(screen.getByText("API keys")).toBeInTheDocument();
  });

  it("saves memory index settings through an OpenClaw config patch and syncs launch env", async () => {
    const onSaveOpenClawConfig = vi.fn(async () => undefined);
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onSaveOpenClawConfig, onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Index" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sync on session start" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sync on search" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Watch memory files" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Watch debounce seconds" }), {
      target: { value: "60" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Interval sync minutes" }), {
      target: { value: "120" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onSaveOpenClawConfig).toHaveBeenCalledWith({
        agents: {
          defaults: {
            memorySearch: {
              enabled: true,
              sync: {
                onSessionStart: true,
                onSearch: true,
                watch: true,
                watchDebounceMs: 60000,
                intervalMinutes: 120,
              },
            },
          },
        },
      });
    });
    expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", {
      image: "ghcr.io/hypercli/hypercli-openclaw:prod",
      env: {
        OPENCLAW_GATEWAY_TOKEN: "gateway-token",
        OPENCLAW_DESKTOP_ENABLED: "0",
        HYPER_API_BASE: "https://api.hypercli.com",
        HYPER_WORKSPACES_BOOT_SYNC: "1",
        HYPER_WORKSPACES_DIR: "/home/node/workspaces",
        HYPER_WORKSPACES_SYNC_READY_ONLY: "1",
        OPENCLAW_MEMORY_SEARCH_ENABLED: "1",
        OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START: "1",
        OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH: "1",
        OPENCLAW_MEMORY_SEARCH_SYNC_WATCH: "1",
        OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS: "60000",
        OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: "120",
        FOO: "bar",
        HYPER_CUSTOM_FLAG: "visible",
      },
      routes: {
        openclaw: { port: 18789, auth: false, prefix: "" },
      },
      sync_root: "/home/node",
      sync_enabled: true,
      workspacesSync: {
        enabled: true,
        outputDir: "/home/node/workspaces",
        readyOnly: true,
        workspace: null,
      },
    });
  });

  it("blocks memory index saves when launch config updates are unavailable", async () => {
    const onSaveOpenClawConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onSaveOpenClawConfig, onUpdateAgentLaunchConfig: undefined });

    fireEvent.click(screen.getByRole("button", { name: "Index" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Watch memory files" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Runtime launch updates are unavailable.")).toBeInTheDocument();
    expect(onSaveOpenClawConfig).not.toHaveBeenCalled();
  });
});

describe("ErrorBanner", () => {
  it("renders capacity errors with inventory and a plan catalog CTA", () => {
    const onOpenPlanCatalog = vi.fn();

    render(
      <ErrorBanner
        error="API Error 429: No available 'large' entitlement slots. Requested tier inventory: 1 free / 2 total (used 1). Available slots on this account: large 1 free / 2 total, medium 0 free / 0 total, small 0 free / 0 total. Stop an existing agent or purchase more capacity."
        onDismiss={vi.fn()}
        onOpenPlanCatalog={onOpenPlanCatalog}
      />,
    );

    expect(screen.getByText("Large capacity unavailable")).toBeInTheDocument();
    expect(screen.getByText("Requested 1 free / 2 total")).toBeInTheDocument();
    expect(screen.getByText("large: 1 free / 2 total")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add capacity/i }));

    expect(onOpenPlanCatalog).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No available 'large' entitlement slots/)).not.toBeInTheDocument();
  });
});
