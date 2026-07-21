import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Locator, type Page } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const TEST_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.signature";
const TEST_BASE_URL = process.env.TEST_BASE_URL?.trim() || "http://127.0.0.1:4003";
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const AGENT_ID = "agent-mobile-layout";
const README_PATH = ".openclaw/workspace/README.md";
const README_CONTENT = "# Mobile workspace\n\nThis file verifies that the mobile editor drawer fits the available width.";

const mobileAgent = {
  id: AGENT_ID,
  user_id: "user-mobile",
  pod_id: "pod-mobile",
  pod_name: "agent-mobile-layout",
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
  meta: {
    ui: {
      icon_index: 0,
    },
  },
};

const offlineMobileAgent = {
  ...mobileAgent,
  id: "agent-mobile-offline",
  pod_id: "pod-mobile-offline",
  pod_name: "agent-mobile-offline",
  name: "Offline Mobile Agent",
  state: "STOPPED",
  hostname: null,
  started_at: null,
  stopped_at: "2026-05-18T01:00:00Z",
};

const secondMobileAgent = {
  ...mobileAgent,
  id: "agent-mobile-support",
  pod_id: "pod-mobile-support",
  pod_name: "agent-mobile-support",
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
    window.localStorage.setItem("claw_e2e_openclaw_connected", "1");
  }, TEST_JWT);
}

async function mockAuthenticatedMobileAgent(page: Page): Promise<void> {
  await seedAuth(page);

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
      await route.fulfill(json([mobileAgent, secondMobileAgent, offlineMobileAgent]));
      return;
    }

    if (pathName.endsWith(`/agents/deployments/${AGENT_ID}`) && method === "GET") {
      await route.fulfill(json(mobileAgent));
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
          { id: "small", name: "Small", cpu: 1, memory: 1, cpu_limit: 1, memory_limit: 1 },
          { id: "medium", name: "Medium", cpu: 2, memory: 2, cpu_limit: 2, memory_limit: 2 },
          { id: "large", name: "Large", cpu: 4, memory: 4, cpu_limit: 4, memory_limit: 4 },
        ],
        plans: [],
      }));
      return;
    }

    await route.fulfill(json({ ok: true }));
  });
}

async function openMobileAgentsDashboard(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await mockAuthenticatedMobileAgent(page);
  await page.goto("/dashboard/agents", { waitUntil: "domcontentloaded" });
  await expect.poll(async () => page.evaluate(() => ({
    e2eConnected: window.localStorage.getItem("claw_e2e_openclaw_connected"),
    webdriver: window.navigator.webdriver,
  }))).toEqual({
    e2eConnected: "1",
    webdriver: true,
  });
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
  await page.setViewportSize(MOBILE_VIEWPORT);
  await expect(page.getByRole("button", { name: /open agents sidebar/i })).toBeVisible({ timeout: 20_000 });
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

async function openWorkspaceDrawer(page: Page): Promise<void> {
  await page.getByRole("button", { name: /open workspace sidebar/i }).click();
  await expect(page.getByRole("button", { name: /^files$/i })).toBeVisible();
  await page.waitForTimeout(250);
  await expectNoHorizontalOverflow(page);
}

async function openSettingsFromWorkspaceDrawer(page: Page): Promise<void> {
  await openWorkspaceDrawer(page);
  await page.getByRole("button", { name: /^advanced$/i }).click();
  await page.getByRole("menuitem", { name: /^settings$/i }).click();
}

async function expectWorkspaceDrawerClosed(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /close workspace sidebar/i })).toHaveCount(0);
  await page.waitForTimeout(250);
}

async function expectVisibleBox(locator: Locator): Promise<NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test.describe("Agents mobile layout", () => {
  test("keeps mobile navigation, settings, and billing within the viewport", async ({ page }) => {
    await openMobileAgentsDashboard(page);

    await page.getByRole("button", { name: /open agents sidebar/i }).click();
    await expect(page.getByRole("button", { name: "Mobile Regression Agent" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Move Mobile Regression Agent" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Offline Mobile Agent" })).toHaveCount(0);
    await expect(page.getByText(/^available agents$/i)).toHaveCount(0);
    const showOfflineAgents = page.getByRole("switch", { name: "Show offline agents" });
    await expect(showOfflineAgents).toHaveAttribute("aria-checked", "false");
    await showOfflineAgents.click();
    await expect(page.getByRole("button", { name: "Offline Mobile Agent" })).toBeVisible();
    const closeAgentsSidebar = page.getByRole("button", { name: /close agents sidebar/i }).last();
    await expect(closeAgentsSidebar).toBeVisible();
    await page.waitForTimeout(250);
    await expectNoHorizontalOverflow(page);
    await closeAgentsSidebar.click();
    await expect(closeAgentsSidebar).toBeHidden();

    await openSettingsFromWorkspaceDrawer(page);
    await expectWorkspaceDrawerClosed(page);

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /settings sections/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: /^agent$/i }).click();
    await expect(page.getByText("Agent runtime")).toBeVisible();
    await expect(page.getByRole("button", { name: /stop agent/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto("/dashboard/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Pro Plan/i).first()).toBeVisible();
    await expect(page.getByText(/Stripe card on file/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Adjust plan" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("opens the file editor as a full mobile drawer with aligned action buttons", async ({ page }) => {
    await openMobileAgentsDashboard(page);
    await openWorkspaceDrawer(page);

    await page.getByRole("button", { name: /^files$/i }).click();
    await expectWorkspaceDrawerClosed(page);
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

    const copyButton = drawer.locator('button[title="Copy content"]');
    const closeButton = drawer.locator("button").last();
    const copyBox = await expectVisibleBox(copyButton);
    const closeBox = await expectVisibleBox(closeButton);
    expect(Math.abs(copyBox.width - closeBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(copyBox.height - closeBox.height)).toBeLessThanOrEqual(1);

    await page.waitForTimeout(250);
    await expectNoHorizontalOverflow(page);
  });
});
