import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";
import {
  captureStep,
  completeStripeCheckout,
  fetchBalanceSnapshot,
  loginToConsoleWithPrivy,
  waitForTopUpSettlement,
} from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const consoleBaseUrl =
  process.env.TEST_TOPUP_CONSOLE_BASE_URL?.trim() ||
  process.env.TEST_CONSOLE_BASE_URL?.trim() ||
  "http://127.0.0.1:4001";

test("tops up the Console balance by $10 and verifies the updated dashboard balance", async ({ page }) => {
  test.setTimeout(300_000);

  const initialBalance = await fetchBalanceSnapshot();
  await loginToConsoleWithPrivy(page, consoleBaseUrl);

  await page.getByRole("button", { name: /^top up$/i }).click();
  await expect(page.getByRole("heading", { name: /top up balance/i })).toBeVisible();

  const tenDollarButton = page.getByRole("button", { name: /^\$10$/i }).first();
  if (await tenDollarButton.isVisible().catch(() => false)) {
    await tenDollarButton.click();
  }

  const payButton = page.getByRole("button", { name: /pay \$10\.00/i }).first();
  await expect(payButton).toBeVisible({ timeout: 15_000 });
  await payButton.click();

  const checkoutSubmittedAt = new Date();
  await completeStripeCheckout(page);
  await captureStep(page, "console-06-checkout-submitted");

  const settlement = await waitForTopUpSettlement(initialBalance, checkoutSubmittedAt, 10);
  expect(settlement.balance.availableBalance).toBeGreaterThanOrEqual(initialBalance.availableBalance + 10);
  await captureStep(page, "console-07-balance-updated");
});
