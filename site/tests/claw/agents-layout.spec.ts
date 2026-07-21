import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test, type Page } from "@playwright/test";

import { captureStep, loginWithPrivy } from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const RESPONSIVE_VIEWPORTS = [
  { name: "mobile-narrow", width: 390, height: 844 },
  { name: "mobile-wide", width: 430, height: 932 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "small-desktop", width: 1024, height: 768 },
  { name: "desktop", width: 1440, height: 1024 },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const layoutMetrics = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

  expect(layoutMetrics.bodyScrollWidth).toBeLessThanOrEqual(layoutMetrics.innerWidth + 1);
  expect(layoutMetrics.documentScrollWidth).toBeLessThanOrEqual(layoutMetrics.innerWidth + 1);
}

test("keeps dashboard agents within the viewport across common breakpoints", async ({ page }) => {
  await loginWithPrivy(page);

  for (const viewport of RESPONSIVE_VIEWPORTS) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/dashboard/agents", { waitUntil: "networkidle" });
      await expect(page).toHaveURL(/\/dashboard\/agents$/);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test("shows mobile agent navigation without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await loginWithPrivy(page);

  await page.goto("/dashboard/agents", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/dashboard\/agents$/);

  const navMenuButton = page.getByRole("button", { name: /open agents sidebar/i });
  await expect(navMenuButton).toBeVisible();
  await navMenuButton.click();

  await expect(page.getByRole("button", { name: /^my agents$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /launch agent/i })).toBeVisible();
  await expect(page.getByText(/^available agents$/i)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await captureStep(page, "agents-mobile-menu-layout");
});
