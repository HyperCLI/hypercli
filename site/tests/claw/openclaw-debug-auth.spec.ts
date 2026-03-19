import path from "node:path";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

const SCREENSHOT_DELAY_MS = 10_000;

test("debug desktop openclaw with seeded auth", async ({ page }) => {
  const token = process.env.TEST_AUTH_TOKEN;
  if (!token) {
    throw new Error("Missing TEST_AUTH_TOKEN");
  }

  await page.addInitScript((value) => {
    window.localStorage.setItem("claw_auth_token", value);
  }, token);

  await page.goto("/dashboard/agents", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/dashboard\/agents$/);

  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.getByRole("button", { name: /^openclaw$/i }).click();
  await page.waitForTimeout(SCREENSHOT_DELAY_MS);
  await page.screenshot({
    path: path.resolve(__dirname, "../screenshots/openclaw-debug-auth.png"),
    fullPage: true,
  });

  const rail = await page.locator("aside").first().textContent();
  const content = await page.locator("main").textContent();
  console.log(JSON.stringify({ rail, content }));
});
