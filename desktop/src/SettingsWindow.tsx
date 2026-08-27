import { useCallback, useEffect, useState } from "react";
import {
  type BuzzConnectionMetadata,
  type ProviderStatus,
  installProviders,
  listBuzzConnections,
  providerStatus,
  removeBuzzConnection,
  saveBuzzConnection,
  uninstallProviders,
} from "./api";

const inputClass =
  "w-full rounded-md border border-rule-strong bg-raised px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-dim focus:border-brand";

const DEFAULT_RELAY = "community.buzz.hypercli.com";

/** Short-label a provider binary name for status pills. */
function shortName(name: string): string {
  return name
    .replace(/^buzz-backend-hypercli-?/, "")
    .replace(/\.exe$/, "");
}

function ProviderSection() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"install" | "uninstall" | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await providerStatus());
    } catch (loadError) {
      setError(String(loadError));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (action: "install" | "uninstall") => {
    setBusy(action);
    setError(null);
    try {
      const next =
        action === "install"
          ? await installProviders()
          : await uninstallProviders();
      setStatus(next);
    } catch (actionError) {
      setError(String(actionError));
    } finally {
      setBusy(null);
    }
  };

  const allInstalled =
    status !== null && status.missing.length === 0 && status.broken.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium tracking-wide text-ink-dim uppercase">
        Buzz provider
      </span>
      <p className="text-xs text-ink-dim">
        Installs the bundled{" "}
        <span className="font-mono">buzz-backend-hypercli</span> provider and
        one entry per runtime into{" "}
        <span className="font-mono">
          {status?.bin_dir ?? "~/.local/bin"}
        </span>{" "}
        so Buzz can discover and run them.
      </p>

      {status && (
        <div className="flex flex-wrap gap-1.5">
          {status.installed.map((name) => (
            <span
              key={name}
              className="rounded-full border border-rule bg-raised px-2 py-0.5 font-mono text-[11px] text-ink-secondary"
            >
              {shortName(name)} ✓
            </span>
          ))}
          {status.missing
            .filter((name) => !status.broken.includes(name))
            .map((name) => (
              <span
                key={name}
                className="rounded-full border border-rule px-2 py-0.5 font-mono text-[11px] text-ink-dim"
              >
                {shortName(name)}
              </span>
            ))}
          {status.broken.map((name) => (
            <span
              key={name}
              className="rounded-full border border-danger px-2 py-0.5 font-mono text-[11px] text-danger"
            >
              {shortName(name)} broken
            </span>
          ))}
        </div>
      )}

      {status?.translocated && (
        <p className="text-xs text-danger">
          The app is running from a quarantined download. Move it to
          Applications — the install still works, but the app itself may
          disappear on quit.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy !== null}
          className="flex-1 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          onClick={() => void act("install")}
        >
          {busy === "install"
            ? "Installing…"
            : allInstalled
              ? "Reinstall"
              : "Install provider"}
        </button>
        {status && status.installed.length > 0 && (
          <button
            type="button"
            disabled={busy !== null}
            className="rounded-lg border border-rule px-3 py-1.5 text-sm text-ink-secondary hover:text-danger disabled:opacity-50"
            onClick={() => void act("uninstall")}
          >
            {busy === "uninstall" ? "Removing…" : "Uninstall"}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <span className="text-xs font-medium tracking-wide text-ink-dim uppercase">
        Connections
      </span>
    </div>
  );
}

export default function SettingsWindow() {
  const [connections, setConnections] = useState<BuzzConnectionMetadata[]>([]);
  const [label, setLabel] = useState("");
  const [relay, setRelay] = useState(DEFAULT_RELAY);
  const [nsec, setNsec] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setConnections(await listBuzzConnections());
    } catch (loadError) {
      setError(String(loadError));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveBuzzConnection({
        label: label.trim(),
        relay: relay.trim(),
        nsec: nsec.trim(),
      });
      setLabel("");
      setRelay(DEFAULT_RELAY);
      setNsec("");
      await refresh();
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <ProviderSection />
        <p className="text-xs text-ink-dim">
          Buzz connections pair a relay with the owner identity that enrolls
          your agents. The nsec is stored in your OS keychain and never leaves
          this machine.
        </p>

        {connections.length > 0 && (
          <div className="flex flex-col divide-y divide-rule rounded-md border border-rule">
            {connections.map((connection) => (
              <div
                key={connection.id}
                className="flex items-center gap-2 px-2.5 py-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate text-ink-secondary">
                  {connection.label}
                  <span className="text-ink-dim"> · {connection.relay_url}</span>
                </span>
                <button
                  type="button"
                  className="text-ink-dim hover:text-danger"
                  onClick={() => {
                    void removeBuzzConnection(connection.id)
                      .then(refresh)
                      .catch((e) => setError(String(e)));
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <span className="text-xs font-medium tracking-wide text-ink-dim uppercase">
          Add a connection
        </span>
        <input
          type="text"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label"
          className={inputClass}
        />
        <input
          type="text"
          value={relay}
          onChange={(event) => setRelay(event.target.value)}
          placeholder={DEFAULT_RELAY}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          inputMode="url"
          className={inputClass}
        />
        <input
          type="password"
          value={nsec}
          onChange={(event) => setNsec(event.target.value)}
          placeholder="Owner nsec (nsec1…)"
          className={inputClass}
        />
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      <footer className="border-t border-rule px-4 py-3">
        <button
          type="button"
          disabled={busy || !label.trim() || !relay.trim() || !nsec.trim()}
          className="w-full rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          onClick={() => void add()}
        >
          {busy ? "Saving…" : "Add connection"}
        </button>
      </footer>
    </div>
  );
}
