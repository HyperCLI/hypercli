import { expect, test, type Page } from "@playwright/test";

const MARKETING_ROUTES = [
  {
    path: "/",
    heading: "Your agent never sleeps. Your bill never moves.",
    desktopHeaderHeight: 64,
  },
  {
    path: "/integrations",
    heading: "Plug your agent into everything you already use.",
    desktopHeaderHeight: 64,
    referenceHeroSpacing: true,
    customFinalCta: true,
  },
  {
    path: "/integrations/google-drive",
    heading: "Google Drive",
    desktopHeaderHeight: 64,
    referenceDetailSpacing: true,
  },
  {
    path: "/integrations/google-docs",
    heading: "Google Docs",
    desktopHeaderHeight: 64,
    referenceDetailSpacing: true,
  },
  {
    path: "/integrations/google-calendar",
    heading: "Google Calendar",
    desktopHeaderHeight: 64,
    referenceDetailSpacing: true,
  },
  {
    path: "/developers",
    heading: "Your agent gets a whole machine.",
    desktopHeaderHeight: 108,
  },
  {
    path: "/for-teams",
    heading: "The teammate that never clocks out.",
    desktopHeaderHeight: 108,
  },
  {
    path: "/enterprise",
    heading: "An AI workforce your company actually owns.",
    desktopHeaderHeight: 108,
  },
  {
    path: "/what-it-can-do",
    heading: "Hand it off. It's just done.",
    desktopHeaderHeight: 108,
  },
  {
    path: "/capabilities",
    heading: "Everything your agent can do.",
    desktopHeaderHeight: 108,
  },
  {
    path: "/pricing",
    heading: "Pick your agents.",
    desktopHeaderHeight: 108,
  },
  {
    path: "/quickstart",
    heading: "Deploy your first agent.",
    desktopHeaderHeight: 108,
  },
  {
    path: "/cli",
    heading: "It's in the name.",
    desktopHeaderHeight: 108,
  },
  {
    path: "/inference",
    heading: "Frontier models. Flat rate. No meter.",
    desktopHeaderHeight: 108,
  },
  {
    path: "/data-center",
    heading: "Your GPUs sleep eight hours a night. Our agents don't.",
    desktopHeaderHeight: 64,
  },
  {
    path: "/builders-program",
    heading: "Build something cool. We'll cover the compute.",
    desktopHeaderHeight: 64,
  },
  {
    path: "/self-hosted",
    heading: "The whole platform. Inside your walls.",
    desktopHeaderHeight: 108,
  },
  {
    path: "/pilot-program",
    heading: "Generic agents are a party trick. Yours will run your business.",
    desktopHeaderHeight: 108,
  },
  {
    path: "/security",
    heading: "Security that's architecture, not a policy document.",
    desktopHeaderHeight: 108,
  },
] as const;

const LEGACY_SHELL_ROUTES = [
  { path: "/architecture", heading: "A Distributed Compute Fabric for Modern AI" },
  { path: "/partner", heading: "A New Revenue Layer for AI." },
] as const;

function contrastRatio(foreground: number[], background: number[]): number {
  const luminance = (channels: number[]) => {
    const [red, green, blue] = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

async function expectMarketingLayout(
  page: Page,
  route: (typeof MARKETING_ROUTES)[number],
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  await expect(page.locator('[data-slot="marketing-shell"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="marketing-main"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="aurora-hero"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="aurora-final-cta"]')).toHaveCount(
    "customFinalCta" in route && route.customFinalCta ? 0 : 1,
  );
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: route.heading })).toHaveCount(1);

  const geometry = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>("body > div header, body header");
    const hero = document.querySelector<HTMLElement>('[data-slot="aurora-hero"]');
    const heading = document.querySelector<HTMLElement>('[data-slot="aurora-hero-heading"]');
    if (!header || !hero || !heading) throw new Error("Missing marketing header or hero heading");
    const headerBox = header.getBoundingClientRect();
    const headingBox = heading.getBoundingClientRect();
    return {
      headerBottom: headerBox.bottom,
      headerHeight: headerBox.height,
      heroPaddingTop: Number.parseFloat(getComputedStyle(hero).paddingTop),
      headingTop: headingBox.top,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

  const isHome = route.path === "/";
  const expectedHeaderHeight = isHome
    ? viewport.width >= 640
      ? 66
      : 58
    : viewport.width >= 1024
      ? route.desktopHeaderHeight
      : 64;
  const expectedHeroPadding = isHome
    ? expectedHeaderHeight + (viewport.width >= 640 ? 92 : 60)
    : "referenceHeroSpacing" in route && route.referenceHeroSpacing
      ? expectedHeaderHeight + (viewport.width > 640 ? 88 : 56)
      : "referenceDetailSpacing" in route && route.referenceDetailSpacing
        ? expectedHeaderHeight + (viewport.width > 640 ? 64 : 44)
      : expectedHeaderHeight + 64;
  expect(Math.abs(geometry.headerHeight - expectedHeaderHeight)).toBeLessThanOrEqual(3);
  expect(Math.abs(geometry.heroPaddingTop - expectedHeroPadding)).toBeLessThanOrEqual(1);
  expect(geometry.headingTop).toBeGreaterThanOrEqual(geometry.headerBottom + 32);
  expect(geometry.hasHorizontalOverflow).toBe(false);
}

