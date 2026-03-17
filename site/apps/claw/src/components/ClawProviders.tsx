"use client";

import { ReactNode } from "react";
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
 * Stub auth provider for when Privy is not configured (build time, dev without creds).
 * Pages still render but auth functions are no-ops.
 */
function StubAuthProvider({ children }: { children: ReactNode }) {
  const noop = () => {};
  const noopAsync = async () => {};
  const noopToken = async (): Promise<string> => {
    throw new Error("Auth not configured — set NEXT_PUBLIC_PRIVY_APP_ID");
  };

  return (
    <ClawAuthContext.Provider
      value={{
        isLoading: false,
        isAuthenticated: false,
        user: null,
        login: noop,
        logout: noopAsync,
        getToken: noopToken,
      }}
    >
      {children}
    </ClawAuthContext.Provider>
  );
}

export function ClawProviders({ children }: { children: ReactNode }) {
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
