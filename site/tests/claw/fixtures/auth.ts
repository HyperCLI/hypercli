import fs from "node:fs/promises";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { expect, type Frame, type Locator, type Page } from "@playwright/test";
import { HTTPClient, HyperAgent, HyperCLI, type HyperAgentCurrentPlan } from "@hypercli.com/sdk";

type RequiredEnvKey =
  | "TEST_BASE_URL"
  | "TEST_HOSTNAME"
  | "TEST_EMAIL"
  | "TEST_IMAP_HOST"
  | "TEST_IMAP_USER"
  | "TEST_IMAP_PASS"
  | "NEXT_PUBLIC_PRIVY_APP_ID";

const SCREENSHOT_DIR = path.resolve(__dirname, "..", "screenshots");
const DEFAULT_IMAP_PORT = 993;
const OTP_TIMEOUT_MS = 30_000;
const OTP_POLL_INTERVAL_MS = 5_000;
const OTP_INITIAL_DELAY_MS = 2_500;
const STRIPE_TEST_CARD_NUMBER = "4242424242424242";
const STRIPE_TEST_EXPIRY = "1230";
const STRIPE_TEST_CVC = "123";
const STRIPE_TEST_NAME = "Test User";
const STRIPE_TEST_ZIP = "10001";
const TOP_UP_POLL_TIMEOUT_MS = 180_000;
const CLAW_PLAN_POLL_TIMEOUT_MS = 180_000;
const DEFAULT_TEST_AGENTS_API_BASE_URL = "https://api.dev.hypercli.com/agents";

interface BillingBalanceSnapshot {
  availableBalance: number;
  availableBalanceText: string;
  totalBalance: number;
  totalBalanceText: string;
}

interface BillingTransactionSnapshot {
  id: string;
  amountUsd: number;
  transactionType: string;
  status: string;
  createdAt: string;
}

interface StripeCustomer {
  id: string;
}

interface StripeSubscription {
  id: string;
  status: string;
}

interface StripeInvoice {
  id: string;
  payment_intent?: string | null;
  charge?: string | null;
  status?: string | null;
}

function getEnv(name: RequiredEnvKey): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in the environment`);
  }
  return value;
}

function getOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function requireEnvValue(name: string): string {
  const value = getOptionalEnv(name);
  if (!value) {
    throw new Error(`Missing ${name} in the environment`);
  }
  return value;
}

function getAgentsApiBaseUrl(): string {
  return (
    getOptionalEnv("TEST_AGENTS_API_BASE_URL") ||
    DEFAULT_TEST_AGENTS_API_BASE_URL
  ).replace(/\/$/, "");
}

function getHyperAgentClient(token: string): HyperAgent {
  return new HyperAgent(new HTTPClient(getAgentsApiBaseUrl(), token), token, true);
}

async function ensureScreenshotDir(): Promise<void> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
}

function slugifyStep(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function captureStep(page: Page, step: string): Promise<string> {
  await ensureScreenshotDir();
  const filePath = path.join(
    SCREENSHOT_DIR,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugifyStep(step)}.png`
  );
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

