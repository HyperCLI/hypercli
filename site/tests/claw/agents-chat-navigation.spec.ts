import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_BASE_URL = process.env.TEST_BASE_URL!;
const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const SECONDARY_SESSION_KEY = "session-secondary-focus";
const ARCHIVED_SESSION_KEY = "session-archived-focus";
const AGENT_ROSTER_COLLAPSED_STORAGE_KEY = "claw.agentRosterCollapsed.v1";
const TEST_WORKSPACE_ID = "workspace-agent-chat-navigation";

interface AgentChatGatewayRequest {
  method: string;
  params?: { sessionKey?: string; key?: string; reason?: string; [key: string]: unknown };
}

function json(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function mockAgentChat(page: Page): Promise<{ requests: AgentChatGatewayRequest[] }> {
  const tracker = { requests: [] as AgentChatGatewayRequest[] };
  await page.exposeFunction("__recordAgentChatGatewayRequest", (request: AgentChatGatewayRequest) => {
    tracker.requests.push(request);
  });
  await page.context().addCookies([
    {
      name: "auth_token",
      value: TEST_JWT,
      url: TEST_BASE_URL,
      httpOnly: false,
      secure: TEST_BASE_URL.startsWith("https://"),
      sameSite: "Lax",
    },
  ]);

  await page.addInitScript(({ token, secondarySessionKey, rosterCollapsedStorageKey }) => {
    window.localStorage.setItem("claw_auth_token", token);
    window.localStorage.setItem("app_auth_token", token);
    window.localStorage.setItem(rosterCollapsedStorageKey, "true");
    const gatewayCalls = {
      urls: [] as string[],
      closes: [] as Array<{ code?: number; reason?: string }>,
      methods: [] as string[],
      requests: [] as AgentChatGatewayRequest[],
    };
    (window as Window & { __agentChatNavigationGatewayCalls?: typeof gatewayCalls }).__agentChatNavigationGatewayCalls = gatewayCalls;
    const NativeWebSocket = window.WebSocket;

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

      constructor(url: string) {
        this.url = url;
        gatewayCalls.urls.push(url);
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.();
          this.emit({
            type: "event",
            event: "connect.challenge",
            payload: { nonce: "agent-chat-navigation" },
          });
        }, 0);
      }

      send(data: string) {
        const message = JSON.parse(data) as {
          id: string;
          method: string;
          params?: { sessionKey?: string };
        };
        const secondaryAgent = this.url.includes("agent-2");
        gatewayCalls.methods.push(message.method);
        const request = { method: message.method, params: message.params };
        gatewayCalls.requests.push(request);
        void (window as Window & {
          __recordAgentChatGatewayRequest?: (value: AgentChatGatewayRequest) => Promise<void>;
        }).__recordAgentChatGatewayRequest?.(request);

        if (message.method === "connect") {
          this.respond(message.id, {
            protocol: 3,
            server: { version: "test-version" },
            auth: { role: "operator", scopes: ["operator.admin"] },
          });
          return;
        }

        if (message.method === "sessions.list") {
          this.respond(message.id, {
            sessions: secondaryAgent
              ? [
                  { key: "main", title: "Main Session", updatedAt: 1 },
                  { key: secondarySessionKey, title: "Secondary Focus", updatedAt: 3 },
                  { key: "session-archived-focus", title: "Archived Focus", updatedAt: 2 },
                ]
              : [
                  { key: "main", title: "Main Session", updatedAt: 1 },
                  { key: "session-primary-focus", title: "Primary Focus", updatedAt: 2 },
                ],
          });
          return;
        }

        if (message.method === "chat.history") {
          const isSecondaryFocus = secondaryAgent && message.params?.sessionKey === secondarySessionKey;
          this.respond(message.id, {
            messages: isSecondaryFocus
              ? [{ role: "assistant", content: "Secondary focus history restored" }]
              : [],
          });
          return;
        }

        if (message.method === "chat.send") {
          const runId = `agent-chat-navigation-${message.id}`;
          this.respond(message.id, { runId });
          this.emit({
            type: "event",
            event: "chat.content",
            payload: { runId, sessionKey: message.params?.sessionKey, text: "Private reply" },
          });
          this.emit({
            type: "event",
            event: "chat.done",
            payload: { runId, sessionKey: message.params?.sessionKey },
          });
          return;
        }

        if (message.method === "config.get") {
          this.respond(message.id, { parsed: {}, hash: "hash-1" });
          return;
        }
        if (message.method === "config.schema") {
          this.respond(message.id, { schema: {}, uiHints: {} });
          return;
        }
        if (message.method === "agents.list") {
          this.respond(message.id, { agents: [{ id: "main" }] });
          return;
        }
        if (message.method === "files.list") {
          this.respond(message.id, { type: "directory", prefix: "", directories: [], files: [], truncated: false });
          return;
        }
        if (message.method === "cron.list") {
          this.respond(message.id, { jobs: [] });
          return;
        }
        if (message.method === "models.list") {
          this.respond(message.id, { models: [] });
          return;
        }

        this.respond(message.id, {});
      }

      close(code?: number, reason?: string) {
        gatewayCalls.closes.push({ code, reason });
        this.readyState = MockWebSocket.CLOSED;
        window.setTimeout(() => this.onclose?.({ code, reason }), 0);
      }

      private respond(id: string, payload: unknown) {
        this.emit({ type: "res", id, ok: true, payload });
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
      value: new Proxy(NativeWebSocket, {
        construct(target, args) {
          const url = String(args[0]);
          if (url.includes(".example.test")) return new MockWebSocket(url);
          return Reflect.construct(target, args);
        },
      }),
    });
  }, {
    token: TEST_JWT,
    secondarySessionKey: SECONDARY_SESSION_KEY,
    rosterCollapsedStorageKey: AGENT_ROSTER_COLLAPSED_STORAGE_KEY,
  });

  await page.route(/\/workspaces(?:\/.*)?$/, async (route) => {
    const pathName = new URL(route.request().url()).pathname;

    if (pathName.endsWith(`/workspaces/${TEST_WORKSPACE_ID}/agents`)) {
      await route.fulfill(json(["agent-1", "agent-2"].map((agentId) => ({
        workspace_id: TEST_WORKSPACE_ID,
        agent_id: agentId,
        role: "viewer",
        expires_at: null,
      }))));
      return;
    }

    if (pathName.endsWith(`/workspaces/${TEST_WORKSPACE_ID}/grants`)) {
      await route.fulfill(json(["agent-1", "agent-2"].map((agentId) => ({
        id: `grant-${agentId}`,
        workspace_id: TEST_WORKSPACE_ID,
        subject_type: "agent",
        subject_id: agentId,
        role: "viewer",
        expires_at: null,
        revoked_at: null,
      }))));
      return;
    }

    const workspace = {
      id: TEST_WORKSPACE_ID,
      name: "Agent Chat Navigation",
      slug: TEST_WORKSPACE_ID,
      display_name: "Agent Chat Navigation",
      role: "admin",
    };
    await route.fulfill(json(pathName.endsWith(`/workspaces/${TEST_WORKSPACE_ID}`) ? workspace : [workspace]));
  });

  await page.route("**/agents/**", async (route) => {
    const url = new URL(route.request().url());
    const pathName = url.pathname;
    const method = route.request().method();

    if (method !== "GET") {
      await route.fulfill(json({}));
      return;
    }

    if (pathName.endsWith("/agents/deployments")) {
      await route.fulfill(json([
        {
          id: "agent-1",
          name: "Primary Agent",
          user_id: "user-1",
          pod_id: "pod-1",
          pod_name: "pod-1",
          state: "RUNNING",
          cpu: 1,
          memory: 1,
          hostname: "agent-1.example.test",
          routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
        },
        {
          id: "agent-2",
          name: "Secondary Agent",
          user_id: "user-1",
          pod_id: "pod-2",
          pod_name: "pod-2",
          state: "RUNNING",
          cpu: 1,
          memory: 1,
          hostname: "agent-2.example.test",
          routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
        },
      ]));
      return;
    }

    if (pathName.endsWith("/agents/deployments/budget")) {
      await route.fulfill(json({}));
      return;
    }

    if (/\/agents\/deployments\/agent-[12]$/.test(pathName)) {
      const secondaryAgent = pathName.endsWith("agent-2");
      const agentId = secondaryAgent ? "agent-2" : "agent-1";
      await route.fulfill(json({
        id: agentId,
        name: secondaryAgent ? "Secondary Agent" : "Primary Agent",
        user_id: "user-1",
        pod_id: secondaryAgent ? "pod-2" : "pod-1",
        pod_name: secondaryAgent ? "pod-2" : "pod-1",
        state: "RUNNING",
        cpu: 1,
        memory: 1,
        hostname: `${agentId}.example.test`,
        routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
      }));
      return;
    }

    if (/\/agents\/deployments\/agent-[12]\/env$/.test(pathName)) {
      const agentId = pathName.includes("agent-2") ? "agent-2" : "agent-1";
      await route.fulfill(json({
        agent_id: agentId,
        env: { OPENCLAW_GATEWAY_TOKEN: `gateway-token-${agentId}` },
      }));
      return;
    }

    await route.fulfill(json({}));
  });

  return tracker;
}

