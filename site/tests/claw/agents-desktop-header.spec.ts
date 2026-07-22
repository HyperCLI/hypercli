import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

import { captureStep, loginWithPrivy } from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

test("shows the desktop agent workspace shell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.addInitScript(() => {
    window.localStorage.removeItem("claw.agentRosterCollapsed.v1");
  });
  await loginWithPrivy(page);

  await page.goto("/dashboard/agents", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/dashboard\/agents$/);

  await expect(page.getByRole("button", { name: /^launch agent$/i })).toBeVisible();
  const desktopNavigation = page.locator(".agent-desktop-navigation");
  await expect(desktopNavigation).toHaveCSS("width", "256px");
  await expect(desktopNavigation).toHaveAttribute("data-expanded-section", "agents");
  await expect(page.getByRole("button", { name: /current workspace:/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /collapse sidebar/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /expand workspace sidebar/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /collapse workspace sidebar/i })).toHaveCount(0);

  await page.getByRole("button", { name: /collapse sidebar/i }).click();

  await expect(desktopNavigation).toHaveCSS("width", "256px");
  await expect(desktopNavigation).toHaveAttribute("data-expanded-section", "workspace");
  await expect(page.getByRole("button", { name: /expand agents sidebar/i })).toBeVisible();
  await expect(page.getByText("Setup", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /collapse workspace sidebar/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /collapse sidebar/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^files$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^integrations$/i })).toBeVisible();

  await captureStep(page, "agents-desktop-header");
});
