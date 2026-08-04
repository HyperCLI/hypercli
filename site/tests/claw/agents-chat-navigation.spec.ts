import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_BASE_URL = process.env.TEST_BASE_URL!;
const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const DASHBOARD_SESSION_KEY_PATTERN = /^dashboard:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECONDARY_SESSION_KEY = "session-secondary-focus";
const ARCHIVED_SESSION_KEY = "session-archived-focus";
const AGENT_ROSTER_COLLAPSED_STORAGE_KEY = "claw.agentRosterCollapsed.v1";
const TEST_WORKSPACE_ID = "workspace-agent-chat-navigation";

interface AgentChatGatewayRequest {
  method: string;
  params?: {
    sessionKey?: string;
    key?: string;
    reason?: string;
    client?: { id?: string; mode?: string };
    [key: string]: unknown;
  };
}

interface MockAgentChatOptions {
  createReturnsMain?: boolean;
  deferParallelReplies?: boolean;
  legacyMainHistory?: boolean;
  legacyMainTitle?: string;
  mainOnly?: boolean;
}

function json(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function openDashboardView(page: Page, view: "overview" | "usage" | "settings") {
  await page.evaluate((nextView) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    window.history.pushState(null, "", url);
  }, view);
}

async function mockAgentChat(
  page: Page,
  options: MockAgentChatOptions = {},
): Promise<{ requests: AgentChatGatewayRequest[] }> {
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

  await page.addInitScript(({ token, secondarySessionKey, rosterCollapsedStorageKey, createReturnsMain, deferParallelReplies, legacyMainHistory, legacyMainTitle, mainOnly }) => {
    window.localStorage.setItem("claw_auth_token", token);
    window.localStorage.setItem("app_auth_token", token);
    window.localStorage.setItem(rosterCollapsedStorageKey, "true");
    const gatewayCalls = {
      urls: [] as string[],
      closes: [] as Array<{ code?: number; reason?: string }>,
      sockets: [] as Array<{ methods: string[]; closed: boolean }>,
      methods: [] as string[],
      requests: [] as AgentChatGatewayRequest[],
    };
    (window as Window & { __agentChatNavigationGatewayCalls?: typeof gatewayCalls }).__agentChatNavigationGatewayCalls = gatewayCalls;
    const NativeWebSocket = window.WebSocket;
    const historyBySession = new Map<string, Array<{ role: string; content: string }>>();
    const dashboardSessions = new Set<string>();
    const dashboardTitles = new Map<string, string>();
    const pendingChats: Array<{
      sessionKey: string;
      messages: Array<{ role: string; content: string }>;
      emitTerminalGap: () => void;
      emitTitleChange: () => void;
    }> = [];

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
      private readonly tracker: { methods: string[]; closed: boolean };

      constructor(url: string) {
        this.url = url;
        this.tracker = { methods: [], closed: false };
        gatewayCalls.sockets.push(this.tracker);
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
          params?: AgentChatGatewayRequest["params"] & { message?: string };
        };
        const secondaryAgent = this.url.includes("agent-2");
        this.tracker.methods.push(message.method);
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
          const indexedDashboardSessions = Array.from(dashboardSessions)
            .map((key, index) => ({
              key,
              ...(dashboardTitles.has(key) ? { displayName: dashboardTitles.get(key) } : {}),
              updatedAt: 10 + index,
            }));
          this.respond(message.id, {
            sessions: secondaryAgent
              ? [
                  ...indexedDashboardSessions,
                  { key: "main", title: "Main Session" },
                  { key: "agent:default:heartbeat", updatedAt: 5 },
                  { key: secondarySessionKey, title: "Secondary Focus", updatedAt: 3 },
                  { key: "session-archived-focus", title: "Archived Focus", updatedAt: 2 },
                ]
              : [
                  ...indexedDashboardSessions,
                  legacyMainHistory
                    ? {
                        key: "agent:default:main",
                        ...(legacyMainTitle ? { displayName: legacyMainTitle } : {}),
                        origin: { provider: "webchat", surface: "webchat" },
                        deliveryContext: { channel: "webchat" },
                        updatedAt: 4,
                      }
                    : { key: "main", title: "Main Session" },
                  { key: "agent:default:heartbeat", updatedAt: 5 },
                  ...(!mainOnly ? [{ key: "session-primary-focus", title: "Primary Focus", updatedAt: 2 }] : []),
                ],
          });
          return;
        }

        if (message.method === "chat.history") {
          const isSecondaryFocus = secondaryAgent && message.params?.sessionKey === secondarySessionKey;
          const recoveredMessages = historyBySession.get(message.params?.sessionKey ?? "main");
          this.respond(message.id, {
            messages: recoveredMessages ?? (
              legacyMainHistory && message.params?.sessionKey === "agent:default:main"
                ? [{ role: "assistant", content: "Legacy main conversation restored" }]
                : isSecondaryFocus
                  ? [{ role: "assistant", content: "Secondary focus history restored" }]
                  : []
            ),
          });
          return;
        }

        if (message.method === "sessions.subscribe") {
          this.respond(message.id, true);
          return;
        }

        if (message.method === "sessions.create") {
          const sessionKey = message.params?.key;
          if (!createReturnsMain && sessionKey?.startsWith("dashboard:")) dashboardSessions.add(sessionKey);
          this.respond(message.id, {
            ok: true,
            key: createReturnsMain ? "agent:default:main" : sessionKey,
          });
          return;
        }

        if (message.method === "sessions.reset") {
          const sessionKey = message.params?.key;
          const canonicalKey = sessionKey?.startsWith("dashboard:")
            ? `agent:default:${sessionKey}`
            : sessionKey;
          if (canonicalKey?.includes(":dashboard:")) dashboardSessions.add(canonicalKey);
          this.respond(message.id, { ok: true, key: canonicalKey });
          return;
        }

        if (message.method === "chat.send") {
          const runId = `agent-chat-navigation-${message.id}`;
          const sessionKey = message.params?.sessionKey ?? "main";
          const dashboardSession = sessionKey.startsWith("dashboard:") || sessionKey.includes(":dashboard:");
          if (dashboardSession) dashboardSessions.add(sessionKey);
          const prompt = message.params?.message ?? "";
          const reply = deferParallelReplies ? `Parallel reply for ${sessionKey}` : "Private reply";
          const messages = [
            ...(secondaryAgent && sessionKey === secondarySessionKey
              ? [{ role: "assistant", content: "Secondary focus history restored" }]
              : []),
            { role: "user", content: prompt },
            { role: "assistant", content: reply },
          ];
          const emitTitleChange = () => {
            if (!dashboardSession) return;
            dashboardTitles.set(sessionKey, "Dashboard Session");
            this.emit({
              type: "event",
              event: "sessions.changed",
              payload: { sessionKey, reason: "chat.title" },
            });
          };
          this.respond(message.id, { runId });
          if (deferParallelReplies) {
            pendingChats.push({
              sessionKey,
              messages,
              emitTerminalGap: () => {
                this.emit({
                  type: "event",
                  event: "chat.content",
                  seq: 1,
                  payload: { runId, sessionKey, text: reply },
                });
                this.emit({
                  type: "event",
                  event: "chat.done",
                  seq: 3,
                  payload: { runId, sessionKey },
                });
              },
              emitTitleChange,
            });
            return;
          }
          historyBySession.set(sessionKey, messages);
          this.emit({
            type: "event",
            event: "chat.content",
            payload: { runId, sessionKey, text: reply },
          });
          this.emit({
            type: "event",
            event: "chat.done",
            payload: { runId, sessionKey },
          });
          emitTitleChange();
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
        this.tracker.closed = true;
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

    (window as Window & { __releaseAgentChatParallelReplies?: () => void })
      .__releaseAgentChatParallelReplies = () => {
        const chats = pendingChats.splice(0);
        for (const chat of chats) {
          historyBySession.set(chat.sessionKey, chat.messages);
          chat.emitTitleChange();
        }
        chats.at(-1)?.emitTerminalGap();
      };

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
    createReturnsMain: options.createReturnsMain === true,
    deferParallelReplies: options.deferParallelReplies === true,
    legacyMainHistory: options.legacyMainHistory === true,
    legacyMainTitle: options.legacyMainTitle,
    mainOnly: options.mainOnly === true,
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

test("a ready empty session fits within the desktop transcript", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1040 });
  await mockAgentChat(page);
  await page.goto("/dashboard/agents?agentId=agent-1", { waitUntil: "domcontentloaded" });

  const heading = page.getByRole("heading", { name: "Your agent is ready for real work" });
  await expect(heading).toBeVisible();
  const metrics = await page.locator(".agent-empty-history-frame").evaluate((frame) => {
    const section = frame.querySelector<HTMLElement>(".agent-empty-history");
    const scroller = frame.parentElement?.parentElement?.parentElement;
    if (!section || !(scroller instanceof HTMLElement)) return null;

    const frameRect = frame.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    return {
      frameHeight: frameRect.height,
      sectionHeight: sectionRect.height,
      sectionTop: sectionRect.top,
      sectionBottom: sectionRect.bottom,
      scrollerTop: scrollerRect.top,
      scrollerBottom: scrollerRect.bottom,
      scrollerClientHeight: scroller.clientHeight,
      scrollerScrollHeight: scroller.scrollHeight,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.frameHeight).toBeGreaterThan(metrics!.sectionHeight);
  expect(metrics!.sectionTop).toBeGreaterThanOrEqual(metrics!.scrollerTop - 1);
  expect(metrics!.sectionBottom).toBeLessThanOrEqual(metrics!.scrollerBottom + 1);
  expect(metrics!.scrollerScrollHeight).toBeLessThanOrEqual(metrics!.scrollerClientHeight + 1);
});

test("a stale main route starts a named dashboard conversation and keeps legacy history discoverable", async ({ page }) => {
  const gatewayTracker = await mockAgentChat(page, {
    createReturnsMain: true,
    legacyMainHistory: true,
    legacyMainTitle: "Legacy planning",
    mainOnly: true,
  });
  await page.goto("/dashboard/agents?agentId=agent-1&session=main", { waitUntil: "domcontentloaded" });

  await expect.poll(() => page.evaluate(() => {
    const requests = (window as Window & {
      __agentChatNavigationGatewayCalls?: { requests: AgentChatGatewayRequest[] };
    }).__agentChatNavigationGatewayCalls?.requests ?? [];
    const client = requests.find((request) => request.method === "connect")?.params?.client;
    return { id: client?.id ?? null, mode: client?.mode ?? null };
  })).toEqual({ id: "openclaw-control-ui", mode: "webchat" });

  await expect.poll(() => new URL(page.url()).searchParams.get("session")).toMatch(DASHBOARD_SESSION_KEY_PATTERN);
  const firstSessionKey = new URL(page.url()).searchParams.get("session");
  await expect(page.locator('button[aria-current="page"][aria-label="New Session"]')).toBeVisible();
  const sessionRows = page.locator('[data-session-pinned] button[aria-label="New Session"]');
  await expect(sessionRows).toHaveCount(1);
  const legacySession = page.getByRole("button", { name: "Legacy planning", exact: true });
  await expect(legacySession).toBeVisible();
  await expect(legacySession).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Legacy main conversation restored", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Main Session", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Previous conversation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "agent:default:heartbeat", exact: true })).toHaveCount(0);

  const composer = page.locator("textarea").first();
  await composer.fill("initial dashboard request");
  await composer.press("Enter");
  await expect(page.getByText("initial dashboard request", { exact: true })).toBeVisible();
  await expect(page.locator('button[aria-current="page"][aria-label="Dashboard Session"]')).toBeVisible();
  expect(gatewayTracker.requests.find((request) => request.method === "chat.send")?.params?.sessionKey)
    .toBe(`agent:default:${firstSessionKey}`);
  expect(gatewayTracker.requests).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ method: "chat.history", params: expect.objectContaining({ sessionKey: "agent:default:main" }) }),
  ]));

  await page.locator('[data-workspace-item="new-session"]').click();
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).toMatch(DASHBOARD_SESSION_KEY_PATTERN);
  const secondSessionKey = new URL(page.url()).searchParams.get("session");
  expect(secondSessionKey).not.toBe(firstSessionKey);
  await expect(sessionRows).toHaveCount(1);
  await expect.poll(() => gatewayTracker.requests
    .filter((request) => request.method === "sessions.create")
    .map((request) => request.params?.key)).toEqual([firstSessionKey, secondSessionKey]);
  await expect.poll(() => gatewayTracker.requests
    .filter((request) => request.method === "sessions.reset")
    .map((request) => request.params?.key)).toEqual([firstSessionKey, secondSessionKey]);

  await legacySession.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).toBeNull();
  await expect(page.getByText("Legacy main conversation restored", { exact: true })).toBeVisible();
  await expect(legacySession).toHaveAttribute("aria-current", "page");

  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("session", "main");
    window.history.pushState(null, "", url);
  });
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).toMatch(DASHBOARD_SESSION_KEY_PATTERN);
  await expect(page.locator('button[aria-current="page"][aria-label="Dashboard Session"]')).toBeVisible();
  await expect(legacySession).not.toHaveAttribute("aria-current", "page");
});

