import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Locator, type Page } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const TEST_WORKSPACE_ID = "workspace-direct-entitlement";

const WIZARD_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 768, height: 720 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

async function expectWizardToFit(page: Page, workspaceStep: Locator) {
  for (const viewport of WIZARD_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(workspaceStep).toBeVisible();
    await expect.poll(() => workspaceStep.evaluate((root) => {
      const surface = root.closest<HTMLElement>("[data-agent-launch-surface]") ?? (root as HTMLElement);
      const body = root.querySelector<HTMLElement>('[data-slot="agent-setup-scroll-body"]');
      const panel = root.querySelector<HTMLElement>('[data-slot="shape-agent-content"]');
      const footer = root.querySelector<HTMLElement>('[data-slot="agent-setup-footer"]');
      const problems: string[] = [];

      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
        problems.push("document overflows horizontally");
      }

      for (const [name, element] of [["surface", surface], ["body", body], ["panel", panel], ["footer", footer]] as const) {
        if (!element) {
          problems.push(`${name} is missing`);
          continue;
        }
        if (element.scrollWidth > element.clientWidth + 1) {
          problems.push(`${name} overflows horizontally`);
        }
        if (element.scrollHeight > element.clientHeight + 1) {
          const overflowY = window.getComputedStyle(element).overflowY;
          if (overflowY !== "auto" && overflowY !== "scroll") {
            problems.push(`${name} clips vertical content`);
          }
        }
      }

      const surfaceBox = surface.getBoundingClientRect();
      if (surfaceBox.left < -1 || surfaceBox.right > window.innerWidth + 1) {
        problems.push(`surface spans ${Math.round(surfaceBox.left)}..${Math.round(surfaceBox.right)} in ${window.innerWidth}px viewport`);
      }
      if (surfaceBox.top < -1 || surfaceBox.bottom > window.innerHeight + 1) {
        problems.push(`surface spans ${Math.round(surfaceBox.top)}..${Math.round(surfaceBox.bottom)} in ${window.innerHeight}px viewport height`);
      }

      return problems;
    })).toEqual([]);
  }
}

