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
import { privyLogin, BASE_URL } from "./helpers";
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

  test("Login → Create Agent → Wait for RUNNING", async ({ page }) => {
    const networkLog: NetworkEntry[] = [];
    const startTime = Date.now();

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

    // ── Step 2: Navigate to agents page ──
    await page.goto(`${BASE_URL}/dashboard/agents`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "e2e/screenshots/03-01-agents-page.png" });
    console.log("✓ On agents page");

    // ── Step 3: Click New Agent / Create button ──
    const createButton = page
      .getByRole("button", { name: /new agent|create|launch|\+/i })
      .first();
    await expect(createButton).toBeVisible({ timeout: 10_000 });
    await createButton.click();
    console.log("✓ Clicked Create Agent");

    await page.waitForTimeout(1000);
    await page.screenshot({ path: "e2e/screenshots/03-02-wizard-step1.png" });

    // ── Step 4: Walk through wizard ──
    // Step 1: Identity (name + icon) — click Next
    const nextButton = page.getByRole("button", { name: /next|continue/i }).first();
    await expect(nextButton).toBeVisible({ timeout: 5_000 });
    await nextButton.click();
    console.log("✓ Wizard step 1 → next");

    await page.waitForTimeout(500);
    await page.screenshot({ path: "e2e/screenshots/03-03-wizard-step2.png" });

    // Step 2: Size selection — keep default, click Next
    const nextButton2 = page.getByRole("button", { name: /next|continue/i }).first();
    if (await nextButton2.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nextButton2.click();
      console.log("✓ Wizard step 2 → next");
      await page.waitForTimeout(500);
    }

    await page.screenshot({ path: "e2e/screenshots/03-04-wizard-step3.png" });

    // Step 3: Review — click Create / Launch
    const launchButton = page
      .getByRole("button", { name: /create|launch|deploy/i })
      .first();
    await expect(launchButton).toBeVisible({ timeout: 5_000 });
    await launchButton.click();
    console.log("✓ Clicked Create/Launch");

    await page.waitForTimeout(2000);
    await page.screenshot({ path: "e2e/screenshots/03-05-creating.png" });

    // ── Step 5: Wait for agent to appear and reach RUNNING ──
    // The page should refresh or show the new agent
    // Poll for the agent to show a RUNNING state indicator
    console.log("✓ Waiting for agent to reach RUNNING state...");

    let running = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      await page.waitForTimeout(3000);

      // Check for a green indicator or "RUNNING" text
      const runningIndicator = page.locator(
        'text=RUNNING, [class*="green"], [data-state="RUNNING"]'
      );
      const agentCard = page.locator('[class*="agent"]').first();

      // Also check for the green dot or status text
      const statusText = await page
        .locator("text=/RUNNING|STARTING|PENDING/i")
        .first()
        .textContent()
        .catch(() => null);

      if (statusText?.toUpperCase().includes("RUNNING")) {
        running = true;
        console.log(`✓ Agent is RUNNING (attempt ${attempt + 1})`);
        break;
      }

      if (statusText) {
        console.log(`  Agent state: ${statusText} (attempt ${attempt + 1})`);
      }

      // Refresh agent list periodically
      if (attempt % 5 === 4) {
        await page.reload({ waitUntil: "networkidle" });
        console.log("  Refreshed page");
      }
    }

    await page.screenshot({ path: "e2e/screenshots/03-06-agent-running.png" });

    if (!running) {
      console.log("⚠ Agent did not reach RUNNING within timeout");
      // Still capture state for debugging
    }

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

    expect(running).toBe(true);
  });
});
