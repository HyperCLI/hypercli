import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";
import {
  installMockGateway,
  releaseMockGatewayFinals,
  type MockGatewayChatScript,
} from "./fixtures/mock-openclaw-gateway";
import {
  installAgentChatAuth,
  interceptAgentChatBackend,
  openAgentChatTab,
  sendAgentChatMessage,
} from "./fixtures/agent-chat-harness";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

/**
 * Deterministic browser lane for OpenClaw working-commentary handling.
 *
 * The live gateway emits the model's user-facing working narrative as
 * explicit `agent` frames (`stream: "assistant"`, `data.phase: "commentary"`,
 * cumulative `text` with `replace: true`), mirrors the same text as a prefix
 * of the cumulative ordinary `chat` deltas, and persists it in `chat.history`
 * as text-only assistant rows with `stopReason: "toolUse"` (final answers use
 * `"stop"`). Legacy raw `stream: "thinking"` remains private; structured
 * provider reasoning is rendered through its own disclosure.
 *
 * These states cannot be produced on demand against a live gateway, so the
 * spec drives the real app composition (Next.js app -> useOpenClawSession ->
 * SDK GatewayClient) against the in-page mock gateway seam, with the terminal
 * frame held until `releaseMockGatewayFinals` so assertions on streaming
 * state never depend on timing.
 *
 * Contract under test: working commentary is a distinct typed concept on the
 * assistant row (`data-testid="agent-assistant-progress"`), settles into a
 * collapsed working-notes disclosure, never duplicates into the ordinary
 * reply, and never crosses with provider reasoning or legacy raw thinking.
 */

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const AGENT_ID = "agent-commentary-intercepted";
const AGENT_HOSTNAME = "agent-commentary-intercepted.example.test";
const THINKING_SENTINEL = "PRIVATE_REASONING_NEVER_RENDERED_7f3a";
const PROVIDER_THOUGHT = "Compare the parsed deployment values before answering.";
const PROGRESS = '[data-testid="agent-assistant-progress"]';
const REASONING = '[data-testid="agent-assistant-reasoning"]';

const installAuth = installAgentChatAuth;
const interceptBackend = (page: import("@playwright/test").Page): Promise<void> =>
  interceptAgentChatBackend(page, { agentId: AGENT_ID, hostname: AGENT_HOSTNAME });
const openChatTab = (page: import("@playwright/test").Page): Promise<void> => openAgentChatTab(page, AGENT_ID);
const sendChat = sendAgentChatMessage;

async function selectGatewaySession(page: import("@playwright/test").Page, sessionKey: string): Promise<void> {
  const collapseRoster = page.getByRole("button", { name: "Collapse sidebar" });
  if (await collapseRoster.isVisible()) await collapseRoster.click();
  const session = page.locator(`[data-session-key="${sessionKey}"]`).getByTestId("agent-session-select");
  await expect(session).toBeVisible();
  await session.click();
}

async function promoteMockThinkingToStructuredReasoning(page: import("@playwright/test").Page): Promise<void> {
  // The shared fixture deliberately models legacy private `stream: thinking`.
  // Rewrite only that exact outbound mock frame so this spec can also exercise
  // the provider-authored reasoning protocol without changing the fixture.
  await page.addInitScript(`
    (() => {
      const nativeStringify = JSON.stringify.bind(JSON);
      JSON.stringify = function(value, replacer, space) {
        if (
          value &&
          typeof value === "object" &&
          value.type === "event" &&
          value.event === "agent" &&
          value.payload?.stream === "thinking"
        ) {
          const payload = value.payload;
          return nativeStringify({
            type: "event",
            event: "chat.thinking.delta",
            payload: {
              runId: payload.runId,
              sessionKey: payload.sessionKey,
              reasoning_content_delta: payload.data?.delta ?? "",
            },
          }, replacer, space);
        }
        return nativeStringify(value, replacer, space);
      };
    })();
  `);
}

