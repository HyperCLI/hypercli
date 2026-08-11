import { expect, test, type Locator, type Page } from "@playwright/test";

const PRIVY_MODAL_SELECTOR = "#privy-modal-content";
const PRIVATE_API_PATH = /^\/(?:api\/)?(?:agents|workspaces|usage|billing)(?:\/|$)/;
const DEFAULT_PREVIEW_HEADING = "Your business, one chat";

const planResponse = {
  plans: [{
    id: "pro",
    name: "Pro",
    price: 99,
    price_usd: 99,
    aiu: 5,
    agents: 1,
    features: ["Large agent slot", "Priority routing", "Memory indexing"],
    models: ["kimi-k2.5"],
    highlighted: true,
    limits: { tpd: 250_000_000, tpm: 100_000, burst_tpm: 200_000, rpm: 300 },
    meta: { checkout_bundle: { large: 1 } },
  }],
};

async function prepareAnonymousFlow(page: Page): Promise<string[]> {
  const forbiddenRequests: string[] = [];
  page.on("request", (request) => {
    if (!["fetch", "xhr"].includes(request.resourceType())) return;
    const path = new URL(request.url()).pathname;
    if (PRIVATE_API_PATH.test(path) && !path.endsWith("/plans")) {
      forbiddenRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (["fetch", "xhr"].includes(request.resourceType()) && request.method() === "GET" && path.endsWith("/plans")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(planResponse) });
      return;
    }
    await route.continue();
  });

  return forbiddenRequests;
}

async function openMobileNavigation(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Open navigation" }).tap();
  const navigation = page.getByRole("dialog", { name: "Agent navigation" });
  await expect(navigation).toHaveAttribute("data-state", "open");
  return navigation;
}

async function expectPrivyEmailAcceptsTouch(page: Page): Promise<Locator> {
  const privyModal = page.locator(PRIVY_MODAL_SELECTOR).first();
  await expect(privyModal).toBeVisible();

  const emailInput = privyModal.locator(
    'input[type="email"], input[name="email"], input[autocomplete="email"]'
  ).first();
  await expect(emailInput).toBeVisible();
  await emailInput.tap();
  await expect(emailInput).toBeFocused();

  return privyModal;
}

async function closePrivy(page: Page, privyModal: Locator): Promise<void> {
  await privyModal.getByRole("button", { name: /close modal/i }).tap();
  await expect(page.locator(PRIVY_MODAL_SELECTOR)).toHaveCount(0);
}

async function expectAnonymousFlowComplete(
  page: Page,
  previewHeading: string | RegExp = DEFAULT_PREVIEW_HEADING
): Promise<void> {
  await expect(page.getByRole("heading", { name: previewHeading })).toBeVisible();
  await expect(page.locator(PRIVY_MODAL_SELECTOR)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Agent navigation" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "A quick tour of your agent workspace" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "New Domain" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Create agent", includeHidden: true })).toHaveCount(0);
  await expect(page.locator("[data-agent-launch-surface]")).toHaveCount(0);
}

async function completeAuthenticationRoundTrip(
  page: Page,
  previewHeading: string | RegExp = DEFAULT_PREVIEW_HEADING
): Promise<void> {
  const privyModal = await expectPrivyEmailAcceptsTouch(page);
  await closePrivy(page, privyModal);
  await expectAnonymousFlowComplete(page, previewHeading);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
  )).toBe(true);
}

async function expectLaunchEmptyStateFits(page: Page, allowVerticalScroll = false): Promise<void> {
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  const emptyState = page.getByTestId("agent-launch-empty-state");
  await expect(emptyState).toBeVisible();
  await emptyState.evaluate((element) => { element.scrollTop = 0; });

  const metrics = await emptyState.evaluate((element) => {
    const stateBox = element.getBoundingClientRect();
    const title = element.querySelector<HTMLElement>("h1");
    const button = element.querySelector<HTMLElement>("button");
    const examples = Array.from(element.querySelectorAll<HTMLElement>('[data-slot="agent-feature-empty-state-example"]'));
    if (!title || !button || examples.length !== 3) throw new Error("Missing launch empty-state content");
    const titleBox = title.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    const horizontalOffenders = [title, button, ...examples].flatMap((item) => {
      const box = item.getBoundingClientRect();
      return box.left < stateBox.left - 1 || box.right > stateBox.right + 1
        ? [{ text: item.textContent?.trim() ?? "", left: box.left, right: box.right }]
        : [];
    });
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      stateTop: stateBox.top,
      stateBottom: stateBox.bottom,
      titleTop: titleBox.top,
      buttonBottom: buttonBox.bottom,
      horizontalOffenders,
    };
  });

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.titleTop).toBeGreaterThanOrEqual(metrics.stateTop - 1);
  expect(metrics.horizontalOffenders).toEqual([]);

  if (!allowVerticalScroll) {
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
    expect(metrics.buttonBottom).toBeLessThanOrEqual(metrics.stateBottom + 1);
    return;
  }

  await emptyState.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const endMetrics = await emptyState.evaluate((element) => {
    const stateBox = element.getBoundingClientRect();
    const button = element.querySelector<HTMLElement>("button");
    if (!button) throw new Error("Missing launch empty-state action");
    const buttonBox = button.getBoundingClientRect();
    return {
      buttonTop: buttonBox.top,
      buttonBottom: buttonBox.bottom,
      stateTop: stateBox.top,
      stateBottom: stateBox.bottom,
      scrollTop: element.scrollTop,
      maxScrollTop: element.scrollHeight - element.clientHeight,
    };
  });

  expect(endMetrics.scrollTop).toBeGreaterThanOrEqual(endMetrics.maxScrollTop - 1);
  expect(endMetrics.buttonTop).toBeGreaterThanOrEqual(endMetrics.stateTop - 1);
  expect(endMetrics.buttonBottom).toBeLessThanOrEqual(endMetrics.stateBottom + 1);
}

