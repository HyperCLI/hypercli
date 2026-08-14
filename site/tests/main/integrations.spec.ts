import { expect, test, type Page } from "@playwright/test";
import { INTEGRATION_DETAILS } from "../../apps/main/src/content/integration-details";

const GOOGLE_INTEGRATIONS = [
  { path: "/integrations/google-drive", name: "Google Drive", preview: false },
  { path: "/integrations/google-docs", name: "Google Docs", preview: false },
  { path: "/integrations/google-calendar", name: "Google Calendar", preview: false },
] as const;

const CATALOG_ENTRIES = [
  { slug: "google-drive", name: "Google Drive", status: "Available now" },
  { slug: "google-docs", name: "Google Docs", status: "Available now" },
  { slug: "google-calendar", name: "Google Calendar", status: "Available now" },
  { slug: "slack", name: "Slack", status: "Available now" },
  { slug: "microsoft-teams", name: "Microsoft Teams", status: "Available now" },
  { slug: "telegram", name: "Telegram", status: "Available now" },
  { slug: "whatsapp", name: "WhatsApp", status: "Available now" },
  { slug: "discord", name: "Discord", status: "Available now" },
  { slug: "gmail", name: "Gmail", status: "Coming soon" },
  { slug: "google-sheets", name: "Google Sheets", status: "Coming soon" },
  { slug: "dropbox", name: "Dropbox", status: "Coming soon" },
  { slug: "notion", name: "Notion", status: "Coming soon" },
  { slug: "linear", name: "Linear", status: "Coming soon" },
  { slug: "github", name: "GitHub", status: "Available now" },
  { slug: "gitlab", name: "GitLab", status: "Coming soon" },
  { slug: "figma", name: "Figma", status: "Coming soon" },
  { slug: "stripe", name: "Stripe", status: "Coming soon" },
  { slug: "salesforce", name: "Salesforce", status: "Coming soon" },
  { slug: "any-api", name: "Any API", status: "Available now" },
] as const;

async function expectHydrated(page: Page) {
  await expect(page.locator("body")).toHaveAttribute("data-theme", /aurora-(?:dark|light)/, {
    timeout: 30_000,
  });
}

async function setColorMode(page: Page, mode: "light" | "dark") {
  await expectHydrated(page);
  if ((await page.locator("body").getAttribute("data-color-mode")) !== mode) {
    await page.getByRole("button", { name: `Switch to ${mode} mode` }).click();
  }
  await expect(page.locator("body")).toHaveAttribute("data-theme", `aurora-${mode}`);
  await expect(page.locator("body")).toHaveAttribute("data-color-mode", mode);
}

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

