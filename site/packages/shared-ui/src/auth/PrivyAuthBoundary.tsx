"use client";

import { ReactNode, useSyncExternalStore } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { AuthProvider, hasStoredSession } from "./AuthProvider";
import {
  HYPERCLI_AURORA_BRAND_ACCENT_HEX,
  HYPERCLI_AURORA_LOGO_ICON_SRC,
  HYPERCLI_BRAND_ACCENT_HEX,
  HYPERCLI_LOGO_ICON_SRC,
} from "../components/HyperCLILogo";
import { useTheme } from "../components/ThemeProvider";

export type PrivyLoginMethod = "email" | "wallet" | "google" | "sms" | "twitter" | "discord" | "github" | "linkedin" | "apple";

// The one place login methods are defined; every consumer references this.
export const DEFAULT_PRIVY_LOGIN_METHODS: PrivyLoginMethod[] = ["email", "wallet", "google", "apple"];

interface PrivyAuthBoundaryProps {
  appId: string;
  apiBaseUrl: string;
  children: ReactNode;
  tokenStorageKey?: string;
  loginMethods?: PrivyLoginMethod[];
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

function subscribeToSeededPlaywrightSession(): () => void {
  return () => undefined;
}

function getServerSeededPlaywrightSession(): boolean {
  return false;
}

export function PrivyAuthBoundary({
  appId,
  apiBaseUrl,
  children,
  tokenStorageKey = "app_auth_token",
  loginMethods = DEFAULT_PRIVY_LOGIN_METHODS,
  logo,
  accentColor,
  theme,
}: PrivyAuthBoundaryProps) {
  const { family, mode } = useTheme();
  const privyTheme = theme ?? mode;
  const resolvedLogo = logo ?? (family === "aurora" ? HYPERCLI_AURORA_LOGO_ICON_SRC : HYPERCLI_LOGO_ICON_SRC);
  const resolvedAccentColor = accentColor ?? (family === "aurora" ? HYPERCLI_AURORA_BRAND_ACCENT_HEX : HYPERCLI_BRAND_ACCENT_HEX);
  const seededPlaywrightSession = useSyncExternalStore(
    subscribeToSeededPlaywrightSession,
    () => hasSeededPlaywrightSession(tokenStorageKey),
    getServerSeededPlaywrightSession,
  );
  if (!isValidPrivyAppId(appId)) {
    throw new Error("PrivyAuthBoundary requires a valid appId");
  }

  if (seededPlaywrightSession) {
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
          theme: privyTheme,
          accentColor: resolvedAccentColor,
          logo: resolvedLogo,
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
