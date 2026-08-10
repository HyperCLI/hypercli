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

test("pricing preserves the Solo launch, Team trial, and Pro waitlist paths", async ({ page }) => {
  await page.goto("/pricing", { waitUntil: "domcontentloaded" });

  const pricing = page.getByRole("main");
  const soloCard = pricing
    .locator('[data-slot="pricing-tier-card"]')
    .filter({ has: page.getByRole("heading", { name: "Solo", exact: true }) });
  const teamCard = pricing
    .locator('[data-slot="pricing-tier-card"]')
    .filter({ has: page.getByRole("heading", { name: "Team", exact: true }) });
  const proCard = pricing
    .locator('[data-slot="pricing-tier-card"]')
    .filter({ has: page.getByRole("heading", { name: "Pro", exact: true }) });

  await expect(soloCard.getByRole("link", { name: "Get started" })).toHaveAttribute(
    "href",
    /\/dashboard\/agents\?open=agent-launcher&plan=solo$/,
  );
  await expect(teamCard.getByRole("link", { name: "Start free trial" })).toHaveAttribute(
    "href",
    /\/dashboard\/agents\?intent=trial&plan=team$/,
  );

  await proCard.getByRole("button", { name: "Join waitlist" }).click();
  const waitlistDialog = page.getByRole("dialog", { name: "Join the Pro waitlist" });
  await expect(waitlistDialog).toContainText("100M daily tokens of Kimi K3");
  await expect(waitlistDialog.locator('input[name="source"]')).toHaveValue("pricing-plan-pro-waitlist");
  await expect(waitlistDialog.getByRole("textbox", { name: /message/i })).toHaveCount(0);
  await waitlistDialog.getByRole("textbox", { name: /name/i }).fill("Test User");
  await waitlistDialog.getByRole("textbox", { name: /email/i }).fill("test@example.com");
  await page.route("**/__forms.html", async (route) => {
    await route.fulfill({ status: 200, body: "OK" });
  });
  const submissionPromise = page.waitForRequest(
    (request) => request.url().endsWith("/__forms.html") && request.method() === "POST",
  );
  await waitlistDialog.getByRole("button", { name: "Join waitlist" }).click();
  const submission = await submissionPromise;
  const payload = new URLSearchParams(submission.postData() ?? "");
  expect(payload.get("source")).toBe("pricing-plan-pro-waitlist");
  expect(payload.get("message")).toBeNull();
});

test("pricing contact forms identify each Beyond Pro path", async ({ page }) => {
  await page.goto("/pricing", { waitUntil: "domcontentloaded" });

  const paths = [
    { name: "Scale", cta: "Talk to us", source: "pricing-beyond-pro-scale" },
    { name: "Private cloud", cta: "Talk to engineering", source: "pricing-beyond-pro-private-cloud" },
    { name: "Self-hosted", cta: "Talk to engineering", source: "pricing-beyond-pro-self-hosted" },
  ] as const;

  for (const path of paths) {
    const card = page.getByRole("heading", { name: path.name, exact: true }).locator("..");
    await card.getByRole("button", { name: path.cta }).click();
    const dialog = page.getByRole("dialog", { name: "Get Started" });
    await expect(dialog.locator('input[name="source"]')).toHaveValue(path.source);
    await dialog.getByRole("button", { name: "Close modal" }).click();
  }
});
