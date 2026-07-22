import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  logout: vi.fn(),
  user: {
    id: "user-1234567890abcdef",
    email: "john@example.com",
    walletAddress: "0x1234567890abcdef",
  },
}));

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

const workspaceMocks = vi.hoisted(() => ({
  context: {
    selectedWorkspaceAgentIds: ["agent-1"] as string[],
    isAgentRosterLoading: false,
    agentRosterError: null as string | null,
  },
}));

const billingMocks = vi.hoisted(() => {
  const agentClient = {
    delete: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  };
  const hyperAgent = {
    payments: vi.fn(),
    billingProfile: vi.fn(),
    subscriptionSummary: vi.fn(),
    updateBillingProfile: vi.fn(),
    cancelSubscription: vi.fn(),
  };
  return {
    agentClient,
    createAgentClient: vi.fn(() => agentClient),
    createHyperAgentClient: vi.fn(() => hyperAgent),
    createOpenClawAgent: vi.fn(async () => ({ id: "agent-new" })),
    createPaymentMethodUpdatePortalUrl: vi.fn(async () => "https://billing.stripe.com/p/session/test"),
    hyperAgent,
    openBillingPortalUrl: vi.fn(),
  };
});

const slackMocks = vi.hoisted(() => ({
  getSlackInstallStatus: vi.fn(),
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({
    getToken: authMocks.getToken,
    user: authMocks.user,
    logout: authMocks.logout,
  }),
}));

vi.mock("@/components/dashboard/WorkspaceContext", () => ({
  useWorkspace: () => workspaceMocks.context,
  workspaceAgentCreationDisabledReason: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMocks.push }),
}));

vi.mock("@/lib/agent-client", () => ({
  createAgentClient: billingMocks.createAgentClient,
  createHyperAgentClient: billingMocks.createHyperAgentClient,
  createOpenClawAgent: billingMocks.createOpenClawAgent,
}));

vi.mock("@/lib/api", () => ({
  API_BASE_URL: "https://api.hypercli.com/agents",
  AUTH_BASE_URL: "https://api.hypercli.com/api",
  SLACK_APP_HANDLE: "hyperdev",
  SLACK_RELAY_BASE_URL: "https://api.agents.dev.hypercli.com",
}));

vi.mock("@hypercli.com/sdk/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hypercli.com/sdk/agents")>();
  return {
    ...actual,
    getSlackInstallStatus: slackMocks.getSlackInstallStatus,
  };
});

vi.mock("@/components/dashboard/agents/AgentPanels", () => ({
  AgentList: ({
    agents,
    rosterLoading,
    selectedAgentId,
    setSelectedAgentId,
    setPendingAgentDelete,
  }: {
    agents: Array<{ id: string; name: string }>;
    rosterLoading?: boolean;
    selectedAgentId: string | null;
    setSelectedAgentId: (agentId: string) => void;
    setPendingAgentDelete: (agent: { id: string; name: string }) => void;
  }) => (
    <aside
      data-testid="agent-list"
      data-roster-loading={String(Boolean(rosterLoading))}
      data-selected-agent-id={selectedAgentId ?? ""}
    >
      {agents.map((agent) => (
        <div key={agent.id}>
          <button type="button" onClick={() => setSelectedAgentId(agent.id)}>{agent.name}</button>
          <button type="button" aria-label={`Delete ${agent.name}`} onClick={() => setPendingAgentDelete(agent)}>Delete</button>
        </div>
      ))}
    </aside>
  ),
}));

vi.mock("@/components/dashboard/agents/DashboardWorkspaceNavigation", () => ({
  DashboardWorkspaceNavigation: ({ selectedAgent }: { selectedAgent: { id: string } | null }) => (
    <aside data-testid="workspace-navigation" data-agent-id={selectedAgent?.id ?? ""} />
  ),
}));