async function expectHydrated(page: Page) {
  await expect(page.locator("body")).toHaveAttribute("data-theme", /aurora-(?:dark|light)/, {
    timeout: 30_000,
  });
}

for (const route of MARKETING_ROUTES) {
  test(`${route.path} keeps the shared marketing shell clear of the fixed header`, async ({ page }) => {
    await expectMarketingLayout(page, route, { width: 1440, height: 1024 });
    await expectMarketingLayout(page, route, { width: 390, height: 844 });
  });
}

for (const route of LEGACY_SHELL_ROUTES) {
  test(`${route.path} uses the shared semantic marketing shell`, async ({ page }) => {
    const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-slot="marketing-shell"]')).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
  });
}

test.describe("locale-safe hydration", () => {
  test.use({ locale: "de-DE" });

  for (const route of [
    { path: "/", expectedValue: "$27,000/mo" },
    { path: "/inference", expectedValue: "$27,000/mo" },
    { path: "/data-center", expectedValue: "~$700,000/yr" },
  ]) {
    test(`renders ${route.path} calculator values identically on the server and client`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));

      await page.goto(route.path, { waitUntil: "domcontentloaded" });

      await expect(page.getByText(route.expectedValue, { exact: true }).first()).toBeVisible();
      expect(pageErrors.filter((message) => message.includes("Hydration failed"))).toEqual([]);
    });
  }
});

test("uses the approved hero copy and keeps Pro qualification on the homepage", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const hero = page.locator('[data-slot="aurora-hero"]');
  await expect(hero.locator('[data-slot="aurora-hero-lead"]')).toHaveText(
    "An always-on agent with its own machine — browser, voice, media, memory — powered by Kimi K3, the largest open model ever released. 100 million tokens a day. One flat price.",
  );
  await expect(page.getByRole("button", { name: "Join waitlist" })).toHaveCount(1);
});

test("reveals homepage sections on scroll and preserves reduced-motion rendering", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  const motionRoot = page.locator("[data-home-motion-root]");
  await expect(motionRoot).toHaveAttribute("data-home-motion-ready", "true", { timeout: 30_000 });

  const channelHeading = page.getByRole("heading", {
    name: "One agent. Its own machine. Every channel you live in.",
  });
  await expect(channelHeading).toHaveCSS("opacity", "0");
  await expect(channelHeading).toHaveCSS("font-size", "70px");
  const channelLead = channelHeading.locator("xpath=following-sibling::p[1]");
  await expect(channelLead).toHaveCSS("font-size", "22.5px");

  await channelHeading.scrollIntoViewIfNeeded();
  await expect(channelHeading).toHaveAttribute("data-home-revealed", "true");
  await expect(channelHeading).toHaveCSS("opacity", "1");
  await expect(page.locator(".home-channel-spoke")).toHaveCount(6);
  await expect(page.locator(".home-channel-lines line")).toHaveCount(6);
  expect(
    await page.locator(".home-channel-core span").evaluate((element) => getComputedStyle(element).backgroundImage),
  ).toContain("hypercli-icon-blue.svg");

  const differentiation = page.getByRole("heading", {
    name: "It doesn't wait. It doesn't sleep. It doesn't forget.",
  });
  await differentiation.scrollIntoViewIfNeeded();
  await expect(differentiation).toHaveCSS("font-size", "70px");
  const actions = differentiation.locator("xpath=following-sibling::div[1]");
  await expect(actions.getByRole("link", { name: "Meet yours →" })).toBeVisible();
  await expect(actions.getByRole("link", { name: "Watch a night's work →" })).toBeVisible();
  const cards = differentiation.locator("xpath=following-sibling::div[2]");
  expect((await actions.boundingBox())!.y).toBeLessThan((await cards.boundingBox())!.y);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(motionRoot).toHaveAttribute("data-home-motion-ready", "reduced", { timeout: 30_000 });
  await expect(channelHeading).toHaveCSS("opacity", "1");
});

