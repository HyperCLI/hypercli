import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "@/app/dashboard/agents/types";
import { AGENT_ROSTER_ORDER_STORAGE_KEY } from "@/hooks/useAgentRosterOrder";
import { renderWithClient } from "@/test/utils";

const clipboardMocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(async () => true),
}));

vi.mock("./FirstAgentSetupWizard", () => ({
  FirstAgentSetupWizard: ({ onCreateAgent, onClose }: {
    onCreateAgent: (params: {
      name: string;
      iconIndex: number;
      size: "small";
      files: Array<{
        name: string;
        size: number;
        type: string;
        arrayBuffer: () => Promise<ArrayBuffer>;
      }>;
      enableDesktop: boolean;
      knowledgeCollectionId: string | null;
    }) => Promise<string | null>;
    onClose?: () => void;
  }) => (
    <div>
      <div>First agent setup wizard</div>
      {onClose ? <button type="button" onClick={onClose}>Close agent creation</button> : null}
      <button
        type="button"
        onClick={() => { void onCreateAgent({
          name: "Created Agent",
          iconIndex: 0,
          size: "small",
          files: [],
          enableDesktop: false,
          knowledgeCollectionId: "knowledge-collection-1",
        }); }}
      >
        Finish setup
      </button>
      <button
        type="button"
        onClick={() => { void onCreateAgent({
          name: "Created Agent",
          iconIndex: 0,
          size: "small",
          files: [{
            name: "AGENTS.md",
            size: 8,
            type: "text/markdown",
            arrayBuffer: async () => new TextEncoder().encode("# Agent\n").buffer as ArrayBuffer,
          }],
          enableDesktop: false,
          knowledgeCollectionId: null,
        }); }}
      >
        Finish setup with starter files
      </button>
    </div>
  ),
}));

vi.mock("@hypercli/shared-ui", () => ({
  Button: ({ children, asChild, ...props }: ComponentProps<"button"> & { asChild?: boolean }) => (
    asChild ? <>{children}</> : <button {...props}>{children}</button>
  ),
  HyperCLILogo: ({ className }: { className?: string }) => <div aria-hidden="true" className={className} />,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  ThemeSelector: () => <div>Theme</div>,
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
  userGetProfileImage: vi.fn(),
  userUploadProfileImage: vi.fn(),
  userDeleteProfileImage: vi.fn(),
}));

const agentClientMocks = vi.hoisted(() => ({
  waitForCreatedAgentStopped: vi.fn(async (client: { waitForState: (...args: unknown[]) => Promise<unknown> }, created: { id: string }) => (
    client.waitForState(created.id, ["STOPPED"])
  )),
  createAgentClient: vi.fn(() => ({
    fileWriteBytes: vi.fn(async () => undefined),
    waitForState: vi.fn(async () => ({ id: "created-agent", state: "STOPPED" })),
    start: vi.fn(async () => ({ state: "RUNNING", waitRunning: vi.fn(async () => undefined) })),
  })),
}));

vi.mock("@hypercli.com/sdk/browser", () => ({
  BrowserHyperCLI: vi.fn(function BrowserHyperCLI() {
    return {
      user: {
        get: sdkMocks.userGet,
        update: sdkMocks.userUpdate,
        getProfileImage: sdkMocks.userGetProfileImage,
        uploadProfileImage: sdkMocks.userUploadProfileImage,
        deleteProfileImage: sdkMocks.userDeleteProfileImage,
      },
    };
  }),
}));

vi.mock("@/lib/agent-client", () => ({
  createAgentClient: agentClientMocks.createAgentClient,
  waitForCreatedAgentStopped: agentClientMocks.waitForCreatedAgentStopped,
  hostedSlackLaunchEnv: vi.fn(() => ({
    HYPER_SLACK_APP_ENABLED: "1",
    HYPER_SLACK_RELAY_URL: "wss://api.hypercli.com/slack/ws",
    HYPER_SLACK_API_URL: "https://api.hypercli.com/slack/api/",
  })),
  createBrowserHyperCLIClient: vi.fn(() => ({
    user: {
      get: sdkMocks.userGet,
      update: sdkMocks.userUpdate,
      getProfileImage: sdkMocks.userGetProfileImage,
      uploadProfileImage: sdkMocks.userUploadProfileImage,
      deleteProfileImage: sdkMocks.userDeleteProfileImage,
    },
  })),
}));

import { AgentDesktopEmptyState, AgentEmptyState, AgentList, AgentSettingsPanel, ErrorBanner, LaunchFirstAgentEmptyState } from "./AgentPanels";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
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
  sdkMocks.userGetProfileImage.mockResolvedValue({
    id: "user-1234567890abcdef",
    avatarUrl: null,
    s3Key: null,
  });
  sdkMocks.userUploadProfileImage.mockResolvedValue({
    id: "user-1234567890abcdef",
    avatarUrl: "https://cdn.example.test/account.png",
    s3Key: "prod/user-1234567890abcdef/user-1234567890abcdef.png",
  });
  sdkMocks.userDeleteProfileImage.mockResolvedValue({
    id: "user-1234567890abcdef",
    avatarUrl: null,
    s3Key: null,
  });
  agentClientMocks.createAgentClient.mockReturnValue({
    fileWriteBytes: vi.fn(async () => undefined),
    waitForState: vi.fn(async () => ({ id: "created-agent", state: "STOPPED" })),
    start: vi.fn(async () => ({ state: "RUNNING", waitRunning: vi.fn(async () => undefined) })),
  });
});

