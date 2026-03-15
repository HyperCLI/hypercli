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

const liveConsoleBaseUrl =
  process.env.TEST_TOPUP_CONSOLE_BASE_URL?.trim() ||
  process.env.TEST_PROD_CONSOLE_BASE_URL?.trim() ||
  "https://console.hypercli.com";

test("tops up the Console balance by $10 and verifies settlement via API", async ({ page }) => {
  test.setTimeout(300_000);

  const initialBalance = await fetchBalanceSnapshot();
  await loginToConsoleWithPrivy(page, liveConsoleBaseUrl);

  const availableBalanceValue = page
    .getByRole("heading", { name: /available balance/i })
    .locator("xpath=following-sibling::p[1]");

  await expect(availableBalanceValue).toBeVisible({ timeout: 20_000 });

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

  const result = await waitForTopUpSettlement(initialBalance, checkoutSubmittedAt, 10);
  expect(result.balance.availableBalance).toBeGreaterThanOrEqual(initialBalance.availableBalance + 10);

  if (!page.url().includes(new URL(liveConsoleBaseUrl).host) || !page.url().includes("/dashboard")) {
    await page.goto(`${liveConsoleBaseUrl}/dashboard`, { waitUntil: "networkidle" });
  } else {
    await page.waitForLoadState("networkidle");
  }

  await expect(page.getByText(/top up/i).first()).toBeVisible();
  await captureStep(page, "console-07-balance-updated");
});
