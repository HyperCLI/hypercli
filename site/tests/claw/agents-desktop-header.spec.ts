import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

import { captureStep, loginWithPrivy } from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

test("shows the dashboard header on agents at desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await loginWithPrivy(page);

  await page.goto("/dashboard/agents", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/dashboard\/agents$/);

  await expect(page.getByRole("link", { name: /hyperclaw/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /^overview$/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /^agents$/i })).toBeVisible();

  await captureStep(page, "agents-desktop-header");
});
