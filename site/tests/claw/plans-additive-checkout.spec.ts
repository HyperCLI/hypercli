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
          pooled_tpm_limit: 173611,
          pooled_rpm_limit: 3472,
          pooled_tpd: 250000000,
          slot_inventory: {
            large: { granted: 1, used: 0, available: 1 },
          },
          active_subscription_count: 1,
          active_subscriptions: [
            {
              id: "sub-1",
              user_id: "user-1",
              plan_id: "5aiu",
              plan_name: "5 AIU",
              provider: "STRIPE",
              status: "ACTIVE",
              quantity: 1,
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
  await expect(page.getByText(/0 \/ 1 used/i)).toBeVisible();

  const ownedCard = page.locator(".glass-card").filter({ has: page.getByRole("heading", { name: "Pro" }) }).first();
  await expect(ownedCard.getByText(/You own 1/i)).toBeVisible();
  await expect(ownedCard.getByText(/1x Large/i).first()).toBeVisible();
  await expect(ownedCard.getByRole("button", { name: /add another/i })).toBeVisible();
});
