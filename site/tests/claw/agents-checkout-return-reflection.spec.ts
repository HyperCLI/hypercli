import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

/**
 * Checkout-return reflection hardening — feat-only, deterministic.
 *
 * agents-paid-first-launch.spec.ts proves the paid-first recovery happy path.
 * This spec pins the remaining fresh-account reflection contract it does not
 * reach:
 *
 *   1. delayed SLOT reflection ("waiting-entitlement"): the plan is reflected
 *      but launch slots are not granted yet. The page must hold truthfully,
 *      never create early, and recover through a keyboard-activated Refresh.
 *   2. start failure after a successful create: the terminal failure is
 *      surfaced, exactly-once create/start holds, and the page never spins.
 *   3. console/transport hygiene on the happy recovery path: zero console
 *      errors, zero page errors, zero failed app API requests.
 *   4. catalog-unavailable (/agents/plans 500) during recovery: a partial
 *      enrichment must not block or break the already-paid recovery.
 *
 * Everything drives the real feat build and intercepts only the backend API.
 *
 * The deployments event-subscription control channel (POST
 * /deployments/events/token) is intentionally left unanswered here: the live,
 * reconnection-owned socket behavior belongs to the live gateway suites, and a
 * mocked token response would only manufacture meaningless WebSocket noise
 * against the app origin in this deterministic composition.
 */

const FEAT_APP_BASE_URL = "https://agents.feat.hypercli.com";
{
  const configured = (process.env.TEST_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured !== FEAT_APP_BASE_URL) {
    throw new Error(
      `Checkout-return reflection coverage is feat-only; TEST_BASE_URL must be ${FEAT_APP_BASE_URL}, got ${configured || "<missing>"}.`,
    );
  }
}

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const TEST_PRINCIPAL_ID = "stored-session";
const TEST_SETUP_ID = "setup-reflection-hardening";
const TEST_WORKSPACE_ID = "workspace-reflection-hardening";
const PENDING_CHECKOUT_KEY = `hyperclaw.pendingPlanCheckout.v1:${encodeURIComponent(TEST_PRINCIPAL_ID)}`;
const FIRST_AGENT_DRAFT_KEY = "hypercli-first-agent-draft";
const OPENCLAW_CONFIG_PATH = ".openclaw/openclaw.json";
const STAGED_FILE_PATHS = [
  ".openclaw/workspace/AGENTS.md",
  ".openclaw/workspace/SOUL.md",
  ".openclaw/workspace/IDENTITY.md",
  ".openclaw/workspace/USER.md",
  ".openclaw/workspace/BOOTSTRAP.md",
] as const;

const WAITING_ENTITLEMENT_MESSAGE =
  "Payment active. Waiting for launch entitlements to finish provisioning before agents can be created.";

function pendingCheckout(): Record<string, unknown> {
  return {
    principalId: TEST_PRINCIPAL_ID,
    planId: "pro",
    planName: "Pro",
    ownedCount: 0,
    startedAt: 1,
    bundle: { large: 1 },
    baselineGrantedSlots: { large: 0 },
    flow: "first-agent-setup",
    setupId: TEST_SETUP_ID,
    workspaceId: TEST_WORKSPACE_ID,
    agentSize: "large",
  };
}

function firstAgentDraft(): Record<string, unknown> {
  return {
    source: "first-agent-setup",
    setupId: TEST_SETUP_ID,
    principalId: TEST_PRINCIPAL_ID,
    workspaceId: TEST_WORKSPACE_ID,
    name: "reflection-agent",
    displayName: "Reflection Agent",
    description: "Saved reflection setup",
    size: "large",
    iconIndex: 5,
    category: "Ops",
    plan: "pro",
    enableDesktop: false,
    enableMemoryIndex: false,
    enableCustomImage: false,
    customImage: "",
    updatedAt: 1,
  };
}

async function plantSession(page: Page): Promise<void> {
  await page.context().addCookies([{
    name: "auth_token",
    value: TEST_JWT,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }]);
  await page.addInitScript(({ token, pendingKey, draftKey, pendingValue, draftValue }) => {
    window.localStorage.setItem("claw_auth_token", token);
    window.localStorage.setItem(pendingKey, pendingValue);
    window.sessionStorage.setItem(draftKey, draftValue);
  }, {
    token: TEST_JWT,
    pendingKey: PENDING_CHECKOUT_KEY,
    draftKey: FIRST_AGENT_DRAFT_KEY,
    pendingValue: JSON.stringify(pendingCheckout()),
    draftValue: JSON.stringify(firstAgentDraft()),
  });
}

