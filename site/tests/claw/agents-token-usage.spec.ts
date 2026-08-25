import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Route } from "@playwright/test";

import { loginWithPrivy } from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const AGENT_ID = "agent-token-usage";

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("shows pooled token usage when per-agent usage is unattributed", async ({ page }) => {
  const unexpectedAgentRequests = new Set<string>();

  await page.route(/\/workspaces(?:\/.*)?$/, async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const workspace = {
      id: "workspace-token-usage",
      name: "Token Usage",
      slug: "workspace-token-usage",
      display_name: "Token Usage",
      role: "admin",
    };

    if (pathName.endsWith("/agents") || pathName.endsWith("/grants")) {
      await fulfillJson(route, []);
      return;
    }
    await fulfillJson(route, pathName.endsWith("/workspace-token-usage") ? workspace : [workspace]);
  });

  await page.route("**/agents/**", async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    if (!pathName.startsWith("/agents/")) {
      await route.continue();
      return;
    }

    if (pathName.endsWith("/agents/deployments")) {
      await fulfillJson(route, [{
        id: AGENT_ID,
        name: "Usage Agent",
        user_id: "user-1",
        state: "STOPPED",
        cpu: 2,
        memory: 8,
        hostname: null,
        launch_epoch: 0,
        created_at: "2026-08-25T00:00:00Z",
        updated_at: "2026-08-25T00:00:00Z",
      }]);
      return;
    }

    if (pathName.endsWith("/agents/deployments/events/token")) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Event stream unavailable in this scenario" }),
      });
      return;
    }

    if (pathName.endsWith("/agents/users/profile-image")) {
      await fulfillJson(route, { id: "user-1", avatar_url: null, s3_key: null });
      return;
    }

    if (pathName.endsWith("/agents/plans")) {
      await fulfillJson(route, {
        plans: [{
          id: "team",
          name: "Team",
          price: 99,
          price_usd: 99,
          features: [],
          models: [],
          limits: { tpd: 100_000_000, burst_tpm: 0, rpm: 0 },
          slot_grants: { large: 1 },
        }],
      });
      return;
    }

    if (pathName.endsWith("/agents/plans/current")) {
      await fulfillJson(route, {
        id: "team",
        name: "Team",
        pooled_tpd: 100_000_000,
        slot_inventory: { large: { granted: 1, used: 1, available: 0 } },
      });
      return;
    }

    if (pathName.endsWith("/agents/subscriptions/summary")) {
      await fulfillJson(route, {
        effective_plan_id: "team",
        current_subscription_id: "subscription-1",
        current_entitlement_id: "entitlement-1",
        pooled_tpd: 100_000_000,
        slot_inventory: { large: { granted: 1, used: 1, available: 0 } },
        active_subscription_count: 1,
        active_entitlement_count: 1,
        entitlements: {
          effective_plan_id: "team",
          pooled_tpd: 100_000_000,
          slot_inventory: { large: { granted: 1, used: 1, available: 0 } },
          active_entitlement_count: 1,
        },
        entitlement_items: [],
        active_subscriptions: [],
        subscriptions: [],
        user: { id: "user-1", trial_consumed_at: "2026-08-01T00:00:00Z" },
      });
      return;
    }

    if (pathName.endsWith("/agents/usage/agents")) {
      await fulfillJson(route, {
        agents: [{
          agent_id: AGENT_ID,
          name: "Usage Agent",
          managed: true,
          total_tokens: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          requests: 0,
        }],
        unattributed: {
          total_tokens: 27_538,
          prompt_tokens: 25_000,
          completion_tokens: 2_538,
          requests: 3,
        },
        days: 1,
      });
      return;
    }

    if (pathName.endsWith("/agents/types")) {
      await fulfillJson(route, {
        types: [{ id: "large", name: "Large", cpu: 2, memory: 8 }],
        plans: [],
      });
      return;
    }

    if (pathName.endsWith("/agents/subscriptions")) {
      await fulfillJson(route, { items: [] });
      return;
    }

    if (pathName.endsWith("/agents/billing/payments")) {
      await fulfillJson(route, { items: [] });
      return;
    }

    unexpectedAgentRequests.add(`${route.request().method()} ${pathName}`);
    await fulfillJson(route, {});
  });

  await loginWithPrivy(page);
  await page.goto(`/dashboard/agents?agentId=${AGENT_ID}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();

  const usage = page.getByTestId("agent-token-usage");
  await expect(usage).toHaveText("27.5K / 100M");
  await expect(usage).not.toHaveText("0 / 100M");
  expect([...unexpectedAgentRequests]).toEqual([]);
});
