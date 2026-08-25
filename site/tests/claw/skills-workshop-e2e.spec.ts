import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  captureStep,
  deleteClawAgent,
  fetchClawSubscriptionSummary,
  launchClawAgentAndWaitForGateway,
  loginWithPrivy,
} from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const FEAT_APP_BASE_URL = "https://agents.feat.hypercli.com";
const FEAT_API_BASE_URL = "https://api.hypercli.com";
const FEAT_AGENTS_API_BASE_URL = `${FEAT_API_BASE_URL}/agents`;
const FEAT_AGENTS_WS_URL = "wss://api.agents.hypercli.com/ws";

function configureFeatTarget(): void {
  const configuredBaseUrl = (process.env.TEST_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (configuredBaseUrl !== FEAT_APP_BASE_URL) {
    throw new Error(
      `The Skills Workshop lifecycle is feat-only; TEST_BASE_URL must be ${FEAT_APP_BASE_URL}, got ${configuredBaseUrl || "<missing>"}.`,
    );
  }
  const expected = [
    ["TEST_API_BASE_URL", FEAT_API_BASE_URL],
    ["TEST_AGENTS_API_BASE_URL", FEAT_AGENTS_API_BASE_URL],
    ["NEXT_PUBLIC_AGENTS_WS_URL", FEAT_AGENTS_WS_URL],
  ] as const;
  for (const [name, value] of expected) {
    const configured = (process.env[name] ?? "").trim().replace(/\/+$/, "");
    if (configured && configured !== value) {
      throw new Error(`${name} must target the feat backend (${value}), got ${configured}.`);
    }
    process.env[name] = value;
  }
}

configureFeatTarget();

/**
 * Live Skills Workshop lifecycle proof for an already-entitled account.
 *
 * `agents-e2e.spec.ts` is deliberately the wrong harness for this account:
 * its subject is the Stripe trial checkout, and an account that already owns
 * an entitlement has nothing to buy. This spec never touches checkout. It
 * logs in with the configured feat identity (BACKEND_API_KEY or Privy OTP
 * through the established helpers), proves the
 * entitlement has a free launch slot, creates exactly one Agent through the
 * real launch wizard, waits for auto-start and real gateway readiness, and
 * then drives the existing OpenClaw Skill Workshop through chat:
 *
 *   chat asks for 13 deterministic pending proposals
 *   -> Skills shows all 13 under My skills with their mapped descriptions
 *   -> one proposal's authoritative SKILL.md is inspected and approved
 *   -> the approved skill appears installed after refresh
 *   -> a second proposal is rejected through the confirmation dialog
 *
 * Success is never claimed from the assistant's reply text: every contract
 * assertion is made against the Skills UI, which reads the gateway's
 * proposals manifest directly. A UI contract failure after the chat run
 * settles fails the run; only missing prerequisites (no slot or insufficient
 * proposal methods/scopes on the deployed gateway) skip.
 */

const PROPOSAL_COUNT = 13;
const MARKER_PREFIX = "e2e-mapped-skill";
const REQUIRED_PROPOSAL_METHODS = [
  "skills.proposals.list",
  "skills.proposals.inspect",
  "skills.proposals.apply",
  "skills.proposals.reject",
] as const;

type GatewayHelloCapabilities = {
  methods: string[];
  scopes: string[];
  serverVersion: string;
};

function markerName(index: number): string {
  return `${MARKER_PREFIX}-${String(index).padStart(2, "0")}`;
}

function markerDescription(index: number): string {
  return `E2E mapped description ${String(index).padStart(2, "0")}: deterministic review workflow.`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function env(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required for the skills workshop E2E`);
  return value;
}

function appBase(): string {
  return env("TEST_BASE_URL").replace(/\/+$/, "");
}

async function filterCount(filter: Locator, label: string): Promise<number> {
  const ariaLabel = await filter.getAttribute("aria-label");
  const matched = ariaLabel?.match(/\((\d+)\)$/);
  if (!matched) throw new Error(`Could not read ${label} count from aria-label ${ariaLabel ?? "<missing>"}.`);
  return Number(matched[1]);
}

async function waitForProposalsInSkillsUi(
  page: Page,
  proposalNames: string[],
  timeoutMs = 120_000,
): Promise<void> {
  const proposalsBanner = page.getByText(/pending skill reviews could not be loaded/i);
  const retryButton = page.getByRole("button", { name: "Retry pending reviews" });
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let lastLoggedCount = -1;
  while (Date.now() < deadline) {
    if (await proposalsBanner.isVisible().catch(() => false)) {
      // One in-flight list failure is a gateway hiccup, not a verdict: click
      // the panel's own retry rather than abandoning the wait.
      await retryButton.click().catch(() => {});
      await page.waitForTimeout(2_000);
      continue;
    }
    const count = (await Promise.all(
      proposalNames.map((proposalName) => page
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name: proposalName, exact: true }) })
        .isVisible()
        .catch(() => false)),
    )).filter(Boolean).length;
    if (count !== lastLoggedCount) {
      console.log(`[skills-workshop] pending proposal cards visible: ${count}/${PROPOSAL_COUNT}`);
      lastLoggedCount = count;
    }
    lastCount = count;
    if (count === proposalNames.length) return;
    await page.waitForTimeout(2_000);
  }
  throw new Error(
    `Timed out waiting for ${proposalNames.length} chat-requested pending skill proposals in the Skills UI ` +
      `(last observed: ${lastCount}).`,
  );
}

let runOwnedAgentId: string | null = null;

test.describe.serial("Skills Workshop E2E (entitled account)", () => {
  test.describe.configure({ retries: 0 });

  test.afterAll(async ({ browser }) => {
    if (!runOwnedAgentId) return;
    test.setTimeout(600_000);
    const cleanupAgentId = runOwnedAgentId;
    const context = await browser.newContext();
    const cleanupPage = await context.newPage();
    try {
      await loginWithPrivy(cleanupPage);
      await deleteClawAgent(cleanupPage, cleanupAgentId);
      runOwnedAgentId = null;
      console.log(`[skills-workshop] afterAll cleanup recovered agent id=${cleanupAgentId}`);
    } finally {
      await context.close();
    }
  });

  test("chat-driven skill proposals reviewable in Skills", async ({ page }) => {
    test.setTimeout(1_800_000);

    // -- Auth -----------------------------------------------------------------
    await loginWithPrivy(page);
    await captureStep(page, "skills-01-authenticated");

    // -- Prerequisite: the entitlement has a launch slot -----------------------
    // Read the backend-owned slot inventory with the browser's own session
    // before creating anything. This account is shared with other lanes, so a
    // slot occupied by a leftover agent is a skip with a precise reason, not
    // a failure of this spec's subject.
    const summary = await fetchClawSubscriptionSummary(page);
    const inventory = summary?.slotInventory ?? summary?.entitlements?.slotInventory ?? {};
    const slotLines = Object.entries(inventory)
      .map(([tier, slot]) => `${tier}: granted=${slot.granted} used=${slot.used} available=${slot.available ?? Math.max(slot.granted - slot.used, 0)}`);
    const availableSlot = Object.values(inventory).some(
      (slot) => (slot.available ?? Math.max(slot.granted - slot.used, 0)) > 0,
    );
    test.skip(
      !availableSlot,
      "The configured entitled account has no available agent slot " +
        `(${slotLines.join("; ") || "no slot inventory reported"}). ` +
        "Free a slot or delete leftover agents before running the skills workshop E2E.",
    );
    test.skip(
      !summary || Math.max(
        summary.activeEntitlementCount ?? 0,
        summary.entitlements?.activeEntitlementCount ?? 0,
      ) < 1,
      "The configured account has no active entitlement; provision one before running the skills workshop E2E.",
    );
    console.log(`[skills-workshop] slot inventory ${slotLines.join("; ")}`);

    // -- Create exactly one agent through the real UI --------------------------
    // launchClawAgentAndWaitForGateway drives the launch wizard, proves the
    // auto-start (nothing clicks Start), and waits for the gateway route and
    // an authenticated socket. The id is recorded the moment the deployment
    // exists so a later failure can never orphan the agent silently.
    let createdAgentId: string | null = null;
    let gatewayHello: GatewayHelloCapabilities | null = null;
    let proposalsCreated = false;
    try {
      const created = await launchClawAgentAndWaitForGateway(page, 360_000, {
        enableDesktop: false,
        onAgentCreated: (agentId) => {
          createdAgentId = agentId;
          runOwnedAgentId = agentId;
          console.log(`[skills-workshop] created agent id=${agentId}`);
        },
        onGatewayHello: (hello) => {
          gatewayHello = hello;
        },
      });
      createdAgentId ??= String(created.id);
      await captureStep(page, "skills-02-agent-ready");

      // Read the already-open product socket's connect response. This is
      // passive observation only: opening a second gateway connection creates
      // a new device identity and can trigger pairing instead of diagnosing
      // the session that the user interface is actually using.
      expect(
        gatewayHello,
        "expected safe capability metadata from the product gateway session's authenticated hello",
      ).not.toBeNull();
      const capabilities = gatewayHello!;

      const missingMethods = REQUIRED_PROPOSAL_METHODS.filter(
        (method) => !capabilities.methods.includes(method),
      );
      const hasAdminScope = capabilities.scopes.includes("operator.admin");
      test.skip(
        missingMethods.length > 0 || !hasAdminScope,
        `Gateway ${capabilities.serverVersion} lacks proposal mutation support: `
          + `missing methods=${missingMethods.join(",") || "none"}, operator.admin=${hasAdminScope}`,
      );

      // Record the real Skills counts before this run creates anything. A new
      // image may ship bundled or managed skills, so zero is not a valid
      // baseline assumption.
      await page.goto(
        `${appBase()}/dashboard/agents?agentId=${encodeURIComponent(createdAgentId!)}&tab=skills`,
        { waitUntil: "domcontentloaded" },
      );
      const baselineFilterGroup = page.getByRole("group", { name: "Filter skills" });
      const baselineMySkills = baselineFilterGroup.getByRole("button", { name: /my skills/i });
      const baselineAllSkills = baselineFilterGroup.getByRole("button", { name: /^all/i });
      await expect(baselineMySkills).toBeVisible({ timeout: 90_000 });
      const baselineMySkillsCount = await filterCount(baselineMySkills, "My skills");
      const baselineAllSkillsCount = await filterCount(baselineAllSkills, "All skills");

      await page.goto(
        `${appBase()}/dashboard/agents?agentId=${encodeURIComponent(createdAgentId!)}&tab=chat`,
        { waitUntil: "domcontentloaded" },
      );

      // -- Ask the Skill Workshop for 13 deterministic proposals ---------------
      // The prompt pins every name, description, and SKILL.md body marker so
      // the UI assertions below are exact, and forbids applying anything.
      const names = Array.from({ length: PROPOSAL_COUNT }, (_, index) => markerName(index + 1));
      const lines = names
        .map((name, index) => {
          const description = markerDescription(index + 1);
          return `${index + 1}. name "${name}", description "${description}", SKILL.md body starting with "# ${name}"`;
        })
        .join("\n");
      const prompt = [
        "Use the Skill Workshop (your skill-creation proposal flow) to draft exactly 13 new skill proposals.",
        "Do not install, apply, or activate any of them; leave every one pending review.",
        "Use these exact names, descriptions, and bodies, one proposal each, no more and no fewer:",
        lines,
        "When all 13 proposals are drafted, reply with the single line WORKSHOP_DRAFTS_READY.",
      ].join("\n");

      const composer = page.getByTestId("agent-chat-composer");
      await expect(composer).toBeEnabled({ timeout: 60_000 });
      await composer.fill(prompt);
      await composer.press("Enter");
      await captureStep(page, "skills-03-workshop-requested");

      // Wait for the real chat run to settle before leaving the chat tab. The
      // marker is only a completion signal; all success assertions below are
      // made against independently rendered Skills state.
      const stopReply = page.getByRole("button", { name: "Stop reply" });
      const completionMarker = page.getByText("WORKSHOP_DRAFTS_READY", { exact: true }).last();
      await expect.poll(async () => (
        await stopReply.isVisible().catch(() => false)
        || await completionMarker.isVisible().catch(() => false)
      ), { timeout: 60_000 }).toBe(true);
      await expect(stopReply).not.toBeVisible({ timeout: 900_000 });

      // -- Skills: all 13 proposals under My skills -----------------------------
      await page.goto(
        `${appBase()}/dashboard/agents?agentId=${encodeURIComponent(createdAgentId!)}&tab=skills`,
        { waitUntil: "domcontentloaded" },
      );
      await waitForProposalsInSkillsUi(page, names);
      proposalsCreated = true;
      await captureStep(page, "skills-04-proposals-listed");

      const filterGroup = page.getByRole("group", { name: "Filter skills" });
      const mySkillsFilter = filterGroup.getByRole("button", { name: /my skills/i });
      const allSkillsFilter = filterGroup.getByRole("button", { name: /^all/i });
      await expect(mySkillsFilter).toHaveAttribute(
        "aria-label",
        `My skills (${baselineMySkillsCount + PROPOSAL_COUNT})`,
      );
      await expect(mySkillsFilter).toHaveAttribute("aria-pressed", "true");

      // Every pending card must expose the gateway-assigned proposal id; exact
      // names and descriptions prevent an unrelated or duplicate card passing.
      const cardIds: string[] = [];
      for (let index = 1; index <= PROPOSAL_COUNT; index += 1) {
        const name = markerName(index);
        const card = page
          .getByRole("article")
          .filter({ has: page.getByRole("heading", { name, exact: true }) });
        await expect(card, `expected a pending card for ${name}`).toBeVisible();
        await expect(card.getByRole("heading", { name, exact: true })).toBeVisible();
        await expect(card.getByText(markerDescription(index), { exact: true })).toBeVisible();
        await expect(card.getByRole("button", { name: "Review proposal" })).toBeEnabled();
        // Pending reviews are not installed skills: no toggle, no Test run.
        await expect(card.getByRole("switch")).toHaveCount(0);
        await expect(card.getByRole("button", { name: /^test$/i })).toHaveCount(0);
        const testId = await card.getAttribute("data-testid");
        expect(testId, `expected ${name} to expose a stable proposal id`).toMatch(/^skill-proposal-.+/);
        cardIds.push(testId!.slice("skill-proposal-".length));
      }
      expect(new Set(cardIds).size, "expected 13 distinct proposal ids").toBe(PROPOSAL_COUNT);
      // The All count must account for every pending card plus whatever the
      // installed catalog holds; nothing may be double-counted or hidden.
      await expect(allSkillsFilter).toHaveAttribute(
        "aria-label",
        `All skills (${baselineAllSkillsCount + PROPOSAL_COUNT})`,
      );

      // Search narrows to exactly the matching proposal.
      const search = page.getByPlaceholder(/search skills/i);
      await search.fill("mapped description 13");
      await expect(page.getByTestId(`skill-proposal-${cardIds[12]!}`)).toBeVisible();
      await expect(page.getByTestId(`skill-proposal-${cardIds[11]!}`)).toHaveCount(0);
      await search.fill("");
      await captureStep(page, "skills-05-proposals-verified");

      // -- Inspect + approve one proposal ---------------------------------------
      const approveName = markerName(1);
      const approveId = cardIds[0]!;
      await page.getByTestId(`skill-proposal-${approveId}`).getByRole("button", { name: "Review proposal" }).click();
      await expect(page.getByRole("heading", { name: approveName, exact: true })).toBeVisible();
      // The authoritative proposed SKILL.md renders before any apply control.
      await expect(page.getByRole("heading", { name: "Proposed SKILL.md" })).toBeVisible();
      await expect(
        page.getByText(new RegExp(escapeRegExp(`# ${approveName}`))).first(),
        "expected the proposed SKILL.md body to render before approval",
      ).toBeVisible();
      await page.getByRole("button", { name: "Approve skill" }).click();
      await captureStep(page, "skills-06-proposal-approved");

      // Back on the list, the approved proposal has left pending reviews.
      await expect(page.getByPlaceholder(/search skills/i)).toBeVisible();
      await expect(page.getByTestId(`skill-proposal-${approveId}`)).toHaveCount(0);
      // It now renders as an installed skill with its toggle, from the
      // refreshed installed catalog.
      const installedCard = page
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name: approveName, exact: true }) });
      await expect(installedCard, "expected the approved skill to appear installed").toBeVisible({ timeout: 60_000 });
      await expect(
        installedCard.getByRole("switch", { name: new RegExp(`disable ${escapeRegExp(approveName)} skill`, "i") }),
      ).toBeVisible();
      await expect(mySkillsFilter).toHaveAttribute(
        "aria-label",
        `My skills (${baselineMySkillsCount + PROPOSAL_COUNT})`,
      );

      // A hard refresh re-derives from the gateway: still installed, and the
      // approval was not replayed as a new pending review.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByPlaceholder(/search skills/i)).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId(`skill-proposal-${approveId}`)).toHaveCount(0);
      const installedCardAfterReload = page
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name: approveName, exact: true }) });
      await expect(installedCardAfterReload).toBeVisible({ timeout: 90_000 });

      // Open the installed skill: authoritative SKILL.md content and the
      // mapped description come from the gateway read.
      await installedCardAfterReload.getByRole("button", { name: /configure|view details/i }).click();
      await expect(page.getByRole("heading", { name: "SKILL.md" })).toBeVisible();
      await expect(page.getByText(markerDescription(1), { exact: true }).first()).toBeVisible();
      await expect(page.getByText(new RegExp(escapeRegExp(`# ${approveName}`))).first()).toBeVisible();
      await page.getByRole("button", { name: /back to skills/i }).click();
      await expect(page.getByPlaceholder(/search skills/i)).toBeVisible();
      await captureStep(page, "skills-07-installed-verified");

      // -- Reject a second proposal with confirmation ---------------------------
      const rejectName = markerName(2);
      const rejectId = cardIds[1]!;
      await page.getByTestId(`skill-proposal-${rejectId}`).getByRole("button", { name: "Review proposal" }).click();
      await expect(page.getByRole("heading", { name: rejectName, exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Reject", exact: true }).click();
      const rejectDialog = page.getByRole("alertdialog");
      await expect(rejectDialog).toBeVisible();
      await expect(rejectDialog.getByText("Reject pending skill?")).toBeVisible();
      await rejectDialog.getByRole("button", { name: "Reject proposal" }).click();
      await expect(page.getByPlaceholder(/search skills/i)).toBeVisible();
      await expect(page.getByTestId(`skill-proposal-${rejectId}`)).toHaveCount(0);
      // Rejected never became installed: no card carries its heading now.
      await expect(
        page.getByRole("article").filter({ has: page.getByRole("heading", { name: rejectName, exact: true }) }),
      ).toHaveCount(0);
      await expect(mySkillsFilter).toHaveAttribute(
        "aria-label",
        `My skills (${baselineMySkillsCount + PROPOSAL_COUNT - 1})`,
      );
      await captureStep(page, "skills-08-proposal-rejected");
    } finally {
      // -- Best-effort cleanup, by run-owned id only -----------------------------
      // The recorded id is the only agent this run may delete: cleanup never
      // lists-and-deletes, so a pre-existing agent on this shared account is
      // untouchable. deleteClawAgent settles the deployment into a deletable
      // state first and rides out edge windows; its failure is logged, not
      // fatal, because the test's verdict is already decided.
      if (createdAgentId) {
        await deleteClawAgent(page, createdAgentId)
          .then(() => {
            runOwnedAgentId = null;
            console.log(`[skills-workshop] cleaned up agent id=${createdAgentId}`);
          })
          .catch((error) => {
            console.log(
              `[skills-workshop] cleanup failed for agent id=${createdAgentId} (proposals created: ${proposalsCreated}): ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
      }
    }
  });
});
