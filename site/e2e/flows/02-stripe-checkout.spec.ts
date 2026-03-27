/**
 * Flow 02: Stripe Checkout (Test Mode)
 *
 * Purchases a plan via Stripe test card:
 *   1. Login via Privy (reuses Flow 01 helper)
 *   2. Navigate to Plans page
 *   3. Select first available plan → "Pay with Card"
 *   4. Fill Stripe Checkout test card (4242...)
 *   5. Complete payment → verify redirect back with session_id
 *
 * NOT run on every CI build — manual/periodic test.
 *
 * Usage:
 *   IMAP_PASS=xxx npx playwright test e2e/flows/02-stripe-checkout.spec.ts
 *   IMAP_PASS=xxx npx playwright test e2e/flows/02-stripe-checkout.spec.ts --headed
 */

import { test, expect } from "@playwright/test";
import {
  privyLogin,
  BASE_URL,
  PRIVY_EMAIL,
  launchAgentFromDashboard,
  cancelActiveStripeSubscriptionsForTestUser,
  triggerBackendStripeRepairSweep,
  waitForAgentStoppedInDashboard,
} from "./helpers";

const STRIPE_TEST_CARD = "4242424242424242";
const STRIPE_TEST_EXP = "1230"; // MMYY
const STRIPE_TEST_CVC = "123";
const STRIPE_TEST_NAME = "E2E Test";

test.describe("Flow 02: Stripe Checkout", () => {
  test.setTimeout(240_000);

  test("Login → Plans → Subscribe → Stripe → Payment → Launch Agent → Stripe loss stops agent", async ({
    page,
  }) => {
    // ── Login ──
    await privyLogin(page);
    await page.screenshot({ path: "e2e/screenshots/02-01-dashboard.png" });

    // ── Plans page ──
    await page.goto(`${BASE_URL}/dashboard/plans`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "e2e/screenshots/02-02-plans.png" });
    console.log("✓ On plans page");

    // ── Click Subscribe on first available plan ──
    const subscribeButton = page
      .getByRole("button", { name: /subscribe|upgrade/i })
      .first();
    await expect(subscribeButton).toBeVisible({ timeout: 10_000 });
    await subscribeButton.click();
    console.log("✓ Clicked Subscribe");

    // ── Checkout modal → Pay with Card ──
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: "e2e/screenshots/02-03-checkout-modal.png",
    });

    const payButton = page.getByRole("button", { name: /pay.*card/i });
    await expect(payButton).toBeVisible({ timeout: 5_000 });
    await payButton.click();
    console.log("✓ Clicked Pay with Card");

    // ── Stripe Checkout page ──
    await page.waitForURL(/stripe\.com/, { timeout: 20_000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(5000);
    await page.screenshot({
      path: "e2e/screenshots/02-04-stripe-checkout.png",
    });
    console.log("✓ On Stripe Checkout:", page.url());

    // ── Fill test card details ──
    const emailField = page.locator("#email");
    await expect(emailField).toBeVisible({ timeout: 10_000 });
    await emailField.fill(PRIVY_EMAIL);
    console.log("✓ Filled email");

    const cardInput = page.locator("#cardNumber");
    await expect(cardInput).toBeVisible({ timeout: 10_000 });
    await cardInput.pressSequentially(STRIPE_TEST_CARD, { delay: 50 });
    console.log("✓ Filled card number");

    const expInput = page.locator("#cardExpiry");
    await expect(expInput).toBeVisible();
    await expInput.pressSequentially(STRIPE_TEST_EXP, { delay: 50 });
    console.log("✓ Filled expiry");

    const cvcInput = page.locator("#cardCvc");
    await expect(cvcInput).toBeVisible();
    await cvcInput.pressSequentially(STRIPE_TEST_CVC, { delay: 50 });
    console.log("✓ Filled CVC");

    const nameInput = page.locator("#billingName");
    if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nameInput.fill(STRIPE_TEST_NAME);
      console.log("✓ Filled cardholder name");
    }

    await page.screenshot({ path: "e2e/screenshots/02-05-card-filled.png" });

    // ── Submit payment ──
    const submitPayment = page
      .locator(".SubmitButton, button[type='submit']")
      .first();
    await expect(submitPayment).toBeVisible({ timeout: 5_000 });
    await submitPayment.click();
    console.log("✓ Clicked Submit Payment");

    // ── Wait for redirect back ──
    await page.waitForURL(/dashboard\/plans.*session_id/, { timeout: 30_000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "e2e/screenshots/02-06-success.png" });
    console.log("✓ Payment complete:", page.url());

    const launched = await launchAgentFromDashboard(page);
    await page.screenshot({ path: "e2e/screenshots/02-07-agent-running.png" });
    console.log(`✓ Agent launched after Stripe checkout (${launched.id || "unknown-id"})`);

    const cancelledSubscriptions = await cancelActiveStripeSubscriptionsForTestUser();
    expect(cancelledSubscriptions.length).toBeGreaterThan(0);
    console.log(`✓ Cancelled Stripe subscriptions: ${cancelledSubscriptions.join(", ")}`);

    const repairResult = await triggerBackendStripeRepairSweep();
    console.log("✓ Triggered backend repair sweep:", JSON.stringify(repairResult));

    await waitForAgentStoppedInDashboard(page);
    await page.screenshot({ path: "e2e/screenshots/02-08-agent-stopped-after-stripe-loss.png" });
    console.log("✓ Agent stopped after Stripe access loss");
  });
});