interface HygieneLog {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: string[];
}

function describeHygiene(log: HygieneLog): string {
  return [
    `console errors: ${log.consoleErrors.join(" | ") || "<none>"}`,
    `console warnings: ${log.consoleWarnings.join(" | ") || "<none>"}`,
    `page errors: ${log.pageErrors.join(" | ") || "<none>"}`,
    `failed app requests: ${log.failedRequests.join(" | ") || "<none>"}`,
  ].join("\n");
}

/** Directive quality standard: no unexpected console noise, page errors, or failed app transport. */
function trackHygiene(page: Page): HygieneLog {
  const log: HygieneLog = { consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [] };
  page.on("console", (message) => {
    if (message.type() === "error") log.consoleErrors.push(message.text());
    else if (message.type() === "warning") log.consoleWarnings.push(message.text());
  });
  page.on("pageerror", (error) => log.pageErrors.push(String(error)));
  page.on("requestfailed", (request) => {
    if (!["fetch", "xhr"].includes(request.resourceType())) return;
    // The SDK event-subscription control channel is intentionally held open by
    // this harness (the socket lifecycle is live-owned); browsers differ in how
    // a held request ends, so its terminal disposition is excluded from hygiene.
    if (request.url().includes("/deployments/events/token")) return;
    // Held harness requests are otherwise force-aborted on context teardown;
    // that teardown artifact is not app noise.
    if (request.failure()?.errorText.includes("ERR_ABORTED")) return;
    log.failedRequests.push(`FAILED ${request.method()} ${request.url()}`);
  });
  page.on("response", (response) => {
    if (["fetch", "xhr"].includes(response.request().resourceType()) && response.status() >= 400) {
      log.failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  return log;
}

function expectCleanHygiene(log: HygieneLog): void {
  const report = describeHygiene(log);
  expect(log.consoleErrors, report).toEqual([]);
  expect(log.consoleWarnings, report).toEqual([]);
  expect(log.pageErrors, report).toEqual([]);
  expect(log.failedRequests, report).toEqual([]);
}

interface MockControls {
  readonly counters: { createCount: number; startCount: number; summaryGetCount: number };
  readonly writtenFiles: Record<string, Buffer>;
  readonly stagingEvents: string[];
  /** Whether the purchased large slot is granted/available in billing data. */
  slotReflected: boolean;
  failStartWith: { status: number; body: Record<string, unknown> } | null;
  failPlansCatalog: boolean;
  holdReadPath: string | null;
  releaseRead: () => void;
}

/** Faithful current-contract backend: stopped create, Reef staging, one explicit start. */
async function installMockBackend(page: Page): Promise<MockControls> {
  const counters = { createCount: 0, startCount: 0, summaryGetCount: 0 };
  const writtenFiles: Record<string, Buffer> = {};
  const stagingEvents: string[] = [];
  const readGate: Array<() => void> = [];
  let createdAgent: Record<string, unknown> | null = null;
  const controls: MockControls = {
    counters,
    writtenFiles,
    stagingEvents,
    slotReflected: true,
    failStartWith: null,
    failPlansCatalog: false,
    holdReadPath: null,
    releaseRead: () => { for (const release of readGate.splice(0)) release(); },
  };

  // Account/profile surfaces outside the agents API use safe inert fixtures so
  // the seeded session never reaches the production backend with a fake token.
  await page.route(/\/api\/user(?:\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: TEST_PRINCIPAL_ID, email: "reflection@example.invalid", name: "Reflection Tester" }),
    });
  });
  await page.route(/\/slack\/install(?:\?|$)/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ installed: false }) });
  });

  await page.route(/\/workspaces(?:\/.*)?$/, async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const generalWorkspace = { id: "workspace-general", name: "General", slug: "general", display_name: "General", role: "admin" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pathName.endsWith("/agents") || pathName.endsWith("/grants") ? [] : [generalWorkspace]),
    });
  });

  await page.route("**/agents/**", async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const method = route.request().method();

    if (!pathName.startsWith("/agents/")) {
      await route.fallback();
      return;
    }

    // Hold the event-subscription control channel open for the duration of the
    // test. Fulfilling it with a fabricated ws_url would make the SDK dial
    // WebSocket URLs derived from the mock; the live, reconnection-owned socket
    // behavior belongs to the live gateway suites, not this deterministic API
    // contract composition.
    if (pathName.endsWith("/deployments/events/token")) {
      await new Promise<void>(() => {});
      return;
    }

    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createdAgent ? [createdAgent] : []),
      });
      return;
    }
    if (pathName.endsWith("/agents/deployments") && method === "POST") {
      counters.createCount += 1;
      createdAgent = {
        id: "agent-reflection",
        name: "reflection-agent",
        handle: "reflection-agent",
        user_id: TEST_PRINCIPAL_ID,
        state: "STARTING",
        cpu: 4,
        memory: 4,
        hostname: "reflection-agent.hypercli.app",
        created_at: "2026-08-25T00:00:00Z",
        updated_at: "2026-08-25T00:00:00Z",
        launch_config: {
          config: {},
          image: "ghcr.io/hypercli/hypercli-openclaw:pro-latest",
          env: {},
          secrets: { OPENCLAW_GATEWAY_TOKEN: "gw-token-reflection" },
          routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
          command: [],
          entrypoint: [],
          restart: false,
          sync_root: "/home/node",
          sync_uid: null,
          sync_gid: null,
          registry_url: null,
          registry_auth: {},
          runtime_scopes: ["models:*"],
        },
      };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent) });
      return;
    }
    if (createdAgent && method === "GET" && pathName.endsWith(`/agents/deployments/${createdAgent.id}`)) {
      if (createdAgent.state === "STARTING") createdAgent = { ...createdAgent, state: "STOPPED" };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent) });
      return;
    }
    // Starter file writes go through Reef: mint a token, then PUT the bytes to
    // the returned agent-hostname URL (mocked below by the reef route).
    if (method === "POST" && pathName.endsWith(`/agents/deployments/${createdAgent?.id ?? "?"}/files/token`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "reef-token-reflection",
          url: "https://reef.test/_reef",
          expires_at: "2026-12-31T00:00:00Z",
        }),
      });
      return;
    }
    if (createdAgent && method === "POST" && pathName.endsWith(`/agents/deployments/${createdAgent.id}/start`)) {
      counters.startCount += 1;
      stagingEvents.push("start");
      if (controls.failStartWith) {
        await route.fulfill({
          status: controls.failStartWith.status,
          contentType: "application/json",
          body: JSON.stringify(controls.failStartWith.body),
        });
        return;
      }
      createdAgent = { ...createdAgent, state: "RUNNING" };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent) });
      return;
    }
    if (pathName.endsWith("/agents/plans")) {
      if (controls.failPlansCatalog) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "plan catalog storage unavailable" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plans: [{
            id: "pro",
            name: "Pro",
            price: 80,
            price_usd: 80,
            highlighted: true,
            features: ["250M tokens/day"],
            models: [],
            limits: { tpd: 250000000, burst_tpm: 8680550, rpm: 868 },
            slot_grants: { large: 1 },
          }],
        }),
      });
      return;
    }
    if (pathName.endsWith("/agents/plans/current")) {
      const slots = controls.slotReflected ? { large: { granted: 1, used: 0, available: 1 } } : {};
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "pro", name: "Pro", pooled_tpd: 250000000, slot_inventory: slots }),
      });
      return;
    }
    if (pathName.endsWith("/agents/subscriptions/summary")) {
      counters.summaryGetCount += 1;
      const slots = controls.slotReflected ? { large: { granted: 1, used: 0, available: 1 } } : {};
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          effective_plan_id: "pro",
          current_subscription_id: "sub-pro",
          pooled_tpd: 250000000,
          slot_inventory: slots,
          active_subscription_count: 1,
          active_entitlement_count: 1,
          entitlements: {
            effective_plan_id: "pro",
            active_entitlement_count: 1,
            slot_inventory: slots,
          },
          active_subscriptions: [{ id: "sub-pro", plan_id: "pro", plan_name: "Pro", quantity: 1, status: "active" }],
          subscriptions: [],
          user: { id: TEST_PRINCIPAL_ID },
        }),
      });
      return;
    }
    if (pathName.endsWith("/agents/usage/history")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ history: [] }) });
      return;
    }
    if (pathName.endsWith("/agents/types")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ types: [{ id: "large", name: "Large", cpu: 2, memory: 8 }], plans: [] }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  // Reef retains starter-file bytes so every write can be read back exactly
  // before the deployment receives START.
  await page.route(/^https:\/\/reef\.test\//, async (route) => {
    const request = route.request();
    const pathName = new URL(request.url()).pathname;
    const fileMarker = "/files/";
    const markerIndex = pathName.indexOf(fileMarker);
    expect(pathName.startsWith("/_reef/files/")).toBe(true);
    expect(request.headers().authorization).toBe("Bearer reef-token-reflection");
    const filePath = markerIndex >= 0
      ? decodeURIComponent(pathName.slice(markerIndex + fileMarker.length))
      : "";
    if (request.method() === "PUT") {
      expect(request.headers()["content-type"]).toContain("application/octet-stream");
      writtenFiles[filePath] = Buffer.from(request.postDataBuffer() ?? Buffer.alloc(0));
      stagingEvents.push(`write:${filePath}`);
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    if (request.method() === "GET") {
      stagingEvents.push(`read:${filePath}`);
      if (controls.holdReadPath === filePath) {
        await new Promise<void>((resolve) => readGate.push(resolve));
      }
      await route.fulfill({ status: 200, contentType: "application/octet-stream", body: writtenFiles[filePath] ?? Buffer.alloc(0) });
      return;
    }
    if (request.method() === "DELETE") {
      delete writtenFiles[filePath];
      stagingEvents.push(`delete:${filePath}`);
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  return controls;
}

test("holds checkout recovery in waiting-entitlement until the slot reflects, then recovers through a keyboard-activated Refresh", async ({ page }) => {
  test.setTimeout(150_000);
  const hygiene = trackHygiene(page);
  const backend = await installMockBackend(page);
  backend.slotReflected = false;
  await plantSession(page);

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_waiting_entitlement", { waitUntil: "domcontentloaded" });

  // While the plan is reflected but the launch slot is not, the page must not
  // create early: the bounded poll exhausts into the waiting-entitlement
  // posture, mirrored in the pending banner and the recovery surface detail.
  const recoverySurface = page.locator('[data-slot="paid-first-agent-recovery"]');
  await expect(recoverySurface).toBeVisible({ timeout: 30_000 });
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await expect(refresh, "expected the pending banner's Refresh control once the bounded poll exhausts")
    .toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByLabel("Agent startup").getByText(WAITING_ENTITLEMENT_MESSAGE, { exact: true }),
    "expected the recovery surface to carry the truthful waiting-entitlement detail",
  ).toBeVisible();
  await page.waitForTimeout(2_000);
  expect(backend.counters.createCount, "no agent may be created before the purchased slot reflects").toBe(0);

  // The slot finally lands; the banner's Refresh is a real keyboard-operable
  // button: focus it and activate with Enter, exactly as a keyboard-only user.
  backend.slotReflected = true;
  const summaryReadsBefore = backend.counters.summaryGetCount;
  await refresh.focus();
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim())).toBe("Refresh");
  await page.keyboard.press("Enter");

  await expect.poll(() => backend.counters.summaryGetCount, { timeout: 30_000 }).toBeGreaterThan(summaryReadsBefore);
  await expect.poll(() => backend.counters.createCount, { timeout: 60_000 }).toBe(1);
  await expect.poll(() => backend.counters.startCount, { timeout: 45_000 }).toBe(1);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY), { timeout: 30_000 }).toBeNull();
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY), { timeout: 30_000 }).toBeNull();
  await expect(recoverySurface).toHaveCount(0);

  expectCleanHygiene(hygiene);
});

