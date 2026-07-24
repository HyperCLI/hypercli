import { expect, test } from "@playwright/test";

const planResponse = {
  plans: [{
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

test("preserves the mobile dashboard wizard when sign-in is cancelled", async ({ page }) => {
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
  await expect(page.getByRole("heading", { name: "Build a teammate, not another chat window." })).toBeVisible();
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.getByRole("heading", { name: "Create your agent" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "View plan" }).last().click();
  await page.getByRole("button", { name: /Upgrade to Pro|Select plan/ }).click();
  await expect(page.getByRole("heading", { name: "Sign in to continue to checkout" })).toBeVisible();

  await page.getByRole("button", { name: "Close sign in" }).click();

  await expect(page.getByRole("heading", { name: "Choose your plan" })).toBeVisible();
});
