import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";
import {
  cleanupClawAgents,
  captureStep,
  cancelStripeSubscription,
  deleteClawAgent,
  fetchClawSubscriptionSummary,
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

test.describe.serial("Agents subscription", () => {
  test("logs into Claw, ensures a paid plan, launches an agent, and connects the gateway", async ({ page }) => {
    test.setTimeout(480_000);

    let createdAgentId: string | null = null;
    let createdStripeSubscriptionId: string | null = null;
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

      await page.goto("/plans", { waitUntil: "networkidle" });
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
      const beforeStripeSubscriptionIds = new Set(
        (beforeSummary?.activeSubscriptions ?? [])
          .map((subscription) => subscription.stripeSubscriptionId)
          .filter((value): value is string => Boolean(value))
      );

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
      await captureStep(page, "agents-07-checkout-submitted");

      await expect
        .poll(() => page.url(), { timeout: 60_000 })
        .toContain("/plans");

      let afterPurchaseSummary: Awaited<ReturnType<typeof fetchClawSubscriptionSummary>> = null;
      await expect
        .poll(
          async () => {
            afterPurchaseSummary = await fetchClawSubscriptionSummary(page);
            return totalGrantedSlots(afterPurchaseSummary);
          },
          { timeout: 180_000, intervals: [1_000, 2_000, 5_000] }
        )
        .toBeGreaterThan(beforeGrantedSlots);
      expect(afterPurchaseSummary?.activeSubscriptionCount ?? 0).toBeGreaterThanOrEqual(beforeActiveSubscriptionCount + 1);
      createdStripeSubscriptionId =
        afterPurchaseSummary?.activeSubscriptions.find((subscription) => {
          const stripeId = subscription.stripeSubscriptionId;
          return stripeId && !beforeStripeSubscriptionIds.has(stripeId);
        })?.stripeSubscriptionId ??
        afterPurchaseSummary?.activeSubscriptions.find((subscription) => subscription.stripeSubscriptionId)
          ?.stripeSubscriptionId ??
        null;
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
