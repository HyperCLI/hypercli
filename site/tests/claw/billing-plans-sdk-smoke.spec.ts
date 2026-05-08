import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const TEST_BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:4003";

const billingProfile = {
  company_billing: {
    address: ["HyperCLI Agents", "Agents billing"],
    email: "billing@hypercli.com",
  },
  profile: {
    billing_name: "Smoke Buyer",
    billing_company: "Smoke QA LLC",
    billing_tax_id: "TAX-SMOKE",
    billing_line1: "100 Test Street",
    billing_line2: "Suite 4",
    billing_city: "New York",
    billing_state: "NY",
    billing_postal_code: "10001",
    billing_country: "US",
  },
};

const stripePayment = {
  id: "pay-stripe-1",
  user_id: "user-smoke",
  subscription_id: "sub-smoke",
  entitlement_id: null,
  provider: "STRIPE",
  status: "SUCCEEDED",
  amount: "9900",
  currency: "usd",
  external_payment_id: "pi_smoke",
  created_at: "2026-04-20T12:00:00Z",
  updated_at: "2026-04-20T12:05:00Z",
  user: {
    id: "user-smoke",
    email: "smoke@example.com",
    wallet_address: null,
    team_id: null,
    plan_id: "pro",
    ...billingProfile.profile,
  },
  subscription: {
    id: "sub-smoke",
    plan_id: "pro",
    provider: "STRIPE",
    status: "ACTIVE",
    current_period_end: "2026-05-20T12:00:00Z",
    stripe_subscription_id: "sub_stripe_smoke",
  },
  entitlement: null,
};

const x402Payment = {
  id: "pay-x402-1",
  user_id: "user-smoke",
  subscription_id: null,
  entitlement_id: "ent-smoke",
  provider: "X402",
  status: "SUCCEEDED",
  amount: "120000000",
  currency: "usdc",
  external_payment_id: "0x1234567890abcdef",
  created_at: "2026-04-21T12:00:00Z",
  updated_at: "2026-04-21T12:03:00Z",
  user: {
    id: "user-smoke",
    email: "smoke@example.com",
    wallet_address: "0x1111111111111111111111111111111111111111",
    team_id: null,
    plan_id: "large",
    ...billingProfile.profile,
  },
  subscription: null,
  entitlement: {
    id: "ent-smoke",
    plan_id: "large",
    provider: "X402",
    status: "ACTIVE",
    expires_at: "2026-05-21T12:00:00Z",
    agent_tier: "large",
    features: {},
    tags: ["smoke"],
  },
};

async function installClawAuth(page: Page) {
  await page.context().addCookies([
    {
      name: "auth_token",
      value: TEST_JWT,
      url: TEST_BASE_URL,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.addInitScript((token) => {
    window.localStorage.setItem("claw_auth_token", token);
  }, TEST_JWT);
}

async function gotoAppRoute(page: Page, pathName: string) {
  try {
    await page.goto(pathName, { waitUntil: "domcontentloaded" });
  } catch (error) {
    if (!String(error).includes("ERR_ABORTED")) {
      throw error;
    }
  }
}

async function mockAgentSdkBoundary(page: Page) {
  const requests: string[] = [];
  const profileUpdates: unknown[] = [];

  await page.route("**/agents/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathName = url.pathname;
    const method = request.method();
    requests.push(`${method} ${pathName}`);

    if (method === "GET" && pathName.endsWith("/agents/plans/current")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "pro",
          name: "Pro",
          price: 99,
          aiu: 5,
          pooled_tpd: 250000000,
          slot_inventory: {
            large: { granted: 1, used: 0, available: 1 },
          },
        }),
      });
      return;
    }

    if (method === "GET" && pathName.endsWith("/agents/subscriptions/summary")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          effective_plan_id: "pro",
          current_subscription_id: "sub-smoke",
          current_entitlement_id: "sub-smoke",
          pooled_tpm_limit: 173611,
          pooled_rpm_limit: 3472,
          pooled_tpd: 250000000,
          billing_reset_at: "2026-05-20T12:00:00Z",
          slot_inventory: {
            large: { granted: 1, used: 0, available: 1 },
          },
          active_subscription_count: 1,
          active_entitlement_count: 1,
          entitlements: {
            effective_plan_id: "pro",
            pooled_tpm_limit: 173611,
            pooled_rpm_limit: 3472,
            pooled_tpd: 250000000,
            billing_reset_at: "2026-05-20T12:00:00Z",
            slot_inventory: {
              large: { granted: 1, used: 0, available: 1 },
            },
            active_entitlement_count: 1,
          },
          active_subscriptions: [
            {
              id: "sub-smoke",
              user_id: "user-smoke",
              plan_id: "pro",
              plan_name: "Pro",
              provider: "STRIPE",
              status: "ACTIVE",
              quantity: 1,
              current_period_end: "2026-05-20T12:00:00Z",
              slot_grants: { small: 0, medium: 0, large: 1 },
              meta: { bundle: { large: 1 } },
            },
          ],
          subscriptions: [],
          user: { id: "user-smoke" },
        }),
      });
      return;
    }

    if (method === "GET" && pathName.endsWith("/agents/billing/payments")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [stripePayment, x402Payment] }),
      });
      return;
    }

    if (method === "GET" && pathName.endsWith("/agents/billing/payments/pay-stripe-1")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(stripePayment),
      });
      return;
    }

    if (method === "GET" && pathName.endsWith("/agents/billing/profile")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(billingProfile),
      });
      return;
    }

    if (method === "PUT" && pathName.endsWith("/agents/billing/profile")) {
      const update = request.postDataJSON();
      profileUpdates.push(update);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...billingProfile,
          profile: {
            ...billingProfile.profile,
            ...(typeof update === "object" && update ? update : {}),
          },
          synced_stripe_customer_ids: ["cus_smoke"],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: `Unexpected SDK route in smoke test: ${method} ${pathName}` }),
    });
  });

  return { requests, profileUpdates };
}

