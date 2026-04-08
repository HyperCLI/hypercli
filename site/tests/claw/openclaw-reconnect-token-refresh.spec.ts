import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";

test("dashboard refreshes the gateway token before sdk reconnect", async ({ page }) => {
  let envCalls = 0;

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

    const state = {
      connectTokens: [] as Array<string | null>,
      socketCount: 0,
    };
    (window as any).__gatewayReconnectTest = state;

    class MockWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;

      public readonly url: string;
      public readyState = MockWebSocket.CONNECTING;
      public onopen: (() => void) | null = null;
      public onmessage: ((event: { data: string }) => void) | null = null;
      public onerror: (() => void) | null = null;
      public onclose: ((event: { code?: number; reason?: string }) => void) | null = null;

      private readonly socketNumber: number;

      constructor(url: string) {
        this.url = url;
        state.socketCount += 1;
        this.socketNumber = state.socketCount;
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.();
          this.emit({
            type: "event",
            event: "connect.challenge",
            payload: { nonce: `nonce-${this.socketNumber}` },
          });
        }, 0);
      }

      send(data: string) {
        const message = JSON.parse(data);
        if (message.method === "connect") {
          state.connectTokens.push(message.params?.auth?.token ?? null);
          this.emit({
            type: "res",
            id: message.id,
            ok: true,
            payload: {
              protocol: 3,
              server: { version: "test-version" },
              auth: {
                role: "operator",
                scopes: ["operator.admin"],
              },
            },
          });
          if (this.socketNumber === 1) {
            window.setTimeout(() => this.close(1012, "restart"), 50);
          }
          return;
        }

        if (message.method === "config.get") {
          this.emit({ type: "res", id: message.id, ok: true, payload: { parsed: {}, hash: "hash-1" } });
          return;
        }
        if (message.method === "config.schema") {
          this.emit({ type: "res", id: message.id, ok: true, payload: { schema: {}, uiHints: {} } });
          return;
        }
        if (message.method === "chat.history") {
          this.emit({ type: "res", id: message.id, ok: true, payload: { messages: [] } });
          return;
        }
        if (message.method === "agents.list") {
          this.emit({ type: "res", id: message.id, ok: true, payload: { agents: [{ id: "main" }] } });
          return;
        }
        if (message.method === "files.list") {
          this.emit({
            type: "res",
            id: message.id,
            ok: true,
            payload: { type: "directory", prefix: "", directories: [], files: [], truncated: false },
          });
          return;
        }

        this.emit({ type: "res", id: message.id, ok: true, payload: {} });
      }

      close(code?: number, reason?: string) {
        this.readyState = MockWebSocket.CLOSED;
        window.setTimeout(() => this.onclose?.({ code, reason }), 0);
      }

      private emit(message: unknown) {
        window.setTimeout(() => {
          this.onmessage?.({ data: JSON.stringify(message) });
        }, 0);
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: MockWebSocket,
    });
  }, TEST_JWT);

  await page.route("**/agents/**", async (route) => {
    const url = new URL(route.request().url());
    const pathName = url.pathname;
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }

    if (pathName.endsWith("/agents/deployments")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "agent-1",
            name: "Reconnect Test",
            user_id: "user-1",
            pod_id: "pod-1",
            pod_name: "pod-1",
            state: "RUNNING",
            cpu: 1,
            memory: 1,
            hostname: "agent-1.example.test",
            openclaw_url: "wss://agent-1.example.test",
          },
        ]),
      });
      return;
    }

    if (pathName.endsWith("/agents/deployments/budget")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
      return;
    }

    if (pathName.endsWith("/agents/deployments/agent-1/env")) {
      envCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          env: {
            OPENCLAW_GATEWAY_TOKEN: envCalls === 1 ? "gw-token-1" : "gw-token-2",
          },
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/dashboard/agents", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/dashboard\/agents$/);

  await page.waitForFunction(() => {
    const state = (window as any).__gatewayReconnectTest;
    return Array.isArray(state?.connectTokens) && state.connectTokens.length >= 2;
  });

  await expect
    .poll(async () => envCalls, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2);

  const connectTokens = await page.evaluate(() => {
    return (window as any).__gatewayReconnectTest?.connectTokens ?? [];
  });

  expect(connectTokens).toEqual(["gw-token-1", "gw-token-2"]);
});
