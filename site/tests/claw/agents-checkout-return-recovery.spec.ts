import { expect, test, type Page } from "@playwright/test";

/**
 * Fresh-account checkout-return recovery, deterministically.
 *
 * agents-paid-first-launch.spec.ts proves the happy paid-first recovery path.
 * This spec exercises the adversarial boundary that path must survive without
 * new product behavior: duplicate/malformed/cross-principal Stripe returns,
 * cancellation resume, stale drafts, create failures, mid-create reloads, and
 * exhausted reflection polling with manual retry. Every scenario drives the
 * real page composition against a mocked backend and asserts exactly-once
 * creation, persisted-state hygiene, and zero uncaught page errors.
 */

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const TEST_PRINCIPAL_ID = "stored-session";
const TEST_SETUP_ID = "setup-checkout-recovery";
const FIRST_AGENT_SETUP_TAG = `first_agent_setup=${Buffer.from(TEST_SETUP_ID, "utf8").toString("hex")}`;
const TEST_WORKSPACE_ID = "workspace-checkout-recovery";
const PENDING_CHECKOUT_KEY = `hyperclaw.pendingPlanCheckout.v1:${encodeURIComponent(TEST_PRINCIPAL_ID)}`;
const FOREIGN_PENDING_CHECKOUT_KEY = `hyperclaw.pendingPlanCheckout.v1:${encodeURIComponent("other-principal")}`;
const FIRST_AGENT_DRAFT_KEY = "hypercli-first-agent-draft";
const FIRST_AGENT_CHECKOUT_DRAFT_KEY = `hyperclaw.firstAgentCheckoutDraft.v1:${encodeURIComponent(TEST_PRINCIPAL_ID)}:${encodeURIComponent(TEST_SETUP_ID)}`;
const OPENCLAW_CONFIG_PATH = ".openclaw/openclaw.json";
const STAGED_FILE_PATHS = [
  ".openclaw/workspace/AGENTS.md",
  ".openclaw/workspace/SOUL.md",
  ".openclaw/workspace/IDENTITY.md",
  ".openclaw/workspace/USER.md",
  ".openclaw/workspace/BOOTSTRAP.md",
] as const;

const CANCELLED_BANNER = "Checkout cancelled. No plan changes were made.";
const PENDING_BANNER = "Payment succeeded. Billing is still updating, so this page will keep showing the latest plan data.";

interface PlantOptions {
  pending?: Record<string, unknown> | null;
  foreignPendingRaw?: string | null;
  draft?: Record<string, unknown> | null;
  checkoutDraft?: Record<string, unknown> | null;
  corruptPendingRaw?: string | null;
}

function pendingCheckout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...overrides,
  };
}

function firstAgentDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "first-agent-setup",
    setupId: TEST_SETUP_ID,
    principalId: TEST_PRINCIPAL_ID,
    workspaceId: TEST_WORKSPACE_ID,
    name: "recovery-agent",
    displayName: "Recovery Agent",
    description: "Saved recovery setup",
    size: "large",
    iconIndex: 7,
    category: "Ops",
    plan: "pro",
    enableDesktop: false,
    enableMemoryIndex: false,
    enableCustomImage: false,
    customImage: "",
    updatedAt: 1,
    ...overrides,
  };
}

/** Plant the stored session and any persisted checkout/draft state before the app boots. */
async function plantSession(page: Page, options: PlantOptions = {}): Promise<void> {
  const { pending = null, foreignPendingRaw = null, draft = null, checkoutDraft = null, corruptPendingRaw = null } = options;
  await page.context().addCookies([{
    name: "auth_token",
    value: TEST_JWT,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }]);
  await page.addInitScript(({ token, pendingKey, foreignKey, draftKey, checkoutDraftKey, pendingValue, foreignValue, draftValue, checkoutDraftValue, corruptValue }) => {
    window.localStorage.setItem("claw_auth_token", token);
    if (pendingValue) window.localStorage.setItem(pendingKey, pendingValue);
    if (foreignValue) window.localStorage.setItem(foreignKey, foreignValue);
    if (corruptValue) window.localStorage.setItem(pendingKey, corruptValue);
    if (draftValue) window.sessionStorage.setItem(draftKey, draftValue);
    if (checkoutDraftValue) window.localStorage.setItem(checkoutDraftKey, checkoutDraftValue);
  }, {
    token: TEST_JWT,
    pendingKey: PENDING_CHECKOUT_KEY,
    foreignKey: FOREIGN_PENDING_CHECKOUT_KEY,
    draftKey: FIRST_AGENT_DRAFT_KEY,
    checkoutDraftKey: FIRST_AGENT_CHECKOUT_DRAFT_KEY,
    pendingValue: pending ? JSON.stringify(pending) : null,
    foreignValue: foreignPendingRaw,
    draftValue: draft ? JSON.stringify(draft) : null,
    checkoutDraftValue: checkoutDraft ? JSON.stringify(checkoutDraft) : null,
    corruptValue: corruptPendingRaw,
  });
}

