import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

import { captureStep, loginWithPrivy } from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

test("shows mobile agent navigation and openclaw section picker without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await loginWithPrivy(page);

  await page.goto("/dashboard/agents", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/dashboard\/agents$/);

  const navMenuButton = page.getByRole("button", { name: /open navigation menu/i });
  await expect(navMenuButton).toBeVisible();
  await navMenuButton.click();

  await expect(page.getByRole("button", { name: /^openclaw$/i })).toBeVisible();
  await page.getByRole("button", { name: /^openclaw$/i }).click();

  await expect(page.getByLabel(/^section$/i)).toBeVisible();

  const layoutMetrics = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

  expect(layoutMetrics.bodyScrollWidth).toBeLessThanOrEqual(layoutMetrics.innerWidth + 1);
  expect(layoutMetrics.documentScrollWidth).toBeLessThanOrEqual(layoutMetrics.innerWidth + 1);

  await captureStep(page, "agents-mobile-openclaw-layout");
});
