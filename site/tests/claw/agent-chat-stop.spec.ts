import { expect, test, type Page } from "@playwright/test";

import {
  inspectMockGateway,
  installMockGateway,
  releaseMockGatewayFinals,
} from "./fixtures/mock-openclaw-gateway";
import {
  interceptAgentChatBackend,
  installAgentChatAuth,
  sendAgentChatMessage,
} from "./fixtures/agent-chat-harness";

const AGENT_ID = "agent-chat-stop-intercepted";
const AGENT_HOSTNAME = "agent-chat-stop-intercepted.example.test";
const SESSION_KEY = "dashboard:23456789-2345-4345-8345-23456789abcd";
const GATEWAY_SESSION_KEY = `agent:default:${SESSION_KEY}`;

interface AbortCall {
  sessionKey?: string;
  runId?: string;
}

function captureBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function installAbortTargetGuard(page: Page): Promise<void> {
  await page.addInitScript(`
    (() => {
      const nativeStringify = JSON.stringify.bind(JSON);
      const abortCalls = [];
      window.__chatAbortCalls = abortCalls;
      JSON.stringify = function(value, replacer, space) {
        if (value?.type === "req" && value?.method === "chat.abort") {
          const params = { ...(value.params ?? {}) };
          abortCalls.push(params);
          if (!params.runId) {
            return nativeStringify({ ...value, method: "chat.abort.untargeted" }, replacer, space);
          }
        }
        return nativeStringify(value, replacer, space);
      };
    })();
  `);
}

async function abortCalls(page: Page): Promise<AbortCall[]> {
  return page.evaluate(() => (
    (window as unknown as { __chatAbortCalls?: AbortCall[] }).__chatAbortCalls ?? []
  ));
}

async function openLoopingChat(page: Page, runId: string): Promise<void> {
  await installMockGateway(page, {
    chatScripts: [{
      sessionKey: "*",
      runId,
      commentary: ["The same tool is still running"],
      finalText: "This loop should have been stopped.",
      holdFinal: true,
    }],
    chatHistories: { [GATEWAY_SESSION_KEY]: [] },
    sessions: [{ key: GATEWAY_SESSION_KEY, label: "Looping task" }],
  });
  await installAbortTargetGuard(page);
  await installAgentChatAuth(page);
  await interceptAgentChatBackend(page, {
    agentId: AGENT_ID,
    hostname: AGENT_HOSTNAME,
  });
  await page.route("**/dashboard/agents**", (route) => route.continue());
  await page.goto(
    `/dashboard/agents?agentId=${encodeURIComponent(AGENT_ID)}&session=${encodeURIComponent(SESSION_KEY)}`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.getByTestId("agent-chat-composer")).toBeEnabled({ timeout: 90_000 });
  await sendAgentChatMessage(page, "Stop this looping task");
  await expect(page.getByRole("button", { name: "Stop reply" })).toBeVisible();
}

async function expectRunStopped(page: Page, runId: string): Promise<void> {
  await expect.poll(() => abortCalls(page)).toEqual([{
    sessionKey: GATEWAY_SESSION_KEY,
    runId,
  }]);
  await expect(page.getByTestId("agent-chat-transcript").getByText("Reply stopped", { exact: true })).toBeVisible();
  expect(await releaseMockGatewayFinals(page)).toBe(0);
}

test.describe("Agent chat stop controls (intercepted gateway)", () => {
  test("stops the exact active run from the composer button", async ({ page }) => {
    const browserErrors = captureBrowserErrors(page);
    const runId = "looping-button-run";
    await openLoopingChat(page, runId);

    await page.getByRole("button", { name: "Stop reply" }).click();

    await expectRunStopped(page, runId);
    expect(browserErrors).toEqual([]);
  });

  test("stops the exact active run with /stop", async ({ page }) => {
    const browserErrors = captureBrowserErrors(page);
    const runId = "looping-slash-run";
    await openLoopingChat(page, runId);

    const composer = page.getByTestId("agent-chat-composer");
    await composer.fill("/stop");
    await expect(page.getByRole("option", { name: /\/stop/i })).toBeEnabled();
    await composer.press("Enter");

    await expectRunStopped(page, runId);
    expect((await inspectMockGateway(page)).sendCalls).toHaveLength(1);
    expect(browserErrors).toEqual([]);
  });
});
