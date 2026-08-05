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

test("older machine key offers one-click editor reauthorization", async ({ page }) => {
  await withMock(page, {
    status: { has_api_key: true },
    validation: { has_editor_capability: false },
  });
  await page.goto("/");
  await expect(page.locator("#editor-auth-warning")).toContainText("agent list still works");
  await page.locator("#reauthorize-btn").click();
  await expect(page.locator("#status")).toContainText("upgraded machine key");
  const called = await page.evaluate(() => window.__MOCK__.calls.some(([cmd]) => cmd === "start_login"));
  expect(called).toBe(true);
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

test("agent card opens a compact editor with native login state", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true } });
  await page.goto("/");

  await page.locator(".agent-card", { hasText: "Maverick" }).click();
  await expect(page.locator("#dashboard-view")).toBeHidden();
  await expect(page.locator("#agent-screen")).toBeVisible();
  await expect(page.locator("#agent-name")).toHaveValue("Maverick");
  await expect(page.locator("#agent-runtime")).toHaveValue("claude-code");
  await expect(page.locator("#agent-community")).toHaveValue("22222222-2222-4222-8222-222222222222");
  await expect(page.locator("#allowlist-field")).toBeVisible();
  await expect(page.locator("#runtime-auth-title")).toHaveText("Login required");
  await expect(page.locator("#runtime-auth-detail")).toContainText("Claude Code");
  const concurrencyBox = await page.locator("#agent-concurrency").boundingBox();
  expect(concurrencyBox.height).toBeLessThan(50);
  await page.locator("#agent-advanced").click();
  await expect(page.locator("#stored-secret-env")).toContainText("GITHUB_TOKEN");
  await expect(page.locator("#stored-secret-env")).toContainText("values hidden");

  await page.locator("#runtime-login-btn").click();
  await expect(page.locator("#runtime-login-code")).toContainText("TEST-CODE");
  await expect(page.locator("#runtime-login-input-row")).toBeVisible();
  await page.locator("#runtime-login-input").fill("pasted-code");
  await page.locator("#runtime-login-send").click();
  await expect(page.locator("#runtime-login-input")).toHaveValue("");
  const loginCall = await page.evaluate(() => window.__MOCK__.calls.find(([cmd]) => cmd === "begin_runtime_login"));
  expect(loginCall[1]).toEqual({
    agentId: "40c42593-7d02-48f9-a3ff-6c7d6461f140",
    runtime: "claude-code",
  });
  await expect(page.locator("#runtime-auth-title")).toHaveText("Logged in", { timeout: 4_000 });

  await page.locator("#agent-back").click();
  await expect(page.locator("#agents-section")).toBeVisible();
});

test("native login acknowledges a slow secure-session start", async ({ page }) => {
  await withMock(page, {
    status: { has_api_key: true },
    runtimeLoginBeginDelayMs: 300,
  });
  await page.goto("/");
  await page.locator(".agent-card", { hasText: "Maverick" }).click();
  await page.locator("#runtime-login-btn").click();
  await expect(page.locator("#runtime-login-btn")).toHaveText("Connecting…");
  await expect(page.locator("#runtime-auth-detail")).toContainText("Opening a secure login session");
  await expect(page.locator("#runtime-login-code")).toContainText("TEST-CODE");
});

test("editor saves Buzz policy and launch env through one typed payload", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true } });
  await page.goto("/");
  await page.locator(".agent-card", { hasText: "Maverick" }).click();

  await page.locator("#agent-respond-to").selectOption("owner");
  await expect(page.locator("#allowlist-field")).toBeHidden();
  await page.locator("#agent-advanced").click();
  await page.locator("#agent-env").fill("GITHUB_ORG=hypercli\nFEATURE_FLAG=true");
  await page.locator("#ssh-generate-btn").click();
  await expect(page.locator("#ssh-status-title")).toHaveText("SSH key installed");
  await expect(page.locator("#ssh-status-detail")).toContainText("SHA256:test-agent-key");
  await page.locator("#agent-save").click();

  const saveCall = await page.evaluate(() => window.__MOCK__.calls.find(([cmd]) => cmd === "save_agent"));
  expect(saveCall[1].agentId).toBe("40c42593-7d02-48f9-a3ff-6c7d6461f140");
  expect(saveCall[1].input.respond_to).toBe("owner");
  expect(saveCall[1].input.env).toEqual({ GITHUB_ORG: "hypercli", FEATURE_FLAG: "true" });
  await expect(page.locator("#dashboard-view")).toBeVisible();
});

