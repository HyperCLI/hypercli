import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, "../claw/.env"), quiet: true });

/**
 * The marketing-site smoke: every public route renders its page shell, and the
 * header navigation actually navigates. This exists so a commit cannot nuke
 * the public site quietly -- it deliberately asserts structure (a hero, a
 * footer, no error surface), not pixels or copy, so it survives redesigns.
 *
 * The routes are every page the retired design-assertion suite covered, plus
 * the channel pages. Tests are independent and run fully parallel.
 */

const ROUTES = [
  "/",
  "/architecture",
  "/builders-program",
  "/buzz",
  "/capabilities",
  "/cli",
  "/data-center",
  "/developers",
  "/discord",
  "/enterprise",
  "/for-teams",
  "/inference",
  "/integrations",
  "/integrations/google-calendar",
  "/integrations/google-docs",
  "/integrations/google-drive",
  "/partner",
  "/pilot-program",
  "/pricing",
  "/quickstart",
  "/security",
  "/self-hosted",
  "/slack",
  "/teams",
  "/telegram",
  "/what-it-can-do",
  "/whatsapp",
] as const;

for (const route of ROUTES) {
  test(`${route} renders the marketing shell`, async ({ page }) => {
    // One retry: a dev server compiling the route on first hit can abort the
    // initial navigation; a built app answers first time.
    let response = await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => null);
    if (!response) response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.ok(), `${route} responded ${response?.status()}`).toBe(true);

    await expect(page.locator("h1").first(), `${route} must render a hero heading`).toBeVisible();
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator("footer").first()).toBeVisible();
    await expect(
      page.getByText(/application error|internal server error|this page could not be found/i),
    ).toHaveCount(0);
  });
}

test("header navigation reaches a section page and returns home", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("header").getByRole("link", { name: "Developers" }).first().click();
  await expect(page).toHaveURL(/\/developers/);
  await expect(page.locator("h1").first()).toBeVisible();

  await page.locator("header").getByRole("link", { name: /hypercli home/i }).first().click();
  await expect(page).toHaveURL(/\/$/);
});
