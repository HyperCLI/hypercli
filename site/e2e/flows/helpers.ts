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

const DEFAULT_TEST_AGENTS_API_BASE_URL = "https://api.dev.hypercli.com/agents";

interface StripeCustomer {
  id: string;
}

interface StripeSubscription {
  id: string;
  status: string;
}

interface StripeInvoice {
  payment_intent?: string | null;
  charge?: string | null;
  status?: string | null;
}

export interface LaunchedAgent {
  id: string;
  name: string;
}

function getOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function requireEnvValue(name: string): string {
  const value = getOptionalEnv(name);
  if (!value) {
    throw new Error(`Missing ${name} in the environment`);
  }
  return value;
}

function getAgentsApiBaseUrl(): string {
  return (
    getOptionalEnv("TEST_AGENTS_API_BASE_URL") ||
    DEFAULT_TEST_AGENTS_API_BASE_URL
  ).replace(/\/$/, "");
}

function getBackendApiBaseUrl(): string {
  const explicit = getOptionalEnv("TEST_BACKEND_API_BASE_URL");
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  return getAgentsApiBaseUrl().replace(/\/agents$/, "");
}

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

async function stripeApiRequest<T>(
  path: string,
  init: { method?: string; form?: Record<string, string> } = {}
): Promise<T> {
  const secretKey = requireEnvValue("TEST_STRIPE_AGENTS_SECRET_KEY");
  const method = init.method || "GET";
  const body = init.form ? new URLSearchParams(init.form).toString() : undefined;
  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Stripe API ${method} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function cancelActiveStripeSubscriptionsForTestUser(): Promise<string[]> {
  const customers = await stripeApiRequest<{ data: StripeCustomer[] }>(
    `/v1/customers?email=${encodeURIComponent(PRIVY_EMAIL)}&limit=10`
  );
  const cancelled: string[] = [];

  for (const customer of customers.data || []) {
    const subscriptions = await stripeApiRequest<{ data: StripeSubscription[] }>(
      `/v1/subscriptions?customer=${encodeURIComponent(customer.id)}&status=all&limit=100`
    );

    for (const subscription of subscriptions.data || []) {
      if (!["active", "trialing", "past_due", "incomplete", "unpaid"].includes(subscription.status)) {
        continue;
      }

      const invoices = await stripeApiRequest<{ data: StripeInvoice[] }>(
        `/v1/invoices?subscription=${encodeURIComponent(subscription.id)}&limit=10`
      );

      await stripeApiRequest(`/v1/subscriptions/${subscription.id}`, { method: "DELETE" });

      const paidInvoice = (invoices.data || []).find((invoice) => invoice.status === "paid");
      const paymentRef = paidInvoice?.payment_intent || paidInvoice?.charge || null;
      if (paymentRef) {
        await stripeApiRequest("/v1/refunds", {
          method: "POST",
          form: paidInvoice?.payment_intent
            ? { payment_intent: paidInvoice.payment_intent }
            : { charge: paidInvoice!.charge! },
        }).catch(() => null);
      }

      cancelled.push(subscription.id);
    }
  }

  return cancelled;
}

export async function triggerBackendStripeRepairSweep(): Promise<unknown> {
  const response = await fetch(`${getBackendApiBaseUrl()}/admin/subscriptions/expire`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BACKEND-API-KEY": requireEnvValue("TEST_BACKEND_API_KEY"),
    },
    body: JSON.stringify({
      repair_stripe: true,
      send_emails: false,
      stop_agents: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Backend repair sweep failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

export async function launchAgentFromDashboard(page: Page): Promise<LaunchedAgent> {
  await page.goto(`${BASE_URL}/dashboard/agents`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(2000);

  const createButton = page
    .getByRole("button", { name: /new agent|create|launch|\+/i })
    .first();
  await expect(createButton).toBeVisible({ timeout: 10_000 });
  await createButton.click();

  const nextButton = page.getByRole("button", { name: /next|continue/i }).first();
  await expect(nextButton).toBeVisible({ timeout: 5_000 });
  await nextButton.click();

  const nextButton2 = page.getByRole("button", { name: /next|continue/i }).first();
  if (await nextButton2.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nextButton2.click();
    await page.waitForTimeout(500);
  }

  const launchButton = page
    .getByRole("button", { name: /create|launch|deploy/i })
    .first();
  await expect(launchButton).toBeVisible({ timeout: 5_000 });

  const createRequestPromise = page.waitForRequest((request) => {
    return request.method() === "POST" && /\/agents\/deployments$/.test(request.url());
  });
  const createResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === "POST" && /\/agents\/deployments$/.test(response.url());
  });
  await launchButton.click();

  const createRequest = await createRequestPromise;
  const launchPayload = createRequest.postDataJSON() as Record<string, unknown>;
  expect(launchPayload.image).toBeTruthy();
  expect(launchPayload.env).toBeTruthy();
  expect(launchPayload.routes).toBeTruthy();
  expect((launchPayload.config as Record<string, unknown> | undefined)?.image).toBeUndefined();
  expect((launchPayload.config as Record<string, unknown> | undefined)?.env).toBeUndefined();
  expect((launchPayload.config as Record<string, unknown> | undefined)?.routes).toBeUndefined();

  const createResponse = await createResponsePromise;
  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json()) as Record<string, unknown>;
  const createdId = String(created.id || "");
  const createdName = String(created.name || "");

  for (let attempt = 0; attempt < 60; attempt++) {
    await page.waitForTimeout(3000);
    const statusText = await page
      .locator("text=/RUNNING|STARTING|PENDING/i")
      .first()
      .textContent()
      .catch(() => null);

    if (statusText?.toUpperCase().includes("RUNNING")) {
      return {
        id: createdId,
        name: createdName,
      };
    }

    if (attempt % 5 === 4) {
      await page.reload({ waitUntil: "networkidle" });
    }
  }

  throw new Error("Agent did not reach RUNNING within timeout");
}

export async function sendChatAndWaitForReply(
  page: Page,
  {
    prompt,
    expectedReply,
    timeoutMs = 180_000,
  }: {
    prompt: string;
    expectedReply: string;
    timeoutMs?: number;
  },
): Promise<void> {
  const input = page.getByPlaceholder("Type a message...");
  await expect(input).toBeVisible({ timeout: timeoutMs });
  await expect(input).toBeEnabled({ timeout: timeoutMs });
  await input.fill(prompt);
  await input.press("Enter");
  await expect(page.getByText(expectedReply, { exact: true }).last()).toBeVisible({ timeout: timeoutMs });
}

export async function waitForAgentStoppedInDashboard(page: Page, timeoutMs = 180_000): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.reload({ waitUntil: "networkidle" });
        if (await page.getByRole("button", { name: /start agent/i }).count()) {
          return "STOPPED";
        }
        const stateText = await page
          .locator("text=/STOPPED|STOPPING|RUNNING|STARTING|PENDING|FAILED/i")
          .first()
          .textContent()
          .catch(() => null);
        return (stateText || "").trim().toUpperCase();
      },
      { timeout: timeoutMs, intervals: [1_000, 2_000, 5_000] }
    )
    .toBe("STOPPED");
}
