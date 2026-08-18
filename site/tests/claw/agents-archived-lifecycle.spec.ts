import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page, type Route } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const AGENT_ID = "03f31472-3f7f-4441-8fb1-68898c87f385";

type LifecycleState = "STOPPED" | "ARCHIVED";

// The newest launch epoch any snapshot in this spec reports. The stored secret
// projection is never older than the Agent's current launch epoch.
const LATEST_LAUNCH_EPOCH = 6;

// START takes one complete replacement launch_config, which the SDK rebuilds
// from this stored projection, so the snapshot has to carry every required key.
function storedLaunchConfig() {
  return {
    config: {},
    image: "ghcr.io/hypercli/hypercli-openclaw:pro-latest",
    env: {},
    secrets: {},
    routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
    command: [],
    entrypoint: [],
    restart: false,
    sync_root: "/home/node",
    sync_uid: null,
    sync_gid: null,
    sync_exclude: [],
    registry_url: null,
    registry_auth: {},
    runtime_scopes: ["files:*"],
  };
}

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
    launch_config: storedLaunchConfig(),
    secret_names: [],
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

async function installDeploymentEventSocket(page: Page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const state: {
      ready: boolean;
      socket: MockDeploymentWebSocket | null;
      emit(frame: unknown): void;
    } = {
      ready: false,
      socket: null,
      emit(frame) {
        this.socket?.emit(frame);
      },
    };

    class MockDeploymentWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = MockDeploymentWebSocket.CONNECTING;
      private readonly listeners = new Map<string, Set<(event: { data?: string }) => void>>();

      constructor() {
        state.socket = this;
        window.setTimeout(() => {
          this.readyState = MockDeploymentWebSocket.OPEN;
          this.dispatch("open", {});
        }, 0);
      }
      addEventListener(type: string, listener: (event: { data?: string }) => void) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }
      removeEventListener(type: string, listener: (event: { data?: string }) => void) {
        this.listeners.get(type)?.delete(listener);
      }
      send(raw: string) {
        if (JSON.parse(raw).type === "auth") {
          state.ready = true;
          this.emit({ type: "ready" });
        }
      }
      close() {
        if (this.readyState === MockDeploymentWebSocket.CLOSED) return;
        this.readyState = MockDeploymentWebSocket.CLOSED;
        this.dispatch("close", {});
      }
      emit(frame: unknown) {
        window.setTimeout(() => this.dispatch("message", { data: JSON.stringify(frame) }), 0);
      }
      private dispatch(type: string, event: { data?: string }) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    (window as any).__archivedLifecycleEvents = state;
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: new Proxy(NativeWebSocket, {
        construct(Target, args) {
          if (String(args[0] ?? "").startsWith("ws://events.example.test/")) return new MockDeploymentWebSocket();
          return Reflect.construct(Target, args);
        },
      }),
    });
  });
}

async function fulfillDefaultAgentRequest(route: Route) {
  const pathName = new URL(route.request().url()).pathname;
  if (pathName.endsWith(`/agents/deployments/${AGENT_ID}/secrets`)) {
    // Rebuilding the START launch_config rehydrates the stored secret names.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ names: [], launch_epoch: LATEST_LAUNCH_EPOCH }),
    });
    return;
  }
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
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}`) && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agentSnapshot(state)) });
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
      // Every read before the rejected start is still the stale STOPPED
      // snapshot, including the one START itself makes to rebuild the stored
      // launch_config. Only the reconciliation read after the 409 is
      // authoritative.
      const state = exactGets <= 3 ? "STOPPED" : "ARCHIVED";
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
  // get:3 is START rebuilding the complete replacement launch_config from the
  // stored projection; get:4 is the post-409 exact reconciliation.
  expect(lifecycleRequests).toEqual(["get:1", "get:2", "get:3", "start", "get:4"]);

  await lifecycleCta.click();
  await expect.poll(() => restoreCalls).toBe(1);
  expect(startCalls).toBe(1);
});

test("dev stale list replay preserves restore and rapid clicks issue one restore", async ({ page }) => {
  let exactGets = 0;
  let listGets = 0;
  let restoreCalls = 0;
  let startCalls = 0;
  let releaseRestore!: () => void;
  const restoreGate = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  const staleStopped = {
    ...agentSnapshot("STOPPED"),
    name: "solar-matrix",
    updated_at: "2026-08-13T00:00:00Z",
  };
  const authoritativeArchived = {
    ...agentSnapshot("ARCHIVED"),
    name: "solar-matrix",
    updated_at: "2026-08-13T00:00:10Z",
  };

  await authenticate(page);
  await installDeploymentEventSocket(page);
  await page.route("**/agents/**", async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (pathName.endsWith("/agents/deployments/events/token") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token: "events-token", ws_url: "ws://events.example.test/ws/deployments" }),
      });
      return;
    }
    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      listGets += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([staleStopped]) });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}`) && method === "GET") {
      exactGets += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(exactGets <= 2 ? staleStopped : authoritativeArchived),
      });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}/start`) && method === "POST") {
      startCalls += 1;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Agent storage must finish explicit restore before start" }),
      });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}/restore`) && method === "POST") {
      restoreCalls += 1;
      await restoreGate;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agentSnapshot("STOPPED", 6)) });
      return;
    }
    await fulfillDefaultAgentRequest(route);
  });

  await page.goto(`/dev/agent-setup/agents?agentId=${AGENT_ID}`, { waitUntil: "domcontentloaded" });
  const lifecycleCta = page.getByTestId("agent-launch-empty-state").getByTestId("agent-launch-entry");
  await expect(lifecycleCta).toHaveAccessibleName("Start agent");
  await lifecycleCta.click();
  await expect(page.getByTestId("agent-error-banner")).toContainText("API Error 409");
  await expect(lifecycleCta).toHaveAccessibleName("Restore agent");
  expect(startCalls).toBe(1);

  await page.waitForFunction(() => Boolean((window as any).__archivedLifecycleEvents?.ready));
  const listGetsBeforeEvent = listGets;
  await page.evaluate(() => {
    (window as any).__archivedLifecycleEvents.emit({
      type: "deployment.transition",
      agent_id: "03f31472-3f7f-4441-8fb1-68898c87f385",
      state: "STOPPED",
      launch_epoch: 5,
    });
  });
  await expect.poll(() => listGets, { timeout: 10_000 }).toBeGreaterThan(listGetsBeforeEvent);
  await expect(lifecycleCta).toHaveAccessibleName("Restore agent");

  try {
    await lifecycleCta.click();
    await expect.poll(() => restoreCalls).toBe(1);
    await expect(lifecycleCta).toBeDisabled();
    await lifecycleCta.evaluate((element) => (element as HTMLButtonElement).click());
    await page.waitForTimeout(100);
    expect(restoreCalls).toBe(1);
    expect(startCalls).toBe(1);
  } finally {
    releaseRestore();
  }
  await expect(lifecycleCta).toHaveAccessibleName("Start agent");
  expect(restoreCalls).toBe(1);
  expect(startCalls).toBe(1);
});
