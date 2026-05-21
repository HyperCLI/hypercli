"use client";

import { ReactNode } from "react";
import { PrivyAuthBoundary } from "@hypercli/shared-ui";
import { AUTH_BASE_URL } from "@/lib/api";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const LOGIN_LOGO_SRC = "/logos/hyperclaw-full-green.svg";

export function ClawProviders({ children }: { children: ReactNode }) {
  return (
    <PrivyAuthBoundary
      appId={PRIVY_APP_ID || ""}
      apiBaseUrl={AUTH_BASE_URL}
      tokenStorageKey="claw_auth_token"
      logo={LOGIN_LOGO_SRC}
    >
      {children}
    </PrivyAuthBoundary>
  );
}
