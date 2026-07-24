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
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.getByRole("heading", { name: "Create your agent" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
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
  await expect(page.getByRole("heading", { name: "Create your agent" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
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

  await expect(page.getByRole("heading", { name: "Create your agent" })).toHaveCount(1);
  await expect(page.getByLabel("Agent name")).toHaveValue("viewport-pilot");
});
