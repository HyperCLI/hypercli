import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import {
  bootstrapAdminUser,
  cleanupAdminUser,
  type AdminUserIdentity,
} from "./fixtures/admin-user-bootstrap";
import {
  completeStripeCheckout,
  deleteClawAgentThroughUi,
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
 *   stop from settings -> delete from the Danger Zone.
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

  test("trial -> create -> chat -> stop -> delete", async ({ page }) => {
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

    // -- One chat round-trip over the gateway ----------------------------------
    // A deterministic marker, not a knowledge question: the assertion is that
    // the gateway carried the run and a reply streamed back.
    const replyMarker = `E2E_CHAT_OK_${agentId.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`;
    await composer.fill(`Respond with only this token, without Markdown or punctuation: ${replyMarker}`);
    await composer.press("Enter");
    await expect(page.getByText(replyMarker, { exact: true }).last(), "expected the Agent's reply to stream back")
      .toBeVisible({ timeout: 180_000 });

    await step(page, "chat-reply");

    // -- Stop from Agent Settings ----------------------------------------------
    // Click the real UI control, then observe the authoritative lifecycle state
    // through the deployments client. The UI label is not the source of truth.
    await stopClawAgentThroughUi(page, agentId);
    await step(page, "stopped");

    // -- Delete from the Danger Zone --------------------------------------------
    await deleteClawAgentThroughUi(page, agentId);
    await step(page, "deleted");
  });
});
