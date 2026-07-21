"use client";

import { useEffect, useMemo } from "react";
import { TurnkeyProvider, TurnkeyProviderConfig } from "@turnkey/react-wallet-kit";
import { PrivyProvider } from "@privy-io/react-auth";
import "@turnkey/react-wallet-kit/styles.css";
import { AuthProvider } from "../providers/AuthProvider";
import { WalletProvider } from "../contexts/WalletContext";
import { RainbowKitProvider } from "../providers/RainbowKitProvider";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { HYPERCLI_BRAND_ACCENT_HEX, HYPERCLI_LOGO_ICON_SRC } from "./HyperCLILogo";

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
      <ThemedProviderStack>{children}</ThemedProviderStack>
    </ThemeProvider>
  );
}

function ThemedProviderStack({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const turnkeyConfig = useMemo<TurnkeyProviderConfig>(() => ({
    organizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
    authProxyConfigId: process.env.NEXT_PUBLIC_AUTH_PROXY_CONFIG_ID!,
    ui: {
      logoLight: HYPERCLI_LOGO_ICON_SRC,
      logoDark: HYPERCLI_LOGO_ICON_SRC,
      darkMode: theme === "dark",
      colors: {
        light: { modalText: "#0f1419" },
        dark: { modalText: "#fafafa" },
      },
    },
  }), [theme]);

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
          theme,
          accentColor: HYPERCLI_BRAND_ACCENT_HEX,
          logo: HYPERCLI_LOGO_ICON_SRC,
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
