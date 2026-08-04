"use client";

import { ReactNode } from "react";
import { AuroraPlanTierProvider, PrivyAuthBoundary, ThemeProvider, Toaster, TooltipProvider } from "@hypercli/shared-ui";
import { AUTH_BASE_URL } from "@/lib/api";
import { CLAW_TOOLTIP_DELAY_MS } from "@/components/ClawTooltip";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function ClawProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuroraPlanTierProvider>
        <TooltipProvider delayDuration={CLAW_TOOLTIP_DELAY_MS} skipDelayDuration={0}>
          <PrivyAuthBoundary
            appId={PRIVY_APP_ID || ""}
            apiBaseUrl={AUTH_BASE_URL}
            tokenStorageKey="claw_auth_token"
          >
            {children}
          </PrivyAuthBoundary>
          <Toaster position="bottom-right" closeButton />
        </TooltipProvider>
      </AuroraPlanTierProvider>
    </ThemeProvider>
  );
}
