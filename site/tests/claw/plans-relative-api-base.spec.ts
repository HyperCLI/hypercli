import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const TEST_BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:48651";

test("plans page uses same-origin agents API when the frontend base is relative", async ({ page }) => {
  let wrongHostHits = 0;

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

  await page.route(`${TEST_BASE_URL}/agents/**`, async (route) => {
    const url = new URL(route.request().url());
    const pathName = url.pathname;

    if (pathName.endsWith("/agents/plans")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plans: [
            {
              id: "5aiu",
              name: "5 AIU",
              price: 100,
              aiu: 5,
              highlighted: true,
              features: ["1 large agent", "Priority support"],
              models: ["kimi-k2.5"],
              limits: { tpd: 250000000, tpm: 173611, burst_tpm: 694444, rpm: 3472 },
              tpm_limit: 173611,
              rpm_limit: 3472,
            },
          ],
        }),
      });
      return;
    }

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
          pooled_tpm_limit: 0,
          pooled_rpm_limit: 0,
          pooled_tpd: 0,
          slot_inventory: {},
          active_subscription_count: 0,
          active_subscriptions: [],
          subscriptions: [],
          user: { id: "user-1" },
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/types")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plans: [
            { id: "5aiu", name: "5 AIU", price: 100, agents: 1, agent_type: "large", highlighted: true },
          ],
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/plans", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /^plans$/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "5 AIU" })).toBeVisible();
  await expect(page.getByRole("button", { name: /purchase/i }).first()).toBeVisible();
  expect(wrongHostHits).toBe(0);
});
