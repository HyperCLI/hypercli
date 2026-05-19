"use client";

import { ReactNode, useEffect, useState } from "react";
import {
  PrivyAuthBoundary,
  PrivyAuthContext as ClawAuthContext,
} from "@hypercli/shared-ui";
import { AUTH_BASE_URL } from "@/lib/api";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

// Privy app IDs start with "cl" — reject empty/placeholder values
const isValidPrivyAppId =
  PRIVY_APP_ID && PRIVY_APP_ID.length > 10 && PRIVY_APP_ID !== "placeholder";

/**
 * Stub auth provider for loading, seeded E2E auth, or missing Privy config.
 */
function readStoredE2EToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("claw_auth_token");
}

function hasSeededE2EToken(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(navigator.webdriver && readStoredE2EToken());
}

function StubAuthProvider({
  children,
  loading = false,
  useStoredToken = false,
}: {
  children: ReactNode;
  loading?: boolean;
  useStoredToken?: boolean;
}) {
  const noop = () => {};
  const logout = async () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("claw_auth_token");
    }
  };
  const getToken = async (): Promise<string> => {
    if (useStoredToken) {
      const token = readStoredE2EToken();
      if (token) return token;
    }
    throw new Error("Auth not configured — set NEXT_PUBLIC_PRIVY_APP_ID");
  };
  const authenticated = useStoredToken && Boolean(readStoredE2EToken());

  return (
    <ClawAuthContext.Provider
      value={{
        isLoading: loading,
        isAuthenticated: authenticated,
        user: authenticated ? { id: "e2e-user" } : null,
        flowState: loading ? "checking_session" : authenticated ? "complete" : "idle",
        error: null,
        login: noop,
        logout,
        getToken,
      }}
    >
      {children}
    </ClawAuthContext.Provider>
  );
}

export function ClawProviders({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <StubAuthProvider loading>{children}</StubAuthProvider>;
  }

  if (hasSeededE2EToken()) {
    return <StubAuthProvider useStoredToken>{children}</StubAuthProvider>;
  }

  if (!isValidPrivyAppId) {
    return <StubAuthProvider>{children}</StubAuthProvider>;
  }

  return (
    <PrivyAuthBoundary
      appId={PRIVY_APP_ID!}
      apiBaseUrl={AUTH_BASE_URL}
      tokenStorageKey="claw_auth_token"
      logo="https://hypercli.com/logo-horizontal-white.png"
    >
      {children}
    </PrivyAuthBoundary>
  );
}
