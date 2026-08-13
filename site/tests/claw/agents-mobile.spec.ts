import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Locator, type Page } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const TEST_BASE_URL = process.env.TEST_BASE_URL?.trim() || "http://127.0.0.1:4003";
const AGENT_ID = "agent-mobile-layout";
const TEST_WORKSPACE_ID = "workspace-mobile-layout";
const README_PATH = ".openclaw/workspace/README.md";
const README_CONTENT = "# Mobile workspace\n\nThis file verifies that the mobile editor drawer fits the available width.";

const mobileAgent = {
  id: AGENT_ID,
  user_id: "user-mobile",
  name: "Mobile Regression Agent",
  state: "RUNNING",
  cpu: 4,
  memory: 4,
  hostname: "mobile-regression-agent.hypercli.test",
  started_at: "2026-05-18T00:00:00Z",
  stopped_at: null,
  created_at: "2026-05-18T00:00:00Z",
  updated_at: "2026-05-18T00:00:00Z",
  routes: {},
  launch_config: {
    sync_root: "/home/node",
  },
  meta: {
    ui: {
      icon_index: 0,
    },
  },
};

const offlineMobileAgent = {
  ...mobileAgent,
  id: "agent-mobile-offline",
  name: "Offline Mobile Agent",
  state: "STOPPED",
  hostname: null,
  started_at: null,
  stopped_at: "2026-05-18T01:00:00Z",
};

const secondMobileAgent = {
  ...mobileAgent,
  id: "agent-mobile-support",
  name: "Mobile Support Agent",
  hostname: "mobile-support-agent.hypercli.test",
};

const activeSubscription = {
  id: "sub-mobile-pro",
  user_id: "user-mobile",
  plan_id: "pro",
  plan_name: "Pro Plan",
  provider: "STRIPE",
  status: "ACTIVE",
  quantity: 1,
  current_period_end: "2026-05-21T00:00:00Z",
  expires_at: "2026-05-21T00:00:00Z",
  stripe_subscription_id: "20689860",
  cancel_at_period_end: false,
  can_cancel: true,
  is_current: true,
  plan_tpm_limit: 8680550,
  plan_rpm_limit: 868,
  plan_tpd: 250000000,
  plan_agent_tier: "large",
  slot_grants: { large: 1 },
  meta: {
    amount_usd: 79,
  },
};

function json(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function seedAuth(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "auth_token",
      value: TEST_JWT,
      url: TEST_BASE_URL,
      httpOnly: false,
      secure: TEST_BASE_URL.startsWith("https://"),
      sameSite: "Lax",
    },
  ]);

  await page.addInitScript((token) => {
    const provider = {
      isMetaMask: true,
      selectedAddress: "0x1111111111111111111111111111111111111111",
      chainId: "0x2105",
      request: async ({ method }: { method: string; params?: unknown[] }) => {
        if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
        if (method === "eth_accounts") return ["0x1111111111111111111111111111111111111111"];
        if (method === "eth_chainId") return "0x2105";
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "wallet_addEthereumChain") return null;
        return null;
      },
      on: () => undefined,
      removeListener: () => undefined,
    };

    Object.defineProperty(window, "ethereum", {
      configurable: true,
      writable: true,
      value: provider,
    });
    Object.defineProperty(window, "phantom", {
      configurable: true,
      writable: true,
      value: {
        ethereum: provider,
      },
    });
    window.localStorage.setItem("claw_auth_token", token);
    window.localStorage.setItem("app_auth_token", token);
  }, TEST_JWT);
}

