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

const consoleBaseUrl =
  process.env.TEST_TOPUP_CONSOLE_BASE_URL?.trim() ||
  process.env.TEST_CONSOLE_BASE_URL?.trim() ||
  "http://127.0.0.1:4001";

test("tops up the Console balance by $10 and verifies the updated dashboard balance", async ({ page }) => {
  test.setTimeout(300_000);

  await loginToConsoleWithPrivy(page, consoleBaseUrl);

  const availableBalanceValue = page
    .getByRole("heading", { name: /available balance/i })
    .locator("xpath=following-sibling::p[1]");

  await expect(availableBalanceValue).toBeVisible({ timeout: 20_000 });
  const initialBalanceText = (await availableBalanceValue.textContent())?.trim() || "$0";
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
  await captureStep(page, "console-06-checkout-submitted");

  if (!page.url().includes(new URL(consoleBaseUrl).host) || !page.url().includes("/dashboard")) {
    await page.goto(`${consoleBaseUrl}/dashboard`, { waitUntil: "networkidle" });
  } else {
    await page.waitForLoadState("networkidle");
  }

  await expect
    .poll(
      async () => {
        const balanceText = (await availableBalanceValue.textContent())?.trim() || "";
        return parseDollarAmount(balanceText);
      },
      {
        message: "Waiting for Console dashboard balance to reflect the $10 top-up",
        timeout: 120_000,
        intervals: [2_000, 5_000, 10_000],
      }
    )
    .toBeGreaterThanOrEqual(initialBalance + 10);

  await expect(page.getByRole("button", { name: /^top up$/i })).toBeVisible();
  await captureStep(page, "console-07-balance-updated");
});