test("catalog presents the complete prototype inventory with explicit status", async ({ page }) => {
  await page.goto("/integrations", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Showing 19 integrations", { exact: true })).toHaveText("Showing 19 integrations");
  await expect(page.getByRole("link", { name: "See what it does with Drive →" })).toHaveAttribute(
    "href",
    "/integrations/google-drive",
  );
  await expect(page.getByRole("link", { name: "See what it does with Docs →" })).toHaveAttribute(
    "href",
    "/integrations/google-docs",
  );
  await expect(page.getByRole("link", { name: "See what it does with Calendar →" })).toHaveAttribute(
    "href",
    "/integrations/google-calendar",
  );
  await expect(page.getByText("Preview", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(9);

  for (const entry of CATALOG_ENTRIES) {
    const card = page.locator(`[data-integration="${entry.slug}"]`);
    await expect(card, `${entry.name} catalog entry`).toHaveCount(1);
    await expect(card.getByRole("heading", { name: entry.name, exact: true })).toBeVisible();
    await expect(card.getByText(entry.status, { exact: true })).toBeVisible();
  }

  await expect(page.getByRole("heading", { level: 2, name: "Featured — Google Workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Everything else" })).toBeVisible();

  await expect(page.locator('[data-integration="google-drive"]')).toContainText(
    "Your agent's filing cabinet. It finds files by what they are, not what you named them, keeps folders sane, and watches shared drives for changes while you sleep.",
  );
  await expect(page.locator('[data-integration="google-docs"]')).toContainText(
    "Drafts, rewrites, and summarizes docs in your voice — learned from everything you've already written. Meeting notes to brief in ninety seconds.",
  );
  await expect(page.locator('[data-integration="google-calendar"]')).toContainText(
    "It guards your week like a chief of staff: schedules around your focus time, preps you before every meeting, and chases the follow-ups after.",
  );
});

test("integrations catalog matches the approved hero and fallback composition", async ({ page }) => {
  await page.setViewportSize({ width: 945, height: 900 });
  await page.goto("/integrations", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  const hero = page.locator('[data-slot="aurora-hero"]');
  await expect(hero.getByRole("heading", { level: 1 })).toHaveText(
    "Plug your agent intoeverything you already use.",
  );
  await expect(hero.locator('[data-slot="aurora-hero-lead"]')).toHaveText(
    "Same agent, same memory, every tool. Connect once — it carries context from your Drive into your Docs, your Calendar into your Slack, without you re-explaining a thing.",
  );
  await expect(hero.locator('[data-slot="aurora-hero-backdrop"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="integration-legend-chip"]')).toHaveCount(0);

  const filterGroup = page.getByRole("group", { name: "Filter integrations" });
  const leadBox = await hero.locator('[data-slot="aurora-hero-lead"]').boundingBox();
  const filterBox = await filterGroup.boundingBox();
  expect(leadBox).not.toBeNull();
  expect(filterBox).not.toBeNull();
  expect(filterBox!.y - (leadBox!.y + leadBox!.height)).toBeGreaterThanOrEqual(42);
  expect(filterBox!.y - (leadBox!.y + leadBox!.height)).toBeLessThanOrEqual(46);

  const fallbackHeading = page.locator('[data-slot="integration-fallback-heading"]');
  await expect(fallbackHeading).toHaveText("Don't see yours?It can drive a browser like a person.");
  const fallback = fallbackHeading.locator('xpath=ancestor::*[@data-slot="marketing-container"]');
  await expect(fallback).toContainText(
    "No API, no problem. Walk it through the website once and it writes itself a skill — your weirdest internal tool is its favorite.",
  );
  await expect(fallback.getByRole("link", { name: "Deploy your agent" })).toBeVisible();
  const requestButton = fallback.getByRole("button", { name: "Request an integration" });
  await expect(requestButton).toBeVisible();
  await expect(fallback.getByText("Custom service", { exact: true })).toHaveCount(0);
  expect((await fallback.boundingBox())!.height).toBeLessThan(500);
  await expect(page.locator('[data-slot="aurora-final-cta"]')).toHaveCount(0);

  await requestButton.click();
  const dialog = page.getByRole("dialog", { name: "Get Started" });
  await expect(dialog.locator('input[name="source"]')).toHaveValue("integrations-request");
});

test("catalog filters the featured and standard entries together", async ({ page }) => {
  await page.goto("/integrations", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  const messaging = page.getByRole("button", { name: "Messaging", exact: true });
  await messaging.click();
  await expect(messaging).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Showing 5 integrations", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Slack", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google Drive", exact: true })).toHaveCount(0);

  const google = page.getByRole("button", { name: "Google", exact: true });
  await google.click();
  await expect(google).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Showing 5 integrations", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google Drive", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gmail", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Slack", exact: true })).toHaveCount(0);
});

test("Google Drive preserves the approved prototype copy verbatim", async ({ page }) => {
  await page.goto("/integrations/google-drive", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  const main = page.getByRole("main");
  for (const copy of [
    "Your agent's filing cabinet. It finds files by what they are, not what you named them — and keeps the shared drive sane while you sleep.",
    "What it does with your Drive",
    "Not search. An actual filing clerk with perfect recall.",
    "Finds by meaning",
    '"The deck Sarah made for the Berlin pitch" — found. It\'s called final_v3_REAL.pptx and it\'s in a folder named "misc." Your agent doesn\'t care. It reads what\'s inside.',
    "Files like a person would",
    "Consistent names, duplicates flagged, shared drives organized to the structure you already meant to keep. It proposes the re-org first — you approve, it executes.",
    "Watches folders for you",
    'New file lands in "Contracts"? Summarized overnight, key terms flagged, expiry dates on your calendar. You read the brief, not the PDF.',
    "Summarizes the pile",
    '"What changed in the Q3 folder this week?" One paragraph, every change linked. Works across 4 files or 4,000 — the flat rate doesn\'t care either.',
    "A Tuesday morning, with Drive connected",
    "The kind of thing you'll stop thinking about.",
    "Connected in three steps",
    "No IT ticket. No admin console safari.",
    "Standard OAuth — you approve the scopes, we're in. About twenty seconds, most of it reading Google's consent screen.",
    "Whole Drive, specific shared drives, or just the folders you choose. Read-only by default; write access is a per-folder opt-in.",
    "find the berlin pitch deck and update the pricing slide to the march rates",
    "Found it — final_v3_REAL.pptx in Sales/Pitches/misc. Pricing slide updated to the March rates; I logged every change in the slide comments so you can sanity-check. Want the PDF version for the client too?",
    "yes. and anything new in Contracts i should know about?",
    "Initiative has rules here.",
    "Same agent, same memory — context flows between all three.",
    "Files it finds become drafts it writes.",
    "Meeting prep lands in Drive before the invite starts.",
    '"Found it" messages, straight into the thread.',
  ]) {
    await expect(main.getByText(copy, { exact: true })).toBeVisible();
  }

  await expect(main.getByRole("link", { name: "See it in a workflow" })).toHaveAttribute("href", "#workflow");
  await expect(main.locator('[data-slot="integration-availability-meta"]')).toHaveText(
    "Available nowShips on every plan, flat rateConnects in ~20 seconds",
  );
  expect(INTEGRATION_DETAILS.find(({ slug }) => slug === "google-drive")?.messages[3]?.text).toBe(
    "PDF's in the same folder. Contracts: two new MSAs overnight — one standard, one with an unusual liability cap in section 8. Summary of the cap attached, flagged for counsel. 📎 berlin-pitch-v4.pdf · msa-summary.pdf",
  );
  await expect(main.locator('[data-slot="aurora-final-cta"] h2')).toHaveText(
    "Your Drive has good stuff in it.Let something finally read it.",
  );
  await expect(main.getByRole("link", { name: "Connect Google Drive" })).toHaveCount(2);
  await expect(main.getByText("7-day free trial · Ships on every plan · Read-only by default", { exact: true })).toBeVisible();
});

test("Google Docs preserves the approved hero and capability copy verbatim", async ({ page }) => {
  await page.goto("/integrations/google-docs", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  const main = page.getByRole("main");
  await expect(main.locator('[data-slot="aurora-hero-lead"]')).toHaveText(
    "It drafts, rewrites, and summarizes in your voice — because it learned your voice from everything you've already written.",
  );
  for (const copy of [
    "What it does with your Docs",
    "Not autocomplete. A ghostwriter who studied under you.",
    "Drafts from bullets",
    "Rewrites without the red pen",
    "Meetings to briefs in 90 seconds",
    "Reads the whole pile",
    "Available now",
    "Ships on every plan, flat rate",
    "Connects in ~20 seconds",
    "7-day free trial · Ships on every plan · Suggestion-mode by default",
  ]) {
    await expect(main.getByText(copy, { exact: true })).toBeVisible();
  }
  await expect(main.getByRole("link", { name: "Connect Google Docs" })).toHaveCount(2);
});

test("Google Calendar preserves the approved hero and capability copy verbatim", async ({ page }) => {
  await page.goto("/integrations/google-calendar", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  const main = page.getByRole("main");
  await expect(main.locator('[data-slot="aurora-hero-lead"]')).toHaveText(
    "A chief of staff for your week. It guards your focus time, preps you before every meeting, and chases the follow-ups after.",
  );
  for (const copy of [
    "What it does with your Calendar",
    "Not a booking link. Judgment about your time.",
    "Schedules like it knows you",
    "Preps you before every meeting",
    "Handles the back-and-forth",
    "Chases the follow-ups",
    "Available now",
    "Ships on every plan, flat rate",
    "Connects in ~20 seconds",
    "7-day free trial · Ships on every plan · External emails always need your yes",
  ]) {
    await expect(main.getByText(copy, { exact: true })).toBeVisible();
  }
  await expect(main.getByRole("link", { name: "Connect Google Calendar" })).toHaveCount(2);
  expect(
    await main.locator('[data-slot="integration-availability-meta"] svg').evaluateAll((icons) =>
      icons.map((icon) => getComputedStyle(icon).color),
    ),
  ).toEqual(["rgb(217, 48, 37)", "rgb(217, 48, 37)", "rgb(217, 48, 37)"]);
});

test("integration details reveal on scroll and respect reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 945, height: 700 });
  await page.goto("/integrations/google-docs", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  const root = page.locator('[data-home-motion-root]');
  await expect(root).toHaveAttribute("data-home-motion-ready", "true");
  const workflowHeading = page.getByRole("heading", { name: "A Wednesday night, with Docs connected" });
  await expect(workflowHeading).not.toHaveAttribute("data-home-revealed", "true");
  await expect(workflowHeading).toHaveCSS("opacity", "0");
  await workflowHeading.scrollIntoViewIfNeeded();
  await expect(workflowHeading).toHaveAttribute("data-home-revealed", "true");
  await expect(workflowHeading).toHaveCSS("opacity", "1");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(root).toHaveAttribute("data-home-motion-ready", "reduced");
  await expect(page.getByRole("heading", { name: "A Wednesday night, with Docs connected" })).toHaveCSS("opacity", "1");
});

test("detail card reveals rebind after client-side integration navigation", async ({ page }) => {
  await page.setViewportSize({ width: 945, height: 700 });
  await page.goto("/integrations/google-docs", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);
  await expect(page.locator('script[src*="twemoji"]')).toHaveCount(0);
  await expect(page.locator("#workflow img.emoji")).toHaveCount(0);

  await page.locator('a[href="/integrations/google-calendar"]').click();
  await expect(page).toHaveURL(/\/integrations\/google-calendar$/);
  const card = page.getByRole("heading", { name: "Schedules like it knows you" }).locator("xpath=ancestor::article[1]");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-home-revealed", "true");
  await expect(card).toHaveCSS("opacity", "1");
});

for (const integration of GOOGLE_INTEGRATIONS) {
  test(`${integration.path} exposes its verified availability state`, async ({ page }) => {
    await page.goto(integration.path, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1, name: integration.name })).toBeVisible();
    await expect(page.getByText("Product preview", { exact: true })).toHaveCount(0);
    const previewNotice = page.locator('[data-slot="integration-preview-notice"]');
    if (integration.preview) {
      await expect(
        page.getByText("Preview only · Native connection behavior remains subject to verification", { exact: true }),
      ).toBeVisible();
      await expect(previewNotice).toContainText(`Native ${integration.name} availability`);
      await expect(previewNotice).toContainText("OAuth scopes");
      await expect(previewNotice).toContainText("under review");
      await expect(page.getByRole("link", { name: `Connect ${integration.name}` })).toHaveCount(0);

      const bodyText = await page.getByRole("main").innerText();
      for (const unsupportedClaim of [
        "Read-only by default",
        "Standard OAuth",
        "Every action in the audit log",
        "Revoke anytime",
        "Available now",
        "Connects in ~20 seconds",
        "Ships on every plan",
      ]) {
        expect(bodyText, `${integration.name} should not claim ${unsupportedClaim}`).not.toContain(unsupportedClaim);
      }
    } else {
      await expect(previewNotice).toHaveCount(0);
      await expect(page.getByText("Preview only", { exact: false })).toHaveCount(0);
    }

    const actionLabel = integration.preview ? "Launch your agent" : `Connect ${integration.name}`;
    const launchHref = await page
      .locator('[data-slot="aurora-hero"]')
      .getByRole("link", { name: actionLabel })
      .getAttribute("href");
    expect(launchHref).toBeTruthy();
    expect(new URL(launchHref!).pathname).toBe("/dashboard/agents");
    expect(new URL(launchHref!).search).toBe("?open=agent-launcher");

    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Integrations" })).toHaveAttribute(
      "href",
      "/integrations",
    );
  });
}

test("new integration color treatments retain AA contrast in both themes", async ({ page }) => {
  test.slow();
  await page.goto("/integrations", { waitUntil: "domcontentloaded" });
  await expectHydrated(page);

  for (const mode of ["light", "dark"] as const) {
    await setColorMode(page, mode);

    const catalogPairs = await page.locator('[data-slot="integration-card-action"]').evaluateAll((actions) => {
      const parse = (value: string) => (value.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      return actions.map((action) => ({
        foreground: parse(getComputedStyle(action).color),
        background: parse(getComputedStyle(action.closest<HTMLElement>("[data-integration]")!).backgroundColor),
      }));
    });
    for (const colors of catalogPairs) {
      expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
    }

    const chipPairs = await page
      .locator('[data-slot="integration-status"], [data-slot="integration-legend-chip"]')
      .evaluateAll((chips) => {
        const parse = (value: string) => (value.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        return chips.map((chip) => ({
          foreground: parse(getComputedStyle(chip).color),
          background: parse(getComputedStyle(chip).backgroundColor),
        }));
      });
    for (const colors of chipPairs) {
      expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
    }

    const terminalColors = await page.locator('[data-slot="integration-fallback-heading"]').evaluate((element) => {
      const parse = (value: string) => (value.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      const panel = element.closest<HTMLElement>('[data-slot="marketing-container"]')!;
      return {
        foreground: parse(getComputedStyle(element).color),
        background: parse(getComputedStyle(panel).backgroundColor),
      };
    });
    expect(contrastRatio(terminalColors.foreground, terminalColors.background)).toBeGreaterThanOrEqual(4.5);
  }

  for (const integration of GOOGLE_INTEGRATIONS) {
    await page.goto(integration.path, { waitUntil: "domcontentloaded" });
    for (const mode of ["light", "dark"] as const) {
      await setColorMode(page, mode);
      const stepPairs = await page.locator('[data-slot="integration-setup-number"]').evaluateAll((numbers) => {
        const parse = (value: string) => (value.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        return numbers.map((number) => ({
          foreground: parse(getComputedStyle(number).color),
          background: parse(getComputedStyle(number).backgroundColor),
        }));
      });
      for (const colors of stepPairs) {
        expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

test("homepage and footer expose the integrations catalog", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("link", { name: "Browse all integrations" })).toHaveAttribute(
    "href",
    "/integrations",
  );
  await expect(page.locator("footer").getByRole("link", { name: "Integrations" })).toHaveAttribute(
    "href",
    "/integrations",
  );
});
