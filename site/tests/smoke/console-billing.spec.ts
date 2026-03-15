import { expect, test } from "@playwright/test";
import {
  AGENTS_SITE_URL,
  CONSOLE_SITE_URL,
  attemptClawSubscriptionCleanup,
  completeStripeCheckout,
  fetchClawCurrentPlan,
  loginToClaw,
  loginToConsole,
  waitForClawPlanChange,
} from "./fixtures/auth";

test.describe.serial("Production Billing Smoke", () => {
  test.setTimeout(240_000);

  test("tops up balance in the console with Stripe Checkout", async ({ page }) => {
    await loginToConsole(page);
    const availableBalanceValue = page
      .getByRole("heading", { name: /available balance/i })
      .locator("xpath=following-sibling::p[1]");

    await expect(availableBalanceValue).toBeVisible({ timeout: 20_000 });
    const initialBalanceText = (await availableBalanceValue.textContent())?.trim() ?? "";
    expect(initialBalanceText).toMatch(/^\$\d/);

    await page.getByRole("button", { name: /^top up$/i }).click();
    await expect(page.getByRole("heading", { name: /top up balance/i })).toBeVisible();

    await page.getByRole("button", { name: /pay \$10\.00/i }).click();
    await completeStripeCheckout(page);

    await page
      .waitForURL((url) => url.hostname === new URL(CONSOLE_SITE_URL).hostname, { timeout: 15_000 })
      .catch(() => null);

    if (!page.url().includes("/dashboard")) {
      await page.goto(`${CONSOLE_SITE_URL}/dashboard`, { waitUntil: "networkidle" });
    } else {
      await page.waitForLoadState("networkidle");
    }

    await expect
      .poll(
        async () => {
          await page.goto(`${CONSOLE_SITE_URL}/dashboard`, { waitUntil: "networkidle" });
          const balanceText = (await availableBalanceValue.textContent())?.trim() ?? "";
          return balanceText;
        },
        { timeout: 90_000, intervals: [1_000, 2_000, 5_000] }
      )
      .not.toBe(initialBalanceText);

    await expect(page.getByRole("heading", { name: /balance/i })).toBeVisible();
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