test("agent image picker stages a preview and uploads only on save", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true } });
  await page.goto("/");
  await page.locator(".agent-card", { hasText: "Maverick" }).click();

  await page.locator("#agent-avatar-pick").click();
  await expect(page.locator("#agent-avatar-hint")).toContainText("maverick.png selected");
  await expect(page.locator("#agent-avatar-remove")).toBeVisible();
  await page.locator("#agent-save").click();

  const saveCall = await page.evaluate(() => window.__MOCK__.calls.find(([cmd]) => cmd === "save_agent"));
  expect(saveCall[1].input.avatar_upload_id).toBe("44444444-4444-4444-8444-444444444444");
  expect(saveCall[1].input.avatar_remove).toBe(false);
  expect(saveCall[1].input.avatar_url).toBe(null);
});

test("immediately completed native login does not enter a polling loop", async ({ page }) => {
  await withMock(page, {
    status: { has_api_key: true },
    runtimeLoginImmediateComplete: true,
  });
  await page.goto("/");
  await page.locator(".agent-card", { hasText: "Maverick" }).getByRole("button", { name: "Edit Maverick" }).click();
  await page.locator("#runtime-login-btn").click();
  await expect(page.locator("#runtime-auth-title")).toHaveText("Logged in");
  await page.waitForTimeout(1_200);
  const pollCalls = await page.evaluate(() => window.__MOCK__.calls.filter(([cmd]) => cmd === "poll_runtime_login"));
  expect(pollCalls).toHaveLength(0);
});

test("Enter sends native login input without saving the editor", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true } });
  await page.goto("/");
  await page.locator(".agent-card", { hasText: "Maverick" }).getByRole("button", { name: "Edit Maverick" }).click();
  await page.locator("#runtime-login-btn").click();
  await page.locator("#runtime-login-input").fill("pasted-code");
  await page.locator("#runtime-login-input").press("Enter");
  await expect(page.locator("#agent-screen")).toBeVisible();
  const calls = await page.evaluate(() => window.__MOCK__.calls.map(([cmd]) => cmd));
  expect(calls).toContain("send_runtime_login_input");
  expect(calls).not.toContain("save_agent");
});

test("native model override requires explicit HyperCLI compatibility env", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true } });
  await page.goto("/");
  await page.locator(".agent-card", { hasText: "Maverick" }).click();
  await expect(page.locator("#agent-model")).toBeDisabled();
  await expect(page.locator("#agent-model-help")).toContainText("HYPERCLI_RUNTIME_INFERENCE=hypercli");
  await page.locator("#agent-advanced").click();
  await page.locator("#agent-env").fill("GITHUB_ORG=hypercli\nHYPERCLI_RUNTIME_INFERENCE=hypercli");
  await expect(page.locator("#agent-model")).toBeEnabled();
  await expect(page.locator("#agent-model-help")).toContainText("explicitly enabled");
});

test("create prompt drafting previews text and never saves automatically", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true } });
  await page.goto("/");
  await page.locator("#create-agent-btn").click();
  await page.locator("#agent-name").fill("Compass");
  await page.locator("#draft-agent-prompt").click();
  await expect(page.locator("#prompt-draft-screen")).toBeVisible();
  await expect(page.locator("#agent-form")).toBeHidden();
  await page.locator("#prompt-draft-generate").click();
  await expect(page.locator("#prompt-draft-preview")).toHaveValue(/focused agent/);
  await expect(page.locator("#prompt-draft-status")).toContainText("Edit it here");
  await page.locator("#prompt-draft-use").click();
  await expect(page.locator("#agent-instructions")).toHaveValue(/focused agent/);
  await expect(page.locator("#agent-form")).toBeVisible();
  const calls = await page.evaluate(() => window.__MOCK__.calls.map(([cmd]) => cmd));
  expect(calls).toContain("draft_agent_prompt");
  expect(calls).not.toContain("create_buzz_agent");
});

test("drafting an older key offers reauthorization without breaking layout", async ({ page }) => {
  await withMock(page, {
    status: { has_api_key: true },
    draftError: "This Desktop key needs to be reauthorized for prompt drafting",
  });
  await page.goto("/");
  await page.locator("#create-agent-btn").click();
  await page.locator("#draft-agent-prompt").click();
  await page.locator("#prompt-draft-brief").fill("goose from topgun");
  await page.locator("#prompt-draft-generate").click();

  await expect(page.locator("#prompt-draft-reauth")).toBeVisible();
  const draftBox = await page.locator("#prompt-draft-screen").boundingBox();
  const brief = await page.locator("#prompt-draft-brief").boundingBox();
  expect(brief.width).toBeGreaterThan(draftBox.width * 0.8);
  await page.locator("#prompt-draft-reauthorize").click();
  await expect(page.locator("#prompt-draft-status")).toContainText("Sign in in your browser");
  const call = await page.evaluate(() => window.__MOCK__.calls.find(([cmd]) => cmd === "start_login"));
  expect(call).toBeTruthy();
});

