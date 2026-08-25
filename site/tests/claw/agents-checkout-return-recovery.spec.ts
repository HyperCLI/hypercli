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

const FEAT_APP_BASE_URL = "https://agents.feat.hypercli.com";
{
  const configured = (process.env.TEST_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured !== FEAT_APP_BASE_URL) {
    throw new Error(
      `Checkout-return recovery coverage is feat-only; TEST_BASE_URL must be ${FEAT_APP_BASE_URL}, got ${configured || "<missing>"}.`,
    );
  }
}

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const TEST_PRINCIPAL_ID = "stored-session";
const TEST_SETUP_ID = "setup-checkout-recovery";
const TEST_WORKSPACE_ID = "workspace-checkout-recovery";
const PENDING_CHECKOUT_KEY = `hyperclaw.pendingPlanCheckout.v1:${encodeURIComponent(TEST_PRINCIPAL_ID)}`;
const FOREIGN_PENDING_CHECKOUT_KEY = `hyperclaw.pendingPlanCheckout.v1:${encodeURIComponent("other-principal")}`;
const FIRST_AGENT_DRAFT_KEY = "hypercli-first-agent-draft";

const CANCELLED_BANNER = "Checkout cancelled. No plan changes were made.";
const PENDING_BANNER = "Payment succeeded. Billing is still updating, so this page will keep showing the latest plan data.";

interface PlantOptions {
  pending?: Record<string, unknown> | null;
  foreignPendingRaw?: string | null;
  draft?: Record<string, unknown> | null;
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
  const { pending = null, foreignPendingRaw = null, draft = null, corruptPendingRaw = null } = options;
  await page.context().addCookies([{
    name: "auth_token",
    value: TEST_JWT,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }]);
  await page.addInitScript(({ token, pendingKey, foreignKey, draftKey, pendingValue, foreignValue, draftValue, corruptValue }) => {
    window.localStorage.setItem("claw_auth_token", token);
    if (pendingValue) window.localStorage.setItem(pendingKey, pendingValue);
    if (foreignValue) window.localStorage.setItem(foreignKey, foreignValue);
    if (corruptValue) window.localStorage.setItem(pendingKey, corruptValue);
    if (draftValue) window.sessionStorage.setItem(draftKey, draftValue);
  }, {
    token: TEST_JWT,
    pendingKey: PENDING_CHECKOUT_KEY,
    foreignKey: FOREIGN_PENDING_CHECKOUT_KEY,
    draftKey: FIRST_AGENT_DRAFT_KEY,
    pendingValue: pending ? JSON.stringify(pending) : null,
    foreignValue: foreignPendingRaw,
    draftValue: draft ? JSON.stringify(draft) : null,
    corruptValue: corruptPendingRaw,
  });
}

interface MockControls {
  readonly counters: { createCount: number; startCount: number; listGetCount: number; summaryGetCount: number };
  readonly writtenFiles: Record<string, string>;
  failCreateWith: { status: number; body: Record<string, unknown> } | null;
  holdCreateResponse: boolean;
  releaseCreate: () => void;
  holdListResponse: boolean;
  releaseList: () => void;
  reflected: boolean;
  pageCreatedAgent: () => Record<string, unknown> | null;
}

