import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  bootstrapAdminUser,
  cleanupAdminUser,
  type AdminUserIdentity,
} from "./fixtures/admin-user-bootstrap";
import {
  completeStripeCheckout,
  deleteClawAgentThroughUi,
  readClawAgentFileBytes,
  stopClawAgentThroughUi,
} from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });
test.use({ trace: "off", video: "off" });

/**
 * The Agents smoke test: click the real frontend through the whole user
 * journey on a throwaway identity, so a commit that nukes the flow cannot
 * reach production quietly.
 *
 *   bootstrap identity -> mint its JWT (no Privy) -> open the Team trial from
 *   the dashboard sidebar -> Stripe hosted checkout -> create an Agent through the
 *   setup wizard -> it starts on its own -> Ready -> one chat round-trip ->
 *   verify first-turn workspace context -> confirm bootstrap -> restart ->
 *   verify persistent workspace context -> stop -> delete from the Danger Zone.
 *
 * Recorded from a manual walkthrough on 2026-08-20; the Stripe checkout
 * recipe was re-proven manually in headed Chromium on 2026-08-23. Every click
 * target is an id or testid from the real UI. The only machinery borrowed
 * from the old suite is the identity bootstrap; everything else is plain
 * Playwright.
 */

const startedAt = Date.now();
let stepIndex = 0;
/** Progress marker: elapsed-stamped log line plus a screenshot when E2E_SHOT_DIR is set. */
async function step(page: Page, name: string): Promise<void> {
  stepIndex += 1;
  const label = `${String(stepIndex).padStart(2, "0")}-${name}`;
  console.log(`[step] ${label} at +${Math.round((Date.now() - startedAt) / 1000)}s`);
  const dir = (process.env.E2E_SHOT_DIR ?? "").trim();
  if (dir) await page.screenshot({ path: `${dir}/${label}.png` }).catch(() => {});
}

