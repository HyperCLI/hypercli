"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  LogIn,
  ShieldAlert,
} from "lucide-react";
import { HYPERCLI_LOGO_FULL_SRC } from "@hypercli/shared-ui";
import { useAgentAuth } from "@/hooks/useAgentAuth";

// Hard allowlist: the only redirect target this page will ever send a token
// to is the Backseat Driver macOS app's custom-scheme callback. Anything
// else in ?redirect_uri= is rejected outright (never an open redirect).
const ALLOWED_REDIRECT_URI = "backseatdriver://auth";

function buildCallbackUrl(token: string): string {
  // Token travels in the URL fragment (not the query) so it is never sent
  // to any server if the scheme is mishandled.
  return `${ALLOWED_REDIRECT_URI}#token=${encodeURIComponent(token)}`;
}

type RedirectParamStatus = "checking" | "valid" | "invalid";

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HYPERCLI_LOGO_FULL_SRC} alt="HyperCLI" className="mb-5 h-6 w-auto" />
        {children}
      </div>
    </main>
  );
}

export default function DesktopLoginPage() {
  const {
    isLoading,
    isAuthenticated,
    flowState,
    error: authError,
    login,
    getToken,
  } = useAgentAuth();

  const [paramStatus, setParamStatus] = useState<RedirectParamStatus>("checking");
  const [rejectedRedirectUri, setRejectedRedirectUri] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenRevealed, setTokenRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const autoLoginTriggered = useRef(false);
  const autoRedirectTriggered = useRef(false);

  // Validate ?redirect_uri= from the query string. Absent defaults to the
  // allowed value; anything that is not an exact match is rejected.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("redirect_uri");
    if (raw === null || raw === ALLOWED_REDIRECT_URI) {
      setParamStatus("valid");
    } else {
      setRejectedRedirectUri(raw);
      setParamStatus("invalid");
    }
  }, []);

  // Open the normal Privy login modal once for logged-out visitors.
  useEffect(() => {
    if (paramStatus !== "valid" || isLoading || isAuthenticated) return;
    if (flowState !== "idle" || autoLoginTriggered.current) return;
    autoLoginTriggered.current = true;
    login();
  }, [paramStatus, isLoading, isAuthenticated, flowState, login]);

  const openApp = useCallback((jwt: string) => {
    window.location.replace(buildCallbackUrl(jwt));
  }, []);

  const fetchTokenAndRedirect = useCallback(async () => {
    try {
      setTokenError(null);
      const jwt = await getToken();
      setToken(jwt);
      if (!autoRedirectTriggered.current) {
        autoRedirectTriggered.current = true;
        openApp(jwt);
      }
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "Could not fetch a session token");
    }
  }, [getToken, openApp]);

  // Once authenticated, exchange for the app JWT and hand off to the app.
  useEffect(() => {
    if (paramStatus !== "valid" || !isAuthenticated || token) return;
    void fetchTokenAndRedirect();
  }, [paramStatus, isAuthenticated, token, fetchTokenAndRedirect]);

  const copyToken = useCallback(async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the token is still visible for manual copy.
    }
  }, [token]);

  if (paramStatus === "invalid") {
    return (
      <CardShell>
        <div className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <h1 className="text-base font-semibold">Invalid redirect address</h1>
        </div>
        <p className="mt-3 text-sm text-text-muted">
          This sign-in page can only hand credentials to the Backseat Driver
          app callback. The requested redirect address is not allowed:
        </p>
        <p className="mt-2 break-all rounded-md bg-surface-low px-3 py-2 font-mono text-xs text-text-secondary">
          {rejectedRedirectUri}
        </p>
        <p className="mt-3 text-sm text-text-muted">
          Close this window and start sign-in again from the app.
        </p>
      </CardShell>
    );
  }

  if (
    paramStatus === "checking" ||
    isLoading ||
    flowState === "checking_session" ||
    flowState === "exchanging"
  ) {
    return (
      <CardShell>
        <div className="flex items-center gap-2 text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          <p className="text-sm">Preparing sign-in&hellip;</p>
        </div>
      </CardShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <CardShell>
        <h1 className="text-base font-semibold text-foreground">
          Sign in to Backseat Driver
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Sign in with your HyperCLI account to connect the Backseat Driver
          desktop app.
        </p>
        {authError && flowState === "error" && (
          <p className="mt-3 text-xs text-destructive">{authError}</p>
        )}
        <button
          type="button"
          onClick={login}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary/15 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/25"
        >
          <LogIn className="h-4 w-4" />
          Sign in
        </button>
      </CardShell>
    );
  }

  if (tokenError) {
    return (
      <CardShell>
        <div className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <h1 className="text-base font-semibold">Could not get a token</h1>
        </div>
        <p className="mt-3 break-words text-sm text-text-muted">{tokenError}</p>
        <button
          type="button"
          onClick={() => void fetchTokenAndRedirect()}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary/15 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/25"
        >
          Try again
        </button>
      </CardShell>
    );
  }

  if (!token) {
    return (
      <CardShell>
        <div className="flex items-center gap-2 text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          <p className="text-sm">Fetching your session token&hellip;</p>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell>
      <h1 className="text-base font-semibold text-foreground">
        Opening Backseat Driver&hellip;
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        You are signed in. If the app did not open automatically, use the
        button below.
      </p>
      <button
        type="button"
        onClick={() => openApp(token)}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary/15 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/25"
      >
        <ExternalLink className="h-4 w-4" />
        Open Backseat Driver
      </button>

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs text-text-muted">
          Still not working? Copy the token and paste it into the app manually.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate rounded-md bg-surface-low px-3 py-2 font-mono text-xs text-text-secondary">
            {tokenRevealed ? token : "•".repeat(48)}
          </p>
          <button
            type="button"
            onClick={() => setTokenRevealed((revealed) => !revealed)}
            aria-label={tokenRevealed ? "Hide token" : "Reveal token"}
            className="rounded-md border border-border p-2 text-text-secondary transition-colors hover:text-foreground"
          >
            {tokenRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => void copyToken()}
            aria-label="Copy token"
            className="rounded-md border border-border p-2 text-text-secondary transition-colors hover:text-foreground"
          >
            {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </CardShell>
  );
}
