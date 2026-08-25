import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import { installMockGateway, inspectMockGateway, type MockGatewaySkillProposal } from "./fixtures/mock-openclaw-gateway";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

/**
 * Deterministic browser lane for the Claw Skills workflow's failure and
 * permission states.
 *
 * The live lifecycle proof (one entitled account, one real agent, chat-driven
 * Skill Workshop proposals) lives in `skills-workshop-e2e.spec.ts`. The states
 * in this spec cannot be produced on demand against a live gateway — a
 * revision conflict requires a second writer racing the reviewer, read-only
 * scopes require a differently-scoped token, and a list RPC failure requires
 * the gateway to fail exactly one method — so they are exercised here with
 * the real app composition (Next.js app, `useOpenClawSession`, the SDK
 * `GatewayClient`) against a mock in-page gateway WebSocket, the same seam
 * `openclaw-reconnect-token-refresh.spec.ts` already uses.
 *
 * What this proves above the component suite:
 *   - the wiring from the page through `useSkillProposals` and the SDK
 *     provider into the gateway RPCs works against the real composition,
 *     including capability gating from the authenticated hello;
 *   - revision-bound decisions send `expectedRevisionHash` from the inspect;
 *   - a stale apply keeps the detail open, and reload is what clears it;
 *   - mutations are single-shot: no silent replay after a failure or across a
 *     socket restart.
 */

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const AGENT_ID = "agent-skills-intercepted";
const AGENT_HOSTNAME = "agent-skills-intercepted.example.test";

function proposal(index: number, overrides: Partial<MockGatewaySkillProposal> = {}): MockGatewaySkillProposal {
  const suffix = String(index).padStart(2, "0");
  return {
    id: `mapped-skill-${suffix}-20260824-abcdef0123`,
    skillName: `Mapped skill ${suffix}`,
    skillKey: `mapped-skill-${suffix}`,
    description: `Correct description for mapped skill ${suffix}.`,
    content: [
      "---",
      `name: mapped-skill-${suffix}`,
      `description: Correct description for mapped skill ${suffix}.`,
      "---",
      `# Mapped skill ${suffix}`,
      "",
      `Follow the mapped workflow ${suffix} exactly.`,
    ].join("\n"),
    revisionHash: `${"a".repeat(60)}${suffix}`,
    ...overrides,
  };
}

function proposals(count: number): MockGatewaySkillProposal[] {
  return Array.from({ length: count }, (_, index) => proposal(index + 1));
}

async function installAuth(page: Page): Promise<void> {
  const baseUrl = (process.env.TEST_BASE_URL ?? "").trim();
  if (!baseUrl) throw new Error("TEST_BASE_URL is required for the intercepted Skills tests");
  await page.context().addCookies([
    {
      name: "auth_token",
      value: TEST_JWT,
      url: new URL(baseUrl).origin,
      httpOnly: false,
      secure: new URL(baseUrl).protocol === "https:",
      sameSite: "Lax",
    },
  ]);
  await page.addInitScript((token) => {
    window.localStorage.setItem("claw_auth_token", token);
  }, TEST_JWT);
}

