import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import { installMockGateway, inspectMockGateway } from "./fixtures/mock-openclaw-gateway";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

/**
 * Deterministic browser lane for Agent Settings > Index (Memory index).
 *
 * The component suite already proves the pure contract (`buildMemoryIndexPatch`
 * shape, launch-env mapping, and the launch-updates-unavailable guard); the
 * live lane proves nothing here because a real gateway cannot be driven into
 * non-default configs, refused writes, or byte-exact patch inspection on
 * demand. This spec runs the real app composition (Next.js page,
 * `useOpenClawSession`, the SDK `GatewayClient.configPatch`) against the same
 * mock in-page gateway seam `skills-proposals-intercepted.spec.ts` uses, so the
 * things it proves above the component suite are the integration boundaries:
 *
 *   - the `?view=settings&settings=memory-index&agentId=…` route reaches the
 *     Index settings for a selected managed OpenClaw agent;
 *   - the panel hydrates all six fields from the gateway's live `config.get`,
 *     including non-default values and the ms -> seconds display conversion;
 *   - Save sends exactly one `config.patch` with the existing patch shape and
 *     the bound hash, and one backend launch-config PATCH whose env carries
 *     the synchronized OPENCLAW_MEMORY_SEARCH_* values without clobbering
 *     unrelated env or leaking the secret-only gateway token;
 *   - saving does not touch the Knowledge Collections/workspaces API at all;
 *   - Discard restores hydrated values and sends no mutation;
 *   - a refused gateway write surfaces the error without false success while
 *     the launch-config update has already landed (existing two-mutation
 *     ordering, recorded here as a durable regression pin);
 *   - a full reload rehydrates from the persisted gateway config.
 *
 * Interception policy (against TEST_BASE_URL, normally the deployed feat
 * artifact): only feat-origin GET/HEAD reads — the public frontend artifact —
 * and read-only third-party SDK probes (Privy app config, WalletConnect
 * explorer) ever reach the network. Every application backend and gateway
 * interaction is served deterministically here, and every non-GET request that
 * no handler claims is recorded and answered 500, then asserted empty: an
 * escaping mutation fails the test instead of silently touching live state.
 */

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const AGENT_ID = "agent-memory-index-intercepted";
const AGENT_HOSTNAME = "agent-memory-index-intercepted.example.test";
const REEF_HOSTNAME = "reef.example.test";
const DEPLOYMENT_EVENTS_WS_URL = "wss://deployment-events.example.test/ws";

const NON_DEFAULT_CONFIG = {
  agents: {
    defaults: {
      memorySearch: {
        enabled: false,
        sync: {
          onSessionStart: true,
          onSearch: true,
          watch: true,
          watchDebounceMs: 60000,
          intervalMinutes: 45,
        },
      },
    },
  },
};

const BASE_LAUNCH_CONFIG = {
  image: "ghcr.io/hypercli/hypercli-openclaw:test",
  env: {
    OPENCLAW_GATEWAY_TOKEN: "redacted-gateway-token",
    OPENCLAW_DESKTOP_ENABLED: "0",
    HYPER_WORKSPACES_BOOT_SYNC: "1",
    HYPER_WORKSPACES_DIR: "/home/node/shared",
    HYPER_WORKSPACES_SYNC_READY_ONLY: "1",
    HYPER_CUSTOM_FLAG: "visible",
    FOO: "bar",
  },
  routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
  sync_root: "/home/node",
  sync_uid: 1000,
  sync_gid: 1000,
};

/**
 * GETs the agents dashboard issues on this route whose payloads the Index
 * panel never reads. Each is answered `{}` and recorded; a NEW fallthrough
 * path fails the test so a missing contract can never hide behind the
 * wildcard. Do not add mutation targets here — non-GET requests fall through
 * to the loud 500 path instead.
 */
