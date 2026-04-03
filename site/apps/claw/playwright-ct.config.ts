import { defineConfig, devices } from "@playwright/experimental-ct-react";
import path from "path";

export default defineConfig({
  testDir: "./src",
  testMatch: "**/*.ct.tsx",
  snapshotDir: "./__snapshots__",
  timeout: 30_000,
  use: {
    ctPort: 3100,
    ctViteConfig: {
      resolve: {
        alias: { "@": path.resolve(__dirname, "src") },
      },
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