interface MockControls {
  readonly counters: { createCount: number; startCount: number; listGetCount: number; summaryGetCount: number; slackPatchCount: number };
  readonly writtenFiles: Record<string, Buffer>;
  readonly stagingEvents: string[];
  failCreateWith: { status: number; body: Record<string, unknown> } | null;
  failCreateAfterCommitWith: { status: number; body: Record<string, unknown> } | null;
  holdCreateResponse: boolean;
  releaseCreate: () => void;
  revealCreatedAgent: boolean;
  includeUnrelatedSameNameAgent: boolean;
  slackConnected: boolean;
  reflected: boolean;
  createdAgentName: string;
  pageCreatedAgent: () => Record<string, unknown> | null;
}

/** A faithful current-contract backend: stopped create, Reef file staging, one explicit start. */
async function installMockBackend(page: Page): Promise<MockControls> {
  const counters = { createCount: 0, startCount: 0, listGetCount: 0, summaryGetCount: 0, slackPatchCount: 0 };
  const writtenFiles: Record<string, Buffer> = {};
  const stagingEvents: string[] = [];
  let createdAgent: Record<string, unknown> | null = null;

  const controls: MockControls = {
    counters,
    writtenFiles,
    stagingEvents,
    failCreateWith: null,
    failCreateAfterCommitWith: null,
    holdCreateResponse: false,
    releaseCreate: () => {},
    revealCreatedAgent: true,
    includeUnrelatedSameNameAgent: false,
    slackConnected: false,
    reflected: true,
    createdAgentName: "recovery-agent",
    pageCreatedAgent: () => createdAgent,
  };
  const unrelatedSameNameAgent = {
    id: "agent-unrelated-same-name",
    name: "recovery-agent",
    handle: "recovery-agent-existing",
    user_id: TEST_PRINCIPAL_ID,
    state: "RUNNING",
    runtime: "openclaw",
    managed: true,
    is_launchable: true,
    cpu: 4,
    memory: 4,
    hostname: "recovery-agent-existing.hypercli.app",
    created_at: "2026-08-24T00:00:00Z",
    updated_at: "2026-08-24T00:00:00Z",
    tags: [`first_agent_setup=${Buffer.from("another-setup", "utf8").toString("hex")}`],
    launch_config: {
      config: {},
      image: "ghcr.io/hypercli/hypercli-openclaw:pro-latest",
      env: {},
      routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
      command: [],
      entrypoint: [],
      restart: false,
      sync_root: "/home/node",
      runtime_scopes: ["models:*"],
    },
  };
  const createGate: Array<() => void> = [];
  controls.releaseCreate = () => { for (const release of createGate.splice(0)) release(); };

  await page.route(/\/workspaces(?:\/.*)?$/, async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const generalWorkspace = { id: "workspace-general", name: "General", slug: "general", display_name: "General", role: "admin" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pathName.endsWith("/agents") || pathName.endsWith("/grants") ? [] : [generalWorkspace]),
    });
  });
  await page.route(/\/slack\/install(?:\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connected: controls.slackConnected,
        team_id: controls.slackConnected ? "T_RECOVERY" : null,
        team_name: controls.slackConnected ? "Recovery Workspace" : null,
      }),
    });
  });

  await page.route("**/agents/**", async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const method = route.request().method();

    if (!pathName.startsWith("/agents/")) {
      await route.fallback();
      return;
    }

    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      counters.listGetCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          ...(controls.includeUnrelatedSameNameAgent ? [unrelatedSameNameAgent] : []),
          ...(controls.revealCreatedAgent && createdAgent ? [createdAgent] : []),
        ]),
      });
      return;
    }
    if (pathName.endsWith("/agents/deployments") && method === "POST") {
      counters.createCount += 1;
      const createBody = route.request().postDataJSON() as Record<string, unknown>;
      expect(createBody.tags).toEqual([FIRST_AGENT_SETUP_TAG]);
      if (counters.createCount > 1) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ detail: "duplicate recovery create" }),
        });
        return;
      }
      if (controls.failCreateWith) {
        await route.fulfill({
          status: controls.failCreateWith.status,
          contentType: "application/json",
          body: JSON.stringify(controls.failCreateWith.body),
        });
        return;
      }
      if (controls.holdCreateResponse) {
        await new Promise<void>((resolve) => createGate.push(resolve));
      }
      createdAgent = {
        id: "agent-recovery",
        name: controls.createdAgentName,
        handle: "recovery-agent",
        user_id: TEST_PRINCIPAL_ID,
        state: "STARTING",
        runtime: "openclaw",
        managed: true,
        is_launchable: true,
        cpu: 4,
        memory: 4,
        hostname: "recovery-agent.hypercli.app",
        created_at: "2026-08-25T00:00:00Z",
        updated_at: "2026-08-25T00:00:00Z",
        tags: createBody.tags,
        launch_config: {
          config: {},
          image: "ghcr.io/hypercli/hypercli-openclaw:pro-latest",
          env: {},
          secrets: { OPENCLAW_GATEWAY_TOKEN: "gw-token-recovery" },
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
      if (controls.failCreateAfterCommitWith) {
        await route.fulfill({
          status: controls.failCreateAfterCommitWith.status,
          contentType: "application/json",
          body: JSON.stringify(controls.failCreateAfterCommitWith.body),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent) });
      return;
    }
    if (createdAgent && method === "GET" && pathName.endsWith(`/agents/deployments/${createdAgent.id}`)) {
      if (createdAgent.state === "STARTING") createdAgent = { ...createdAgent, state: "STOPPED" };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent) });
      return;
    }
    if (createdAgent && method === "PATCH" && pathName.endsWith(`/agents/deployments/${createdAgent.id}`)) {
      const updateBody = route.request().postDataJSON() as Record<string, unknown>;
      counters.slackPatchCount += 1;
      stagingEvents.push("slack-patch");
      createdAgent = { ...createdAgent, launch_config: updateBody.launch_config };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent) });
      return;
    }
    if (method === "POST" && pathName.endsWith(`/agents/deployments/${createdAgent?.id ?? "?"}/files/token`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "reef-token-recovery",
          url: "https://reef.test/_reef",
          expires_at: "2026-12-31T00:00:00Z",
        }),
      });
      return;
    }
    if (createdAgent && method === "POST" && pathName.endsWith(`/agents/deployments/${createdAgent.id}/start`)) {
      counters.startCount += 1;
      stagingEvents.push("start");
      createdAgent = { ...createdAgent, state: "RUNNING" };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent) });
      return;
    }
    if (pathName.endsWith("/agents/plans")) {
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
      const reflected = controls.reflected;
      const available = createdAgent ? 0 : 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reflected ? {
          id: "pro",
          name: "Pro",
          pooled_tpd: 250000000,
          slot_inventory: { large: { granted: 1, used: createdAgent ? 1 : 0, available } },
        } : {}),
      });
      return;
    }
    if (pathName.endsWith("/agents/subscriptions/summary")) {
      counters.summaryGetCount += 1;
      const reflected = controls.reflected;
      const slotInventory = {
        large: {
          granted: reflected ? 1 : 0,
          used: reflected && createdAgent ? 1 : 0,
          available: reflected && !createdAgent ? 1 : 0,
        },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reflected ? {
          effective_plan_id: "pro",
          current_subscription_id: "sub-pro",
          pooled_tpd: 250000000,
          slot_inventory: slotInventory,
          active_subscription_count: 1,
          active_entitlement_count: 1,
          entitlements: {
            effective_plan_id: "pro",
            active_entitlement_count: 1,
            slot_inventory: slotInventory,
          },
          active_subscriptions: [{ id: "sub-pro", plan_id: "pro", plan_name: "Pro", quantity: 1, status: "active" }],
          subscriptions: [],
          user: { id: TEST_PRINCIPAL_ID },
        } : {
          pooled_tpd: 0,
          slot_inventory: {},
          active_subscription_count: 0,
          active_entitlement_count: 0,
          active_subscriptions: [],
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

  await page.route(/^https:\/\/reef\.test\//, async (route) => {
    const request = route.request();
    const pathName = new URL(request.url()).pathname;
    const fileMarker = "/files/";
    const markerIndex = pathName.indexOf(fileMarker);
    expect(pathName.startsWith("/_reef/files/")).toBe(true);
    expect(request.headers().authorization).toBe("Bearer reef-token-recovery");
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
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: writtenFiles[filePath] ?? Buffer.alloc(0),
      });
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

function trackPageErrors(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  return pageErrors;
}

test("leaves another principal's pending checkout and draft untouched", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = trackPageErrors(page);
  const backend = await installMockBackend(page);
  await plantSession(page, {
    foreignPendingRaw: JSON.stringify(pendingCheckout({ principalId: "other-principal" })),
    draft: firstAgentDraft({ principalId: "other-principal" }),
  });

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_not_mine", { waitUntil: "domcontentloaded" });

  // The foreign return never engages recovery: no recovery surface survives and no create fires.
  await expect(page.locator('[data-slot="paid-first-agent-recovery"]')).toHaveCount(0);
  await page.waitForFunction(() => !window.location.search.includes("checkout="), null, { timeout: 30_000 });
  // Recovery would have fully settled by now; create must never have fired.
  await page.waitForTimeout(2_000);
  expect(backend.counters.createCount).toBe(0);

  // Cross-principal hygiene: the other principal's checkout correlation and draft survive untouched.
  expect(await page.evaluate((key) => window.localStorage.getItem(key), FOREIGN_PENDING_CHECKOUT_KEY)).toContain("other-principal");
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY)).toContain("recovery-agent");
  expect(pageErrors).toEqual([]);
});

