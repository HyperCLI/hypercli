import type { NextConfig } from "next";

// Build-time validation of required environment variables
const requiredEnvVars = [
  "NEXT_PUBLIC_CLAW_URL",
  "NEXT_PUBLIC_COOKIE_DOMAIN",
  "NEXT_PUBLIC_CLAW_API_URL",
  "NEXT_PUBLIC_PRIVY_APP_ID",
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const nextConfig: NextConfig = {
  transpilePackages: ["@hypercli/shared-ui"],
  skipTrailingSlashRedirect: true,
  env: {
    NEXT_PUBLIC_IS_MAIN_SITE: "false",
    // Allow Netlify to set non-public HYPERCLAW_* vars and map them into client-safe names.
    NEXT_PUBLIC_HYPERCLAW_API_URL:
      process.env.HYPERCLAW_API_URL || process.env.NEXT_PUBLIC_HYPERCLAW_API_URL || "",
    NEXT_PUBLIC_HYPERCLAW_MODELS_URL:
      process.env.HYPERCLAW_MODELS_URL || process.env.NEXT_PUBLIC_HYPERCLAW_MODELS_URL || "",
  },
  turbopack: {},
  webpack: (config) => {
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
