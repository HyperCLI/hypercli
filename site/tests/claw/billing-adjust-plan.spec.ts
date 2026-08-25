import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:4003";
const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLXNtb2tlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.signature";

const plans = [
  {
    id: "solo",
    name: "Solo",
    price_usd: 39,
    agents: 1,
    max_agent_size: "small",
    slot_grants: { small: 1 },
    limits: { tpd: 25_000_000, tpm: 25_000, burst_tpm: 50_000, rpm: 250 },
  },
  {
    id: "team",
    name: "Team",
    price_usd: 99,
    agents: 3,
    max_agent_size: "medium",
    slot_grants: { medium: 3 },
    limits: { tpd: 100_000_000, tpm: 100_000, burst_tpm: 200_000, rpm: 1_000 },
  },
  {
    id: "pro",
    name: "Pro",
    price_usd: 249,
    agents: 5,
    max_agent_size: "large",
    slot_grants: { large: 5 },
    limits: { tpd: 250_000_000, tpm: 250_000, burst_tpm: 500_000, rpm: 2_500 },
  },
];

function planById(planId: string) {
  return plans.find((plan) => plan.id === planId) ?? plans[1];
}

function subscriptionSummary(planId: string) {
  const plan = planById(planId);
  const slotTier = plan.max_agent_size;
  return {
    effective_plan_id: plan.id,
    current_subscription_id: "sub-team-1",
    current_entitlement_id: "ent-team-1",
    pooled_tpm_limit: plan.limits.tpm,
    pooled_rpm_limit: plan.limits.rpm,
    pooled_tpd: plan.limits.tpd,
    billing_reset_at: "2026-09-24T00:00:00Z",
    slot_inventory: {
      [slotTier]: { granted: plan.agents, used: 1, available: Math.max(plan.agents - 1, 0) },
    },
    active_subscription_count: 1,
    active_entitlement_count: 1,
    entitlements: {
      effective_plan_id: plan.id,
      pooled_tpm_limit: plan.limits.tpm,
      pooled_rpm_limit: plan.limits.rpm,
      pooled_tpd: plan.limits.tpd,
      billing_reset_at: "2026-09-24T00:00:00Z",
      slot_inventory: {
        [slotTier]: { granted: plan.agents, used: 1, available: Math.max(plan.agents - 1, 0) },
      },
      active_entitlement_count: 1,
    },
    active_subscriptions: [
      {
        id: "sub-team-1",
        user_id: "user-smoke",
        plan_id: plan.id,
        plan_name: plan.name,
        provider: "STRIPE",
        status: "ACTIVE",
        quantity: 1,
        is_current: true,
        current_period_end: "2026-09-24T00:00:00Z",
        can_cancel: true,
        slot_grants: plan.slot_grants,
      },
    ],
    subscriptions: [],
    user: { id: "user-smoke" },
  };
}

async function installClawAuth(page: Page) {
  await page.context().addCookies([
    {
      name: "auth_token",
      value: TEST_JWT,
      url: TEST_BASE_URL,
      httpOnly: false,
      secure: TEST_BASE_URL.startsWith("https://"),
      sameSite: "Lax",
    },
  ]);
  await page.addInitScript((token) => {
    window.localStorage.setItem("claw_auth_token", token);
    window.localStorage.removeItem("hypercli_logged_out");
  }, TEST_JWT);
}

