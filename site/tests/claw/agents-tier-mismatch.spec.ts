import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";

test("agents page explains exact-tier slot mismatches and offers a create-new-agent path", async ({ page }) => {
  let startCalls = 0;

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

    if (pathName.endsWith("/agents/deployments") && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "agent-1",
            name: "Deep Sage Agent",
            user_id: "user-1",
            pod_id: null,
            pod_name: null,
            state: "STOPPED",
            cpu: 2,
            memory: 2,
            hostname: "deep-sage-agent.hypercli.app",
            created_at: "2026-04-07T00:00:00Z",
            updated_at: "2026-04-07T00:00:00Z",
          },
        ]),
      });
      return;
    }

    if (pathName.endsWith("/agents/deployments/budget") && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          pooled_tpd: 1000000000,
          slots: {
            small: { granted: 0, used: 0, available: 0 },
            medium: { granted: 0, used: 0, available: 0 },
            large: { granted: 4, used: 0, available: 4 },
          },
          size_presets: {
            small: { cpu: 1, memory: 1 },
            medium: { cpu: 2, memory: 2 },
            large: { cpu: 4, memory: 4 },
          },
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/types") && route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          types: [
            { id: "small", name: "Small", cpu: 1, memory: 1, cpu_limit: 1, memory_limit: 1 },
            { id: "medium", name: "Medium", cpu: 2, memory: 2, cpu_limit: 2, memory_limit: 2 },
            { id: "large", name: "Large", cpu: 4, memory: 4, cpu_limit: 4, memory_limit: 4 },
          ],
          plans: [
            { id: "10aiu", name: "10 AIU", price: 200, agents: 2, agent_type: "large", highlighted: true },
          ],
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/deployments/agent-1/start")) {
      startCalls += 1;
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ detail: "No available 'medium' entitlement slots" }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/dashboard/agents", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/dashboard\/agents$/);

  await expect(page.getByText(/Medium slot required/i)).toBeVisible();
  await expect(page.getByText(/This agent was created as a Medium agent/i)).toBeVisible();
  await expect(page.getByText(/4 free Large slots available/i)).toBeVisible();

  const startButtons = page.getByRole("button", { name: /start agent/i });
  await expect(startButtons.first()).toBeDisabled();

  await page.getByRole("button", { name: /create large agent/i }).click();
  await expect(page.getByRole("heading", { name: /configuration/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /large/i })).toContainText(/4 free \/ 4 total/i);
  await expect(page.getByRole("button", { name: /^back$/i })).toBeVisible();

  expect(startCalls).toBe(0);
});