const EXPECTED_GET_FALLTHROUGH_PATHS = new Set([
  // Billing-history probe (`hyperAgent.billingHistory`); panel ignores it.
  "/agents/subscriptions",
  "/agents/billing/payments",
  // Token-usage snapshot for the header meter; Index never renders it.
  "/agents/usage/agents",
]);

interface BackendCapture {
  /** Bodies of PATCH /agents/deployments/{id} — the launch-config mirror. */
  launchConfigPatches: Array<{ body: Record<string, unknown> }>;
  /** Non-GET calls into the workspaces/knowledge API (must stay empty). */
  workspaceMutations: string[];
  /** Non-GET requests no handler claimed (must stay empty). */
  escapedMutations: string[];
  /** Unique GET paths answered by the agents fallthrough (allowlist-checked). */
  getFallthroughPaths: string[];
  /**
   * Token mints for the Deployments events stream. A correctly parked mock
   * socket mints exactly once per page load; each remint means the
   * subscription dropped and reconnected, which the fixture must never do on
   * its own.
   */
  eventsTokenMints: number;
  /** Read-only third-party requests that were allowed through (diagnostics). */
  thirdPartyReads: string[];
}

async function installAuth(page: Page): Promise<void> {
  const baseUrl = (process.env.TEST_BASE_URL ?? "").trim();
  if (!baseUrl) throw new Error("TEST_BASE_URL is required for the intercepted Memory index tests");
  const baseOrigin = new URL(baseUrl).origin;
  await page.context().addCookies([
    {
      name: "auth_token",
      value: TEST_JWT,
      url: baseOrigin,
      httpOnly: false,
      secure: new URL(baseUrl).protocol === "https:",
      sameSite: "Lax",
    },
  ]);
  await page.addInitScript((token) => {
    window.localStorage.setItem("claw_auth_token", token);
  }, TEST_JWT);
}

function failAsUnhandled(route: import("@playwright/test").Route, capture: BackendCapture, url: string): Promise<void> {
  capture.escapedMutations.push(`${route.request().method()} ${url}`);
  return route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "unhandled mutation in intercepted Memory index spec" }),
  });
}

/**
 * Mirror of the skills-intercepted backend, plus the pieces the Index save
 * path exercises: the deployment carries a launch config (so launch-env
 * preservation is observable), PATCHes to the deployment are captured, the
 * parked Deployments events stream and the Reef starter-file probe get
 * deterministic answers, and every non-GET into the workspaces/knowledge API
 * is failed loudly so the spec proves a Memory index save never mutates
 * Knowledge Collections.
 */