function decodeMessage(source: Buffer): string {
  return source
    .toString("utf8")
    .replace(/=\r?\n/g, "")
    .replace(/=3D/g, "=")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractOtpFromText(text: string): string | null {
  const explicitCodeMatch = text.match(/your code is[^0-9]{0,80}(\d{6})/i);
  if (explicitCodeMatch) {
    return explicitCodeMatch[1];
  }

  const targetedMatch = text.match(
    /(?:verification|login|one[- ]time|security|sign(?:ing)? in)[^0-9]{0,40}(\d{6})/i
  );
  if (targetedMatch) {
    return targetedMatch[1];
  }

  const fallbackMatches = [...text.matchAll(/\b(\d{6})\b/g)];
  return fallbackMatches.at(-1)?.[1] ?? null;
}

export async function pollForPrivyOtp(submittedAt: Date): Promise<string> {
  const client = new ImapFlow({
    host: getEnv("TEST_IMAP_HOST"),
    port: DEFAULT_IMAP_PORT,
    secure: true,
    auth: {
      user: getEnv("TEST_IMAP_USER"),
      pass: getEnv("TEST_IMAP_PASS"),
    },
    logger: false,
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const deadline = Date.now() + OTP_TIMEOUT_MS;
      await new Promise((resolve) => setTimeout(resolve, OTP_INITIAL_DELAY_MS));

      while (Date.now() < deadline) {
        const uids = (await client.search({ since: submittedAt }, { uid: true })) || [];
        const candidateMessages: Array<{
          internalDate: Date;
          normalizedSource: string;
        }> = [];

        for (const uid of uids) {
          const message = await client.fetchOne(String(uid), {
            uid: true,
            envelope: true,
            source: true,
            internalDate: true,
          });

          const fromValue = message?.envelope?.from?.map((entry) => entry.address || "").join(" ") || "";
          const source = message?.source;
          const internalDate = message?.internalDate ? new Date(message.internalDate) : null;
          if (!source || !internalDate || internalDate <= submittedAt) {
            continue;
          }

          const normalizedSource = decodeMessage(source);
          const looksLikePrivy =
            /privy\.io|privy/i.test(fromValue) ||
            /privy/i.test(message?.envelope?.subject || "");

          if (!looksLikePrivy) {
            continue;
          }

          candidateMessages.push({
            internalDate,
            normalizedSource,
          });
        }

        candidateMessages.sort(
          (left, right) => right.internalDate.getTime() - left.internalDate.getTime()
        );

        for (const message of candidateMessages) {
          const otp = extractOtpFromText(message.normalizedSource);
          if (otp) {
            return otp;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, OTP_POLL_INTERVAL_MS));
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  throw new Error("Timed out waiting for a Privy OTP email");
}

export async function fillOtp(page: Page, otp: string): Promise<void> {
  const otpInputs = page.locator(
    'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i]'
  );
  const otpCount = await otpInputs.count();

  if (otpCount >= 6) {
    for (let index = 0; index < Math.min(otp.length, otpCount); index += 1) {
      await otpInputs.nth(index).fill(otp[index]);
    }
    return;
  }

  const singleInput = otpInputs.first();
  if (await singleInput.isVisible()) {
    await singleInput.fill(otp);
    return;
  }

  const textbox = page.getByRole("textbox").last();
  await textbox.fill(otp);
}

export async function loginWithPrivy(page: Page): Promise<void> {
  const email = getEnv("TEST_EMAIL");

  const primaryAuthButton = page
    .getByRole("button", { name: /^(sign in|get started)$/i })
    .first();
  const response = await page.goto(getEnv("TEST_BASE_URL"), { waitUntil: "domcontentloaded" });
  if (response?.status() === 404) {
    throw new Error(`Target ${getEnv("TEST_HOSTNAME")} returned a 404 for the Claw app`);
  }
  await expect(primaryAuthButton).toBeVisible({ timeout: 30_000 });
  await captureStep(page, "01-home");
  await primaryAuthButton.click();

  const sharedLoginButton = page.getByRole("button", { name: /login with privy/i }).first();
  await expect(sharedLoginButton).toBeVisible({ timeout: 15_000 });
  await captureStep(page, "02-login-shell-open");
  await sharedLoginButton.click();

  const emailInput = page
    .locator(
      '#privy-modal-content input[type="email"], #privy-modal-content input[name="email"], #privy-modal-content input[autocomplete="email"], input[type="email"], input[name="email"], input[autocomplete="email"]'
    )
    .first();
  await expect(emailInput).toBeVisible({ timeout: 20_000 });
  await captureStep(page, "03-privy-modal-open");

  await emailInput.fill(email);
  await captureStep(page, "04-email-entered");

  const continueButton = page
    .getByRole("button", { name: /submit|continue|send code|email me/i })
    .first();
  await continueButton.click();

  const otpSubmittedAt = new Date();
  const otp = await pollForPrivyOtp(otpSubmittedAt);
  await fillOtp(page, otp);
  await captureStep(page, "05-otp-entered");

  await expect
    .poll(async () => {
      try {
        return await page.evaluate(() => localStorage.getItem("claw_auth_token"));
      } catch {
        return null;
      }
    }, { timeout: 45_000 })
    .not.toBeNull();

  await expect
    .poll(() => page.url(), { timeout: 45_000 })
    .toContain("/dashboard");

  const privyModal = page.locator("#privy-modal-content").first();
  if (await privyModal.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => {});

    const closeButton = page
      .locator(
        '#privy-modal-content button[aria-label="Close"], #privy-modal-content button[title="Close"]'
      )
      .first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click().catch(() => {});
    }

    await expect(privyModal).toBeHidden({ timeout: 10_000 }).catch(() => {});
  }

  await captureStep(page, "06-authenticated");
}

export async function loginToConsoleWithPrivy(
  page: Page,
  baseUrl = getOptionalEnv("TEST_PROD_CONSOLE_BASE_URL") || "https://console.hypercli.com"
): Promise<void> {
  const email = getEnv("TEST_EMAIL");

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await captureStep(page, "console-01-home");

  const loginWithPrivyButton = page.getByRole("button", { name: /login with privy/i }).first();
  await expect(loginWithPrivyButton).toBeVisible({ timeout: 20_000 });
  await loginWithPrivyButton.click();

  const emailInput = page
    .locator(
      '#privy-modal-content input[type="email"], #privy-modal-content input[name="email"], input[placeholder="your@email.com"], input[autocomplete="email"]'
    )
    .first();
  await expect(emailInput).toBeVisible({ timeout: 20_000 });
  await emailInput.fill(email);
  await captureStep(page, "console-02-email-entered");

  const continueButton = page
    .getByRole("button", { name: /submit|continue|send code|email me|send login code/i })
    .first();
  await expect(continueButton).toBeVisible({ timeout: 10_000 });
  await continueButton.click();

  const otpSubmittedAt = new Date();
  const otp = await pollForPrivyOtp(otpSubmittedAt);
  await fillOtp(page, otp);
  await captureStep(page, "console-03-otp-entered");

  await waitForConsoleSession(page, baseUrl);
  await expect
    .poll(() => page.url(), { timeout: 45_000 })
    .toContain("/dashboard");

  await expect(page.getByRole("button", { name: /^top up$/i })).toBeVisible({ timeout: 20_000 });
  await captureStep(page, "console-04-post-login");
}

async function waitForConsoleSession(page: Page, url: string, timeout = 45_000): Promise<string> {
  let latestValue: string | null = null;

  await expect
    .poll(
      async () => {
        const cookies = await page.context().cookies([url]);
        const cookieValue = cookies.find((cookie) => cookie.name === "auth_token")?.value ?? null;
        let storageValue: string | null = null;

        try {
          storageValue = await page.evaluate(() => localStorage.getItem("app_auth_token"));
        } catch {
          storageValue = null;
        }

        latestValue = cookieValue || storageValue;
        return latestValue;
      },
      { timeout }
    )
    .not.toBeNull();

  return latestValue!;
}

async function findVisibleStripeField(page: Page, selectors: string[]): Promise<Locator> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  for (const frame of getStripeFrames(page)) {
    for (const selector of selectors) {
      const locator = frame.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }
  }

  throw new Error(`Unable to find visible Stripe field for selectors: ${selectors.join(", ")}`);
}

function getStripeFrames(page: Page): Frame[] {
  return page.frames().filter((frame) => frame !== page.mainFrame());
}

async function logStripeFrameState(page: Page, step: string): Promise<void> {
  const frames = getStripeFrames(page).map((frame) => ({
    name: frame.name(),
    url: frame.url(),
  }));
  console.log(`Stripe frame state [${step}]: ${JSON.stringify(frames)}`);
}

async function fillStripeField(
  page: Page,
  value: string,
  directSelectors: string[],
  frameSelectors: string[]
): Promise<void> {
  for (const selector of directSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.fill("");
      await locator.pressSequentially(value, { delay: 30 });
      return;
    }
  }

  for (const frame of getStripeFrames(page)) {
    for (const selector of frameSelectors) {
      const locator = frame.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) {
        await locator.fill("");
        await locator.pressSequentially(value, { delay: 30 });
        return;
      }
    }
  }

  throw new Error(
    `Unable to fill Stripe field for selectors: ${[...directSelectors, ...frameSelectors].join(", ")}`
  );
}