test("recovers inertly from corrupt persisted checkout state", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = trackPageErrors(page);
  const backend = await installMockBackend(page);
  await plantSession(page, {
    corruptPendingRaw: "{not-json",
    draft: firstAgentDraft(),
  });

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_corrupt", { waitUntil: "domcontentloaded" });

  await expect(page.locator('[data-slot="paid-first-agent-recovery"]')).toHaveCount(0);
  await page.waitForFunction(() => !window.location.search.includes("checkout="), null, { timeout: 30_000 });
  await page.waitForTimeout(2_000);
  expect(backend.counters.createCount).toBe(0);
  // Corrupt bytes are left in place — never a destructive surprise — and the saved draft survives.
  expect(await page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY)).toBe("{not-json");
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY)).toContain("recovery-agent");
  expect(pageErrors).toEqual([]);
});

test("resumes the saved draft launcher when checkout is cancelled", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const pageErrors = trackPageErrors(page);
  const backend = await installMockBackend(page);
  await plantSession(page, {
    pending: pendingCheckout(),
    draft: firstAgentDraft(),
  });

  await page.goto("/dashboard/agents?checkout=cancelled", { waitUntil: "domcontentloaded" });

  await expect(page.getByText(CANCELLED_BANNER, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY)).toBeNull();
  expect(backend.counters.createCount).toBe(0);

  // The draft is preserved and the user is handed straight back to its launcher,
  // narrow viewport included. The exact restored substep is browser-state owned.
  await expect(page.getByTestId("agent-setup-wizard")).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY)).toContain("recovery-agent");
  expect(pageErrors).toEqual([]);
});

