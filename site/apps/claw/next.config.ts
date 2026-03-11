import type { NextConfig } from "next";

// Build-time validation of required environment variables
const requiredEnvVars = [
  "NEXT_PUBLIC_CLAW_URL",
  "NEXT_PUBLIC_COOKIE_DOMAIN",
  "NEXT_PUBLIC_HYPERCLAW_COOKIE_DOMAIN",
  "NEXT_PUBLIC_CLAW_API_URL",
  "NEXT_PUBLIC_PRIVY_APP_ID",
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["gilfoyle.hypercli.com"],
  transpilePackages: [
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
    // Allow Netlify to set non-public HYPERCLAW_* vars and map them into client-safe names.
    NEXT_PUBLIC_HYPERCLAW_API_URL:
      process.env.HYPERCLAW_API_URL || process.env.NEXT_PUBLIC_HYPERCLAW_API_URL || "",
    NEXT_PUBLIC_HYPERCLAW_MODELS_URL:
      process.env.HYPERCLAW_MODELS_URL || process.env.NEXT_PUBLIC_HYPERCLAW_MODELS_URL || "",
  },
  turbopack: {
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