test("surfaces the terminal start failure after a successful recovery create without duplicating the launch", async ({ page }) => {
  test.setTimeout(150_000);
  const hygiene = trackHygiene(page);
  const backend = await installMockBackend(page);
  backend.failStartWith = { status: 500, body: { detail: "hypervisor refused the start" } };
  await plantSession(page);

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_start_fails", { waitUntil: "domcontentloaded" });

  await expect.poll(() => backend.counters.createCount, { timeout: 60_000 }).toBe(1);
  await expect.poll(() => backend.counters.startCount, { timeout: 60_000 }).toBe(1);

  // The create succeeded but the explicit start did not: the failure must be
  // actionable and terminal, not hidden by retry. Exactly-once holds even as
  // roster/enrichment polling continues against the partially launched agent.
  const errorBanner = page.getByTestId("agent-error-banner");
  await expect(errorBanner).toBeVisible({ timeout: 30_000 });
  await expect(errorBanner).toContainText("hypervisor refused the start");
  await page.waitForTimeout(4_000);
  expect(backend.counters.createCount, "a failed start must never replay the create").toBe(1);
  expect(backend.counters.startCount, "a failed start must not retry in a storm").toBe(1);
  expect(
    hygiene.pageErrors,
    describeHygiene(hygiene),
  ).toEqual([]);
  expect(hygiene.consoleWarnings, describeHygiene(hygiene)).toEqual([]);
  // The only tolerated transport failure is the single intentionally failed start.
  for (const entry of hygiene.failedRequests) {
    expect(entry, describeHygiene(hygiene)).toContain("/start");
  }
});

