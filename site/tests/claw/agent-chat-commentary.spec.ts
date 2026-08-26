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
 * `"stop"`). Raw reasoning (`stream: "thinking"`) is private and must never
 * reach the UI.
 *
 * These states cannot be produced on demand against a live gateway, so the
 * spec drives the real app composition (Next.js app -> useOpenClawSession ->
 * SDK GatewayClient) against the in-page mock gateway seam, with the terminal
 * frame held until `releaseMockGatewayFinals` so assertions on streaming
 * state never depend on timing.
 *
 * Contract under test: working commentary is a distinct typed concept on the
 * assistant row (`data-testid="agent-assistant-progress"`, active while
 * streaming, collapsed once settled), never duplicated into the ordinary
 * reply, never crossed with raw thinking, and stable across reload.
 */

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const AGENT_ID = "agent-commentary-intercepted";
const AGENT_HOSTNAME = "agent-commentary-intercepted.example.test";
const THINKING_SENTINEL = "PRIVATE_REASONING_NEVER_RENDERED_7f3a";
const PROGRESS = '[data-testid="agent-assistant-progress"]';

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

const commentaryScript = (overrides: Partial<MockGatewayChatScript> = {}): MockGatewayChatScript => ({
  // Dashboard chat runs on a generated `dashboard:<uuid>` session key, so the
  // send-side scripts use the mock's catch-all queue.
  sessionKey: "*",
  commentary: ["Reading the config file", "Reading the config file and validating entries"],
  finalText: "Config is valid.",
  ...overrides,
});

test.describe("Agent chat working commentary (intercepted gateway)", () => {
  test("streams working notes as one distinct surface, never duplicates them into the reply, and settles them into a collapsed disclosure", async ({ page }) => {
    const script = commentaryScript({ thinking: THINKING_SENTINEL });
    await installMockGateway(page, { chatScripts: [script] });
    await installAuth(page);
    await interceptBackend(page);
    await openChatTab(page);
    await sendChat(page, "Check the config");

    // Active: exactly one working-note surface, carrying only the latest
    // cumulative note, identifiable for assistive technology, while the
    // ordinary reply contains no mirrored commentary.
    const progress = page.locator(`${PROGRESS}[data-progress-state="active"]`);
    await expect(progress).toHaveCount(1);
    await expect(progress).toContainText("Reading the config file and validating entries");
    await expect(progress).not.toContainText("validating entries and");
    await expect(page.getByRole("status", { name: "Working" })).toHaveCount(1);
    await expect(page.getByRole("status", { name: /starting response/i })).toHaveCount(0);
    await expect(page.getByLabel("Streaming")).toHaveCount(0);
    await expect(page.getByText(THINKING_SENTINEL)).toHaveCount(0);
    // The mirrored ordinary chat text must not appear as a reply paragraph.
    const transcript = page.getByTestId("agent-chat-transcript");
    await expect(transcript.locator(".prose-chat").getByText(/Reading the config file/)).toHaveCount(0);
    await expect(transcript.locator(".prose-chat")).not.toContainText("validating entries");

    // Finish the run deterministically, then the surface settles: collapsed,
    // keyboard-operable, and the final answer stands alone in the reply.
    await releaseMockGatewayFinals(page);
    const settled = page.locator(`${PROGRESS}[data-progress-state="settled"]`);
    await expect(settled).toHaveCount(1);
    const disclosure = settled.getByRole("button", { name: /working notes|progress/i });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(transcript.locator(".prose-chat").getByText("Config is valid.", { exact: true })).toBeVisible();
    // Once settled, the reply contains the answer exactly once and no notes.
    await expect(transcript.locator(".prose-chat").getByText(/Reading the config file/)).toHaveCount(0);
    await expect(page.getByText(THINKING_SENTINEL)).toHaveCount(0);

    // The settled notes are reachable by keyboard, not hidden from AT.
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(settled.getByText("Reading the config file and validating entries", { exact: true })).toBeVisible();
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

  test("settles active working notes when the user stops a reply", async ({ page }) => {
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

  test("hydrates persisted working notes from gateway history as settled disclosures without duplicating them", async ({ page }) => {
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

    // Open the persisted gateway session; hydration must fold cumulative note
    // snapshots into one settled disclosure and render the answer once.
    await selectGatewaySession(page, "research");
    const transcript = page.getByTestId("agent-chat-transcript");
    await expect(transcript.locator(".prose-chat").getByText("Config is valid.", { exact: true })).toHaveCount(1);
    const settled = page.locator(`${PROGRESS}[data-progress-state="settled"]`);
    await expect(settled).toHaveCount(1);
    await expect(transcript.locator(".prose-chat").getByText(/Reading the config file/)).toHaveCount(0);
    const disclosure = settled.getByRole("button", { name: /working notes|progress/i });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    // Keyboard-reachable after settle, not hidden from assistive technology.
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(settled.getByText("Reading the config file and validating entries", { exact: true })).toBeVisible();
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
