import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";
import {
  cancelActiveClawStripeSubscriptionsForTestUser,
  captureStep,
  completeStripeCheckout,
  loginWithPrivy,
  waitForClawPlanId,
  waitForPaidClawPlan,
} from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

test.describe.serial("Agents subscription", () => {
  test("logs into Claw and purchases a subscription with Stripe", async ({ page }) => {
    test.setTimeout(360_000);

    await loginWithPrivy(page);
    await page.goto("/dashboard/plans", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /^plans$/i })).toBeVisible({ timeout: 30_000 });

    const subscribeButton = page.getByRole("button", { name: /subscribe|upgrade/i }).first();
    await expect(subscribeButton).toBeVisible({ timeout: 20_000 });
    await subscribeButton.click();

    await expect(page.getByRole("heading", { name: /subscribe to/i })).toBeVisible({ timeout: 20_000 });
    const payWithCardButton = page.getByRole("button", { name: /pay \$.*card/i }).first();
    await expect(payWithCardButton).toBeVisible({ timeout: 10_000 });
    await payWithCardButton.click();

    await completeStripeCheckout(page);
    await captureStep(page, "agents-07-checkout-submitted");

    await expect
      .poll(() => page.url(), { timeout: 60_000 })
      .toContain("/dashboard/plans");

    const currentPlan = await waitForPaidClawPlan(page);
    expect(currentPlan.id).not.toBe("free");
    await captureStep(page, "agents-08-plan-active");

    const cancelled = await cancelActiveClawStripeSubscriptionsForTestUser();
    expect(cancelled.length).toBeGreaterThan(0);
    const downgradedPlan = await waitForClawPlanId(page, "free");
    expect(downgradedPlan.id).toBe("free");
    await captureStep(page, "agents-09-plan-downgraded");
  });
});
