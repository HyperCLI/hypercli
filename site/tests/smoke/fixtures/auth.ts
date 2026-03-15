import { expect, type Locator, type Page } from "@playwright/test";
import {
  fillOtp,
  pollForPrivyOtp,
  waitForCookieValue,
  waitForLocalStorageValue,
} from "../../claw/fixtures/auth";

export const MAIN_SITE_URL =
  process.env.SMOKE_MAIN_SITE_URL?.trim() || "https://hypercli.com";
export const CONSOLE_SITE_URL =
  process.env.SMOKE_CONSOLE_SITE_URL?.trim() || "https://console.hypercli.com";
export const AGENTS_SITE_URL =
  process.env.SMOKE_AGENTS_SITE_URL?.trim() || "https://agents.hypercli.com";
export const AGENTS_API_URL =
  process.env.SMOKE_AGENTS_API_URL?.trim() || "https://api.agents.hypercli.com/api";

export const STRIPE_TEST_CARD_NUMBER = "4242424242424242";
export const STRIPE_TEST_EXPIRY = "1230";
export const STRIPE_TEST_CVC = "123";
export const STRIPE_TEST_NAME = "HyperCLI Smoke";

const AUTH_COOKIE_NAME = "auth_token";

interface ClawPlan {
  id: string;
  name: string;
  price: number | string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in the environment`);
  }
  return value;
}

async function isVisible(locator: Locator, timeout = 3_000): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

function privyEmailInput(page: Page): Locator {
  return page
    .locator(
      [
        '#privy-modal-content input[type="email"]',
        '#privy-modal-content input[name="email"]',
        'input[placeholder="your@email.com"]',
        'input[autocomplete="email"]',
      ].join(", ")
    )
    .first();
}

function privyContinueButton(page: Page): Locator {
  return page
    .getByRole("button", { name: /submit|continue|send code|email me|send login code/i })
    .first();
}

async function clickFirstMatchingButton(page: Page, names: RegExp[]): Promise<void> {
  for (const name of names) {
    const button = page.getByRole("button", { name }).first();
    if (await isVisible(button)) {
      await button.click();
      return;
    }
  }

  throw new Error(`Could not find any auth trigger button matching: ${names.map(String).join(", ")}`);
}

async function openPrivyPrompt(page: Page, triggerNames: RegExp[]): Promise<void> {
  const loginWithPrivyButton = page.getByRole("button", { name: /login with privy/i }).first();
  if (await isVisible(loginWithPrivyButton, 2_000)) {
    await loginWithPrivyButton.click();
  } else {
    await clickFirstMatchingButton(page, triggerNames);

    if (await isVisible(loginWithPrivyButton, 5_000)) {
      await loginWithPrivyButton.click();
    }
  }

  await expect(privyEmailInput(page)).toBeVisible({ timeout: 20_000 });
}

async function completePrivyLogin(page: Page): Promise<void> {
  const email = requireEnv("TEST_EMAIL");
  const emailInput = privyEmailInput(page);
  await emailInput.fill(email);

  const continueButton = privyContinueButton(page);
  await expect(continueButton).toBeVisible({ timeout: 10_000 });
  await continueButton.click();

  const otpSubmittedAt = new Date();
  const otp = await pollForPrivyOtp(otpSubmittedAt);
  await fillOtp(page, otp);
}

export async function loginToMainSite(page: Page): Promise<void> {
  await page.goto(MAIN_SITE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await openPrivyPrompt(page, [/^login$/i, /^sign in$/i, /^get started$/i]);
  await completePrivyLogin(page);
  await waitForCookieValue(page, MAIN_SITE_URL, AUTH_COOKIE_NAME);

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: /logout/i })).toBeVisible({ timeout: 20_000 });
}

export async function loginToConsole(page: Page): Promise<void> {
  await page.goto(CONSOLE_SITE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await openPrivyPrompt(page, [/^login$/i, /^sign in$/i, /^get started$/i]);
  await completePrivyLogin(page);
  await waitForCookieValue(page, CONSOLE_SITE_URL, AUTH_COOKIE_NAME);

  await expect
    .poll(() => page.url(), { timeout: 45_000 })
    .toContain("/dashboard");

  await expect(page.getByRole("button", { name: /^top up$/i })).toBeVisible({ timeout: 20_000 });
}

export async function loginToClaw(page: Page): Promise<void> {
  await page.goto(AGENTS_SITE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await openPrivyPrompt(page, [/^sign in$/i, /^get started$/i, /^login$/i]);
  await completePrivyLogin(page);
  await waitForLocalStorageValue(page, "claw_auth_token");

  await expect
    .poll(() => page.url(), { timeout: 45_000 })
    .toContain("/dashboard");

  await expect(page.getByRole("link", { name: /api keys/i })).toBeVisible({ timeout: 20_000 });
}

export async function completeStripeCheckout(
  page: Page,
  email = requireEnv("TEST_EMAIL")
): Promise<void> {
  await page.waitForURL(/stripe\.com/, { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");

  const emailField = page.locator("#email");
  if (await isVisible(emailField, 10_000)) {
    await emailField.fill(email);
  }

  const cardNumber = page.locator("#cardNumber");
  await expect(cardNumber).toBeVisible({ timeout: 15_000 });
  await cardNumber.pressSequentially(STRIPE_TEST_CARD_NUMBER, { delay: 35 });

  const cardExpiry = page.locator("#cardExpiry");
  await expect(cardExpiry).toBeVisible({ timeout: 10_000 });
  await cardExpiry.pressSequentially(STRIPE_TEST_EXPIRY, { delay: 35 });

  const cardCvc = page.locator("#cardCvc");
  await expect(cardCvc).toBeVisible({ timeout: 10_000 });
  await cardCvc.pressSequentially(STRIPE_TEST_CVC, { delay: 35 });

  const billingName = page.locator("#billingName");
  if (await isVisible(billingName, 2_000)) {
    await billingName.fill(STRIPE_TEST_NAME);
  }

  const submitButton = page.locator(".SubmitButton, button[type='submit']").first();
  await expect(submitButton).toBeVisible({ timeout: 10_000 });
  await submitButton.click();
}

export async function fetchClawCurrentPlan(page: Page): Promise<ClawPlan | null> {
  return page.evaluate(async ({ apiUrl }) => {
    const token = window.localStorage.getItem("claw_auth_token");
    if (!token) {
      throw new Error("Missing claw_auth_token in localStorage");
    }

    const response = await fetch(`${apiUrl}/plans/current`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch current Claw plan: ${response.status}`);
    }

    return (await response.json()) as ClawPlan;
  }, { apiUrl: AGENTS_API_URL });
}

