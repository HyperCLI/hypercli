/**
 * Flow 01: Privy Login
 *
 * Automated login via Privy email OTP:
 *   1. Open landing page → click Sign In
 *   2. Enter email in Privy modal → submit
 *   3. Fetch OTP from IMAP (polls up to 30s)
 *   4. Enter 6-digit OTP → authenticated → dashboard
 *
 * Usage:
 *   IMAP_PASS=xxx npx playwright test e2e/flows/01-privy-login.spec.ts
 *   IMAP_PASS=xxx npx playwright test e2e/flows/01-privy-login.spec.ts --headed
 */

import { test, expect } from "@playwright/test";
import { privyLogin, BASE_URL } from "./helpers";

test.describe("Flow 01: Privy Login", () => {
  test.setTimeout(90_000);

  test("Sign In → Email → OTP → Dashboard", async ({ page }) => {
    await page.screenshot({ path: "e2e/screenshots/01-landing.png" });

    await privyLogin(page);

    await page.screenshot({ path: "e2e/screenshots/01-dashboard.png" });
    expect(page.url()).toContain("/dashboard");
    console.log("✓ Login flow complete:", page.url());
  });
});
