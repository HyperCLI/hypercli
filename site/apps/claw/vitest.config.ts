import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// The app imports public/bootstrap/*.md with Turbopack-only
// `with { turbopackModuleType: "raw" }` attributes. Vite strips the attribute
// and would parse the Markdown as JS, so serve those files as raw text here.
function rawMarkdownPlugin(): Plugin {
  return {
    name: "claw-raw-markdown",
    enforce: "pre",
    resolveId(source, importer) {
      if (!source.endsWith(".md")) return null;
      const base = importer ? path.dirname(importer) : rootDir;
      return { id: `${path.resolve(base, source)}?raw-md`, moduleSideEffects: false };
    },
    load(id) {
      if (!id.endsWith("?raw-md")) return null;
      return `export default ${JSON.stringify(require("node:fs").readFileSync(id.slice(0, -7), "utf-8"))};`;
    },
  };
}

export default defineConfig({
  plugins: [rawMarkdownPlugin()],
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
