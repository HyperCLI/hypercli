import fs from "node:fs/promises";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { expect, type Page } from "@playwright/test";

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

function getEnv(name: RequiredEnvKey): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in tests/claw/.env`);
  }
  return value;
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

async function pollForPrivyOtp(submittedAt: Date): Promise<string> {
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

async function fillOtp(page: Page, otp: string): Promise<void> {
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

  const response = await page.goto(getEnv("TEST_BASE_URL"), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  const pageText = (await page.locator("body").textContent()) || "";
  if (response?.status() === 404 || /404 page not found/i.test(pageText)) {
    throw new Error(
      `Target ${getEnv("TEST_HOSTNAME")} is serving a 404 instead of the Claw app`
    );
  }
  await captureStep(page, "01-home");

  const primaryAuthButton = page
    .getByRole("button", { name: /^(sign in|get started)$/i })
    .first();
  await expect(primaryAuthButton).toBeVisible();
  await primaryAuthButton.click();

  const authModal = page.locator("#privy-modal-content");
  await expect(authModal).toBeVisible();

  const emailInput = authModal
    .locator('input[type="email"], input[name="email"], input[autocomplete="email"]')
    .first();
  await expect(emailInput).toBeVisible();
  await captureStep(page, "02-privy-modal-open");

  await emailInput.fill(email);
  await captureStep(page, "03-email-entered");

  const continueButton = authModal
    .getByRole("button", { name: /submit|continue|send code|email me/i })
    .first();
  await continueButton.click();

  const otpSubmittedAt = new Date();
  const otp = await pollForPrivyOtp(otpSubmittedAt);
  await fillOtp(page, otp);
  await captureStep(page, "04-otp-entered");

  await page.waitForLoadState("networkidle");
  await expect
    .poll(async () => {
      return page.evaluate(() => localStorage.getItem("claw_auth_token"));
    }, { timeout: 45_000 })
    .not.toBeNull();

  await captureStep(page, "05-authenticated");
}

export async function getClawAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem("claw_auth_token"));
  if (!token) {
    throw new Error("claw_auth_token was not found in localStorage");
  }
  return token;
}

export function expectJwtShape(token: string): void {
  expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const payloadSegment = token.split(".")[1];
  const payloadJson = Buffer.from(payloadSegment, "base64url").toString("utf8");
  const payload = JSON.parse(payloadJson) as { exp?: number };

  expect(typeof payload.exp).toBe("number");
  expect((payload.exp || 0) * 1000).toBeGreaterThan(Date.now());
}