test("agents page launches from a direct entitlement without an active subscription", async ({ page }) => {
  let createBody: Record<string, unknown> | null = null;
  let createdAgent: Record<string, unknown> | null = null;

  await page.context().addCookies([
    {
      name: "auth_token",
      value: TEST_JWT,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  await page.addInitScript((token) => {
    window.localStorage.setItem("claw_auth_token", token);
  }, TEST_JWT);

  await page.route(/\/workspaces(?:\/.*)?$/, async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const workspace = {
      id: TEST_WORKSPACE_ID,
      name: "Direct Entitlement",
      slug: TEST_WORKSPACE_ID,
      display_name: "Direct Entitlement",
      role: "admin",
    };

    if (
      pathName.endsWith(`/workspaces/${TEST_WORKSPACE_ID}/agents`)
      || pathName.endsWith(`/workspaces/${TEST_WORKSPACE_ID}/grants`)
    ) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pathName.endsWith(`/workspaces/${TEST_WORKSPACE_ID}`) ? workspace : [workspace]),
    });
  });

  await page.route("**/agents/**", async (route) => {
    const url = new URL(route.request().url());
    const pathName = url.pathname;
    const method = route.request().method();

    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createdAgent ? [createdAgent] : []),
      });
      return;
    }

    if (pathName.endsWith("/agents/deployments") && method === "POST") {
      createBody = route.request().postDataJSON();
      createdAgent = {
        id: "agent-direct-entitlement",
        name: "Direct Entitlement Agent",
        user_id: "user-1",
        state: "STOPPED",
        cpu: 4,
        memory: 4,
        hostname: null,
        launch_epoch: 0,
        agent_version: 1,
        resources_exist: false,
        namespace_exists: false,
        created_at: "2026-05-17T00:00:00Z",
        updated_at: "2026-05-17T00:00:00Z",
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createdAgent),
      });
      return;
    }

    if (pathName.endsWith("/agents/deployments/agent-direct-entitlement/start") && method === "POST") {
      if (!createdAgent) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Agent not found" }) });
        return;
      }
      createdAgent = {
        ...createdAgent,
        state: "CREATING",
        launch_epoch: 1,
        agent_version: 2,
        resources_exist: true,
        namespace_exists: true,
        updated_at: "2026-05-17T00:01:00Z",
      };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent) });
      return;
    }

    if (pathName.endsWith("/agents/deployments/agent-direct-entitlement") && method === "GET" && createdAgent) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createdAgent) });
      return;
    }

    if (pathName.endsWith("/agents/plans")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plans: [
            {
              id: "pro",
              name: "Pro",
              price: 99,
              price_usd: 99,
              highlighted: true,
              features: ["Priority routing", "250M tokens/day"],
              models: [],
              limits: { tpd: 250000000, burst_tpm: 8680550, rpm: 868 },
              slot_grants: { large: 1 },
            },
          ],
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
          slot_inventory: {
            large: { granted: 1, used: 0, available: 1 },
          },
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
          current_subscription_id: null,
          current_entitlement_id: "ent-direct-1",
          pooled_tpm_limit: 8680550,
          pooled_rpm_limit: 868,
          pooled_tpd: 250000000,
          slot_inventory: {
            large: { granted: 1, used: 0, available: 1 },
          },
          active_subscription_count: 0,
          active_entitlement_count: 1,
          entitlements: {
            effective_plan_id: "pro",
            pooled_tpm_limit: 8680550,
            pooled_rpm_limit: 868,
            pooled_tpd: 250000000,
            slot_inventory: {
              large: { granted: 1, used: 0, available: 1 },
            },
            active_entitlement_count: 1,
          },
          entitlement_items: [
            {
              id: "ent-direct-1",
              user_id: "user-1",
              subscription_id: null,
              plan_id: "pro",
              plan_name: "Pro",
              provider: "ACTIVATION_CODE",
              status: "ACTIVE",
              slot_grants: { large: 1 },
            },
          ],
          active_subscriptions: [],
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
        body: JSON.stringify({
          types: [
            { id: "small", name: "Small", cpu: 0.5, memory: 2 },
            { id: "medium", name: "Medium", cpu: 1, memory: 4 },
            { id: "large", name: "Large", cpu: 2, memory: 8 },
          ],
          plans: [],
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/dashboard/agents", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Launch your first agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Create an agent/ })).toBeVisible();
  const welcomePanelBox = await page.locator('[data-slot="first-agent-empty-state"]').boundingBox();
  expect(welcomePanelBox).not.toBeNull();

  await page.goto("/dashboard/agents?open=agent-launcher", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("dialog", { name: "A quick tour of your agent workspace" })).toHaveCount(0);
  const createAgentHeading = page.getByRole("heading", { name: "Create agent" });
  if (!await createAgentHeading.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.locator("main").getByRole("button", { name: "Launch agent", exact: true }).last().click();
  }
  await expect(createAgentHeading).toBeVisible();
  await expect(page.locator(".agent-desktop-navigation")).toHaveAttribute("data-expanded-section", "agents");
  const launcherBox = await page.locator("[data-agent-launch-surface]").boundingBox();
  expect(launcherBox).not.toBeNull();
  expect(Math.abs(launcherBox!.x - welcomePanelBox!.x)).toBeLessThan(1);
  expect(Math.abs(launcherBox!.y - welcomePanelBox!.y)).toBeLessThan(1);
  expect(Math.abs(launcherBox!.width - welcomePanelBox!.width)).toBeLessThan(1);
  expect(Math.abs(launcherBox!.height - welcomePanelBox!.height)).toBeLessThan(1);
  const advancedSettings = page.locator("details", {
    has: page.locator("summary").filter({ hasText: /^Advanced$/i }),
  }).first();
  await expect(advancedSettings).not.toHaveAttribute("open", "");
  await advancedSettings.locator("summary").click();
  await expect(advancedSettings).toHaveAttribute("open", "");
  await page
    .locator("label")
    .filter({ hasText: /Desktop browser/i })
    .locator("input[type='checkbox']")
    .first()
    .check();
  await page.getByRole("button", { name: "Continue" }).click();
  const workspaceStep = page.getByRole("region", { name: "Set up the workspace" });
  await expect(workspaceStep).toBeVisible();
  await expect(workspaceStep.getByRole("heading", { name: "What do you want to get done?" })).toBeVisible();
  await expect(workspaceStep.getByRole("region", { name: "Workspace file editor" })).toHaveCount(0);
  await expect(workspaceStep.getByRole("group", { name: "Workspace files" })).toHaveCount(0);
  await expect(workspaceStep.locator('[data-slot="openclaw-bootstrap-step"] > section')).toHaveCount(1);
  const workspaceBody = workspaceStep.locator('[data-slot="agent-setup-scroll-body"]');
  await expectWizardToFit(page, workspaceStep);

  await expect.poll(async () => {
    const expandedLauncherBox = await page.locator("[data-agent-launch-surface]").boundingBox();
    return expandedLauncherBox?.height ?? 0;
  }).toBeGreaterThan(800);
  await expect.poll(() => workspaceBody.evaluate((element) => {
    const layout = element.querySelector<HTMLElement>('[data-slot="openclaw-bootstrap-step"]');
    if (!layout) return Number.POSITIVE_INFINITY;
    const bodyBox = element.getBoundingClientRect();
    const layoutBox = layout.getBoundingClientRect();
    const panel = layout.querySelector<HTMLElement>(":scope > section");
    if (!panel) return Number.POSITIVE_INFINITY;
    const panelBox = panel.getBoundingClientRect();
    const styles = window.getComputedStyle(element);
    const expectedTop = bodyBox.top + Number.parseFloat(styles.paddingTop);
    const expectedBottom = bodyBox.bottom - Number.parseFloat(styles.paddingBottom);
    return Math.max(
      Math.abs(layoutBox.top - expectedTop),
      Math.abs(layoutBox.bottom - expectedBottom),
      Math.abs(panelBox.top - layoutBox.top),
      Math.abs(panelBox.bottom - layoutBox.bottom),
      Math.abs(panelBox.width - layoutBox.width),
    );
  })).toBeLessThanOrEqual(2);
  await workspaceStep.getByRole("button", { name: "Continue" }).click();
  await expect(workspaceStep.getByRole("heading", { name: /approach the work/ })).toBeVisible();
  await expect(workspaceStep.locator('[data-slot="shape-agent-content"]')).toHaveAttribute("data-workspace-stage", "personality");
  await expectWizardToFit(page, workspaceStep);
  await workspaceStep.getByRole("button", { name: "Launch agent" }).click();

  await expect(workspaceStep).toHaveCount(0);
  const startup = page.getByRole("region", { name: "Agent startup" });
  await expect(startup).toBeVisible();
  await expect(startup.getByText("Creating agent")).toBeVisible();
  await expect(startup.getByText("Preparing persistent storage and admitting the runtime.")).toBeVisible();
  await expect(startup.getByRole("button", { name: "Stop agent" })).toBeVisible();

  await expect.poll(() => createBody?.size ?? null).toBe("large");
  expect(String(createBody?.image ?? "")).toMatch(/^ghcr\.io\/hypercli\/hypercli-openclaw:pro-/);
  expect(createBody?.env).toMatchObject({
    HYPER_WORKSPACES_BOOT_SYNC: "1",
    HYPER_WORKSPACES_DIR: "/home/node/shared",
    HYPER_WORKSPACES_SYNC_READY_ONLY: "1",
    OPENCLAW_DESKTOP_ENABLED: "1",
  });
  expect(createBody?.routes).toMatchObject({
    openclaw: { port: 18789, auth: false, prefix: "" },
    desktop: { port: 3000, auth: true, prefix: "desktop" },
  });
});
