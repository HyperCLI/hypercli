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
 * The Hermes variant of the Agents smoke test (agents-openclaw-e2e.spec.ts): same
 * throwaway identity and same Team trial. Hermes is intentionally absent from
 * the shipped launcher, so this lane provisions it through the official SDK,
 * then verifies the Hermes HTTP/SSE round-trip through the standard chat UI.
 *
 *   bootstrap identity -> mint its JWT -> open the Team trial from the sidebar
 *   and complete Stripe hosted checkout (sandbox card) -> create/start Hermes through
 *   the SDK -> Ready -> one chat round-trip -> stop from
 *   settings -> delete from the Danger Zone.
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

function agentsApiBase(): string {
  return `${apiBase().replace(/\/api$/, "")}/agents`;
}

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

async function createAndStartHermesAgent(email: string): Promise<string> {
  const [{ Deployments }, { HTTPClient }] = await Promise.all([
    import("@hypercli.com/sdk/agents"),
    import("@hypercli.com/sdk/http"),
  ]);
  const token = await mintToken(email);
  const baseUrl = agentsApiBase();
  const deployments = new Deployments(new HTTPClient(baseUrl, token), token, baseUrl);
  const browserOrigin = new URL(appBase()).origin;

  try {
    await expect.poll(async () => {
      const budget = await deployments.budget();
      const slots = budget.slots as Record<string, { available?: unknown }> | undefined;
      return Number(slots?.medium?.available ?? 0);
    }, {
      timeout: 180_000,
      message: "expected the purchased medium Agent slot to become available",
    }).toBeGreaterThan(0);

    const configuredImage = process.env.NEXT_PUBLIC_HERMES_AGENT_IMAGE?.trim() || undefined;
    const created = await deployments.createHermesAgent({
      name: `hermes-e2e-${Date.now().toString(36)}`,
      size: "medium",
      image: configuredImage,
      corsOrigins: [browserOrigin],
    });

    expect(created.runtime, "expected a hermes-agent deployment").toBe("hermes-agent");
    expect(
      String(created.launchConfig?.env?.API_SERVER_CORS_ORIGINS ?? ""),
      "Hermes launch must allow the browser origin",
    ).toContain(browserOrigin);
    expect(
      created.launchConfig?.cors?.allowed_origins,
      "Hermes route CORS must allow the browser origin",
    ).toContain(browserOrigin);

    const stopped = created.state.toUpperCase() === "STOPPED"
      ? created
      : await deployments.waitForState(created.id, ["STOPPED"], 180_000, ["FAILED", "DELETED"]);
    if (!stopped.launchConfig) throw new Error("Hermes deployment returned no launch configuration");
    if (!created.apiServerKey) throw new Error("Hermes deployment returned no API server key");

    await deployments.startHermesAgent(created.id, {
      launchConfig: stopped.launchConfig,
      apiServerKey: created.apiServerKey,
    });
    return created.id;
  } finally {
    deployments.dispose();
  }
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

test.describe.serial("Agents E2E (Hermes)", () => {
  test.describe.configure({ retries: 0 });

  // Always its own identity: the harness identity belongs to the OpenClaw
  // lane, and two trial claims on one identity collide.
  let identity: AdminUserIdentity | null = null;

  test.beforeAll(async () => {
    identity = await bootstrapAdminUser("agents-hermes-e2e");
  });

  test.afterAll(async () => {
    if (identity) await cleanupAdminUser(identity);
  });

  test("trial -> create hermes -> chat -> stop -> delete", async ({ page }) => {
    test.setTimeout(900_000);
    page.on("pageerror", (error) => console.log(`[pageerror] ${String(error.stack || error.message).slice(0, 2000)}`));
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`[console.error] ${message.text().slice(0, 500)}`);
    });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (url.host.endsWith("hypercli.app") || url.host.endsWith("hypercli.com")) {
        console.log(`[requestfailed] ${request.method()} ${url.host}${url.pathname} -> ${request.failure()?.errorText}`);
      }
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if ((url.host.endsWith("hypercli.app")) && response.status() >= 400) {
        console.log(`[response ${response.status()}] ${response.request().method()} ${url.host}${url.pathname}`);
      }
    });

    await loginAs(page, identity!.email);
    await step(page, "logged-in");

    // -- Trial ---------------------------------------------------------------
    // Same hosted Stripe checkout as the OpenClaw lane: paid with the sandbox
    // card, and the redirect back to /dashboard/agents is the contract this
    // spec must not skip.
    await claimTeamTrialThroughStripeCheckout(page);
    await step(page, "trial-claimed");

    // -- Create and start Hermes through the SDK-owned runtime path ------------
    const agentId = await createAndStartHermesAgent(identity!.email);
    await step(page, "created");

    // -- Open the created Agent, then wait for Ready ---------------------------
    await page.goto(`${appBase()}/dashboard/agents?agentId=${encodeURIComponent(agentId)}`, { waitUntil: "domcontentloaded" });
    const sessionEntry = page.getByTestId("agent-launch-entry");
    if (await sessionEntry.isVisible().catch(() => false)) {
      await sessionEntry.click();
    }
    const composer = page.getByTestId("agent-chat-composer");
    await expect(page.getByText("Ready", { exact: true }), "expected Ready without a manual start")
      .toBeVisible({ timeout: 360_000 });
    await expect(composer).toBeEnabled({ timeout: 120_000 });
    await step(page, "ready");

    // -- One chat round-trip over the Hermes API -------------------------------
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
