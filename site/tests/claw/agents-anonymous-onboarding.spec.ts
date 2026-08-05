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

test("rotates agent sections and requires sign in before creation", async ({ page }) => {
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

  await page.goto("/dashboard/agents?plan=free");
  await expect(page.getByRole("dialog", { name: "Launch agent" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "A quick tour of your agent workspace" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Create agent" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Sign in to/ })).toHaveCount(0);
  await expect(page.locator("[data-agent-launch-surface]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your business, one chat" })).toBeVisible();
  await expect(page.locator(".agent-desktop-navigation")).toHaveAttribute("data-expanded-section", "workspace");

  await expect(page.getByRole("heading", { name: "Your files, working for you" })).toBeVisible({ timeout: 12_000 });
  await page.getByRole("button", { name: "Integrations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your stack, unified" })).toBeVisible();
  await page.waitForTimeout(15_500);
  await expect(page.getByRole("heading", { name: "Your stack, unified" })).toBeVisible();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your expertise, reusable" })).toBeVisible();
  await page.getByRole("button", { name: "Scheduled", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Work that keeps moving" })).toBeVisible();
  await page.getByRole("button", { name: "Desktop", exact: true }).click();
  const desktopPreview = page.getByRole("heading", { name: "A browser built for action" }).locator("xpath=..");
  await expect(desktopPreview).toBeVisible();
  await desktopPreview.getByRole("button", { name: "Launch agent", exact: true }).click();
  await expect(page.locator("#privy-modal-content")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create agent", includeHidden: true })).toHaveCount(0);
  await expect(page.locator("[data-agent-launch-surface]")).toHaveCount(0);
  await page.locator("#privy-modal-content").getByRole("button", { name: "close modal" }).click();
  await expect(page.locator("#privy-modal-content")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "A browser built for action" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create agent" })).toHaveCount(0);
  await expect(page.locator("[data-agent-launch-surface]")).toHaveCount(0);
  expect(forbiddenRequests).toEqual([]);
});

test("opens login directly when the agent launcher is requested", async ({ page }) => {
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
  await expect(page.locator("#privy-modal-content")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "A quick tour of your agent workspace" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Create agent" })).toHaveCount(0);
  await page.locator("#privy-modal-content").getByRole("button", { name: "close modal" }).click();
  await expect(page.locator("#privy-modal-content")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Create agent" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\/agents/);
  expect(forbiddenRequests).toEqual([]);
});

test("shows the rotating preview without opening the tour", async ({ page }) => {
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
  await expect(page.getByRole("dialog", { name: "A quick tour of your agent workspace" })).toHaveCount(0);
  const chatPreview = page.getByRole("heading", { name: "Your business, one chat" }).locator("xpath=..");
  await expect(chatPreview).toBeVisible();
  await expect(page.locator("[data-agent-launch-surface]")).toHaveCount(0);
  await chatPreview.getByRole("button", { name: "Launch agent" }).click();
  await expect(page.locator("#privy-modal-content")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create agent" })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });

  await expect(page.locator("#privy-modal-content")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create agent" })).toHaveCount(0);
});

test("routes trial and roster agent creation actions through authentication", async ({ page }) => {
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
  const startTrial = page.getByRole("button", { name: "Start free trial" });
  await expect(startTrial).toBeVisible();
  await startTrial.click();

  await expect(page.locator("#privy-modal-content")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create agent" })).toHaveCount(0);
  await page.locator("#privy-modal-content").getByRole("button", { name: "close modal" }).click();
  await expect(page.locator("#privy-modal-content")).toHaveCount(0);

  const roster = page.locator(".agents-roster-shell");
  await roster.getByRole("button", { name: "Launch agent" }).click();
  await expect(page.locator("#privy-modal-content")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create agent" })).toHaveCount(0);
});

test("keeps a saved draft private until authentication", async ({ page }) => {
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

  const chatPreview = page.getByRole("heading", { name: "Your business, one chat" }).locator("xpath=..");
  await expect(chatPreview).toBeVisible();
  await expect(page.locator("[data-agent-launch-surface]")).toHaveCount(0);
  await expect(page.locator('[data-slot="saved-agent-draft-summary"]')).toHaveCount(0);
  await expect(page.getByText("night-ops-pilot.hypercli.com")).toHaveCount(0);
  await chatPreview.getByRole("button", { name: "Launch agent" }).click();
  await expect(page.locator("#privy-modal-content")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create agent" })).toHaveCount(0);
  expect(await page.evaluate(() => window.sessionStorage.getItem("hypercli-first-agent-draft"))).toContain("night-ops-pilot");
});

test("routes New Domain through authentication", async ({ page }) => {
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
  const navigation = page.locator(".agent-desktop-navigation");
  const workspaceSelector = navigation.getByRole("button", { name: /Current workspace:/ });
  if (await workspaceSelector.isVisible().catch(() => false)) {
    await workspaceSelector.click();
    const newWorkspace = page.getByRole("menuitem", { name: /New Domain/ });
    await expect(newWorkspace).toBeEnabled();
    await newWorkspace.click();
  } else {
    const launchWorkspace = navigation.getByRole("button", { name: "Launch agent", exact: true }).first();
    await expect(launchWorkspace).toBeEnabled();
    await launchWorkspace.click();
  }

  await expect(page.locator("#privy-modal-content")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "New Domain" })).toHaveCount(0);
});

test("keeps a saved anonymous draft while showing the dashboard preview", async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      name: "saved-preview-pilot",
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

  await expect(page.getByRole("heading", { name: "Your business, one chat" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your agent has a head start." })).toHaveCount(0);
  await expect(page.locator("[data-agent-launch-surface]")).toHaveCount(0);
  expect(await page.evaluate(() => window.sessionStorage.getItem("hypercli-first-agent-draft"))).toContain("saved-preview-pilot");
});