async function anyVisibleStripeLocator(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) {
      return true;
    }
  }

  for (const frame of getStripeFrames(page)) {
    for (const selector of selectors) {
      if (await frame.locator(selector).first().isVisible().catch(() => false)) {
        return true;
      }
    }
  }

  return false;
}

export async function completeStripeCheckout(
  page: Page,
): Promise<void> {
  const stripeCheckoutPattern = /^https:\/\/checkout\.stripe\.com\//i;

  await expect
    .poll(() => page.url(), { timeout: 45_000 })
    .toMatch(stripeCheckoutPattern);
  await page.waitForLoadState("domcontentloaded");
  await expect
    .poll(
      () =>
        anyVisibleStripeLocator(page, [
          "#cardNumber",
          "input[name='cardNumber']",
          "#Field-numberInput",
          "input[name='cardnumber']",
          "input[aria-label='Card number']",
        ]),
      { timeout: 60_000, message: "Waiting for Stripe checkout fields to load" }
    )
    .toBeTruthy();
  await logStripeFrameState(page, "loaded");
  await captureStep(page, "console-05-stripe-checkout");

  const emailField = await findVisibleStripeField(page, [
    "#email",
    "input[type='email']",
    "input[autocomplete='email']",
    "input[aria-label='Email']",
  ]).catch(() => null);
  if (emailField) {
    await emailField.fill(getEnv("TEST_EMAIL"));
  }

  await fillStripeField(
    page,
    STRIPE_TEST_CARD_NUMBER,
    ["#cardNumber", "input[name='cardNumber']", "input[autocomplete='cc-number']", "input[placeholder*='1234']"],
    [
      "#Field-numberInput",
      "input[name='cardnumber']",
      "input[name='number']",
      "input[autocomplete='cc-number']",
      "input[placeholder*='Card number' i]",
      "input[aria-label='Card number']",
    ]
  );
  await captureStep(page, "console-05a-stripe-card-number");

  await fillStripeField(
    page,
    STRIPE_TEST_EXPIRY,
    ["#cardExpiry", "input[name='cardExpiry']", "input[autocomplete='cc-exp']", "input[placeholder*='MM / YY']"],
    [
      "#Field-expiryInput",
      "input[name='exp-date']",
      "input[name='expiry']",
      "input[autocomplete='cc-exp']",
      "input[placeholder*='MM / YY' i]",
      "input[aria-label*='Expiration' i]",
    ]
  );
  await captureStep(page, "console-05b-stripe-expiry");

  await fillStripeField(
    page,
    STRIPE_TEST_CVC,
    ["#cardCvc", "input[name='cardCvc']", "input[autocomplete='cc-csc']", "input[placeholder*='CVC']"],
    [
      "#Field-cvcInput",
      "input[name='cvc']",
      "input[autocomplete='cc-csc']",
      "input[placeholder*='CVC' i]",
      "input[placeholder*='security code' i]",
      "input[aria-label='Security code']",
    ]
  );
  await captureStep(page, "console-05c-stripe-cvc");

  const nameField = await findVisibleStripeField(page, [
    "#billingName",
    "input[name='billingName']",
    "input[autocomplete='cc-name']",
    "input[name='name']",
    "input[aria-label='Name on card']",
  ]).catch(() => null);
  if (nameField) {
    await nameField.fill(STRIPE_TEST_NAME);
  }

  const postalField = await findVisibleStripeField(page, [
    "#billingPostalCode",
    "input[name='billingPostalCode']",
    "input[autocomplete='postal-code']",
  ]).catch(() => null);
  if (postalField) {
    await postalField.fill(STRIPE_TEST_ZIP);
  }
  await captureStep(page, "console-05d-stripe-form-filled");

  const submitButton = page
    .locator(".SubmitButton, button[type='submit'], button:has-text('Pay'), button:has-text('Donate')")
    .first();
  const stripeSubmitButton =
    (await submitButton.isVisible().catch(() => false))
      ? submitButton
      : await findVisibleStripeField(page, [
          ".SubmitButton",
          "button[type='submit']",
          "button[aria-label='Pay']",
          "button:has-text('Pay')",
          "button:has-text('Donate')",
        ]);
  await expect(stripeSubmitButton).toBeVisible({ timeout: 15_000 });
  console.log(`Stripe submit button text: ${(await stripeSubmitButton.textContent())?.trim() || "<empty>"}`);
  await stripeSubmitButton.click();
  await captureStep(page, "console-05e-stripe-submit-clicked");
}