async function expectSessionBefore(page: Page, firstName: string, secondName: string): Promise<void> {
  await expect.poll(async () => {
    const first = await page.getByRole("button", { name: firstName, exact: true }).boundingBox();
    const second = await page.getByRole("button", { name: secondName, exact: true }).boundingBox();
    return Boolean(first && second && first.y < second.y);
  }).toBe(true);
}

test("refresh restores the selected agent and non-main chat session", async ({ page }) => {
  await mockAgentChat(page);
  await page.goto("/dashboard/agents?agentId=agent-1", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Select Secondary Agent" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("agentId")).toBe("agent-2");
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __agentChatNavigationGatewayCalls?: { methods: string[] } })
      .__agentChatNavigationGatewayCalls?.methods ?? []
  ))).toContain("sessions.list");

  const secondarySession = page.getByRole("button", { name: "Secondary Focus", exact: true });
  await expect(secondarySession).toBeEnabled();
  await secondarySession.click();
  await expect(secondarySession).toHaveAttribute("aria-current", "page");
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).toBe(SECONDARY_SESSION_KEY);
  await expect(page.getByText("Secondary focus history restored")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect.poll(() => ({
    agentId: new URL(page.url()).searchParams.get("agentId"),
    session: new URL(page.url()).searchParams.get("session"),
  })).toEqual({ agentId: "agent-2", session: SECONDARY_SESSION_KEY });
  await expect(page.getByRole("button", { name: "Secondary Focus", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Secondary focus history restored")).toBeVisible();
});

test("dashboard views preserve the agent controller across navigation history", async ({ page }) => {
  await mockAgentChat(page);
  await page.goto("/dashboard/agents?agentId=agent-1", { waitUntil: "domcontentloaded" });

  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __agentChatNavigationGatewayCalls?: { urls: string[] } })
      .__agentChatNavigationGatewayCalls?.urls.length ?? 0
  ))).toBe(1);
  const composer = page.locator("textarea").first();
  await expect(composer).toBeVisible();
  await composer.fill("draft survives dashboard navigation");

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("overview");
  await expect(page.getByRole("heading", { name: "Agent Chat Navigation" })).toBeVisible();

  await page.getByRole("button", { name: "Usage", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("usage");
  await expect(page.getByText(/token usage/i).first()).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("settings");
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();

  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("usage");
  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("overview");
  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBeNull();
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue("draft survives dashboard navigation");

  await page.goForward();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("overview");
  await page.goForward();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("usage");
  await page.goForward();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("settings");

  await expect.poll(() => page.evaluate(() => {
    const calls = (window as Window & {
      __agentChatNavigationGatewayCalls?: { urls: string[]; closes: unknown[] };
    }).__agentChatNavigationGatewayCalls;
    return { connections: calls?.urls.length ?? 0, closes: calls?.closes.length ?? 0 };
  })).toEqual({ connections: 1, closes: 0 });
});

