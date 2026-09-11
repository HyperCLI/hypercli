import { expect, test } from "@playwright/test";

/**
 * The desktop smoke that ships: create a real opencode agent through the UI,
 * start it, send one prompt, require the exact reply, then delete it.
 * Modelled on the CLI live lifecycle job (.github/scripts/cli-ci/live.sh),
 * trimmed to the create → start → chat leg the release depends on.
 *
 * Dev-backend agents chat out of the box — `runtime_scopes` grants `models:*`,
 * so no model env or API key needs to be injected per agent (proven by the
 * CLI lifecycle job's `agents chat ... "Reply with exactly: CI_OK"`).
 */

const PREFIX = "desktop-e2e";
const SUFFIX = `${(process.env.GITHUB_SHA ?? "local").slice(0, 7)}-${Date.now().toString(36).slice(-6)}`;
// Backend rejects names over 32 characters: 12 + 1 + 7 + 1 + 6 = 27.
const AGENT_NAME = `${PREFIX}-${SUFFIX}`;
// Distinctive enough that the assistant echoing it back is the assertion, not
// a guess; mirrors the CLI's CI_OK contract.
const REPLY_TOKEN = "DESKTOP_E2E_OK";

const API_BASE = (process.env.HYPER_API_BASE ?? "https://api.dev.hypercli.com").replace(/\/+$/, "");
const API_KEY = process.env.HYPER_API_KEY ?? "";

interface ListedAgent {
  id: string;
  name?: string | null;
  display_name?: string | null;
  state: string;
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}/agents${path}`, {
    ...init,
    headers: { authorization: `Bearer ${API_KEY}`, ...(init?.headers ?? {}) },
  });
}

async function listAgents(): Promise<ListedAgent[]> {
  const res = await api("/deployments?limit=200");
  if (!res.ok) throw new Error(`list deployments failed: HTTP ${res.status}`);
  const data = (await res.json()) as { items?: ListedAgent[] } | ListedAgent[];
  return Array.isArray(data) ? data : (data.items ?? []);
}

/** Stop-then-delete every e2e-prefixed agent; mirrors the CLI lifecycle sweep. */
async function sweep(): Promise<string[]> {
  const swept: string[] = [];
  for (const agent of await listAgents()) {
    const name = agent.name ?? agent.display_name ?? "";
    if (!name.startsWith(PREFIX)) continue;
    swept.push(name);
    await api(`/deployments/${agent.id}/stop`, { method: "POST" }).catch(() => {});
    await api(`/deployments/${agent.id}`, { method: "DELETE" }).catch(() => {});
  }
  return swept;
}

async function stopAndDelete(id: string): Promise<void> {
  await api(`/deployments/${id}/stop`, { method: "POST" }).catch(() => {});
  await api(`/deployments/${id}`, { method: "DELETE" }).catch(() => {});
}

/** The agent id is not in the DOM; recover it from the roster by name. */
async function findAgentId(name: string): Promise<string | null> {
  for (const agent of await listAgents()) {
    if ((agent.name ?? agent.display_name) === name) return agent.id;
  }
  return null;
}

test.describe("desktop agent chat", () => {
  test.skip(!API_KEY, "HYPER_API_KEY is required to run the desktop e2e suite");

  let createdId: string | null = null;

  test.beforeAll(async () => {
    await sweep();
  });

  test.afterAll(async () => {
    // Best-effort: deletion needs a settled STOPPED state, and a failure later
    // in the test leaves cleanup to the next run's beforeAll sweep.
    if (createdId) await stopAndDelete(createdId);
    await sweep();
  });

  test("create an opencode agent, chat, delete", async ({ page }) => {
    test.setTimeout(8 * 60_000);

    if (process.env.E2E_NET_DEBUG) {
      page.on("request", (r) => console.log("REQ", r.method(), r.url()));
      page.on("response", async (r) => {
        console.log("RES", r.status(), r.url());
        if (r.status() >= 400) console.log("BODY", (await r.text().catch(() => "")).slice(0, 500));
      });
      page.on("requestfailed", (r) => console.log("FAIL", r.method(), r.url(), r.failure()?.errorText));
      page.on("console", (m) => console.log("PAGE", m.type(), m.text().slice(0, 300)));
    }

    await page.goto("/");
    await expect(page.getByRole("button", { name: "New agent" })).toBeVisible();

    await page.getByRole("button", { name: "New agent" }).click();
    // Step 0 is the intro; the footer Next advances to the create form.
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByPlaceholder("Name it — e.g. Ops, Radar, Penny").fill(AGENT_NAME);
    // Agent type defaults to OpenClaw; switch to ACP (OpenCode pre-selected).
    await page.getByRole("button", { name: /^ACP/ }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Get started" }).click();

    // "Get started" is async (createAgent): if it rejects, the modal stays open
    // with the error rendered — surface that text instead of a bare timeout.
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 60_000 });

    // The roster entry materializes when the create request resolves; poll for
    // it rather than racing a single lookup against the async submit.
    await expect
      .poll(async () => (createdId = await findAgentId(AGENT_NAME)), { timeout: 60_000, intervals: [2_000, 5_000, 10_000] })
      .not.toBeNull();

    await page.getByRole("button", { name: "Start agent" }).click();

    // A 429 (slot inventory full) surfaces as an in-app error bar — fail fast
    // with its text instead of silently timing out. The composer unlocks only
    // when the chat transport is ready, covering RUNNING + the ACP handshake.
    const startError = page.getByText("Start agent failed");
    const composer = page.getByPlaceholder(`Message ${AGENT_NAME}…`);
    await expect
      .poll(
        async () => {
          if (await startError.isVisible()) return `start failed: ${await page.locator("body").innerText()}`.slice(0, 400);
          return (await composer.isEnabled()) ? "ready" : "waiting";
        },
        { timeout: 300_000, intervals: [2_000, 5_000, 10_000] },
      )
      .toBe("ready");

    await composer.fill(`Reply with exactly: ${REPLY_TOKEN}`);
    await composer.press("Enter");

    // The user message echoes immediately; require the token to arrive in an
    // assistant row, i.e. a real round trip, not just our own bubble.
    await expect(page.locator(".message-row").filter({ hasText: REPLY_TOKEN }).first())
      .toBeVisible({ timeout: 240_000 });
    const rows = await page.locator(".message-row").allTextContents();
    expect(rows.some((row) => row.includes(REPLY_TOKEN))).toBe(true);
  });
});
