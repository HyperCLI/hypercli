import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";
import { sanitizeDeploymentTransition } from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";

test("deployment transition diagnostics retain only bounded sanitized fields", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.sensitive-signature";
  const longToken = "a".repeat(64);
  const awsSecret = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/ab";
  const credentialsUrl = "https://diagnostic-user:short-password@example.test/path";
  const transition = sanitizeDeploymentTransition({
    type: "deployment.transition",
    agent_id: "agent-123",
    state: "STOPPING\n",
    launch_epoch: 2,
    reason: "launch_failed",
    error: `workspace_sync_failed Authorization: Bearer ${jwt}`,
    message: `first line\nsecond line ${credentialsUrl} token=${longToken} API key: short-value AWS_SECRET_ACCESS_KEY=${awsSecret} password: correct horse battery staple`,
    resources_exist: true,
    nested: { api_key: "must-not-be-stringified" },
  });

  expect(Object.keys(transition)).toEqual([
    "agent_id",
    "state",
    "launch_epoch",
    "reason",
    "error",
    "message",
  ]);
  expect(transition.agent_id).toBe("agent-123");
  expect(transition.state).toBe("STOPPING");
  expect(transition.launch_epoch).toBe(2);
  expect(transition.reason).toBe("launch_failed");
  expect(transition.message).not.toContain("\n");
  expect(JSON.stringify(transition)).not.toContain(jwt);
  expect(JSON.stringify(transition)).not.toContain(longToken);
  expect(JSON.stringify(transition)).not.toContain("short-password");
  expect(JSON.stringify(transition)).not.toContain("short-value");
  expect(JSON.stringify(transition)).not.toContain(awsSecret);
  expect(JSON.stringify(transition)).not.toContain("correct horse battery staple");
  expect(JSON.stringify(transition)).not.toContain("must-not-be-stringified");

  expect(sanitizeDeploymentTransition({
    agent_id: { value: "agent-123" },
    state: 1,
    launch_epoch: "2",
    reason: [],
    error: {},
    message: null,
  })).toEqual({
    agent_id: null,
    state: null,
    launch_epoch: null,
    reason: null,
    error: null,
    message: null,
  });

  const bounded = sanitizeDeploymentTransition({ message: `line\u0000break ${"word ".repeat(300)}` });
  expect(bounded.message).not.toContain("\u0000");
  expect(bounded.message?.length).toBeLessThanOrEqual(1_000);
  expect(bounded.message).toMatch(/\.\.\.$/);
});

test("deployment subscription invalidation reloads the authoritative REST snapshot", async ({ page }) => {
  let agentName = "Before Event";
  let deploymentListGets = 0;
  let exactDeploymentGets = 0;
  let enrichmentGets = 0;
  let listFailuresRemaining = 0;

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
        const frame = JSON.parse(raw);
        if (frame.type === "auth") {
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
        window.setTimeout(() => {
          this.dispatch("message", { data: JSON.stringify(frame) });
        }, 0);
      }

      private dispatch(type: string, event: { data?: string }) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    (window as any).__deploymentEventTest = state;
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: new Proxy(NativeWebSocket, {
        construct(Target, args) {
          const url = String(args[0] ?? "");
          if (url.startsWith("ws://events.example.test/")) {
            return new MockDeploymentWebSocket();
          }
          return Reflect.construct(Target, args);
        },
      }),
    });
  }, TEST_JWT);

  await page.route("**/agents/**", async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const method = route.request().method();

    if (pathName.endsWith("/agents/deployments/events/token") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "deployment-events-token",
          ws_url: "ws://events.example.test/ws/deployments",
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      deploymentListGets += 1;
      if (listFailuresRemaining > 0) {
        listFailuresRemaining -= 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "transient deployment read failure" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "agent-1",
            name: agentName,
            user_id: "user-1",
            state: "STOPPED",
            cpu: 1,
            memory: 2,
            hostname: "agent-1.hypercli.app",
            created_at: "2026-08-06T00:00:00Z",
            updated_at: "2026-08-06T00:00:00Z",
          },
        ]),
      });
      return;
    }

    if (pathName.endsWith("/agents/deployments/agent-1") && method === "GET") {
      exactDeploymentGets += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "agent-1",
          name: agentName,
          user_id: "user-1",
          state: "STOPPED",
          cpu: 1,
          memory: 2,
          hostname: "agent-1.hypercli.app",
          launch_epoch: 3,
          created_at: "2026-08-06T00:00:00Z",
          updated_at: "2026-08-13T00:00:00Z",
        }),
      });
      return;
    }

    if (pathName.endsWith("/agents/subscriptions/summary") && method === "GET") {
      enrichmentGets += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }

    if (pathName.endsWith("/agents/deployments/budget") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ pooled_tpd: 0, slots: {}, size_presets: {} }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/dashboard/agents", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Before Event", { exact: true }).first()).toBeVisible();
  await page.waitForFunction(() => Boolean((window as any).__deploymentEventTest?.ready));
  await expect.poll(() => deploymentListGets).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(100);
  const beforeEvent = deploymentListGets;
  const beforeTransitionEnrichment = enrichmentGets;

  agentName = "After Event";
  await page.evaluate(() => {
    (window as any).__deploymentEventTest.emit({
      type: "deployment.transition",
      agent_id: "agent-1",
      state: "STOPPED",
      launch_epoch: 2,
    });
  });

  await expect.poll(() => exactDeploymentGets).toBeGreaterThan(0);
  await expect.poll(() => deploymentListGets).toBeGreaterThan(beforeEvent);
  await expect(page.getByText("After Event", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Before Event", { exact: true })).toHaveCount(0);
  await page.waitForTimeout(100);
  await expect.poll(() => enrichmentGets).toBeGreaterThan(beforeTransitionEnrichment);

  const beforeFailedRefresh = deploymentListGets;
  agentName = "After Retry";
  listFailuresRemaining = 1;
  await page.evaluate(() => {
    (window as any).__deploymentEventTest.emit({
      type: "deployment.transition",
      agent_id: "agent-1",
      state: "STOPPED",
      launch_epoch: 3,
    });
  });

  // The event-owned refresh scheduler must survive the failed REST attempt,
  // retain the previous snapshot, and retry without another WebSocket event.
  await expect.poll(() => deploymentListGets, { timeout: 10_000 }).toBeGreaterThanOrEqual(beforeFailedRefresh + 2);
  await expect(page.getByText("After Retry", { exact: true }).first()).toBeVisible();
});
