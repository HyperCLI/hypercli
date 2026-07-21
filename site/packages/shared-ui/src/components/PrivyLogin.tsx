"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useTurnkey } from "@turnkey/react-wallet-kit";
import { clearAuthLogoutMarker } from "../utils/cookies";
import { getAuthBackendUrl } from "../utils/api";
import { exchangePrivyToken } from "../auth/AuthProvider";
import { HYPERCLI_LOGO_ICON_SRC } from "./HyperCLILogo";

export interface PrivyLoginPanelProps {
  title?: string;
  description?: string;
  apiBaseUrl?: string;
  tokenStorageKey?: string;
  cookieName?: string;
  showTitle?: boolean;
  onSuccess?: () => void;
  fallbackLabel?: string;
  showTurnkeyFallback?: boolean;
  turnkeyTitle?: string;
}

export interface PrivyLoginModalProps extends PrivyLoginPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function normalizeApiBase(apiBaseUrl?: string): string {
  return (apiBaseUrl || getAuthBackendUrl()).replace(/\/+$/, "");
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return fallback;
}

function TurnkeyFallbackButton({
  disabled,
  label,
  title,
}: {
  disabled: boolean;
  label: string;
  title: string;
}) {
  const { handleLogin } = useTurnkey();

  const handleClick = async () => {
    await handleLogin({
      logoLight: HYPERCLI_LOGO_ICON_SRC,
      logoDark: HYPERCLI_LOGO_ICON_SRC,
      title,
    });
  };

  return (
    <button
      onClick={() => void handleClick()}
      disabled={disabled}
      className="self-center w-fit text-sm text-[var(--color-text)] opacity-85 underline underline-offset-4 hover:opacity-100 transition-opacity disabled:opacity-50"
    >
      {label}
    </button>
  );
}

export function PrivyLoginPanel({
  title = "Welcome to HyperCLI",
  description = "Sign in with Privy to continue",
  apiBaseUrl,
  tokenStorageKey = "app_auth_token",
  cookieName = "auth_token",
  showTitle = true,
  onSuccess,
  fallbackLabel = "Turnkey Login",
  showTurnkeyFallback = false,
  turnkeyTitle = "Welcome to HyperCLI",
}: PrivyLoginPanelProps) {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shouldExchangeRef = useRef(false);

  const performExchange = async () => {
    const privyToken = await getAccessToken();
    if (!privyToken) {
      throw new Error("Failed to get Privy access token");
    }

    const resolvedApiBase = normalizeApiBase(apiBaseUrl);
    await exchangePrivyToken(resolvedApiBase, privyToken, tokenStorageKey, cookieName);
  };

  useEffect(() => {
    if (!authenticated || !shouldExchangeRef.current || isSubmitting) return;

    void (async () => {
      try {
        setIsSubmitting(true);
        setError(null);
        await performExchange();
        onSuccess?.();
      } catch (err) {
        setError(getErrorMessage(err, "Privy authentication failed"));
      } finally {
        shouldExchangeRef.current = false;
        setIsSubmitting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, isSubmitting, onSuccess]);

  const handleClick = async () => {
    if (!ready || isSubmitting) return;

    shouldExchangeRef.current = true;
    setError(null);
    clearAuthLogoutMarker();

    if (authenticated) {
      try {
        setIsSubmitting(true);
        await performExchange();
        shouldExchangeRef.current = false;
        onSuccess?.();
      } catch (err) {
        shouldExchangeRef.current = false;
        setError(getErrorMessage(err, "Privy authentication failed"));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    login();
  };

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md">
      {showTitle && (
        <div className="text-center">
          <h1 className="text-3xl font-bold text-[var(--color-primary)] mb-2">
            {title}
          </h1>
          <p className="text-[var(--color-text)] opacity-70">{description}</p>
        </div>
      )}

      {error && (
        <div className="w-full rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm text-destructive whitespace-pre-wrap break-words">
            {error}
          </p>
        </div>
      )}

      <button
        onClick={() => void handleClick()}
        disabled={!ready || isSubmitting}
        className="w-full btn-primary px-6 py-3 rounded-lg font-medium disabled:opacity-50"
      >
        {isSubmitting ? "Signing in..." : "Login with Privy"}
      </button>

      {showTurnkeyFallback && (
        <TurnkeyFallbackButton
          disabled={isSubmitting}
          label={fallbackLabel}
          title={turnkeyTitle}
        />
      )}

      <p className="text-xs text-[var(--color-text)] opacity-50 text-center">
        Secure email OTP via Privy.
      </p>
    </div>
  );
}

export function PrivyLoginModal({
  isOpen,
  onClose,
  onSuccess,
  ...panelProps
}: PrivyLoginModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-low border border-border-medium rounded-2xl shadow-2xl p-8 max-w-md w-full relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-muted hover:text-foreground transition-colors"
          aria-label="Close login modal"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        <PrivyLoginPanel
          {...panelProps}
          onSuccess={() => {
            onClose();
            onSuccess?.();
          }}
        />
      </div>
    </div>
  );
}
