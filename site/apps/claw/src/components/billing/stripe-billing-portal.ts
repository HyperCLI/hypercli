type BillingPortalAgent = {
  createStripeBillingPortalSession: (request: {
    returnUrl: string;
    flowType: "payment_method_update";
  }) => Promise<{ id: string | null; url: string }>;
};

export function currentBillingPortalReturnUrl(): string {
  if (typeof window === "undefined") {
    throw new Error("Current page URL is unavailable.");
  }
  return window.location.href;
}

export async function createPaymentMethodUpdatePortalUrl(
  hyperAgent: BillingPortalAgent,
  returnUrl = currentBillingPortalReturnUrl(),
): Promise<string> {
  const session = await hyperAgent.createStripeBillingPortalSession({
    returnUrl,
    flowType: "payment_method_update",
  });

  if (!session.url) {
    throw new Error("Payment settings URL was not returned.");
  }

  return session.url;
}

export function openBillingPortalUrl(url: string): void {
  window.location.assign(url);
}
