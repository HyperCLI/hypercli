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

const AGENT_ID = "agent-chat-complex-query-intercepted";
const AGENT_HOSTNAME = "agent-chat-complex-query-intercepted.example.test";
const SESSION_KEY = "dashboard:12345678-1234-4234-8234-123456789abc";
const GATEWAY_SESSION_KEY = `agent:default:${SESSION_KEY}`;
const PRIVATE_REASONING = "PRIVATE_COMPLEX_QUERY_REASONING_7f3a";
const UTF8_SENTINEL = String.fromCodePoint(0x4f60, 0x597d, 0x1f680);

const COMPLEX_PROMPT = [
  "    COMPLEX_QUERY_START",
  "Audit this deployment plan without changing any input data.",
  "",
  "Constraints:",
  "- Preserve quoted values, punctuation, and line boundaries.",
  "- Treat <service data-mode=\"literal\"> as text, not markup.",
  `- Preserve this UTF-8 sentinel: ${UTF8_SENTINEL}`,
  "",
  "```json",
  JSON.stringify({
    command: "node ./scripts/audit.mjs --strict",
    paths: ["/workspace/app one", "C:\\workspace\\app-two"],
    flags: { dryRun: true, threshold: 0.875, empty: null },
    literal: "${HOME} && $(do-not-run) & <tag>",
  }, null, 2),
  "```",
  "",
  "Dataset:",
  ...Array.from({ length: 240 }, (_, index) => (
    `record-${String(index + 1).padStart(3, "0")}: alpha=${index * 17}; beta=\"value ${index + 1}\"; enabled=${index % 2 === 0}`
  )),
  "",
  "Return a validation table, the three highest-risk records, and a fenced remediation script.",
  "COMPLEX_QUERY_END",
  "",
].join("\n");

const COMPLEX_RESPONSE = [
  "## Validation result",
  "",
  "| Check | Result |",
  "| --- | --- |",
  "| Structure | Pass |",
  "| Literal values | Pass |",
  "",
  "Highest-risk records:",
  "1. `record-240`",
  "2. `record-239`",
  "3. `record-238`",
  "",
  "```sh",
  "node ./scripts/audit.mjs --strict --dry-run",
  "```",
  "",
  `UTF-8 round trip: ${UTF8_SENTINEL}`,
  "COMPLEX_RESPONSE_END",
].join("\n");

function captureBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

function chatHistoryCacheKey(sessionKey: string): string {
  return [
    "hypercli:openclaw-chat-history:v1",
    encodeURIComponent(AGENT_ID),
    "session",
    encodeURIComponent(sessionKey),
  ].join(":");
}

async function expectCachedUserMessages(page: Page, expectedMessages: string[]): Promise<void> {
  await expect.poll(() => page.evaluate((key) => {
    const serialized = window.localStorage.getItem(key);
    if (!serialized) return [];
    try {
      const cached = JSON.parse(serialized) as {
        messages?: Array<{ role?: unknown; content?: unknown }>;
      };
      return (cached.messages ?? [])
        .filter((message) => message.role === "user" && typeof message.content === "string")
        .map((message) => message.content as string);
    } catch {
      return [];
    }
  }, chatHistoryCacheKey(SESSION_KEY))).toEqual(expectedMessages);
}

async function installComplexQueryHarness(page: Page, finalTexts: string[]): Promise<void> {
  await installMockGateway(page, {
    chatScripts: finalTexts.map((finalText, index) => ({
      sessionKey: "*",
      runId: `complex-query-run-${index + 1}`,
      finalText,
      holdFinal: true,
    })),
    chatHistories: { [GATEWAY_SESSION_KEY]: [] },
    sessions: [{ key: GATEWAY_SESSION_KEY, label: "Complex query" }],
  });
  await installAgentChatAuth(page);
  await interceptAgentChatBackend(page, {
    agentId: AGENT_ID,
    hostname: AGENT_HOSTNAME,
  });
  await page.route("**/dashboard/agents**", (route) => route.continue());
}

async function openComplexQueryChat(page: Page): Promise<void> {
  await page.goto(
    `/dashboard/agents?agentId=${encodeURIComponent(AGENT_ID)}&session=${encodeURIComponent(SESSION_KEY)}`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.getByTestId("agent-chat-composer")).toBeEnabled({ timeout: 90_000 });
}