async function mockAuthenticatedMobileAgent(page: Page, primaryAgent = mobileAgent): Promise<void> {
  await seedAuth(page);

  await page.route(/\/workspaces(?:\/.*)?$/, async (route) => {
    const pathName = new URL(route.request().url()).pathname;
    const agentIds = [primaryAgent.id, secondMobileAgent.id, offlineMobileAgent.id];

    if (pathName.endsWith(`/workspaces/${TEST_WORKSPACE_ID}/agents`)) {
      await route.fulfill(json(agentIds.map((agentId) => ({
        workspace_id: TEST_WORKSPACE_ID,
        agent_id: agentId,
        role: "viewer",
        expires_at: null,
      }))));
      return;
    }

    if (pathName.endsWith(`/workspaces/${TEST_WORKSPACE_ID}/grants`)) {
      await route.fulfill(json(agentIds.map((agentId) => ({
        id: `grant-${agentId}`,
        workspace_id: TEST_WORKSPACE_ID,
        subject_type: "agent",
        subject_id: agentId,
        role: "viewer",
        expires_at: null,
        revoked_at: null,
      }))));
      return;
    }

    const workspace = {
      id: TEST_WORKSPACE_ID,
      name: "Mobile Layout",
      slug: TEST_WORKSPACE_ID,
      display_name: "Mobile Layout",
      role: "admin",
    };
    await route.fulfill(json(pathName.endsWith(`/workspaces/${TEST_WORKSPACE_ID}`) ? workspace : [workspace]));
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathName = url.pathname;
    const method = route.request().method();

    if (pathName.endsWith("/api/user")) {
      await route.fulfill(json({
        user_id: "user-mobile",
        email: "mobile@example.com",
        name: method === "PATCH" ? "Mobile Test User" : "shadcncraft",
        is_active: true,
        email_verified: true,
        created_at: "2026-05-18T00:00:00Z",
      }));
      return;
    }

    if (pathName.endsWith("/api/auth/me")) {
      await route.fulfill(json({
        user_id: "user-mobile",
        orchestra_user_id: null,
        team_id: "team-mobile",
        plan_id: "pro",
        email: "mobile@example.com",
        auth_type: "jwt",
        capabilities: [],
        has_active_subscription: true,
      }));
      return;
    }

    await route.fulfill(json({}));
  });

  await page.route("**/agents/**", async (route) => {
    const url = new URL(route.request().url());
    const pathName = decodeURIComponent(url.pathname);
    const method = route.request().method();

    if (pathName.includes(`/agents/deployments/${AGENT_ID}/files`)) {
      if (method === "GET" && pathName.endsWith("/README.md")) {
        await route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: README_CONTENT,
        });
        return;
      }

      if (method === "GET") {
        await route.fulfill(json({
          type: "directory",
          path: ".openclaw/workspace",
          directories: [],
          files: [
            {
              name: "README.md",
              path: README_PATH,
              type: "file",
              size: README_CONTENT.length,
            },
          ],
        }));
        return;
      }
    }

    if (pathName.endsWith("/agents/deployments") && method === "GET") {
      await route.fulfill(json([primaryAgent, secondMobileAgent, offlineMobileAgent]));
      return;
    }

    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}`) && method === "GET") {
      await route.fulfill(json(primaryAgent));
      return;
    }

    if (pathName.endsWith("/agents/plans/current")) {
      await route.fulfill(json({
        id: "pro",
        name: "Pro Plan",
        pooled_tpd: 250000000,
        slot_inventory: {
          large: { granted: 1, used: 0, available: 1 },
        },
      }));
      return;
    }

    if (pathName.endsWith("/agents/plans")) {
      await route.fulfill(json({
        plans: [
          {
            id: "pro",
            name: "Pro",
            price: 79,
            price_usd: 79,
            highlighted: true,
            features: ["Priority routing", "250M tokens/day"],
            models: [],
            limits: { tpd: 250000000, burst_tpm: 8680550, rpm: 868 },
            slot_grants: { large: 1 },
          },
        ],
      }));
      return;
    }

    if (pathName.endsWith("/agents/subscriptions/summary")) {
      await route.fulfill(json({
        effective_plan_id: "pro",
        current_subscription_id: activeSubscription.id,
        current_entitlement_id: activeSubscription.id,
        pooled_tpm_limit: 8680550,
        pooled_rpm_limit: 868,
        pooled_tpd: 250000000,
        slot_inventory: {
          large: { granted: 1, used: 0, available: 1 },
        },
        billing_reset_at: "2026-05-21T00:00:00Z",
        active_subscription_count: 1,
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
          billing_reset_at: "2026-05-21T00:00:00Z",
        },
        active_subscriptions: [activeSubscription],
        subscriptions: [activeSubscription],
        user: { id: "user-mobile" },
      }));
      return;
    }

    if (pathName.endsWith("/agents/usage/history")) {
      await route.fulfill(json({ history: [{ date: "2026-05-18", total_tokens: 1234 }] }));
      return;
    }

    if (pathName.endsWith("/agents/billing/payments")) {
      await route.fulfill(json({ items: [] }));
      return;
    }

    if (pathName.endsWith("/agents/types")) {
      await route.fulfill(json({
        types: [
          { id: "small", name: "Small", cpu: 0.5, memory: 2 },
          { id: "medium", name: "Medium", cpu: 1, memory: 4 },
          { id: "large", name: "Large", cpu: 2, memory: 8 },
        ],
        plans: [],
      }));
      return;
    }

    await route.fulfill(json({ ok: true }));
  });
}

async function openMobileAgentsDashboard(page: Page, primaryAgent = mobileAgent): Promise<void> {
  await mockAuthenticatedMobileAgent(page, primaryAgent);
  await page.goto("/dashboard/agents", { waitUntil: "domcontentloaded" });
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /width=device-width.*interactive-widget=resizes-visual/,
  );
  await expect
    .poll(
      async () => {
        const fullLogoVisible = await page.getByRole("link", { name: /hypercli/i }).isVisible().catch(() => false);
        const collapsedRailVisible = await page.getByRole("button", { name: /expand sidebar|expand agents sidebar/i }).isVisible().catch(() => false);
        return fullLogoVisible || collapsedRailVisible;
      },
      { timeout: 20_000, intervals: [250, 500, 1_000] }
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible({ timeout: 20_000 });
  await expectNoHorizontalOverflow(page);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const tolerance = 6;
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          return [];
        }
        if (rect.left >= -tolerance && rect.right <= window.innerWidth + tolerance) {
          return [];
        }
        let ancestor = element.parentElement;
        while (ancestor) {
          const ancestorStyle = window.getComputedStyle(ancestor);
          const ancestorRect = ancestor.getBoundingClientRect();
          if (
            (ancestorStyle.overflowX === "hidden" || ancestorStyle.overflowX === "clip")
            && (rect.left < ancestorRect.left || rect.right > ancestorRect.right)
          ) {
            return [];
          }
          ancestor = ancestor.parentElement;
        }
        return [{
          tag: element.tagName.toLowerCase(),
          text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          className: typeof element.className === "string" ? element.className.slice(0, 120) : "",
        }];
      })
      .slice(0, 8);

    return {
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      offenders,
    };
  });

  expect(metrics.bodyScrollWidth, JSON.stringify(metrics.offenders, null, 2)).toBeLessThanOrEqual(metrics.innerWidth + 1);
  expect(metrics.documentScrollWidth, JSON.stringify(metrics.offenders, null, 2)).toBeLessThanOrEqual(metrics.innerWidth + 1);
  expect(metrics.offenders).toEqual([]);
}

async function openMobileNavigation(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Agent navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^files$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeFocused();
  await page.waitForTimeout(250);
  await expectNoHorizontalOverflow(page);
}

async function openSettingsFromMobileNavigation(page: Page): Promise<void> {
  await openMobileNavigation(page);
  await page.getByRole("button", { name: "Account links" }).click();
  await page.getByRole("menuitem", { name: /^settings$/i }).click();
}

async function expectMobileNavigationClosed(page: Page): Promise<void> {
  await expect(page.getByRole("dialog", { name: "Agent navigation" })).toHaveCount(0);
  await page.waitForTimeout(250);
}

async function expectVisibleBox(locator: Locator): Promise<NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function expectFeatureEmptyStateContained(emptyState: Locator, allowVerticalScroll = false): Promise<void> {
  await expect(emptyState).toBeVisible({ timeout: 20_000 });
  await emptyState.evaluate((element) => { element.scrollTop = 0; });
  const metrics = await emptyState.evaluate((element) => {
    const stateBox = element.getBoundingClientRect();
    const title = element.querySelector<HTMLElement>("h1");
    const action = element.querySelector<HTMLElement>("button");
    const examples = Array.from(element.querySelectorAll<HTMLElement>('[data-slot="agent-feature-empty-state-example"]'));
    if (!title || !action || examples.length !== 3) throw new Error("Missing feature empty-state content");
    const titleBox = title.getBoundingClientRect();
    const actionBox = action.getBoundingClientRect();
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      titleTop: titleBox.top,
      actionBottom: actionBox.bottom,
      stateTop: stateBox.top,
      stateBottom: stateBox.bottom,
    };
  });

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.titleTop).toBeGreaterThanOrEqual(metrics.stateTop - 1);

  if (!allowVerticalScroll) {
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
    expect(metrics.actionBottom).toBeLessThanOrEqual(metrics.stateBottom + 1);
    return;
  }

  await emptyState.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const endMetrics = await emptyState.evaluate((element) => {
    const stateBox = element.getBoundingClientRect();
    const action = element.querySelector<HTMLElement>("button");
    if (!action) throw new Error("Missing feature empty-state action");
    const actionBox = action.getBoundingClientRect();
    return {
      actionTop: actionBox.top,
      actionBottom: actionBox.bottom,
      stateTop: stateBox.top,
      stateBottom: stateBox.bottom,
      scrollTop: element.scrollTop,
      maxScrollTop: element.scrollHeight - element.clientHeight,
    };
  });

  expect(endMetrics.scrollTop).toBeGreaterThanOrEqual(endMetrics.maxScrollTop - 1);
  expect(endMetrics.actionTop).toBeGreaterThanOrEqual(endMetrics.stateTop - 1);
  expect(endMetrics.actionBottom).toBeLessThanOrEqual(endMetrics.stateBottom + 1);
}

test.describe("Agents mobile layout", () => {
  test("uses the shared Schedule preview for a stopped agent", async ({ page }) => {
    await openMobileAgentsDashboard(page, { ...mobileAgent, state: "STOPPED" });
    await openMobileNavigation(page);
    await page.getByRole("button", { name: "Scheduled", exact: true }).click();
    await expectMobileNavigationClosed(page);

    const emptyState = page.getByTestId("agent-scheduled-empty-state");
    await expect(page.getByRole("heading", { name: "Work that keeps moving" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Start agent", exact: true })).toBeVisible();
    await expectFeatureEmptyStateContained(emptyState);
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(250);
    await expectFeatureEmptyStateContained(emptyState, true);
    await expectNoHorizontalOverflow(page);
  });

  test("keeps the Schedule empty state aligned and contained", async ({ page }) => {
    await openMobileAgentsDashboard(page);
    await openMobileNavigation(page);
    await page.getByRole("button", { name: "Scheduled", exact: true }).click();
    await expectMobileNavigationClosed(page);

    const emptyState = page.getByTestId("agent-scheduled-empty-state");
    await expect(page.getByRole("heading", { name: "Your work, on autopilot" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "New Scheduled Job" })).toBeVisible();
    await expectFeatureEmptyStateContained(emptyState);
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(250);
    await expectFeatureEmptyStateContained(emptyState, true);
    await expectNoHorizontalOverflow(page);
  });

  test("keeps mobile navigation, settings, and billing within the viewport", async ({ page }) => {
    await openMobileAgentsDashboard(page);

    await expect(page.getByRole("button", { name: /open agents sidebar/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /open workspace sidebar/i })).toHaveCount(0);
    await openMobileNavigation(page);
    await expect(page.getByRole("dialog", { name: "Agent navigation" })).toHaveAttribute("data-state", "open");
    await page.keyboard.press("Escape");
    await expectMobileNavigationClosed(page);
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();

    await openMobileNavigation(page);
    await page.getByRole("button", { name: "Launch agent" }).click();
    await expectMobileNavigationClosed(page);
    await expect(page.getByRole("heading", { name: "Create agent" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();

    await openMobileNavigation(page);
    await expect(page.getByRole("button", { name: "Select Mobile Regression Agent" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move Mobile Regression Agent" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Select Offline Mobile Agent" })).toBeVisible();
    await expect(page.getByText(/^available agents$/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Expand agents sidebar" })).toBeVisible();
    await page.getByRole("button", { name: "Expand agents sidebar" }).click();
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move Mobile Regression Agent" })).toHaveCount(0);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: /^files$/i })).toBeVisible();
    await page.getByRole("button", { name: "Select Mobile Support Agent" }).click();
    await expect(page).toHaveURL(/agentId=agent-mobile-support/);
    await expect(page.getByRole("button", { name: "Expand agents sidebar" })).toBeVisible();
    await page.waitForTimeout(250);
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Close navigation" }).click();
    await expectMobileNavigationClosed(page);

    await openSettingsFromMobileNavigation(page);
    await expectMobileNavigationClosed(page);

    await expect(page.getByRole("complementary", { name: "Settings menu" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /settings sections/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: /^agent$/i }).click();
    await expect(page.getByText("Agent runtime")).toBeVisible();
    await expect(page.getByRole("button", { name: /stop agent/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto("/dashboard/billing", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("tablist", { name: "Billing sections" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Active Bundles" })).toBeVisible();
    await page.getByRole("button", { name: "Manage", exact: true }).click();
    await expect(page.getByText(/Pro Plan/i).first()).toBeVisible();
    await expect(page.getByText(/Stripe card on file/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Adjust plan" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("tab", { name: "Invoices" }).click();
    await expect(page.getByRole("tab", { name: "Invoices" })).toHaveAttribute("data-state", "active");
    await expect(page.getByRole("columnheader", { name: "Due date" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("opens the file editor as a full mobile drawer with aligned action buttons", async ({ page }) => {
    await openMobileAgentsDashboard(page);
    await openMobileNavigation(page);

    await page.getByRole("button", { name: /^files$/i }).click();
    await expectMobileNavigationClosed(page);
    const fileButton = page.getByRole("button", { name: /README\.md/i }).first();
    await expect(fileButton).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await fileButton.click();
    const drawer = page.getByRole("dialog", { name: /file editor/i });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { name: /Mobile workspace/i })).toBeVisible();
    await expect(drawer.getByText(/file verifies that the mobile editor drawer fits/i)).toBeVisible();
    await drawer.getByRole("button", { name: /^raw$/i }).click();
    await expect(drawer.locator("textarea")).toHaveValue(/Mobile workspace/i);

    const drawerBox = await expectVisibleBox(drawer);
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    expect(drawerBox.width).toBeGreaterThanOrEqual(viewport!.width - 2);
    expect(drawerBox.height).toBeGreaterThanOrEqual(viewport!.height * 0.75);

    const copyButton = drawer.getByRole("button", { name: "Copy content" });
    const closeButton = drawer.locator("button").last();
    const copyBox = await expectVisibleBox(copyButton);
    const closeBox = await expectVisibleBox(closeButton);
    expect(Math.abs(copyBox.width - closeBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(copyBox.height - closeBox.height)).toBeLessThanOrEqual(1);

    await page.waitForTimeout(250);
    await expectNoHorizontalOverflow(page);
  });
});
