import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "scripts/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: [
      "node_modules/**",
      ".next/**",
      ".turbo/**",
      "storybook-static/**",
      "playwright-report/**",
      "src/**/*.stories.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "html", "json-summary"],
      include: [
        "src/lib/format.ts",
        "src/lib/agent-tier.ts",
        "src/hooks/usePlans.ts",
        "src/hooks/useAgentFiles.ts",
        "src/components/dashboard/agents/AgentLaunchPrompt.tsx",
        "scripts/check-api-boundary.mjs",
      ],
      thresholds: {
        "src/lib/**": {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
        "src/hooks/**": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        "src/components/**": {
          lines: 60,
          functions: 60,
          branches: 60,
          statements: 60,
        },
      },
    },
  },
});
