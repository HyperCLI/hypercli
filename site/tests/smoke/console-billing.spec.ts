import { expect, test } from "@playwright/test";
import {
  AGENTS_SITE_URL,
  CONSOLE_SITE_URL,
  attemptClawSubscriptionCleanup,
  completeStripeCheckout,
  fetchClawCurrentPlan,
  fetchConsoleTransactions,
  loginToClaw,
  loginToConsole,
  waitForClawPlanChange,
  waitForNewConsoleTopUp,
} from "./fixtures/auth";

test.describe.serial("Production Billing Smoke", () => {
  test.setTimeout(240_000);

  test("tops up balance in the console with Stripe Checkout", async ({ page }) => {
    await loginToConsole(page);

    const existingTransactions = await fetchConsoleTransactions(page);
    const existingIds = existingTransactions.map((tx) => tx.id);

    await page.getByRole("button", { name: /^top up$/i }).click();
    await expect(page.getByRole("heading", { name: /top up balance/i })).toBeVisible();

    await page.getByRole("button", { name: /pay \$10\.00/i }).click();
    await completeStripeCheckout(page);

    await expect
      .poll(() => page.url(), { timeout: 60_000 })
      .toContain("console.hypercli.com");

    if (!page.url().includes("/dashboard")) {
      await page.goto(`${CONSOLE_SITE_URL}/dashboard`, { waitUntil: "networkidle" });
    } else {
      await page.waitForLoadState("networkidle");
    }

    const newTopUp = await waitForNewConsoleTopUp(page, existingIds);
    expect(newTopUp.meta?.payment_method).toBe("stripe");

    await page.reload({ waitUntil: "networkidle" });
    const txTable = page.locator("table").first();
    await expect(txTable.getByText(/top up/i).first()).toBeVisible();
    await expect(txTable.getByText(/^Stripe$/).first()).toBeVisible();
  });

  test("subscribes to a Claw plan with Stripe Checkout", async ({ page }) => {
    await loginToClaw(page);
    await page.goto(`${AGENTS_SITE_URL}/dashboard/plans`, { waitUntil: "networkidle" });

    const initialPlan = await fetchClawCurrentPlan(page);
    const subscribeButton = page.getByRole("button", { name: /subscribe|upgrade/i }).first();
    await expect(subscribeButton).toBeVisible({ timeout: 20_000 });
    await subscribeButton.click();

    await expect(page.getByRole("heading", { name: /subscribe to/i })).toBeVisible();
    const payWithCardButton = page.getByRole("button", { name: /pay \$.*card/i }).first();
    await expect(payWithCardButton).toBeVisible({ timeout: 10_000 });
    await payWithCardButton.click();

    await completeStripeCheckout(page);

    await expect
      .poll(() => page.url(), { timeout: 60_000 })
      .toContain("/dashboard/plans");

    const currentPlan = await waitForClawPlanChange(page, initialPlan?.id ?? null);
    expect(currentPlan.id).not.toBe(initialPlan?.id ?? "");

    const cleanupAttempted = await attemptClawSubscriptionCleanup(page);
    if (!cleanupAttempted) {
      test.info().annotations.push({
        type: "cleanup",
        description:
          "No Claw subscription cancellation control was discoverable in the current frontend; cleanup remains manual.",
      });
    }
  });
});