test("resumes the launcher without creating when the saved draft no longer matches the checkout", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = trackPageErrors(page);
  const backend = await installMockBackend(page);
  await plantSession(page, {
    pending: pendingCheckout({ setupId: "superseded-setup" }),
    draft: firstAgentDraft(),
  });

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_stale_draft", { waitUntil: "domcontentloaded" });

  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY), { timeout: 30_000 }).toBeNull();
  await page.waitForTimeout(2_000);
  expect(backend.counters.createCount).toBe(0);

  await expect(page.locator('[data-slot="saved-agent-draft-summary"]')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY)).toContain("recovery-agent");
  expect(pageErrors).toEqual([]);
});

test("creates from the durable checkout draft when the returning tab has no session draft", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = trackPageErrors(page);
  const backend = await installMockBackend(page);
  await plantSession(page, {
    pending: pendingCheckout(),
    checkoutDraft: firstAgentDraft(),
  });

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_replacement_tab", { waitUntil: "domcontentloaded" });

  await expect.poll(() => backend.counters.createCount, { timeout: 45_000 }).toBe(1);
  await expect.poll(() => backend.counters.startCount, { timeout: 45_000 }).toBe(1);
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY)).toBeNull();
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), FIRST_AGENT_CHECKOUT_DRAFT_KEY)).toBeNull();
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY)).toBeNull();
  expect(pageErrors).toEqual([]);
});

