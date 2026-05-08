import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";
import {
  cleanupClawAgents,
  captureStep,
  cancelStripeSubscription,
  deleteClawAgent,
  fetchClawEffectivePlan,
  fetchClawSubscriptionSummary,
  launchClawAgentAndWaitForGateway,
  completeStripeCheckout,
  loginWithPrivy,
  waitForClawActiveSubscriptionCount,
  waitForClawSubscriptionCreatedByCheckout,
  waitForPaidClawPlan,
} from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

test.describe.serial("Agents subscription", () => {
  test("logs into Claw, ensures a paid plan, launches an agent, and connects the gateway", async ({ page }) => {
    test.setTimeout(480_000);

    let createdAgentId: string | null = null;
    let baselineActiveSubscriptionCount = 0;
    let createdStripeSubscriptionId: string | null = null;
    await loginWithPrivy(page);

    try {
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

      const baselineSummary = await fetchClawSubscriptionSummary(page);
      baselineActiveSubscriptionCount = baselineSummary?.activeSubscriptionCount ?? 0;

      let currentPlan = await fetchClawEffectivePlan(page);
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
      expect(checkoutReturnUrl).toContain("session_id=");
      await captureStep(page, "agents-07-checkout-submitted");

      await expect
        .poll(() => page.url(), { timeout: 60_000 })
        .toContain("/plans");

      const checkoutSessionId = new URL(checkoutReturnUrl).searchParams.get("session_id");
      expect(checkoutSessionId).toBeTruthy();

      const createdSubscription = await waitForClawSubscriptionCreatedByCheckout(page, checkoutSessionId!);
      createdStripeSubscriptionId = createdSubscription.stripeSubscriptionId ?? null;
      expect(createdStripeSubscriptionId).toBeTruthy();
      const afterPurchaseSummary = await waitForClawActiveSubscriptionCount(
        page,
        baselineActiveSubscriptionCount + 1
      );
      expect(afterPurchaseSummary.activeSubscriptionCount).toBe(baselineActiveSubscriptionCount + 1);

      currentPlan = await waitForPaidClawPlan(page);

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
        const settledSummary = await waitForClawActiveSubscriptionCount(page, baselineActiveSubscriptionCount);
        expect(settledSummary.activeSubscriptionCount).toBe(baselineActiveSubscriptionCount);
      }
      await captureStep(page, "agents-09-plan-cleanup");
    }
  });
});
