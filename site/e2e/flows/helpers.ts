/**
 * Shared E2E helpers: Privy login, IMAP OTP fetch.
 *
 * Environment:
 *   PRIVY_EMAIL  — email for Privy login (default: agent@nedos.io)
 *   IMAP_HOST    — IMAP server (default: imap.fastmail.com)
 *   IMAP_USER    — IMAP username (default: agent@nedos.io)
 *   IMAP_PASS    — IMAP password (required for OTP flows)
 *   E2E_BASE_URL — frontend URL (default: https://gilfoyle.dev.hypercli.com)
 */

import { expect, type Page } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";

export const BASE_URL =
  process.env.E2E_BASE_URL || "https://gilfoyle.dev.hypercli.com";
export const PRIVY_EMAIL = process.env.PRIVY_EMAIL || "agent@nedos.io";

/**
 * Mark all existing Privy emails as read so we only get the fresh OTP.
 */
export function clearOldPrivyEmails(): void {
  const script = path.join(__dirname, "fetch-otp.py");
  try {
    execSync(`python3 ${script} --clear --timeout 1`, {
      encoding: "utf-8",
      env: { ...process.env },
      timeout: 10_000,
    });
  } catch {
    // Expected — times out because there's no new email yet
  }
}

/**
 * Fetch OTP code from IMAP by shelling out to the Python helper.
 * Returns the 6-digit code as a string.
 */
export function fetchOtpFromImap(timeoutSec = 30): string {
  const script = path.join(__dirname, "fetch-otp.py");
  const result = execSync(`python3 ${script} --timeout ${timeoutSec}`, {
    encoding: "utf-8",
    env: { ...process.env },
    timeout: (timeoutSec + 5) * 1000,
  });
  const code = result.trim().split("\n").pop()?.trim();
  if (!code || !/^\d{6}$/.test(code)) {
    throw new Error(`Failed to extract OTP code, got: ${result.trim()}`);
  }
  return code;
}

/**
 * Full Privy login: Sign In → email → OTP → dashboard redirect.
 * Returns the page on the dashboard.
 */
export async function privyLogin(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Click Sign In
  const signInButton = page.getByRole("button", { name: /sign.?in/i });
  await expect(signInButton.first()).toBeVisible({ timeout: 10_000 });
  await signInButton.first().click();

  // Enter email
  await page.waitForTimeout(2000);
  const emailInput = page.getByPlaceholder("your@email.com");
  await expect(emailInput).toBeVisible({ timeout: 10_000 });

  // Clear stale OTPs before triggering a new one
  clearOldPrivyEmails();

  await emailInput.fill(PRIVY_EMAIL);
  await page.getByRole("button", { name: /submit/i }).click();

  // Wait for OTP screen
  await page.waitForTimeout(2000);

  // Fetch OTP from IMAP
  const otpCode = fetchOtpFromImap(30);
  console.log(`✓ Got OTP: ${otpCode}`);

  // Enter OTP — Privy uses 6 individual inputs named code-0..code-5
  for (let i = 0; i < 6; i++) {
    const input = page.locator(`input[name="code-${i}"]`);
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill(otpCode[i]);
    await page.waitForTimeout(100);
  }

  // Wait for dashboard redirect
  await page.waitForURL(/dashboard/, { timeout: 15_000 });
  console.log("✓ Logged in, on dashboard");
}