export async function waitForClawPlanChange(
  page: Page,
  previousPlanId: string | null
): Promise<ClawPlan> {
  let currentPlan: ClawPlan | null = null;

  await expect
    .poll(
      async () => {
        currentPlan = await fetchClawCurrentPlan(page);
        if (!currentPlan) {
          return null;
        }
        if (!previousPlanId) {
          return currentPlan.id;
        }
        return currentPlan.id !== previousPlanId ? currentPlan.id : null;
      },
      { timeout: 90_000 }
    )
    .not.toBeNull();

  return currentPlan!;
}

export async function attemptClawSubscriptionCleanup(page: Page): Promise<boolean> {
  const manageNames = [
    /cancel subscription/i,
    /cancel plan/i,
    /manage subscription/i,
    /manage billing/i,
    /billing portal/i,
  ];

  for (const name of manageNames) {
    const button = page.getByRole("button", { name }).first();
    if (await isVisible(button, 2_000)) {
      await button.click();
      return await finishClawCancellation(page);
    }

    const link = page.getByRole("link", { name }).first();
    if (await isVisible(link, 2_000)) {
      await link.click();
      return await finishClawCancellation(page);
    }
  }

  return false;
}

async function finishClawCancellation(page: Page): Promise<boolean> {
  const confirmNames = [
    /cancel subscription/i,
    /confirm cancellation/i,
    /^cancel$/i,
    /^confirm$/i,
  ];

  for (const name of confirmNames) {
    const button = page.getByRole("button", { name }).first();
    if (await isVisible(button, 5_000)) {
      await button.click();
      return true;
    }
  }

  return /stripe\.com/i.test(page.url());
}
