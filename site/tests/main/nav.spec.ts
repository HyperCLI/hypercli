import { expect, test } from "@playwright/test";

test("navbar links all render", async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);

  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toContainText(/hypercli/i);

  const hrefs: string[] = await page.evaluate(() => {
    const anchors = Array.from(
      document.querySelectorAll("header a[href], nav a[href]")
    ) as HTMLAnchorElement[];
    const internal = anchors
      .map((a) => a.getAttribute("href") || "")
      .filter((href) => href.startsWith("/") && !href.startsWith("//"));
    return Array.from(new Set(internal));
  });

  expect(hrefs.length).toBeGreaterThan(0);

  for (const href of hrefs) {
    const res = await request.get(new URL(href, baseURL).toString());
    expect(res.status(), `GET ${href}`).toBe(200);
    const body = await res.text();
    expect(body.toLowerCase(), `content of ${href}`).toContain("hypercli");
  }
});

test("clicking a visible navbar link navigates", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const candidates = page.locator("header a[href], nav a[href]");
  const count = await candidates.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const link = candidates.nth(i);
    if (!(await link.isVisible())) continue;
    const href = await link.getAttribute("href");
    if (!href || !href.startsWith("/") || href === "/") continue;
    await link.click();
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toContain(href);
    await expect(page.locator("body")).toContainText(/hypercli/i);
    return;
  }
  throw new Error("no clickable internal navbar link found");
});

test("pricing sends trial and paid plan intents to the canonical agents dashboard", async ({ page }) => {
  await page.goto("/pricing", { waitUntil: "domcontentloaded" });

  const pricing = page.getByRole("main");
  const trialLinks = pricing.getByRole("link", { name: /start (your )?free trial/i });
  await expect(trialLinks.first()).toHaveAttribute("href", /\/dashboard\/agents\?intent=trial&plan=team$/);
  await expect(pricing.getByRole("link", { name: "Get started" })).toHaveAttribute(
    "href",
    /\/dashboard\/agents\?open=agent-launcher&plan=solo$/,
  );
  await expect(pricing.getByRole("link", { name: "Go Pro" })).toHaveAttribute(
    "href",
    /\/dashboard\/agents\?open=agent-launcher&plan=pro$/,
  );
});