test.describe("Agent chat complex queries (intercepted gateway)", () => {
  test("preserves a long structured query through streaming and hard reload", async ({ page }) => {
    const browserErrors = captureBrowserErrors(page);
    await installMockGateway(page, {
      chatScripts: [{
        sessionKey: "*",
        runId: "complex-query-stream",
        commentary: [
          "Parsing the structured request",
          "Parsing the structured request and validating all 240 records",
        ],
        thinking: PRIVATE_REASONING,
        finalText: COMPLEX_RESPONSE,
        holdFinal: true,
      }],
      chatHistories: { [GATEWAY_SESSION_KEY]: [] },
      sessions: [{ key: GATEWAY_SESSION_KEY, label: "Complex query" }],
    });
    await installAgentChatAuth(page);
    await interceptAgentChatBackend(page, {
      agentId: AGENT_ID,
      hostname: AGENT_HOSTNAME,
    });
    await page.route("**/dashboard/agents**", (route) => route.continue());
    await openComplexQueryChat(page);

    await sendAgentChatMessage(page, COMPLEX_PROMPT);
    await expect.poll(async () => (await inspectMockGateway(page)).sendCalls.length).toBe(1);

    const inspection = await inspectMockGateway(page);
    expect(inspection.sendCalls[0]?.message).toBe(COMPLEX_PROMPT);
    expect(Buffer.byteLength(String(inspection.sendCalls[0]?.message), "utf8"))
      .toBe(Buffer.byteLength(COMPLEX_PROMPT, "utf8"));

    const transcript = page.getByTestId("agent-chat-transcript");
    const progress = page.locator('[data-testid="agent-assistant-progress"][data-progress-state="active"]');
    await expect(progress).toContainText("validating all 240 records");
    await expect(transcript).toContainText("COMPLEX_QUERY_START");
    await expect(transcript).toContainText("COMPLEX_QUERY_END");
    await expect(page.getByText(PRIVATE_REASONING)).toHaveCount(0);

    expect(await releaseMockGatewayFinals(page)).toBe(1);
    await expect(transcript).toContainText("COMPLEX_RESPONSE_END");
    await expect(page.getByRole("button", { name: "Stop reply" })).toBeHidden();
    await expect(page.getByText(PRIVATE_REASONING)).toHaveCount(0);
    await expectCachedUserMessages(page, [COMPLEX_PROMPT]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("agent-chat-composer")).toBeEnabled({ timeout: 90_000 });
    await expect(page.getByTestId("agent-chat-transcript")).toContainText("COMPLEX_QUERY_START");
    await expect(page.getByTestId("agent-chat-transcript")).toContainText("COMPLEX_QUERY_END");
    await expect(page.getByTestId("agent-chat-transcript")).toContainText("COMPLEX_RESPONSE_END");
    await expectCachedUserMessages(page, [COMPLEX_PROMPT]);
    expect(browserErrors).toEqual([]);
  });

  test("sends and renders rapid complex follow-ups in FIFO order", async ({ page }) => {
    const browserErrors = captureBrowserErrors(page);
    const prompts = [
      ["QUEUE_QUERY_1_START", "Compare {alpha: 1} against [beta, gamma].", "QUEUE_QUERY_1_END"].join("\n"),
      ["QUEUE_QUERY_2_START", "Explain `a < b && b > c` without evaluating it.", "QUEUE_QUERY_2_END"].join("\n"),
      ["QUEUE_QUERY_3_START", `Verify UTF-8 ${UTF8_SENTINEL} and path C:\\tmp\\report.json.`, "QUEUE_QUERY_3_END"].join("\n"),
    ];
    const responses = [
      "QUEUE_RESPONSE_1_COMPLETE",
      "QUEUE_RESPONSE_2_COMPLETE",
      "QUEUE_RESPONSE_3_COMPLETE",
    ];
    await installComplexQueryHarness(page, responses);
    await openComplexQueryChat(page);

    const composer = page.getByTestId("agent-chat-composer");
    await sendAgentChatMessage(page, prompts[0]);
    await expect(composer).toHaveValue("");
    await expect.poll(async () => (await inspectMockGateway(page)).sendCalls.length).toBe(1);

    await sendAgentChatMessage(page, prompts[1]);
    await expect(composer).toHaveValue("");
    await sendAgentChatMessage(page, prompts[2]);
    await expect(composer).toHaveValue("");
    await expect.poll(async () => (await inspectMockGateway(page)).sendCalls.length).toBe(1);

    expect(await releaseMockGatewayFinals(page)).toBe(1);
    await expect.poll(async () => (await inspectMockGateway(page)).sendCalls.length).toBe(2);
    expect(await releaseMockGatewayFinals(page)).toBe(1);
    await expect.poll(async () => (await inspectMockGateway(page)).sendCalls.length).toBe(3);
    expect(await releaseMockGatewayFinals(page)).toBe(1);

    const inspection = await inspectMockGateway(page);
    expect(inspection.sendCalls.map((call) => call.message)).toEqual(prompts);

    const transcript = page.getByTestId("agent-chat-transcript");
    for (const response of responses) {
      await expect(transcript.getByText(response, { exact: true })).toBeVisible();
    }
    const renderedResponseOrder = (await transcript.locator(".prose-chat").allTextContents())
      .filter((content) => responses.includes(content.trim()))
      .map((content) => content.trim());
    expect(renderedResponseOrder).toEqual(responses);
    await expectCachedUserMessages(page, prompts);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("agent-chat-composer")).toBeEnabled({ timeout: 90_000 });
    for (const prompt of prompts) {
      await expect(page.getByTestId("agent-chat-transcript")).toContainText(prompt.split("\n")[0]);
      await expect(page.getByTestId("agent-chat-transcript")).toContainText(prompt.split("\n").at(-1)!);
    }
    for (const response of responses) {
      await expect(page.getByText(response, { exact: true })).toBeVisible();
    }
    await expectCachedUserMessages(page, prompts);
    expect(browserErrors).toEqual([]);
  });
});