/** A faithful current-contract backend: stopped create, Reef file staging, one explicit start. */
async function installMockBackend(page: Page): Promise<MockControls> {
  const counters = { createCount: 0, startCount: 0, listGetCount: 0, summaryGetCount: 0 };
  const writtenFiles: Record<string, string> = {};
  let createdAgent: Record<string, unknown> | null = null;

  const controls: MockControls = {
    counters,
    writtenFiles,
    failCreateWith: null,
    holdCreateResponse: false,
    releaseCreate: () => {},
    holdListResponse: false,
    releaseList: () => {},
    reflected: true,
    pageCreatedAgent: () => createdAgent,
  };
  const createGate: Array<() => void> = [];
  controls.releaseCreate = () => { for (const release of createGate.splice(0)) release(); };
  const listGate: Array<() => void> = [];
  controls.releaseList = () => { for (const release of listGate.splice(0)) release(); };

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

    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      counters.listGetCount += 1;
      if (controls.holdListResponse) {
        await new Promise<void>((resolve) => listGate.push(resolve));
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createdAgent ? [createdAgent] : []),
      });
      return;
    }
    if (pathName.endsWith("/agents/deployments") && method === "POST") {
      counters.createCount += 1;
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
        name: "recovery-agent",
        handle: "recovery-agent",
        user_id: TEST_PRINCIPAL_ID,
        state: "STARTING",
        cpu: 4,
        memory: 4,
        hostname: "recovery-agent.hypercli.app",
        created_at: "2026-08-25T00:00:00Z",
        updated_at: "2026-08-25T00:00:00Z",
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
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent) });
      return;
    }
    if (createdAgent && method === "GET" && pathName.endsWith(`/agents/deployments/${createdAgent.id}`)) {
      if (createdAgent.state === "STARTING") createdAgent = { ...createdAgent, state: "STOPPED" };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent) });
      return;
    }
    if (createdAgent && pathName.includes(`/agents/deployments/${createdAgent.id}/start`)) {
      counters.startCount += 1;
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
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reflected ? {
          id: "pro",
          name: "Pro",
          pooled_tpd: 250000000,
          slot_inventory: { large: { granted: 1, used: 0, available: 1 } },
        } : {}),
      });
      return;
    }
    if (pathName.endsWith("/agents/subscriptions/summary")) {
      counters.summaryGetCount += 1;
      const reflected = controls.reflected;
      const slotInventory = { large: { granted: reflected ? 1 : 0, used: 0, available: reflected ? 1 : 0 } };
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
    if (route.request().method() === "PUT") {
      const pathName = new URL(route.request().url()).pathname;
      const fileName = ["AGENTS.md", "SOUL.md", "USER.md"].find((name) => pathName.includes(name));
      const content = route.request().postDataBuffer()?.toString("utf8") ?? "";
      if (fileName) writtenFiles[fileName] = content;
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

  // The draft is preserved and the user is handed straight back to it, narrow viewport included.
  const summary = page.locator('[data-slot="saved-agent-draft-summary"]');
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Your agent has a head start." })).toBeVisible();
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

  // The terminal failure is surfaced where the user can act, the attempt is not
  // silently duplicated, and the draft persists for the resumed launcher.
  const errorBanner = page.getByTestId("agent-error-banner");
  await expect(errorBanner).toBeVisible({ timeout: 30_000 });
  await expect(errorBanner).toContainText("deployment registry exploded");
  await expect(page.locator('[data-slot="saved-agent-draft-summary"]')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY)).toContain("recovery-agent");
  await page.waitForTimeout(3_000);
  expect(backend.counters.createCount).toBe(1);
  expect(backend.counters.startCount).toBe(0);
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

  backend.holdCreateResponse = true;
  await page.goto("/dashboard/agents?checkout=success&session_id=cs_midcreate_reload", { waitUntil: "domcontentloaded" });
  await expect.poll(() => backend.counters.createCount, { timeout: 45_000 }).toBe(1);

  // The user reloads while the create request is in flight: the client aborts,
  // but the backend may still commit. Hold the fresh roster read until the
  // commit lands so the page can reconcile by the saved draft name.
  const listReadsBeforeReload = backend.counters.listGetCount;
  backend.holdListResponse = true;
  await page.goto("/dashboard/agents?checkout=success&session_id=cs_midcreate_reload", { waitUntil: "domcontentloaded" });
  await expect.poll(() => backend.counters.listGetCount, { timeout: 30_000 }).toBeGreaterThan(listReadsBeforeReload);
  backend.releaseCreate();
  backend.releaseList();
  backend.holdListResponse = false;

  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY), { timeout: 60_000 }).toBeNull();
  expect(backend.counters.createCount).toBe(1);
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), FIRST_AGENT_DRAFT_KEY), { timeout: 30_000 }).toBeNull();
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
