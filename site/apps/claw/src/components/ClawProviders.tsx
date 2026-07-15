"use client";

import { ReactNode } from "react";
import { HYPERCLI_LOGO_FULL_SRC, PrivyAuthBoundary, ThemeProvider, Toaster } from "@hypercli/shared-ui";
import { AUTH_BASE_URL } from "@/lib/api";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function ClawProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <PrivyAuthBoundary
        appId={PRIVY_APP_ID || ""}
        apiBaseUrl={AUTH_BASE_URL}
        tokenStorageKey="claw_auth_token"
        logo={HYPERCLI_LOGO_FULL_SRC}
      >
        {children}
      </PrivyAuthBoundary>
      <Toaster position="bottom-right" closeButton />
    </ThemeProvider>
  );
}