async function fetchJsonWithApiKey<T>(path: string): Promise<T> {
  const apiClient = getTopUpApiClient();
  if (path === "/api/balance") {
    return (await apiClient.billing.balance()) as T;
  }

  if (path.startsWith("/api/tx")) {
    const url = new URL(path, "https://placeholder.invalid");
    const page = Number.parseInt(url.searchParams.get("page") || "1", 10);
    const pageSize = Number.parseInt(url.searchParams.get("page_size") || "20", 10);
    return (await apiClient.billing.listTransactions({ page, pageSize })) as T;
  }

  throw new Error(`Unsupported API SDK path: ${path}`);
}

let topUpApiClient: HyperCLI | null = null;

function getTopUpApiClient(): HyperCLI {
  if (!topUpApiClient) {
    topUpApiClient = new HyperCLI({
      apiKey: requireEnvValue("TEST_API_KEY"),
      apiUrl: requireEnvValue("TEST_API_BASE_URL"),
    });
  }
  return topUpApiClient;
}

export async function fetchBalanceSnapshot(): Promise<BillingBalanceSnapshot> {
  const data = await fetchJsonWithApiKey<{
    available: string;
    total: string;
  }>("/api/balance");

  return {
    availableBalance: parseDollarAmount(data.available || "0"),
    availableBalanceText: data.available || "0",
    totalBalance: parseDollarAmount(data.total || "0"),
    totalBalanceText: data.total || "0",
  };
}