async function readSavedDraftName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const rawDraft = window.sessionStorage.getItem("hypercli-first-agent-draft");
    if (!rawDraft) return null;
    return (JSON.parse(rawDraft) as { name?: string }).name ?? null;
  });
}

test("keeps the mobile Privy email field touchable and restores the login wall", async ({ page }) => {
  const forbiddenRequests = await prepareAnonymousFlow(page);

  await page.goto("/");
  const loginHeading = page.getByRole("heading", { name: "Welcome to HyperCLI Agents" });
  const loginButton = page.getByRole("button", { name: "Login with Privy" });
  await expect(loginHeading).toBeVisible();
  await expect(loginButton).toBeEnabled();
  await loginButton.tap();

  const privyModal = await expectPrivyEmailAcceptsTouch(page);
  await closePrivy(page, privyModal);

  await expect(loginHeading).toBeVisible();
  await expect(loginButton).toBeEnabled();
  expect(forbiddenRequests).toEqual([]);
});

test("opens authentication when the browser does not provide crypto.randomUUID", async ({ page }) => {
  const compatibilityErrors: string[] = [];
  const recordCompatibilityError = (message: string) => {
    if (/randomUUID|script tag while rendering/i.test(message)) compatibilityErrors.push(message);
  };
  page.on("console", (message) => recordCompatibilityError(message.text()));
  page.on("pageerror", (error) => recordCompatibilityError(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
  });
  const forbiddenRequests = await prepareAnonymousFlow(page);

  await page.goto("/dashboard/agents?plan=pro");
  await expect.poll(() => page.evaluate(() => typeof crypto.randomUUID)).toBe("function");
  await expect.poll(() => page.evaluate(() => crypto.randomUUID())).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );

  const emptyState = page.getByTestId("agent-launch-empty-state");
  await emptyState.getByRole("button", { name: "Launch agent", exact: true }).tap();
  await completeAuthenticationRoundTrip(page);

  expect(compatibilityErrors).toEqual([]);
  expect(forbiddenRequests).toEqual([]);
});

