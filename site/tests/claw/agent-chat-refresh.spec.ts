import { expect, test, type Page } from "@playwright/test";

import {
  interceptAgentChatBackend,
  installAgentChatAuth,
} from "./fixtures/agent-chat-harness";
import {
  inspectMockGateway,
  installMockGateway,
  type MockGatewayHistoryRow,
} from "./fixtures/mock-openclaw-gateway";

const AGENT_ID = "agent-chat-refresh-intercepted";
const AGENT_HOSTNAME = "agent-chat-refresh-intercepted.example.test";
const SESSION_KEY = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
const GATEWAY_SESSION_KEY = `agent:default:${SESSION_KEY}`;
const SENTINEL = "Refresh durability sentinel";

const persistedHistory: MockGatewayHistoryRow[] = [
  {
    role: "user",
    timestamp: 1,
    content: [{ type: "text", text: "Keep this conversation after refresh" }],
  },
  {
    role: "assistant",
    stopReason: "stop",
    timestamp: 2,
    content: [{ type: "text", text: SENTINEL }],
  },
];

const cachedHistory = [
  { role: "user", content: "Keep this conversation after refresh" },
  { role: "assistant", content: SENTINEL },
];

const activeTurnHistory = [
  {
    role: "user",
    timestamp: 10,
    content: [{ type: "text", text: "Inspect the workspace after refresh" }],
  },
  {
    role: "assistant",
    stopReason: "toolUse",
    timestamp: 11,
    content: [{ type: "text", text: "Reading config files." }],
  },
  {
    role: "assistant",
    stopReason: "toolUse",
    timestamp: 12,
    content: [{ type: "text", text: "Reading config files.\nValidating two entries." }],
  },
  {
    role: "assistant",
    timestamp: 13,
    content: [{ type: "thinking", thinking: "Inspecting the workspace" }],
  },
  {
    role: "assistant",
    timestamp: 14,
    content: [{ type: "thinking", thinking: "Inspecting the workspace configuration" }],
  },
  {
    role: "assistant",
    stopReason: "error",
    timestamp: 15,
    content: [{ type: "text", text: "The agent run failed before producing a reply." }],
  },
  {
    role: "assistant",
    stopReason: "stop",
    timestamp: 16,
    content: [{
      type: "text",
      text: "Reading config files.\nValidating two entries.\nConfiguration is valid.",
    }],
  },
] as unknown as MockGatewayHistoryRow[];

const activeTurnCache = [
  { role: "user", content: "Inspect the workspace after refresh" },
  {
    role: "assistant",
    content: "",
    runId: "run-refresh",
    reasoning: {
      text: "Inspecting the workspace configuration",
      state: "active",
      startedAt: 13,
    },
    toolCalls: [{
      id: "tool-refresh",
      name: "functions.read",
      args: "{\"path\":\"config.json\"}",
      result: "Read complete",
    }],
  },
];

function historyCacheKey(sessionKey: string): string {
  return [
    "hypercli:openclaw-chat-history:v1",
    encodeURIComponent(AGENT_ID),
    "session",
    encodeURIComponent(sessionKey),
  ].join(":");
}

async function seedCachedHistory(
  page: Page,
  sessionKey: string,
  messages: typeof cachedHistory | typeof activeTurnCache = cachedHistory,
): Promise<void> {
  await page.addInitScript(({ cacheKey, messages, seedMarker }) => {
    if (window.sessionStorage.getItem(seedMarker)) return;
    window.localStorage.setItem(cacheKey, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      messages,
    }));
    window.sessionStorage.setItem(seedMarker, "1");
  }, {
    cacheKey: historyCacheKey(sessionKey),
    messages,
    seedMarker: `refresh-history-seeded:${sessionKey}`,
  });
}

async function installRefreshHarness(
  page: Page,
  options: {
    history?: MockGatewayHistoryRow[];
    historyDelayMs?: number;
    failHistory?: boolean;
    messageCount?: number;
  } = {},
): Promise<void> {
  const sessions = [{
    key: GATEWAY_SESSION_KEY,
    label: "Refresh durability",
    updatedAt: "2026-08-26T12:00:00.000Z",
    messageCount: options.messageCount ?? options.history?.length ?? 0,
  }];
  await installMockGateway(page, {
    chatHistories: { [GATEWAY_SESSION_KEY]: options.history ?? [] },
    chatHistoryDelayMs: options.historyDelayMs,
    failChatHistory: options.failHistory,
    sessions,
  });
  await installAgentChatAuth(page);
  await interceptAgentChatBackend(page, {
    agentId: AGENT_ID,
    hostname: AGENT_HOSTNAME,
  });
}

async function navigateToRefreshSession(page: Page): Promise<void> {
  await page.goto(
    `/dashboard/agents?agentId=${encodeURIComponent(AGENT_ID)}&session=${encodeURIComponent(SESSION_KEY)}`,
    { waitUntil: "domcontentloaded" },
  );
}