test("restores canonical homepage plan cards and keeps the plan note with them", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  const pricing = page.locator("#pricing");
  await pricing.scrollIntoViewIfNeeded();
  const cards = pricing.locator('[data-slot="home-pricing-tier-card"]');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("$39");
  await expect(cards.nth(1)).toContainText("$79");
  await expect(cards.nth(2)).toContainText("$149");
  await expect(pricing).toContainText(
    "7-day free trial on every plan · Cancel anytime · Fair use, not fine print",
  );
  const finalCta = page.locator('[data-slot="aurora-final-cta"]');
  await expect(finalCta).not.toContainText("Fair use, not fine print");
  await expect(finalCta).toContainText("100M/day of Kimi K3, flat");
  await expect(finalCta).toContainText("A whole machine per agent — not a chatbot");
  await expect(finalCta).toContainText("Open weights — an exit you'll never need");
  await expect(finalCta).toContainText(
    "7-day free trial · No per-token pricing, ever · It never buys or ships anything without you",
  );

  await cards.nth(2).getByRole("button", { name: "Join waitlist" }).click();
  const waitlist = page.getByRole("dialog", { name: "Join the Pro waitlist" });
  await expect(waitlist.locator('input[name="source"]')).toHaveValue("home-pricing-pro-waitlist");
});