async function mockBillingBoundary(page: Page) {
  let currentPlanId = "team";
  const updates: Array<{ subscriptionId: string; body: unknown }> = [];

  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!["fetch", "xhr"].includes(request.resourceType())) {
      await route.continue();
      return;
    }

    const url = new URL(request.url());
    const pathname = url.pathname;
    const isProductApi = pathname.includes("/agents/")
      || pathname.endsWith("/agents")
      || pathname.startsWith("/api/user");
    if (!isProductApi) {
      await route.continue();
      return;
    }

    const fulfill = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (request.method() === "POST" && /\/agents\/subscriptions\/[^/]+\/update$/.test(pathname)) {
      const subscriptionId = pathname.split("/").at(-2) ?? "";
      const body = request.postDataJSON() as { plan_id?: string };
      updates.push({ subscriptionId, body });
      currentPlanId = body.plan_id ?? currentPlanId;
      const plan = planById(currentPlanId);
      await fulfill({
        ok: true,
        message: "Subscription updated",
        subscription: subscriptionSummary(currentPlanId).active_subscriptions[0],
        plan,
      });
      return;
    }

    if (request.method() === "GET" && pathname.endsWith("/agents/plans/current")) {
      const plan = planById(currentPlanId);
      await fulfill({ ...plan, price: plan.price_usd });
      return;
    }
    if (request.method() === "GET" && pathname.endsWith("/agents/subscriptions/summary")) {
      await fulfill(subscriptionSummary(currentPlanId));
      return;
    }
    if (request.method() === "GET" && pathname.endsWith("/agents/plans")) {
      await fulfill({ plans });
      return;
    }
    if (request.method() === "GET" && pathname.endsWith("/agents/subscriptions")) {
      await fulfill({ items: subscriptionSummary(currentPlanId).active_subscriptions });
      return;
    }
    if (request.method() === "GET" && pathname.includes("/agents/billing/payments")) {
      await fulfill({ items: [] });
      return;
    }
    if (request.method() === "GET" && pathname.includes("/agents/usage/history")) {
      await fulfill({ history: [], days: 1 });
      return;
    }
    if (request.method() === "GET" && pathname.includes("/agents/usage/agents")) {
      await fulfill({ items: [] });
      return;
    }
    if (request.method() === "GET" && pathname.endsWith("/agents/deployments")) {
      await fulfill({ items: [], total_agents: 0, running_agents: 0, slots: {} });
      return;
    }
    if (request.method() === "GET" && pathname.endsWith("/agents/types")) {
      await fulfill({ types: [] });
      return;
    }
    if (request.method() === "GET" && pathname.startsWith("/api/user")) {
      await fulfill({ id: "user-smoke", email: "smoke@example.com" });
      return;
    }
    if (request.method() === "GET" && pathname.endsWith("/agents/users/profile-image")) {
      await fulfill({ url: null });
      return;
    }

    await fulfill({});
  });

  return { updates };
}

test("adjust plan keeps the selected bundle in Settings and confirms the change", async ({ page }) => {
  await installClawAuth(page);
  const billing = await mockBillingBoundary(page);

  await page.goto("/adjust-plan", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/\/dashboard\/agents\?view=settings&settings=billing$/);
  const settingsMenu = page.locator('aside[aria-label="Settings menu"]');
  await expect(settingsMenu).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active Bundles" })).toBeVisible();

  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByRole("button", { name: "Adjust Team bundle plan" }).click();

  await expect(page.getByTestId("subscription-plan-adjustment")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Adjust Team bundle" })).toBeVisible();
  await expect(page.getByText("Bundle sub-team-1")).toBeVisible();
  await expect(settingsMenu).toBeVisible();
  await expect(page).toHaveURL(/settings=billing$/);

  const soloOption = page.getByTestId("plan-change-option-solo");
  const proOption = page.getByTestId("plan-change-option-pro");
  await expect(soloOption.getByText("Downgrade")).toBeVisible();
  await expect(proOption.getByText("Upgrade")).toBeVisible();

  await soloOption.getByRole("radio").focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Review downgrade" }).click();

  await expect(page.getByRole("heading", { name: "Confirm downgrade" })).toBeVisible();
  await expect(page.getByText(/Other active bundles stay unchanged/i)).toBeVisible();
  expect(billing.updates).toHaveLength(0);

  await page.getByTestId("plan-change-confirm").click();

  await expect.poll(() => billing.updates).toEqual([
    {
      subscriptionId: "sub-team-1",
      body: { plan_id: "solo", quantity: 1 },
    },
  ]);
  await expect(page.getByText("Solo is now active for this bundle.")).toBeVisible();
  await expect(settingsMenu).toBeVisible();
  await expect(page).toHaveURL(/settings=billing$/);
});

test("mobile adjustment keeps a visible route back to Settings", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installClawAuth(page);
  await mockBillingBoundary(page);

  await page.goto("/dashboard/agents?view=settings&settings=billing", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Active Bundles" })).toBeVisible();

  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByRole("button", { name: "Adjust Team bundle plan" }).click();

  await expect(page.getByRole("heading", { name: "Adjust Team bundle" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to settings" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Back to settings" }).click();

  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/agents\?view=settings$/);
});
