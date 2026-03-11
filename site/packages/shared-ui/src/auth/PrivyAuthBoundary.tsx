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
