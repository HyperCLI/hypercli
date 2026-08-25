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
} from "lucide-react";
import { HYPERCLI_LOGO_FULL_SRC, RecoveryState } from "@hypercli/shared-ui";
import { useAgentAuth } from "@/hooks/useAgentAuth";

// Hard allowlist: the only redirect targets this page will ever send a token
// to are our own desktop apps' custom-scheme callbacks. Anything else in
// ?redirect_uri= is rejected outright (never an open redirect).
const ALLOWED_REDIRECT_URIS = [
  "backseatdriver://auth", // Backseat Driver macOS app
  "hypercli://auth", // HyperCLI desktop companion (desktop/)
] as const;
const DEFAULT_REDIRECT_URI = ALLOWED_REDIRECT_URIS[0];

// Display name derived from the validated redirect target; agnostic
// fallback keeps the copy honest for any future app.
const APP_NAMES: Record<string, string> = {
  "backseatdriver://auth": "Backseat Driver",
  "hypercli://auth": "HyperCLI",
};

function buildCallbackUrl(redirectUri: string, token: string): string {
  // Token travels in the URL fragment (not the query) so it is never sent
  // to any server if the scheme is mishandled.
  return `${redirectUri}#token=${encodeURIComponent(token)}`;
}

type RedirectParamStatus = "checking" | "valid" | "invalid";
type SessionRecovery = { title: string; description: string };

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
  const [redirectUri, setRedirectUri] = useState<string>(DEFAULT_REDIRECT_URI);
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<SessionRecovery | null>(null);
  const [tokenRevealed, setTokenRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const autoLoginTriggered = useRef(false);
  const appName = APP_NAMES[redirectUri] ?? "your desktop app";

  // Validate ?redirect_uri= from the query string. Absent defaults to the
  // allowed value; anything that is not an exact match is rejected.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("redirect_uri");
    if (raw === null) {
      setParamStatus("valid");
    } else if ((ALLOWED_REDIRECT_URIS as readonly string[]).includes(raw)) {
      setRedirectUri(raw);
      setParamStatus("valid");
    } else {
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

  const openApp = useCallback(
    (jwt: string) => {
      window.location.replace(buildCallbackUrl(redirectUri, jwt));
    },
    [redirectUri],
  );

  // Fetch the session token but never navigate on our own: the hand-off to
  // the desktop app happens only when the user clicks the Open button below.
  const fetchToken = useCallback(async () => {
    try {
      setTokenError(null);
      const jwt = await getToken();
      setToken(jwt);
    } catch {
      setTokenError({
        title: "Retry to reopen the desktop session",
        description: "The secure handoff did not finish. Retry to open a new session for the desktop app.",
      });
    }
  }, [getToken]);

  // Once authenticated, exchange for the app JWT; the user then confirms the
  // redirect explicitly by clicking the Open button.
  useEffect(() => {
    if (paramStatus !== "valid" || !isAuthenticated || token) return;
    void fetchToken();
  }, [paramStatus, isAuthenticated, token, fetchToken]);

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
        <h1 className="sr-only">Invalid redirect address</h1>
        <RecoveryState
          presentation="compact"
          announcement="assertive"
          title="Restart sign-in from the desktop app"
          description="This sign-in link cannot return safely to the app. Close this window and begin again from the desktop app."
        />
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
          Sign in to {appName}
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Sign in with your HyperCLI account to connect the {appName} desktop
          app.
        </p>
        {authError && flowState === "error" && (
          <RecoveryState
            presentation="compact"
            announcement="assertive"
            title="Retry to reopen sign-in"
            description="Sign-in did not finish. Start it again when you are ready."
            className="mt-3"
          />
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
        <h1 className="sr-only">Could not get a token</h1>
        <RecoveryState
          presentation="compact"
          announcement="assertive"
          title={tokenError.title}
          description={tokenError.description}
          primaryAction={{ label: "Try again", onAction: () => { void fetchToken(); } }}
        />
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
        You are signed in
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        Click below to return to the {appName} desktop app and finish
        connecting it to your HyperCLI account.
      </p>
      <button
        type="button"
        onClick={() => openApp(token)}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary/15 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/25"
      >
        <ExternalLink className="h-4 w-4" />
        Open {appName}
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
