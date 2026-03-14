import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";
import {
  captureStep,
  completeStripeCheckout,
  loginToConsoleWithPrivy,
  parseDollarAmount,
} from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const liveConsoleBaseUrl =
  process.env.TEST_PROD_CONSOLE_BASE_URL?.trim() || "https://console.hypercli.com";

test("tops up the live Console balance by $10 through Stripe Checkout", async ({ page }) => {
  test.setTimeout(300_000);

  await loginToConsoleWithPrivy(page, liveConsoleBaseUrl);

  const availableBalanceValue = page
    .getByRole("heading", { name: /available balance/i })
    .locator("xpath=following-sibling::p[1]");

  await expect(availableBalanceValue).toBeVisible({ timeout: 20_000 });
  const initialBalanceText = ((await availableBalanceValue.textContent()) || "").trim();
  const initialBalance = parseDollarAmount(initialBalanceText);

  await page.getByRole("button", { name: /^top up$/i }).click();
  await expect(page.getByRole("heading", { name: /top up balance/i })).toBeVisible();

  const tenDollarButton = page.getByRole("button", { name: /^\$10$/i }).first();
  if (await tenDollarButton.isVisible().catch(() => false)) {
    await tenDollarButton.click();
  }

  const payButton = page.getByRole("button", { name: /pay \$10\.00/i }).first();
  await expect(payButton).toBeVisible({ timeout: 15_000 });
  await payButton.click();

  await completeStripeCheckout(page);
  await captureStep(page, "console-06-returned-from-stripe");

  if (!page.url().includes("/dashboard")) {
    await page.goto(`${liveConsoleBaseUrl}/dashboard`, { waitUntil: "networkidle" });
  } else {
    await page.waitForLoadState("networkidle");
  }

  let updatedBalance = initialBalance;
  await expect
    .poll(
      async () => {
        await page.goto(`${liveConsoleBaseUrl}/dashboard`, { waitUntil: "networkidle" });
        const balanceText = ((await availableBalanceValue.textContent()) || "").trim();
        updatedBalance = parseDollarAmount(balanceText);
        return updatedBalance;
      },
      { timeout: 120_000, intervals: [2_000, 5_000, 10_000] }
    )
    .toBeGreaterThanOrEqual(initialBalance + 10);

  await expect(page.getByText(/top up/i).first()).toBeVisible();
  await captureStep(page, "console-07-balance-updated");
});
