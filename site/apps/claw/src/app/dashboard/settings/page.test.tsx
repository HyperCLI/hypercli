import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({
    getToken: authMocks.getToken,
    user: authMocks.user,
    logout: authMocks.logout,
  }),
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
}));

vi.mock("@/components/dashboard/agents/AgentPanels", () => ({
  AgentList: ({
    agents,
    setSelectedAgentId,
  }: {
    agents: Array<{ id: string; name: string }>;
    setSelectedAgentId: (agentId: string) => void;
  }) => (
    <aside data-testid="agent-list">
      {agents.map((agent) => (
        <button key={agent.id} type="button" onClick={() => setSelectedAgentId(agent.id)}>
          {agent.name}
        </button>
      ))}
    </aside>
  ),
}));

vi.mock("@/components/billing/stripe-billing-portal", () => ({
  createPaymentMethodUpdatePortalUrl: billingMocks.createPaymentMethodUpdatePortalUrl,
  openBillingPortalUrl: billingMocks.openBillingPortalUrl,
}));

vi.mock("@hypercli/shared-ui", () => ({
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
  const billingResetAt = new Date("2026-05-21T00:00:00Z");
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
          currentPeriodEnd: new Date("2026-05-21T00:00:00Z"),
          stripeSubscriptionId: "stripe_sub_123",
        },
        entitlement: {
          id: "ent_123",
          planId: "pro",
          provider: "stripe",
          status: "active",
          expiresAt: new Date("2026-05-21T00:00:00Z"),
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
    setupBillingMocks();
  });

  it("renders billing beside the agents list without a settings sections menu", async () => {
    const user = userEvent.setup();

    render(<SettingsPage />);

    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
    expect(await screen.findByTestId("agent-list")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Research Agent" }));

    expect(navigationMocks.push).toHaveBeenCalledWith("/dashboard/agents?agentId=agent-1");
    expect((await screen.findAllByText(/Pro Plan/)).length).toBeGreaterThan(0);
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