async function interceptBackend(page: Page): Promise<BackendCapture> {
  const capture: BackendCapture = {
    launchConfigPatches: [],
    workspaceMutations: [],
    escapedMutations: [],
    getFallthroughPaths: [],
    eventsTokenMints: 0,
    thirdPartyReads: [],
  };
  let currentLaunchConfig: Record<string, unknown> = BASE_LAUNCH_CONFIG;
  const baseHost = new URL((process.env.TEST_BASE_URL ?? "").trim()).host;

  const deployment = () => ({
    id: AGENT_ID,
    name: "Memory Index Intercepted Agent",
    user_id: "user-1",
    state: "RUNNING",
    cpu: 2,
    memory: 8,
    hostname: AGENT_HOSTNAME,
    openclaw_url: `wss://${AGENT_HOSTNAME}`,
    gateway_url: `wss://${AGENT_HOSTNAME}`,
    launch_epoch: 1,
    launch_config: currentLaunchConfig,
    routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
    created_at: "2026-08-24T00:00:00Z",
    updated_at: "2026-08-24T00:00:00Z",
  });

  // Lowest precedence (registered first). Policy: feat-origin GET/HEAD reads
  // (the public artifact under test) and read-only third-party SDK probes
  // pass; every non-GET is recorded and answered 500 so an unexpected write
  // can never reach a live system or silently "succeed".
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      await failAsUnhandled(route, capture, url);
      return;
    }
    if (new URL(url).host !== baseHost) {
      capture.thirdPartyReads.push(`${method} ${url}`);
    }
    await route.continue();
  });

  await page.route("**/agents/**", async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const method = route.request().method();

    // The application document route (`/dashboard/agents/`, reached after the
    // host's trailing-slash redirect) shares the `/agents` substring: only
    // paths rooted at the API `/agents/` prefix belong to this handler.
    if (!pathName.startsWith("/agents/")) {
      await route.fallback();
      return;
    }

    // The parked Deployments events stream: the SDK mints a token here, then
    // opens the returned socket (held open in-page by the mock — no traffic).
    if (pathName.endsWith("/agents/deployments/events/token") && method === "POST") {
      capture.eventsTokenMints += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token: "deployments-events-token", ws_url: DEPLOYMENT_EVENTS_WS_URL }),
      });
      return;
    }
    // The starter-file probe mints a Reef token, then reads through it.
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}/files/token`) && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "reef-token-memory-index",
          url: `https://${REEF_HOSTNAME}/_reef`,
          expires_at: "2026-12-31T00:00:00Z",
        }),
      });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}/routes`) && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agent_id: AGENT_ID,
          routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
          route_statuses: {
            openclaw: {
              dns_state: "active",
              hostname: AGENT_HOSTNAME,
              url: `https://${AGENT_HOSTNAME}`,
            },
          },
        }),
      });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}/secrets/OPENCLAW_GATEWAY_TOKEN`) && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agent_id: AGENT_ID,
          key: "OPENCLAW_GATEWAY_TOKEN",
          value: "intercepted-gateway-token",
          launch_epoch: 1,
        }),
      });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}`) && method === "PATCH") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      capture.launchConfigPatches.push({ body });
      if (body.launch_config && typeof body.launch_config === "object" && !Array.isArray(body.launch_config)) {
        currentLaunchConfig = body.launch_config as Record<string, unknown>;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(deployment()) });
      return;
    }
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}`) && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(deployment()) });
      return;
    }
    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([deployment()]) });
      return;
    }
    if (pathName.endsWith("/agents/users/profile-image") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "user-1", avatar_url: null, s3_key: null }),
      });
      return;
    }
    if (pathName.endsWith("/agents/plans") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plans: [{
            id: "pro",
            name: "Pro",
            price: 80,
            price_usd: 80,
            features: [],
            models: [],
            limits: { tpd: 250000000, burst_tpm: 8680550, rpm: 868 },
            slot_grants: { large: 1 },
          }],
        }),
      });
      return;
    }
    if (pathName.endsWith("/agents/plans/current") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "pro",
          name: "Pro",
          pooled_tpd: 250000000,
          slot_inventory: { large: { granted: 1, used: 1, available: 0 } },
        }),
      });
      return;
    }
    if (pathName.endsWith("/agents/subscriptions/summary") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          effective_plan_id: "pro",
          pooled_tpd: 250000000,
          slot_inventory: { large: { granted: 1, used: 1, available: 0 } },
          active_subscription_count: 1,
          active_entitlement_count: 1,
          entitlements: {
            effective_plan_id: "pro",
            active_entitlement_count: 1,
            slot_inventory: { large: { granted: 1, used: 1, available: 0 } },
          },
          active_subscriptions: [{ id: "sub-pro", plan_id: "pro", plan_name: "Pro", quantity: 1, status: "active" }],
          subscriptions: [],
          user: { id: "user-1" },
        }),
      });
      return;
    }
    if (pathName.endsWith("/agents/usage/history") && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ history: [] }) });
      return;
    }
    if (pathName.endsWith("/agents/types") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ types: [{ id: "large", name: "Large", cpu: 2, memory: 8 }], plans: [] }),
      });
      return;
    }

    // Anything not named above: writes fail loudly, and reads are tolerated
    // only from the documented allowlist (each entry justified at the top).
    if (method !== "GET" && method !== "HEAD") {
      await failAsUnhandled(route, capture, new URL(route.request().url()).pathname);
      return;
    }
    if (!capture.getFallthroughPaths.includes(pathName)) capture.getFallthroughPaths.push(pathName);
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route("**/api/user", async (route) => {
    if (route.request().method() !== "GET") {
      await failAsUnhandled(route, capture, route.request().url());
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user-1",
        email: "memory-index-intercepted@example.test",
        name: "Memory Index Intercepted",
      }),
    });
  });

  // Reef reads issued with the minted file token: an empty sync root.
  await page.route(`https://${REEF_HOSTNAME}/**`, async (route) => {
    const request = route.request();
    const pathName = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      await failAsUnhandled(route, capture, request.url());
      return;
    }
    if (pathName === "/_reef/directories" || pathName.startsWith("/_reef/directories/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ type: "directory", prefix: "", directories: [], files: [], truncated: false }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) });
  });

  // Highest precedence: Knowledge Collections/workspaces. Reads are answered
  // deterministically; any mutation is failed loudly and recorded, and every
  // test asserts this stayed empty — an Index save must not touch it.
  await page.route(/\/(workspaces|knowledge)(\/.*)?$/, async (route) => {
    const request = route.request();
    const pathName = new URL(request.url()).pathname;
    if (request.method() !== "GET" && request.method() !== "HEAD") {
      capture.workspaceMutations.push(`${request.method()} ${pathName}`);
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "unexpected workspace mutation in intercepted Memory index spec" }),
      });
      return;
    }
    const workspace = {
      id: "workspace-memory-index-intercepted",
      name: "Memory Index Intercepted",
      slug: "workspace-memory-index-intercepted",
      display_name: "Memory Index Intercepted",
      role: "admin",
    };
    if (pathName.includes("/agents") || pathName.includes("/grants") || pathName.includes("/collections")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pathName.endsWith(`/${workspace.id}`) ? workspace : [workspace]),
    });
  });

  return capture;
}

