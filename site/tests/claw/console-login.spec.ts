import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";
import { captureStep, loginToConsoleWithPrivy } from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const consoleBaseUrl = process.env.TEST_CONSOLE_BASE_URL?.trim() || "http://127.0.0.1:4001";

test("logs into Console with Privy email OTP and reaches the dashboard", async ({ page }) => {
  await loginToConsoleWithPrivy(page, consoleBaseUrl);
  await expect(page.getByRole("heading", { name: /^balance$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^top up$/i })).toBeVisible();
  await captureStep(page, "console-04-post-login");
});
