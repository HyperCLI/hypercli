import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";

test("agents page launches from a direct entitlement without an active subscription", async ({ page }) => {
  let createBody: Record<string, unknown> | null = null;

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
    const method = route.request().method();

    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }

    if (pathName.endsWith("/agents/deployments") && method === "POST") {
      createBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "agent-direct-entitlement",
          name: "Direct Entitlement Agent",
          user_id: "user-1",
          state: "STARTING",
          cpu: 4,
          memory: 4,
          hostname: "direct-entitlement-agent.hypercli.app",
          created_at: "2026-05-17T00:00:00Z",
          updated_at: "2026-05-17T00:00:00Z",
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/plans")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plans: [
            {
              id: "pro",
              name: "Pro",
              price: 99,
              price_usd: 99,
              highlighted: true,
              features: ["Priority routing", "250M tokens/day"],
              models: [],
              limits: { tpd: 250000000, burst_tpm: 8680550, rpm: 868 },
              slot_grants: { large: 1 },
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
          id: "pro",
          name: "Pro",
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
          effective_plan_id: "pro",
          current_subscription_id: null,
          current_entitlement_id: "ent-direct-1",
          pooled_tpm_limit: 8680550,
          pooled_rpm_limit: 868,
          pooled_tpd: 250000000,
          slot_inventory: {
            large: { granted: 1, used: 0, available: 1 },
          },
          active_subscription_count: 0,
          active_entitlement_count: 1,
          entitlements: {
            effective_plan_id: "pro",
            pooled_tpm_limit: 8680550,
            pooled_rpm_limit: 868,
            pooled_tpd: 250000000,
            slot_inventory: {
              large: { granted: 1, used: 0, available: 1 },
            },
            active_entitlement_count: 1,
          },
          entitlement_items: [
            {
              id: "ent-direct-1",
              user_id: "user-1",
              subscription_id: null,
              plan_id: "pro",
              plan_name: "Pro",
              provider: "ACTIVATION_CODE",
              status: "ACTIVE",
              slot_grants: { large: 1 },
            },
          ],
          active_subscriptions: [],
          subscriptions: [],
          user: { id: "user-1" },
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/usage/history")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ history: [] }) });
      return;
    }

    if (pathName.endsWith("/agents/types")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          types: [
            { id: "small", name: "Small", cpu: 1, memory: 1, cpu_limit: 1, memory_limit: 1 },
            { id: "medium", name: "Medium", cpu: 2, memory: 2, cpu_limit: 2, memory_limit: 2 },
            { id: "large", name: "Large", cpu: 4, memory: 4, cpu_limit: 4, memory_limit: 4 },
          ],
          plans: [],
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/dashboard/agents", { waitUntil: "domcontentloaded" });

  await page
    .locator("main")
    .locator("section, [data-testid='agent-empty-state']")
    .getByRole("button", { name: /^launch agent$/i })
    .last()
    .click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Pro" })).toBeVisible();
  await expect(page.getByText("Uses your active direct entitlement")).toBeVisible();
  await expect(page.getByText("1 Large slot available")).toBeVisible();
  await page.getByRole("button", { name: "Launch agent" }).click();

  await expect.poll(() => createBody?.size ?? null).toBe("large");
});