test("surfaces a create failure without losing the saved draft or duplicating the attempt", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = trackPageErrors(page);
  const backend = await installMockBackend(page);
  await plantSession(page, {
    pending: pendingCheckout(),
    draft: firstAgentDraft(),
  });
  backend.failCreateWith = { status: 500, body: { detail: "deployment registry exploded" } };

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_create_fails", { waitUntil: "domcontentloaded" });

  await expect.poll(() => backend.counters.createCount, { timeout: 45_000 }).toBe(1);

  // The failure is surfaced where the user can act, the attempt is not
  // silently duplicated, and the saved checkout remains explicitly retryable.
  const errorBanner = page.getByTestId("agent-error-banner");
  await expect(errorBanner).toBeVisible({ timeout: 30_000 });
  await expect(errorBanner).toContainText("deployment registry exploded");
  await expect(page.locator('[data-slot="paid-first-agent-recovery"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY)).toContain("recovery-agent");
  expect(await page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY)).toContain(TEST_SETUP_ID);
  await page.waitForTimeout(3_000);
  expect(backend.counters.createCount).toBe(1);
  expect(backend.counters.startCount).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("recovers a committed Agent after its create response fails without creating twice", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = trackPageErrors(page);
  const backend = await installMockBackend(page);
  backend.revealCreatedAgent = false;
  backend.slackConnected = true;
  backend.failCreateAfterCommitWith = { status: 500, body: { detail: "create response was lost" } };
  await plantSession(page, {
    pending: pendingCheckout(),
    draft: firstAgentDraft(),
  });

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_committed_create_fails", { waitUntil: "domcontentloaded" });

  await expect.poll(() => backend.counters.createCount, { timeout: 45_000 }).toBe(1);
  await expect(page.getByTestId("agent-error-banner")).toContainText("create response was lost", { timeout: 30_000 });
  await expect(page.locator('[data-slot="paid-first-agent-recovery"]')).toBeVisible({ timeout: 30_000 });
  expect(backend.counters.startCount).toBe(0);

  backend.revealCreatedAgent = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();

  await expect.poll(() => backend.counters.startCount, { timeout: 60_000 }).toBe(1);
  expect(backend.counters.createCount, "recovery must use the committed tagged Agent").toBe(1);
  expect(backend.counters.slackPatchCount, "recovery must finish SDK-owned post-create config").toBe(1);
  expect(backend.stagingEvents).toEqual([
    "slack-patch",
    ...STAGED_FILE_PATHS.flatMap((filePath) => [`write:${filePath}`, `read:${filePath}`]),
    `delete:${OPENCLAW_CONFIG_PATH}`,
    "start",
  ]);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY)).toBeNull();
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY)).toBeNull();
  expect(pageErrors).toEqual([]);
});

