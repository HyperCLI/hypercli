import { defineConfig, devices } from "@playwright/test";

/**
 * Desktop end-to-end: the real web UI, served by Vite, against the real dev
 * backend — no Tauri shell, no mocks. The dev-credential injection seam in
 * vite.config.ts (`__HYPER_DEV_API_KEY__`) is what lets a plain browser tab
 * run the same client code paths as the packaged app (see desktop/AGENTS.md).
 *
 * Required env:
 *   HYPER_API_KEY   — API key for an account with agent slots on the target
 *   HYPER_API_BASE  — gateway base; defaults to the dev gateway. Must be the
 *                     dev backend in practice: prod does not allow the
 *                     `http://localhost:1420` origin (AGENTS.md rule 9), and
 *                     this suite creates real agents.
 */

const port = Number(process.env.DESKTOP_E2E_PORT ?? 1420);
const baseURL = process.env.DESKTOP_E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // create → RUNNING → a real model reply on dev routinely takes minutes.
  timeout: 8 * 60_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --strictPort",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      HYPER_API_KEY: process.env.HYPER_API_KEY ?? "",
      HYPER_API_BASE: process.env.HYPER_API_BASE ?? "https://api.dev.hypercli.com",
    },
  },
});
