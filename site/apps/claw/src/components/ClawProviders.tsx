"use client";

import { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { ClawAuthProvider, ClawAuthContext } from "./ClawAuthProvider";

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
    <PrivyProvider
      appId={PRIVY_APP_ID!}
      config={{
        loginMethods: ["email", "wallet", "google"],
        appearance: {
          theme: "dark",
          accentColor: "#38D39F",
          logo: "/favicon.svg",
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "off",
          },
        },
      }}
    >
      <ClawAuthProvider>{children}</ClawAuthProvider>
    </PrivyProvider>
  );
}