test("does not create twice when the settled Stripe return URL is revisited", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = trackPageErrors(page);
  const backend = await installMockBackend(page);
  await plantSession(page, {
    pending: pendingCheckout(),
    draft: firstAgentDraft(),
  });

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_duplicate_visit", { waitUntil: "domcontentloaded" });
  await expect.poll(() => backend.counters.createCount, { timeout: 45_000 }).toBe(1);
  await expect.poll(() => backend.counters.startCount, { timeout: 45_000 }).toBe(1);
  expect(Object.keys(backend.writtenFiles).sort()).toEqual([...STAGED_FILE_PATHS].sort());
  expect(backend.stagingEvents).toEqual([
    ...STAGED_FILE_PATHS.flatMap((filePath) => [`write:${filePath}`, `read:${filePath}`]),
    `delete:${OPENCLAW_CONFIG_PATH}`,
    "start",
  ]);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY), { timeout: 30_000 }).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.has("checkout"), { timeout: 30_000 }).toBe(false);

  // Reloading or bookmarking the consumed return URL must be a no-op.
  await page.goto("/dashboard/agents?checkout=success&session_id=cs_duplicate_visit", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !window.location.search.includes("checkout="), null, { timeout: 30_000 });
  await page.waitForTimeout(2_000);
  expect(backend.counters.createCount).toBe(1);
  expect(backend.counters.startCount).toBe(1);
  expect(pageErrors).toEqual([]);
});

test("reconciles the already-created agent instead of duplicating it after a mid-create reload", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = trackPageErrors(page);
  const backend = await installMockBackend(page);
  await plantSession(page, {
    pending: pendingCheckout(),
    draft: firstAgentDraft(),
  });

  backend.includeUnrelatedSameNameAgent = true;
  backend.holdCreateResponse = true;
  backend.createdAgentName = "recovery-agent-after-name-conflict";
  await page.goto("/dashboard/agents?checkout=success&session_id=cs_midcreate_reload", { waitUntil: "domcontentloaded" });
  await expect.poll(() => backend.counters.createCount, { timeout: 45_000 }).toBe(1);

  // The user reloads while the create request is in flight: the client aborts,
  // but the backend may still commit. The fresh roster first returns without
  // that commit; the persisted submission fence must prevent a second POST and
  // ignore the unrelated same-name Agent until Refresh sees the setup marker.
  const listReadsBeforeReload = backend.counters.listGetCount;
  await page.goto("/dashboard/agents?checkout=success&session_id=cs_midcreate_reload", { waitUntil: "domcontentloaded" });
  await expect.poll(() => backend.counters.listGetCount, { timeout: 30_000 }).toBeGreaterThan(listReadsBeforeReload);
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await expect(refresh).toBeVisible({ timeout: 30_000 });
  expect(backend.counters.createCount).toBe(1);

  backend.releaseCreate();
  await refresh.click();

  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY), { timeout: 60_000 }).toBeNull();
  expect(backend.counters.createCount).toBe(1);
  await expect.poll(() => backend.counters.startCount, { timeout: 45_000 }).toBe(1);
  expect(backend.stagingEvents).toEqual([
    ...STAGED_FILE_PATHS.flatMap((filePath) => [`write:${filePath}`, `read:${filePath}`]),
    `delete:${OPENCLAW_CONFIG_PATH}`,
    "start",
  ]);
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY), { timeout: 30_000 }).toBeNull();
  expect(backend.counters.createCount).toBe(1);
  expect(pageErrors).toEqual([]);
});

test("keeps waiting truthfully and recovers through the manual refresh once reflection lands", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = trackPageErrors(page);
  const backend = await installMockBackend(page);
  backend.reflected = false;
  await plantSession(page, {
    pending: pendingCheckout(),
    draft: firstAgentDraft(),
  });

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_delayed", { waitUntil: "domcontentloaded" });

  // The bounded reflection poll exhausts without hiding the state: the recovery
  // surface stays in waiting posture and the pending banner offers a retry path.
  await expect(page.locator('[data-slot="paid-first-agent-recovery"]')).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByLabel("Agent startup").getByText(PENDING_BANNER, { exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await expect(refresh).toBeVisible();

  const summaryReadsBeforeRefresh = backend.counters.summaryGetCount;
  backend.reflected = true;
  await refresh.click();

  await expect.poll(() => backend.counters.summaryGetCount, { timeout: 30_000 }).toBeGreaterThan(summaryReadsBeforeRefresh);
  await expect.poll(() => backend.counters.createCount, { timeout: 60_000 }).toBe(1);
  await expect.poll(() => backend.counters.startCount, { timeout: 45_000 }).toBe(1);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY), { timeout: 30_000 }).toBeNull();
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY), { timeout: 30_000 }).toBeNull();
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY)).toBeNull();
  expect(pageErrors).toEqual([]);
});
