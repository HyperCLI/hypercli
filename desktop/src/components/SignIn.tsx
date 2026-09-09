import { useState } from "react";
import { saveApiKey } from "../api";

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
      <div className="w-[360px]">
        <div className="text-[20px] font-semibold mb-1.5">Welcome to HyperCLI</div>
        <p className="text-[13px] text-text-secondary mb-6 leading-relaxed">
          {message ?? "Sign in with a HyperCLI API key to see your agents."}
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
          placeholder="hyper_api_…"
          autoFocus
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
          className="ui-primary-button mt-4 w-full py-2.5"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