test("completes mobile previews and every dashboard authentication gate", async ({ page }) => {
  const forbiddenRequests = await prepareAnonymousFlow(page);

  await page.goto("/dashboard/agents?plan=pro");
  await expectAnonymousFlowComplete(page);
  await expectLaunchEmptyStateFits(page);

  const previewSections = [
    ["Files", "Your files, working for you"],
    ["Integrations", "Your stack, unified"],
    ["Skills", "Your expertise, reusable"],
    ["Scheduled", "Work that keeps moving"],
    ["Desktop", "A browser built for action"],
  ] as const;

  for (const [section, heading] of previewSections) {
    const navigation = await openMobileNavigation(page);
    await expect(navigation.locator(".agent-desktop-navigation")).toHaveAttribute("data-expanded-section", "workspace");
    await navigation.getByRole("button", { name: section, exact: true }).tap();
    await expect(navigation).toHaveCount(0);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expectLaunchEmptyStateFits(page);
  }

  const desktopPreview = page.getByRole("heading", { name: "A browser built for action" }).locator("xpath=..");
  await desktopPreview.getByRole("button", { name: "Launch agent", exact: true }).tap();
  await completeAuthenticationRoundTrip(page, "A browser built for action");

  let navigation = await openMobileNavigation(page);
  await navigation.getByRole("button", { name: "Start free trial", exact: true }).tap();
  await expect(navigation).toHaveCount(0);
  await completeAuthenticationRoundTrip(page, "A browser built for action");

  navigation = await openMobileNavigation(page);
  const workspaceSelector = navigation.getByRole("button", { name: /Current workspace:/ });
  if (await workspaceSelector.isVisible().catch(() => false)) {
    await workspaceSelector.tap();
    const newWorkspace = page.getByRole("menuitem", { name: /New Domain/ });
    await expect(newWorkspace).toBeEnabled();
    await newWorkspace.tap();
  } else {
    // The current workspace-empty state routes creation through the navigation rail's
    // launch action instead of rendering the legacy workspace selector.
    const launchWorkspace = navigation.getByRole("button", { name: "Launch agent", exact: true }).first();
    await expect(launchWorkspace).toBeEnabled();
    await launchWorkspace.tap();
  }
  await expect(navigation).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "New Domain" })).toHaveCount(0);
  await completeAuthenticationRoundTrip(page, "A browser built for action");

  navigation = await openMobileNavigation(page);
  await navigation.getByRole("button", { name: "Expand agents sidebar" }).tap();
  await expect(navigation.locator(".agent-desktop-navigation")).toHaveAttribute("data-expanded-section", "agents");
  const roster = navigation.locator(".agents-roster-shell");
  await roster.getByRole("button", { name: "Launch agent" }).first().tap();
  await expect(navigation).toHaveCount(0);
  await completeAuthenticationRoundTrip(page, "A browser built for action");

  await expectNoHorizontalOverflow(page);
  expect(forbiddenRequests).toEqual([]);
});

test("keeps the complete launch empty state reachable in a short phone viewport", async ({ page }) => {
  const forbiddenRequests = await prepareAnonymousFlow(page);
  await page.goto("/dashboard/agents?plan=pro");
  await expectAnonymousFlowComplete(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--claw-safe-area-bottom-effective", "24px");
  });

  await expectLaunchEmptyStateFits(page, true);
  await expectNoHorizontalOverflow(page);
  expect(forbiddenRequests).toEqual([]);
});

test("opens authentication directly for mobile launcher requests", async ({ page }) => {
  const forbiddenRequests = await prepareAnonymousFlow(page);

  await page.goto("/dashboard/agents?open=agent-launcher&plan=pro");
  await expect(page.getByRole("dialog", { name: "A quick tour of your agent workspace" })).toHaveCount(0);
  await completeAuthenticationRoundTrip(page);

  await page.goto("/dashboard/agents?plan=pro");
  await expectAnonymousFlowComplete(page);

  await expectNoHorizontalOverflow(page);
  expect(forbiddenRequests).toEqual([]);
});

test("keeps a saved mobile draft private through completed authentication round trips", async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("hypercli-first-agent-draft", JSON.stringify({
      source: "first-agent-setup",
      name: "night-ops-pilot",
      description: "Coordinate overnight operations",
      iconIndex: 11,
      category: "Ops",
      plan: "pro",
      size: "large",
      enableDesktop: true,
      enableMemoryIndex: true,
      enableCustomImage: false,
      customImage: "",
      updatedAt: Date.now(),
    }));
  });
  const forbiddenRequests = await prepareAnonymousFlow(page);

  await page.goto("/dashboard/agents");
  await expect(page.getByRole("dialog", { name: "A quick tour of your agent workspace" })).toHaveCount(0);
  const chatPreview = page.getByRole("heading", { name: DEFAULT_PREVIEW_HEADING }).locator("xpath=..");
  await expect(chatPreview).toBeVisible();
  await expect(page.locator('[data-slot="saved-agent-draft-summary"]')).toHaveCount(0);
  await expect(page.getByText("night-ops-pilot.hypercli.com")).toHaveCount(0);
  expect(await readSavedDraftName(page)).toBe("night-ops-pilot");

  await chatPreview.getByRole("button", { name: "Launch agent" }).tap();
  await completeAuthenticationRoundTrip(page);
  expect(await readSavedDraftName(page)).toBe("night-ops-pilot");

  await page.goto("/dashboard/agents?open=agent-launcher&plan=pro");
  await expect(page.getByRole("dialog", { name: "A quick tour of your agent workspace" })).toHaveCount(0);
  await completeAuthenticationRoundTrip(page);
  expect(await readSavedDraftName(page)).toBe("night-ops-pilot");

  const restoredPreview = page.getByRole("heading", { name: DEFAULT_PREVIEW_HEADING }).locator("xpath=..");
  await restoredPreview.getByRole("button", { name: "Launch agent" }).tap();
  await completeAuthenticationRoundTrip(page);
  expect(await readSavedDraftName(page)).toBe("night-ops-pilot");
  await expectNoHorizontalOverflow(page);
  expect(forbiddenRequests).toEqual([]);
});
