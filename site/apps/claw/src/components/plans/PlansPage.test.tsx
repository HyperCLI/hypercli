import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import PlansPage from "./PlansPage";

const mocks = vi.hoisted(() => {
  const hyperAgent = {
    plans: vi.fn(),
    currentPlan: vi.fn(),
    subscriptionSummary: vi.fn(),
    cancelSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    redeemGrantCode: vi.fn(),
  };

  return {
    getToken: vi.fn(),
    unstableTokenGetter: false,
    createHyperAgentClient: vi.fn(() => hyperAgent),
    hyperAgent,
  };
});

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({
    getToken: mocks.unstableTokenGetter ? () => mocks.getToken() : mocks.getToken,
    user: { id: "user-1" },
  }),
}));

vi.mock("@/lib/agent-client", () => ({
  createHyperAgentClient: mocks.createHyperAgentClient,
}));

vi.mock("@/components/PlanCheckoutModal", () => ({
  PlanCheckoutModal: ({ isOpen, plan }: { isOpen: boolean; plan: { id: string; bundle?: Record<string, number> } }) =>
    isOpen ? (
      <div role="dialog">
        Checkout {plan.id} {plan.bundle ? `with bundle ${JSON.stringify(plan.bundle)}` : "without bundle"}
      </div>
    ) : null,
}));

function buildSummary(overrides: Record<string, unknown> = {}) {
  return {
    effectivePlanId: "free",
    currentSubscriptionId: null,
    currentEntitlementId: null,
    pooledTpmLimit: 0,
    pooledRpmLimit: 0,
    pooledTpd: 0,
    slotInventory: {},
    billingResetAt: null,
    activeSubscriptionCount: 0,
    activeEntitlementCount: 0,
    entitlements: {
      effectivePlanId: "free",
      pooledTpmLimit: 0,
      pooledRpmLimit: 0,
      pooledTpd: 0,
      slotInventory: {},
      activeEntitlementCount: 0,
      billingResetAt: null,
    },
    activeSubscriptions: [],
    subscriptions: [],
    user: {},
    ...overrides,
  };
}