function env(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required for the agents E2E`);
  return value;
}

/** The agents app under test, e.g. https://agents.dev.hypercli.com */
function appBase(): string {
  return env("TEST_BASE_URL").replace(/\/+$/, "");
}

/** Product API base, /api suffix guaranteed, e.g. https://api.dev.hypercli.com/api */
function apiBase(): string {
  const base = (process.env.TEST_API_BASE_URL ?? "https://api.dev.hypercli.com")
    .trim()
    .replace(/\/+$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

interface WorkspaceContextFile {
  name: string;
  path: string;
  missing: boolean;
  rawChars: number;
  injectionStatus?: "verified" | "native_unverified";
  injectedChars: number | null;
  truncated: boolean | null;
}

interface WorkspaceContextReport {
  source: "run" | "estimate";
  generatedAt: number;
  sessionKey?: string;
  workspaceDir?: string;
  injectedWorkspaceFiles: WorkspaceContextFile[];
}

const OPENCLAW_CONFIG_PATH = ".openclaw/openclaw.json";
const PERSISTENT_WORKSPACE_PATHS = [
  ".openclaw/workspace/AGENTS.md",
  ".openclaw/workspace/SOUL.md",
  ".openclaw/workspace/IDENTITY.md",
  ".openclaw/workspace/USER.md",
] as const;
const BOOTSTRAP_WORKSPACE_PATH = ".openclaw/workspace/BOOTSTRAP.md";
const RETIRED_WORKSPACE_PATHS = [
  ".openclaw/workspace/TOOLS.md",
  ".openclaw/workspace/HEARTBEAT.md",
] as const;

function parseWorkspaceContextReport(text: string): WorkspaceContextReport | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const payload = JSON.parse(text.slice(start, end + 1)) as { report?: WorkspaceContextReport };
    return Array.isArray(payload.report?.injectedWorkspaceFiles) ? payload.report : null;
  } catch {
    return null;
  }
}

async function sendChatAndWaitForAssistant(
  page: Page,
  composer: Locator,
  message: string,
  expectedText: string,
): Promise<Locator> {
  const replies = page.getByTestId("agent-chat-message-assistant");
  const replyCount = await replies.count();
  await composer.fill(message);
  if (message.startsWith("/")) await composer.press("Escape");
  await composer.press("Enter");
  await expect(replies).toHaveCount(replyCount + 1, { timeout: 180_000 });
  const reply = replies.nth(replyCount);
  await expect(reply).toContainText(expectedText, { timeout: 180_000 });
  await expect(page.getByRole("button", { name: /^(Stop reply|Stopping reply)$/ }))
    .toHaveCount(0, { timeout: 180_000 });
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  return reply;
}

async function requestWorkspaceContextReport(
  page: Page,
  composer: Locator,
  expectedSource: WorkspaceContextReport["source"] = "run",
): Promise<WorkspaceContextReport> {
  const reply = await sendChatAndWaitForAssistant(page, composer, "/context json", "injectedWorkspaceFiles");
  await expect.poll(async () => (
    parseWorkspaceContextReport(await reply.innerText())?.injectedWorkspaceFiles.length ?? 0
  ), { timeout: 30_000 }).toBeGreaterThan(0);
  const report = parseWorkspaceContextReport(await reply.innerText());
  expect(report, "expected /context json to return a parseable workspace report").not.toBeNull();
  expect(report?.source, `expected /context json to return a ${expectedSource} report`).toBe(expectedSource);
  return report!;
}

function expectInjectedWorkspaceFiles(
  report: WorkspaceContextReport,
  names: string[],
  persistedWorkspace?: Map<string, Uint8Array>,
): void {
  const files = new Map(report.injectedWorkspaceFiles.map((file) => [file.name, file]));
  const workspaceDir = report.workspaceDir?.replace(/\/+$/, "") ?? "";
  expect(workspaceDir, "expected the run report to identify its workspace").toBeTruthy();
  for (const name of names) {
    const file = files.get(name);
    expect(file, `expected ${name} in injectedWorkspaceFiles`).toBeDefined();
    expect(file?.missing, `expected ${name} to exist`).toBe(false);
    expect(file?.rawChars ?? 0, `expected ${name} to contain persisted bytes`).toBeGreaterThan(0);
    expect(file?.injectionStatus, `expected ${name} injection to be verified`).not.toBe("native_unverified");
    expect(file?.truncated, `expected ${name} to reach model context untruncated`).toBe(false);
    expect(file?.injectedChars, `expected all ${name} bytes to reach model context`).toBe(file?.rawChars);
    expect(file?.path, `expected ${name} to come from the reported workspace`).toBe(`${workspaceDir}/${name}`);
    if (persistedWorkspace) {
      const persisted = persistedWorkspace.get(`.openclaw/workspace/${name}`);
      expect(persisted, `expected a retained snapshot for ${name}`).toBeDefined();
      expect(file?.rawChars, `expected ${name} report chars to match retained bytes`)
        .toBe(new TextDecoder().decode(persisted).length);
    }
  }
}

async function readWorkspaceSnapshot(
  page: Page,
  agentId: string,
  paths: readonly string[],
): Promise<Map<string, Uint8Array>> {
  const snapshot = new Map<string, Uint8Array>();
  for (const path of paths) {
    const bytes = await readClawAgentFileBytes(page, agentId, path);
    expect(bytes.byteLength, `expected ${path} to contain bytes`).toBeGreaterThan(0);
    snapshot.set(path, bytes);
  }
  return snapshot;
}

async function expectWorkspaceFileMissing(page: Page, agentId: string, path: string): Promise<void> {
  const outcome = await readClawAgentFileBytes(page, agentId, path).then(
    () => ({ error: null as unknown }),
    (error: unknown) => ({ error }),
  );
  expect(outcome.error, `expected ${path} to be absent`).not.toBeNull();
  const statusCode = Number((outcome.error as { statusCode?: unknown } | null)?.statusCode ?? 0);
  const detail = String(
    (outcome.error as { detail?: unknown } | null)?.detail
      ?? (outcome.error instanceof Error ? outcome.error.message : outcome.error),
  );
  expect(statusCode, `expected an application-level missing-file response for ${path}: ${detail}`).toBe(404);
  expect(detail.toLowerCase(), `an unrouted edge 404 does not prove ${path} is absent`)
    .not.toContain("404 page not found");
}

/**
 * Privy is deliberately skipped: a session JWT for the bootstrapped user is
 * planted exactly where the app's own login would put it. (Parallel CI runs
 * cannot share one OTP inbox; that lesson is paid for.)
 *
 * The preferred source is the harness: bootstrap_agents_e2e_user.py's `login`
 * subcommand exports TEST_USER_TOKEN, and then this spec makes no admin call
 * at all. Minting here is the ad-hoc fallback for running the spec directly.
 */
async function mintToken(email: string): Promise<string> {
  const provided = (process.env.TEST_USER_TOKEN ?? "").trim();
  if (provided) return provided;
  const url = new URL(`${apiBase()}/admin/auth/login`);
  url.searchParams.set("email", email);
  const response = await fetch(url, { headers: { "X-BACKEND-API-KEY": env("BACKEND_API_KEY") } });
  if (!response.ok) {
    throw new Error(`Admin auth login failed: ${response.status} ${await response.text()}`);
  }
  const { token } = (await response.json()) as { token?: string };
  if (!token) throw new Error("Admin auth login returned no token");
  return token;
}

async function loginAs(page: Page, email: string): Promise<void> {
  const token = await mintToken(email);
  await page.goto(appBase(), { waitUntil: "domcontentloaded" });
  await page.evaluate((jwt) => {
    window.localStorage.setItem("claw_auth_token", jwt);
    document.cookie = `auth_token=${jwt}; path=/; samesite=lax`;
  }, token);
  await page.goto(`${appBase()}/dashboard`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.url(), { timeout: 30_000 }).toContain("/dashboard");
}

/**
 * Claim the Team trial through Stripe hosted checkout.
 *
 * The trial is a paid checkout now, not a cardless grant: the dashboard
 * sidebar CTA opens the activation dialog, whose confirmation asks
 * POST /agents/stripe/trial for a session and
 * navigates to checkout.stripe.com, the sandbox card pays there, and Stripe
 * redirects back to /dashboard/agents where the checkout-return recovery
 * consumes the query params and waits for the entitlement to reflect. This
 * checkout is the critical contract of the spec and must not be skipped.
 *
 * The Stripe form fill delegates to the shared completeStripeCheckout -- the
 * same driver the console lanes use -- so the trial and console checkouts
 * stay in lockstep. It polls every known field variant across frames, which
 * is what the Link/Apple-Pay-first layouts demand: a single-iframe
 * input[name='number'] selector finds nothing when the card form is mounted
 * late or under different field names.
 */
async function claimTeamTrialThroughStripeCheckout(page: Page): Promise<void> {
  await page.goto(`${appBase()}/dashboard/agents`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("team-trial-activation-dialog")).toHaveCount(0);
  const sidebarTrialCta = page.getByRole("button", { name: "Start free trial" });
  await expect(sidebarTrialCta, "expected the trial CTA in the dashboard sidebar").toBeEnabled({ timeout: 90_000 });
  await sidebarTrialCta.click();
  await expect(page.getByTestId("team-trial-activation-dialog")).toBeVisible();
  const checkoutResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/agents/stripe/trial"),
    { timeout: 120_000 },
  );
  await page.getByTestId("team-trial-activation-confirm").click({ noWaitAfter: true });
  const checkoutResponse = await checkoutResponsePromise;
  expect(
    checkoutResponse.ok(),
    `expected trial checkout creation to succeed, got ${checkoutResponse.status()}`,
  ).toBe(true);
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, {
    timeout: 120_000,
    waitUntil: "commit",
  });

  // Currency is geo-dependent and completeStripeCheckout does not touch it:
  // pick USD when Stripe offers the choice, and carry on without complaining
  // when it does not.
  const usdButton = page.getByRole("button", { name: "USD", exact: true }).first();
  if (await usdButton.isVisible().catch(() => false)) {
    await usdButton.click().catch(() => {});
  }

  // completeStripeCheckout fills the sandbox card, clicks Stripe's own
  // submit (.SubmitButton / button[type='submit'], which covers the
  // "Start trial" label), and waits until the browser has left
  // checkout.stripe.com.
  await completeStripeCheckout(page, `${appBase()}/dashboard/agents`);

  // Stripe returns to /dashboard/agents?checkout=success&..., which the app's
  // checkout-return recovery consumes while the trial entitlement reflects.
  await page.waitForURL(/\/dashboard\/agents/, { timeout: 180_000 });
}

test.describe.serial("Agents E2E", () => {
  test.describe.configure({ retries: 0 });

  // When the harness (bootstrap_agents_e2e_user.py) owns the identity it sets
  // TEST_EMAIL + TEST_USER_TOKEN, and this spec neither creates nor deletes
  // anything admin-side -- that path survives a killed runner. The in-process
  // bootstrap below is only for running the spec directly, ad hoc.
  const harnessEmail = (process.env.TEST_USER_TOKEN ?? "").trim()
    ? (process.env.TEST_EMAIL ?? "").trim()
    : "";
  let identity: AdminUserIdentity | null = null;

  test.beforeAll(async () => {
    if (!harnessEmail) identity = await bootstrapAdminUser("agents-e2e");
  });

  // Teardown IS the bootstrap's cleanup: it deletes whatever Agents the run
  // left behind (by id, via the admin API) and then the identity itself, and
  // it throws loudly if any of that fails. No per-step backstop needed.
  test.afterAll(async () => {
    if (identity) await cleanupAdminUser(identity);
  });

  test("trial -> create -> bootstrap context -> restart context -> delete", async ({ page }) => {
    test.setTimeout(900_000);

    await loginAs(page, harnessEmail || identity!.email);
    await step(page, "logged-in");

    // -- Trial ---------------------------------------------------------------
    // The fresh account earns its plan by paying through the offer the way a
    // user does: sidebar CTA -> activation dialog -> checkout.stripe.com -> sandbox card
    // -> redirect back to /dashboard/agents. The hosted checkout is the
    // critical contract of this spec; it must not be skipped.
    await claimTeamTrialThroughStripeCheckout(page);
    await step(page, "trial-claimed");

    // -- Create through the setup wizard --------------------------------------
    // The wizard's last step issues POST /agents/deployments; the id from its
    // response addresses the Agent for the rest of the test.
    const created = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/agents/deployments"),
      { timeout: 180_000 },
    );
    await page.getByRole("button", { name: "Launch agent" }).click();
    await page.getByTestId("agent-setup-continue-identity").click();
    await page.getByTestId("agent-setup-continue-objective").click();
    // The personality continue IS the launch: its label reads "Launch agent"
    // and clicking it fires the deployment POST. There is no further step.
    await page.getByTestId("agent-setup-continue-personality").click();

    const createResponse = await created;
    expect(createResponse.ok(), `expected the create to be accepted, got ${createResponse.status()}`).toBe(true);
    const agentId = String(((await createResponse.json()) as { id?: unknown }).id ?? "");
    expect(agentId, "expected the create response to carry the Agent id").toBeTruthy();
    await step(page, "created");

    // -- It starts on its own, then Ready -------------------------------------
    // Creation parks the deployment STOPPED (~20s of provisioning), then the
    // page fires the one POST /start itself. Nothing is clicked here on
    // purpose: needing a manual Start is the regression this wait catches.
    // Starts take about a minute; the budget covers a cold image pull.
    await page.waitForURL(new RegExp(`agentId=${agentId}`), { timeout: 120_000 });
    const sessionEntry = page.getByTestId("agent-launch-entry");
    if (await sessionEntry.isVisible().catch(() => false)) {
      await sessionEntry.click();
    }
    const composer = page.getByTestId("agent-chat-composer");
    await expect(page.getByText("Ready", { exact: true }), "expected Ready without a manual start")
      .toBeVisible({ timeout: 360_000 });
    await expect(composer).toBeEnabled({ timeout: 60_000 });
    await step(page, "ready");

    const initialWorkspace = await readWorkspaceSnapshot(page, agentId, [
      OPENCLAW_CONFIG_PATH,
      ...PERSISTENT_WORKSPACE_PATHS,
      BOOTSTRAP_WORKSPACE_PATH,
    ]);
    const initialConfig = JSON.parse(
      new TextDecoder().decode(initialWorkspace.get(OPENCLAW_CONFIG_PATH)!),
    ) as { gateway?: { mode?: string }; agents?: { defaults?: { workspace?: string } } };
    expect(initialConfig.gateway?.mode).toBe("local");
    expect(initialConfig.agents?.defaults?.workspace).toBe("~/.openclaw/workspace");
    for (const retiredPath of RETIRED_WORKSPACE_PATHS) {
      await expectWorkspaceFileMissing(page, agentId, retiredPath);
    }

    const preTurnContext = await requestWorkspaceContextReport(page, composer, "estimate");
    expect(preTurnContext.sessionKey, "expected the new Agent context to identify its session").toBeTruthy();
    expect(preTurnContext.workspaceDir, "expected the new Agent context to identify its workspace").toBeTruthy();

    // -- First turn and canonical workspace context -----------------------------
    // BOOTSTRAP.md makes this an onboarding turn, but explicitly keeps real work
    // first. The marker proves the gateway run completed; the diagnostic report
    // proves all five canonical files reached that same first-turn model context.
    const replyMarker = `E2E_CHAT_OK_${agentId.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`;
    await sendChatAndWaitForAssistant(
      page,
      composer,
      `Respond with this token first, then follow any one-time workspace onboarding instructions: ${replyMarker}`,
      replyMarker,
    );
    const firstTurnContext = await requestWorkspaceContextReport(page, composer);
    expect(firstTurnContext.generatedAt, "expected a new report produced by the first model turn")
      .toBeGreaterThan(preTurnContext.generatedAt);
    expect(firstTurnContext.sessionKey, "expected the first-turn report for the active session")
      .toBe(preTurnContext.sessionKey);
    expect(firstTurnContext.workspaceDir, "expected the first-turn report for the retained workspace")
      .toBe(preTurnContext.workspaceDir);
    expectInjectedWorkspaceFiles(firstTurnContext, [
      "AGENTS.md",
      "SOUL.md",
      "IDENTITY.md",
      "USER.md",
      "BOOTSTRAP.md",
    ], initialWorkspace);

    await step(page, "first-turn-context-verified");

    // Confirm the staged identity so OpenClaw persists any agreed refinements
    // and consumes the one-time BOOTSTRAP.md before the runtime restart.
    const confirmationMarker = `E2E_BOOTSTRAP_OK_${agentId.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`;
    await sendChatAndWaitForAssistant(
      page,
      composer,
      `Keep the current name and vibe. Finish the one-time workspace setup, then include this token in your reply: ${confirmationMarker}`,
      confirmationMarker,
    );
    const confirmedWorkspace = await readWorkspaceSnapshot(
      page,
      agentId,
      PERSISTENT_WORKSPACE_PATHS,
    );
    await expectWorkspaceFileMissing(page, agentId, BOOTSTRAP_WORKSPACE_PATH);
    await step(page, "bootstrap-confirmed");

    // -- Restart through Agent Settings -----------------------------------------
    await stopClawAgentThroughUi(page, agentId);
    await page.goto(`/dashboard/agents?view=settings&settings=agent&agentId=${encodeURIComponent(agentId)}`, {
      waitUntil: "domcontentloaded",
    });
    const startButton = page.getByRole("button", { name: "Start agent", exact: true });
    await expect(startButton).toBeVisible({ timeout: 90_000 });
    await expect(startButton).toBeEnabled({ timeout: 90_000 });
    const startResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST"
        && new URL(response.url()).pathname.endsWith(`/agents/deployments/${agentId}/start`),
      { timeout: 90_000 },
    );
    await startButton.click();
    const startResponse = await startResponsePromise;
    expect(startResponse.ok(), `expected the restart request to succeed, got ${startResponse.status()}`).toBe(true);

    await page.goto(`${appBase()}/dashboard/agents?agentId=${encodeURIComponent(agentId)}`, { waitUntil: "domcontentloaded" });
    const restartedSessionEntry = page.getByTestId("agent-launch-entry");
    if (await restartedSessionEntry.isVisible().catch(() => false)) {
      await restartedSessionEntry.click();
    }
    const restartedComposer = page.getByTestId("agent-chat-composer");
    await expect(page.getByText("Ready", { exact: true }), "expected the restarted Agent to become Ready")
      .toBeVisible({ timeout: 360_000 });
    await expect(restartedComposer).toBeEnabled({ timeout: 60_000 });
    const restartedWorkspace = await readWorkspaceSnapshot(page, agentId, [
      OPENCLAW_CONFIG_PATH,
      ...PERSISTENT_WORKSPACE_PATHS,
    ]);
    expect(restartedWorkspace.get(OPENCLAW_CONFIG_PATH))
      .toEqual(initialWorkspace.get(OPENCLAW_CONFIG_PATH));
    for (const workspacePath of PERSISTENT_WORKSPACE_PATHS) {
      expect(restartedWorkspace.get(workspacePath), `expected ${workspacePath} bytes to survive restart`)
        .toEqual(confirmedWorkspace.get(workspacePath));
    }
    await expectWorkspaceFileMissing(page, agentId, BOOTSTRAP_WORKSPACE_PATH);
    for (const retiredPath of RETIRED_WORKSPACE_PATHS) {
      await expectWorkspaceFileMissing(page, agentId, retiredPath);
    }
    await step(page, "restarted");

    // A fresh post-restart run must reload the persistent workspace files while
    // reporting BOOTSTRAP.md as consumed rather than silently recreating it.
    const restartMarker = `E2E_RESTART_OK_${agentId.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`;
    await sendChatAndWaitForAssistant(
      page,
      restartedComposer,
      `Respond with only this token, without Markdown or punctuation: ${restartMarker}`,
      restartMarker,
    );
    const restartContext = await requestWorkspaceContextReport(page, restartedComposer);
    expect(restartContext.generatedAt, "expected the restart marker to produce a fresh run report")
      .toBeGreaterThan(firstTurnContext.generatedAt);
    expect(restartContext.sessionKey, "expected restart to resume the same workspace session")
      .toBe(firstTurnContext.sessionKey);
    expect(restartContext.workspaceDir, "expected restart to reload the same retained workspace")
      .toBe(firstTurnContext.workspaceDir);
    expectInjectedWorkspaceFiles(
      restartContext,
      ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md"],
      restartedWorkspace,
    );
    const restartBootstrap = restartContext.injectedWorkspaceFiles.find((file) => file.name === "BOOTSTRAP.md");
    expect(restartBootstrap, "expected BOOTSTRAP.md lifecycle status in the restart report").toBeDefined();
    expect(restartBootstrap?.missing, "BOOTSTRAP.md must remain consumed after restart").toBe(true);
    expect(restartBootstrap?.rawChars).toBe(0);
    expect(restartBootstrap?.injectedChars).toBe(0);
    expect(restartBootstrap?.path).toBe(`${restartContext.workspaceDir?.replace(/\/+$/, "")}/BOOTSTRAP.md`);
    await step(page, "restart-context-verified");

    // -- Stop from Agent Settings ----------------------------------------------
    await stopClawAgentThroughUi(page, agentId);
    await step(page, "stopped");

    // -- Delete from the Danger Zone --------------------------------------------
    await deleteClawAgentThroughUi(page, agentId);
    await step(page, "deleted");
  });
});