vi.mock("@/components/billing/stripe-billing-portal", () => ({
  createPaymentMethodUpdatePortalUrl: billingMocks.createPaymentMethodUpdatePortalUrl,
  openBillingPortalUrl: billingMocks.openBillingPortalUrl,
}));

vi.mock("@hypercli/shared-ui", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  ThemeSelector: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => (
    <button type="button" aria-label={ariaLabel}>Theme</button>
  ),
  ConfirmDialog: ({ open, title, message, confirmLabel, onCancel, onConfirm }: {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
  }) => open ? (
    <div role="dialog" aria-label={title}>
      <p>{message}</p>
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" onClick={onConfirm}>{confirmLabel}</button>
    </div>
  ) : null,
  ShimmerSkeleton: ({ className }: { className?: string }) => <div className={className} data-testid="skeleton" />,
  InvoiceSummaryCard: ({ label, value, description }: { label: string; value: string; description: string }) => (
    <section>
      <h3>{label}</h3>
      <p>{value}</p>
      <p>{description}</p>
    </section>
  ),
  ReceiptList: ({
    receipts,
    renderActions,
    renderMeta,
    title,
  }: {
    receipts: Array<Record<string, any> & { id: string }>;
    renderActions?: (receipt: Record<string, any> & { id: string }) => ReactNode;
    renderMeta?: (receipt: Record<string, any> & { id: string }) => ReactNode;
    title?: string;
  }) => (
    <section>
      <h2>{title ?? "Receipts"}</h2>
      {receipts.map((receipt) => (
        <div key={receipt.id}>
          <span>{receipt.id}</span>
          {renderMeta?.(receipt)}
          {renderActions?.(receipt)}
        </div>
      ))}
    </section>
  ),
}));

import SettingsPage from "./page";

function buildSubscriptionSummary() {
  const billingResetAt = new Date("2026-05-21T12:00:00Z");
  return {
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
    entitlementItems: [
      {
        id: "ent_123",
        userId: "user-1234567890abcdef",
        subscriptionId: "sub_123",
        planId: "pro",
        planName: "Pro Plan",
        provider: "stripe",
        status: "active",
        startsAt: null,
        expiresAt: billingResetAt,
        updatedAt: null,
        tpmLimit: 4000,
        rpmLimit: 120,
        tpdLimit: 50000,
        agentTier: "medium",
        features: {},
        tags: [],
        meta: null,
        slotGrants: { medium: 1 },
        activeAgentCount: 1,
        activeAgentIds: ["agent-1"],
      },
    ],
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
        planAgentTier: "medium",
        slotGrants: { medium: 1 },
        entitlements: [],
      },
    ],
    subscriptions: [],
    user: {},
  };
}

