import { expect, test, type Page } from "@playwright/test";

import { AGENTS_SITE_URL, CONSOLE_SITE_URL, MAIN_SITE_URL } from "./fixtures/auth";

const THEME_COOKIE_NAME = "hypercli_color_theme";
const THEME_FAMILY_COOKIE_NAME = "hypercli_theme_family";

async function installFirstFrameProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as typeof window & { __hypercliFirstFrameTheme?: string | null };
    requestAnimationFrame(() => {
      state.__hypercliFirstFrameTheme = document.documentElement.getAttribute("data-theme");
    });
  });
}

async function currentTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}

async function firstFrameTheme(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const state = window as typeof window & { __hypercliFirstFrameTheme?: string | null };
    if (state.__hypercliFirstFrameTheme !== undefined) return state.__hypercliFirstFrameTheme;

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return state.__hypercliFirstFrameTheme ?? document.documentElement.getAttribute("data-theme");
  });
}

async function expectThemeOnFirstFrame(page: Page, url: string, theme: string, mode: "light" | "dark"): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect.poll(() => currentTheme(page)).toBe(theme);
  expect(await firstFrameTheme(page)).toBe(theme);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe(mode);
}

async function switchMainSiteToLight(page: Page): Promise<void> {
  await page.goto(MAIN_SITE_URL, { waitUntil: "domcontentloaded" });
  await expect.poll(() => currentTheme(page)).toBe("aurora-dark");

  const lightButton = page.locator('button[aria-label="Light"]:visible').first();
  await expect(lightButton).toBeVisible();
  await lightButton.click();
  await expect.poll(() => currentTheme(page)).toBe("aurora-light");
}

test.describe("Shared color theme", () => {
  test("persists Light mode across sites before first paint", async ({ context, page }) => {
    await context.clearCookies();
    await installFirstFrameProbe(page);
    await switchMainSiteToLight(page);

    const themeCookies = (await context.cookies()).filter((cookie) => cookie.name === THEME_COOKIE_NAME);
    expect(themeCookies.some((cookie) => cookie.value === "light")).toBe(true);

    await expectThemeOnFirstFrame(page, CONSOLE_SITE_URL, "aurora-light", "light");
    await expectThemeOnFirstFrame(page, AGENTS_SITE_URL, "aurora-light", "light");
    await expectThemeOnFirstFrame(page, MAIN_SITE_URL, "aurora-light", "light");
  });

  test("migrates Classic preferences to Aurora Dark before first paint", async ({ context, page }) => {
    await context.clearCookies();
    await installFirstFrameProbe(page);
    await context.addCookies([
      { name: THEME_COOKIE_NAME, value: "dark", url: MAIN_SITE_URL },
      { name: THEME_FAMILY_COOKIE_NAME, value: "classic", url: MAIN_SITE_URL },
    ]);
    await expectThemeOnFirstFrame(page, MAIN_SITE_URL, "aurora-dark", "dark");

    const cookies = await context.cookies();
    expect(cookies.some((cookie) => cookie.name === THEME_COOKIE_NAME && cookie.value === "dark")).toBe(true);
    expect(cookies.some((cookie) => cookie.name === THEME_FAMILY_COOKIE_NAME && cookie.value === "aurora")).toBe(true);

    await expectThemeOnFirstFrame(page, CONSOLE_SITE_URL, "aurora-dark", "dark");
    await expectThemeOnFirstFrame(page, AGENTS_SITE_URL, "aurora-dark", "dark");
    await expectThemeOnFirstFrame(page, MAIN_SITE_URL, "aurora-dark", "dark");
  });

  test("reconciles already-open sites on the focus lifecycle event", async ({ context, page }) => {
    await context.clearCookies();
    const consolePage = await context.newPage();
    const agentsPage = await context.newPage();

    await consolePage.goto(CONSOLE_SITE_URL, { waitUntil: "domcontentloaded" });
    await agentsPage.goto(AGENTS_SITE_URL, { waitUntil: "domcontentloaded" });
    await expect.poll(() => currentTheme(consolePage)).toBe("aurora-dark");
    await expect.poll(() => currentTheme(agentsPage)).toBe("aurora-dark");

    await page.bringToFront();
    await switchMainSiteToLight(page);

    await consolePage.bringToFront();
    await consolePage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => currentTheme(consolePage)).toBe("aurora-light");

    await agentsPage.bringToFront();
    await agentsPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => currentTheme(agentsPage)).toBe("aurora-light");
  });
});