const agent: Agent = {
  id: "agent-1",
  name: "Test Agent",
  managed: true,
  isLaunchable: true,
  user_id: "user-1",
  state: "RUNNING",
  cpu_millicores: 4000,
  memory_mib: 4096,
  hostname: "agent.example.com",
  started_at: "2026-05-05T00:00:00Z",
  stopped_at: null,
  archived_at: null,
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
  launchEpoch: 0,
  clusterId: null,
  launchConfig: {
    image: "ghcr.io/hypercli/hypercli-openclaw:prod",
    env: {
      OPENCLAW_DESKTOP_ENABLED: "0",
      HYPER_API_BASE: "https://api.hypercli.com",
      HYPER_WORKSPACES_BOOT_SYNC: "1",
      HYPER_WORKSPACES_DIR: "/home/node/shared",
      HYPER_WORKSPACES_SYNC_READY_ONLY: "1",
      OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: "0",
      FOO: "bar",
      HYPER_CUSTOM_FLAG: "visible",
    },
    routes: {
      openclaw: { port: 18789, auth: false, prefix: "" },
    },
    sync_root: "/home/node",
    sync_uid: 1000,
    sync_gid: 1000,
  },
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
    expect(screen.getByTestId("agent-launch-entry")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Launch your first agent" })).toHaveClass("whitespace-nowrap");
    expect(screen.queryByText(/Every plan starts with a 7-day free trial/)).not.toBeInTheDocument();
    expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument();
  });

  it("does not expose an anonymous draft in the authenticated empty state", () => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      name: "private-draft",
      iconIndex: 0,
      category: "General",
      plan: "pro",
    }));

    render(<LaunchFirstAgentEmptyState onCreate={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Launch your first agent" })).toBeInTheDocument();
    expect(screen.queryByText("private-draft")).not.toBeInTheDocument();
  });

  it("replaces the blocked agent action with a friendly Collection setup CTA", () => {
    const onCreate = vi.fn();
    const onCreateWorkspace = vi.fn();

    render(
      <LaunchFirstAgentEmptyState
        onCreate={onCreate}
        creationDisabledReason="Select a Collection before launching an agent."
        onCreateWorkspace={onCreateWorkspace}
      />,
    );

    const createWorkspace = screen.getByRole("button", { name: /create your first collection/i });
    expect(createWorkspace).toBeEnabled();
    expect(screen.getByText("One quick step, then you can launch your first agent.")).toBeInTheDocument();
    expect(screen.queryByText("Select a Collection before launching an agent.")).not.toBeInTheDocument();

    fireEvent.click(createWorkspace);
    expect(onCreateWorkspace).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("keeps the selection guard when Collections exist but none is selected", () => {
    render(
      <LaunchFirstAgentEmptyState
        onCreate={vi.fn()}
        creationDisabledReason="Select a Collection before launching an agent."
      />,
    );

    expect(screen.getByRole("button", { name: /^Create an agent/ })).toBeDisabled();
    expect(screen.getAllByText("Select a Collection before launching an agent.").length).toBeGreaterThan(0);
  });

  it("keeps first-agent onboarding copy for the account General Collection", () => {
    render(
      <LaunchFirstAgentEmptyState
        onCreate={vi.fn()}
        workspaceName="General"
      />,
    );

    expect(screen.getByRole("heading", { name: "Launch your first agent" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Welcome to.*General/i })).not.toBeInTheDocument();
  });

  it("welcomes established users to an empty Collection by name", () => {
    render(
      <LaunchFirstAgentEmptyState
        onCreate={vi.fn()}
        workspaceName="Personal Workspace"
        hasAccountAgents
      />,
    );

    expect(screen.getByRole("heading", { name: "Welcome to Personal Workspace" })).toBeInTheDocument();
    expect(screen.queryByText("Collection roster")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message agent" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Message agent" })).toHaveAttribute(
      "placeholder",
      "Launch an agent to start chatting...",
    );
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });
});

describe("AgentEmptyState", () => {
  it("uses comfortable mobile spacing inside a scroll-safe empty-state boundary", () => {
    render(<AgentEmptyState onCreate={vi.fn()} launchLabel="Launch agent" onLaunchAction={vi.fn()} />);

    expect(screen.getByTestId("agent-launch-empty-state")).toHaveClass("min-h-0", "overflow-x-hidden", "overflow-y-auto");
    expect(screen.getByRole("heading", { name: "Your business, one chat" })).toHaveClass("text-[30px]", "md:text-[38px]", "break-words");
    expect(document.querySelectorAll('[data-slot="agent-feature-empty-state-example"]')).toHaveLength(3);
    expect(screen.getByText(/Ask questions across Slack/).parentElement).toHaveClass("min-h-16", "items-center", "text-[13px]", "text-left", "md:flex-col", "md:min-h-[118px]");
    expect(screen.getByRole("button", { name: "Launch agent" })).toHaveClass("h-12", "md:h-10");
    expect(screen.getByTestId("agent-launch-entry")).toHaveAccessibleName("Launch agent");
  });
});