/** Every interception boundary proof that must hold at the end of a test. */
function expectNoEscapes(capture: BackendCapture, expectedEventsTokenMints: number): void {
  expect(capture.workspaceMutations).toEqual([]);
  expect(capture.escapedMutations).toEqual([]);
  expect(capture.getFallthroughPaths.filter((pathName) => !EXPECTED_GET_FALLTHROUGH_PATHS.has(pathName))).toEqual([]);
  // One mint per page load: the in-page events socket stays parked instead of
  // cycling through reconnect/remint loops.
  expect(capture.eventsTokenMints).toBe(expectedEventsTokenMints);
}

async function openMemoryIndexSettings(page: Page): Promise<void> {
  await page.goto(
    `/dashboard/agents?view=settings&settings=memory-index&agentId=${encodeURIComponent(AGENT_ID)}`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.getByRole("heading", { level: 2, name: "Memory index", exact: true })).toBeVisible({ timeout: 90_000 });
}

test.describe("Agent settings Memory index (intercepted gateway)", () => {
  test("hydrates non-default config, saves the exact config patch and launch env sync, and persists across reload", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await installMockGateway(page, {
      methods: ["config.get", "config.patch", "config.schema", "chat.history", "agents.list", "files.list"],
      config: NON_DEFAULT_CONFIG,
      persistConfig: true,
    });
    await installAuth(page);
    const backend = await interceptBackend(page);
    await openMemoryIndexSettings(page);

    // Hydration from the gateway's live config beats the built-in defaults:
    // enabled=false, the three sync triggers on, 60000ms shown as 60 seconds,
    // and a 45 minute interval.
    const enableSwitch = page.getByRole("switch", { name: "Enable memory search" });
    const sessionStartSwitch = page.getByRole("switch", { name: "Sync on session start" });
    const searchSwitch = page.getByRole("switch", { name: "Sync on search" });
    const watchSwitch = page.getByRole("switch", { name: "Watch memory files" });
    const debounceInput = page.getByRole("spinbutton", { name: "Watch debounce seconds" });
    const intervalInput = page.getByRole("spinbutton", { name: "Interval sync minutes" });

    await expect(enableSwitch).not.toBeChecked();
    await expect(sessionStartSwitch).toBeChecked();
    await expect(searchSwitch).toBeChecked();
    await expect(watchSwitch).toBeChecked();
    await expect(debounceInput).toHaveValue("60");
    await expect(intervalInput).toHaveValue("45");

    // Editing: enable memory search, and the seconds -> milliseconds and
    // "0 disables" semantics for the numeric fields.
    await enableSwitch.click();
    await debounceInput.fill("90");
    await intervalInput.fill("0");

    const saveButton = page.getByRole("button", { name: "Save changes" });
    await saveButton.click();

    // The save settles when the drafts become the new baseline: both footer
    // buttons go disabled only after the second mutation completes. Durable
    // success feedback is intentionally not asserted here: a MutationObserver
    // probe proves "Agent settings updated." renders briefly and is then
    // cleared by the openclawConfig-sync effect in AgentPanels.tsx, which is
    // reproduced as a separate production finding.
    await expect(saveButton).toBeDisabled({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Discard" })).toBeDisabled();

    // Exactly one revision-bound gateway write with the existing patch shape.
    const wire = await inspectMockGateway(page);
    expect(wire.configWrites).toHaveLength(1);
    expect(wire.configWrites[0]!.method).toBe("config.patch");
    expect(wire.configWrites[0]!.baseHash).toBe("hash-1");
    expect(JSON.parse(wire.configWrites[0]!.raw)).toEqual({
      agents: {
        defaults: {
          memorySearch: {
            enabled: true,
            sync: {
              onSessionStart: true,
              onSearch: true,
              watch: true,
              watchDebounceMs: 90000,
              intervalMinutes: 0,
            },
          },
        },
      },
    });

    // Exactly one backend launch-config PATCH: the memory env keys follow the
    // saved toggles, unrelated user env survives (`FOO`, `HYPER_CUSTOM_FLAG`),
    // the workspaces sync env is preserved, and the secret-only gateway token
    // is never echoed into the stored launch config.
    expect(backend.launchConfigPatches).toHaveLength(1);
    const patchBody = backend.launchConfigPatches[0]!.body;
    const launchConfig = patchBody.launch_config as Record<string, unknown>;
    expect(launchConfig.image).toBe(BASE_LAUNCH_CONFIG.image);
    expect(launchConfig.routes).toEqual(BASE_LAUNCH_CONFIG.routes);
    expect(launchConfig.sync_root).toBe("/home/node");
    expect(launchConfig.sync_uid).toBe(1000);
    expect(launchConfig.sync_gid).toBe(1000);
    expect(launchConfig.env).toEqual({
      OPENCLAW_DESKTOP_ENABLED: "0",
      OPENCLAW_MEMORY_SEARCH_ENABLED: "1",
      OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START: "1",
      OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH: "1",
      OPENCLAW_MEMORY_SEARCH_SYNC_WATCH: "1",
      OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS: "90000",
      OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: "0",
      HYPER_WORKSPACES_BOOT_SYNC: "1",
      HYPER_WORKSPACES_DIR: "/home/node/shared",
      HYPER_WORKSPACES_SYNC_READY_ONLY: "1",
      HYPER_CUSTOM_FLAG: "visible",
      FOO: "bar",
    });

    // The Knowledge Collections/workspaces API was never mutated, and no
    // other non-GET escaped interception. One events mint for this page load.
    expectNoEscapes(backend, 1);

    // A full reload rehydrates from the persisted gateway config without the
    // client replaying the write.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2, name: "Memory index", exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("switch", { name: "Enable memory search" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Sync on session start" })).toBeChecked();
    await expect(page.getByRole("spinbutton", { name: "Watch debounce seconds" })).toHaveValue("90");
    await expect(page.getByRole("spinbutton", { name: "Interval sync minutes" })).toHaveValue("0");
    const wireAfterReload = await inspectMockGateway(page);
    expect(wireAfterReload.configWrites).toHaveLength(0);
    expect(backend.launchConfigPatches).toHaveLength(1);
    // Initial load + reload: exactly one parked events subscription each.
    expectNoEscapes(backend, 2);
    expect(pageErrors).toEqual([]);
  });

  test("discards edits back to the hydrated config without any gateway or backend mutation", async ({ page }) => {
    await installMockGateway(page, {
      methods: ["config.get", "config.patch", "config.schema", "chat.history", "agents.list", "files.list"],
      config: NON_DEFAULT_CONFIG,
    });
    await installAuth(page);
    const backend = await interceptBackend(page);
    await openMemoryIndexSettings(page);

    const watchSwitch = page.getByRole("switch", { name: "Watch memory files" });
    const debounceInput = page.getByRole("spinbutton", { name: "Watch debounce seconds" });
    const intervalInput = page.getByRole("spinbutton", { name: "Interval sync minutes" });
    await expect(watchSwitch).toBeChecked();
    await expect(debounceInput).toHaveValue("60");

    await watchSwitch.click();
    await debounceInput.fill("10");
    const saveButton = page.getByRole("button", { name: "Save changes" });
    const discardButton = page.getByRole("button", { name: "Discard" });
    await expect(saveButton).toBeEnabled();

    await discardButton.click();

    // The hydrated state is restored and nothing was sent anywhere.
    await expect(watchSwitch).toBeChecked();
    await expect(debounceInput).toHaveValue("60");
    await expect(intervalInput).toHaveValue("45");
    await expect(saveButton).toBeDisabled();
    await expect(discardButton).toBeDisabled();
    const wire = await inspectMockGateway(page);
    expect(wire.configWrites).toHaveLength(0);
    expect(backend.launchConfigPatches).toHaveLength(0);
    expectNoEscapes(backend, 1);
  });

  test("shows the gateway error and no success when the config write is refused, while the launch update has already landed", async ({ page }) => {
    await installMockGateway(page, {
      methods: ["config.get", "config.patch", "config.schema", "chat.history", "agents.list", "files.list"],
      failConfigPatch: true,
    });
    await installAuth(page);
    const backend = await interceptBackend(page);
    await openMemoryIndexSettings(page);

    // Defaults hydrate from an empty gateway config: memory search on, all
    // sync triggers off, 30s debounce, interval disabled.
    const sessionStartSwitch = page.getByRole("switch", { name: "Sync on session start" });
    await expect(sessionStartSwitch).not.toBeChecked();
    await sessionStartSwitch.click();

    const saveButton = page.getByRole("button", { name: "Save changes" });
    await saveButton.click();

    // The refused write is surfaced in place; no false success is shown.
    await expect(page.getByText("config write failed")).toBeVisible();
    await expect(page.getByText("Agent settings updated.")).toHaveCount(0);

    // The failed mutation is single-shot: one gateway write attempt, and it
    // is not retried implicitly.
    const wire = await inspectMockGateway(page);
    expect(wire.configWrites).toHaveLength(1);
    expect(wire.configWrites[0]!.method).toBe("config.patch");

    // Existing two-mutation ordering: the backend launch-config update has
    // already been persisted when the gateway write fails. This pins the
    // current behavior; the divergence risk it creates between launch env and
    // live gateway config is a known atomicity gap, not new behavior.
    expect(backend.launchConfigPatches).toHaveLength(1);
    const env = (backend.launchConfigPatches[0]!.body.launch_config as { env: Record<string, string> }).env;
    expect(env.OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START).toBe("1");

    // The draft stays dirty instead of pretending the save landed.
    await expect(sessionStartSwitch).toBeChecked();
    await expect(saveButton).toBeEnabled();
    expectNoEscapes(backend, 1);
  });
});
