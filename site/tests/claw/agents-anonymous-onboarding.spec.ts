import { expect, test } from "@playwright/test";

const planResponse = {
  plans: [{
    id: "free",
    name: "Free",
    price: 0,
    price_usd: 0,
    aiu: 0,
    agents: 1,
    features: ["Free agent slot"],
    models: ["kimi-k2.5"],
    highlighted: false,
    limits: { tpd: 10_000_000, tpm: 10_000, burst_tpm: 20_000, rpm: 60 },
    meta: { checkout_bundle: { free: 1 } },
  }, {
    id: "pro",
    name: "Pro",
    price: 99,
    price_usd: 99,
    aiu: 5,
    agents: 1,
    features: ["Large agent slot", "Priority routing", "Memory indexing"],
    models: ["kimi-k2.5"],
    highlighted: true,
    limits: { tpd: 250_000_000, tpm: 100_000, burst_tpm: 200_000, rpm: 300 },
    meta: { checkout_bundle: { large: 1 } },
  }],
};

test("gates the Free plan launch without opening the paid catalog", async ({ page }) => {
  const forbiddenRequests: string[] = [];
  page.on("request", (request) => {
    if (!["fetch", "xhr"].includes(request.resourceType())) return;
    const path = new URL(request.url()).pathname;
    if (/^\/(?:api\/)?(?:agents|workspaces|usage|billing)(?:\/|$)/.test(path) && !path.endsWith("/plans")) {
      forbiddenRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.resourceType() === "fetch" && request.method() === "GET" && path.endsWith("/plans")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(planResponse) });
      return;
    }
    await route.continue();
  });

  await page.goto("/dashboard/agents?open=agent-launcher&plan=free");
  await expect(page.getByRole("heading", { name: "Build a teammate, not another chat window." })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Launch agent" })).toHaveCount(0);
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.getByRole("heading", { name: "Create agent" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "A quick tour of your agent workspace" })).toHaveCount(0);
  const optionalSettings = page.locator("details").filter({ hasText: "Advanced" });
  await expect(optionalSettings).not.toHaveAttribute("open", "");
  await expect(page.getByText("What does it help with?")).toHaveCount(0);
  await optionalSettings.locator("summary").click();
  await expect(page.getByText("Desktop browser")).toBeVisible();
  const identityBody = page
    .getByRole("heading", { name: "Create agent" })
    .locator("xpath=ancestor::section")
    .locator('[data-slot="agent-setup-scroll-body"]');
  const identityGeometry = await identityBody.evaluate((element) => ({
    horizontalContentFits: element.scrollWidth <= element.clientWidth,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(identityGeometry.horizontalContentFits).toBe(true);
  expect(identityGeometry.overflowY).toBe("auto");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set up the workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "View plan" }).last().click();

  await expect(page.getByRole("heading", { name: "Sign in to launch your agent" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upgrade plan" })).not.toBeVisible();
  expect(forbiddenRequests).toEqual([]);
});

test("uses the existing dashboard wizard and gates checkout for anonymous visitors", async ({ page }) => {
  const forbiddenRequests: string[] = [];
  page.on("request", (request) => {
    if (!["fetch", "xhr"].includes(request.resourceType())) return;
    const path = new URL(request.url()).pathname;
    if (/^\/(?:api\/)?(?:agents|workspaces|usage|billing)(?:\/|$)/.test(path) && !path.endsWith("/plans")) {
      forbiddenRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.resourceType() === "fetch" && request.method() === "GET" && path.endsWith("/plans")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(planResponse) });
      return;
    }
    await route.continue();
  });

  await page.goto("/dashboard/agents?open=agent-launcher&plan=pro");

  await expect(page).toHaveURL(/\/dashboard\/agents/);
  await expect(page.getByRole("heading", { name: "Build a teammate, not another chat window." })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Start with a purpose. Add knowledge as you go." })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose capacity, then put your agent to work." })).toBeVisible();
  await page.getByRole("button", { name: "Create my agent" }).click();
  await expect(page.getByRole("heading", { name: "Create agent" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set up the workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose your plan" })).toBeVisible();
  await page.getByRole("button", { name: "View plan" }).last().click();
  await expect(page.getByRole("heading", { name: "Upgrade plan" })).toBeVisible();
  await page.getByRole("button", { name: /Upgrade to Pro|Select plan/ }).click();
  await expect(page.getByRole("heading", { name: "Sign in to continue to checkout" })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/agents/);
  expect(forbiddenRequests).toEqual([]);
});

test("keeps one launcher and its draft across viewport changes", async ({ page }) => {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.resourceType() === "fetch" && request.method() === "GET" && path.endsWith("/plans")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(planResponse) });
      return;
    }
    await route.continue();
  });

  await page.goto("/dashboard/agents?plan=pro");
  await expect(page.getByRole("heading", { name: "Build a teammate, not another chat window." })).toBeVisible();
  await page.getByRole("button", { name: "Skip tour" }).click();
  const nameInput = page.getByLabel("Agent name");
  await nameInput.fill("viewport-pilot");

  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.getByRole("heading", { name: "Create agent" })).toHaveCount(1);
  await expect(page.getByLabel("Agent name")).toHaveValue("viewport-pilot");
});

