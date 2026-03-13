import type { NextConfig } from "next";
import path from "path";

// Build-time validation of required environment variables
const requiredEnvVars = [
  "NEXT_PUBLIC_MAIN_SITE_URL",
  "NEXT_PUBLIC_CONSOLE_URL",
  "NEXT_PUBLIC_AGENTS_URL",
  "NEXT_PUBLIC_COOKIE_DOMAIN",
  "NEXT_PUBLIC_HYPERCLAW_COOKIE_DOMAIN",
  "NEXT_PUBLIC_AGENTS_API_URL",
  "NEXT_PUBLIC_AGENTS_WS_URL",
  "NEXT_PUBLIC_HYPERCLAW_API_URL",
  "NEXT_PUBLIC_HYPERCLAW_MODELS_URL",
  "NEXT_PUBLIC_PRIVY_APP_ID",
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const nextConfig: NextConfig = {
  // Only allow dev proxy origins in development — never in production builds
  ...(process.env.NODE_ENV !== "production" && {
    allowedDevOrigins: ["gilfoyle.hypercli.com", "gilfoyle.dev.hypercli.com"],
  }),
  transpilePackages: [
    "@hypercli.com/sdk",
    "@hypercli/shared-ui",
    "@rainbow-me/rainbowkit",
    "@coinbase/cdp-sdk",
    "@base-org/account",
    "viem",
    "wagmi",
    "@wagmi/core",
    "@wagmi/connectors",
    "@privy-io/react-auth",
  ],
  skipTrailingSlashRedirect: true,
  env: {
    NEXT_PUBLIC_IS_MAIN_SITE: "false",
  },
  turbopack: {
    root: path.join(__dirname, "../../.."),
    resolveAlias: {
      "viem/accounts": "viem/_esm/accounts/index.js",
      "viem/chains": "viem/_esm/chains/index.js",
    },
    rules: {
      // Ignore pino/thread-stream test files (same as webpack null-loader rule)
      "./node_modules/pino/test/**": { loaders: [], as: "*.js" },
      "./node_modules/thread-stream/test/**": { loaders: [], as: "*.js" },
    },
  },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "viem/accounts": require.resolve("viem/_cjs/accounts/index.js"),
      "viem/chains": require.resolve("viem/_cjs/chains/index.js"),
    };
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /node_modules[\/\\](thread-stream|pino)[\/\\]test/,
      loader: "null-loader",
    });
    return config;
  },
};

export default nextConfig;
