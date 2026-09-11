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

// Vite is pinned to 1420 (vite.config.ts server.port); overriding the port
// here would only desync the readiness probe from the server.
const baseURL = process.env.DESKTOP_E2E_BASE_URL ?? "http://localhost:1420";

export default defineConfig({
  testDir: "./e2e",
  // Internal budgets sum to ~11min (dialog 60s + roster 60s + composer 300s +
  // reply 240s); the ceiling must cover them so real assertions report instead
  // of a bare test timeout.
  timeout: 11 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    // Traces record request headers — including the Authorization bearer the
    // dev-credential injection puts on every /api call — so they never run in
    // CI where artifacts are uploaded. Video + the html report remain.
    trace: process.env.CI ? "off" : "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Never reuse: the dev credential is baked into the bundle at server boot,
    // and reusing a server started without HYPER_API_KEY fails the suite with
    // a misleading sign-in screen. A fresh boot is seconds.
    command: "npm run dev -- --host 127.0.0.1 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
