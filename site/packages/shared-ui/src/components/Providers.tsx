"use client";

import { useEffect, useMemo } from "react";
import { TurnkeyProvider, TurnkeyProviderConfig } from "@turnkey/react-wallet-kit";
import { PrivyProvider } from "@privy-io/react-auth";
import "@turnkey/react-wallet-kit/styles.css";
import { AuthProvider } from "../providers/AuthProvider";
import { WalletProvider } from "../contexts/WalletContext";
import { RainbowKitProvider } from "../providers/RainbowKitProvider";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { AuroraPlanTierProvider } from "./AuroraPlanTierProvider";
import {
  HYPERCLI_AURORA_BRAND_ACCENT_HEX,
  HYPERCLI_AURORA_LOGO_ICON_SRC,
  HYPERCLI_BRAND_ACCENT_HEX,
  HYPERCLI_LOGO_ICON_SRC,
} from "./HyperCLILogo";

declare global {
  interface Window {
    twemoji?: {
      parse: (element: HTMLElement | string, options?: { folder?: string; ext?: string }) => void;
    };
  }
}

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const isValidPrivyAppId =
  PRIVY_APP_ID && PRIVY_APP_ID.length > 10 && PRIVY_APP_ID !== "placeholder";

export function Providers({ children }: { children: React.ReactNode }) {
  // Parse emojis with Twemoji for cross-platform flag support (Windows Chrome)
  useEffect(() => {
    const parseEmojis = () => {
      if (window.twemoji) {
        window.twemoji.parse(document.body, {
          folder: 'svg',
          ext: '.svg'
        });
      }
    };

    // Initial parse
    parseEmojis();

    // Re-parse on DOM changes (for dynamic content)
    const observer = new MutationObserver(parseEmojis);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return (
    <ThemeProvider>
      <AuroraPlanTierProvider>
        <ThemedProviderStack>{children}</ThemedProviderStack>
      </AuroraPlanTierProvider>
    </ThemeProvider>
  );
}

function ThemedProviderStack({ children }: { children: React.ReactNode }) {
  const { family, mode } = useTheme();
  const brandLogo = family === "aurora" ? HYPERCLI_AURORA_LOGO_ICON_SRC : HYPERCLI_LOGO_ICON_SRC;
  const brandAccent = family === "aurora" ? HYPERCLI_AURORA_BRAND_ACCENT_HEX : HYPERCLI_BRAND_ACCENT_HEX;
  const turnkeyConfig = useMemo<TurnkeyProviderConfig>(() => ({
    organizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
    authProxyConfigId: process.env.NEXT_PUBLIC_AUTH_PROXY_CONFIG_ID!,
    ui: {
      logoLight: brandLogo,
      logoDark: brandLogo,
      darkMode: mode === "dark",
      colors: {
        light: { modalText: "#0f1419" },
        dark: { modalText: "#fafafa" },
      },
    },
  }), [brandLogo, mode]);

  const appProviders = (
    <RainbowKitProvider>
      <TurnkeyProvider
        config={turnkeyConfig}
        callbacks={{
          onError: (error) => {
            console.error("Turnkey error:", {
              message: error.message,
              code: error.code,
              cause: error.cause,
            });
          },
          onAuthenticationSuccess: ({ session, action, method }) => {
            console.log("Authentication successful", {
              action,
              method,
              userId: session?.userId,
              organizationId: session?.organizationId,
            });
          },
        }}
      >
        <AuthProvider>
          <WalletProvider>{children}</WalletProvider>
        </AuthProvider>
      </TurnkeyProvider>
    </RainbowKitProvider>
  );

  if (!isValidPrivyAppId) return appProviders;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID!}
      config={{
        loginMethods: ["email", "wallet", "google"],
        appearance: {
          theme: mode,
          accentColor: brandAccent,
          logo: brandLogo,
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
        },
      }}
    >
      {appProviders}
    </PrivyProvider>
  );
}
