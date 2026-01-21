import type { NextConfig } from "next";

// Build-time validation of required environment variables
const requiredEnvVars = [
  'NEXT_PUBLIC_MAIN_SITE_URL',
  'NEXT_PUBLIC_CONSOLE_URL',
  'NEXT_PUBLIC_CHAT_URL',
  'NEXT_PUBLIC_COOKIE_DOMAIN',
  'NEXT_PUBLIC_ORGANIZATION_ID',
  'NEXT_PUBLIC_AUTH_PROXY_CONFIG_ID',
  'NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID',
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const nextConfig: NextConfig = {
  transpilePackages: ["@hypercli/shared-ui"],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  env: {
    NEXT_PUBLIC_IS_MAIN_SITE: "true",
  },
  // Empty turbopack config to acknowledge we know about it
  turbopack: {},
  // Exclude test files from being bundled
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
