import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { mintApiKey, saveApiKey, startLogin } from "../api";

export function SignIn({
  onSignedIn,
  message,
}: {
  onSignedIn: () => void;
  /** Why this screen is showing, when it is not simply a first run. */
  message?: string | null;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [browserOpened, setBrowserOpened] = useState(false);
  // The deep link can arrive twice on Windows/Linux (argv hand-off plus the
  // plugin's own event); the token must be redeemed exactly once.
  const minting = useRef(false);

  const redeem = useCallback(
    async (sessionToken: string) => {
      if (minting.current) return;
      minting.current = true;
      setError(null);
      try {
        await mintApiKey({ sessionToken });
        onSignedIn();
      } catch (e) {
        setError(
          typeof e === "string"
            ? e
            : "Could not finish browser sign-in. Try again, or paste an API key below.",
        );
      } finally {
        minting.current = false;
      }
    },
    [onSignedIn],
  );

  // The Rust side emits the browser session token here once the login page
  // redirects back into the app. Not listening — e.g. a `listen` that only
  // fires on error — would leave the browser detour with no way back in.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    listen<string>("auth-token", (event) => {
      void redeem(event.payload);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No Tauri IPC (a dev browser tab): the deep link can never arrive
        // there, so the paste path below is the only one that could work.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [redeem]);

  const browserSignIn = async () => {
    setError(null);
    try {
      await startLogin();
      setBrowserOpened(true);
    } catch (e) {
      setError(typeof e === "string" ? e : "Could not open the browser sign-in page.");
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveApiKey(key);
      onSignedIn();
    } catch (e) {
      setError(typeof e === "string" ? e : "Could not sign in with that key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-background">
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-[52px]" />
      <div className="w-[360px] max-w-[calc(100vw-32px)]">
        <div className="text-[20px] font-semibold mb-1.5">Welcome to HyperCLI</div>
        <p className="text-[13px] text-text-secondary mb-6 leading-relaxed">
          {message ?? "Sign in with your HyperCLI account to see your agents."}
        </p>
        <button onClick={browserSignIn} className="ui-primary-button w-full py-2.5">
          Sign in with your browser
        </button>
        {browserOpened && (
          <p className="mt-2 text-[11px] text-text-secondary/70 leading-relaxed">
            Finish signing in in the browser window that just opened — this app continues
            on its own when you're done.
          </p>
        )}
        <div className="my-5 flex items-center gap-3 text-[11px] text-text-secondary/60">
          <div className="h-px flex-1 bg-border" />
          or paste an API key
          <div className="h-px flex-1 bg-border" />
        </div>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
          placeholder="hyper_api_…"
          className="ui-field rounded-lg px-3 py-2.5 text-[13px] font-mono"
        />
        {error && (
          <div className="mt-2.5 text-[12px] text-error bg-error-bg rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <button
          onClick={submit}
          disabled={busy || !key.trim()}
          className="ui-secondary-button mt-4 w-full py-2.5"
        >
          {busy ? "Checking…" : "Sign in with a key"}
        </button>
      </div>
    </div>
  );
}
