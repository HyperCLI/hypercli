import { expect, test } from "@playwright/test";
import {
  AGENTS_SITE_URL,
  CONSOLE_SITE_URL,
  MAIN_SITE_URL,
  loginToClaw,
  loginToConsole,
  loginToMainSite,
} from "./fixtures/auth";

test.describe.serial("Production Login Smoke", () => {
  test.setTimeout(180_000);

  test("logs into hypercli.com", async ({ page }) => {
    await loginToMainSite(page);

    await expect(page).toHaveURL(new RegExp(`^${MAIN_SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await expect(page.getByRole("button", { name: /logout/i })).toBeVisible();
  });

  test("logs into console.hypercli.com", async ({ page }) => {
    await loginToConsole(page);

    await expect(page).toHaveURL(new RegExp(`^${CONSOLE_SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*/dashboard`));
    await expect(page.getByRole("heading", { name: /^balance$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^top up$/i })).toBeVisible();
  });

  test("logs into agents.hypercli.com", async ({ page }) => {
    await loginToClaw(page);

    await expect(page).toHaveURL(new RegExp(`^${AGENTS_SITE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*/dashboard`));
    await expect(page.getByRole("heading", { name: /welcome back, agent/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /api keys/i })).toBeVisible();
  });
});
