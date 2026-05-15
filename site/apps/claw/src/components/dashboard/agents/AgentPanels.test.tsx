import { fireEvent, screen, waitFor } from "@testing-library/react";
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

import { AgentList, AgentScheduledEmptyState, AgentSettingsPanel } from "./AgentPanels";

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
  const billingResetAt = new Date("2026-05-21T00:00:00Z");
  const props: ComponentProps<typeof AgentSettingsPanel> = {
    agent,
    user: {
      id: "user-1234567890abcdef",
      email: "test@example.com",
      name: "John Smith",
      walletAddress: "0x1234567890abcdef",
    },
    planName: "Pro Plan",
    tokenUsage: 1200,
    tokenLimit: 50000,
    subscriptionSummary: {
      effectivePlanId: "pro",
      currentSubscriptionId: "sub_123",
      currentEntitlementId: "ent_123",
      pooledTpmLimit: 4000,
      pooledRpmLimit: 120,
      pooledTpd: 50000,
      slotInventory: {},
      billingResetAt,
      activeSubscriptionCount: 1,
      activeEntitlementCount: 1,
      entitlements: {
        effectivePlanId: "pro",
        pooledTpmLimit: 4000,
        pooledRpmLimit: 120,
        pooledTpd: 50000,
        slotInventory: {},
        activeEntitlementCount: 1,
        billingResetAt,
      },
      activeSubscriptions: [
        {
          id: "sub_123",
          userId: "user-1234567890abcdef",
          planId: "pro",
          planName: "Pro Plan",
          provider: "stripe",
          status: "active",
          quantity: 1,
          expiresAt: billingResetAt,
          updatedAt: null,
          stripeSubscriptionId: "stripe_sub_123",
          cancelAtPeriodEnd: false,
          canCancel: true,
          isCurrent: true,
          meta: null,
          planTpmLimit: 4000,
          planRpmLimit: 120,
          planTpd: 50000,
          planAgentTier: null,
          slotGrants: null,
          entitlements: [],
        },
      ],
      subscriptions: [],
      user: {},
    },
    openclawConfig: {
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5-mini",
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
    expect(screen.getByRole("button", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usage" })).toBeInTheDocument();
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
    expect(screen.getByText("Auto-archive idle conversations")).toBeInTheDocument();
    expect(screen.getByText("Agent runtime")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop agent/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start agent/i })).not.toBeInTheDocument();
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

  it("renders billing and usage sections when selected", () => {
    renderAgentSettingsPanel();

    fireEvent.click(screen.getByRole("button", { name: "Billing" }));
    expect(screen.getByRole("button", { name: "Billing" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByText("Pro Plan").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Renews May 21, 2026/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Payment method is managed by Stripe.")).toBeInTheDocument();
    expect(screen.getByText("Plan limits")).toBeInTheDocument();
    expect(screen.getByText("Subscriptions")).toBeInTheDocument();
    expect(screen.getAllByText("Stripe").length).toBeGreaterThan(0);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Cancellation")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Profile" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(screen.getByRole("button", { name: "Usage" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByText("Usage dashboard")).toBeInTheDocument();
    expect(screen.getByText("API keys")).toBeInTheDocument();
  });
});

describe("AgentScheduledEmptyState", () => {
  it("renders the coming soon scheduled work panel", () => {
    renderWithClient(<AgentScheduledEmptyState onCreate={vi.fn()} />);

    expect(screen.getByText("Coming Soon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your work, on autopilot" })).toBeInTheDocument();
    expect(screen.getByText(/Make AI proactive instead of reactive/i)).toBeInTheDocument();
    expect(screen.getByText("Schedule daily reports, summaries, and automated follow-ups")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^start agent$/i })).not.toBeInTheDocument();
  });
});
