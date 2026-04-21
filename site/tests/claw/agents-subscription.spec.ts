import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";
import {
  cancelActiveClawStripeSubscriptionsForTestUser,
  cleanupClawAgents,
  captureStep,
  deleteClawAgent,
  fetchClawCurrentPlan,
  launchClawAgentAndWaitForGateway,
  completeStripeCheckout,
  loginWithPrivy,
  waitForClawPlanId,
  waitForPaidClawPlan,
} from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

test.describe.serial("Agents subscription", () => {
  test("logs into Claw, ensures a paid plan, launches an agent, and connects the gateway", async ({ page }) => {
    test.setTimeout(480_000);

    let createdAgentId: string | null = null;
    await loginWithPrivy(page);

    try {
      await page.goto("/plans", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /^plans$/i })).toBeVisible({ timeout: 30_000 });

      let currentPlan = await fetchClawCurrentPlan(page);
      if (!currentPlan || currentPlan.id === "free") {
        const subscribeButton = page.getByRole("button", { name: /purchase|add another|subscribe|upgrade/i }).first();
        await expect(subscribeButton).toBeVisible({ timeout: 20_000 });
        await subscribeButton.click();

        await expect(page.getByRole("heading", { name: /purchase|subscribe|add/i })).toBeVisible({ timeout: 20_000 });
        const payWithCardButton = page.getByRole("button", { name: /pay \\$.*card/i }).first();
        await expect(payWithCardButton).toBeVisible({ timeout: 10_000 });
        await payWithCardButton.click();

        await completeStripeCheckout(page);
        await captureStep(page, "agents-07-checkout-submitted");

        await expect
          .poll(() => page.url(), { timeout: 60_000 })
          .toContain("/plans");

        currentPlan = await waitForPaidClawPlan(page);
      }

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

      const cancelled = await cancelActiveClawStripeSubscriptionsForTestUser();
      expect(cancelled.length).toBeGreaterThan(0);
      const downgradedPlan = await waitForClawPlanId(page, "free");
      expect(downgradedPlan.id).toBe("free");
      await captureStep(page, "agents-09-plan-downgraded");
    }
  });
});
