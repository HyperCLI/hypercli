import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import PlansPage from "./page";

const mocks = vi.hoisted(() => {
  const hyperAgent = {
    plans: vi.fn(),
    currentPlan: vi.fn(),
    subscriptionSummary: vi.fn(),
    updateSubscription: vi.fn(),
    redeemGrantCode: vi.fn(),
  };

  return {
    getToken: vi.fn(),
    createHyperAgentClient: vi.fn(() => hyperAgent),
    hyperAgent,
  };
});

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({
    getToken: mocks.getToken,
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
});
