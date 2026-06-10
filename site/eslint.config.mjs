import path from "node:path";
import { fileURLToPath } from "node:url";

import nextVitals from "eslint-config-next/core-web-vitals";
import storybook from "eslint-plugin-storybook";

const siteRoot = fileURLToPath(new URL(".", import.meta.url));
const nextRootDirs = ["apps/main", "apps/console", "apps/claw"].map((dir) => path.join(siteRoot, dir));

const config = [
  {
    ignores: [
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/storybook-static/**",
      "**/next-env.d.ts",
    ],
  },
  ...nextVitals,
  ...storybook.configs["flat/recommended"],
  {
    settings: {
      next: {
        rootDir: nextRootDirs,
      },
    },
    rules: {
      "@next/next/no-html-link-for-pages": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;