test("opens agent creation from the signed-out trial action", async ({ page }) => {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.resourceType() === "fetch" && request.method() === "GET" && path.endsWith("/plans")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(planResponse) });
      return;
    }
    await route.continue();
  });

  await page.goto("/dashboard/agents");
  await page.getByRole("button", { name: "Close agent tour" }).click();
  const launchSurface = page.locator("[data-agent-launch-surface]");
  await expect(launchSurface).toHaveCount(1);
  const initialSurfaceBox = await launchSurface.boundingBox();
  expect(initialSurfaceBox).not.toBeNull();
  const startTrial = page.getByRole("button", { name: "Start free trial" });
  await expect(startTrial).toBeVisible();
  await startTrial.click();

  await expect(page.getByRole("heading", { name: "Create agent" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upgrade plan" })).not.toBeVisible();
  await expect(launchSurface).toHaveCount(1);
  await page.waitForTimeout(500);
  const wizardSurfaceBox = await launchSurface.boundingBox();
  expect(wizardSurfaceBox).not.toBeNull();
  expect(Math.abs((wizardSurfaceBox?.width ?? 0) - (initialSurfaceBox?.width ?? 0))).toBeLessThan(1);
  expect(Math.abs((wizardSurfaceBox?.height ?? 0) - (initialSurfaceBox?.height ?? 0))).toBeLessThan(1);
  expect(Math.abs((wizardSurfaceBox?.x ?? 0) - (initialSurfaceBox?.x ?? 0))).toBeLessThan(1);
  expect(Math.abs((wizardSurfaceBox?.y ?? 0) - (initialSurfaceBox?.y ?? 0))).toBeLessThan(1);
});

test("replaces first-time creation with a saved anonymous agent launch", async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      name: "night-ops-pilot",
      iconIndex: 11,
      category: "Ops",
      plan: "pro",
      size: "large",
      enableDesktop: true,
      enableMemoryIndex: true,
      enableCustomImage: false,
      customImage: "",
    }));
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.resourceType() === "fetch" && request.method() === "GET" && path.endsWith("/plans")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(planResponse) });
      return;
    }
    await route.continue();
  });

  await page.goto("/dashboard/agents");

  await expect(page.getByRole("heading", { name: "Your agent has a head start." })).toBeVisible();
  await expect(page.getByText("night-ops-pilot.hypercli.com")).toBeVisible();
  await expect(page.getByText("Browser ready")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build a teammate, not another chat window." })).toHaveCount(0);

  await page.getByRole("button", { name: /Finish the launch/i }).click();
  await expect(page.getByRole("heading", { name: "Choose your plan" })).toBeVisible();
});
