import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

import { captureStep, loginWithPrivy } from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

test("desktop OpenClaw section click renders section content", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await loginWithPrivy(page);

  await page.goto("/dashboard/agents", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/dashboard\/agents$/);

  const openClawTab = page.getByRole("button", { name: /^openclaw$/i });
  await expect(openClawTab).toBeVisible();
  await openClawTab.click();

  const sectionsRail = page.locator("text=Sections").first();
  await expect(sectionsRail).toBeVisible();

  const channelsNav = page.getByRole("button", { name: /^channels$/i }).first();
  await expect(channelsNav).toBeVisible();
  await channelsNav.click();

  await expect(page.getByRole("heading", { name: /^channels$/i })).toBeVisible();
  await captureStep(page, "openclaw-desktop-channels");
});
