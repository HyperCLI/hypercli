import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const MOCK_PATH = fileURLToPath(new URL("./tauri-mock.js", import.meta.url));

function withMock(page, overrides) {
  return (async () => {
    if (overrides) {
      await page.addInitScript((o) => {
        window.__MOCK_OVERRIDES__ = o;
      }, overrides);
    }
    await page.addInitScript({ path: MOCK_PATH });
  })();
}

test("logged out: auth only, providers hidden, footer resting", async ({ page }) => {
  await withMock(page);
  await page.goto("/");
  await expect(page.locator("#auth-disconnected")).toBeVisible();
  await expect(page.locator("#auth-connected")).toBeHidden();
  await expect(page.locator("#provider-section")).toBeHidden();
  await expect(page.locator("#version-line")).toContainText("up to date");
});

test("paste key: connects and reveals provider install", async ({ page }) => {
  await withMock(page);
  await page.goto("/");
  await page.locator("#key-input").fill("hyper-test-key");
  await page.getByRole("button", { name: "Save API key" }).click();
  await expect(page.locator("#auth-connected")).toBeVisible();
  await expect(page.locator("#provider-section")).toBeVisible();
  await expect(page.locator("#install-btn")).toHaveText("Install providers");
  await expect(page.locator("#auth-detail")).toContainText("test@hypercli.com");
  await expect(page.locator("#key-name")).toHaveText("Linux (ci)");
});

test("install: quiet success line, reinstall + uninstall affordances", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true } });
  await page.goto("/");
  await page.locator("#install-btn").click();
  await expect(page.locator("#provider-hint")).toContainText(
    "Providers installed in /home/test/.local/bin",
  );
  await expect(page.locator("#install-btn")).toHaveText("Reinstall");
  await expect(page.locator("#uninstall-btn")).toBeVisible();
  await expect(page.locator("#status")).toContainText("you can close the app");
  await expect(page.locator("#provider-list li")).toHaveCount(0);
});

test("partial install: missing names listed with reinstall", async ({ page }) => {
  await withMock(page, {
    status: {
      has_api_key: true,
      installed: ["buzz-backend-hypercli"],
      missing: ["buzz-backend-hypercli-buzz-agent"],
    },
  });
  await page.goto("/");
  await expect(page.locator("#provider-hint")).toContainText("missing");
  await expect(page.locator("#provider-list li.miss")).toHaveCount(1);
  await expect(page.locator("#provider-list")).toContainText(
    "buzz-backend-hypercli-buzz-agent",
  );
  await expect(page.locator("#install-btn")).toHaveText("Reinstall");
});

test("browser login: deep-link token mints and connects", async ({ page }) => {
  await withMock(page);
  await page.goto("/");
  await page.locator("#login-btn").click();
  await expect(page.locator("#status")).toContainText("Complete the sign-in");
  await page.evaluate(() => {
    window.__MOCK__.listeners["auth-token"]({ payload: "session-token" });
  });
  await expect(page.locator("#status")).toContainText('API key "Linux (ci)" created');
  await expect(page.locator("#auth-connected")).toBeVisible();
});

test("logout with env key: explains why still logged in", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true }, envKeyActive: true });
  await page.goto("/");
  await page.locator("#logout-btn").click();
  await expect(page.locator("#status")).toContainText("HYPER_API_KEY");
  await expect(page.locator("#auth-connected")).toBeVisible();
});

test("no active plan: purchase hint with plans link", async ({ page }) => {
  await withMock(page, {
    status: { has_api_key: true },
    validation: { has_active_plan: false },
  });
  await page.goto("/");
  await expect(page.locator("#plan-line")).toBeVisible();
  await page.locator("#plans-btn").click();
  const called = await page.evaluate(() =>
    window.__MOCK__.calls.some(([cmd]) => cmd === "open_plans"),
  );
  expect(called).toBe(true);
});

test("active plan: no purchase hint", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true } });
  await page.goto("/");
  await expect(page.locator("#auth-detail")).toContainText("test@hypercli.com");
  await expect(page.locator("#plan-line")).toBeHidden();
});

test("unknown plan status (scoped key): no purchase hint", async ({ page }) => {
  await withMock(page, {
    status: { has_api_key: true },
    validation: { has_active_plan: null },
  });
  await page.goto("/");
  await expect(page.locator("#auth-detail")).toContainText("test@hypercli.com");
  await expect(page.locator("#plan-line")).toBeHidden();
});

test("key without agents:* shows capability warning", async ({ page }) => {
  await withMock(page, {
    status: { has_api_key: true },
    validation: { has_agents_capability: false, key_name: "Buzz2" },
  });
  await page.goto("/");
  await expect(page.locator("#auth-warning")).toBeVisible();
  await expect(page.locator("#auth-warning")).toContainText("agents:*");
});

test("connected fleet defaults to Buzz and can reveal all agents", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true } });
  await page.goto("/");

  await expect(page.locator("#agents-section")).toBeVisible();
  await expect(page.locator("#agents-summary")).toHaveText("2 Buzz · 3 total");
  await expect(page.locator(".agent-card")).toHaveCount(2);
  await expect(page.locator(".agent-card")).toContainText(["Maverick", "Goose"]);
  await expect(page.locator("#filter-buzz")).toHaveAttribute("aria-pressed", "true");

  await page.locator("#filter-all").click();
  await expect(page.locator(".agent-card")).toHaveCount(3);
  await expect(page.locator(".agent-card")).toContainText(["Maverick", "Research", "Goose"]);
});

test("fleet actions follow backend lifecycle rules", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true } });
  await page.goto("/");

  const maverick = page.locator(".agent-card", { hasText: "Maverick" });
  await expect(maverick.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(maverick.getByRole("button", { name: "Restart" })).toBeVisible();
  await expect(maverick.getByRole("button", { name: "Delete" })).toHaveCount(0);

  const goose = page.locator(".agent-card", { hasText: "Goose" });
  await expect(goose.getByRole("button", { name: "Restart" })).toBeVisible();
  await expect(goose.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);

  await page.locator("#filter-all").click();
  const research = page.locator(".agent-card", { hasText: "Research" });
  await expect(research.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(research.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(research.getByRole("button", { name: "Stop" })).toHaveCount(0);
});

test("stop refreshes the card and delete requires confirmation", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true } });
  await page.goto("/");

  const maverick = page.locator(".agent-card", { hasText: "Maverick" });
  await maverick.getByRole("button", { name: "Stop" }).click();
  await expect(maverick.locator(".agent-state")).toHaveText("stopping");
  const stoppedCall = await page.evaluate(() =>
    window.__MOCK__.calls.some(([cmd, args]) =>
      cmd === "stop_agent" && args.agentId === "40c42593-7d02-48f9-a3ff-6c7d6461f140"
    ),
  );
  expect(stoppedCall).toBe(true);

  await page.locator("#filter-all").click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator(".agent-card", { hasText: "Research" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".agent-card", { hasText: "Research" })).toHaveCount(1);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".agent-card", { hasText: "Research" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".agent-card", { hasText: "Research" })).toHaveCount(0);
});
