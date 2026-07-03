"use client";

import { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { AuthProvider, hasStoredSession } from "./AuthProvider";
import { HYPERCLI_BRAND_ACCENT_HEX, HYPERCLI_LOGO_FULL_SRC } from "../components/HyperCLILogo";

interface PrivyAuthBoundaryProps {
  appId: string;
  apiBaseUrl: string;
  children: ReactNode;
  tokenStorageKey?: string;
  loginMethods?: ("email" | "wallet" | "google" | "sms" | "twitter" | "discord" | "github" | "linkedin" | "apple")[];
  logo?: string;
  accentColor?: `#${string}`;
  theme?: "light" | "dark";
}

function isValidPrivyAppId(appId: string): boolean {
  const normalized = appId.trim();
  return normalized.length > 10 && normalized !== "placeholder";
}

function hasSeededPlaywrightSession(tokenStorageKey: string): boolean {
  return (
    typeof window !== "undefined" &&
    window.navigator.webdriver &&
    hasStoredSession(tokenStorageKey)
  );
}

export function PrivyAuthBoundary({
  appId,
  apiBaseUrl,
  children,
  tokenStorageKey = "app_auth_token",
  loginMethods = ["email", "wallet", "google"],
  logo = HYPERCLI_LOGO_FULL_SRC,
  accentColor = HYPERCLI_BRAND_ACCENT_HEX,
  theme = "dark",
}: PrivyAuthBoundaryProps) {
  if (!isValidPrivyAppId(appId)) {
    throw new Error("PrivyAuthBoundary requires a valid appId");
  }

  if (hasSeededPlaywrightSession(tokenStorageKey)) {
    return (
      <AuthProvider apiBaseUrl={apiBaseUrl} tokenStorageKey={tokenStorageKey} privyEnabled={false}>
        {children}
      </AuthProvider>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods,
        appearance: {
          theme,
          accentColor,
          logo,
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "off",
          },
        },
      }}
    >
      <AuthProvider apiBaseUrl={apiBaseUrl} tokenStorageKey={tokenStorageKey}>
        {children}
      </AuthProvider>
    </PrivyProvider>
  );
}
