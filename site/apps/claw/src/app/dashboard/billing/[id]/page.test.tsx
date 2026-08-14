import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgentPayment: vi.fn(),
  getAgentBillingProfile: vi.fn(),
  getToken: vi.fn().mockResolvedValue("token"),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "receipt-1" }),
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({ getToken: mocks.getToken }),
}));

vi.mock("@/lib/agent-client", () => ({
  createHyperAgentClient: () => ({}),
}));

vi.mock("@/lib/billing", () => ({
  getAgentPayment: mocks.getAgentPayment,
  getAgentBillingProfile: mocks.getAgentBillingProfile,
  resolveAgentPaymentPlanId: () => "pro",
}));

import BillingDetailPage from "./page";

describe("BillingDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentPayment.mockRejectedValue(
      new Error("GET /agents/payments/receipt-1 token=private-billing-token returned 500"),
    );
    mocks.getAgentBillingProfile.mockResolvedValue({ profile: null, company_billing: null });
  });

  it("offers receipt recovery without exposing request details", async () => {
    const { container } = render(<BillingDetailPage />);

    expect(await screen.findByRole("heading", { name: "Retry to open this receipt" })).toBeVisible();
    expect(screen.queryByText(/GET \/agents\/payments/i)).not.toBeInTheDocument();
    expect(container.querySelector('[class~="text-destructive"], [class~="bg-destructive"], [class~="border-destructive"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry receipt" }));
    await waitFor(() => expect(mocks.getAgentPayment).toHaveBeenCalledTimes(2));
  });
});