async function openRefreshSession(page: Page): Promise<void> {
  await navigateToRefreshSession(page);
  await expect(page.getByTestId("agent-chat-composer")).toBeEnabled({ timeout: 90_000 });
}

async function expectHistoryResponse(page: Page): Promise<void> {
  await expect.poll(async () => (await inspectMockGateway(page)).historyResponses)
    .toContain(GATEWAY_SESSION_KEY);
}

test.describe("Agent conversation refresh durability", () => {
  test("keeps canonical gateway history across repeated hard reloads", async ({ page }) => {
    await installRefreshHarness(page, { history: persistedHistory });
    await openRefreshSession(page);

    for (let reload = 0; reload < 5; reload += 1) {
      await expect(page.getByText(SENTINEL, { exact: true })).toHaveCount(1);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("agent-chat-composer")).toBeEnabled({ timeout: 90_000 });
    }

    await expect(page.getByText(SENTINEL, { exact: true })).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get("session")).toBe(SESSION_KEY);
  });

  test("does not erase cached history when an indexed populated session briefly returns empty", async ({ page }) => {
    await seedCachedHistory(page, SESSION_KEY);
    await installRefreshHarness(page, {
      history: [],
      historyDelayMs: 1_000,
      messageCount: persistedHistory.length,
    });
    await navigateToRefreshSession(page);

    const cachedReply = page.getByText(SENTINEL, { exact: true });
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), historyCacheKey(SESSION_KEY)))
      .not.toBeNull();
    await expect(page.getByTestId("agent-chat-composer")).toBeEnabled({ timeout: 90_000 });
    await expectHistoryResponse(page);
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), historyCacheKey(SESSION_KEY)))
      .not.toBeNull();
    await expect(cachedReply).toBeVisible();

    for (let reload = 0; reload < 3; reload += 1) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("agent-chat-composer")).toBeEnabled({ timeout: 90_000 });
      await expectHistoryResponse(page);
      await expect(cachedReply).toBeVisible();
      await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), historyCacheKey(SESSION_KEY)))
        .not.toBeNull();
    }
  });

  test("clears stale cache when the indexed session is authoritatively empty", async ({ page }) => {
    await seedCachedHistory(page, SESSION_KEY);
    await installRefreshHarness(page, {
      history: [],
      historyDelayMs: 1_000,
      messageCount: 0,
    });
    await navigateToRefreshSession(page);

    await expect(page.getByTestId("agent-chat-composer")).toBeEnabled({ timeout: 90_000 });
    await expectHistoryResponse(page);
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), historyCacheKey(SESSION_KEY)))
      .toBeNull();
    await expect(page.getByText(SENTINEL, { exact: true })).toHaveCount(0);
  });

  test("keeps cached history when the gateway history request fails", async ({ page }) => {
    await seedCachedHistory(page, SESSION_KEY);
    await installRefreshHarness(page, {
      history: [],
      historyDelayMs: 1_000,
      failHistory: true,
      messageCount: persistedHistory.length,
    });
    await navigateToRefreshSession(page);

    await expectHistoryResponse(page);
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), historyCacheKey(SESSION_KEY)))
      .not.toBeNull();
  });

  test("restores the same generated session through its scoped cache alias", async ({ page }) => {
    await seedCachedHistory(page, GATEWAY_SESSION_KEY);
    await installRefreshHarness(page, {
      history: [],
      historyDelayMs: 1_000,
      messageCount: persistedHistory.length,
    });
    await navigateToRefreshSession(page);

    await expect(page.getByTestId("agent-chat-composer")).toBeEnabled({ timeout: 90_000 });
    await expectHistoryResponse(page);
    await expect(page.getByText(SENTINEL, { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), historyCacheKey(SESSION_KEY)))
      .not.toBeNull();
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), historyCacheKey(GATEWAY_SESSION_KEY)))
      .toBeNull();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("agent-chat-composer")).toBeEnabled({ timeout: 90_000 });
    await expectHistoryResponse(page);
    await expect(page.getByText(SENTINEL, { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("session")).toBe(SESSION_KEY);
  });

  test("coalesces active-turn activity into one coherent reply after reload", async ({ page }) => {
    await seedCachedHistory(page, SESSION_KEY, activeTurnCache);
    await installRefreshHarness(page, { history: activeTurnHistory });
    await openRefreshSession(page);

    const assertCoherentReply = async () => {
      await expect(page.getByTestId("agent-assistant-reasoning")).toHaveCount(1);
      await expect(page.getByTestId("agent-assistant-progress")).toHaveCount(1);
      await expect(page.getByRole("button", { name: /^Read Done path provided$/i })).toHaveCount(1);
      await expect(page.getByText("Configuration is valid.", { exact: true })).toHaveCount(1);
      await expect(page.getByText("The agent run failed before producing a reply.", { exact: true })).toHaveCount(0);
      await expect(page.getByText("The agent finished without a final response.", { exact: false })).toHaveCount(0);
    };

    await assertCoherentReply();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("agent-chat-composer")).toBeEnabled({ timeout: 90_000 });
    await assertCoherentReply();
  });
});
