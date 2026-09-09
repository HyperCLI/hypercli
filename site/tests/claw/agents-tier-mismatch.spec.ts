import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";

test("agents page resizes a stopped agent to an available tier before starting it", async ({ page }) => {
  let startCalls = 0;
  let patchCalls = 0;
  const launchConfig = {
    config: {},
    image: "ghcr.io/hypercli/hypercli-openclaw:pro-latest",
    env: {},
    routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
    command: [],
    entrypoint: [],
    restart: false,
    sync_root: "/home/node",
    sync_uid: null,
    sync_gid: null,
    registry_url: null,
    runtime_scopes: ["models:*"],
  };

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
            state: "STOPPED",
            cpu: 2,
            memory: 2,
            hostname: "deep-sage-agent.hypercli.app",
            launch_config: launchConfig,
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
            small: { cpu: 0.5, memory: 2 },
            medium: { cpu: 1, memory: 4 },
            large: { cpu: 2, memory: 8 },
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
            { id: "small", name: "Small", cpu: 0.5, memory: 2 },
            { id: "medium", name: "Medium", cpu: 1, memory: 4 },
            { id: "large", name: "Large", cpu: 2, memory: 8 },
          ],
          plans: [
            { id: "pro", name: "Pro", price: 149, agents: 3, agent_type: "large", highlighted: false },
          ],
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/deployments/agent-1/start")) {
      const startBody = route.request().postData();
      if (startBody?.includes("launch_config")) {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ detail: "START launch_config is not supported" }) });
        return;
      }
      startCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "agent-1",
          name: "Deep Sage Agent",
          user_id: "user-1",
          state: "RUNNING",
          cpu: 4,
          memory: 4,
          hostname: "deep-sage-agent.hypercli.app",
          openclaw_url: "wss://deep-sage-agent.hypercli.app",
          launch_epoch: 1,
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/deployments/agent-1") && route.request().method() === "PATCH") {
      patchCalls += 1;
      const patchBody = route.request().postDataJSON() as Record<string, unknown>;
      expect(patchBody).toEqual(
        "size" in patchBody
          ? { size: "large" }
          : { launch_config: expect.objectContaining({ image: expect.any(String) }) },
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "agent-1",
          name: "Deep Sage Agent",
          user_id: "user-1",
          state: "STOPPED",
          cpu: 4,
          memory: 4,
          hostname: "deep-sage-agent.hypercli.app",
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/dashboard/agents", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/dashboard\/agents$/);

  await page.getByRole("button", { name: /start agent/i }).click();
  const selector = page.locator(".glass-card").filter({ hasText: "Medium slot required" }).first();
  await expect(selector.getByRole("heading", { name: /medium slot required/i })).toBeVisible();
  await expect(selector.getByText(/This agent was created as a Medium agent/i)).toBeVisible();
  await expect(selector.getByRole("button", { name: /Large\s+4 free/i })).toBeVisible();
  await expect(selector.getByRole("button", { name: /^Medium$/i })).toHaveCount(0);

  await selector.getByRole("button", { name: /Large\s+4 free/i }).click();

  await expect.poll(() => patchCalls).toBe(2);
  await expect.poll(() => startCalls).toBe(1);
});