test("settles the paid-first recovery with a clean console and no failed app requests", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const hygiene = trackHygiene(page);
  const backend = await installMockBackend(page);
  backend.holdReadPath = ".openclaw/workspace/BOOTSTRAP.md";
  await plantSession(page);

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_hygiene", { waitUntil: "domcontentloaded" });

  await expect.poll(() => backend.counters.createCount, { timeout: 60_000 }).toBe(1);
  await expect.poll(() => backend.stagingEvents.at(-1), { timeout: 45_000 })
    .toBe("read:.openclaw/workspace/BOOTSTRAP.md");
  expect(backend.counters.startCount, "START must wait for the final Reef response body").toBe(0);
  backend.releaseRead();
  await expect.poll(() => backend.counters.startCount, { timeout: 45_000 }).toBe(1);
  // The deterministic starter pack stages through Reef alongside the start.
  await expect.poll(() => Object.keys(backend.writtenFiles).length, { timeout: 45_000 }).toBe(STAGED_FILE_PATHS.length);
  expect(backend.stagingEvents).toEqual([
    ...STAGED_FILE_PATHS.flatMap((filePath) => [`write:${filePath}`, `read:${filePath}`]),
    `delete:${OPENCLAW_CONFIG_PATH}`,
    "start",
  ]);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY), { timeout: 30_000 }).toBeNull();
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY), { timeout: 30_000 }).toBeNull();
  await page.waitForTimeout(2_000);

  expectCleanHygiene(hygiene);
});