describe("PlansPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.unstableTokenGetter = false;
    mocks.getToken.mockResolvedValue("token");
    mocks.hyperAgent.currentPlan.mockResolvedValue({
      id: "free",
      name: "Free",
      price: 0,
      tpmLimit: 0,
      rpmLimit: 0,
      expiresAt: null,
      cancelAtPeriodEnd: false,
      pooledTpd: 0,
      slotInventory: {},
    });
    mocks.hyperAgent.subscriptionSummary.mockResolvedValue(buildSummary());
    mocks.hyperAgent.cancelSubscription.mockResolvedValue({ ok: true, message: "Cancellation scheduled" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders purchase cards from the SDK plan catalog", async () => {
    mocks.hyperAgent.plans.mockResolvedValue([
      {
        id: "catalog-pro",
        name: "Catalog Pro",
        price: 123,
        priceUsd: 123,
        aiu: 5,
        agents: 1,
        features: ["SDK catalog feature"],
        models: ["kimi-k2.5"],
        highlighted: true,
        limits: {
          tpd: 123_000_000,
          tpm: 0,
          burstTpm: 456_000,
          rpm: 789,
        },
        tpmLimit: 0,
        rpmLimit: 789,
      },
    ]);

    renderWithClient(<PlansPage />);

    expect(await screen.findByRole("heading", { name: "Catalog Pro" })).toBeVisible();
    expect(mocks.hyperAgent.plans).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Starter" })).not.toBeInTheDocument();
    expect(screen.getByText("$123")).toBeVisible();
    expect(screen.getByText("SDK catalog feature")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /purchase/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Checkout catalog-pro without bundle");
  });

  it("blocks checkout until billing data loads successfully", async () => {
    mocks.hyperAgent.plans.mockResolvedValue([{
      id: "catalog-pro",
      name: "Catalog Pro",
      price: 123,
      priceUsd: 123,
      aiu: 5,
      agents: 1,
      features: [],
      models: [],
      highlighted: true,
      limits: { tpd: 123_000_000, tpm: 0, burstTpm: 456_000, rpm: 789 },
      tpmLimit: 0,
      rpmLimit: 789,
      meta: { checkout_bundle: { large: 1 } },
    }]);
    mocks.hyperAgent.subscriptionSummary.mockRejectedValueOnce(new Error("billing unavailable"));

    renderWithClient(<PlansPage />);

    expect(await screen.findByText("Billing data could not be loaded. Retry before checkout.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Billing unavailable" })).toBeDisabled();

    mocks.hyperAgent.subscriptionSummary.mockResolvedValue(buildSummary());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Purchase" })).toBeEnabled());
  });

  it("does not restart plan loading when the auth token getter identity changes", async () => {
    mocks.unstableTokenGetter = true;
    mocks.hyperAgent.plans.mockResolvedValue([
      {
        id: "catalog-pro",
        name: "Catalog Pro",
        price: 80,
        priceUsd: 80,
        aiu: 5,
        agents: 1,
        features: ["SDK catalog feature"],
        models: ["kimi-k2.5"],
        highlighted: true,
        limits: {
          tpd: 80_000_000,
          tpm: 0,
          burstTpm: 456_000,
          rpm: 789,
        },
        tpmLimit: 0,
        rpmLimit: 789,
        bundle: { medium: 1 },
      },
    ]);

    renderWithClient(<PlansPage />);

    expect(await screen.findByRole("heading", { name: "Catalog Pro" })).toBeVisible();
    await waitFor(() => expect(mocks.hyperAgent.plans).toHaveBeenCalledTimes(1));
  });

  it("renders catalog plans when subscription summary hangs", async () => {
    mocks.hyperAgent.plans.mockResolvedValue([
      {
        id: "catalog-pro",
        name: "Catalog Pro",
        price: 80,
        priceUsd: 80,
        aiu: 5,
        agents: 1,
        features: ["SDK catalog feature"],
        models: ["kimi-k2.5"],
        highlighted: true,
        limits: {
          tpd: 80_000_000,
          tpm: 0,
          burstTpm: 456_000,
          rpm: 789,
        },
        tpmLimit: 0,
        rpmLimit: 789,
        bundle: { medium: 1 },
      },
    ]);
    mocks.hyperAgent.subscriptionSummary.mockImplementation(() => new Promise(() => {}));

    renderWithClient(<PlansPage />);

    expect(await screen.findByRole("heading", { name: "Catalog Pro" }, { timeout: 6_000 })).toBeVisible();
  }, 7_000);

  it("uses SDK catalog bundle metadata when the plan exposes it", async () => {
    mocks.hyperAgent.plans.mockResolvedValue([
      {
        id: "catalog-medium",
        name: "Catalog Medium",
        price: 80,
        priceUsd: 80,
        aiu: 3,
        agents: 1,
        features: [],
        models: [],
        highlighted: false,
        limits: {
          tpd: 80_000_000,
          tpm: 0,
          burstTpm: 100_000,
          rpm: 300,
        },
        tpmLimit: 0,
        rpmLimit: 300,
        bundle: { medium: 1 },
      },
    ]);

    renderWithClient(<PlansPage />);

    expect(await screen.findByRole("heading", { name: "Catalog Medium" })).toBeVisible();
    expect(screen.getByText("1x Medium")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /purchase/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent('Checkout catalog-medium with bundle {"medium":1}');
  });

  it("shows waiting entitlement state when a paid plan has not exposed launch slots yet", async () => {
    mocks.hyperAgent.plans.mockResolvedValue([
      {
        id: "catalog-pro",
        name: "Catalog Pro",
        price: 20,
        priceUsd: 20,
        aiu: 5,
        agents: 1,
        features: [],
        models: [],
        highlighted: false,
        limits: {
          tpd: 50_000_000,
          tpm: 0,
          burstTpm: 100_000,
          rpm: 300,
        },
        tpmLimit: 0,
        rpmLimit: 300,
        bundle: { medium: 1 },
      },
    ]);
    mocks.hyperAgent.subscriptionSummary.mockResolvedValue(
      buildSummary({
        effectivePlanId: "catalog-pro",
        activeEntitlementCount: 1,
        entitlements: {
          effectivePlanId: "catalog-pro",
          pooledTpmLimit: 0,
          pooledRpmLimit: 300,
          pooledTpd: 50_000_000,
          slotInventory: {},
          activeEntitlementCount: 1,
          billingResetAt: null,
        },
      }),
    );

    renderWithClient(<PlansPage />);

    expect(await screen.findByRole("heading", { name: "Catalog Pro" })).toBeVisible();
    expect(screen.getByText("Payment active, waiting for entitlement")).toBeVisible();
    expect(screen.getByText("Current anchor: Catalog Pro")).toBeVisible();
    expect(screen.getByRole("button", { name: /refresh billing/i })).toBeVisible();
  });

  it("reflects an owned launchable plan once SDK slot inventory is available", async () => {
    mocks.hyperAgent.plans.mockResolvedValue([
      {
        id: "catalog-pro",
        name: "Catalog Pro",
        price: 20,
        priceUsd: 20,
        aiu: 5,
        agents: 1,
        features: [],
        models: [],
        highlighted: false,
        limits: {
          tpd: 50_000_000,
          tpm: 0,
          burstTpm: 100_000,
          rpm: 300,
        },
        tpmLimit: 0,
        rpmLimit: 300,
        bundle: { medium: 1 },
      },
    ]);
    mocks.hyperAgent.subscriptionSummary.mockResolvedValue(
      buildSummary({
        effectivePlanId: "catalog-pro",
        activeEntitlementCount: 1,
        slotInventory: {
          medium: { granted: 1, used: 0, available: 1 },
        },
        entitlements: {
          effectivePlanId: "catalog-pro",
          pooledTpmLimit: 0,
          pooledRpmLimit: 300,
          pooledTpd: 50_000_000,
          slotInventory: {
            medium: { granted: 1, used: 0, available: 1 },
          },
          activeEntitlementCount: 1,
          billingResetAt: null,
        },
      }),
    );

    renderWithClient(<PlansPage />);

    expect(await screen.findByRole("heading", { name: "Catalog Pro" })).toBeVisible();
    expect(screen.getByText("You own 1")).toBeVisible();
    expect(screen.getByRole("button", { name: /add another/i })).toBeVisible();
  });

  it("redeems activation codes without requesting extension by default", async () => {
    mocks.hyperAgent.plans.mockResolvedValue([]);
    mocks.hyperAgent.redeemGrantCode.mockResolvedValue({
      grant: {
        id: "grant-1",
        code: "promo-123",
        planId: "basic",
      },
      entitlement: {
        id: "ent-1",
        planId: "basic",
        planName: "Basic",
        expiresAt: new Date("2026-05-27T00:00:00.000Z"),
      },
    });

    renderWithClient(<PlansPage />);

    fireEvent.click(await screen.findByRole("button", { name: /activate a code/i }));
    fireEvent.change(screen.getByLabelText(/activation code/i), { target: { value: " promo-123 " } });
    fireEvent.click(screen.getByRole("button", { name: /^activate code$/i }));

    await waitFor(() => expect(mocks.hyperAgent.redeemGrantCode).toHaveBeenCalledWith("promo-123"));
    expect(mocks.hyperAgent.redeemGrantCode).not.toHaveBeenCalledWith("promo-123", expect.anything());
  });

  it("uses the SDK cancelSubscription method for recurring subscription cancellation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.hyperAgent.plans.mockResolvedValue([]);
    mocks.hyperAgent.subscriptionSummary.mockResolvedValue(
      buildSummary({
        activeSubscriptionCount: 1,
        activeEntitlementCount: 1,
        subscriptions: [
          {
            id: "sub-cancel",
            userId: "user-1",
            planId: "catalog-pro",
            planName: "Catalog Pro",
            provider: "stripe",
            status: "active",
            quantity: 1,
            expiresAt: new Date("2026-06-01T00:00:00.000Z"),
            updatedAt: null,
            stripeSubscriptionId: "stripe-sub",
            cancelAtPeriodEnd: false,
            canCancel: true,
            isCurrent: true,
            meta: null,
            planTpmLimit: 0,
            planRpmLimit: 300,
            planTpd: 50_000_000,
            planAgentTier: "medium",
            slotGrants: { medium: 1 },
          },
        ],
      }),
    );

    renderWithClient(<PlansPage />);

    fireEvent.click(await screen.findByRole("button", { name: /cancel at period end/i }));

    await waitFor(() => expect(mocks.hyperAgent.cancelSubscription).toHaveBeenCalledWith("sub-cancel"));
    expect(mocks.hyperAgent.updateSubscription).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
