import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });
test.use({ trace: "off", video: "off" });

/**
 * The Console smoke: sign in as the test identity, see the dashboard, and walk
 * the top-up flow to the point where Stripe presents a $10 checkout. The
 * hosted checkout is deliberately not completed: filling Stripe's form and
 * polling for webhook settlement was minutes of the old suite's runtime, and
 * whether Stripe settles a test payment is the backend's coverage, not the
 * frontend's. What a frontend commit can break -- the login, the dashboard,
 * the top-up modal, the checkout session it creates -- is all asserted here.
 */

const consoleBaseUrl = (
  process.env.TEST_CONSOLE_BASE_URL?.trim() || "http://127.0.0.1:4001"
).replace(/\/+$/, "");

function env(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required for the console E2E`);
  return value;
}

function apiBase(): string {
  const base = (process.env.TEST_API_BASE_URL ?? "https://api.dev.hypercli.com")
    .trim()
    .replace(/\/+$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

/** Same admin mint as the agents E2E: no Privy, no OTP inbox. */
async function loginToConsole(page: Page): Promise<void> {
  const url = new URL(`${apiBase()}/admin/auth/login`);
  url.searchParams.set("email", env("TEST_EMAIL"));
  const response = await fetch(url, { headers: { "X-BACKEND-API-KEY": env("BACKEND_API_KEY") } });
  if (!response.ok) {
    throw new Error(`Admin auth login failed: ${response.status} ${await response.text()}`);
  }
  const { token } = (await response.json()) as { token?: string };
  if (!token) throw new Error("Admin auth login returned no token");

  await page.goto(consoleBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate((jwt) => {
    window.localStorage.setItem("app_auth_token", jwt);
    document.cookie = `auth_token=${jwt}; path=/; samesite=lax`;
  }, token);
  await page.goto(`${consoleBaseUrl}/dashboard`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.url(), { timeout: 30_000 }).toContain("/dashboard");
}

test("logs in, sees the dashboard, and reaches a $10 Stripe checkout", async ({ page }) => {
  test.setTimeout(180_000);

  await loginToConsole(page);
  await expect(page.getByRole("heading", { name: /available balance/i })).toBeVisible({ timeout: 30_000 });

  const topUp = page.getByRole("button", { name: /^top up$/i });
  await expect(topUp).toBeVisible({ timeout: 30_000 });
  await topUp.click();
  await expect(page.getByRole("heading", { name: /top up balance/i })).toBeVisible();

  const tenDollarButton = page.getByRole("button", { name: /^\$10$/i }).first();
  if (await tenDollarButton.isVisible().catch(() => false)) {
    await tenDollarButton.click();
  }

  const payButton = page.getByRole("button", { name: /pay \$10\.00/i }).first();
  await expect(payButton).toBeVisible({ timeout: 15_000 });
  await payButton.click();

  // The assertion is the checkout session itself: Stripe's hosted page loads
  // and presents the exact amount the modal promised.
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await expect(page.getByText("$10.00").first()).toBeVisible({ timeout: 30_000 });
});
