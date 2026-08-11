import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

loadEnv({ path: path.resolve(__dirname, "../claw/.env"), quiet: true });

const baseURL = process.env.TEST_MAIN_BASE_URL?.trim();
if (!baseURL) {
  throw new Error("Missing TEST_MAIN_BASE_URL in environment");
}
const artifactsDir = process.env.E2E_ARTIFACTS_DIR?.trim();

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  fullyParallel: true,
  workers: 1,
  retries: 0,
  outputDir: artifactsDir ? path.join(artifactsDir, "test-results") : "test-results",
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: artifactsDir
          ? path.join(artifactsDir, "playwright-report")
          : "playwright-report",
      },
    ],
  ],
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
