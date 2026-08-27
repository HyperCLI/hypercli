import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readPendingPlanCheckout } from "@/lib/plan-checkout-state";
import { renderWithClient } from "@/test/utils";

import { EmbeddedPlanCheckout } from "./EmbeddedPlanCheckout";

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

const plan = {
  id: "pro",
  name: "Pro",
  price: 80,
  bundle: { large: 1 },
  limits: { tpd: 250_000_000, burstTpm: 200_000, rpm: 300 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("EmbeddedPlanCheckout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocks.hyperAgent.createStripeCheckout.mockRejectedValue(new Error("stop before redirect"));
    mocks.hyperAgent.purchaseViaX402WithSigner.mockResolvedValue({});
  });

  it("presents plan details and preserves the Stripe checkout contract", async () => {
    const onProcessingChange = vi.fn();
    const view = renderWithClient(
      <EmbeddedPlanCheckout
        plan={plan}
        principalId="user-1"
        baselineGrantedSlots={{ large: 0 }}
        getToken={vi.fn().mockResolvedValue("token")}
        onSuccess={vi.fn()}
        onComplete={vi.fn()}
        onProcessingChange={onProcessingChange}
      />,
    );

    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();
    expect(screen.getByText("1x Large agent slot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Card, Stripe checkout" })).toHaveAttribute("aria-pressed", "true");
    expect(view.container.querySelector('[data-slot="embedded-checkout-content"]')).toHaveClass("flex", "flex-col");
    expect(view.container.querySelector('[data-slot="embedded-checkout-layout"]')).toHaveClass("m-auto", "shrink-0");
    expect(view.container.querySelector('[data-slot="embedded-checkout-plan-summary"]')).not.toHaveClass("border", "rounded-[16px]", "bg-background");
    fireEvent.click(screen.getByRole("button", { name: "Continue with card" }));

    await waitFor(() => expect(mocks.hyperAgent.createStripeCheckout).toHaveBeenCalledTimes(1));
    const [request, planId] = mocks.hyperAgent.createStripeCheckout.mock.calls[0];
    expect(planId).toBe("pro");
    expect(request).toMatchObject({ quantity: 1 });
    expect(request).not.toHaveProperty("bundle");
    expect(request.successUrl).toContain("checkout=success");
    expect(request.cancelUrl).toContain("checkout=cancelled");
    expect(await screen.findByRole("alert")).toHaveTextContent("stop before redirect");
    expect(onProcessingChange).toHaveBeenNthCalledWith(1, true);
    expect(onProcessingChange).toHaveBeenLastCalledWith(false);
  });

  it("connects a Base wallet and reconciles successful USDC payment", async () => {
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
    const onSuccess = vi.fn();
    const onProcessingChange = vi.fn();

    renderWithClient(
      <EmbeddedPlanCheckout
        plan={plan}
        principalId="user-1"
        baselineGrantedSlots={{ large: 1 }}
        ownedCount={1}
        getToken={vi.fn().mockResolvedValue("token")}
        onSuccess={onSuccess}
        onComplete={vi.fn()}
        onProcessingChange={onProcessingChange}
        firstAgentSetup={{ setupId: "setup-1", workspaceId: "workspace-1", knowledgeCollectionId: null, size: "large" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "USDC, Base via x402" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pay $80 USDC" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({
      checkoutAttemptId: expect.any(String),
      returnSessionId: expect.stringMatching(/^x402:/),
    }));
    expect(mocks.hyperAgent.purchaseViaX402WithSigner.mock.calls[0]?.[1]).not.toHaveProperty("bundle");
    expect(screen.getByRole("heading", { name: "Capacity unlocked" })).toBeInTheDocument();
    expect(readPendingPlanCheckout("user-1")).toMatchObject({
      planId: "pro",
      ownedCount: 1,
      bundle: { large: 1 },
      baselineGrantedSlots: { large: 1 },
      flow: "first-agent-setup",
      setupId: "setup-1",
      workspaceId: "workspace-1",
      agentSize: "large",
    });
    expect(readPendingPlanCheckout("user-1")?.returnSessionId).toMatch(/^x402:/);
    expect(onProcessingChange).toHaveBeenCalledWith(true);
    expect(onProcessingChange).toHaveBeenLastCalledWith(false);
  });

  it("records a committed USDC payment after the checkout view unmounts", async () => {
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
    const purchase = deferred<Record<string, never>>();
    mocks.hyperAgent.purchaseViaX402WithSigner.mockReturnValueOnce(purchase.promise);
    const onSuccess = vi.fn();
    const view = renderWithClient(
      <EmbeddedPlanCheckout
        plan={plan}
        principalId="user-1"
        baselineGrantedSlots={{ large: 0 }}
        getToken={vi.fn().mockResolvedValue("token")}
        onSuccess={onSuccess}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "USDC, Base via x402" }));
    const connectWallet = screen.queryByRole("button", { name: "Connect wallet" });
    if (connectWallet) fireEvent.click(connectWallet);
    fireEvent.click(await screen.findByRole("button", { name: "Pay $80 USDC" }));
    await waitFor(() => expect(mocks.hyperAgent.purchaseViaX402WithSigner).toHaveBeenCalledOnce());
    view.unmount();
    purchase.resolve({});

    await waitFor(() => expect(readPendingPlanCheckout("user-1")?.returnSessionId).toMatch(/^x402:/));
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
