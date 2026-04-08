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
              agents: 1,
              highlighted: true,
              features: ["1 large agent", "Priority support"],
              models: ["kimi-k2.5"],
              limits: { tpd: 250000000, tpm: 173611, burst_tpm: 694444, rpm: 3472 },
              tpm_limit: 173611,
              rpm_limit: 3472,
            },
            {
              id: "10aiu",
              name: "10 AIU",
              price: 200,
              aiu: 10,
              agents: 2,
              features: ["Up to 2 large agents", "Dedicated support"],
              models: ["kimi-k2.5"],
              limits: { tpd: 500000000, tpm: 347222, burst_tpm: 1388888, rpm: 6944 },
              tpm_limit: 347222,
              rpm_limit: 6944,
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
            },
          ],
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
          types: [
            { id: "small", name: "Small", cpu: 0.5, memory: 4, cpu_limit: 2, memory_limit: 4 },
            { id: "medium", name: "Medium", cpu: 1, memory: 4, cpu_limit: 2, memory_limit: 6 },
            { id: "large", name: "Large", cpu: 2, memory: 4, cpu_limit: 4, memory_limit: 8 },
          ],
          plans: [
            { id: "5aiu", name: "5 AIU", price: 100, agents: 1, agent_type: "large", highlighted: true },
            { id: "10aiu", name: "10 AIU", price: 200, agents: 2, agent_type: "large", highlighted: false },
          ],
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/plans", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /^plans$/i })).toBeVisible();
  await expect(page.getByText(/Inference pools across all active entitlements/i)).toBeVisible();
  await expect(page.getByText(/1 free \/ 1 total/i)).toBeVisible();

  const ownedCard = page.locator(".glass-card").filter({ has: page.getByRole("heading", { name: "5 AIU" }) }).first();
  await expect(ownedCard.getByText(/You own 1/i)).toBeVisible();
  await expect(ownedCard.getByText(/1 Large slot/i)).toBeVisible();
  await expect(ownedCard.getByRole("button", { name: /add another/i })).toBeVisible();
});
