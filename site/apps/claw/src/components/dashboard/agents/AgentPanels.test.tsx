import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "@/app/dashboard/agents/types";
import { AGENT_ROSTER_ORDER_STORAGE_KEY } from "@/hooks/useAgentRosterOrder";
import { renderWithClient } from "@/test/utils";

const clipboardMocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(async () => true),
}));

vi.mock("./FirstAgentSetupWizard", () => ({
  FirstAgentSetupWizard: ({ onCreateAgent }: {
    onCreateAgent: (params: {
      name: string;
      iconIndex: number;
      size: "small";
      files: [];
      enableDesktop: boolean;
    }) => Promise<string | null>;
  }) => (
    <div>
      <div>First agent setup wizard</div>
      <button
        type="button"
        onClick={() => { void onCreateAgent({
          name: "Created Agent",
          iconIndex: 0,
          size: "small",
          files: [],
          enableDesktop: false,
        }); }}
      >
        Finish setup
      </button>
    </div>
  ),
}));

vi.mock("@hypercli/shared-ui", () => ({
  Button: ({ children, ...props }: ComponentProps<"button">) => <button {...props}>{children}</button>,
  HyperCLILogo: ({ className }: { className?: string }) => <div aria-hidden="true" className={className} />,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
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
  writeClipboardText: clipboardMocks.writeClipboardText,
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

import { AgentList, AgentSettingsPanel, ErrorBanner, LaunchFirstAgentEmptyState } from "./AgentPanels";

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
  managed: true,
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
  const displayName = item.displayName?.trim() || item.name;
  return {
    id: item.id,
    sessionKey: item.id,
    participants: [{ id: item.id, name: displayName, type: "agent" as const }],
    kind: "user-agent" as const,
    title: displayName,
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
    associateCreatedAgent: vi.fn(async () => undefined),
    fetchAgents: vi.fn(),
    setError: vi.fn(),
    sidebarCreatorSignal: 0,
    setPendingAgentDelete: vi.fn(),
    updateAgentDisplayName: vi.fn(),
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

describe("LaunchFirstAgentEmptyState", () => {
  it("delegates launch requests to the page-owned launcher", () => {
    const onCreate = vi.fn();

    render(<LaunchFirstAgentEmptyState onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: /^Create an agent/ }));
    expect(onCreate).toHaveBeenCalledOnce();
    expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument();
  });

  it("replaces the blocked agent action with a friendly Workspace setup CTA", () => {
    const onCreate = vi.fn();
    const onCreateWorkspace = vi.fn();

    render(
      <LaunchFirstAgentEmptyState
        onCreate={onCreate}
        creationDisabledReason="Select a Workspace before launching an agent."
        onCreateWorkspace={onCreateWorkspace}
      />,
    );

    const createWorkspace = screen.getByRole("button", { name: /create your first workspace/i });
    expect(createWorkspace).toBeEnabled();
    expect(screen.getByText("One quick step, then you can launch your first agent.")).toBeInTheDocument();
    expect(screen.queryByText("Select a Workspace before launching an agent.")).not.toBeInTheDocument();

    fireEvent.click(createWorkspace);
    expect(onCreateWorkspace).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("keeps the selection guard when Workspaces exist but none is selected", () => {
    render(
      <LaunchFirstAgentEmptyState
        onCreate={vi.fn()}
        creationDisabledReason="Select a Workspace before launching an agent."
      />,
    );

    expect(screen.getByRole("button", { name: /^Create an agent/ })).toBeDisabled();
    expect(screen.getAllByText("Select a Workspace before launching an agent.").length).toBeGreaterThan(0);
  });
});

describe("AgentList", () => {
  it("does not render the desktop agents/channels sidebar below the desktop breakpoint", () => {
    renderAgentList({ isDesktopViewport: false });

    expect(screen.queryByRole("button", { name: /select test agent/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /launch agent/i })).not.toBeInTheDocument();
  });

  it("renders the shared collapsed rail when mobile navigation requests it", () => {
    const props = renderAgentList({ isDesktopViewport: false, renderMobileNavigation: true });

    expect(screen.getByRole("button", { name: "Select Test Agent" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand agents sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(false);
  });

  it("delegates mobile navigation launch requests without opening an out-of-sheet portal", () => {
    const onOpenAgentLauncher = vi.fn();
    renderAgentList({
      isDesktopViewport: false,
      renderMobileNavigation: true,
      onOpenAgentLauncher,
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    expect(onOpenAgentLauncher).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument();
  });

  it("lets the expanded mobile agents pane return to the workspace pane", () => {
    const props = renderAgentList({
      sidebarCollapsed: false,
      isDesktopViewport: false,
      renderMobileNavigation: true,
      embeddedInNavigation: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it("keeps the agents/channels sidebar collapsed until the explicit expand control is used", () => {
    const props = renderAgentList();
    const shell = document.querySelector(".agents-roster-shell");

    expect(shell).toHaveClass("w-12");
    expect(shell).not.toHaveClass("w-52");

    fireEvent.click(screen.getByRole("button", { name: /select test agent/i }));
    expect(props.setSidebarCollapsed).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Expand agents sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(false);
  });

  it("only collapses the expanded agents/channels sidebar from its explicit collapse control", () => {
    const props = renderAgentList({ sidebarCollapsed: false });
    const shell = document.querySelector(".agents-roster-shell");

    expect(shell).toHaveClass("w-52");
    expect(shell).not.toHaveClass("w-12");

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it("shows the offline-agent toggle inside the shared navigation body", () => {
    const agents = [agent, stoppedAgent];
    const props = renderAgentList({
      sidebarCollapsed: false,
      embeddedInNavigation: true,
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    expect(document.querySelector(".agents-roster-header")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show offline agents" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("heading", { name: "Agents" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it("keeps every compact action available in the embedded collapsed rail", () => {
    renderAgentList({ embeddedInNavigation: true });

    expect(document.querySelector(".agents-roster-header")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand agents sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Test Agent" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch agent" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Shared Knowledge" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account links" })).toBeInTheDocument();
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

  it("closes the launcher after a delegated creation succeeds", async () => {
    const onCreateAgent = vi.fn(async () => "created-agent");
    renderAgentList({ sidebarCollapsed: false, onCreateAgent });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument());
    expect(onCreateAgent).toHaveBeenCalledOnce();
  });

  it("associates a created agent before selecting it", async () => {
    const operations: string[] = [];
    const createOpenClawAgent = vi.fn(async () => {
      operations.push("create");
      return { id: "created-agent" };
    });
    const associateCreatedAgent = vi.fn(async () => {
      operations.push("associate");
    });
    const fetchAgents = vi.fn(async () => {
      operations.push("refresh");
    });
    const setSelectedAgentId = vi.fn();
    renderAgentList({
      sidebarCollapsed: false,
      createOpenClawAgent,
      associateCreatedAgent,
      fetchAgents,
      setSelectedAgentId,
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(setSelectedAgentId).toHaveBeenCalledWith("created-agent"));
    expect(associateCreatedAgent).toHaveBeenCalledWith("created-agent");
    expect(operations).toEqual(["create", "associate", "refresh"]);
  });

  it("does not select an agent when Workspace association fails", async () => {
    const setSelectedAgentId = vi.fn();
    const setError = vi.fn();
    renderAgentList({
      sidebarCollapsed: false,
      associateCreatedAgent: vi.fn(async () => { throw new Error("Roster refresh failed"); }),
      setSelectedAgentId,
      setError,
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(setError).toHaveBeenCalledWith(
      "Agent was created, but Workspace association did not complete: Roster refresh failed",
    ));
    expect(setSelectedAgentId).not.toHaveBeenCalled();
  });

  it("does not select an associated agent when the account roster cannot refresh", async () => {
    const setSelectedAgentId = vi.fn();
    const setError = vi.fn();
    const associateCreatedAgent = vi.fn(async () => undefined);
    renderAgentList({
      sidebarCollapsed: false,
      associateCreatedAgent,
      fetchAgents: vi.fn(async () => false),
      setSelectedAgentId,
      setError,
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(setError).toHaveBeenCalledWith(
      "Agent was created and added to the selected Workspace, but agents could not be refreshed.",
    ));
    expect(associateCreatedAgent).toHaveBeenCalledWith("created-agent");
    expect(setSelectedAgentId).not.toHaveBeenCalled();
  });

  it("blocks launch entry points without Workspace admin access", async () => {
    const props = renderAgentList({
      sidebarCollapsed: false,
      sidebarCreatorSignal: 1,
      agentCreationDisabledReason: "Workspace admin access is required to add agents.",
    });

    const launch = screen.getByRole("button", { name: "Launch agent" });
    expect(launch).toBeDisabled();
    expect(screen.getByText("Workspace admin access is required to add agents.")).toBeInTheDocument();
    await waitFor(() => expect(props.setError).toHaveBeenCalledWith("Workspace admin access is required to add agents."));
    expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument();
  });

  it("shows a loading status instead of stale Workspace agents", () => {
    renderAgentList({ rosterLoading: true });

    expect(document.querySelector(".agents-roster-shell")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading Workspace agents");
    expect(screen.queryByRole("button", { name: "Select Test Agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch agent" })).toBeDisabled();
  });

  it("opens a signaled launcher after temporary roster loading finishes", async () => {
    const props = createAgentListProps({ sidebarCollapsed: false, rosterLoading: true, sidebarCreatorSignal: 1 });
    const view = renderWithClient(<AgentList {...props} />);

    expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument();
    view.rerender(<AgentList {...props} rosterLoading={false} />);

    expect(await screen.findByText("First agent setup wizard")).toBeInTheDocument();
  });

  it("keeps the launcher mounted while a higher-priority flow is active", async () => {
    const props = createAgentListProps({
      sidebarCollapsed: false,
      sidebarCreatorSignal: 1,
      agentLauncherSuspended: true,
    });
    const view = renderWithClient(<AgentList {...props} />);

    const overlay = await screen.findByTestId("agent-launcher-overlay");
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay).toHaveClass("invisible", "pointer-events-none");
    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();

    view.rerender(<AgentList {...props} agentLauncherSuspended={false} />);
    expect(overlay).not.toHaveAttribute("aria-hidden");
    expect(overlay).not.toHaveClass("invisible", "pointer-events-none");
    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();
  });

  it("keeps a query-triggered agent launcher closed after dismissal", async () => {
    renderAgentList({ sidebarCollapsed: false, sidebarCreatorSignal: 1 });

    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close launch agent" }));
    await waitFor(() => expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument());
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
    expect(document.querySelector(".agents-roster-expanded .agents-roster-header")).toHaveClass("bg-background");
    expect(document.querySelector(".agents-roster-expanded .agents-roster-scroll")).toHaveClass("bg-[var(--agent-roster-background)]");
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

    expect(screen.getAllByText("Marketing")).not.toHaveLength(0);
    expect(screen.getAllByText((_, element) => (
      element?.tagName === "P" && element.textContent === "Connected"
    ))).not.toHaveLength(0);
    expect(screen.queryByText("Test Agent: Connected")).not.toBeInTheDocument();
    expect(screen.queryByText(/rapid-forge-engine/)).not.toBeInTheDocument();
  });

  it("routes an inline roster rename through the display-name callback", async () => {
    const displayAgent: Agent = {
      ...agent,
      name: "rapid-forge-engine",
      displayName: "Marketing",
    };
    const updateAgentDisplayName = vi.fn(async () => undefined);
    const fetchAgents = vi.fn();
    renderAgentList({
      sidebarCollapsed: false,
      agents: [displayAgent],
      syntheticThreads: [agentThread(displayAgent)],
      updateAgentDisplayName,
      fetchAgents,
    });

    fireEvent.click(screen.getByRole("button", { name: "Rename agent" }));
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("Marketing");
    fireEvent.change(input, { target: { value: "Growth" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(updateAgentDisplayName).toHaveBeenCalledWith(displayAgent.id, "Growth"));
    expect(fetchAgents).not.toHaveBeenCalled();
  });

  it("shows the launch agent button in the collapsed rail", () => {
    renderAgentList();

    fireEvent.click(screen.getByRole("button", { name: /launch agent/i }));
    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();
    const overlay = screen.getByTestId("agent-launcher-overlay");
    expect(screen.getByTestId("agent-launcher-dialog")).toHaveClass(
      "h-[min(840px,calc(100dvh-1.5rem))]",
      "w-[min(1280px,calc(100vw-1.5rem))]",
    );
    expect(document.body).toContainElement(overlay);
    expect(document.querySelector(".agents-roster-shell")).not.toContainElement(overlay);
  });

  it("shows Home and Administration actions in the collapsed rail", () => {
    const onOpenHome = vi.fn();
    const onOpenKnowledge = vi.fn();
    const onOpenMembers = vi.fn();
    const onOpenUsage = vi.fn();
    const onOpenAccountSettings = vi.fn();
    renderAgentList({
      onOpenHome,
      onOpenKnowledge,
      onOpenMembers,
      onOpenUsage,
      onOpenAccountSettings,
      homeActive: true,
      knowledgeActive: true,
      usageActive: true,
      accountSettingsActive: true,
    });

    const home = screen.getByRole("button", { name: "Home" });
    const sharedKnowledge = screen.getByRole("button", { name: "Shared Knowledge" });
    const members = screen.getByRole("button", { name: "Members" });
    const usage = screen.getByRole("button", { name: "Usage" });
    const settings = screen.getByRole("button", { name: "Settings" });
    const dividers = document.querySelectorAll(".agents-roster-rail-divider");

    expect(dividers).toHaveLength(2);
    expect(dividers[0]).toHaveAttribute("aria-hidden", "true");
    expect(dividers[1]).toHaveAttribute("aria-hidden", "true");
    expect(dividers[0]).toHaveClass("my-2");
    expect(dividers[1]).toHaveClass("my-2");
    expect(document.querySelector(".agents-roster-rail .agents-roster-scroll")).toHaveClass("flex-col", "overflow-hidden");
    expect(document.querySelector(".agents-roster-rail-primary")).toHaveClass("shrink-0", "gap-2");
    expect(document.querySelector(".agents-roster-rail-agents")).toHaveClass("w-full", "shrink", "overflow-y-auto", "py-1");
    expect(home).toHaveAttribute("aria-current", "page");
    expect(home).toHaveClass("text-[var(--selection-accent)]");
    expect(sharedKnowledge).toHaveAttribute("aria-current", "page");
    expect(sharedKnowledge).toHaveClass("text-[var(--selection-accent)]");
    expect(usage).toHaveAttribute("aria-current", "page");
    expect(usage).toHaveClass("text-[var(--selection-accent)]");
    expect(settings).toHaveAttribute("aria-current", "page");
    fireEvent.click(home);
    fireEvent.click(sharedKnowledge);
    fireEvent.click(members);
    fireEvent.click(usage);
    fireEvent.click(settings);
    expect(onOpenHome).toHaveBeenCalledOnce();
    expect(onOpenKnowledge).toHaveBeenCalledOnce();
    expect(onOpenMembers).toHaveBeenCalledOnce();
    expect(onOpenUsage).toHaveBeenCalledOnce();
    expect(onOpenAccountSettings).toHaveBeenCalledOnce();
  });

  it("shows stopped agents in the collapsed rail by default", () => {
    renderAgentList({
      agents: [agent, stoppedAgent, failedAgent, startingAgent],
      selectedAgentId: stoppedAgent.id,
      syntheticThreads: [agent, stoppedAgent, failedAgent, startingAgent].map(agentThread),
    });

    expect(screen.getByRole("button", { name: "Select Test Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Stopped Agent" })).toBeInTheDocument();
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
    expect(startingHandle.parentElement).toHaveClass("w-8");
    expect(startingHandle).toHaveClass("-left-2");
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

  it("persists reordered agents across remounts", async () => {
    const agents = [agent, failedAgent, startingAgent];
    const props = createAgentListProps({
      agents,
      syntheticThreads: agents.map(agentThread),
    });
    const first = renderWithClient(<AgentList {...props} />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Move Starting Agent" }), { key: "ArrowUp" });

    await waitFor(() => expect(
      screen.getAllByRole("button", { name: /^Select / }).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Select Test Agent",
      "Select Starting Agent",
      "Select Failed Agent",
    ]));
    expect(JSON.parse(window.localStorage.getItem(AGENT_ROSTER_ORDER_STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      agentIds: [agent.id, startingAgent.id, failedAgent.id],
    });

    first.unmount();
    renderWithClient(<AgentList {...props} />);

    expect(screen.getAllByRole("button", { name: /^Select / }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Select Test Agent",
      "Select Starting Agent",
      "Select Failed Agent",
    ]);
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

  it("shows offline agents by default and remembers when they are hidden", async () => {
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
    expect(screen.getAllByText("Stopped Agent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed Agent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Starting Agent").length).toBeGreaterThan(0);

    const hideOffline = screen.getByRole("switch", { name: "Show offline agents" });
    expect(hideOffline).toHaveAttribute("aria-checked", "true");
    expect(hideOffline.parentElement).toHaveTextContent("Show Offline(1)");
    fireEvent.click(hideOffline);

    await waitFor(() => expect(screen.queryAllByText("Stopped Agent")).toHaveLength(0));
    expect(screen.getByRole("switch", { name: "Show offline agents" })).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    const expandSidebar = await screen.findByRole("button", { name: "Expand agents sidebar" });
    expect(screen.queryByRole("button", { name: "Select Stopped Agent" })).not.toBeInTheDocument();
    fireEvent.click(expandSidebar);
    const showOffline = await screen.findByRole("switch", { name: "Show offline agents" });
    expect(screen.queryByText("Stopped Agent")).not.toBeInTheDocument();
    fireEvent.click(showOffline);
    expect(screen.getAllByText("Stopped Agent").length).toBeGreaterThan(0);

    renderWithClient(<AgentList {...baseProps} sidebarCollapsed={false} setSidebarCollapsed={vi.fn()} />);
    expect(screen.getAllByRole("switch", { name: "Show offline agents" }).at(-1)).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getAllByRole("switch", { name: "Show offline agents" }).at(-1)!);
    renderWithClient(<AgentList {...baseProps} sidebarCollapsed={false} setSidebarCollapsed={vi.fn()} />);
    expect(screen.getAllByRole("switch", { name: "Show offline agents" }).at(-1)).toHaveAttribute("aria-checked", "false");
  });

  it("shows a selected stopped agent by default", () => {
    renderAgentList({
      sidebarCollapsed: false,
      agents: [agent, stoppedAgent],
      selectedAgentId: stoppedAgent.id,
      syntheticThreads: [agent, stoppedAgent].map(agentThread),
    });

    expect(screen.getAllByText("Stopped Agent").length).toBeGreaterThan(0);
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

  it("links to user settings from Administration instead of the expanded account menu", () => {
    const onOpenSettings = vi.fn();
    renderAgentList({ sidebarCollapsed: false, onOpenSettings });

    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/dashboard/agents?view=settings");
    expect(onOpenSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /account/i }));
    expect(screen.queryByRole("menuitem", { name: /^Settings$/i })).not.toBeInTheDocument();
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

  it("shows a sign-in action instead of private account links for anonymous visitors", () => {
    const onLogin = vi.fn();
    renderAgentList({ sidebarCollapsed: false, onLogin, onLogout: undefined });

    fireEvent.click(screen.getByRole("button", { name: /account/i }));

    expect(screen.getByRole("menuitem", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "API Keys" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign in" }));
    expect(onLogin).toHaveBeenCalledTimes(1);
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
    expect(screen.getByText("User UUID")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "User UUID" })).toHaveValue("user-1234567890abcdef");
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
    expect(screen.getByText("Agent name")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Agent name" })).toHaveValue("Test Agent");
    expect(screen.getByText("Display name")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Test Agent");
    expect(screen.getByRole("textbox", { name: "Agent display name" })).not.toHaveAttribute("readonly");
    expect(screen.getByText(/saved only in this browser/i)).toBeInTheDocument();
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

  it("renders the mobile settings section tabs without duplicate header controls", () => {
    renderAgentSettingsPanel({
      isDesktopViewport: false,
    });

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /settings sections/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open agents sidebar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open workspace sidebar/i })).not.toBeInTheDocument();

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

  it("copies the resolved account UUID from general settings", async () => {
    renderAgentSettingsPanel({
      getToken: vi.fn(async () => "token"),
      user: {
        id: "did:privy:account-login-id",
        email: "test@example.com",
        name: "John Smith",
      },
    });

    await waitFor(() => expect(screen.getByRole("textbox", { name: "User UUID" })).toHaveValue("user-1234567890abcdef"));
    fireEvent.click(screen.getByRole("button", { name: "Copy user UUID" }));

    await waitFor(() => expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith("user-1234567890abcdef"));
    expect(screen.getByRole("button", { name: "User UUID copied" })).toHaveTextContent("Copied");
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

  it("saves the managed agent name independently from its local display name", async () => {
    const onUpdateAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentProfile });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent name" }), { target: { value: "Renamed Agent" } });
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Test Agent");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentProfile).toHaveBeenCalledWith("agent-1", { name: "Renamed Agent" });
    });
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("preserves unsaved settings when the selected agent display name changes", async () => {
    const initialAgent = { ...agent, displayName: "Research Pilot" };
    const { props, rerender } = renderAgentSettingsPanel({ agent: initialAgent });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent name" }), {
      target: { value: "Unsaved canonical name" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Additional env" }), {
      target: { value: "CUSTOM_FLAG=unsaved" },
    });

    rerender(<AgentSettingsPanel {...props} agent={{ ...initialAgent, displayName: "Marketing" }} />);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Marketing");
    });
    expect(screen.getByRole("textbox", { name: "Agent name" })).toHaveValue("Unsaved canonical name");
    expect(screen.getByRole("textbox", { name: "Additional env" })).toHaveValue("CUSTOM_FLAG=unsaved");
  });

  it("treats unknown management provenance as managed", async () => {
    const onSetManagedAgentDisplayName = vi.fn(async () => undefined);
    const onUpdateExternalAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: { ...agent, managed: null },
      onSetManagedAgentDisplayName,
      onUpdateExternalAgentProfile,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), { target: { value: "Local Alias" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onSetManagedAgentDisplayName).toHaveBeenCalledWith("agent-1", "Local Alias");
    });
    expect(onUpdateExternalAgentProfile).not.toHaveBeenCalled();
  });

  it("clears a managed local display name back to its agent name", async () => {
    const onSetManagedAgentDisplayName = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: { ...agent, displayName: "Research Pilot" },
      onSetManagedAgentDisplayName,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onSetManagedAgentDisplayName).toHaveBeenCalledWith("agent-1", null);
    });
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Test Agent");
  });

  it("does not report a successful managed display-name save when local updates are unavailable", async () => {
    renderAgentSettingsPanel({
      agent: { ...agent, displayName: "Research Pilot" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), {
      target: { value: "Marketing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Local display name updates are unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("Agent settings updated.")).not.toBeInTheDocument();
  });

  it("saves an external display name without changing its agent name", async () => {
    const onUpdateExternalAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        id: "external-1",
        name: "research-agent",
        displayName: "Research Pilot",
        managed: false,
      },
      onUpdateExternalAgentProfile,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByRole("textbox", { name: "Agent name" })).toHaveValue("research-agent");
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Research Pilot");
    expect(screen.getByRole("textbox", { name: "Agent display name" })).not.toHaveAttribute("readonly");
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), {
      target: { value: "Marketing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateExternalAgentProfile).toHaveBeenCalledWith("external-1", { displayName: "Marketing" });
    });
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("clears an external display name back to its agent name", async () => {
    const onUpdateExternalAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        id: "external-1",
        name: "research-agent",
        displayName: "Research Pilot",
        managed: false,
      },
      onUpdateExternalAgentProfile,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateExternalAgentProfile).toHaveBeenCalledWith("external-1", { displayName: null });
    });
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("research-agent");
  });

  it("saves Docker image and user additional env while preserving managed launch env", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig, reportedChannelsReady: true });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(screen.queryByRole("textbox", { name: "Agent Docker image" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Agent Docker image", hidden: true })).toHaveValue("ghcr.io/hypercli/hypercli-openclaw:prod");
    expect(screen.getByRole("textbox", { name: "Additional env" })).toHaveValue("FOO=bar\nHYPER_CUSTOM_FLAG=visible");
    expect(screen.queryByDisplayValue(/OPENCLAW_GATEWAY_TOKEN/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/HYPER_API_BASE/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/HYPER_WORKSPACES_BOOT_SYNC/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Agent Docker image", hidden: true }), {
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
    fireEvent.change(screen.getByRole("textbox", { name: "Agent Docker image", hidden: true }), {
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
    fireEvent.change(screen.getByRole("textbox", { name: "Agent Docker image", hidden: true }), {
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