const commentaryScript = (overrides: Partial<MockGatewayChatScript> = {}): MockGatewayChatScript => ({
  // Dashboard chat runs on a generated `dashboard:<uuid>` session key, so the
  // send-side scripts use the mock's catch-all queue.
  sessionKey: "*",
  commentary: ["Reading the config file", "Reading the config file and validating entries"],
  finalText: "Config is valid.",
  ...overrides,
});

test.describe("Agent chat working commentary (intercepted gateway)", () => {
  test("streams public commentary, keeps raw thinking private, and settles notes beside the final answer", async ({ page }) => {
    const script = commentaryScript({ thinking: THINKING_SENTINEL });
    await installMockGateway(page, { chatScripts: [script] });
    await installAuth(page);
    await interceptBackend(page);
    await openChatTab(page);
    await sendChat(page, "Check the config");

    // Active: exactly one working-note surface is identifiable for assistive
    // technology while the ordinary reply contains no mirrored commentary.
    const progress = page.locator(`${PROGRESS}[data-progress-state="active"]`);
    await expect(progress).toHaveCount(1);
    await expect(progress).toContainText("Reading the config file and validating entries");
    await expect(progress).not.toContainText("validating entries and");
    await expect(page.getByRole("status", { name: "Working" })).toHaveCount(1);
    await expect(page.getByRole("status", { name: /starting response/i })).toHaveCount(0);
    await expect(page.getByLabel("Streaming")).toHaveCount(0);
    await expect(page.getByText(THINKING_SENTINEL)).toHaveCount(0);
    await expect(page.locator(REASONING)).toHaveCount(0);
    // The mirrored ordinary chat text must not appear as a reply paragraph.
    const transcript = page.getByTestId("agent-chat-transcript");
    await expect(transcript.locator(".prose-chat").getByText(/Reading the config file/)).toHaveCount(0);
    await expect(transcript.locator(".prose-chat")).not.toContainText("validating entries");

    // Finish the run deterministically. Public commentary settles beside the
    // final answer without entering the answer's markdown lane.
    await releaseMockGatewayFinals(page);
    const settledProgress = page.locator(`${PROGRESS}[data-progress-state="settled"]`);
    await expect(settledProgress).toHaveCount(1);
    const workingNotes = page.getByRole("button", { name: "Working notes" });
    await expect(workingNotes).toHaveAttribute("aria-expanded", "false");
    await workingNotes.click();
    await expect(workingNotes).toHaveAttribute("aria-expanded", "true");
    await expect(settledProgress).toContainText("Reading the config file and validating entries");
    await expect(transcript.locator(".prose-chat").getByText("Config is valid.", { exact: true })).toBeVisible();
    // Once complete, the reply contains the answer exactly once and no notes.
    await expect(transcript.locator(".prose-chat").getByText(/Reading the config file/)).toHaveCount(0);
    await expect(page.getByText(THINKING_SENTINEL)).toHaveCount(0);
  });

  test("renders no working-note surface at all for a model that only sends ordinary content", async ({ page }) => {
    await installMockGateway(page, {
      chatScripts: [{ sessionKey: "*", finalText: "Plain answer with no working notes." }],
    });
    await installAuth(page);
    await interceptBackend(page);
    await openChatTab(page);
    await sendChat(page, "Say hello");
    await releaseMockGatewayFinals(page);

    const transcript = page.getByTestId("agent-chat-transcript");
    await expect(transcript.getByText("Plain answer with no working notes.", { exact: true })).toBeVisible();
    await expect(page.locator(PROGRESS)).toHaveCount(0);
  });

  test("streams structured provider thoughts open, then collapses them when answer content begins", async ({ page }) => {
    await promoteMockThinkingToStructuredReasoning(page);
    await installMockGateway(page, {
      chatScripts: [{
        sessionKey: "*",
        thinking: PROVIDER_THOUGHT,
        finalText: "The deployment is valid.",
      }],
    });
    await installAuth(page);
    await interceptBackend(page);
    await openChatTab(page);
    await sendChat(page, "Check the deployment");

    const thought = page.locator(REASONING);
    await expect(thought).toHaveAttribute("data-reasoning-state", "active");
    await expect(thought).toHaveAttribute("open", "");
    await expect(thought).toHaveAttribute("aria-busy", "true");
    await expect(thought).toContainText(PROVIDER_THOUGHT);
    await expect(page.getByTestId("agent-assistant-reasoning-toggle")).toHaveAccessibleName("Thinking");
    await expect(page.getByRole("status", { name: /starting response|working through your request/i })).toHaveCount(0);
    await expect(page.locator(PROGRESS)).toHaveCount(0);

    await releaseMockGatewayFinals(page);
    await expect(thought).toHaveAttribute("data-reasoning-state", "settled");
    await expect(thought).not.toHaveAttribute("open", "");
    await expect(page.getByTestId("agent-assistant-reasoning-toggle")).toHaveAccessibleName(/thought/i);
    await expect(page.getByText("The deployment is valid.", { exact: true })).toBeVisible();
  });

  test("hydrates structured provider thoughts as a separate collapsed disclosure", async ({ page }) => {
    await installMockGateway(page, {
      chatHistories: {
        research: [
          { role: "user", timestamp: 1, content: [{ type: "text", text: "Check the deployment" }] },
          {
            role: "assistant",
            stopReason: "stop",
            timestamp: 2,
            content: [
              { type: "thinking", text: PROVIDER_THOUGHT },
              { type: "text", text: "The deployment is valid." },
            ],
          },
        ],
      },
      sessions: [{ key: "research", label: "Deployment check" }],
    });
    await installAuth(page);
    await interceptBackend(page);
    await openAgentChatTab(page, AGENT_ID);
    await selectGatewaySession(page, "research");

    const thought = page.locator(`${REASONING}[data-reasoning-state="settled"]`);
    await expect(thought).toHaveCount(1);
    await expect(thought).not.toHaveAttribute("open", "");
    const toggle = page.getByTestId("agent-assistant-reasoning-toggle");
    await expect(toggle).toHaveAccessibleName("Thoughts");
    await toggle.click();
    await expect(thought).toHaveAttribute("open", "");
    await expect(thought).toContainText(PROVIDER_THOUGHT);
    await expect(page.getByText("The deployment is valid.", { exact: true })).toBeVisible();
    await expect(page.locator(PROGRESS)).toHaveCount(0);
  });

  test("settles active commentary when the user stops a reply", async ({ page }) => {
    await installMockGateway(page, { chatScripts: [commentaryScript()] });
    await installAuth(page);
    await interceptBackend(page);
    await openChatTab(page);
    await sendChat(page, "Stop after checking the config");

    await expect(page.locator(`${PROGRESS}[data-progress-state="active"]`)).toHaveCount(1);
    await page.getByRole("button", { name: "Stop reply" }).click();

    await expect(page.locator(`${PROGRESS}[data-progress-state="active"]`)).toHaveCount(0);
    await expect(page.locator(`${PROGRESS}[data-progress-state="settled"]`)).toHaveCount(1);
    await expect(page.getByTestId("agent-chat-transcript").getByText("Reply stopped", { exact: true })).toBeVisible();
    expect(await releaseMockGatewayFinals(page)).toBe(0);
  });

  test("hydrates persisted commentary without duplicating it into the answer", async ({ page }) => {
    // Persisted exactly as the live gateway persists a completed run: each
    // cumulative working note is a text-only assistant row with stopReason
    // "toolUse", the final answer is a "stop" row.
    await installMockGateway(page, {
      chatHistories: {
        research: [
          { role: "user", timestamp: 1, content: [{ type: "text", text: "Check the config" }] },
          { role: "assistant", stopReason: "toolUse", timestamp: 2, content: [{ type: "text", text: "Reading the config file" }] },
          { role: "assistant", stopReason: "toolUse", timestamp: 3, content: [{ type: "text", text: "Reading the config file and validating entries" }] },
          { role: "assistant", stopReason: "stop", timestamp: 4, content: [{ type: "text", text: "Config is valid." }] },
        ],
      },
      sessions: [{ key: "research", label: "Previous check" }],
    });
    await installAuth(page);
    await interceptBackend(page);
    await openAgentChatTab(page, AGENT_ID);

    // Open the persisted gateway session; hydration folds cumulative note
    // snapshots into one settled working-notes disclosure.
    await selectGatewaySession(page, "research");
    const transcript = page.getByTestId("agent-chat-transcript");
    await expect(transcript.locator(".prose-chat").getByText("Config is valid.", { exact: true })).toHaveCount(1);
    await expect(page.locator(`${PROGRESS}[data-progress-state="settled"]`)).toHaveCount(1);
    await expect(transcript.locator(".prose-chat").getByText(/Reading the config file/)).toHaveCount(0);
  });

  test("removes a near-complete persisted commentary mirror before rendering the final answer", async ({ page }) => {
    const note = "I love that you asked me this. Financial freedom is challenging in the current economy, but possible with the right strategy. Let me research the current options.";
    await installMockGateway(page, {
      chatHistories: {
        research: [
          { role: "user", timestamp: 1, content: [{ type: "text", text: "Build a financial plan" }] },
          { role: "assistant", stopReason: "toolUse", timestamp: 2, content: [{ type: "text", text: note }] },
          {
            role: "assistant",
            stopReason: "stop",
            timestamp: 3,
            content: [{
              type: "text",
              text: "I love that you asked me this. Financial freedom is challenging in the current economy, but possible with the right strategy. Let me research the current optPerfect. I now have the information I need.",
            }],
          },
        ],
      },
      sessions: [{ key: "research", label: "Financial plan" }],
    });
    await installAuth(page);
    await interceptBackend(page);
    await openAgentChatTab(page, AGENT_ID);

    await selectGatewaySession(page, "research");
    const transcript = page.getByTestId("agent-chat-transcript");
    await expect(transcript.locator(".prose-chat").getByText("Perfect. I now have the information I need.", { exact: true })).toBeVisible();
    await expect(transcript.locator(".prose-chat").getByText(/I love that you asked me this/)).toHaveCount(0);
    await expect(page.locator(`${PROGRESS}[data-progress-state="settled"]`)).toHaveCount(1);
  });

  test("does not leak working notes across sessions", async ({ page }) => {
    await installMockGateway(page, {
      chatScripts: [commentaryScript()],
      chatHistories: {
        research: [
          { role: "user", timestamp: 1, content: [{ type: "text", text: "Summarize findings" }] },
          { role: "assistant", stopReason: "stop", timestamp: 2, content: [{ type: "text", text: "Findings summarized." }] },
        ],
      },
      sessions: [
        { key: "main", label: "Main session" },
        { key: "research", label: "Research session" },
      ],
    });
    await installAuth(page);
    await interceptBackend(page);
    await openChatTab(page);
    await sendChat(page, "Check the config");

    await expect(page.locator(`${PROGRESS}[data-progress-state="active"]`)).toHaveCount(1);
    await releaseMockGatewayFinals(page);
    await expect(page.locator(`${PROGRESS}[data-progress-state="settled"]`)).toHaveCount(1);

    // Switching to another session replaces the transcript wholesale; no
    // working note from the main session may remain visible.
    await selectGatewaySession(page, "research");
    await expect(page.getByTestId("agent-chat-transcript").getByText("Findings summarized.", { exact: true })).toBeVisible();
    await expect(page.locator(PROGRESS)).toHaveCount(0);
    await expect(page.getByText(/Reading the config file/)).toHaveCount(0);
  });
});