test("plans smoke renders SDK-backed entitlement state", async ({ page }) => {
  await installClawAuth(page);
  const sdkBoundary = await mockAgentSdkBoundary(page);

  await gotoAppRoute(page, "/plans");

  await expect(page.getByRole("heading", { name: /^plans$/i })).toBeVisible();
  await expect(page.getByText(/^250M$/)).toBeVisible();
  await expect(page.getByText(/tokens\/day across all active entitlements/i)).toBeVisible();
  await expect(page.getByText(/0 \/ 1 used/i)).toBeVisible();

  const proCard = page.locator(".glass-card").filter({ has: page.getByRole("heading", { name: "Pro" }) }).first();
  await expect(proCard.getByText(/you own 1/i)).toBeVisible();
  await expect(proCard.getByRole("button", { name: /add another/i })).toBeVisible();

  expect(sdkBoundary.requests).toContain("GET /agents/plans/current");
  expect(sdkBoundary.requests).toContain("GET /agents/subscriptions/summary");
});

test("billing smoke renders SDK receipts and saves profile through SDK boundary", async ({ page }) => {
  await installClawAuth(page);
  const sdkBoundary = await mockAgentSdkBoundary(page);

  await gotoAppRoute(page, "/dashboard/billing");

  await expect(page.getByRole("heading", { name: /^billing$/i })).toBeVisible();
  await expect(page.getByText("pay-stripe-1")).toBeVisible();
  await expect(page.getByText("pay-x402-1")).toBeVisible();
  await expect(page.getByText("$99.00").first()).toBeVisible();
  await expect(page.getByText("120.000000 USDC").first()).toBeVisible();

  await expect(page.getByLabel("Legal name")).toHaveValue("Smoke Buyer");
  await page.getByLabel("Legal name").fill("Smoke Buyer Updated");
  await page.getByRole("button", { name: /save billing details/i }).click();

  await expect(page.getByText(/saved and synced 1 stripe customer/i)).toBeVisible();
  await expect.poll(() => sdkBoundary.profileUpdates.length).toBe(1);
  expect(sdkBoundary.profileUpdates[0]).toMatchObject({
    billing_name: "Smoke Buyer Updated",
    billing_company: "Smoke QA LLC",
  });
  expect(sdkBoundary.requests).toContain("GET /agents/billing/payments");
  expect(sdkBoundary.requests).toContain("GET /agents/billing/profile");
  expect(sdkBoundary.requests).toContain("PUT /agents/billing/profile");
});

test("billing receipt smoke renders SDK payment detail", async ({ page }) => {
  await installClawAuth(page);
  const sdkBoundary = await mockAgentSdkBoundary(page);

  await gotoAppRoute(page, "/dashboard/billing/pay-stripe-1");

  await expect(page.getByRole("heading", { name: "Receipt" })).toBeVisible();
  await expect(page.getByText("pay-stripe-1", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Total paid")).toBeVisible();
  await expect(page.getByText("$99.00").first()).toBeVisible();
  await expect(page.getByText("Receipt from")).toBeVisible();
  await expect(page.getByText("HyperCLI Agents").first()).toBeVisible();
  await expect(page.getByText("Paid by")).toBeVisible();
  await expect(page.getByText("Smoke QA LLC")).toBeVisible();
  await expect(page.getByText("Payment reference")).toBeVisible();
  await expect(page.getByText("pi_smoke")).toBeVisible();

  expect(sdkBoundary.requests).toContain("GET /agents/billing/payments/pay-stripe-1");
  expect(sdkBoundary.requests).toContain("GET /agents/billing/profile");
});