test("create flow is progressive and launches a Buzz agent", async ({ page }) => {
  await withMock(page, { status: { has_api_key: true } });
  await page.goto("/");
  await page.locator("#create-agent-btn").click();

  await expect(page.locator("#agent-screen-title")).toHaveText("Create agent");
  await expect(page.locator("#runtime-auth-card")).toBeHidden();
  await expect(page.locator("#agent-advanced")).not.toHaveAttribute("open", "");
  await page.locator("#agent-name").fill("Compass");
  await page.locator("#agent-avatar-url").evaluate((element) => {
    element.value = "https://images.example.test/compass.png";
  });
  await page.locator("#agent-instructions").fill("Keep answers short and help maintain the project.");
  await page.locator("#agent-runtime").selectOption("opencode");
  await page.locator("#agent-size").selectOption("medium");
  await page.locator("#agent-community").selectOption("22222222-2222-4222-8222-222222222222");
  await page.locator("#agent-respond-to").selectOption("allowlist");
  await expect(page.locator("#allowlist-field")).toBeVisible();
  await page.locator("#agent-allowlist").fill("npub1owner\ndamian");
  await page.locator("#agent-save").click();

  const createCall = await page.evaluate(() => window.__MOCK__.calls.find(([cmd]) => cmd === "create_buzz_agent"));
  expect(createCall[1].input).toMatchObject({
    name: "Compass",
    avatar_url: "https://images.example.test/compass.png",
    runtime: "opencode",
    size: "medium",
    relay: "wss://dev.buzz.hypercli.com",
    community: "22222222-2222-4222-8222-222222222222",
    connection_id: "11111111-1111-4111-8111-111111111111",
    channels: ["22222222-2222-4222-8222-222222222222"],
    respond_to: "allowlist",
    allowlist: ["npub1owner", "damian"],
    concurrency: null,
  });
  await expect(page.locator("#agents-summary")).toHaveText("3 Buzz · 4 total");
  await expect(page.locator(".agent-card", { hasText: "Compass" })).toBeVisible();
});

test("create can save a Buzz connection without retaining the nsec in the page", async ({ page }) => {
  await withMock(page, {
    status: { has_api_key: true },
    buzzConnections: [],
  });
  await page.goto("/");
  await page.locator("#create-agent-btn").click();
  await expect(page.locator("#add-connection-panel")).toBeVisible();
  await page.locator("#connection-label").fill("CI Buzz");
  await page.locator("#connection-relay").fill("wss://dev.buzz.hypercli.com");
  await page.locator("#connection-nsec").fill("nsec1test-secret");
  await page.locator("#connection-save").click();

  await expect(page.locator("#add-connection-panel")).toBeHidden();
  await expect(page.locator("#agent-connection")).toHaveValue("44444444-4444-4444-8444-444444444444");
  await expect(page.locator("#agent-relay")).toHaveValue("wss://dev.buzz.hypercli.com");
  await expect(page.locator("#connection-nsec")).toHaveValue("");
  const retained = await page.evaluate(() => Object.values(localStorage).some((value) => value.includes("nsec1test-secret")));
  expect(retained).toBe(false);
});

test("legacy agent with no recoverable channel remains editable", async ({ page }) => {
  await withMock(page, {
    status: { has_api_key: true },
    agentDetails: {
      "40c42593-7d02-48f9-a3ff-6c7d6461f140": {
        community: "",
        channel: "",
      },
    },
  });
  await page.goto("/");
  await page.locator(".agent-card", { hasText: "Maverick" }).click();
  await expect(page.locator("#agent-community option").first()).toHaveText("Current channel unavailable");
  await expect(page.locator("#agent-community")).toBeEditable({ editable: false });
  await expect(page.locator("#connection-move-hint")).toContainText("Clone / Move");
  await page.locator("#agent-name").fill("Maverick Legacy");
  await page.locator("#agent-save").click();
  const saveCall = await page.evaluate(() => window.__MOCK__.calls.find(([cmd]) => cmd === "save_agent"));
  expect(saveCall[1].input.channels).toEqual([]);
});
