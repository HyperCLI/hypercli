import { describe, expect, it, vi } from "vitest";

import { createPaymentMethodUpdatePortalUrl } from "./stripe-billing-portal";

describe("createPaymentMethodUpdatePortalUrl", () => {
  it("requests a Stripe payment method update portal session", async () => {
    const hyperAgent = {
      createStripeBillingPortalSession: vi.fn(async () => ({
        id: "bps_123",
        url: "https://billing.stripe.com/p/session/test",
      })),
    };

    await expect(
      createPaymentMethodUpdatePortalUrl(hyperAgent, "https://claw.hypercli.com/dashboard/agents"),
    ).resolves.toBe("https://billing.stripe.com/p/session/test");

    expect(hyperAgent.createStripeBillingPortalSession).toHaveBeenCalledWith({
      returnUrl: "https://claw.hypercli.com/dashboard/agents",
      flowType: "payment_method_update",
    });
  });

  it("throws when the portal URL is missing", async () => {
    const hyperAgent = {
      createStripeBillingPortalSession: vi.fn(async () => ({
        id: "bps_123",
        url: "",
      })),
    };

    await expect(
      createPaymentMethodUpdatePortalUrl(hyperAgent, "https://claw.hypercli.com/dashboard/agents"),
    ).rejects.toThrow("Payment settings URL was not returned.");
  });
});
