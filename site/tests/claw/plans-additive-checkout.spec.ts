import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";

test("plans page shows additive entitlements and repeat purchase CTA", async ({ page }) => {
  await page.context().addCookies([
    {
      name: "auth_token",
      value: TEST_JWT,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.addInitScript((token) => {
    window.localStorage.setItem("claw_auth_token", token);
  }, TEST_JWT);

  await page.route("**/agents/**", async (route) => {
    const url = new URL(route.request().url());
    const pathName = url.pathname;

    if (pathName.endsWith("/agents/plans/current")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "5aiu",
          name: "5 AIU",
          price: 100,
          aiu: 5,
          pooled_tpd: 250000000,
          slot_inventory: {
            large: { granted: 1, used: 0, available: 1 },
          },
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/subscriptions/summary")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          effective_plan_id: "5aiu",
          current_subscription_id: "sub-1",
          current_entitlement_id: "sub-1",
          pooled_tpm_limit: 173611,
          pooled_rpm_limit: 3472,
          pooled_tpd: 250000000,
          billing_reset_at: "2026-04-15T00:00:00Z",
          slot_inventory: {
            large: { granted: 1, used: 0, available: 1 },
          },
          active_subscription_count: 1,
          active_entitlement_count: 1,
          entitlements: {
            effective_plan_id: "5aiu",
            pooled_tpm_limit: 173611,
            pooled_rpm_limit: 3472,
            pooled_tpd: 250000000,
            slot_inventory: {
              large: { granted: 1, used: 0, available: 1 },
            },
            active_entitlement_count: 1,
          },
          active_subscriptions: [
            {
              id: "sub-1",
              user_id: "user-1",
              plan_id: "5aiu",
              plan_name: "5 AIU",
              provider: "STRIPE",
              status: "ACTIVE",
              quantity: 1,
              current_period_end: "2026-04-15T00:00:00Z",
              slot_grants: { small: 0, medium: 0, large: 1 },
              meta: { bundle: { large: 1 } },
            },
          ],
          subscriptions: [],
          user: { id: "user-1" },
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/plans", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /^plans$/i })).toBeVisible();
  await expect(page.getByText(/Inference pools across all active entitlements/i)).toBeVisible();
  const billingResetCard = page.locator(".glass-card").filter({ has: page.getByText("Billing Reset") }).first();
  await expect(billingResetCard).toContainText("2026");
  await expect(billingResetCard).not.toContainText("N/A");
  await expect(page.getByText(/0 \/ 1 used/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /entitlement instances/i })).toBeVisible();
  await expect(page.getByText(/customer=acme/i)).toBeVisible();
  await expect(page.getByText(/1 active agent bound/i)).toBeVisible();

  const ownedCard = page.locator(".glass-card").filter({ has: page.getByRole("heading", { name: "Pro" }) }).first();
  await expect(ownedCard.getByText(/You own 1/i)).toBeVisible();
  await expect(ownedCard.getByText(/1x Large/i).first()).toBeVisible();
  await expect(ownedCard.getByRole("button", { name: /add another/i })).toBeVisible();
});

test("plans page displays cumulative pooled inference across mixed entitlements", async ({ page }) => {
  await page.context().addCookies([
    {
      name: "auth_token",
      value: TEST_JWT,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.addInitScript((token) => {
    window.localStorage.setItem("claw_auth_token", token);
  }, TEST_JWT);

  await page.route("**/agents/**", async (route) => {
    const url = new URL(route.request().url());
    const pathName = url.pathname;

    if (pathName.endsWith("/agents/plans/current")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "large",
          name: "Large",
          pooled_tpd: 300000000,
          slot_inventory: {
            large: { granted: 1, used: 1, available: 0 },
            small: { granted: 1, used: 0, available: 1 },
          },
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/subscriptions/summary")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          effective_plan_id: "large",
          current_subscription_id: "sub-large",
          current_entitlement_id: "sub-large",
          pooled_tpm_limit: 208333,
          pooled_rpm_limit: 4200,
          pooled_tpd: 300000000,
          billing_reset_at: "2026-04-12T00:00:00Z",
          slot_inventory: {
            large: { granted: 1, used: 1, available: 0 },
            small: { granted: 1, used: 0, available: 1 },
          },
          active_subscription_count: 2,
          active_entitlement_count: 2,
          entitlements: {
            effective_plan_id: "large",
            pooled_tpm_limit: 208333,
            pooled_rpm_limit: 4200,
            pooled_tpd: 300000000,
            slot_inventory: {
              large: { granted: 1, used: 1, available: 0 },
              small: { granted: 1, used: 0, available: 1 },
            },
            active_entitlement_count: 2,
          },
          active_subscriptions: [
            {
              id: "sub-large",
              user_id: "user-1",
              plan_id: "large",
              plan_name: "Large",
              provider: "STRIPE",
              status: "ACTIVE",
              quantity: 1,
              current_period_end: "2026-04-12T00:00:00Z",
              slot_grants: { small: 0, medium: 0, large: 1 },
              meta: { bundle: { large: 1 } },
            },
            {
              id: "sub-small",
              user_id: "user-1",
              plan_id: "small",
              plan_name: "Small",
              provider: "X402",
              status: "ACTIVE",
              quantity: 1,
              current_period_end: "2026-04-12T00:00:00Z",
              slot_grants: { small: 1, medium: 0, large: 0 },
              meta: { bundle: { small: 1 } },
            },
          ],
          subscriptions: [],
          user: { id: "user-1" },
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/plans", { waitUntil: "domcontentloaded" });

  await expect(page.getByText(/^300M$/)).toBeVisible();
  await expect(page.getByText(/tokens\/day across all active entitlements/i)).toBeVisible();
  await expect(page.getByText(/^2$/)).toBeVisible();
  await expect(page.getByText(/1 \/ 1 used/i)).toBeVisible();
  await expect(page.getByText(/0 \/ 1 used/i)).toBeVisible();
});

test("plans page shows billing subscriptions and supports cancel at period end", async ({ page }) => {
  let cancelHits = 0;

  await page.context().addCookies([
    {
      name: "auth_token",
      value: TEST_JWT,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.addInitScript((token) => {
    window.localStorage.setItem("claw_auth_token", token);
  }, TEST_JWT);

  await page.route("**/agents/**", async (route) => {
    const url = new URL(route.request().url());
    const pathName = url.pathname;

    if (pathName.endsWith("/agents/plans/current")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "large",
          name: "Large",
          pooled_tpd: 250000000,
          slot_inventory: {
            large: { granted: 1, used: 0, available: 1 },
          },
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/subscriptions/summary")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          effective_plan_id: "large",
          current_subscription_id: "sub-1",
          current_entitlement_id: "sub-1",
          pooled_tpm_limit: 173611,
          pooled_rpm_limit: 3472,
          pooled_tpd: 250000000,
          slot_inventory: {
            large: { granted: 1, used: 0, available: 1 },
          },
          active_subscription_count: 1,
          active_entitlement_count: 1,
          entitlements: {
            effective_plan_id: "large",
            pooled_tpm_limit: 173611,
            pooled_rpm_limit: 3472,
            pooled_tpd: 250000000,
            slot_inventory: {
              large: { granted: 1, used: 0, available: 1 },
            },
            active_entitlement_count: 1,
          },
          active_subscriptions: [],
          subscriptions: [
            {
              id: "sub-1",
              user_id: "user-1",
              plan_id: "large",
              plan_name: "Large",
              provider: "STRIPE",
              status: "ACTIVE",
              quantity: 1,
              expires_at: "2026-05-10T00:00:00Z",
              can_cancel: true,
              cancel_at_period_end: false,
              slot_grants: { small: 0, medium: 0, large: 1 },
              meta: { bundle: { large: 1 } },
            },
          ],
          user: { id: "user-1" },
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/subscriptions/sub-1/cancel") && route.request().method() === "POST") {
      cancelHits += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          message: "Subscription will be cancelled at the end of the current billing period",
          subscription: {
            id: "sub-1",
            user_id: "user-1",
            plan_id: "large",
            plan_name: "Large",
            provider: "STRIPE",
            status: "ACTIVE",
            quantity: 1,
            expires_at: "2026-05-10T00:00:00Z",
            can_cancel: true,
            cancel_at_period_end: true,
            slot_grants: { small: 0, medium: 0, large: 1 },
            meta: { bundle: { large: 1 } },
          },
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });

  await page.goto("/plans", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /billing subscriptions/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /cancel at period end/i })).toBeVisible();
  await page.getByRole("button", { name: /cancel at period end/i }).click();
  await expect.poll(() => cancelHits).toBe(1);
});
