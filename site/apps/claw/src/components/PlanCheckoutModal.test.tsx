import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { PlanCheckoutModal } from "./PlanCheckoutModal";

const mocks = vi.hoisted(() => {
  const hyperAgent = {
    createStripeCheckout: vi.fn(),
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
    vi.clearAllMocks();
    mocks.hyperAgent.createStripeCheckout.mockRejectedValue(new Error("stop before redirect"));
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
    expect(request).not.toHaveProperty("bundle");
  });
});
