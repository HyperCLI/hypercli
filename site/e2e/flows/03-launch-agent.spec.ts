/**
 * Flow 03: Launch Agent
 *
 * Creates and launches an agent after login:
 *   1. Login via Privy
 *   2. Navigate to Dashboard → Agents
 *   3. Click "New Agent" / create button
 *   4. Walk through creation wizard
 *   5. Wait for agent to reach RUNNING state
 *   6. Verify agent appears in the list with green status
 *
 * Captures full network logs for debugging.
 *
 * Usage:
 *   IMAP_PASS=xxx npx playwright test e2e/flows/03-launch-agent.spec.ts --headed
 */

import { test, expect } from "@playwright/test";
import { privyLogin, launchAgentFromDashboard, sendChatAndWaitForReply } from "./helpers";
import fs from "fs";
import path from "path";

interface NetworkEntry {
  timestamp: string;
  method: string;
  url: string;
  status?: number;
  duration?: number;
  error?: string;
}

test.describe("Flow 03: Launch Agent", () => {
  test.setTimeout(180_000);

  test("Login → Create Agent → Wait for RUNNING → chat.send", async ({ page }) => {
    const networkLog: NetworkEntry[] = [];
    // ── Network logging ──
    page.on("request", (req) => {
      networkLog.push({
        timestamp: new Date().toISOString(),
        method: req.method(),
        url: req.url(),
      });
    });

    page.on("response", (res) => {
      const entry = networkLog.find(
        (e) => e.url === res.url() && !e.status
      );
      if (entry) {
        entry.status = res.status();
        entry.duration = Date.now() - new Date(entry.timestamp).getTime();
      } else {
        networkLog.push({
          timestamp: new Date().toISOString(),
          method: res.request().method(),
          url: res.url(),
          status: res.status(),
        });
      }
    });

    page.on("requestfailed", (req) => {
      const entry = networkLog.find(
        (e) => e.url === req.url() && !e.status
      );
      if (entry) {
        entry.error = req.failure()?.errorText ?? "unknown";
      }
    });

    // ── Step 1: Login ──
    await privyLogin(page);
    console.log("✓ Logged in");

    // ── Step 2-5: Launch a real agent ──
    const launched = await launchAgentFromDashboard(page);
    await page.screenshot({ path: "e2e/screenshots/03-06-agent-running.png" });
    console.log(`✓ Agent is RUNNING (${launched.id || "unknown-id"})`);

    await sendChatAndWaitForReply(page, {
      prompt: "Reply with exactly: E2E_CHAT_OK",
      expectedReply: "E2E_CHAT_OK",
    });
    await page.screenshot({ path: "e2e/screenshots/03-07-chat-send-ok.png" });
    console.log("✓ Chat returned E2E_CHAT_OK");

    // ── Save network log ──
    const logPath = path.join(__dirname, "..", "screenshots", "03-network.json");
    fs.writeFileSync(logPath, JSON.stringify(networkLog, null, 2));
    console.log(`✓ Network log saved: ${networkLog.length} entries`);

    // ── Filter API calls for the summary ──
    const apiCalls = networkLog.filter(
      (e) =>
        e.url.includes("/api/") ||
        e.url.includes("/deployments") ||
        e.url.includes("/stripe") ||
        e.url.includes("/plans")
    );
    console.log("\n── API calls ──");
    for (const call of apiCalls) {
      const status = call.status ?? "pending";
      const dur = call.duration ? `${call.duration}ms` : "";
      console.log(`  ${call.method} ${status} ${call.url} ${dur}`);
    }

    await expect(page.locator("text=/RUNNING/i").first()).toBeVisible();
    await expect(page.getByText("E2E_CHAT_OK", { exact: true }).last()).toBeVisible();
  });
});