test("direct dashboard views defer the gateway until an agent is opened", async ({ page }) => {
  await mockAgentChat(page);
  await page.goto("/dashboard/agents?view=overview&agentId=agent-1", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Agent Chat Navigation" })).toBeVisible();
  expect(await page.evaluate(() => (
    (window as Window & { __agentChatNavigationGatewayCalls?: { urls: string[] } })
      .__agentChatNavigationGatewayCalls?.urls.length ?? 0
  ))).toBe(0);

  await page.getByRole("button", { name: "Select Primary Agent" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBeNull();
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __agentChatNavigationGatewayCalls?: { urls: string[] } })
      .__agentChatNavigationGatewayCalls?.urls.length ?? 0
  ))).toBe(1);
});

test("pinned sessions stay first across reload and return to recency order after unpinning", async ({ page }) => {
  await mockAgentChat(page);
  await page.goto("/dashboard/agents?agentId=agent-1", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Select Secondary Agent" }).click();

  const archivedSession = page.getByRole("button", { name: "Archived Focus", exact: true });
  await expect(archivedSession).toBeEnabled();
  await expectSessionBefore(page, "Secondary Focus", "Archived Focus");
  const patchCallsBeforePin = await page.evaluate(() => (
    (window as Window & { __agentChatNavigationGatewayCalls?: { methods: string[] } })
      .__agentChatNavigationGatewayCalls?.methods.filter((method) => method === "sessions.patch").length ?? 0
  ));

  await archivedSession.hover();
  await page.getByRole("button", { name: "Session options for Archived Focus" }).click();
  await page.getByRole("button", { name: "Pin", exact: true }).click();

  await expectSessionBefore(page, "Archived Focus", "Secondary Focus");
  await expect(archivedSession.locator(".lucide-pin")).toBeVisible();
  await expect.poll(() => page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw).sessionKeys : [];
  }, "openclaw.sessionPins.v1:agent-2")).toEqual([ARCHIVED_SESSION_KEY]);
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __agentChatNavigationGatewayCalls?: { methods: string[] } })
      .__agentChatNavigationGatewayCalls?.methods.filter((method) => method === "sessions.patch").length ?? 0
  ))).toBe(patchCallsBeforePin);

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByRole("button", { name: "Archived Focus", exact: true })).toBeEnabled();
  await expectSessionBefore(page, "Archived Focus", "Secondary Focus");
  await page.getByRole("button", { name: "Archived Focus", exact: true }).hover();
  await page.getByRole("button", { name: "Session options for Archived Focus" }).click();
  await page.getByRole("button", { name: "Unpin", exact: true }).click();

  await expectSessionBefore(page, "Secondary Focus", "Archived Focus");
  await expect(archivedSession.locator(".lucide-pin")).toHaveCount(0);
  await expect.poll(() => page.evaluate((storageKey) => window.localStorage.getItem(storageKey), "openclaw.sessionPins.v1:agent-2")).toBeNull();
});

