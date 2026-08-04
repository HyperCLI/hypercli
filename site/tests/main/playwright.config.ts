import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, "../claw/.env"), quiet: true });

const baseURL = process.env.TEST_MAIN_BASE_URL?.trim();
if (!baseURL) {
  throw new Error("Missing TEST_MAIN_BASE_URL in environment");
}

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  fullyParallel: true,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