export async function fetchTransactionSnapshots(limit = 20): Promise<BillingTransactionSnapshot[]> {
  const data = await fetchJsonWithApiKey<{
    transactions?: Array<{
      id: string;
      amountUsd: string;
      transactionType: string;
      status: string;
      createdAt: string;
    }>;
  }>(`/api/tx?page=1&page_size=${limit}`);

  return (data.transactions || []).map((transaction) => ({
    id: transaction.id,
    amountUsd: parseDollarAmount(transaction.amountUsd || "0"),
    transactionType: transaction.transactionType || "",
    status: transaction.status || "",
    createdAt: transaction.createdAt || "",
  }));
}

export async function waitForTopUpSettlement(
  previousBalance: BillingBalanceSnapshot,
  submittedAt: Date,
  amountDelta = 10
): Promise<{ balance: BillingBalanceSnapshot; topUp: BillingTransactionSnapshot | null }> {
  const deadline = Date.now() + TOP_UP_POLL_TIMEOUT_MS;
  let latestBalance = previousBalance;
  let latestTopUp: BillingTransactionSnapshot | null = null;

  while (Date.now() < deadline) {
    latestBalance = await fetchBalanceSnapshot();
    const transactions = await fetchTransactionSnapshots();
    latestTopUp =
      transactions.find((transaction) => {
        if (transaction.transactionType.toLowerCase() !== "top_up") {
          return false;
        }
        if (transaction.status.toLowerCase() !== "completed") {
          return false;
        }
        if (transaction.amountUsd < amountDelta) {
          return false;
        }

        const createdAtMs = Date.parse(transaction.createdAt);
        return Number.isFinite(createdAtMs) && createdAtMs >= submittedAt.getTime() - 60_000;
      }) || null;

    if (latestBalance.availableBalance >= previousBalance.availableBalance + amountDelta || latestTopUp) {
      return {
        balance: latestBalance,
        topUp: latestTopUp,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw new Error(
    `Timed out waiting for top-up settlement. Available balance stayed at $${latestBalance.availableBalanceText} ` +
      `from initial $${previousBalance.availableBalanceText}`
  );
}

export function parseDollarAmount(value: string): number {
  const normalized = value.replace(/[^0-9.-]+/g, "");
  const parsed = Number.parseFloat(normalized);
  if (Number.isNaN(parsed)) {
    throw new Error(`Unable to parse dollar amount from "${value}"`);
  }
  return parsed;
}

export async function waitForCookieValue(
  page: Page,
  url: string,
  name: string,
  timeout = 45_000
): Promise<string> {
  let latestValue: string | null = null;

  await expect
    .poll(
      async () => {
        const cookies = await page.context().cookies([url]);
        latestValue = cookies.find((cookie) => cookie.name === name)?.value ?? null;
        return latestValue;
      },
      { timeout }
    )
    .not.toBeNull();

  return latestValue!;
}

export async function waitForLocalStorageValue(
  page: Page,
  key: string,
  timeout = 45_000
): Promise<string> {
  let latestValue: string | null = null;

  await expect
    .poll(
      async () => {
        try {
          latestValue = await page.evaluate(
            (storageKey) => window.localStorage.getItem(storageKey),
            key
          );
        } catch {
          latestValue = null;
        }
        return latestValue;
      },
      { timeout }
    )
    .not.toBeNull();

  return latestValue!;
}

export async function getClawAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem("claw_auth_token"));
  if (!token) {
    throw new Error("claw_auth_token was not found in localStorage");
  }
  return token;
}

export async function fetchClawCurrentPlan(page: Page): Promise<HyperAgentCurrentPlan | null> {
  const token = await getClawAuthToken(page);
  const client = getHyperAgentClient(token);
  try {
    return await client.currentPlan();
  } catch (error) {
    if (error instanceof Error && /404/.test(error.message)) {
      return null;
    }
    throw error;
  }
}

export async function waitForClawPlanId(
  page: Page,
  expectedPlanId: string,
  timeout = CLAW_PLAN_POLL_TIMEOUT_MS
): Promise<HyperAgentCurrentPlan> {
  let latestPlan: HyperAgentCurrentPlan | null = null;

  await expect
    .poll(
      async () => {
        latestPlan = await fetchClawCurrentPlan(page);
        return latestPlan?.id ?? null;
      },
      { timeout, intervals: [1_000, 2_000, 5_000] }
    )
    .toBe(expectedPlanId);

  return latestPlan!;
}

export async function waitForPaidClawPlan(
  page: Page,
  timeout = CLAW_PLAN_POLL_TIMEOUT_MS
): Promise<HyperAgentCurrentPlan> {
  let latestPlan: HyperAgentCurrentPlan | null = null;

  await expect
    .poll(
      async () => {
        latestPlan = await fetchClawCurrentPlan(page);
        return latestPlan?.id ?? "free";
      },
      { timeout, intervals: [1_000, 2_000, 5_000] }
    )
    .not.toBe("free");

  return latestPlan!;
}

async function stripeApiRequest<T>(
  path: string,
  init: { method?: string; form?: Record<string, string> } = {}
): Promise<T> {
  const secretKey = getOptionalEnv("TEST_STRIPE_AGENTS_SECRET_KEY");
  if (!secretKey) {
    throw new Error("Missing TEST_STRIPE_AGENTS_SECRET_KEY for Stripe subscription cleanup");
  }

  const method = init.method || "GET";
  const body = init.form ? new URLSearchParams(init.form).toString() : undefined;
  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Stripe API ${method} ${path} failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}

export async function cancelActiveClawStripeSubscriptionsForTestUser(): Promise<string[]> {
  const email = getEnv("TEST_EMAIL");
  const customers = await stripeApiRequest<{ data: StripeCustomer[] }>(
    `/v1/customers?email=${encodeURIComponent(email)}&limit=10`
  );

  const cancelled: string[] = [];

  for (const customer of customers.data || []) {
    const subscriptions = await stripeApiRequest<{ data: StripeSubscription[] }>(
      `/v1/subscriptions?customer=${encodeURIComponent(customer.id)}&status=all&limit=100`
    );

    for (const subscription of subscriptions.data || []) {
      if (["active", "trialing", "past_due", "incomplete", "unpaid"].includes(subscription.status)) {
        const invoices = await stripeApiRequest<{ data: StripeInvoice[] }>(
          `/v1/invoices?subscription=${encodeURIComponent(subscription.id)}&limit=10`
        );

        await stripeApiRequest(`/v1/subscriptions/${subscription.id}`, { method: "DELETE" });

        const paidInvoice = (invoices.data || []).find((invoice) => invoice.status === "paid");
        const paymentRef = paidInvoice?.payment_intent || paidInvoice?.charge || null;
        if (paymentRef) {
          await stripeApiRequest("/v1/refunds", {
            method: "POST",
            form: paidInvoice?.payment_intent
              ? { payment_intent: paidInvoice.payment_intent }
              : { charge: paidInvoice!.charge! },
          }).catch(() => null);
        }

        cancelled.push(subscription.id);
      }
    }
  }

  return cancelled;
}

export function expectJwtShape(token: string): void {
  expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const payloadSegment = token.split(".")[1];
  const payloadJson = Buffer.from(payloadSegment, "base64url").toString("utf8");
  const payload = JSON.parse(payloadJson) as { exp?: number };

  expect(typeof payload.exp).toBe("number");
  expect((payload.exp || 0) * 1000).toBeGreaterThan(Date.now());
}
