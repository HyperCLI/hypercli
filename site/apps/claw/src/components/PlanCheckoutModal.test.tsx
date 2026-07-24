import { fireEvent, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { readPendingPlanCheckout } from "@/lib/plan-checkout-state";
import { PlanCheckoutModal } from "./PlanCheckoutModal";

const mocks = vi.hoisted(() => {
  const hyperAgent = {
    createStripeCheckout: vi.fn(),
    purchaseViaX402WithSigner: vi.fn(),
  };

  return {
    createHyperAgentClient: vi.fn(() => hyperAgent),
    hyperAgent,
  };
});

vi.mock("@/lib/agent-client", () => ({
  createHyperAgentClient: mocks.createHyperAgentClient,
}));

describe("PlanCheckoutModal", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocks.hyperAgent.createStripeCheckout.mockRejectedValue(new Error("stop before redirect"));
    mocks.hyperAgent.purchaseViaX402WithSigner.mockResolvedValue({});
  });

  it("does not persist or redirect after the initiating modal unmounts", async () => {
    let resolveCheckout!: (value: { checkoutUrl: string }) => void;
    mocks.hyperAgent.createStripeCheckout.mockReturnValue(new Promise((resolve) => {
      resolveCheckout = resolve;
    }));
    const view = renderWithClient(
      <PlanCheckoutModal
        plan={{
          id: "catalog-pro",
          name: "Catalog Pro",
          price: 123,
          limits: { tpd: 123_000_000, burstTpm: 456_000, rpm: 789 },
        }}
        isOpen
        principalId="user-1"
        ownedCount={1}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        getToken={vi.fn().mockResolvedValue("token")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pay $123 with Card" }));
    await waitFor(() => expect(mocks.hyperAgent.createStripeCheckout).toHaveBeenCalledOnce());
    view.unmount();
    resolveCheckout({ checkoutUrl: "https://checkout.stripe.com/example" });
    await Promise.resolve();
    await Promise.resolve();

    expect(readPendingPlanCheckout("user-1")).toBeNull();
  });

  it("keeps the checkout lifecycle active through Strict Mode effect replay", async () => {
    renderWithClient(
      <StrictMode>
        <PlanCheckoutModal
          plan={{
            id: "catalog-pro",
            name: "Catalog Pro",
            price: 123,
            limits: { tpd: 123_000_000, burstTpm: 456_000, rpm: 789 },
          }}
          isOpen
          principalId="user-1"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          getToken={vi.fn().mockResolvedValue("token")}
        />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pay $123 with Card" }));

    await waitFor(() => expect(mocks.hyperAgent.createStripeCheckout).toHaveBeenCalledOnce());
  });

  it("starts entitlement reconciliation immediately after x402 succeeds", async () => {
    const onSuccess = vi.fn();
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      value: {
        request: vi.fn(async ({ method }: { method: string }) => {
          if (method === "eth_requestAccounts") return ["0x0000000000000000000000000000000000000001"];
          if (method === "eth_chainId") return "0x2105";
          return null;
        }),
      },
    });
    renderWithClient(
      <PlanCheckoutModal
        plan={{
          id: "catalog-pro",
          name: "Catalog Pro",
          price: 123,
          bundle: { large: 1 },
          limits: { tpd: 123_000_000, burstTpm: 456_000, rpm: 789 },
        }}
        isOpen
        principalId="user-1"
        baselineGrantedSlots={{ large: 1 }}
        ownedCount={1}
        onClose={vi.fn()}
        onSuccess={onSuccess}
        getToken={vi.fn().mockResolvedValue("token")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /USDC x402/i }));
    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pay $123 with USDC" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(readPendingPlanCheckout("user-1")).toMatchObject({
      planId: "catalog-pro",
      ownedCount: 1,
      baselineGrantedSlots: { large: 1 },
      bundle: { large: 1 },
    });
    expect(readPendingPlanCheckout("user-1")?.returnSessionId).toMatch(/^x402:/);
  });

  it("omits bundle from card checkout when a catalog plan has no bundle metadata", async () => {
    renderWithClient(
      <PlanCheckoutModal
        plan={{
          id: "catalog-pro",
          name: "Catalog Pro",
          price: 123,
          limits: {
            tpd: 123_000_000,
            burstTpm: 456_000,
            rpm: 789,
          },
        }}
        isOpen
        principalId="user-1"
        ownedCount={0}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        getToken={vi.fn().mockResolvedValue("token")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pay $123 with Card" }));

    await waitFor(() => expect(mocks.hyperAgent.createStripeCheckout).toHaveBeenCalledTimes(1));
    const [request, planId] = mocks.hyperAgent.createStripeCheckout.mock.calls[0];
    expect(planId).toBe("catalog-pro");
    expect(request).toMatchObject({ quantity: 1 });
    expect(request.successUrl).toContain("checkout=success");
    expect(request.successUrl).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect(request.cancelUrl).toContain("checkout=cancelled");
    expect(request).not.toHaveProperty("bundle");
  });
});
