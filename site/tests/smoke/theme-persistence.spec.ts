import { expect, test, type Page } from "@playwright/test";

import { AGENTS_SITE_URL, CONSOLE_SITE_URL, MAIN_SITE_URL } from "./fixtures/auth";

const THEME_COOKIE_NAME = "hypercli_color_theme";

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

async function expectLightOnFirstFrame(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect.poll(() => currentTheme(page)).toBe("light");
  expect(await firstFrameTheme(page)).toBe("light");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.colorScheme))
    .toBe("light");
}

async function switchMainSiteToLight(page: Page): Promise<void> {
  await page.goto(MAIN_SITE_URL, { waitUntil: "domcontentloaded" });
  await expect.poll(() => currentTheme(page)).toBe("dark");

  const toggle = page.locator('button[aria-label="Switch to light mode"]:visible').first();
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect.poll(() => currentTheme(page)).toBe("light");
}

test.describe("Shared color theme", () => {
  test("persists Light mode across sites before first paint", async ({ context, page }) => {
    await context.clearCookies();
    await installFirstFrameProbe(page);
    await switchMainSiteToLight(page);

    const themeCookies = (await context.cookies()).filter((cookie) => cookie.name === THEME_COOKIE_NAME);
    expect(themeCookies.some((cookie) => cookie.value === "light")).toBe(true);

    await expectLightOnFirstFrame(page, CONSOLE_SITE_URL);
    await expectLightOnFirstFrame(page, AGENTS_SITE_URL);
    await expectLightOnFirstFrame(page, MAIN_SITE_URL);
  });

  test("reconciles already-open sites on the focus lifecycle event", async ({ context, page }) => {
    await context.clearCookies();
    const consolePage = await context.newPage();
    const agentsPage = await context.newPage();

    await consolePage.goto(CONSOLE_SITE_URL, { waitUntil: "domcontentloaded" });
    await agentsPage.goto(AGENTS_SITE_URL, { waitUntil: "domcontentloaded" });
    await expect.poll(() => currentTheme(consolePage)).toBe("dark");
    await expect.poll(() => currentTheme(agentsPage)).toBe("dark");

    await page.bringToFront();
    await switchMainSiteToLight(page);

    await consolePage.bringToFront();
    await consolePage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => currentTheme(consolePage)).toBe("light");

    await agentsPage.bringToFront();
    await agentsPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => currentTheme(agentsPage)).toBe("light");
  });
});
