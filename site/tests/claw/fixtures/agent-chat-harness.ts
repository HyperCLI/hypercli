import { expect, type Page } from "@playwright/test";

/**
 * Shared bootstrap for intercepted Claw agent-chat specs: auth cookie +
 * localStorage token, backend intercepts for one RUNNING agent deployment
 * whose gateway URL targets `.example.test` (the in-page mock seam), and the
 * chat tab navigation. Mirrors the contract already used by
 * `skills-proposals-intercepted.spec.ts`.
 */

export const AGENT_CHAT_TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";

export interface AgentChatHarnessOptions {
  agentId: string;
  hostname: string;
  syncRoot?: string;
}

export async function installAgentChatAuth(page: Page): Promise<void> {
  const baseUrl = (process.env.TEST_BASE_URL ?? "").trim();
  if (!baseUrl) throw new Error("TEST_BASE_URL is required for the intercepted agent-chat tests");
  await page.context().addCookies([
    {
      name: "auth_token",
      value: AGENT_CHAT_TEST_JWT,
      url: new URL(baseUrl).origin,
      httpOnly: false,
      secure: new URL(baseUrl).protocol === "https:",
      sameSite: "Lax",
    },
  ]);
  await page.addInitScript((token) => {
    window.localStorage.setItem("claw_auth_token", token);
  }, AGENT_CHAT_TEST_JWT);
}

export async function interceptAgentChatBackend(page: Page, options: AgentChatHarnessOptions): Promise<void> {
  const { agentId, hostname, syncRoot } = options;
  const deployment = {
    id: agentId,
    name: "Intercepted Chat Agent",
    user_id: "user-1",
    state: "RUNNING",
    cpu: 2,
    memory: 8,
    hostname,
    openclaw_url: `wss://${hostname}`,
    gateway_url: `wss://${hostname}`,
    launch_epoch: 1,
    ...(syncRoot ? { launch_config: { sync_root: syncRoot } } : {}),
    routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
    created_at: "2026-08-24T00:00:00Z",
    updated_at: "2026-08-24T00:00:00Z",
  };

  await page.route("**/agents/**", async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const method = route.request().method();

    if (pathName.endsWith(`/agents/deployments/${agentId}/routes`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agent_id: agentId,
          routes: deployment.routes,
          route_statuses: {
            openclaw: { dns_state: "active", hostname, url: `https://${hostname}` },
          },
        }),
      });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${agentId}/secrets/OPENCLAW_GATEWAY_TOKEN`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agent_id: agentId,
          key: "OPENCLAW_GATEWAY_TOKEN",
          value: "intercepted-gateway-token",
          launch_epoch: 1,
        }),
      });
      return;
    }
    if (pathName.endsWith("/agents/deployments/events/token") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "deployments-events-token",
          ws_url: "wss://deployment-events.example.test/events",
        }),
      });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${agentId}`) && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(deployment) });
      return;
    }
    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([deployment]) });
      return;
    }
    if (pathName.endsWith("/agents/plans")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plans: [{
            id: "pro",
            name: "Pro",
            price: 80,
            price_usd: 80,
            features: [],
            models: [],
            limits: { tpd: 250000000, burst_tpm: 8680550, rpm: 868 },
            slot_grants: { large: 1 },
          }],
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
          slot_inventory: { large: { granted: 1, used: 1, available: 0 } },
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
          pooled_tpd: 250000000,
          slot_inventory: { large: { granted: 1, used: 1, available: 0 } },
          active_subscription_count: 1,
          active_entitlement_count: 1,
          entitlements: {
            effective_plan_id: "pro",
            active_entitlement_count: 1,
            slot_inventory: { large: { granted: 1, used: 1, available: 0 } },
          },
          active_subscriptions: [{ id: "sub-pro", plan_id: "pro", plan_name: "Pro", quantity: 1, status: "active" }],
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
        body: JSON.stringify({ types: [{ id: "large", name: "Large", cpu: 2, memory: 8 }], plans: [] }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route("**/api/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "user-1", email: "intercepted-chat@example.test", name: "Intercepted Chat" }),
    });
  });

  await page.route(/\/workspaces(?:\/.*)?$/, async (route) => {
    const workspace = {
      id: "workspace-intercepted-chat",
      name: "Intercepted Chat",
      slug: "workspace-intercepted-chat",
      display_name: "Intercepted Chat",
      role: "admin",
    };
    const pathName = new URL(route.request().url()).pathname;
    if (pathName.includes("/agents") || pathName.includes("/grants")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pathName.endsWith(`/${workspace.id}`) ? workspace : [workspace]),
    });
  });
}

export async function openAgentChatTab(page: Page, agentId: string): Promise<void> {
  await page.goto(`/dashboard/agents?agentId=${encodeURIComponent(agentId)}`, { waitUntil: "domcontentloaded" });
  const composer = page.getByTestId("agent-chat-composer");
  await expect(composer).toBeEnabled({ timeout: 90_000 });
}

export async function sendAgentChatMessage(page: Page, prompt: string): Promise<void> {
  const composer = page.getByTestId("agent-chat-composer");
  await composer.fill(prompt);
  await composer.press("Enter");
}
