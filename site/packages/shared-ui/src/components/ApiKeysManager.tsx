"use client";

import { BrowserHyperCLI } from "@hypercli.com/sdk/browser";
import { Check, Copy, Key, Pencil, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { formatDateTime } from "../utils/datetime";

const FAMILY_OPTIONS = [
  { key: "api", label: "API Keys" },
  { key: "user", label: "Profile" },
  { key: "jobs", label: "Jobs" },
  { key: "renders", label: "Renders" },
  { key: "files", label: "Files" },
  { key: "agents", label: "Agents" },
] as const;

type FamilyKey = (typeof FAMILY_OPTIONS)[number]["key"];
type BaselineValue = "none" | "self" | "*";

const BASELINE_LABELS: Record<BaselineValue, string> = {
  none: "None",
  self: "Self",
  "*": "All",
};

const SELECTOR_TAG_RE = /^[A-Za-z0-9_+-]+=[A-Za-z0-9_+-]+$/;

const DEFAULT_BASELINES: Record<FamilyKey, BaselineValue> = {
  api: "*",
  user: "*",
  jobs: "*",
  renders: "*",
  files: "*",
  agents: "*",
};

export interface ApiKeysManagerProps {
  apiBaseUrl: string;
  getToken: () => Promise<string>;
  title?: string;
  description?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  cardClassName?: string;
  createButtonClassName?: string;
}

type ManagedApiKey = Awaited<ReturnType<BrowserHyperCLI["keys"]["get"]>>;

function normalizeApiUrl(apiBaseUrl: string): string {
  return apiBaseUrl.trim().replace(/\/+$/, "");
}

function splitTagInput(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function validateSelectorTags(tags: string[]): string[] {
  const seenKeys = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    if (!SELECTOR_TAG_RE.test(tag)) {
      throw new Error(
        `Invalid tag '${tag}'. Use key=value with letters, digits, '-', '_', or '+'.`
      );
    }
    const key = tag.split("=")[0]!;
    if (FAMILY_OPTIONS.some((family) => family.key === key)) {
      throw new Error(`Reserved family key '${key}' must use family:value baselines.`);
    }
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate tag key '${key}'.`);
    }
    seenKeys.add(key);
    normalized.push(tag);
  }

  return normalized.sort();
}

function buildTags(
  baselines: Record<FamilyKey, BaselineValue>,
  selectorInput: string
): string[] {
  const tags = FAMILY_OPTIONS.flatMap(({ key }) =>
    baselines[key] === "none" ? [] : [`${key}:${baselines[key]}`]
  );
  const selectors = validateSelectorTags(splitTagInput(selectorInput));
  return [...tags, ...selectors];
}

function statusLabel(key: ManagedApiKey): string {
  return key.isActive ? "Active" : "Inactive";
}

export function ApiKeysManager({
  apiBaseUrl,
  getToken,
  title = "API Keys",
  description = "Generate scoped API keys for apps and services.",
  emptyTitle = "No API keys yet",
  emptyDescription = "Create your first key to start using the API.",
  className,
  cardClassName = "bg-surface-low border border-border rounded-lg overflow-hidden",
  createButtonClassName = "bg-primary text-primary-foreground font-semibold py-2 px-6 rounded-lg hover:bg-primary-hover transition-colors cursor-pointer",
}: ApiKeysManagerProps) {
  const [keys, setKeys] = useState<ManagedApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [selectorInput, setSelectorInput] = useState("");
  const [baselines, setBaselines] = useState<Record<FamilyKey, BaselineValue>>(DEFAULT_BASELINES);
  const [createdKey, setCreatedKey] = useState<ManagedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);

  const clientFactory = useCallback(async () => {
    const token = await getToken();
    return new BrowserHyperCLI({
      apiUrl: normalizeApiUrl(apiBaseUrl),
      token,
    });
  }, [apiBaseUrl, getToken]);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = await clientFactory();
      setKeys(await client.keys.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, [clientFactory]);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  const effectiveTags = useMemo(() => {
    try {
      return buildTags(baselines, selectorInput);
    } catch {
      return [];
    }
  }, [baselines, selectorInput]);

  const resetCreateState = () => {
    setNewKeyName("");
    setSelectorInput("");
    setBaselines(DEFAULT_BASELINES);
  };

  const handleCreate = async () => {
    if (!newKeyName.trim()) {
      setError("Please enter a key name.");
      return;
    }

    let tags: string[];
    try {
      tags = buildTags(baselines, selectorInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid tag configuration");
      return;
    }

    if (tags.length === 0) {
      setError("Add at least one permission baseline or selector tag.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const client = await clientFactory();
      const key = await client.keys.create(newKeyName.trim(), tags);
      setCreatedKey(key);
      setShowCreate(false);
      resetCreateState();
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleDisable = async (keyId: string) => {
    if (!window.confirm("Deactivate this API key? This cannot be undone.")) {
      return;
    }
    setRevokingKeyId(keyId);
    setError(null);
    try {
      const client = await clientFactory();
      await client.keys.disable(keyId);
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate API key");
    } finally {
      setRevokingKeyId(null);
    }
  };

  const handleRename = async (keyId: string) => {
    if (!editName.trim()) {
      setError("Please enter a key name.");
      return;
    }
    setSavingName(true);
    setError(null);
    try {
      const client = await clientFactory();
      await client.keys.rename(keyId, editName.trim());
      setEditingKeyId(null);
      setEditName("");
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename API key");
    } finally {
      setSavingName(false);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground mt-2">{description}</p>
          ) : null}
        </div>
        <button onClick={() => setShowCreate(true)} className={createButtonClassName}>
          <span className="inline-flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Create Key
          </span>
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {createdKey ? (
        <div className="mb-6 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
          <p className="text-sm font-medium text-foreground mb-2">
            API key created. Copy it now, it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg bg-background px-3 py-2 text-sm text-foreground">
              {createdKey.apiKey}
            </code>
            <button
              onClick={() => createdKey.apiKey && handleCopy(createdKey.apiKey)}
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-background"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      ) : null}

      <div className={cardClassName}>
        {loading ? (
          <div className="px-6 py-8 text-sm text-muted-foreground">Loading API keys...</div>
        ) : keys.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Key className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-foreground">{emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-background">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Key</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tags</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Created</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last Used</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface-low">
                {keys.map((key) => {
                  const isEditing = editingKeyId === key.keyId;
                  return (
                    <tr key={key.keyId} className="hover:bg-surface-medium/50">
                      <td className="px-6 py-4 text-sm text-foreground">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <input
                              value={editName}
                              onChange={(event) => setEditName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void handleRename(key.keyId);
                                if (event.key === "Escape") {
                                  setEditingKeyId(null);
                                  setEditName("");
                                }
                              }}
                              className="w-48 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                              autoFocus
                              disabled={savingName}
                            />
                            <button
                              onClick={() => void handleRename(key.keyId)}
                              className="text-foreground hover:text-primary disabled:opacity-50"
                              disabled={savingName}
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                setEditingKeyId(null);
                                setEditName("");
                              }}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          key.name
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm font-mono text-muted-foreground">
                        {key.apiKeyPreview ?? key.last4 ?? "—"}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex max-w-md flex-wrap gap-2">
                          {key.tags.length > 0 ? key.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
                            >
                              {tag}
                            </span>
                          )) : <span className="text-sm text-muted-foreground">No tags</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                            key.isActive
                              ? "bg-emerald-500/10 text-emerald-300"
                              : "bg-zinc-500/10 text-zinc-400"
                          }`}
                        >
                          {statusLabel(key)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {formatDateTime(key.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {formatDateTime(key.lastUsedAt)}
                      </td>
                      <td className="px-6 py-4 text-right text-sm">
                        <div className="inline-flex items-center gap-3">
                          <button
                            onClick={() => {
                              setEditingKeyId(key.keyId);
                              setEditName(key.name);
                            }}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="w-3 h-3" />
                            Rename
                          </button>
                          {key.isActive ? (
                            <button
                              onClick={() => void handleDisable(key.keyId)}
                              disabled={revokingKeyId === key.keyId}
                              className="text-red-300 hover:text-red-200 disabled:opacity-50"
                            >
                              Revoke
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={showCreate}
        onClose={() => {
          setShowCreate(false);
          resetCreateState();
        }}
        title="Create API Key"
        maxWidth="3xl"
      >
        <div className="space-y-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">Key Name</label>
            <input
              type="text"
              value={newKeyName}
              onChange={(event) => setNewKeyName(event.target.value)}
              placeholder="e.g. frontend-prod"
              className="w-full rounded-lg border border-border bg-surface-low px-4 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              disabled={creating}
            />
          </div>

          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">Permissions</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {FAMILY_OPTIONS.map(({ key, label }) => (
                <label
                  key={key}
                  className="rounded-lg border border-border bg-surface-low p-3"
                >
                  <span className="mb-2 block text-sm font-medium text-foreground">{label}</span>
                  <select
                    value={baselines[key]}
                    onChange={(event) =>
                      setBaselines((current) => ({
                        ...current,
                        [key]: event.target.value as BaselineValue,
                      }))
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    disabled={creating}
                  >
                    {(["none", "self", "*"] as BaselineValue[]).map((value) => (
                      <option key={value} value={value}>
                        {BASELINE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Family baselines use the reserved `family:value` format such as `agents:self` or `jobs:*`.
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">Selector Tags</label>
            <textarea
              value={selectorInput}
              onChange={(event) => setSelectorInput(event.target.value)}
              placeholder={"team=dev\nproject=alpha"}
              className="min-h-28 w-full rounded-lg border border-border bg-surface-low px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              disabled={creating}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Use `key=value` tags only. Colons are reserved for family baselines.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-foreground">Resulting Tags</h3>
            <div className="flex min-h-16 flex-wrap gap-2 rounded-lg border border-border bg-background p-3">
              {effectiveTags.length > 0 ? (
                effectiveTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border bg-surface-low px-2 py-1 text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">No tags selected yet.</span>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => void handleCreate()}
              disabled={creating}
              className="flex-1 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Key"}
            </button>
            <button
              onClick={() => {
                setShowCreate(false);
                resetCreateState();
              }}
              disabled={creating}
              className="flex-1 rounded-lg border border-border px-4 py-2 font-semibold text-foreground hover:bg-surface-low"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default ApiKeysManager;