function setupBillingMocks() {
  authMocks.getToken.mockResolvedValue("token");
  billingMocks.agentClient.list.mockResolvedValue([{ id: "agent-1", name: "Research Agent", userId: "user-123", state: "running" }]);
  billingMocks.agentClient.update.mockResolvedValue({ id: "agent-1", name: "Renamed Agent", userId: "user-123", state: "running" });
  billingMocks.agentClient.delete.mockResolvedValue({ ok: true });
  billingMocks.hyperAgent.payments.mockResolvedValue({
    items: [
      {
        id: "pay_1234567890",
        userId: "user-1234567890abcdef",
        subscriptionId: "sub_123",
        entitlementId: "ent_123",
        provider: "stripe",
        status: "succeeded",
        amount: "7900",
        currency: "usd",
        externalPaymentId: "pi_123",
        createdAt: new Date("2026-04-20T00:00:00Z"),
        updatedAt: new Date("2026-04-20T00:00:00Z"),
        user: {
          id: "user-1234567890abcdef",
          email: "john@example.com",
          walletAddress: null,
          teamId: null,
          planId: "pro",
        },
        subscription: {
          id: "sub_123",
          planId: "pro",
          provider: "stripe",
          status: "active",
          currentPeriodEnd: new Date("2026-05-21T12:00:00Z"),
          stripeSubscriptionId: "stripe_sub_123",
        },
        entitlement: {
          id: "ent_123",
          planId: "pro",
          provider: "stripe",
          status: "active",
          expiresAt: new Date("2026-05-21T12:00:00Z"),
          agentTier: "medium",
          features: {},
          tags: [],
        },
      },
    ],
  });
  billingMocks.hyperAgent.billingProfile.mockResolvedValue({
    companyBilling: {
      address: ["HyperCLI Agents", "Agents billing"],
      email: "support@hypercli.com",
    },
    profile: {
      billingName: "John Smith",
      billingCompany: "Acme Inc",
      billingTaxId: "",
      billingLine1: "",
      billingLine2: "",
      billingCity: "",
      billingState: "",
      billingPostalCode: "",
      billingCountry: "",
    },
  });
  billingMocks.hyperAgent.subscriptionSummary.mockResolvedValue(buildSubscriptionSummary());
  billingMocks.hyperAgent.cancelSubscription.mockResolvedValue({ ok: true, message: "Cancellation scheduled" });
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceMocks.context.selectedWorkspaceAgentIds = ["agent-1"];
    workspaceMocks.context.isAgentRosterLoading = false;
    workspaceMocks.context.agentRosterError = null;
    setupBillingMocks();
    slackMocks.getSlackInstallStatus.mockResolvedValue({
      connected: false,
      teamId: null,
      teamName: null,
      botUserId: null,
      updatedAt: null,
    });
  });

  it("renders billing beside the agents list without a settings sections menu", async () => {
    const user = userEvent.setup();

    render(<SettingsPage />);

    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
    expect(await screen.findByTestId("agent-list")).toBeInTheDocument();
    expect(await screen.findByTestId("workspace-navigation")).toHaveAttribute("data-agent-id", "agent-1");
    const desktopNavigation = document.querySelector(".agent-desktop-navigation");
    expect(desktopNavigation).toHaveClass("w-64", "pt-14");
    const navigationSections = document.querySelector(".agent-desktop-navigation-sections");
    expect(navigationSections).toHaveClass("relative", "isolate", "mt-2", "flex-1");
    expect(navigationSections?.querySelector("[aria-hidden='true'].absolute.right-0")).toHaveClass("-top-2", "bottom-0", "bg-border");
    expect(navigationSections).toContainElement(screen.getByTestId("agent-list"));
    expect(navigationSections).toContainElement(screen.getByTestId("workspace-navigation"));
    expect(await screen.findByRole("heading", { name: "Slack" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Slack" })).toHaveAttribute("href", "/slack/start");
    expect(screen.getByRole("link", { name: "Debug" })).toHaveAttribute("href", "/slack/status");
    await user.click(await screen.findByRole("button", { name: "Research Agent" }));

    expect(navigationMocks.push).toHaveBeenCalledWith("/dashboard/agents?agentId=agent-1");
    expect((await screen.findAllByText(/Pro Plan/)).length).toBeGreaterThan(0);
  });

  it("shows connected Slack workspace status in settings", async () => {
    slackMocks.getSlackInstallStatus.mockResolvedValue({
      connected: true,
      teamId: "T123",
      teamName: "Test Workspace",
      botUserId: "U123",
      updatedAt: "2026-07-19T19:00:00+00:00",
    });

    render(<SettingsPage />);

    expect(await screen.findByText("@hyperdev is connected to Test Workspace.")).toBeInTheDocument();
    expect(screen.getByText("Team T123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect Slack" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Reconnect Slack" })).toHaveAttribute("href", "/slack/start");
  });

  it("selects the next agent after deleting the active workspace", async () => {
    const user = userEvent.setup();
    workspaceMocks.context.selectedWorkspaceAgentIds = ["agent-1", "agent-2"];
    billingMocks.agentClient.list.mockResolvedValue([
      { id: "agent-1", name: "Research Agent", userId: "user-123", state: "running" },
      { id: "agent-account", name: "Account Catalog Agent", userId: "user-123", state: "running" },
      { id: "agent-2", name: "Writer Agent", userId: "user-123", state: "stopped" },
    ]);

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("agent-list")).toHaveAttribute("data-selected-agent-id", "agent-1");
    });
    expect(within(screen.getByTestId("agent-list")).queryByRole("button", { name: "Account Catalog Agent" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete Research Agent" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByTestId("agent-list")).toHaveAttribute("data-selected-agent-id", "agent-2");
      expect(screen.getByTestId("workspace-navigation")).toHaveAttribute("data-agent-id", "agent-2");
    });
  });

  it("reconciles selection after Workspace membership resolves", async () => {
    workspaceMocks.context.isAgentRosterLoading = true;
    billingMocks.agentClient.list.mockResolvedValue([
      { id: "agent-1", name: "Research Agent", userId: "user-123", state: "running" },
      { id: "agent-2", name: "Writer Agent", userId: "user-123", state: "stopped" },
    ]);

    const { rerender } = render(<SettingsPage />);

    await waitFor(() => expect(billingMocks.agentClient.list).toHaveBeenCalled());
    expect(screen.getByTestId("agent-list")).toBeEmptyDOMElement();
    expect(screen.getByTestId("agent-list")).toHaveAttribute("data-roster-loading", "true");

    workspaceMocks.context.selectedWorkspaceAgentIds = ["agent-2"];
    workspaceMocks.context.isAgentRosterLoading = false;
    rerender(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("agent-list")).toHaveAttribute("data-selected-agent-id", "agent-2");
      expect(screen.getByTestId("workspace-navigation")).toHaveAttribute("data-agent-id", "agent-2");
    });
    expect(within(screen.getByTestId("agent-list")).getByRole("button", { name: "Writer Agent" })).toBeInTheDocument();
    expect(within(screen.getByTestId("agent-list")).queryByRole("button", { name: "Research Agent" })).not.toBeInTheDocument();
  });

  it("surfaces Workspace membership errors without exposing account agents", async () => {
    workspaceMocks.context.agentRosterError = "Could not load Workspace agents.";

    render(<SettingsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Could not load Workspace agents.");
    await waitFor(() => expect(billingMocks.agentClient.list).toHaveBeenCalled());
    expect(screen.getByTestId("agent-list")).toBeEmptyDOMElement();
  });

  it("renders consolidated billing with card management, cancellation, and agent attribution", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SettingsPage />);

    expect((await screen.findAllByText(/Pro Plan/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/auto renew on May 21, 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/Agent: Research Agent/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Adjust plan" })).toHaveAttribute("href", "/adjust-plan");
    expect(screen.getByText("Keeps access until May 21, 2026.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /manage card/i }));
    await waitFor(() => {
      expect(billingMocks.openBillingPortalUrl).toHaveBeenCalledWith("https://billing.stripe.com/p/session/test");
    });
    expect(billingMocks.createPaymentMethodUpdatePortalUrl).toHaveBeenCalledWith(billingMocks.hyperAgent);

    await user.click(screen.getByRole("button", { name: /cancel pro plan at period end/i }));

    await waitFor(() => expect(billingMocks.hyperAgent.cancelSubscription).toHaveBeenCalledWith("sub_123"));
    expect(screen.getByText("Cancellation scheduled")).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("does not show card management for non-Stripe billing", async () => {
    const summary = buildSubscriptionSummary();
    summary.activeSubscriptions[0] = {
      ...summary.activeSubscriptions[0],
      provider: "x402",
    };
    billingMocks.hyperAgent.subscriptionSummary.mockResolvedValue(summary);
    billingMocks.hyperAgent.payments.mockResolvedValue({ items: [] });

    render(<SettingsPage />);

    expect((await screen.findAllByText("USDC wallet payments")).length).toBeGreaterThan(0);
    expect(screen.getByText("No card settings")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage card/i })).not.toBeInTheDocument();
  });
});
