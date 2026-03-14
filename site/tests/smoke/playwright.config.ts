import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

export default defineConfig({
  testDir: __dirname,
  testMatch: ["*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: path.resolve(__dirname, "..", "..", "test-results", "smoke-results.json") }],
  ],
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
  use: {
    browserName: "chromium",
    channel: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 1024 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
