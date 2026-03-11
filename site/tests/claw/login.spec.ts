import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";
import { captureStep, expectJwtShape, getClawAuthToken, loginWithPrivy } from "./fixtures/auth";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

test("logs into Claw with Privy email OTP and stores a valid app JWT", async ({ page }) => {
  await loginWithPrivy(page);

  const token = await getClawAuthToken(page);
  expectJwtShape(token);

  await expect(page.getByRole("button", { name: /^sign in$/i })).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: /welcome back, agent/i })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /api keys/i })).toBeVisible();

  await captureStep(page, "06-post-login-assertions");
});
