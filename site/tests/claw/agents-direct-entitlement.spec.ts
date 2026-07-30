import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const TEST_WORKSPACE_ID = "workspace-direct-entitlement";

test("agents page launches from a direct entitlement without an active subscription", async ({ page }) => {
  let createBody: Record<string, unknown> | null = null;

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
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }

    if (pathName.endsWith("/agents/deployments") && method === "POST") {
      createBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "agent-direct-entitlement",
          name: "Direct Entitlement Agent",
          user_id: "user-1",
          state: "STARTING",
          cpu: 4,
          memory: 4,
          hostname: "direct-entitlement-agent.hypercli.app",
          created_at: "2026-05-17T00:00:00Z",
          updated_at: "2026-05-17T00:00:00Z",
        }),
      });
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
            { id: "small", name: "Small", cpu: 1, memory: 1, cpu_limit: 1, memory_limit: 1 },
            { id: "medium", name: "Medium", cpu: 2, memory: 2, cpu_limit: 2, memory_limit: 2 },
            { id: "large", name: "Large", cpu: 4, memory: 4, cpu_limit: 4, memory_limit: 4 },
          ],
          plans: [],
        }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/dashboard/agents", { waitUntil: "domcontentloaded" });

  const emptyWorkspaceComposer = page.getByRole("textbox", { name: "Message agent" });
  await expect(emptyWorkspaceComposer).toBeVisible();
  await expect(emptyWorkspaceComposer).toBeDisabled();
  await expect(emptyWorkspaceComposer).toHaveAttribute("placeholder", "Launch an agent to start chatting...");
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  const welcomePanelBox = await page.locator('[data-slot="first-agent-empty-state"]').boundingBox();
  expect(welcomePanelBox).not.toBeNull();

  await page.goto("/dashboard/agents?open=agent-launcher", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("dialog", { name: "A quick tour of your agent workspace" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Create agent" })).toBeVisible();
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
  await expect(workspaceStep.getByRole("heading", { name: "Shape the agent" })).toBeVisible();
  await expect(workspaceStep.getByRole("heading", { name: "Generated workspace files" })).toBeVisible();
  await expect(workspaceStep.getByText("AGENTS.md ready")).toHaveCount(0);
  await expect(workspaceStep.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
  await workspaceStep.getByRole("button", { name: "Raw" }).click();
  await expect(workspaceStep.getByLabel("AGENTS.md contents")).toBeVisible();
  await workspaceStep.getByRole("button", { name: "Preview" }).click();
  const workspaceBody = workspaceStep.locator('[data-slot="agent-setup-scroll-body"]');
  const workspaceOverflow = await workspaceBody.evaluate((element) => ({
    horizontal: element.scrollWidth - element.clientWidth,
    vertical: element.scrollHeight - element.clientHeight,
  }));
  expect(workspaceOverflow.horizontal).toBeLessThanOrEqual(0);
  expect(workspaceOverflow.vertical).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => {
    const expandedLauncherBox = await page.locator("[data-agent-launch-surface]").boundingBox();
    return expandedLauncherBox?.height ?? 0;
  }).toBeGreaterThan(800);
  await expect.poll(() => workspaceBody.evaluate((element) => {
    const layout = element.querySelector<HTMLElement>('[data-slot="openclaw-bootstrap-step"]');
    if (!layout) return Number.POSITIVE_INFINITY;
    const bodyBox = element.getBoundingClientRect();
    const layoutBox = layout.getBoundingClientRect();
    const panels = layout.querySelectorAll<HTMLElement>(":scope > section");
    const panelHeightDifference = panels.length === 2
      ? Math.abs(panels[0].getBoundingClientRect().height - panels[1].getBoundingClientRect().height)
      : Number.POSITIVE_INFINITY;
    const styles = window.getComputedStyle(element);
    const expectedTop = bodyBox.top + Number.parseFloat(styles.paddingTop);
    const expectedBottom = bodyBox.bottom - Number.parseFloat(styles.paddingBottom);
    return Math.max(
      Math.abs(layoutBox.top - expectedTop),
      Math.abs(layoutBox.bottom - expectedBottom),
      panelHeightDifference,
    );
  })).toBeLessThanOrEqual(2);
  await workspaceStep.getByRole("button", { name: "Launch agent" }).click();

  await expect.poll(() => createBody?.size ?? null).toBe("large");
  expect(String(createBody?.image ?? "")).toMatch(/^ghcr\.io\/hypercli\/hypercli-openclaw:pro-/);
  expect(createBody?.env).toMatchObject({
    HYPER_WORKSPACES_BOOT_SYNC: "1",
    HYPER_WORKSPACES_DIR: "/home/node/workspaces",
    HYPER_WORKSPACES_SYNC_READY_ONLY: "1",
    OPENCLAW_DESKTOP_ENABLED: "1",
  });
  expect(createBody?.routes).toMatchObject({
    openclaw: { port: 18789, auth: false, prefix: "" },
    desktop: { port: 3000, auth: true, prefix: "desktop" },
  });
});
