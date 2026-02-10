import type { NextConfig } from "next";

// Build-time validation of required environment variables
const requiredEnvVars = [
  'NEXT_PUBLIC_CLAW_URL',
  'NEXT_PUBLIC_COOKIE_DOMAIN',
  'NEXT_PUBLIC_CLAW_API_URL',
] as const;
// NEXT_PUBLIC_PRIVY_APP_ID is intentionally optional at build time.
// apps/claw/src/components/ClawProviders.tsx falls back to StubAuthProvider when absent.

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
  },
  turbopack: {},
  webpack: (config) => {
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /node_modules[\/\\](thread-stream|pino)[\/\\]test/,
      loader: 'null-loader',
    });
    return config;
  },
};

export default nextConfig;
