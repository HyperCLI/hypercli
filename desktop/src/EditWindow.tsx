import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";
import { type AgentEditConfig, getAgentEditConfig, updateAgent } from "./api";

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

export default function EditWindow({ agentId }: { agentId: string }) {
  const [config, setConfig] = useState<AgentEditConfig | null>(null);
  const [name, setName] = useState("");
  const [size, setSize] = useState("small");
  const [model, setModel] = useState("");
  const [instructions, setInstructions] = useState("");
  const [concurrency, setConcurrency] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const loaded = await getAgentEditConfig(agentId);
      setConfig(loaded);
      setName(loaded.name);
      setSize(loaded.size ?? "small");
      setModel(loaded.model ?? "");
      setInstructions(loaded.instructions ?? "");
      setConcurrency(
        loaded.concurrency === null ? "" : String(loaded.concurrency),
      );
    } catch (loadError) {
      setError(String(loadError));
    }
  }, [agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      const parsedConcurrency = Number.parseInt(concurrency, 10);
      await updateAgent(agentId, {
        name: name.trim(),
        size,
        model: config.is_buzz ? model.trim() : null,
        instructions: config.is_buzz ? instructions : null,
        concurrency: config.is_buzz
          ? Number.isInteger(parsedConcurrency)
            ? parsedConcurrency
            : null
          : null,
      });
      await getCurrentWindow().close();
    } catch (saveError) {
      setError(String(saveError));
      setBusy(false);
    }
  };

  if (!config) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6">
        {error ? (
          <p className="text-xs text-danger">{error}</p>
        ) : (
          <p className="text-xs text-ink-dim">Loading…</p>
        )}
      </div>
    );
  }

  const canSubmit = config.editable && !busy && name.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {!config.editable && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            This agent is {config.state}. Stop it to edit its configuration.
          </p>
        )}

        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
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

        {config.is_buzz && (
          <>
            <Field label="Model (blank resets to default)">
              <input
                type="text"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="default"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className={inputClass}
              />
            </Field>

            <Field label="Prompt">
              <textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="What should this agent do? Role, priorities, boundaries…"
                rows={5}
                className={`${inputClass} resize-none`}
              />
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
          {busy ? "Saving…" : "Save changes"}
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
