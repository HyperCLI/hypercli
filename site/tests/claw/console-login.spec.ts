import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";
import { captureStep, fillOtp, pollForPrivyOtp, waitForCookieValue } from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const consoleBaseUrl = process.env.TEST_CONSOLE_BASE_URL?.trim() || "http://127.0.0.1:4001";
const testEmail = process.env.TEST_EMAIL?.trim();

if (!testEmail) {
  throw new Error("Missing TEST_EMAIL in the environment");
}

test("logs into Console with Privy email OTP and reaches the dashboard", async ({ page }) => {
  await page.goto(consoleBaseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await captureStep(page, "console-01-home");

  const loginWithPrivyButton = page.getByRole("button", { name: /login with privy/i }).first();
  await expect(loginWithPrivyButton).toBeVisible({ timeout: 15_000 });
  await loginWithPrivyButton.click();

  const emailInput = page
    .locator(
      '#privy-modal-content input[type="email"], #privy-modal-content input[name="email"], input[placeholder="your@email.com"], input[autocomplete="email"]'
    )
    .first();
  await expect(emailInput).toBeVisible({ timeout: 20_000 });
  await emailInput.fill(testEmail);
  await captureStep(page, "console-02-email-entered");

  const continueButton = page
    .getByRole("button", { name: /submit|continue|send code|email me|send login code/i })
    .first();
  await expect(continueButton).toBeVisible({ timeout: 10_000 });
  await continueButton.click();

  const otpSubmittedAt = new Date();
  const otp = await pollForPrivyOtp(otpSubmittedAt);
  await fillOtp(page, otp);
  await captureStep(page, "console-03-otp-entered");

  await waitForCookieValue(page, consoleBaseUrl, "auth_token");
  await expect
    .poll(() => page.url(), { timeout: 45_000 })
    .toContain("/dashboard");

  await expect(page.getByRole("heading", { name: /^balance$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^top up$/i })).toBeVisible();
  await captureStep(page, "console-04-post-login");
});