test("recovers the paid-first launch even while the plan catalog is unavailable", async ({ page }) => {
  test.setTimeout(120_000);
  const hygiene = trackHygiene(page);
  const backend = await installMockBackend(page);
  backend.failPlansCatalog = true;
  await plantSession(page);

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_catalog_down", { waitUntil: "domcontentloaded" });

  // A partial enrichment (catalog 500) must not block or break the already-paid
  // recovery: reflection reads the subscription summary/budget, and the launch
  // completes exactly once with the draft and checkout correlation consumed.
  await expect.poll(() => backend.counters.createCount, { timeout: 60_000 }).toBe(1);
  await expect.poll(() => backend.counters.startCount, { timeout: 45_000 }).toBe(1);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY), { timeout: 30_000 }).toBeNull();
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY), { timeout: 30_000 }).toBeNull();
  await expect(page.getByTestId("agent-error-banner")).toHaveCount(0);

  expect(hygiene.pageErrors, describeHygiene(hygiene)).toEqual([]);
  expect(hygiene.consoleWarnings, describeHygiene(hygiene)).toEqual([]);
  // The catalog endpoint is the only transport allowed to fail in this scenario.
  for (const entry of hygiene.failedRequests) {
    expect(entry, describeHygiene(hygiene)).toContain("/agents/plans");
  }
  // Browser resource-load console errors mirror the intentional 500s; any other
  // console error (page scripts, WS noise) remains a hygiene violation.
  for (const entry of hygiene.consoleErrors) {
    expect(entry, describeHygiene(hygiene)).toMatch(/^Failed to load resource: the server responded with a status of 500/);
  }
});
