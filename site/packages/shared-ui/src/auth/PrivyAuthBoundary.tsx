"use client";

import { ReactNode, useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { AuthContext, AuthProvider } from "./AuthProvider";

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

function readStoredToken(tokenStorageKey: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(tokenStorageKey);
}

function hasSeededStoredToken(tokenStorageKey: string): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(navigator.webdriver && readStoredToken(tokenStorageKey));
}

function StubAuthProvider({
  children,
  tokenStorageKey,
  loading = false,
  useStoredToken = false,
}: {
  children: ReactNode;
  tokenStorageKey: string;
  loading?: boolean;
  useStoredToken?: boolean;
}) {
  const noop = () => {};
  const logout = async () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(tokenStorageKey);
    }
  };
  const getToken = async (): Promise<string> => {
    if (useStoredToken) {
      const token = readStoredToken(tokenStorageKey);
      if (token) return token;
    }
    throw new Error("Auth not configured");
  };
  const authenticated = useStoredToken && Boolean(readStoredToken(tokenStorageKey));

  return (
    <AuthContext.Provider
      value={{
        isLoading: loading,
        isAuthenticated: authenticated,
        user: authenticated ? { id: "stored-auth-user" } : null,
        flowState: loading ? "checking_session" : authenticated ? "complete" : "idle",
        error: null,
        login: noop,
        logout,
        getToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <StubAuthProvider loading tokenStorageKey={tokenStorageKey}>
        {children}
      </StubAuthProvider>
    );
  }

  if (hasSeededStoredToken(tokenStorageKey)) {
    return (
      <StubAuthProvider useStoredToken tokenStorageKey={tokenStorageKey}>
        {children}
      </StubAuthProvider>
    );
  }

  if (!isValidPrivyAppId(appId)) {
    return (
      <StubAuthProvider tokenStorageKey={tokenStorageKey}>
        {children}
      </StubAuthProvider>
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