test("renders the homepage Slack demo in both Aurora color modes", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  const chat = page.locator('[data-slot="chat-demo"]');
  await chat.scrollIntoViewIfNeeded();
  await expect(chat).toHaveCSS("background-color", "rgb(27, 35, 49)");
  await expect(chat.getByText("On it — checking all six tonight. Everything in this thread by 7am.")).toHaveCSS(
    "color",
    "rgb(185, 196, 214)",
  );

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(chat).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("keeps the homepage footer at the compact reference density", async ({ page }) => {
  await page.setViewportSize({ width: 954, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const footer = page.locator("footer");
  const footerHeight = await footer.evaluate((element) => element.getBoundingClientRect().height);
  expect(footerHeight).toBeLessThan(400);
  await expect(footer.getByRole("heading", { level: 3 })).toHaveCount(4);
  await expect(footer.getByRole("link", { name: "HyperCLI home" })).toBeHidden();
  await expect(footer.getByText("HyperCLI, Inc.", { exact: true })).toBeVisible();
});

test("switches header clearance at the desktop navigation breakpoint", async ({ page }) => {
  const route = MARKETING_ROUTES.find(({ path }) => path === "/developers");
  expect(route).toBeTruthy();
  await expectMarketingLayout(page, route!, { width: 1023, height: 900 });
  await expectMarketingLayout(page, route!, { width: 1024, height: 900 });
});

test("condenses non-home desktop navigation after scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/developers", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  const header = page.locator("header").first();
  await expect(header).toHaveAttribute("data-condensed", "false");
  expect(
    Math.abs(await header.evaluate((element) => element.getBoundingClientRect().height) - 108),
  ).toBeLessThanOrEqual(3);

  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(header).toHaveAttribute("data-condensed", "true");
  const compactHeader = page.locator('[data-slot="condensed-header"]');
  await expect(compactHeader).toBeVisible();
  await expect(compactHeader.getByRole("navigation", { name: "Audience" })).toBeVisible();
  await expect(compactHeader.getByRole("navigation", { name: "Section" })).toBeVisible();
  await expect(compactHeader.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  await expect(compactHeader.getByRole("link", { name: "Get started" })).toBeVisible();
  expect(
    Math.abs(await header.evaluate((element) => element.getBoundingClientRect().height) - 57),
  ).toBeLessThanOrEqual(2);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(header).toHaveAttribute("data-condensed", "false");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(page.locator("header").first()).toHaveAttribute("data-condensed", "false");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/developers", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(page.locator("header").first()).toHaveAttribute("data-condensed", "false");
  await expect(page.getByRole("button", { name: "Toggle mobile menu" })).toBeVisible();
});

test("offers a keyboard skip link to the marketing main content", async ({ page }) => {
  await page.goto("/developers", { waitUntil: "domcontentloaded" });
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});

test("keeps light-theme marketing accents at AA contrast", async ({ page }) => {
  await page.goto("/developers", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "aurora-light");

  const colors = await page.evaluate(() => {
    const channels = (value: string) =>
      (value.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const shadowColors = (value: string) =>
      [...value.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)].map((match) =>
        match.slice(1, 4).map(Number),
      );
    const eyebrow = document.querySelector<HTMLElement>('[data-slot="marketing-eyebrow"]');
    const cta = document.querySelector<HTMLElement>('[data-slot="aurora-hero"] .btn-primary');
    if (!eyebrow || !cta) throw new Error("Missing marketing contrast targets");
    cta.focus({ focusVisible: true });
    return {
      pageBackground: channels(getComputedStyle(document.body).backgroundColor),
      eyebrowText: channels(getComputedStyle(eyebrow).color),
      ctaBackground: channels(getComputedStyle(cta).backgroundColor),
      ctaText: channels(getComputedStyle(cta).color),
      focusRing: shadowColors(getComputedStyle(cta).boxShadow).at(-1) ?? [],
      focusBoxShadow: getComputedStyle(cta).boxShadow,
      focusOutlineStyle: getComputedStyle(cta).outlineStyle,
      focusOutlineWidth: Number.parseFloat(getComputedStyle(cta).outlineWidth),
    };
  });

  expect(contrastRatio(colors.eyebrowText, colors.pageBackground)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.ctaText, colors.ctaBackground)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.focusRing, colors.pageBackground)).toBeGreaterThanOrEqual(3);
  expect(colors.focusBoxShadow).not.toBe("none");
  expect(colors.focusOutlineStyle).not.toBe("none");
  expect(colors.focusOutlineWidth).toBeGreaterThan(0);
});

test("uses an icon-only theme toggle in the public header", async ({ page }) => {
  await page.goto("/developers", { waitUntil: "domcontentloaded" });
  const themeToggle = page.getByRole("button", { name: "Switch to light mode" });
  await expect(themeToggle).toBeVisible();
  await expect(themeToggle.locator("svg")).toBeVisible();
  await expect(themeToggle).toHaveText("");
});

test("preserves route-owned marketing actions", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const homeHero = page.locator('[data-slot="aurora-hero"]');
  const appRootHref = await homeHero.getByRole("link", { name: "Get your API key" }).getAttribute("href");
  const agentLaunchHref = await homeHero.getByRole("link", { name: "Launch your agent" }).getAttribute("href");
  expect(appRootHref).toBeTruthy();
  expect(agentLaunchHref).toBeTruthy();
  const appRoot = new URL(appRootHref!);
  const agentLaunch = new URL(agentLaunchHref!);
  expect(appRoot.pathname).toBe("/");
  expect(agentLaunch.origin).toBe(appRoot.origin);
  expect(`${agentLaunch.pathname}${agentLaunch.search}`).toBe(
    "/dashboard/agents?open=agent-launcher",
  );

  const enterpriseDoor = page
    .locator('a[aria-haspopup="dialog"]')
    .filter({ has: page.getByRole("heading", { name: "Own your AI workforce" }) });
  await enterpriseDoor.click();
  let contactDialog = page.getByRole("dialog", { name: "Get Started" });
  await expect(contactDialog.locator('input[name="source"]')).toHaveValue(
    "home-enterprise-talk-to-engineering",
  );
  await contactDialog.getByRole("button", { name: "Close modal" }).click();

  await page.goto("/developers", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("link", { name: "Get an API key" }).first()).toHaveAttribute("href", "/inference");
  await expect(page.getByRole("link", { name: "See the 5-minute quickstart" })).toHaveAttribute("href", "/quickstart");

  await page.goto("/for-teams", { waitUntil: "domcontentloaded" });
  const teamsHero = page.locator('[data-slot="aurora-hero"]');
  const slackHref = await teamsHero.getByRole("link", { name: "Add to Slack" }).getAttribute("href");
  const teamsHref = await teamsHero.getByRole("link", { name: "Add to Teams" }).getAttribute("href");
  expect(slackHref).toBeTruthy();
  expect(teamsHref).toBeTruthy();
  expect(new URL(slackHref!).origin).toBe(appRoot.origin);
  expect(new URL(slackHref!).pathname).toBe("/");
  expect(new URL(teamsHref!).origin).toBe(appRoot.origin);
  expect(new URL(teamsHref!).pathname).toBe("/");

  await page.goto("/enterprise", { waitUntil: "domcontentloaded" });
  const privateCloudDoor = page
    .locator('a[aria-haspopup="dialog"]')
    .filter({ has: page.getByRole("heading", { name: "Private Cloud" }) });
  await privateCloudDoor.click();
  contactDialog = page.getByRole("dialog", { name: "Get Started" });
  await expect(contactDialog.locator('input[name="source"]')).toHaveValue(
    "enterprise-private-cloud-talk-to-engineering",
  );
  await contactDialog.getByRole("button", { name: "Close modal" }).click();

  await page.getByRole("button", { name: "architecture brief →" }).click();
  contactDialog = page.getByRole("dialog", { name: "Get Started" });
  await expect(contactDialog.locator('input[name="source"]')).toHaveValue("enterprise-architecture-brief");
  await page.getByRole("button", { name: "Close modal" }).click();
  await page.getByRole("button", { name: "Talk to engineering" }).click();
  contactDialog = page.getByRole("dialog", { name: "Get Started" });
  await expect(contactDialog.locator('input[name="source"]')).toHaveValue("enterprise-talk-to-engineering");
  await contactDialog.getByRole("button", { name: "Close modal" }).click();
  await page.getByRole("button", { name: "Get the architecture brief" }).click();
  contactDialog = page.getByRole("dialog", { name: "Get Started" });
  await expect(contactDialog.locator('input[name="source"]')).toHaveValue("enterprise-architecture-brief");
  await contactDialog.getByRole("button", { name: "Close modal" }).click();

  await page.goto("/partner", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Become a Partner" }).click();
  await expect(page.getByRole("heading", { name: "Become a Partner" })).toBeVisible();
});

test("preview conversation actions open source-tagged forms", async ({ page }) => {
  await page.goto("/preview/cloud", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Talk to Sales" }).click();
  let dialog = page.getByRole("dialog", { name: "Get Started" });
  await expect(dialog.locator('input[name="source"]')).toHaveValue("preview-cloud-talk-to-sales");
  await dialog.getByRole("button", { name: "Close modal" }).click();

  await page.goto("/preview/finance", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Schedule Compliance Review" }).click();
  dialog = page.getByRole("dialog", { name: "Get Started" });
  await expect(dialog.locator('input[name="source"]')).toHaveValue("preview-finance-compliance-review");
});

test("keeps the shared final CTA on a dark terminal surface in both themes", async ({ page }) => {
  await page.goto("/developers", { waitUntil: "domcontentloaded" });
  const panel = page.locator(
    '[data-slot="aurora-final-cta"] > [data-slot="marketing-container"]',
  );

  for (const mode of ["light", "dark"] as const) {
    await page
      .getByRole("button", { name: `Switch to ${mode} mode` })
      .click();
    await expect(page.locator("body")).toHaveAttribute("data-theme", `aurora-${mode}`);
    const channels = await panel.evaluate((element) => {
      const match = getComputedStyle(element).backgroundColor.match(/\d+/g);
      return match?.slice(0, 3).map(Number) ?? [];
    });
    expect(channels).toHaveLength(3);
    expect(Math.max(...channels)).toBeLessThan(70);

    const descriptionColors = await panel.evaluate((element) => {
      const parse = (value: string) => (value.match(/\d+/g) ?? []).slice(0, 3).map(Number);
      const description = element.querySelector<HTMLElement>(
        '[data-slot="aurora-final-cta-description"]',
      );
      if (!description) throw new Error("Missing final CTA description");
      return {
        background: parse(getComputedStyle(element).backgroundColor),
        foreground: parse(getComputedStyle(description).color),
      };
    });
    expect(
      contrastRatio(descriptionColors.foreground, descriptionColors.background),
    ).toBeGreaterThanOrEqual(4.5);

    const secondaryAction = panel.getByRole("link", { name: "See the 5-minute quickstart" });
    await secondaryAction.hover();
    const secondaryColors = await secondaryAction.evaluate((element) => {
      const parse = (value: string) => (value.match(/\d+/g) ?? []).slice(0, 3).map(Number);
      return {
        foreground: parse(getComputedStyle(element).color),
        background: parse(
          getComputedStyle(element.closest<HTMLElement>('[data-slot="marketing-container"]')!).backgroundColor,
        ),
      };
    });
    expect(
      contrastRatio(secondaryColors.foreground, secondaryColors.background),
    ).toBeGreaterThanOrEqual(4.5);
  }
});
