import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: "0",
      FOO: "bar",
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

  renderWithClient(<AgentSettingsPanel {...props} />);
  return props;
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

    fireEvent.click(screen.getByTitle("Expand sidebar"));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(false);
  });

  it("only collapses the expanded agents/channels sidebar from its explicit collapse control", () => {
    const props = renderAgentList({ sidebarCollapsed: false });

    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    expect(props.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it("opens the launch agent wizard from the expanded agents list button", () => {
    renderAgentList({ sidebarCollapsed: false });

    fireEvent.click(screen.getByRole("button", { name: /launch agent/i }));
    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();
  });

  it("shows the launch agent button in the collapsed rail", () => {
    renderAgentList();

    fireEvent.click(screen.getByRole("button", { name: /launch agent/i }));
    expect(screen.getByText("First agent setup wizard")).toBeInTheDocument();
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
    expect(screen.getByText("Agent Name")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test Agent")).toBeInTheDocument();
    expect(screen.getByText("Default model")).toBeInTheDocument();
    expect(screen.getByText("Visibility")).toBeInTheDocument();
    expect(screen.getByText("Auto-archive idle projects")).toBeInTheDocument();
    expect(screen.getByText("Agent runtime")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop agent/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Danger Zone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start agent/i })).not.toBeInTheDocument();
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

  it("saves the agent name through the agent update callback", async () => {
    const onUpdateAgentName = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentName });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));
    fireEvent.change(screen.getByDisplayValue("Test Agent"), { target: { value: "Renamed Agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentName).toHaveBeenCalledWith("agent-1", "Renamed Agent");
    });
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
  });

  it("saves Docker image and user additional env while preserving managed launch env", async () => {
    const onUpdateAgentLaunchConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onUpdateAgentLaunchConfig });

    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    expect(screen.getByRole("textbox", { name: "Agent Docker image" })).toHaveValue("ghcr.io/hypercli/hypercli-openclaw:prod");
    expect(screen.getByRole("textbox", { name: "Additional env" })).toHaveValue("FOO=bar");
    expect(screen.queryByDisplayValue(/OPENCLAW_GATEWAY_TOKEN/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Agent Docker image" }), {
      target: { value: "ghcr.io/hypercli/hypercli-openclaw:custom" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Additional env" }), {
      target: { value: "FOO=baz\nCUSTOM_FLAG=1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onUpdateAgentLaunchConfig).toHaveBeenCalledWith("agent-1", {
        image: "ghcr.io/hypercli/hypercli-openclaw:custom",
        env: {
          OPENCLAW_GATEWAY_TOKEN: "gateway-token",
          OPENCLAW_DESKTOP_ENABLED: "0",
          OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: "0",
          FOO: "baz",
          CUSTOM_FLAG: "1",
        },
        routes: {
          openclaw: { port: 18789, auth: false, prefix: "" },
        },
        sync_root: "/home/node",
        sync_enabled: true,
      });
    });
    expect(screen.getByText("Agent settings updated.")).toBeInTheDocument();
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

  it("renders usage when selected", () => {
    renderAgentSettingsPanel();

    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(screen.getByRole("button", { name: "Usage" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByText("Usage dashboard")).toBeInTheDocument();
    expect(screen.getByText("API keys")).toBeInTheDocument();
  });

  it("saves memory index settings through an OpenClaw config patch", async () => {
    const onSaveOpenClawConfig = vi.fn(async () => undefined);
    renderAgentSettingsPanel({ onSaveOpenClawConfig });

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
