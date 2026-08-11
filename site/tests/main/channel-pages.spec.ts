import { expect, test, type Page } from "@playwright/test";

const CHANNEL_ROUTES = [
  { path: "/slack", label: "Slack", eyebrow: "HyperCLI for Slack", cta: "Add to Slack" },
  { path: "/teams", label: "Teams", eyebrow: "HyperCLI for Teams", cta: "Add to Teams" },
  {
    path: "/telegram",
    label: "Telegram",
    eyebrow: "HyperCLI for Telegram",
    cta: "Open in Telegram",
  },
  {
    path: "/whatsapp",
    label: "WhatsApp",
    eyebrow: "HyperCLI for WhatsApp",
    cta: "Connect on WhatsApp",
  },
  { path: "/discord", label: "Discord", eyebrow: "HyperCLI for Discord", cta: "Add to Discord" },
  { path: "/buzz", label: "buzz", eyebrow: "HyperCLI for buzz", cta: "Deploy to buzz" },
] as const;

async function expectChannelLayout(
  page: Page,
  route: (typeof CHANNEL_ROUTES)[number],
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  await expect(page.locator('[data-slot="marketing-shell"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="aurora-hero"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="aurora-final-cta"]')).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 1, name: "Your agents, where you work." }),
  ).toHaveCount(1);
  await expect(page.locator('[data-slot="marketing-eyebrow"]')).toHaveText(route.eyebrow);

  const channelNavigation = page.getByRole("navigation", { name: "Channels" });
  await expect(channelNavigation.getByRole("link", { name: route.label, exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const heroCtaHref = await page
    .locator('[data-slot="aurora-hero"]')
    .getByRole("link", { name: route.cta })
    .getAttribute("href");
  const finalCtaHref = await page
    .locator('[data-slot="aurora-final-cta"]')
    .getByRole("link", { name: route.cta })
    .getAttribute("href");
  expect(heroCtaHref).toBeTruthy();
  expect(finalCtaHref).toBe(heroCtaHref);
  expect(new URL(heroCtaHref!).pathname).toBe("/");
  if (viewport.width >= 1024) {
    const headerCtaHref = await page
      .locator("header")
      .getByRole("link", { name: "Get started" })
      .getAttribute("href");
    expect(headerCtaHref).toBeTruthy();
    expect(new URL(heroCtaHref!).origin).toBe(new URL(headerCtaHref!).origin);
  }

  const finalCta = page.locator('[data-slot="aurora-final-cta"]');
  const alternateChannels = finalCta.locator("p").filter({ hasText: "Also available for" });
  await expect(alternateChannels).toBeVisible();
  const alternateHrefs = await alternateChannels.getByRole("link").evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  );
  expect(alternateHrefs.sort()).toEqual(
    CHANNEL_ROUTES.filter((channel) => channel.path !== route.path)
      .map((channel) => channel.path)
      .sort(),
  );
  await expect(finalCta.getByRole("link")).toHaveCount(6);
  await expect(page.locator("main dl dt")).toHaveCount(3);

  const geometry = await page.evaluate(() => {
    const hero = document.querySelector<HTMLElement>('[data-slot="aurora-hero"]');
    const heading = document.querySelector<HTMLElement>('[data-slot="aurora-hero-heading"]');
    const header = document.querySelector<HTMLElement>("body header");
    if (!hero || !heading || !header) throw new Error("Missing channel marketing geometry");
    const headerBox = header.getBoundingClientRect();
    return {
      headerBottom: headerBox.bottom,
      headingTop: heading.getBoundingClientRect().top,
      heroPaddingTop: Number.parseFloat(getComputedStyle(hero).paddingTop),
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

  const expectedHeroPadding = viewport.width >= 1024 ? 172 : 128;
  expect(Math.abs(geometry.heroPaddingTop - expectedHeroPadding)).toBeLessThanOrEqual(1);
  expect(geometry.headingTop).toBeGreaterThan(geometry.headerBottom + 32);
  expect(geometry.hasHorizontalOverflow).toBe(false);
}

for (const route of CHANNEL_ROUTES) {
  test(`${route.path} uses the consolidated channel marketing surface`, async ({ page }) => {
    await expectChannelLayout(page, route, { width: 1440, height: 1024 });
    await expectChannelLayout(page, route, { width: 390, height: 844 });
  });
}
