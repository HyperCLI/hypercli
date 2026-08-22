import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type BuzzConnectionMetadata,
  type VisibleChannel,
  createAgent,
  createBuzzAgent,
  draftAgentPrompt,
  listBuzzChannels,
  listBuzzConnections,
} from "./api";

const RUNTIMES = [
  { id: "openclaw", label: "OpenClaw", buzz: false },
  { id: "openclaw-pro", label: "OpenClaw Pro (desktop)", buzz: false },
  { id: "buzz-agent", label: "Buzz Agent", buzz: true },
  { id: "opencode", label: "OpenCode", buzz: true },
  { id: "claude-code", label: "Claude Code", buzz: true },
  { id: "codex", label: "Codex", buzz: true },
  { id: "goose", label: "Goose", buzz: true },
  { id: "kimi-code", label: "Kimi Code", buzz: true },
] as const;

const inputClass =
  "w-full rounded-md border border-rule-strong bg-raised px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-dim focus:border-brand";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-wide text-ink-dim uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

export default function CreateWindow({
  onOpenConnections,
}: {
  onOpenConnections: () => void;
}) {
  const [runtime, setRuntime] = useState<string>("openclaw");
  const [name, setName] = useState("");
  const [size, setSize] = useState("small");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState("");
  const [concurrency, setConcurrency] = useState("");
  const [connections, setConnections] = useState<BuzzConnectionMetadata[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [channels, setChannels] = useState<VisibleChannel[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [respondTo, setRespondTo] = useState("anyone");
  const [allowlist, setAllowlist] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isBuzz = RUNTIMES.find((entry) => entry.id === runtime)?.buzz ?? false;

  const refreshConnections = useCallback(async () => {
    try {
      const list = await listBuzzConnections();
      setConnections(list);
      setConnectionId((current) =>
        list.some((connection) => connection.id === current)
          ? current
          : (list[0]?.id ?? ""),
      );
    } catch (loadError) {
      setError(String(loadError));
    }
  }, []);

  useEffect(() => {
    if (isBuzz) void refreshConnections();
  }, [isBuzz, refreshConnections]);

  useEffect(() => {
    const unlisteners = [
      listen("buzz-connections-changed", () => void refreshConnections()),
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) void refreshConnections();
      }),
    ];
    return () => {
      for (const pending of unlisteners) {
        void pending.then((unlisten) => unlisten());
      }
    };
  }, [refreshConnections]);

  useEffect(() => {
    if (!isBuzz || !connectionId) {
      setChannels([]);
      return;
    }
    let cancelled = false;
    listBuzzChannels(connectionId)
      .then((list) => {
        if (cancelled) return;
        setChannels(list);
        setSelectedChannels((current) =>
          current.filter((id) => list.some((channel) => channel.id === id)),
        );
      })
      .catch((loadError) => {
        if (!cancelled) setError(String(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [isBuzz, connectionId]);

  const draft = async () => {
    const keywords = (instructions.trim() || name.trim()).slice(0, 1000);
    if (keywords.length < 2) {
      setError("Describe the agent (or name it) first, then draft.");
      return;
    }
    setDrafting(true);
    setError(null);
    try {
      setInstructions(await draftAgentPrompt(keywords));
    } catch (draftError) {
      setError(String(draftError));
    } finally {
      setDrafting(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isBuzz) {
        const parsedConcurrency = Number.parseInt(concurrency, 10);
        await createBuzzAgent({
          name: name.trim(),
          instructions: instructions.trim() || null,
          runtime,
          size: size || null,
          model: model.trim() || null,
          concurrency: Number.isInteger(parsedConcurrency)
            ? parsedConcurrency
            : null,
          connection_id: connectionId,
          channels: selectedChannels,
          respond_to: respondTo,
          allowlist: allowlist
            .split("\n")
            .map((entry) => entry.trim())
            .filter(Boolean),
        });
      } else {
        await createAgent({
          name: name.trim() || null,
          size,
          desktop: runtime === "openclaw-pro",
        });
      }
      await getCurrentWindow().close();
    } catch (createError) {
      setError(String(createError));
      setBusy(false);
    }
  };

  const canSubmit =
    !busy && name.trim().length > 0 && (!isBuzz || connectionId !== "");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <Field label="Runtime">
          <select
            value={runtime}
            onChange={(event) => setRuntime(event.target.value)}
            className={inputClass}
          >
            {RUNTIMES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={isBuzz ? "e.g. triage-bot" : "Auto-generated if blank"}
            maxLength={isBuzz ? 32 : 64}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className={inputClass}
          />
        </Field>

        <Field label="Size">
          <select
            value={size}
            onChange={(event) => setSize(event.target.value)}
            className={inputClass}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </Field>

        <Field label="Prompt">
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="What should this agent do? Role, priorities, boundaries…"
            rows={4}
            className={`${inputClass} resize-none`}
          />
        </Field>
        <button
          type="button"
          disabled={drafting}
          className="flex items-center gap-1.5 self-start text-xs text-accent hover:text-brand-hover disabled:opacity-50"
          onClick={() => void draft()}
        >
          {drafting ? (
            <LoaderCircle size={13} className="animate-spin" />
          ) : (
            <Sparkles size={13} />
          )}
          {drafting ? "Drafting…" : "Draft for me"}
        </button>

        {isBuzz && (
          <>
            {connections.length === 0 ? (
              <button
                type="button"
                className="flex flex-col items-start gap-1 rounded-md border border-dashed border-rule-strong px-3 py-2.5 text-left hover:border-brand"
                onClick={onOpenConnections}
              >
                <span className="text-xs font-medium text-ink-secondary">
                  Add a Buzz connection
                </span>
                <span className="text-xs text-ink-dim">
                  Pair a relay with your owner nsec — it stays in your keychain
                  and never leaves this machine.
                </span>
              </button>
            ) : (
              <>
                <Field label="Buzz connection">
                  <select
                    value={connectionId}
                    onChange={(event) => setConnectionId(event.target.value)}
                    className={inputClass}
                  >
                    {connections.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {channels.length > 0 && (
                  <Field label="Channels (optional — none means DM-only)">
                    <div className="flex max-h-24 flex-col gap-1 overflow-y-auto rounded-md border border-rule p-2">
                      {channels.map((channel) => (
                        <label
                          key={channel.id}
                          className="flex items-center gap-2 text-xs text-ink-secondary"
                        >
                          <input
                            type="checkbox"
                            checked={selectedChannels.includes(channel.id)}
                            onChange={(event) =>
                              setSelectedChannels((current) =>
                                event.target.checked
                                  ? [...current, channel.id]
                                  : current.filter((id) => id !== channel.id),
                              )
                            }
                            className="accent-brand"
                          />
                          <span className="truncate">
                            {channel.name}
                            {channel.is_private ? " · private" : ""}
                          </span>
                        </label>
                      ))}
                    </div>
                  </Field>
                )}
                <Field label="Model (optional)">
                  <input
                    type="text"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="Default"
                    list="buzz-model-suggestions"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    className={inputClass}
                  />
                  <datalist id="buzz-model-suggestions">
                    <option value="kimi-k3-anthropic" />
                    <option value="kimi-k3" />
                    <option value="kimi-k2.6-anthropic" />
                    <option value="kimi-k2.6" />
                    <option value="glm-5" />
                  </datalist>
                </Field>
                <Field label="Concurrency">
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={concurrency}
                    onChange={(event) => setConcurrency(event.target.value)}
                    placeholder="Auto"
                    className={inputClass}
                  />
                </Field>
                <Field label="Responds to">
                  <select
                    value={respondTo}
                    onChange={(event) => setRespondTo(event.target.value)}
                    className={inputClass}
                  >
                    <option value="anyone">Anyone</option>
                    <option value="owner-only">Owner only</option>
                    <option value="allowlist">Selected people</option>
                  </select>
                </Field>
                {respondTo === "allowlist" && (
                  <Field label="Allowed people">
                    <textarea
                      value={allowlist}
                      onChange={(event) => setAllowlist(event.target.value)}
                      placeholder="One npub or nickname per line"
                      rows={2}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      className={`${inputClass} resize-none`}
                    />
                  </Field>
                )}
              </>
            )}
            <button
              type="button"
              className="self-start text-xs text-accent hover:text-brand-hover"
              onClick={onOpenConnections}
            >
              Manage Buzz connections
            </button>
          </>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      <footer className="flex gap-2 border-t border-rule px-4 py-3">
        <button
          type="button"
          disabled={!canSubmit}
          className="flex-1 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          onClick={() => void submit()}
        >
          {busy ? "Creating…" : "Create agent"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg bg-surface px-4 py-1.5 text-sm text-ink-secondary hover:bg-raised"
          onClick={() => void getCurrentWindow().close()}
        >
          Cancel
        </button>
      </footer>
    </div>
  );
}