describe("AgentDesktopEmptyState", () => {
  it("launches Desktop when it is enabled", () => {
    const onLaunchAction = vi.fn();
    render(
      <AgentDesktopEmptyState
        onCreate={vi.fn()}
        desktopEnabled
        settingsHref="/dashboard/agents?view=settings&settings=agent&agentId=agent-1#agent-desktop-setting"
        onLaunchAction={onLaunchAction}
      />,
    );

    expect(screen.getByRole("heading", { name: "Your agent's desktop" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Launch desktop" }));
    expect(onLaunchAction).toHaveBeenCalledOnce();
  });

  it("links directly to the Desktop setting when it is disabled", () => {
    const onLaunchAction = vi.fn();
    const settingsHref = "/dashboard/agents?view=settings&settings=agent&agentId=agent-1#agent-desktop-setting";
    render(
      <AgentDesktopEmptyState
        onCreate={vi.fn()}
        desktopEnabled={false}
        settingsHref={settingsHref}
        onLaunchAction={onLaunchAction}
      />,
    );

    expect(screen.getByRole("link", { name: "Enable in settings" })).toHaveAttribute("href", settingsHref);
    expect(onLaunchAction).not.toHaveBeenCalled();
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

  it("selects an agent directly from the mobile rail", () => {
    const supportAgent = { ...agent, id: "agent-2", name: "Support Agent" };
    const props = renderAgentList({
      isDesktopViewport: false,
      renderMobileNavigation: true,
      agents: [agent, supportAgent],
      syntheticThreads: [agentThread(agent), agentThread(supportAgent)],
    });

    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Support Agent" }));

    expect(props.setSelectedAgentId).toHaveBeenCalledWith("agent-2");
    expect(props.setMobileShowChat).toHaveBeenCalledWith(true);
    expect(props.setSidebarCollapsed).not.toHaveBeenCalled();
  });

  it("renders the agent profile image in the collapsed roster", () => {
    const profileImageUrl = "https://cdn.example.test/agent.png";
    renderAgentList({ agents: [{ ...agent, avatarUrl: profileImageUrl }] });

    const button = screen.getByRole("button", { name: "Select Test Agent" });
    expect(button.querySelector("img")).toHaveAttribute("src", profileImageUrl);
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
    const supportAgent = { ...agent, id: "agent-2", name: "Support Agent" };
    const props = renderAgentList({
      sidebarCollapsed: false,
      isDesktopViewport: false,
      renderMobileNavigation: true,
      embeddedInNavigation: true,
      agents: [agent, supportAgent],
      syntheticThreads: [agentThread(agent), agentThread(supportAgent)],
    });

    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it("expands the agents/channels sidebar when an agent is selected", () => {
    const props = renderAgentList();
    const shell = document.querySelector(".agents-roster-shell");

    expect(shell).toHaveClass("w-12");
    expect(shell).not.toHaveClass("w-52");

    fireEvent.click(screen.getByRole("button", { name: /select test agent/i }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(false);
    expect(props.setSelectedAgentId).toHaveBeenCalledWith("agent-1");
    expect(props.setMobileShowChat).toHaveBeenCalledWith(true);
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
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/dashboard/agents?view=overview");
    expect(screen.queryByRole("link", { name: /Alt Home/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it("opens Knowledge Hub through the embedded navigation callback", () => {
    const onOpenKnowledgeHub = vi.fn();
    renderAgentList({
      sidebarCollapsed: false,
      embeddedInNavigation: true,
      onOpenKnowledgeHub,
      knowledgeHubActive: true,
    });

    const knowledgeHub = screen.getByRole("button", { name: /Knowledge Hub/i });
    expect(knowledgeHub).toHaveAttribute("aria-current", "page");
    fireEvent.click(knowledgeHub);
    expect(onOpenKnowledgeHub).toHaveBeenCalledOnce();
  });

  it("shows Administration actions in the embedded collapsed rail", () => {
    renderAgentList({ embeddedInNavigation: true });

    expect(document.querySelector(".agents-roster-header")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand agents sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Test Agent" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/dashboard/agents?view=overview");
    expect(screen.queryByRole("link", { name: /Alt Home/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Knowledge Hub" })).toHaveAttribute("href", "/dashboard/agents?section=knowledge-hub");
    expect(screen.getByRole("button", { name: "Launch agent" })).toBeInTheDocument();
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute("href", "/dashboard/agents?section=members");
    expect(screen.getByRole("link", { name: "Usage" })).toHaveAttribute("href", "/dashboard/agents?view=usage");
    fireEvent.click(screen.getByRole("button", { name: "Account links" }));
    expect(screen.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
  });

  it("places primary navigation above My Agents and Administration below it", () => {
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
    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(sectionHeader).toHaveClass("pl-7", "pr-3");
    expect(sectionHeader?.querySelector(".h-px")).not.toBeInTheDocument();
    expect(document.querySelector(".agents-roster-administration")).toBeInTheDocument();
    const agentList = document.querySelector(".agents-roster-agent-list");
    const home = document.querySelector(".agents-roster-home");
    const administration = document.querySelector(".agents-roster-administration");
    expect(actions?.nextElementSibling).toBe(home);
    expect(home?.nextElementSibling).toBe(sectionHeader);
    expect(agentList?.nextElementSibling).toBe(administration);
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

  it("waits for stopped storage, starts once, and preseeds alongside the start", async () => {
    const operations: string[] = [];
    const createOpenClawAgent = vi.fn(async (_token: string, _options?: Record<string, unknown>) => {
      operations.push("create-creating");
      return { id: "created-agent", state: "CREATING" };
    });
    const fileWriteBytes = vi.fn(async () => {
      operations.push("preseed");
      return undefined;
    });
    const waitForState = vi.fn(async () => {
      operations.push("wait-stopped");
      return { id: "created-agent", state: "STOPPED" };
    });
    const start = vi.fn(async () => {
      operations.push("start");
      return { state: "RUNNING", waitRunning: vi.fn(async () => undefined) };
    });
    agentClientMocks.createAgentClient.mockReturnValue({ fileWriteBytes, waitForState, start });
    const fetchAgents = vi.fn(async () => {
      operations.push("refresh");
      return true;
    });
    const setSelectedAgentId = vi.fn();
    renderAgentList({
      sidebarCollapsed: false,
      createOpenClawAgent,
      fetchAgents,
      setSelectedAgentId,
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish setup with starter files" }));

    await waitFor(() => expect(setSelectedAgentId).toHaveBeenCalledWith("created-agent"));
    expect(createOpenClawAgent).toHaveBeenCalledOnce();
    expect(createOpenClawAgent.mock.calls[0]?.[1]).not.toHaveProperty("start");
    expect(fileWriteBytes).toHaveBeenCalledWith(
      "created-agent",
      ".openclaw/workspace/AGENTS.md",
      expect.anything(),
    );
    expect(fileWriteBytes.mock.calls[0]).toHaveLength(3);
    expect(waitForState).toHaveBeenCalledWith("created-agent", ["STOPPED"]);
    expect(start).toHaveBeenCalledWith("created-agent");
    expect(start).toHaveBeenCalledOnce();
    // The workspace write route only answers once the deployment's pod is
    // ready, so the preseed runs alongside the start rather than gating it.
    expect(operations).toEqual(["create-creating", "wait-stopped", "refresh", "start", "preseed", "refresh"]);
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
    expect(associateCreatedAgent).toHaveBeenCalledWith("created-agent", "knowledge-collection-1");
    expect(operations).toEqual(["create", "refresh", "associate", "refresh"]);
  });

  it("does not select an agent when Collection association fails", async () => {
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
      "Agent was created, but Collection assignment did not complete: Roster refresh failed",
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
      "Agent was created, but agents could not be refreshed.",
    ));
    expect(associateCreatedAgent).toHaveBeenCalledWith("created-agent", "knowledge-collection-1");
    expect(setSelectedAgentId).not.toHaveBeenCalled();
  });

  it("blocks launch entry points without Collection admin access", async () => {
    const props = renderAgentList({
      sidebarCollapsed: false,
      sidebarCreatorSignal: 1,
      agentCreationDisabledReason: "Collection admin access is required to add agents.",
    });

    const launch = screen.getByRole("button", { name: "Launch agent" });
    expect(launch).toBeDisabled();
    expect(screen.getByText("Collection admin access is required to add agents.")).toBeInTheDocument();
    await waitFor(() => expect(props.setError).toHaveBeenCalledWith("Collection admin access is required to add agents."));
    expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument();
  });

  it("shows a loading status instead of stale Collection agents", () => {
    renderAgentList({ rosterLoading: true });

    expect(document.querySelector(".agents-roster-shell")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading Collection agents");
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
    fireEvent.click(screen.getByRole("button", { name: "Close agent creation" }));
    await waitFor(() => expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument());
  });

  it("closes the agent launcher when an agent is selected", async () => {
    const props = renderAgentList({ sidebarCreatorSignal: 1 });

    expect(await screen.findByText("First agent setup wizard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /select test agent/i }));

    await waitFor(() => expect(screen.queryByText("First agent setup wizard")).not.toBeInTheDocument());
    expect(props.setSelectedAgentId).toHaveBeenCalledWith("agent-1");
  });

  it("keeps expanded launch and agent rows compact when reordering is available", () => {
    const agents = [agent, failedAgent];
    renderAgentList({
      sidebarCollapsed: false,
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    const launch = screen.getByRole("button", { name: "Launch agent" });
    expect(launch).toHaveClass("items-center", "gap-1", "pl-1", "pr-2", "py-2");
    expect(launch).not.toHaveClass("border-l-2");
    expect(launch).not.toHaveClass("border-r");
    expect(launch.children[0]).toHaveClass("h-5", "w-5", "rounded-full");
    expect(launch).toHaveTextContent("Create a new workspace");
    const row = screen.getByRole("button", { name: "Select Test Agent" });
    expect(row).toHaveClass("items-center", "gap-1", "pl-1", "pr-2", "py-2");
    expect(row).toHaveClass("border-r", "border-border");
    expect(row).not.toHaveClass("border-l-2");
    expect(screen.getByRole("button", { name: "Move Test Agent" })).toHaveClass(
      "absolute",
      "right-1",
      "w-6",
      "opacity-0",
      "group-hover/row:bg-surface-high",
      "group-hover/row:text-foreground",
      "group-hover/row:opacity-100",
    );
    expect(document.querySelector(".agents-roster-section-header")).toHaveClass("pl-7", "pr-3");
    expect(document.querySelector(".agents-roster-administration")).toBeInTheDocument();
    expect(document.querySelector(".agents-roster-expanded .agents-roster-header")).toHaveClass("bg-background");
    expect(document.querySelector(".agents-roster-expanded .agents-roster-scroll")).toHaveClass("bg-[var(--agent-roster-background)]");
  });

  it("uses display names and omits a redundant sender from agent status", () => {
    const displayAgent: Agent = {
      ...agent,
      id: "agent-marketing",
      name: "rapid-forge-engine",
      displayName: "Marketing",
      managed: false,
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

  it("does not expose display-name editing from the agent roster", () => {
    const displayAgent: Agent = {
      ...agent,
      name: "rapid-forge-engine",
      displayName: "Marketing",
      managed: false,
    };
    renderAgentList({
      sidebarCollapsed: false,
      agents: [displayAgent],
      syntheticThreads: [agentThread(displayAgent)],
    });

    expect(screen.queryByRole("button", { name: "Rename agent" })).not.toBeInTheDocument();
  });

  it("shows the launch agent button in the collapsed rail", () => {
    renderAgentList();

    fireEvent.click(screen.getByRole("button", { name: /launch agent/i }));
    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();
    const overlay = screen.getByTestId("agent-launcher-overlay");
    expect(screen.getByTestId("agent-launcher-dialog")).toHaveClass(
      "h-[min(712px,calc(100dvh-1rem))]",
      "w-[calc(100vw-1rem)]",
      "max-w-[1200px]",
      "sm:h-[min(852px,calc(100dvh-1rem))]",
    );
    expect(overlay).toHaveClass("p-2");
    expect(document.body).toContainElement(overlay);
    expect(document.querySelector(".agents-roster-shell")).not.toContainElement(overlay);
  });

  it("opens Administration actions from the collapsed rail", () => {
    const onOpenAccountSettings = vi.fn();
    const onOpenHome = vi.fn();
    const onOpenMembers = vi.fn();
    const onOpenUsage = vi.fn();
    renderAgentList({
      onOpenAccountSettings,
      accountSettingsActive: true,
      onOpenHome,
      homeActive: true,
      onOpenMembers,
      onOpenUsage,
    });

    const dividers = document.querySelectorAll(".agents-roster-rail-divider");

    expect(dividers).toHaveLength(2);
    expect(dividers[0]).toHaveAttribute("aria-hidden", "true");
    expect(dividers[0]).toHaveClass("my-2");
    expect(document.querySelector(".agents-roster-rail .agents-roster-scroll")).toHaveClass("flex-col", "overflow-hidden");
    expect(document.querySelector(".agents-roster-rail-primary")).toHaveClass("shrink-0", "gap-2");
    expect(document.querySelector(".agents-roster-rail-agents")).toHaveClass("w-full", "shrink", "overflow-y-auto", "py-1");
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "Alt Home" })).not.toBeInTheDocument();
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usage" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
    expect(onOpenAccountSettings).not.toHaveBeenCalled();
    const primary = document.querySelector(".agents-roster-rail-primary");
    const home = document.querySelector(".agents-roster-rail-home");
    const agents = document.querySelector(".agents-roster-rail-agents");
    const administration = document.querySelector(".agents-roster-rail-administration");
    expect(primary?.nextElementSibling).toBe(home);
    expect(home?.nextElementSibling).toBe(dividers[0]);
    expect(dividers[0]?.nextElementSibling).toBe(agents);
    expect(agents?.nextElementSibling).toBe(dividers[1]);
    expect(dividers[1]?.nextElementSibling).toBe(administration);

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(onOpenHome).toHaveBeenCalledOnce();
    expect(onOpenMembers).toHaveBeenCalledOnce();
    expect(onOpenUsage).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Account links" }));
    const settings = screen.getByRole("menuitem", { name: "Settings" });
    expect(settings).toHaveAttribute("aria-current", "page");
    fireEvent.click(settings);
    expect(onOpenAccountSettings).toHaveBeenCalledOnce();
  });

  it("opens account settings from the collapsed account menu", () => {
    const operations: string[] = [];
    renderAgentList({
      onOpenAccountSettings: () => operations.push("settings"),
      setSidebarCollapsed: (collapsed) => operations.push(collapsed ? "collapse" : "expand"),
    });

    fireEvent.click(screen.getByRole("button", { name: "Account links" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));

    expect(operations).toEqual(["settings"]);
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

  it("does not expose reordering from the collapsed rail", () => {
    const agents = [agent, failedAgent, startingAgent];
    renderAgentList({
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Select / }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Select Test Agent",
      "Select Failed Agent",
      "Select Starting Agent",
    ]);
  });

  it("persists expanded roster order across remounts", async () => {
    const agents = [agent, failedAgent, startingAgent];
    const props = createAgentListProps({
      sidebarCollapsed: false,
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

    expect(screen.getAllByRole("button", { name: /^Move / }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Move Test Agent",
      "Move Starting Agent",
      "Move Failed Agent",
    ]);
  });

  it("keeps agent hover cards available without collapsed reorder controls", () => {
    const agents = [agent, failedAgent];
    renderAgentList({
      agents,
      syntheticThreads: agents.map(agentThread),
    });

    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    await waitFor(() => expect(
      screen.getAllByRole("button", { name: /^Select / }).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Select Test Agent",
      "Select Starting Agent",
      "Select Failed Agent",
    ]));
  });

  it("links to user settings from the expanded account menu", () => {
    renderAgentList({ sidebarCollapsed: false });

    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /account/i }));
    expect(screen.getByRole("menuitem", { name: /^Settings$/i })).toHaveAttribute("href", "/dashboard/agents?view=settings");
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
    expect(screen.getByText(/spaces become dashes.*slack/i)).toBeInTheDocument();
    expect(screen.queryByText("Slack handle")).not.toBeInTheDocument();
    expect(screen.getByText("Default model")).toBeInTheDocument();
    expect(screen.getByText("Visibility")).toBeInTheDocument();
    expect(screen.getByText("Auto-archive idle projects")).toBeInTheDocument();
    expect(screen.getByText("Agent runtime")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop agent/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Danger Zone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start agent/i })).not.toBeInTheDocument();
  });

  it("uses canonical theme surfaces for settings groups and controls", () => {
    renderAgentSettingsPanel();

    const profileGroup = screen.getByText("Full Name").closest("section");
    expect(profileGroup).toHaveClass("divide-border", "border-border", "bg-surface-low/30");
    expect(profileGroup).not.toHaveClass("divide-foreground", "border-foreground");
    expect(screen.getByDisplayValue("John Smith")).toHaveClass("border-input", "bg-input-background");

    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    const usageCard = screen.getByText("Usage dashboard").closest("a");
    expect(usageCard).toHaveClass("rounded-xl", "border-border", "bg-surface-low/40");
    expect(usageCard).not.toHaveClass("border-foreground");

    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    const teamGroup = screen.getByText("Collection members").closest("section");
    expect(teamGroup).toHaveClass("divide-border", "border-border", "bg-surface-low/30");
    expect(teamGroup).not.toHaveClass("divide-foreground", "border-foreground");
  });

  it("offers cleanup instead of restart for a failed runtime", () => {
      const onStartAgent = vi.fn();
      const onStopAgent = vi.fn();
      renderAgentSettingsPanel({
        agent: { ...agent, state: "FAILED" },
        onStartAgent,
        onStopAgent,
      });

      fireEvent.click(screen.getByRole("button", { name: "Agent" }));

      const cleanupButton = screen.getByRole("button", { name: "Clean up failed launch" });
      expect(cleanupButton).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Start agent" })).not.toBeInTheDocument();
      fireEvent.click(cleanupButton);
      expect(onStopAgent).toHaveBeenCalledTimes(1);
      expect(onStartAgent).not.toHaveBeenCalled();
  });

  it("offers start and archive after cleanup reaches stopped", () => {
    const onStartAgent = vi.fn();
    const onArchiveAgent = vi.fn();
    renderAgentSettingsPanel({
      agent: { ...agent, state: "STOPPED" },
      onStartAgent,
      onArchiveAgent,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    fireEvent.click(screen.getByRole("button", { name: "Archive agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Start agent" }));
    expect(onArchiveAgent).toHaveBeenCalledTimes(1);
    expect(onStartAgent).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Restore agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clean up failed launch" })).not.toBeInTheDocument();
  });

  it("offers restore instead of start for an archived agent", () => {
    const onStartAgent = vi.fn();
    const onRestoreAgent = vi.fn();
    renderAgentSettingsPanel({
      agent: { ...agent, state: "ARCHIVED" },
      onStartAgent,
      onRestoreAgent,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore agent" }));

    expect(onRestoreAgent).toHaveBeenCalledTimes(1);
    expect(onStartAgent).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Start agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive agent" })).not.toBeInTheDocument();
  });

  it("renders archiving as cleanup rather than startup", () => {
    renderAgentSettingsPanel({ agent: { ...agent, state: "ARCHIVING" } });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(screen.getByText("Agent is archiving")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archiving agent" })).toBeDisabled();
    expect(screen.getByText("Archiving...")).toBeInTheDocument();
    expect(screen.queryByText("Starting...")).not.toBeInTheDocument();
  });

  it("opens the delete confirmation from agent settings", () => {
    const onDeleteAgent = vi.fn();
    renderAgentSettingsPanel({ agent: { ...agent, state: "STOPPED" }, onDeleteAgent });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete agent" }));

    expect(onDeleteAgent).toHaveBeenCalledTimes(1);
  });

  it("renders the mobile settings section tabs without duplicate header controls", () => {
    renderAgentSettingsPanel({
      isDesktopViewport: false,
    });

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: /settings sections/i });
    expect(navigation).toHaveClass("h-11", "rounded-xl", "border-border", "bg-surface-low");
    expect(screen.getByRole("button", { name: "General" })).toHaveClass("rounded-lg", "bg-surface-high");
    expect(screen.queryByRole("button", { name: /open agents sidebar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open workspace sidebar/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    expect(screen.getByRole("button", { name: "Team" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Team" })).toHaveClass("bg-surface-high");
    expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByText("Collection members")).toBeInTheDocument();
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
    const onProfileNameChange = vi.fn();
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

    renderAgentSettingsPanel({ getToken, onProfileNameChange });

    expect(await screen.findByDisplayValue("Server Name")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Server Name"), { target: { value: "Jane Smith" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(sdkMocks.userUpdate).toHaveBeenCalledWith({ name: "Jane Smith" });
    });
    expect(onProfileNameChange).toHaveBeenCalledWith("Jane Smith");
    expect(screen.getByText("Profile updated.")).toBeInTheDocument();
  });

  it("loads and uploads the account profile avatar through the SDK", async () => {
    const getToken = vi.fn(async () => "token");
    const onProfileAvatarChange = vi.fn();
    sdkMocks.userGetProfileImage.mockResolvedValueOnce({
      id: "user-1234567890abcdef",
      avatarUrl: "https://cdn.example.test/current.png",
      s3Key: "prod/user-1234567890abcdef/user-1234567890abcdef.png",
    });
    const { container } = renderAgentSettingsPanel({ getToken, onProfileAvatarChange });

    await waitFor(() => expect(sdkMocks.userGetProfileImage).toHaveBeenCalledOnce());
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="image/webp"]');
    expect(input).not.toBeNull();
    const file = new File(["avatar"], "avatar.webp", { type: "image/webp" });
    fireEvent.change(input!, { target: { files: [file] } });
    const localAvatarUrl = screen.getByAltText("Profile avatar").getAttribute("src");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(sdkMocks.userUploadProfileImage).toHaveBeenCalledWith(file));
    expect(onProfileAvatarChange).toHaveBeenLastCalledWith("https://cdn.example.test/account.png", file);
    expect(screen.getByAltText("Profile avatar")).toHaveAttribute("src", localAvatarUrl);
    expect(screen.getByText("Profile updated.")).toBeInTheDocument();
  });

  it("rejects account profile images larger than 2MB before upload", async () => {
    const getToken = vi.fn(async () => "token");
    const { container } = renderAgentSettingsPanel({ getToken });
    await waitFor(() => expect(sdkMocks.userGetProfileImage).toHaveBeenCalledOnce());
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="image/webp"]');
    const file = new File(
      [new Uint8Array(2 * 1024 * 1024 + 1)],
      "avatar.webp",
      { type: "image/webp" },
    );

    fireEvent.change(input!, { target: { files: [file] } });

    expect(screen.getByText("Image must be 2MB or smaller.")).toBeInTheDocument();
    expect(sdkMocks.userUploadProfileImage).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("explains when account profile images are unavailable in the current environment", async () => {
    const getToken = vi.fn(async () => "token");
    sdkMocks.userUploadProfileImage.mockRejectedValueOnce(
      Object.assign(new Error("API Error 404: Not Found"), { statusCode: 404 }),
    );
    const { container } = renderAgentSettingsPanel({ getToken });
    await waitFor(() => expect(sdkMocks.userGetProfileImage).toHaveBeenCalledOnce());
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="image/webp"]');
    const file = new File(["avatar"], "avatar.webp", { type: "image/webp" });

    fireEvent.change(input!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Profile image updates are not available in this environment.")).toBeInTheDocument();
  });

  it("removes the persisted account profile avatar through the SDK", async () => {
    const getToken = vi.fn(async () => "token");
    const onProfileAvatarChange = vi.fn();
    sdkMocks.userGetProfileImage.mockResolvedValueOnce({
      id: "user-1234567890abcdef",
      avatarUrl: "https://cdn.example.test/current.png",
      s3Key: "prod/user-1234567890abcdef/user-1234567890abcdef.png",
    });
    renderAgentSettingsPanel({ getToken, onProfileAvatarChange });

    const remove = await screen.findByRole("button", { name: "Remove" });
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(sdkMocks.userDeleteProfileImage).toHaveBeenCalledOnce());
    expect(onProfileAvatarChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("Profile updated.")).toBeInTheDocument();
  });

  it("uploads a managed agent avatar through the page callback", async () => {
    const onUploadAgentAvatar = vi.fn(async () => "https://cdn.example.test/agent.png");
    const { container } = renderAgentSettingsPanel({ onUploadAgentAvatar });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="image/webp"]');
    expect(input).not.toBeNull();
    const file = new File(["avatar"], "agent.webp", { type: "image/webp" });
    fireEvent.change(input!, { target: { files: [file] } });
    const localAvatarUrl = screen.getByAltText("Agent avatar").getAttribute("src");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onUploadAgentAvatar).toHaveBeenCalledWith("agent-1", file));
    expect(screen.getByAltText("Agent avatar")).toHaveAttribute("src", localAvatarUrl);
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("rejects unsupported agent avatar formats before upload", () => {
    const onUploadAgentAvatar = vi.fn(async () => "https://cdn.example.test/agent.png");
    const { container } = renderAgentSettingsPanel({ onUploadAgentAvatar });
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="image/webp"]');
    const file = new File(["svg"], "agent.svg", { type: "image/svg+xml" });

    fireEvent.change(input!, { target: { files: [file] } });

    expect(screen.getByText("Choose a PNG, JPEG, WebP, or GIF image.")).toBeInTheDocument();
    expect(onUploadAgentAvatar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("removes a persisted managed agent avatar through the page callback", async () => {
    const onDeleteAgentAvatar = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: { ...agent, avatarUrl: "https://cdn.example.test/agent.png" },
      onDeleteAgentAvatar,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onDeleteAgentAvatar).toHaveBeenCalledWith("agent-1"));
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("does not offer removal for a metadata-only agent avatar", () => {
    const onDeleteAgentAvatar = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        avatarUrl: null,
        meta: { ui: { avatar: { image: "https://cdn.example.test/fallback.png" } } },
      },
      onDeleteAgentAvatar,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(onDeleteAgentAvatar).not.toHaveBeenCalled();
  });

  it("restores the metadata avatar after removing a profile image", async () => {
    const onDeleteAgentAvatar = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        avatarUrl: "https://cdn.example.test/profile.png",
        meta: { ui: { avatar: { image: "https://cdn.example.test/fallback.png" } } },
      },
      onDeleteAgentAvatar,
    });
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onDeleteAgentAvatar).toHaveBeenCalledWith("agent-1"));
    expect(screen.getByAltText("Agent avatar")).toHaveAttribute("src", "https://cdn.example.test/fallback.png");
  });

  it("saves the managed agent name independently from its handle-backed display name", async () => {
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
    const initialAgent = { ...agent, handle: "research-pilot", displayName: "research-pilot" };
    const { props, rerender } = renderAgentSettingsPanel({ agent: initialAgent });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent name" }), {
      target: { value: "Unsaved canonical name" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Additional env" }), {
      target: { value: "CUSTOM_FLAG=unsaved" },
    });

    rerender(<AgentSettingsPanel {...props} agent={{ ...initialAgent, handle: "marketing", displayName: "marketing" }} />);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Marketing");
    });
    expect(screen.getByRole("textbox", { name: "Agent name" })).toHaveValue("Unsaved canonical name");
    expect(screen.getByRole("textbox", { name: "Additional env" })).toHaveValue("CUSTOM_FLAG=unsaved");
  });

  it("treats unknown management provenance as managed", async () => {
    const onUpdateAgentProfile = vi.fn(async () => undefined);
    const onUpdateExternalAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: { ...agent, managed: null },
      onUpdateAgentProfile,
      onUpdateExternalAgentProfile,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), { target: { value: "@Local_Alias" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentProfile).toHaveBeenCalledWith("agent-1", { handle: "local_alias" });
    });
    expect(onUpdateExternalAgentProfile).not.toHaveBeenCalled();
  });

  it("clears a managed display handle back to its agent name", async () => {
    const onUpdateAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({
      agent: { ...agent, handle: "research-pilot", displayName: "research-pilot" },
      onUpdateAgentProfile,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentProfile).toHaveBeenCalledWith("agent-1", { handle: null });
    });
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Test Agent");
  });

  it("turns a friendly managed display name into a Slack-safe handle", async () => {
    const onUpdateAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentProfile });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), {
      target: { value: "best one in the world" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentProfile).toHaveBeenCalledWith("agent-1", { handle: "best-one-in-the-world" });
    });
    expect(screen.getByRole("textbox", { name: "Agent display name" })).toHaveValue("Best One In The World");
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("dismisses invalid managed display-name feedback after five seconds", () => {
    const onUpdateAgentProfile = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentProfile });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Agent display name" }), {
      target: { value: "Friendly Alias!" },
    });
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      const message = "Display names must start with a letter or number and contain 2-64 letters, numbers, spaces, underscores, or dashes.";
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(onUpdateAgentProfile).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(4999));
      expect(screen.getByText(message)).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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
    const onUpdateAgentLaunchConfig = vi.fn(async (
      _agentId: string,
      _launchConfig: Record<string, unknown>,
    ) => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        launchConfig: {
          ...agent.launchConfig,
          env: {
            ...(agent.launchConfig?.env as Record<string, string>),
            OPENCLAW_GATEWAY_TOKEN: "legacy-token-must-not-replay",
          },
          workspacesSync: { enabled: true, readyOnly: true },
        },
      },
      onUpdateAgentLaunchConfig,
      reportedChannelsReady: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(screen.queryByRole("textbox", { name: "Agent Docker image" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Agent Docker image", hidden: true })).toHaveValue("ghcr.io/hypercli/hypercli-openclaw:prod");
    expect(screen.getByRole("textbox", { name: "Additional env" })).toHaveValue("FOO=bar\nHYPER_CUSTOM_FLAG=visible");
    expect(screen.queryByDisplayValue(/OPENCLAW_GATEWAY_TOKEN/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/HYPER_API_BASE/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/HYPER_WORKSPACES_BOOT_SYNC/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES/)).not.toBeInTheDocument();

    const showHyperEnv = screen.getByRole("checkbox", { name: "Show saved HYPER_* variables (dangerous)" });
    expect(showHyperEnv).not.toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Managed HYPER environment variables" })).not.toBeInTheDocument();
    fireEvent.click(showHyperEnv);
    const savedHyperEnv = screen.getByRole("textbox", { name: "Managed HYPER environment variables" });
    expect(savedHyperEnv).not.toHaveAttribute("readonly");
    expect(savedHyperEnv).toHaveValue(
      "HYPER_API_BASE=https://api.hypercli.com\n"
      + "HYPER_WORKSPACES_BOOT_SYNC=1\n"
      + "HYPER_WORKSPACES_SYNC_READY_ONLY=1",
    );
    fireEvent.change(savedHyperEnv, {
      target: {
        value: "HYPER_API_BASE=https://api.dev.hypercli.com\n"
          + "HYPER_WORKSPACES_BOOT_SYNC=1\n"
          + "HYPER_WORKSPACES_SYNC_READY_ONLY=1",
      },
    });

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
          OPENCLAW_DESKTOP_ENABLED: "0",
          HYPER_API_BASE: "https://api.dev.hypercli.com",
          HYPER_WORKSPACES_BOOT_SYNC: "1",
          HYPER_WORKSPACES_DIR: "/home/node/shared",
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
          sync_uid: 1000,
          sync_gid: 1000,
        });
    });
    const savedLaunchConfig = onUpdateAgentLaunchConfig.mock.calls[0]?.[1];
    expect(savedLaunchConfig).not.toHaveProperty("workspacesSync");
    expect(savedLaunchConfig?.env).not.toHaveProperty("OPENCLAW_GATEWAY_TOKEN");
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("enables Slack with canonical hosted relay environment values", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async (
      _agentId: string,
      _launchConfig: Record<string, unknown>,
    ) => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    const slackSwitch = screen.getByRole("switch", { name: "Enable Slack" });
    expect(slackSwitch).not.toBeChecked();

    fireEvent.click(slackSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", expect.objectContaining({
        env: expect.objectContaining({
          HYPER_SLACK_APP_ENABLED: "1",
          HYPER_SLACK_RELAY_URL: "wss://api.hypercli.com/slack/ws",
          HYPER_SLACK_API_URL: "https://api.hypercli.com/slack/api/",
        }),
      }));
    });
  });

  it("hides and removes hosted Slack environment values when Slack is disabled", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async (
      _agentId: string,
      _launchConfig: Record<string, unknown>,
    ) => undefined);
    renderAgentSettingsPanel({
      agent: {
        ...agent,
        launchConfig: {
          ...agent.launchConfig,
          env: {
            ...(agent.launchConfig?.env as Record<string, string>),
            HYPER_SLACK_APP_ENABLED: "1",
            HYPER_SLACK_RELAY_URL: "wss://old.example.test/slack/ws",
            HYPER_SLACK_API_URL: "https://old.example.test/slack/api/",
          },
        },
      },
      onUpdateAgentLaunchConfig,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByRole("textbox", { name: "Additional env" })).not.toHaveValue(
      expect.stringContaining("HYPER_SLACK_"),
    );
    const slackSwitch = screen.getByRole("switch", { name: "Enable Slack" });
    expect(slackSwitch).toBeChecked();

    fireEvent.click(slackSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onUpdateAgentLaunchConfig).toHaveBeenCalledOnce());
    const savedLaunchConfig = onUpdateAgentLaunchConfig.mock.calls[0]?.[1];
    expect(savedLaunchConfig?.env).not.toHaveProperty("HYPER_SLACK_APP_ENABLED");
    expect(savedLaunchConfig?.env).not.toHaveProperty("HYPER_SLACK_RELAY_URL");
    expect(savedLaunchConfig?.env).not.toHaveProperty("HYPER_SLACK_API_URL");
  });

  it("rejects manual overrides of hosted Slack environment values", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async (
      _agentId: string,
      _launchConfig: Record<string, unknown>,
    ) => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Additional env" }), {
      target: { value: "HYPER_SLACK_RELAY_URL=wss://unsafe.example.test/ws" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(
      "HYPER_SLACK_RELAY_URL is managed by the Slack setting and cannot be edited here.",
    )).toBeInTheDocument();
    expect(onUpdateAgentLaunchConfig).not.toHaveBeenCalled();
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

  it("renders a stopping runtime as stopping instead of starting", () => {
    renderAgentSettingsPanel({
      agent: { ...agent, state: "STOPPING" },
      agentStopping: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    const stopButton = screen.getByRole("button", { name: "Stop agent" });
    expect(stopButton).toBeDisabled();
    expect(stopButton).toHaveTextContent("Stopping...");
    expect(screen.getByText("Agent is stopping")).toBeInTheDocument();
    expect(screen.queryByText("Starting...")).not.toBeInTheDocument();
  });

  it("keeps an archiving runtime busy through the terminal archive boundary", () => {
    renderAgentSettingsPanel({
      agent: { ...agent, state: "ARCHIVING" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    const archiveButton = screen.getByRole("button", { name: "Archiving agent" });
    expect(archiveButton).toBeDisabled();
    expect(archiveButton).toHaveTextContent("Archiving...");
    expect(screen.getByText("Agent is archiving")).toBeInTheDocument();
    expect(screen.queryByText("Starting...")).not.toBeInTheDocument();
  });

  it.each(["CREATING", "STARTING"] as const)(
    "allows %s startup to be cancelled",
    (state) => {
      const onStopAgent = vi.fn();
      renderAgentSettingsPanel({
        agent: { ...agent, state },
        agentStarting: true,
        onStopAgent,
      });

      fireEvent.click(screen.getByRole("button", { name: "Agent" }));
      const stopButton = screen.getByRole("button", { name: "Stop agent" });
      expect(stopButton).toBeEnabled();
      fireEvent.click(stopButton);
      expect(onStopAgent).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps a restoring runtime busy until it reaches stopped", () => {
    renderAgentSettingsPanel({
      agent: { ...agent, state: "RESTORING" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    const restoreButton = screen.getByRole("button", { name: "Restoring agent" });
    expect(restoreButton).toBeDisabled();
    expect(restoreButton).toHaveTextContent("Restoring...");
    expect(screen.getByText("Agent is restoring files")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop agent" })).not.toBeInTheDocument();
  });

  it("saves desktop and workspace launch settings as managed config", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.click(screen.getByRole("switch", { name: "Enable desktop route" }));
    fireEvent.click(screen.getByRole("switch", { name: "Ready files only" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Shared knowledge sync selection" }), {
      target: { value: "team-docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", expect.objectContaining({
        env: expect.objectContaining({
          OPENCLAW_DESKTOP_ENABLED: "1",
          HYPER_WORKSPACES_BOOT_SYNC: "1",
          HYPER_WORKSPACES_DIR: "/home/node/shared",
          HYPER_WORKSPACES_SYNC_READY_ONLY: "0",
          HYPER_WORKSPACES_SYNC_WORKSPACE: "team-docs",
        }),
        routes: expect.objectContaining({
          openclaw: { port: 18789, auth: false, prefix: "" },
          desktop: { port: 3000, auth: true, prefix: "desktop" },
        }),
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
    expect(screen.getByRole("switch", { name: "Enable desktop route" })).toBeChecked();

    fireEvent.click(screen.getByRole("switch", { name: "Enable desktop route" }));
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
          ...((initialAgent.launchConfig as Record<string, unknown>).routes as Record<string, unknown>),
          desktop: { port: 3000, auth: true, prefix: "desktop" },
        },
      },
    };
    const { rerender, props } = renderAgentSettingsPanel({ agent: initialAgent });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(screen.getByRole("switch", { name: "Enable desktop route" })).not.toBeChecked();

    rerender(<AgentSettingsPanel {...props} agent={refreshedAgent} />);

    expect(screen.getByRole("switch", { name: "Enable desktop route" })).toBeChecked();
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

    expect(screen.getByRole("switch", { name: "Enable desktop route" })).not.toBeChecked();
  });

  it("renders usage when selected", () => {
    renderAgentSettingsPanel();

    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(screen.getByRole("button", { name: "Usage" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByText("Usage dashboard")).toBeInTheDocument();
    expect(screen.getByText("API keys")).toBeInTheDocument();
  });

  it("supports opening a controlled settings section", () => {
    const onSectionChange = vi.fn();
    renderAgentSettingsPanel({ activeSection: "index", onSectionChange });

    expect(screen.getByRole("button", { name: "Index" })).toHaveAttribute("aria-current", "page");
    const heading = screen.getByRole("heading", { name: "Memory index" });
    expect(heading).toBeInTheDocument();
    expect(heading.parentElement?.parentElement).toHaveClass("overflow-x-hidden", "overflow-y-auto");
    expect(screen.getByText("Memory search").parentElement?.parentElement).toHaveClass("min-h-0", "py-4");

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    expect(onSectionChange).toHaveBeenCalledWith("agent");
  });

  it("hides its legacy section navigation when embedded", () => {
    renderAgentSettingsPanel({ activeSection: "index", showSectionNavigation: false });

    expect(screen.queryByRole("navigation", { name: "Settings sections" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Memory index" })).toBeInTheDocument();
  });

  it("saves memory index settings through an OpenClaw config patch and syncs launch env", async () => {
    const onSaveOpenClawConfig = vi.fn(async () => undefined);
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onSaveOpenClawConfig, onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Index" }));
    fireEvent.click(screen.getByRole("switch", { name: "Sync on session start" }));
    fireEvent.click(screen.getByRole("switch", { name: "Sync on search" }));
    fireEvent.click(screen.getByRole("switch", { name: "Watch memory files" }));
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
        OPENCLAW_DESKTOP_ENABLED: "0",
        HYPER_API_BASE: "https://api.hypercli.com",
        HYPER_WORKSPACES_BOOT_SYNC: "1",
        HYPER_WORKSPACES_DIR: "/home/node/shared",
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
      sync_uid: 1000,
      sync_gid: 1000,
    });
  });

  it("blocks memory index saves when launch config updates are unavailable", async () => {
    const onSaveOpenClawConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onSaveOpenClawConfig, onUpdateAgentLaunchConfig: undefined });

    fireEvent.click(screen.getByRole("button", { name: "Index" }));
    fireEvent.click(screen.getByRole("switch", { name: "Watch memory files" }));
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
