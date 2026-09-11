import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));

// UsagePanel imports `../api` (snake_case DTOs + `usageSummary`). Swap that one
// module for the sanitized fixture so the real component renders unchanged.
export default {
  publicDir: false,
  plugins: [
    {
      name: "usage-mock-api",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "../api" && importer?.endsWith("UsagePanel.tsx")) {
          return path.join(here, "fixture.mjs");
        }
        return null;
      },
    },
    react(),
    tailwindcss(),
  ],
  server: { port: 5199, strictPort: true },
};