async function interceptBackend(page: Page): Promise<void> {
  const deployment = {
    id: AGENT_ID,
    name: "Skills Intercepted Agent",
    user_id: "user-1",
    state: "RUNNING",
    cpu: 2,
    memory: 8,
    hostname: AGENT_HOSTNAME,
    openclaw_url: `wss://${AGENT_HOSTNAME}`,
    gateway_url: `wss://${AGENT_HOSTNAME}`,
    launch_epoch: 1,
    routes: { openclaw: { port: 18789, auth: false, prefix: "" } },
    created_at: "2026-08-24T00:00:00Z",
    updated_at: "2026-08-24T00:00:00Z",
  };

  await page.route("**/agents/**", async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const method = route.request().method();

    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}/routes`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agent_id: AGENT_ID,
          routes: deployment.routes,
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
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}/secrets/OPENCLAW_GATEWAY_TOKEN`)) {
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
    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}`) && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(deployment) });
      return;
    }
    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([deployment]) });
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
            features: [],
            models: [],
            limits: { tpd: 250000000, burst_tpm: 8680550, rpm: 868 },
            slot_grants: { large: 1 },
          }],
        }),
      });
      return;
    }
    if (pathName.endsWith("/agents/plans/current")) {
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
    if (pathName.endsWith("/agents/subscriptions/summary")) {
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

  await page.route("**/api/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user-1",
        email: "skills-intercepted@example.test",
        name: "Skills Intercepted",
      }),
    });
  });

  await page.route(/\/workspaces(?:\/.*)?$/, async (route) => {
    const workspace = {
      id: "workspace-skills-intercepted",
      name: "Skills Intercepted",
      slug: "workspace-skills-intercepted",
      display_name: "Skills Intercepted",
      role: "admin",
    };
    const pathName = new URL(route.request().url()).pathname;
    if (pathName.includes("/agents") || pathName.includes("/grants")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pathName.endsWith(`/${workspace.id}`) ? workspace : [workspace]),
    });
  });
}

async function openSkillsTab(page: Page): Promise<void> {
  await page.goto(`/dashboard/agents?agentId=${encodeURIComponent(AGENT_ID)}&tab=skills`, {
    waitUntil: "domcontentloaded",
  });
  const search = page.getByPlaceholder(/search skills/i);
  const pendingBanner = page.getByText(/pending skill reviews could not be loaded/i);
  await expect
    .poll(async () => ((await search.count()) > 0 ? "panel" : (await pendingBanner.count()) > 0 ? "error" : "loading"), {
      timeout: 90_000,
    })
    .not.toBe("loading");
}

const filterGroup = (page: Page) => page.getByRole("group", { name: "Filter skills" });

test.describe("Skills proposals (intercepted gateway)", () => {
  test("lists every mapped proposal under My skills with mapped descriptions, counts, search, and no installed controls", async ({ page }) => {
    const mapped = proposals(13);
    await installMockGateway(page, {
      proposals: mapped,
      installedSkills: [{
        skillKey: "notion",
        name: "Notion",
        description: "Notion workspace pages.",
      }],
    });
    await installAuth(page);
    await interceptBackend(page);
    await openSkillsTab(page);

    const mySkills = filterGroup(page).getByRole("button", { name: /my skills/i });
    const allSkills = filterGroup(page).getByRole("button", { name: /^all/i });
    await expect(mySkills).toHaveAttribute("aria-label", "My skills (14)");
    await expect(mySkills).toHaveAttribute("aria-pressed", "true");
    await expect(allSkills).toHaveAttribute("aria-label", "All skills (14)");

    for (const entry of mapped) {
      const card = page.getByTestId(`skill-proposal-${entry.id}`);
      await expect(card).toBeVisible();
      await expect(card.getByRole("heading", { name: entry.skillName, exact: true })).toBeVisible();
      await expect(card.getByText(entry.description, { exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Review proposal" })).toBeEnabled();
      // Pending cards are reviews, not installed skills: no toggle or Test.
      await expect(card.getByRole("switch")).toHaveCount(0);
      await expect(card.getByRole("button", { name: /^test$/i })).toHaveCount(0);
    }

    const search = page.getByPlaceholder(/search skills/i);
    await search.fill("description for mapped skill 13");
    await expect(page.getByTestId(`skill-proposal-${mapped[12]!.id}`)).toBeVisible();
    await expect(page.getByTestId(`skill-proposal-${mapped[11]!.id}`)).toHaveCount(0);
    await expect(page.getByText("Notion", { exact: true })).toHaveCount(0);

    await search.fill("");
    await allSkills.click();
    await expect(allSkills).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Notion", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`skill-proposal-${mapped[0]!.id}`)).toBeVisible();
  });

  test("inspects authoritative SKILL.md, applies once with the inspected revision, and shows the installed skill after refresh", async ({ page }) => {
    const mapped = proposals(2);
    await installMockGateway(page, { proposals: mapped });
    await installAuth(page);
    await interceptBackend(page);
    await openSkillsTab(page);

    // Open the first proposal and prove the authoritative body renders before apply.
    await page.getByTestId(`skill-proposal-${mapped[0]!.id}`).getByRole("button", { name: "Review proposal" }).click();
    await expect(page.getByRole("heading", { name: mapped[0]!.skillName, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Proposed SKILL.md" })).toBeVisible();
    await expect(page.getByRole("heading", { name: `Mapped skill 01`, exact: true }).nth(1)).toBeVisible();
    await expect(page.getByText("Follow the mapped workflow 01 exactly.")).toBeVisible();

    await page.getByRole("button", { name: "Approve skill" }).click();

    // The decision goes back to the list with the proposal gone from pending.
    await expect(page.getByPlaceholder(/search skills/i)).toBeVisible();
    await expect(page.getByTestId(`skill-proposal-${mapped[0]!.id}`)).toHaveCount(0);
    const wire = await inspectMockGateway(page);
    expect(wire.applyCalls).toEqual([{ proposalId: mapped[0]!.id, expectedRevisionHash: mapped[0]!.revisionHash }]);

    // The apply flow refreshed the installed catalog: one proposal remains
    // pending and the approved proposal now renders as one installed skill.
    const appliedCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: mapped[0]!.skillName, exact: true }) });
    await expect(appliedCard).toBeVisible();
    await expect(appliedCard.getByRole("switch", { name: new RegExp(`disable ${mapped[0]!.skillName} skill`, "i") })).toBeVisible();
    await expect(filterGroup(page).getByRole("button", { name: /my skills/i })).toHaveAttribute("aria-label", "My skills (2)");

    // A full reload re-derives everything from the gateway: the applied
    // proposal is not pending again and the skill is still installed.
    await page.reload({ waitUntil: "domcontentloaded" });
    const searchAfterReload = page.getByPlaceholder(/search skills/i);
    await expect(searchAfterReload).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId(`skill-proposal-${mapped[0]!.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`skill-proposal-${mapped[1]!.id}`)).toBeVisible();
    const installedCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: mapped[0]!.skillName, exact: true }) });
    await expect(installedCard).toBeVisible();

    // Open the installed skill and verify the authoritative SKILL.md body and
    // description come from the gateway read, not a cached copy.
    await installedCard.getByRole("button", { name: /configure|view details/i }).click();
    await expect(page.getByRole("heading", { name: "SKILL.md" })).toBeVisible();
    await expect(page.getByText(mapped[0]!.description, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Follow the mapped workflow 01 exactly.")).toBeVisible();

    // No mutation was replayed by the refresh or the reload.
    const wireAfter = await inspectMockGateway(page);
    expect(wireAfter.applyCalls).toHaveLength(1);
    expect(wireAfter.rejectCalls).toHaveLength(0);
  });

  test("rejects a second proposal through the confirmation dialog without installing it", async ({ page }) => {
    const mapped = proposals(2);
    await installMockGateway(page, { proposals: mapped });
    await installAuth(page);
    await interceptBackend(page);
    await openSkillsTab(page);

    await page.getByTestId(`skill-proposal-${mapped[1]!.id}`).getByRole("button", { name: "Review proposal" }).click();
    await expect(page.getByRole("heading", { name: mapped[1]!.skillName, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reject", exact: true }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Reject pending skill?")).toBeVisible();
    await dialog.getByRole("button", { name: "Reject proposal" }).click();

    await expect(page.getByPlaceholder(/search skills/i)).toBeVisible();
    await expect(page.getByTestId(`skill-proposal-${mapped[1]!.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`skill-proposal-${mapped[0]!.id}`)).toBeVisible();

    const wire = await inspectMockGateway(page);
    expect(wire.rejectCalls).toEqual([{ proposalId: mapped[1]!.id, expectedRevisionHash: mapped[1]!.revisionHash }]);
    expect(wire.applyCalls).toHaveLength(0);
    // The rejected skill never became an installed card.
    await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: mapped[1]!.skillName, exact: true }) })).toHaveCount(0);
  });

  test("keeps the detail open on a stale revision conflict and recovers only through reload", async ({ page }) => {
    const mapped = [proposal(1)];
    await installMockGateway(page, { proposals: mapped, staleApplyOnceFor: mapped[0]!.id });
    await installAuth(page);
    await interceptBackend(page);
    await openSkillsTab(page);

    await page.getByTestId(`skill-proposal-${mapped[0]!.id}`).getByRole("button", { name: "Review proposal" }).click();
    await expect(page.getByText("Follow the mapped workflow 01 exactly.")).toBeVisible();
    await page.getByRole("button", { name: "Approve skill" }).click();

    // The stale conflict surfaces in place; the proposal is not dismissed and
    // the failed decision is not retried implicitly.
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert.getByText(/reload the latest proposal/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: mapped[0]!.skillName, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve skill" })).toBeEnabled();
    const wireAfterConflict = await inspectMockGateway(page);
    expect(wireAfterConflict.applyCalls).toHaveLength(1);
    expect(wireAfterConflict.pendingIds).toEqual([mapped[0]!.id]);

    // Reloading re-inspects and picks up the revised hash; approving again
    // succeeds with exactly one more wire apply carrying the new revision.
    await page.getByRole("button", { name: "Reload proposal" }).click();
    await expect(page.getByText("Follow the mapped workflow 01 exactly.")).toBeVisible();
    await page.getByRole("button", { name: "Approve skill" }).click();
    await expect(page.getByPlaceholder(/search skills/i)).toBeVisible();
    await expect(page.getByTestId(`skill-proposal-${mapped[0]!.id}`)).toHaveCount(0);

    const wireAfterRecovery = await inspectMockGateway(page);
    expect(wireAfterRecovery.applyCalls).toEqual([
      { proposalId: mapped[0]!.id, expectedRevisionHash: mapped[0]!.revisionHash },
      { proposalId: mapped[0]!.id, expectedRevisionHash: `${mapped[0]!.revisionHash}-revised` },
    ]);
  });

  test("gates mutation controls for a read-only operator while leaving inspection open", async ({ page }) => {
    const mapped = [proposal(3)];
    await installMockGateway(page, { proposals: mapped, scopes: ["operator.read"] });
    await installAuth(page);
    await interceptBackend(page);
    await openSkillsTab(page);

    const card = page.getByTestId(`skill-proposal-${mapped[0]!.id}`);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Review proposal" }).click();

    // operator.read may review the authoritative body...
    await expect(page.getByRole("heading", { name: mapped[0]!.skillName, exact: true })).toBeVisible();
    await expect(page.getByText("Follow the mapped workflow 03 exactly.")).toBeVisible();
    // ...but the approval and rejection controls are not offered at all.
    await expect(page.getByRole("button", { name: "Approve skill" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);

    const wire = await inspectMockGateway(page);
    expect(wire.applyCalls).toHaveLength(0);
    expect(wire.rejectCalls).toHaveLength(0);
  });

  test("shows the proposals error banner with retry when the list RPC fails, without hiding installed skills", async ({ page }) => {
    await installMockGateway(page, {
      methods: [
        "config.get",
        "config.schema",
        "chat.history",
        "agents.list",
        "files.list",
        "skills.status",
        "skills.read",
        "skills.update",
        // skills.proposals.* deliberately absent: the deployed gateway lacks them.
      ],
      installedSkills: [{ skillKey: "notion", name: "Notion", description: "Notion workspace pages." }],
    });
    await installAuth(page);
    await interceptBackend(page);
    await openSkillsTab(page);

    await expect(page.getByText(/pending skill reviews could not be loaded/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry pending reviews" })).toBeVisible();
    // Installed skills are not collateral damage of a proposals failure.
    await expect(page.getByText("Notion", { exact: true })).toBeVisible();
    await expect(filterGroup(page).getByRole("button", { name: /my skills/i })).toHaveAttribute("aria-label", "My skills (1)");
  });

  test("recovers proposals and mutations after a gateway restart without replaying them", async ({ page }) => {
    const mapped = proposals(2);
    await installMockGateway(page, { proposals: mapped, restartOnce: true });
    await installAuth(page);
    await interceptBackend(page);
    await openSkillsTab(page);

    // The first socket dies right after its hello; the app's reconnect path
    // must re-list against live state and still show both pending cards.
    for (const entry of mapped) {
      await expect(page.getByTestId(`skill-proposal-${entry.id}`)).toBeVisible({ timeout: 90_000 });
    }

    await page.getByTestId(`skill-proposal-${mapped[1]!.id}`).getByRole("button", { name: "Review proposal" }).click();
    await expect(page.getByText("Follow the mapped workflow 02 exactly.")).toBeVisible();
    await page.getByRole("button", { name: "Approve skill" }).click();
    await expect(page.getByPlaceholder(/search skills/i)).toBeVisible();
    await expect(page.getByTestId(`skill-proposal-${mapped[1]!.id}`)).toHaveCount(0);

    const wire = await inspectMockGateway(page);
    expect(wire.socketCount).toBeGreaterThanOrEqual(2);
    // Exactly one apply across the disconnect: reconnecting never replays.
    expect(wire.applyCalls).toEqual([{ proposalId: mapped[1]!.id, expectedRevisionHash: mapped[1]!.revisionHash }]);
  });
});
