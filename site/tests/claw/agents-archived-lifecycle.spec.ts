import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page, type Route } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const AGENT_ID = "03f31472-3f7f-4441-8fb1-68898c87f385";

type LifecycleState = "STOPPED" | "ARCHIVED";

function agentSnapshot(state: LifecycleState, launchEpoch = 5) {
  return {
    id: AGENT_ID,
    name: "quiet-forge-works",
    user_id: "user-lifecycle-test",
    state,
    is_launchable: true,
    cpu: 1,
    memory: 4,
    hostname: null,
    launch_epoch: launchEpoch,
    archived_at: state === "ARCHIVED" ? "2026-08-13T00:00:00Z" : null,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-13T00:00:00Z",
  };
}

async function authenticate(page: Page) {
  await page.context().addCookies([{
    name: "auth_token",
    value: TEST_JWT,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }]);
  await page.addInitScript((token) => {
    window.localStorage.setItem("claw_auth_token", token);
  }, TEST_JWT);
}

async function fulfillDefaultAgentRequest(route: Route) {
  const pathName = new URL(route.request().url()).pathname;
  if (pathName.endsWith("/agents/deployments/budget")) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ pooled_tpd: 0, slots: {}, size_presets: {} }),
    });
    return;
  }
  if (pathName.endsWith("/agents/plans")) {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plans: [] }) });
    return;
  }
  await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
}

test("archived central lifecycle CTA restores and never starts", async ({ page }) => {
  let restoreCalls = 0;
  let startCalls = 0;
  let state: LifecycleState = "ARCHIVED";

  await authenticate(page);
  await page.route("**/agents/**", async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const method = route.request().method();

    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([agentSnapshot(state)]) });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}/restore`) && method === "POST") {
      restoreCalls += 1;
      state = "STOPPED";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agentSnapshot(state, 6)) });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}/start`) && method === "POST") {
      startCalls += 1;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "start must not be called" }) });
      return;
    }
    await fulfillDefaultAgentRequest(route);
  });

  await page.goto(`/dashboard/agents?agentId=${AGENT_ID}`, { waitUntil: "domcontentloaded" });
  const lifecycleCta = page.getByTestId("agent-launch-empty-state").getByTestId("agent-launch-entry");
  await expect(lifecycleCta).toHaveAccessibleName("Restore agent");
  await lifecycleCta.click();

  await expect.poll(() => restoreCalls).toBe(1);
  expect(startCalls).toBe(0);
  await expect(lifecycleCta).toHaveAccessibleName("Start agent");
});

test("stale start 409 refetches the exact agent and the next CTA restores", async ({ page }) => {
  let exactGets = 0;
  let restoreCalls = 0;
  let startCalls = 0;
  const lifecycleRequests: string[] = [];

  await authenticate(page);
  await page.route("**/agents/**", async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const method = route.request().method();

    // Keep the collection snapshot stale. Only the exact reconciliation GET
    // reveals the authoritative ARCHIVED state after the rejected start.
    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([agentSnapshot("STOPPED")]) });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}`) && method === "GET") {
      exactGets += 1;
      lifecycleRequests.push(`get:${exactGets}`);
      const state = exactGets === 1 ? "STOPPED" : "ARCHIVED";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agentSnapshot(state)) });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}/start`) && method === "POST") {
      startCalls += 1;
      lifecycleRequests.push("start");
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Agent storage must finish explicit restore before start" }),
      });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}/restore`) && method === "POST") {
      restoreCalls += 1;
      lifecycleRequests.push("restore");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agentSnapshot("STOPPED", 6)) });
      return;
    }
    await fulfillDefaultAgentRequest(route);
  });

  await page.goto(`/dashboard/agents?agentId=${AGENT_ID}`, { waitUntil: "domcontentloaded" });
  const lifecycleCta = page.getByTestId("agent-launch-empty-state").getByTestId("agent-launch-entry");
  await expect(lifecycleCta).toHaveAccessibleName("Start agent");
  await lifecycleCta.click();

  await expect(page.getByTestId("agent-error-banner")).toContainText(
    "API Error 409",
  );
  await expect(page.getByTestId("agent-error-banner")).toContainText(
    "Agent storage must finish explicit restore before start",
  );
  await expect(lifecycleCta).toHaveAccessibleName("Restore agent");
  expect(startCalls).toBe(1);
  expect(restoreCalls).toBe(0);
  expect(lifecycleRequests).toEqual(["get:1", "start", "get:2"]);

  await lifecycleCta.click();
  await expect.poll(() => restoreCalls).toBe(1);
  expect(startCalls).toBe(1);
});
