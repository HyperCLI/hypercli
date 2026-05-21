"use client";

import { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { AuthProvider } from "./AuthProvider";

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

export function PrivyAuthBoundary({
  appId,
  apiBaseUrl,
  children,
  tokenStorageKey = "app_auth_token",
  loginMethods = ["email", "wallet", "google"],
  logo,
  accentColor = "#38D39F",
  theme = "dark",
}: PrivyAuthBoundaryProps) {
  if (!isValidPrivyAppId(appId)) {
    throw new Error("PrivyAuthBoundary requires a valid appId");
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
