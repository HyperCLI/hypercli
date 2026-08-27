import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const TEST_PRINCIPAL_ID = "stored-session";
const TEST_WORKSPACE_ID = "workspace-paid-first-agent";
const TEST_SETUP_ID = "setup-paid-first-agent";
const FIRST_AGENT_SETUP_TAG = `first_agent_setup=${Buffer.from(TEST_SETUP_ID, "utf8").toString("hex")}`;
const PENDING_CHECKOUT_KEY = `hyperclaw.pendingPlanCheckout.v1:${encodeURIComponent(TEST_PRINCIPAL_ID)}`;
const OPENCLAW_CONFIG_PATH = ".openclaw/openclaw.json";
const STAGED_FILE_PATHS = [
  ".openclaw/workspace/AGENTS.md",
  ".openclaw/workspace/BOOTSTRAP.md",
] as const;
const PRESTART_CLEANUP_PATHS = [
  ".openclaw/workspace/SOUL.md",
  ".openclaw/workspace/IDENTITY.md",
  ".openclaw/workspace/USER.md",
  ".openclaw/workspace/MEMORY.md",
] as const;

test("creates the saved first agent after Stripe payment is reflected", async ({ page }) => {
  let createCount = 0;
  let startCount = 0;
  let createBody: Record<string, unknown> | null = null;
  let createdAgent: Record<string, unknown> | null = null;
  let purchasedSlotAvailable = false;
  const writtenFiles: Record<string, Buffer> = {};
  const stagingEvents: string[] = [];

  await page.context().addCookies([{
    name: "auth_token",
    value: TEST_JWT,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }]);

  await page.addInitScript(({ token, pendingKey, setupId, principalId, workspaceId }) => {
    const state = window as Window & { __sawPaidWorkspaceWelcome?: boolean };
    state.__sawPaidWorkspaceWelcome = false;
    const detectWelcome = () => {
      if (document.body?.textContent?.includes("Welcome to your Paid First Agent")) {
        state.__sawPaidWorkspaceWelcome = true;
      }
    };
    new MutationObserver(detectWelcome).observe(document, { childList: true, subtree: true, characterData: true });
    window.localStorage.setItem("claw_auth_token", token);
    window.localStorage.setItem(pendingKey, JSON.stringify({
      principalId,
      planId: "pro",
      planName: "Pro",
      ownedCount: 0,
      startedAt: 1,
      bundle: { large: 1 },
      baselineGrantedSlots: { large: 0 },
      flow: "first-agent-setup",
      setupId,
      workspaceId,
      agentSize: "large",
    }));
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      setupId,
      principalId,
      workspaceId,
      name: "paid-setup-agent",
      displayName: "Paid Setup Agent",
      description: "Saved paid setup",
      size: "large",
      iconIndex: 11,
      category: "Ops",
      plan: "pro",
      enableDesktop: false,
      // This spec's subject is the paid first-launch entitlement, not the
      // launch wizard, so it creates the Agent through the API on purpose.
      createVia: "api",
      enableMemoryIndex: true,
      enableCustomImage: false,
      customImage: "",
      bootstrapDraft: {
        version: 1,
        inputs: {
          agentName: "paid-setup-agent",
          purpose: "Coordinate the paid launch.",
          tone: "Direct and calm.",
          autonomy: "Proceed with reversible work.",
          escalation: "Ask before sensitive actions.",
          trustedSources: "Workspace files.",
          userName: "",
          timezone: "",
          companyRole: "",
          responseStyle: "Lead with the answer.",
          toolsNotes: "",
          includeMemory: false,
          memoryNotes: "",
        },
        files: [
          { name: "AGENTS.md", content: "# Paid setup instructions\n\nPreserve this saved file." },
          { name: "SOUL.md", content: "# Voice\n\nDirect and calm." },
          { name: "USER.md", content: "# User context\n\nUse workspace files." },
        ],
        generationSource: "deterministic",
      },
      updatedAt: Date.now(),
    }));
  }, {
    token: TEST_JWT,
    pendingKey: PENDING_CHECKOUT_KEY,
    setupId: TEST_SETUP_ID,
    principalId: TEST_PRINCIPAL_ID,
    workspaceId: TEST_WORKSPACE_ID,
  });

  await page.route(/\/workspaces(?:\/.*)?$/, async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const workspace = {
      id: TEST_WORKSPACE_ID,
      name: "Paid First Agent",
      slug: TEST_WORKSPACE_ID,
      display_name: "Paid First Agent",
      role: "admin",
    };
    const generalWorkspace = {
      id: "workspace-general",
      name: "General",
      slug: "general",
      display_name: "General",
      role: "admin",
    };

    if (pathName.endsWith(`/workspaces/${TEST_WORKSPACE_ID}/agents`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createdAgent ? [{
          workspace_id: TEST_WORKSPACE_ID,
          agent_id: createdAgent.id,
          role: "viewer",
          expires_at: null,
        }] : []),
      });
      return;
    }
    if (pathName.endsWith(`/workspaces/${TEST_WORKSPACE_ID}/grants`)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pathName.endsWith(`/workspaces/${TEST_WORKSPACE_ID}`) ? workspace : [workspace, generalWorkspace]),
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
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent ? [createdAgent] : []) });
      return;
    }
    if (pathName.endsWith("/agents/deployments") && method === "POST") {
      createCount += 1;
      createBody = route.request().postDataJSON();
      createdAgent = {
        id: "agent-paid-first",
        name: "paid-setup-agent",
        handle: "paid-setup-agent",
        user_id: TEST_PRINCIPAL_ID,
        state: "STARTING",
        cpu: 4,
        memory: 4,
        hostname: "paid-setup-agent.hypercli.app",
        created_at: "2026-07-30T00:00:00Z",
        updated_at: "2026-07-30T00:00:00Z",
        tags: Array.isArray(createBody?.tags) ? createBody.tags : [],
        // The explicit START replays this stored launch contract verbatim; the
        // complete owner-visible shape (with the gateway secret) is what the
        // page hands back. Mirrors agent-client.test.ts's fixture.
        launch_config: {
          config: {},
          image: "ghcr.io/hypercli/hypercli-openclaw:pro-latest",
          env: {},
          secrets: { OPENCLAW_GATEWAY_TOKEN: "gw-token-paid-first" },
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
    // Current lifecycle contract: create parks the deployment at STOPPED after
    // a short provisioning beat; the page observes that and issues one explicit
    // POST /start alongside bootstrap staging. The item GET models the poll.
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
          token: "reef-token-paid-first",
          url: "https://reef.test/_reef",
          expires_at: "2026-12-31T00:00:00Z",
        }),
      });
      return;
    }
    if (pathName.endsWith("/agents/plans")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
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
      }) });
      return;
    }
    if (pathName.endsWith("/agents/plans/current")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        id: "pro",
        name: "Pro",
        pooled_tpd: 250000000,
        slot_inventory: { large: { granted: 1, used: purchasedSlotAvailable ? 0 : 1, available: purchasedSlotAvailable ? 1 : 0 } },
      }) });
      return;
    }
    if (pathName.endsWith("/agents/subscriptions/summary")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        effective_plan_id: "pro",
        current_subscription_id: "sub-pro",
        pooled_tpd: 250000000,
        slot_inventory: { large: { granted: 1, used: purchasedSlotAvailable ? 0 : 1, available: purchasedSlotAvailable ? 1 : 0 } },
        active_subscription_count: 1,
        active_entitlement_count: 1,
        entitlements: {
          effective_plan_id: "pro",
          active_entitlement_count: 1,
          slot_inventory: { large: { granted: 1, used: purchasedSlotAvailable ? 0 : 1, available: purchasedSlotAvailable ? 1 : 0 } },
        },
        active_subscriptions: [{ id: "sub-pro", plan_id: "pro", plan_name: "Pro", quantity: 1, status: "active" }],
        subscriptions: [],
        user: { id: TEST_PRINCIPAL_ID },
      }) });
      return;
    }
    if (pathName.endsWith("/agents/usage/history")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ history: [] }) });
      return;
    }
    if (pathName.endsWith("/agents/types")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        types: [{ id: "large", name: "Large", cpu: 2, memory: 8 }],
        plans: [],
      }) });
      return;
    }
    if (createdAgent && method === "POST" && pathName.endsWith("/agents/deployments/agent-paid-first/start")) {
      startCount += 1;
      stagingEvents.push("start");
      createdAgent = { ...createdAgent, state: "RUNNING" };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent) });
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
    expect(request.headers().authorization).toBe("Bearer reef-token-paid-first");
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

  await page.goto("/dashboard/agents?checkout=success&session_id=cs_paid_first", { waitUntil: "domcontentloaded" });

  await expect(page.locator('[data-slot="paid-first-agent-recovery"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome to your Paid First Agent" })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(createCount).toBe(0);
  expect(await page.evaluate(() => (window as Window & { __sawPaidWorkspaceWelcome?: boolean }).__sawPaidWorkspaceWelcome)).toBe(false);
  purchasedSlotAvailable = true;
  await expect.poll(() => createCount, { timeout: 30_000 }).toBe(1);
  expect(createBody).toMatchObject({ name: "paid-setup-agent", handle: "paid-setup-agent", size: "large" });
  // Lifecycle contract: create delivers a stopped Agent and the page issues one
  // explicit start afterwards; the SDK create payload carries no `start` flag.
  expect(createBody && "start" in createBody).toBe(false);
  expect(createBody && "config" in createBody).toBe(false);
  expect(createBody?.meta).toMatchObject({ ui: { avatar: { icon_index: 11 } } });
  expect(createBody?.tags).toEqual([FIRST_AGENT_SETUP_TAG]);
  expect(createBody?.env).toMatchObject({ OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START: "1" });
  await expect.poll(() => writtenFiles[".openclaw/workspace/AGENTS.md"]?.toString("utf8") ?? "")
    .toContain("Preserve this saved file.");
  await expect.poll(() => startCount).toBe(1);
  expect(Object.keys(writtenFiles).sort()).toEqual([...STAGED_FILE_PATHS].sort());
  expect(stagingEvents).toEqual([
    ...STAGED_FILE_PATHS.flatMap((filePath) => [`write:${filePath}`, `read:${filePath}`]),
    `delete:${OPENCLAW_CONFIG_PATH}`,
    ...PRESTART_CLEANUP_PATHS.map((filePath) => `delete:${filePath}`),
    "start",
  ]);
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PENDING_CHECKOUT_KEY)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("hypercli-first-agent-draft"))).toBeNull();
  expect(await page.evaluate(() => (window as Window & { __sawPaidWorkspaceWelcome?: boolean }).__sawPaidWorkspaceWelcome)).toBe(false);
  await page.waitForTimeout(500);
  expect(createCount).toBe(1);
  expect(startCount).toBe(1);
});