test("refresh restores the selected agent and non-main chat session", async ({ page }) => {
  await mockAgentChat(page);
  await page.goto("/dashboard/agents?agentId=agent-1", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Select Secondary Agent" }).click();
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("agentId")).toBe("agent-2");
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __agentChatNavigationGatewayCalls?: { methods: string[] } })
      .__agentChatNavigationGatewayCalls?.methods ?? []
  ))).toContain("sessions.list");

  const secondarySession = page.getByRole("button", { name: "Secondary Focus", exact: true });
  await expect(secondarySession).toBeEnabled();
  const documentSentinel = "session-switch-kept-the-document";
  await page.evaluate((value) => {
    (window as Window & { __agentChatNavigationDocumentSentinel?: string })
      .__agentChatNavigationDocumentSentinel = value;
  }, documentSentinel);
  await secondarySession.click();
  await expect(secondarySession).toHaveAttribute("aria-current", "page");
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).toBe(SECONDARY_SESSION_KEY);
  await expect(page.getByText("Secondary focus history restored")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __agentChatNavigationDocumentSentinel?: string })
      .__agentChatNavigationDocumentSentinel
  ))).toBe(documentSentinel);

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect.poll(() => ({
    agentId: new URL(page.url()).searchParams.get("agentId"),
    session: new URL(page.url()).searchParams.get("session"),
  })).toEqual({ agentId: "agent-2", session: SECONDARY_SESSION_KEY });
  await expect(page.getByRole("button", { name: "Secondary Focus", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Secondary focus history restored")).toBeVisible();
});

test("parallel conversations recover after an interrupted gateway event sequence", async ({ page }) => {
  await mockAgentChat(page, { deferParallelReplies: true });
  await page.goto("/dashboard/agents?agentId=agent-1", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Select Secondary Agent" }).click();
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();

  const secondarySession = page.getByRole("button", { name: "Secondary Focus", exact: true });
  const archivedSession = page.getByRole("button", { name: "Archived Focus", exact: true });
  const composer = page.locator("textarea").first();
  const send = page.getByRole("button", { name: "Send message" });
  await expect(page.getByRole("button", { name: "Main Session", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Previous conversation", exact: true })).toHaveCount(0);
  await expect(secondarySession).toBeEnabled();
  await expect(composer).toBeVisible();

  await page.getByRole("button", { name: "New Session", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).toMatch(DASHBOARD_SESSION_KEY_PATTERN);

  await composer.fill("main parallel request");
  await send.click();
  await expect(page.getByText("main parallel request", { exact: true })).toBeVisible();
  const latestDashboardSessionKey = async () => {
    const requests = await page.evaluate(() => (
      (window as Window & { __agentChatNavigationGatewayCalls?: { requests: AgentChatGatewayRequest[] } })
        .__agentChatNavigationGatewayCalls?.requests ?? []
    ));
    return requests.find((request) => request.method === "chat.send")?.params?.sessionKey ?? null;
  };
  await expect.poll(latestDashboardSessionKey).toMatch(DASHBOARD_SESSION_KEY_PATTERN);
  const dashboardSessionKey = await latestDashboardSessionKey();
  expect(dashboardSessionKey).toBeTruthy();
  await expect(page.getByRole("button", { name: "Dashboard Session", exact: true })).toHaveCount(0);

  await secondarySession.click();
  await expect(secondarySession).toHaveAttribute("aria-current", "page");
  await composer.fill("secondary parallel request");
  await send.click();
  await expect(page.getByText("secondary parallel request", { exact: true })).toBeVisible();
  await expect(secondarySession).toHaveAttribute("aria-busy", "true");

  await archivedSession.click();
  await expect(archivedSession).toHaveAttribute("aria-current", "page");
  await composer.fill("archived parallel request");
  await send.click();
  await expect(page.getByText("archived parallel request", { exact: true })).toBeVisible();
  await expect(archivedSession).toHaveAttribute("aria-busy", "true");

  await page.evaluate(() => {
    (window as Window & { __releaseAgentChatParallelReplies?: () => void })
      .__releaseAgentChatParallelReplies?.();
  });
  const dashboardSession = page.getByRole("button", { name: "Dashboard Session", exact: true });
  await expect(dashboardSession).toBeVisible();

  for (const [session, reply] of [
    [archivedSession, `Parallel reply for ${ARCHIVED_SESSION_KEY}`],
    [secondarySession, `Parallel reply for ${SECONDARY_SESSION_KEY}`],
    [dashboardSession, `Parallel reply for ${dashboardSessionKey}`],
  ] as const) {
    await session.click();
    await expect(session).toHaveAttribute("aria-current", "page");
    await expect(session).not.toHaveAttribute("aria-busy", "true");
    await expect(page.getByText(reply, { exact: true })).toBeVisible();
    await expect(page.getByText("Loading conversation...", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Could not load this conversation", { exact: true })).toHaveCount(0);
  }
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

  await openDashboardView(page, "overview");
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("overview");
  await expect(page.getByRole("region", { name: "Pick up where you left off" })).toBeVisible();

  await openDashboardView(page, "usage");
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("usage");
  await expect(page.getByText(/token usage/i).first()).toBeVisible();

  await openDashboardView(page, "settings");
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("settings");
  await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();

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

  // Home opens short-lived operations-snapshot sockets. Only the persistent
  // chat controller loads conversation history, so track that socket directly.
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as Window & {
      __agentChatNavigationGatewayCalls?: {
        sockets: Array<{ methods: string[]; closed: boolean }>;
      };
    }).__agentChatNavigationGatewayCalls;
    const controllers = calls?.sockets.filter((socket) => socket.methods.includes("chat.history")) ?? [];
    return {
      controllerConnections: controllers.length,
      controllerCloses: controllers.filter((socket) => socket.closed).length,
    };
  })).toEqual({ controllerConnections: 1, controllerCloses: 0 });
});

test("direct dashboard views defer the chat controller until an agent is opened", async ({ page }) => {
  await mockAgentChat(page);
  await page.goto("/dashboard/agents?view=overview&agentId=agent-1", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("region", { name: "Pick up where you left off" })).toBeVisible();
  expect(await page.evaluate(() => (
    (window as Window & { __agentChatNavigationGatewayCalls?: { sockets: Array<{ methods: string[] }> } })
      .__agentChatNavigationGatewayCalls?.sockets.filter((socket) => socket.methods.includes("chat.history")).length ?? 0
  ))).toBe(0);

  await page.getByRole("button", { name: "Select Primary Agent" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBeNull();
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __agentChatNavigationGatewayCalls?: { sockets: Array<{ methods: string[] }> } })
      .__agentChatNavigationGatewayCalls?.sockets.filter((socket) => socket.methods.includes("chat.history")).length ?? 0
  ))).toBe(1);
});

test("pinned sessions stay first across reload and return to recency order after unpinning", async ({ page }) => {
  await mockAgentChat(page);
  await page.goto("/dashboard/agents?agentId=agent-1", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Select Secondary Agent" }).click();
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();

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
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).toBe("session-primary-focus");
  const requestsBeforePrivateChat = gatewayTracker.requests.length;
  await startPrivateChat.click();

  await expect(page.getByRole("button", { name: "End private chat" })).toBeVisible();
  await expect(page.getByText(/hidden from Sessions and is not stored in this browser/i)).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("session")).toBe("session-primary-focus");
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

  await openDashboardView(page, "overview");
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
