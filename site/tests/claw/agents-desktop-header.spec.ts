import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

import { captureStep, loginWithPrivy } from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

test("shows the desktop agent workspace shell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await loginWithPrivy(page);

  await page.goto("/dashboard/agents", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/dashboard\/agents$/);

  await expect(page.getByRole("button", { name: /^launch agent$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /collapse workspace sidebar/i })).toBeVisible();
  await expect(page.getByText("Workspace", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^files$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^integrations$/i })).toBeVisible();

  await captureStep(page, "agents-desktop-header");
});
