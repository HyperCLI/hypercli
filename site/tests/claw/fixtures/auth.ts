import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, type Frame, type Locator, type Page } from "@playwright/test";

type RequiredEnvKey =
  | "TEST_BASE_URL"
  | "TEST_HOSTNAME"
  | "TEST_EMAIL"
  | "TEST_IMAP_HOST"
  | "TEST_IMAP_USER"
  | "TEST_IMAP_PASS"
  | "NEXT_PUBLIC_PRIVY_APP_ID";

const SCREENSHOT_DIR = path.resolve(__dirname, "..", "screenshots");
const SCREENSHOT_DELAY_MS = Number.parseInt(process.env.TEST_SCREENSHOT_DELAY_MS || "250", 10);
const DEFAULT_IMAP_PORT = 993;
const OTP_TIMEOUT_MS = 60_000;
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
const DEFAULT_TEST_API_BASE_URL = "https://api.dev.hypercli.com";
const PRIVY_AUTH_SETTLE_TIMEOUT_MS = Number.parseInt(
  process.env.TEST_PRIVY_AUTH_SETTLE_TIMEOUT_MS || "45000",
  10
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

interface HyperAgentCurrentPlan {
  id: string;
  name: string;
  price: number | string;
  aiu?: number;
  agents?: number;
  tpmLimit: number;
  rpmLimit: number;
  expiresAt: Date | null;
  cancelAtPeriodEnd: boolean;
}

interface HyperAgentClientLike {
  currentPlan(): Promise<HyperAgentCurrentPlan>;
}

interface DeploymentRecord {
  id: string;
  name?: string | null;
  state?: string | null;
}

interface DeploymentsClientLike {
  list(): Promise<DeploymentRecord[]>;
  get(agentId: string): Promise<DeploymentRecord>;
  stop(agentId: string): Promise<unknown>;
  delete(agentId: string): Promise<unknown>;
}

interface TopUpApiClientLike {
  billing: {
    balance(): Promise<unknown>;
    listTransactions(options: { page: number; pageSize: number }): Promise<unknown>;
  };
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

function getApiBaseUrl(): string {
  return (
    getOptionalEnv("TEST_API_BASE_URL") ||
    DEFAULT_TEST_API_BASE_URL
  ).replace(/\/$/, "");
}

async function fetchAdminAuthToken(
  apiBaseUrl: string,
  adminKey: string,
  params: Record<string, string>
): Promise<string> {
  const url = new URL(`${apiBaseUrl}/admin/auth/login`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: {
      "X-BACKEND-API-KEY": adminKey,
    },
  });
  if (!response.ok) {
    throw new Error(`Admin auth login failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { token?: string };
  if (!payload.token) {
    throw new Error("Admin auth login returned no token");
  }
  return payload.token;
}

async function installLocalAuthToken(
  page: Page,
  *,
  baseUrl: string,
  storageKey: "claw_auth_token" | "app_auth_token",
  token: string,
): Promise<void> {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [storageKey, token] as const
  );
}

async function tryAdminLoginForClaw(page: Page): Promise<boolean> {
  const adminKey = getOptionalEnv("AGENTS_BACKEND_API_KEY") || getOptionalEnv("BACKEND_API_KEY");
  if (!adminKey) {
    return false;
  }
  const token = await fetchAdminAuthToken(getAgentsApiBaseUrl(), adminKey, {
    email: getEnv("TEST_EMAIL"),
  });
  await installLocalAuthToken(page, {
    baseUrl: getEnv("TEST_BASE_URL"),
    storageKey: "claw_auth_token",
    token,
  });
  await page.goto(`${getEnv("TEST_BASE_URL").replace(/\/$/, "")}/dashboard`, {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(() => page.url(), { timeout: 30_000 })
    .toContain("/dashboard");
  return true;
}

async function tryAdminLoginForConsole(page: Page, baseUrl: string): Promise<boolean> {
  const adminKey = getOptionalEnv("BACKEND_API_KEY");
  if (!adminKey) {
    return false;
  }
  const token = await fetchAdminAuthToken(getApiBaseUrl(), adminKey, {
    email: getEnv("TEST_EMAIL"),
  });
  await installLocalAuthToken(page, {
    baseUrl,
    storageKey: "app_auth_token",
    token,
  });
  await page.goto(`${baseUrl.replace(/\/$/, "")}/dashboard`, { waitUntil: "domcontentloaded" });
  await expect
    .poll(() => page.url(), { timeout: 30_000 })
    .toContain("/dashboard");
  return true;
}

function privyImapEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    IMAP_HOST: getEnv("TEST_IMAP_HOST"),
    IMAP_USER: getEnv("TEST_IMAP_USER"),
    IMAP_PASS: getEnv("TEST_IMAP_PASS"),
  };
}

function runFetchOtpScript(args: string[]): string {
  return execFileSync("python3", args, {
    env: privyImapEnv(),
    encoding: "utf8",
  });
}

async function getHyperAgentClient(token: string): Promise<HyperAgentClientLike> {
  const [{ HTTPClient }, { HyperAgent }] = await Promise.all([
    import("@hypercli.com/sdk/http"),
    import("@hypercli.com/sdk"),
  ]);
  return new HyperAgent(new HTTPClient(getAgentsApiBaseUrl(), token), token, true);
}

async function getDeploymentsClient(token: string): Promise<DeploymentsClientLike> {
  const [{ HTTPClient }, { Deployments }] = await Promise.all([
    import("@hypercli.com/sdk/http"),
    import("@hypercli.com/sdk/agents"),
  ]);
  const agentsApiBaseUrl = getAgentsApiBaseUrl();
  return new Deployments(
    new HTTPClient(agentsApiBaseUrl, token),
    token,
    agentsApiBaseUrl,
    getOptionalEnv("NEXT_PUBLIC_AGENTS_WS_URL") || undefined
  );
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
  if (page.isClosed()) {
    return filePath;
  }
  if (Number.isFinite(SCREENSHOT_DELAY_MS) && SCREENSHOT_DELAY_MS > 0) {
    await page.waitForTimeout(SCREENSHOT_DELAY_MS).catch(() => {});
  }
  if (page.isClosed()) {
    return filePath;
  }
  await page.screenshot({ path: filePath, fullPage: true }).catch(() => {});
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
  const fetchOtpScript = path.resolve(__dirname, "..", "..", "..", "e2e", "flows", "fetch-otp.py");
  const pollTimeoutSec = Math.max(5, Math.ceil(OTP_TIMEOUT_MS / 1000));
  const submittedAfterEpoch = Math.floor(submittedAt.getTime() / 1000);

  try {
    execFileSync("python3", [fetchOtpScript, "--clear", "--timeout", "1"], {
      env: privyImapEnv(),
      stdio: "ignore",
    });
  } catch {
    console.log("[privy-auth:otp-clear] mailbox clear failed; continuing to OTP poll");
  }

  await sleep(OTP_INITIAL_DELAY_MS);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const output = runFetchOtpScript([
        fetchOtpScript,
        "--timeout",
        String(pollTimeoutSec),
        "--after",
        String(submittedAfterEpoch),
      ]);

      const otp = output
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);

      if (otp && /^\d{6}$/.test(otp)) {
        return otp;
      }
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
      console.log("[privy-auth:otp-poll] first OTP poll failed; retrying once");
      await sleep(OTP_POLL_INTERVAL_MS);
    }
  }

  throw new Error("Timed out waiting for a Privy OTP email");
}

export async function fillOtp(page: Page, otp: string): Promise<void> {
  const otpInputs = page.locator(
    'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i]'
  );
  const otpCount = await otpInputs.count();

  if (otpCount >= 6) {
    const targetLength = Math.min(otp.length, otpCount);
    const readOtpValues = async (): Promise<string[]> =>
      otpInputs.evaluateAll((elements) =>
        elements.map((element) => (element instanceof HTMLInputElement ? element.value : ""))
      );

    const hasTypedOtp = async (): Promise<boolean> => {
      const values = await readOtpValues();
      return values.slice(0, targetLength).every((value, index) => value === otp[index]);
    };

    await otpInputs.first().click();
    await page.keyboard.type(otp, { delay: 40 });

    if (!(await hasTypedOtp())) {
      for (let index = 0; index < targetLength; index += 1) {
        const input = otpInputs.nth(index);
        await input.click();
        await input.fill("");
        await input.pressSequentially(otp[index]);
      }
    }

    const values = await readOtpValues();
    console.log(`[privy-auth:otp-values] ${JSON.stringify(values.slice(0, targetLength))}`);
    return;
  }

  const singleInput = otpInputs.first();
  if (await singleInput.isVisible()) {
    await singleInput.fill(otp);
    console.log(`[privy-auth:otp-single-value] ${JSON.stringify(await singleInput.inputValue())}`);
    return;
  }

  const textbox = page.getByRole("textbox").last();
  await textbox.fill(otp);
  console.log(`[privy-auth:otp-textbox-value] ${JSON.stringify(await textbox.inputValue())}`);
}

async function submitPrivyOtp(page: Page): Promise<void> {
  const otpInputs = page.locator(
    'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i]'
  );
  if (await otpInputs.last().isVisible().catch(() => false)) {
    console.log("[privy-auth:otp-submit] pressing Enter on otp input");
    await otpInputs.last().press("Enter").catch(() => {});
    await page.waitForTimeout(750);
  }

  const candidates = [
    page.locator('#privy-modal-content button:visible').filter({ hasText: /^sign in$/i }).first(),
    page.locator('[role="dialog"] button:visible').filter({ hasText: /^sign in$/i }).first(),
    page.locator('#privy-modal-content button:visible').filter({ hasText: /^login with privy$/i }).first(),
    page.locator('[role="dialog"] button:visible').filter({ hasText: /^login with privy$/i }).first(),
    page.locator('#privy-modal-content button:visible').filter({
      hasText: /verify|continue|submit|log in|complete/i,
    }).first(),
    page.locator('[role="dialog"] button:visible').filter({
      hasText: /verify|continue|submit|log in|complete/i,
    }).first(),
  ];

  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      const label = (await candidate.textContent().catch(() => ""))?.replace(/\s+/g, " ").trim();
      console.log(`[privy-auth:otp-submit] clicking ${JSON.stringify(label || "button")}`);
      try {
        await candidate.click({ force: true, timeout: 5000 });
        return;
      } catch (error) {
        console.log(
          `[privy-auth:otp-submit] forced click failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  const submittedForm = await page
    .evaluate(() => {
      const modal = document.querySelector("#privy-modal-content");
      const form = modal?.querySelector("form");
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
        return true;
      }
      return false;
    })
    .catch(() => false);
  if (submittedForm) {
    console.log("[privy-auth:otp-submit] submitted modal form");
    return;
  }

  if (await otpInputs.last().isVisible().catch(() => false)) {
    console.log("[privy-auth:otp-submit] pressing Enter on otp input");
    await otpInputs.last().press("Enter").catch(() => {});
    return;
  }

  console.log("[privy-auth:otp-submit] pressing Enter on page");
  await page.keyboard.press("Enter").catch(() => {});
}

interface PrivyAuthDebugState {
  url: string;
  localStorageKeys: string[];
  hasClawAuthToken: boolean;
  hasAppAuthToken: boolean;
  hasAuthCookie: boolean;
  cookieNames: string[];
  privyModalVisible: boolean;
  otpInputCount: number;
  buttonLabels: string[];
}

async function getPrivyAuthDebugState(page: Page): Promise<PrivyAuthDebugState> {
  if (page.isClosed()) {
    return {
      url: "page-closed",
      localStorageKeys: [],
      hasClawAuthToken: false,
      hasAppAuthToken: false,
      hasAuthCookie: false,
      cookieNames: [],
      privyModalVisible: false,
      otpInputCount: 0,
      buttonLabels: [],
    };
  }
  const privyModal = page.locator("#privy-modal-content").first();
  const otpInputs = page.locator(
    'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i]'
  );
  const visibleButtons = page.locator("button:visible");

  const buttonLabels = await visibleButtons
    .evaluateAll((elements) =>
      elements
        .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 10)
    )
    .catch(() => []);

  return page
    .evaluate(
      ({ modalVisible, otpInputCount, buttonLabels }) => {
        const cookieNames = document.cookie
          .split("; ")
          .map((entry) => entry.split("=")[0])
          .filter(Boolean);
        return {
          url: window.location.href,
          localStorageKeys: Object.keys(localStorage).sort(),
          hasClawAuthToken: Boolean(localStorage.getItem("claw_auth_token")),
          hasAppAuthToken: Boolean(localStorage.getItem("app_auth_token")),
          hasAuthCookie: cookieNames.includes("auth_token"),
          cookieNames,
          privyModalVisible: modalVisible,
          otpInputCount,
          buttonLabels,
        };
      },
      {
        modalVisible: await privyModal.isVisible().catch(() => false),
        otpInputCount: await otpInputs.count().catch(() => 0),
        buttonLabels,
      }
    )
    .catch(() => ({
      url: "page-closed",
      localStorageKeys: [],
      hasClawAuthToken: false,
      hasAppAuthToken: false,
      hasAuthCookie: false,
      cookieNames: [],
      privyModalVisible: false,
      otpInputCount: 0,
      buttonLabels: [],
    }));
}

async function logPrivyAuthState(page: Page, label: string): Promise<void> {
  const state = await getPrivyAuthDebugState(page).catch(() => null);
  console.log(`[privy-auth:${label}] ${JSON.stringify(state)}`);
}

export async function loginWithPrivy(page: Page): Promise<void> {
  if (await tryAdminLoginForClaw(page)) {
    await captureStep(page, "00-admin-authenticated");
    return;
  }

  const email = getEnv("TEST_EMAIL");
  const privyModal = page.locator("#privy-modal-content").first();

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

  const continueButton = privyModal
    .getByRole("button", { name: /submit|continue with email|send code|email me|send login code/i })
    .first();
  await expect(continueButton).toBeVisible({ timeout: 10_000 });
  await continueButton.click();

  const otpSubmittedAt = new Date();
  const otp = await pollForPrivyOtp(otpSubmittedAt);
  await fillOtp(page, otp);
  await submitPrivyOtp(page);
  await captureStep(page, "05-otp-entered");
  await logPrivyAuthState(page, "otp-entered");

  let authToken: string | null = null;
  let lastResubmitAt = Date.now();
  await expect
    .poll(async () => {
      try {
        const authState = await page.evaluate(() => {
          const localToken =
            localStorage.getItem("claw_auth_token") ||
            localStorage.getItem("app_auth_token");
          if (localToken) {
            return {
              tokenSource: "localStorage",
              value: localToken,
            };
          }

          const authCookie = document.cookie
            .split("; ")
            .find((row) => row.startsWith("auth_token="));
          if (authCookie) {
            return {
              tokenSource: "cookie",
              value: authCookie,
            };
          }
          return null;
        });
        if (!authState) {
          await logPrivyAuthState(page, "waiting-for-auth-token");
          const modalVisible = await privyModal.isVisible().catch(() => false);
          if (modalVisible && Date.now() - lastResubmitAt >= 3_000) {
            lastResubmitAt = Date.now();
            await submitPrivyOtp(page);
          }
          return null;
        }
        console.log(`[privy-auth:token-ready] source=${authState.tokenSource}`);
        authToken = authState.value;
        return authState.value;
      } catch {
        return null;
      }
    }, { timeout: PRIVY_AUTH_SETTLE_TIMEOUT_MS })
    .not.toBeNull();

  if (!authToken) {
    throw new Error("Privy auth token did not materialize after OTP submission");
  }

  await expect
    .poll(async () => {
      const currentUrl = page.url();
      if (!currentUrl.includes("/dashboard")) {
        await logPrivyAuthState(page, "waiting-for-dashboard");
      }
      return currentUrl;
    }, { timeout: PRIVY_AUTH_SETTLE_TIMEOUT_MS })
    .toContain("/dashboard");

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
  if (await tryAdminLoginForConsole(page, baseUrl)) {
    await captureStep(page, "console-00-admin-authenticated");
    return;
  }

  const email = getEnv("TEST_EMAIL");
  const privyModal = page.locator("#privy-modal-content").first();

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

  const continueButton = privyModal
    .getByRole("button", { name: /submit|continue with email|send code|email me|send login code/i })
    .first();
  await expect(continueButton).toBeVisible({ timeout: 10_000 });
  await continueButton.click();

  const otpSubmittedAt = new Date();
  const otp = await pollForPrivyOtp(otpSubmittedAt);
  await fillOtp(page, otp);
  await submitPrivyOtp(page);
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
        try {
          const authState = await page.evaluate(async () => {
            const localToken =
              localStorage.getItem("app_auth_token") || localStorage.getItem("claw_auth_token");
            if (localToken) {
              return {
                tokenSource: "localStorage",
                value: localToken,
              };
            }

            const cookieNames = document.cookie
              .split("; ")
              .map((entry) => entry.split("=")[0])
              .filter(Boolean);
            if (cookieNames.includes("auth_token")) {
              return {
                tokenSource: "cookie",
                value: "cookie-present",
              };
            }

            return null;
          });
          if (!authState) {
            await logPrivyAuthState(page, "console-waiting-for-session");
            return null;
          }
          console.log(`[privy-auth:console-token-ready] source=${authState.tokenSource}`);
          latestValue = authState.value;
          return latestValue;
        } catch {
          await logPrivyAuthState(page, "console-session-eval-error");
          return null;
        }
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
  const apiClient = await getTopUpApiClient();
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

let topUpApiClient: TopUpApiClientLike | null = null;

async function getTopUpApiClient(): Promise<TopUpApiClientLike> {
  if (!topUpApiClient) {
    const { HyperCLI } = await import("@hypercli.com/sdk");
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
  amountDelta = 10,
  previousTransactionIds: Iterable<string> = []
): Promise<{ balance: BillingBalanceSnapshot; topUp: BillingTransactionSnapshot | null }> {
  const deadline = Date.now() + TOP_UP_POLL_TIMEOUT_MS;
  let latestBalance = previousBalance;
  let latestTopUp: BillingTransactionSnapshot | null = null;
  const knownTransactionIds = new Set(previousTransactionIds);

  while (Date.now() < deadline) {
    latestBalance = await fetchBalanceSnapshot();
    const transactions = await fetchTransactionSnapshots();
    latestTopUp =
      transactions.find((transaction) => {
        if (knownTransactionIds.has(transaction.id)) {
          return false;
        }
        if (transaction.transactionType.toLowerCase() !== "top_up") {
          return false;
        }
        if (transaction.status.toLowerCase() !== "completed") {
          return false;
        }
        if (transaction.amountUsd < amountDelta) {
          return false;
        }
        return true;
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
      `from initial $${previousBalance.availableBalanceText} after checkout at ${submittedAt.toISOString()}`
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
  const client = await getHyperAgentClient(token);
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

export async function cleanupClawAgents(page: Page, timeout = 180_000): Promise<void> {
  const token = await getClawAuthToken(page);
  const deployments = await getDeploymentsClient(token);
  const existingAgents = await deployments.list();

  for (const agent of existingAgents) {
    const agentId = String(agent.id || "");
    if (!agentId) continue;
    try {
      await deployments.delete(agentId);
    } catch {
      try {
        await deployments.stop(agentId);
      } catch {
        // Keep going; delete polling below will surface any stuck agents.
      }
      try {
        await deployments.delete(agentId);
      } catch {
        // Ignore individual delete errors here; the poll below is the real gate.
      }
    }
  }

  await expect
    .poll(async () => {
      const items = await deployments.list();
      return items.length;
    }, { timeout, intervals: [1_000, 2_000, 5_000] })
    .toBe(0);
}

export async function launchClawAgentAndWaitForGateway(page: Page, timeout = 240_000): Promise<DeploymentRecord> {
  const token = await getClawAuthToken(page);
  const deployments = await getDeploymentsClient(token);

  await page.goto("/dashboard/agents", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /create new agent|new agent|create/i }).first()).toBeVisible({
    timeout: 30_000,
  });
  await captureStep(page, "agents-10-dashboard");

  const createButton = page.getByRole("button", { name: /create new agent|new agent|create/i }).first();
  await createButton.click();

  const nextButton = page.getByRole("button", { name: /^next$/i }).first();
  await expect(nextButton).toBeVisible({ timeout: 10_000 });
  await nextButton.click();

  const secondNextButton = page.getByRole("button", { name: /^next$/i }).first();
  if (await secondNextButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await secondNextButton.click();
  }

  const createResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === "POST" && /\/agents\/deployments$/.test(response.url());
  });

  const launchButton = page.getByRole("button", { name: /create|launch|deploy/i }).first();
  await expect(launchButton).toBeVisible({ timeout: 10_000 });
  await launchButton.click();

  const createResponse = await createResponsePromise;
  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json()) as DeploymentRecord;
  expect(created.id).toBeTruthy();
  await captureStep(page, "agents-11-created");

  await expect
    .poll(async () => {
      const latest = await deployments.get(created.id);
      return latest.state ?? null;
    }, { timeout, intervals: [2_000, 5_000, 10_000] })
    .toBe("RUNNING");

  await expect(page.getByPlaceholder("Type a message...")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Send a message to start chatting with your agent", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByText("Connecting to gateway...", { exact: true }).first()
  ).not.toBeVisible({ timeout: 60_000 });
  await captureStep(page, "agents-12-gateway-connected");

  return created;
}

export async function deleteClawAgent(page: Page, agentId: string): Promise<void> {
  const token = await getClawAuthToken(page);
  const deployments = await getDeploymentsClient(token);
  try {
    await deployments.delete(agentId);
  } catch {
    try {
      await deployments.stop(agentId);
    } catch {
      // Best effort cleanup only.
    }
    await deployments.delete(agentId);
  }
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
