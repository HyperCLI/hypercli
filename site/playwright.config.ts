import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/flows",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL || "https://gilfoyle.dev.hypercli.com",
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Accept self-signed certs for dev
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  outputDir: "e2e/results",
});
