import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";

test("dev agents retries a failed event refresh and resyncs after reconnect", async ({ page }) => {
  let agentName = "Before Event";
  let deploymentListGets = 0;
  let listFailuresRemaining = 0;

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
    const NativeWebSocket = window.WebSocket;
    const state: {
      ready: boolean;
      constructions: number;
      closes: number;
      socket: MockDeploymentWebSocket | null;
      emit(frame: unknown): void;
    } = {
      ready: false,
      constructions: 0,
      closes: 0,
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
        state.constructions += 1;
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
        if (frame.version === 1 && frame.type === "auth") {
          state.ready = true;
          this.emit({ version: 1, type: "ready" });
        }
      }

      close() {
        if (this.readyState === MockDeploymentWebSocket.CLOSED) return;
        state.closes += 1;
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

    (window as any).__devDeploymentEventTest = state;
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
          version: 1,
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
        body: JSON.stringify([{
          id: "agent-1",
          name: agentName,
          user_id: "user-1",
          pod_id: null,
          pod_name: null,
          state: "STOPPED",
          cpu: 1,
          memory: 2,
          hostname: "agent-1.hypercli.app",
          created_at: "2026-08-06T00:00:00Z",
          updated_at: "2026-08-06T00:00:00Z",
        }]),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/dev/agent-setup/agents", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Before Event", { exact: true }).first()).toBeVisible();
  await page.waitForFunction(() => Boolean((window as any).__devDeploymentEventTest?.ready));
  await page.waitForTimeout(100);
  const beforeEvent = deploymentListGets;

  agentName = "After Retry";
  listFailuresRemaining = 1;
  await page.evaluate(() => {
    (window as any).__devDeploymentEventTest.emit({
      version: 1,
      type: "deployment.transition",
      deployment_id: "agent-1",
      state: "STOPPED",
      placement_epoch: 2,
    });
  });

  await expect.poll(() => deploymentListGets).toBe(beforeEvent + 1);
  await expect(page.getByText("Before Event", { exact: true }).first()).toBeVisible();
  await expect.poll(() => deploymentListGets, { timeout: 10_000 }).toBeGreaterThanOrEqual(beforeEvent + 2);
  await expect(page.getByText("After Retry", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => ({
    constructions: (window as any).__devDeploymentEventTest.constructions,
    closes: (window as any).__devDeploymentEventTest.closes,
  }))).toEqual({ constructions: 1, closes: 0 });

  const beforeReconnect = deploymentListGets;
  agentName = "After Reconnect";
  await page.evaluate(() => {
    (window as any).__devDeploymentEventTest.socket?.close();
  });

  await expect.poll(() => page.evaluate(
    () => (window as any).__devDeploymentEventTest.constructions,
  )).toBe(2);
  await expect.poll(() => deploymentListGets).toBeGreaterThan(beforeReconnect);
  await expect(page.getByText("After Reconnect", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => ({
    constructions: (window as any).__devDeploymentEventTest.constructions,
    closes: (window as any).__devDeploymentEventTest.closes,
  }))).toEqual({ constructions: 2, closes: 1 });
});
