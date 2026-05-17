import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";
import {
  cleanupClawAgents,
  captureStep,
  cancelActiveClawStripeSubscriptionsForTestUser,
  cancelStripeSubscription,
  deleteClawAgent,
  fetchClawSubscriptionSummary,
  fetchStripeSubscriptionIdForCheckoutSession,
  launchClawAgentAndWaitForGateway,
  completeStripeCheckout,
  loginWithPrivy,
  waitForPaidClawPlan,
} from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

function totalGrantedSlots(summary: Awaited<ReturnType<typeof fetchClawSubscriptionSummary>>): number {
  const inventory = summary?.entitlements?.slotInventory ?? summary?.slotInventory ?? {};
  return Object.values(inventory).reduce((sum, entry) => sum + Math.max(Number(entry.granted || 0), 0), 0);
}

function stripeSubscriptionIds(summary: Awaited<ReturnType<typeof fetchClawSubscriptionSummary>>): Set<string> {
  return new Set(
    (summary?.activeSubscriptions ?? [])
      .map((subscription) => subscription.stripeSubscriptionId)
      .filter((value): value is string => Boolean(value))
  );
}

function checkoutSessionIdFromUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).searchParams.get("session_id");
  } catch {
    return null;
  }
}

test.describe.serial("Agents subscription", () => {
  test("logs into Claw, ensures a paid plan, launches an agent, and connects the gateway", async ({ page }) => {
    test.setTimeout(480_000);

    let createdAgentId: string | null = null;
    let createdStripeSubscriptionId: string | null = null;
    const preCleanupStripeIds = await cancelActiveClawStripeSubscriptionsForTestUser().catch((error) => {
      console.log(`[agents-plans] pre-cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
    console.log(`[agents-plans] pre-cleanup canceled Stripe subscriptions=${preCleanupStripeIds.length}`);
    await loginWithPrivy(page);

    try {
      const logPlanState = async (label: string) => {
        const summary = await fetchClawSubscriptionSummary(page).catch(() => null);
        console.log(
          `[agents-plans] ${label} active=${summary?.activeSubscriptionCount ?? "unknown"} grantedSlots=${totalGrantedSlots(summary)} plans=${
            summary?.activeSubscriptions
              .map((subscription) => `${subscription.planId}:${subscription.status}`)
              .join(",") || "none"
          }`
        );
      };

      await page.goto("/plans", { waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => {
          const heading = page.locator("h1").first();
          if (!(await heading.isVisible().catch(() => false))) {
            return null;
          }
          return (await heading.textContent())?.trim() ?? null;
        }, { timeout: 30_000 })
        .toMatch(/plans/i);
      await logPlanState("before-checkout");
      const beforeSummary = await fetchClawSubscriptionSummary(page);
      const beforeActiveSubscriptionCount = beforeSummary?.activeSubscriptionCount ?? 0;
      const beforeGrantedSlots = totalGrantedSlots(beforeSummary);
      const beforeStripeSubscriptionIds = stripeSubscriptionIds(beforeSummary);

      const proCard = page.locator(".glass-card").filter({ has: page.getByRole("heading", { name: "Pro" }) }).first();
      await expect(proCard.getByRole("heading", { name: "Pro" })).toBeVisible({ timeout: 20_000 });
      const subscribeButton = proCard.getByRole("button", { name: /purchase|add another|subscribe|upgrade/i }).first();
      await expect(subscribeButton).toBeVisible({ timeout: 20_000 });
      await subscribeButton.click();

      await expect(page.getByRole("heading", { name: /purchase|subscribe|add/i })).toBeVisible({ timeout: 20_000 });
      const payWithCardButton = page.getByRole("button", { name: /pay \$.*with card/i }).first();
      await expect(payWithCardButton).toBeVisible({ timeout: 10_000 });
      await payWithCardButton.click();

      const checkoutReturnUrl = await completeStripeCheckout(
        page,
        process.env.TEST_BASE_URL?.trim() || "http://127.0.0.1:4003"
      );
      console.log(`Agents checkout returned to: ${checkoutReturnUrl}`);
      expect(checkoutReturnUrl).not.toContain("cancelled=true");
      const checkoutSessionId = checkoutSessionIdFromUrl(checkoutReturnUrl);
      if (checkoutSessionId) {
        createdStripeSubscriptionId = await fetchStripeSubscriptionIdForCheckoutSession(checkoutSessionId);
        console.log(
          `[agents-plans] checkout session=${checkoutSessionId} stripeSubscription=${createdStripeSubscriptionId ?? "unknown"}`
        );
      }
      await captureStep(page, "agents-07-checkout-submitted");

      await expect
        .poll(() => page.url(), { timeout: 60_000 })
        .toContain("/plans");

      let afterPurchaseSummary: Awaited<ReturnType<typeof fetchClawSubscriptionSummary>> = null;
      await expect
        .poll(
          async () => {
            afterPurchaseSummary = await fetchClawSubscriptionSummary(page);
            const currentStripeIds = stripeSubscriptionIds(afterPurchaseSummary);
            const hasCheckoutSubscription = Boolean(
              createdStripeSubscriptionId && currentStripeIds.has(createdStripeSubscriptionId)
            );
            const hasNewSubscription = [...currentStripeIds].some((stripeId) => !beforeStripeSubscriptionIds.has(stripeId));
            const currentSlots = totalGrantedSlots(afterPurchaseSummary);
            console.log(
              `[agents-plans] poll active=${afterPurchaseSummary?.activeSubscriptionCount ?? "unknown"} ` +
                `grantedSlots=${currentSlots} hasCheckoutSubscription=${hasCheckoutSubscription} ` +
                `hasNewSubscription=${hasNewSubscription}`
            );
            return hasCheckoutSubscription || hasNewSubscription || currentSlots > beforeGrantedSlots;
          },
          { timeout: 180_000, intervals: [1_000, 2_000, 5_000] }
        )
        .toBeTruthy();
      expect(Math.max(afterPurchaseSummary?.activeSubscriptionCount ?? 0, totalGrantedSlots(afterPurchaseSummary))).toBeGreaterThan(0);
      createdStripeSubscriptionId =
        createdStripeSubscriptionId ??
        afterPurchaseSummary?.activeSubscriptions.find((subscription) => {
          const stripeId = subscription.stripeSubscriptionId;
          return stripeId && !beforeStripeSubscriptionIds.has(stripeId);
        })?.stripeSubscriptionId ??
        afterPurchaseSummary?.activeSubscriptions.find((subscription) => subscription.stripeSubscriptionId)
          ?.stripeSubscriptionId ??
        null;
      console.log(
        `[agents-plans] before active=${beforeActiveSubscriptionCount} grantedSlots=${beforeGrantedSlots}; ` +
          `after active=${afterPurchaseSummary?.activeSubscriptionCount ?? "unknown"} grantedSlots=${totalGrantedSlots(afterPurchaseSummary)}`
      );
      await logPlanState("after-checkout");

      const currentPlan = await waitForPaidClawPlan(page);

      expect(currentPlan.id).not.toBe("free");
      await captureStep(page, "agents-08-plan-active");

      await cleanupClawAgents(page);
      const createdAgent = await launchClawAgentAndWaitForGateway(page);
      createdAgentId = createdAgent.id;
      expect(createdAgentId).toBeTruthy();
    } finally {
      if (createdAgentId) {
        await deleteClawAgent(page, createdAgentId).catch(() => {});
      }

      if (createdStripeSubscriptionId) {
        await cancelStripeSubscription(createdStripeSubscriptionId).catch(() => {});
      }
      await captureStep(page, "agents-09-plan-cleanup");
    }
  });
});