test("private chat stays out of navigation state and resets before switching agents", async ({ page }) => {
  const gatewayTracker = await mockAgentChat(page);
  await page.goto("/dashboard/agents?agentId=agent-1", { waitUntil: "domcontentloaded" });

  const startPrivateChat = page.getByRole("button", { name: "Start private chat" });
  await expect(startPrivateChat).toBeEnabled();
  const requestsBeforePrivateChat = gatewayTracker.requests.length;
  await startPrivateChat.click();

  await expect(page.getByRole("button", { name: "End private chat" })).toBeVisible();
  await expect(page.getByText(/hidden from Sessions and is not stored in this browser/i)).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).toBeNull();
  await expect.poll(() => (
    gatewayTracker.requests.slice(requestsBeforePrivateChat).find((request) => (
      request.method === "sessions.reset" &&
      request.params?.reason === "new" &&
      request.params.key?.startsWith("session-hypercli-ephemeral-")
    ))?.params?.key ?? null
  )).toMatch(/^session-hypercli-ephemeral-/);
  const privateSessionKey = gatewayTracker.requests.slice(requestsBeforePrivateChat).find((request) => (
    request.method === "sessions.reset" &&
    request.params?.reason === "new" &&
    request.params.key?.startsWith("session-hypercli-ephemeral-")
  ))!.params!.key!;
  await page.locator("textarea").fill("private browser secret");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Private reply", { exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  const storedBrowserState = await page.evaluate(() => JSON.stringify(Object.fromEntries(
    Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index) ?? "";
      return [key, window.localStorage.getItem(key)];
    }),
  )));
  expect(storedBrowserState).not.toContain("session-hypercli-ephemeral-");
  expect(storedBrowserState).not.toContain("private browser secret");

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("overview");
  await expect.poll(() => (
    gatewayTracker.requests.filter((request) => (
      request.method === "sessions.reset" &&
      request.params?.key === privateSessionKey &&
      request.params.reason === "reset"
    )).length
  )).toBe(1);
  await expect(page.getByRole("button", { name: "End private chat" })).toHaveCount(0);

  await page.getByRole("button", { name: "Select Secondary Agent" }).click();

  await expect.poll(() => new URL(page.url()).searchParams.get("agentId")).toBe("agent-2");
  await expect.poll(() => (
    gatewayTracker.requests.filter((request) => (
      request.method === "sessions.reset" &&
      request.params?.key === privateSessionKey &&
      request.params.reason === "reset"
    )).length
  )).toBe(1);
  await expect(page.getByRole("button", { name: "End private chat" })).toHaveCount(0);
});
