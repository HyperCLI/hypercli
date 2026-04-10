import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const TEST_BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:48651";

test("plans page uses a valid agents API host when the frontend base is relative", async ({ page }) => {
  let wrongHostHits = 0;
  const allowedOrigins = new Set([TEST_BASE_URL, "https://api.dev.hypercli.com"]);

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

  await page.route("https://agents/**", async (route) => {
    wrongHostHits += 1;
    await route.abort();
  });

  await page.route("**/agents/**", async (route) => {
    const url = new URL(route.request().url());
    if (!allowedOrigins.has(url.origin)) {
      await route.abort();
      return;
    }
    const pathName = url.pathname;

    if (pathName.endsWith("/agents/plans/current")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "free",
          name: "Free",
          price: 0,
          pooled_tpd: 0,
          slot_inventory: {},
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/subscriptions/summary")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          effective_plan_id: "free",
          current_subscription_id: null,
          current_entitlement_id: null,
          pooled_tpm_limit: 0,
          pooled_rpm_limit: 0,
          pooled_tpd: 0,
          slot_inventory: {},
          active_subscription_count: 0,
          active_entitlement_count: 0,
          entitlements: {
            effective_plan_id: "free",
            pooled_tpm_limit: 0,
            pooled_rpm_limit: 0,
            pooled_tpd: 0,
            slot_inventory: {},
            active_entitlement_count: 0,
          },
          active_subscriptions: [],
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
  await expect(page.getByRole("heading", { name: "Pro" })).toBeVisible();
  await expect(page.getByRole("button", { name: /purchase/i }).first()).toBeVisible();
  expect(wrongHostHits).toBe(0);
});
