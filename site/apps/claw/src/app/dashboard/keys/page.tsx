"use client";

import { useState, useEffect, useCallback } from "react";
import { Key, Plus, Copy, Check, Ban, Pencil, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { agentApiFetch } from "@/lib/api";
import { Skeleton, TableSkeleton } from "@/components/dashboard/Skeleton";

interface ApiKey {
  [k: string]: unknown;
}

export default function KeysPage() {
  const { getToken } = useAgentAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);

  // Created key reveal
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Edit state
  const [editingToken, setEditingToken] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await agentApiFetch<{ keys: ApiKey[] }>("/keys", token);
      setKeys(data.keys || []);
    } catch {
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    setError(null);

    try {
      const token = await getToken();
      const data = await agentApiFetch<{ key: string; key_alias: string }>(
        "/keys",
        token,
        {
          method: "POST",
          body: JSON.stringify({ name: newKeyName.trim() }),
        }
      );
      setCreatedKey(data.key);
      setShowCreate(false);
      setNewKeyName("");
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  };

  const handleDisableKey = async (keyRef: string) => {
    try {
      const token = await getToken();
      await agentApiFetch(`/keys/${keyRef}/disable`, token, { method: "POST" });
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable key");
    }
  };

  const handleSaveName = async (keyRef: string, currentMeta: Record<string, unknown>) => {
    if (!editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await agentApiFetch(`/keys/${keyRef}`, token, {
        method: "PUT",
        body: JSON.stringify({
          metadata: { ...currentMeta, name: editName.trim() },
        }),
      });
      setEditingToken(null);
      setEditName("");
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update key");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-foreground">API Keys</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Key
        </button>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="p-3 rounded-lg bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-sm text-[#d05f5f] flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-2 hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Created key reveal */}
      {createdKey && (
        <div className="mb-6 glass-card p-4 border-border-medium">
          <p className="text-sm text-foreground font-medium mb-2">
            API key created! Copy it now — it won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm text-foreground bg-surface-low px-3 py-2 rounded font-mono break-all">
              {createdKey}
            </code>
            <button
              onClick={() => handleCopy(createdKey)}
              className="btn-secondary p-2 rounded-lg"
            >
              {copied ? (
                <Check className="w-4 h-4 text-text-secondary" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
          <button
            onClick={() => setCreatedKey(null)}
            className="text-xs text-text-muted mt-2 hover:text-foreground transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Keys table */}
      <div className="glass-card overflow-auto max-h-[calc(100vh-16rem)]">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-6 py-4 flex items-center gap-4">
                <Skeleton className="w-28 h-4" />
                <Skeleton className="w-40 h-4" />
                <Skeleton className="w-16 h-5 rounded-full" />
                <Skeleton className="w-20 h-4" />
                <Skeleton className="w-16 h-4 ml-auto" />
              </div>
            ))}
          </div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center">
            <Key className="w-8 h-8 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary mb-1">No API keys yet</p>
            <p className="text-sm text-text-muted">
              Create your first key to start using the API.
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-text-muted uppercase px-6 py-3">
                  Name
                </th>
                <th className="text-left text-xs font-medium text-text-muted uppercase px-6 py-3">
                  Key
                </th>
                <th className="text-left text-xs font-medium text-text-muted uppercase px-6 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-text-muted uppercase px-6 py-3">
                  Created
                </th>
                <th className="text-right text-xs font-medium text-text-muted uppercase px-6 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {keys.map((key, i) => {
                const meta = (key.metadata as Record<string, unknown>) || {};
                const name = String(meta.name || key.key_alias || "Unnamed");
                const keyName = String(key.key_name || "—");
                const blocked = !!key.blocked;
                const token = key.token as string | undefined;
                const createdAt = key.created_at as string | undefined;
                const isEditing = !!token && editingToken === token;

                return (
                  <tr key={token || i} className="hover:bg-surface-low/50">
                    <td className="px-6 py-4 text-sm text-foreground">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && token) handleSaveName(token, meta);
                              if (e.key === "Escape") { setEditingToken(null); setEditName(""); }
                            }}
                            className="px-2 py-1 rounded bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
                            autoFocus
                            disabled={saving}
                          />
                          <button
                            onClick={() => token && handleSaveName(token, meta)}
                            disabled={saving || !editName.trim()}
                            className="text-text-secondary hover:text-foreground disabled:opacity-50"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setEditingToken(null); setEditName(""); }}
                            className="text-text-muted hover:text-foreground"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        name
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-muted font-mono">
                      {keyName}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                          blocked
                            ? "bg-[#d05f5f]/10 text-[#d05f5f]"
                            : "bg-[#38D39F]/10 text-[#38D39F]"
                        }`}
                      >
                        {blocked ? "Disabled" : "Active"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-text-muted">
                      {createdAt
                        ? new Date(createdAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {token && (
                        <div className="inline-flex items-center gap-3">
                          <button
                            onClick={() => {
                              setEditingToken(token);
                              setEditName(name === "Unnamed" ? "" : name);
                            }}
                            className="text-sm text-text-tertiary hover:text-foreground transition-colors inline-flex items-center gap-1"
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </button>
                          {!blocked && (
                            <button
                              onClick={() => handleDisableKey(token)}
                              className="text-sm text-text-tertiary hover:text-[#d05f5f] transition-colors inline-flex items-center gap-1"
                            >
                              <Ban className="w-3 h-3" /> Revoke
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Create API Key
            </h2>
            <input
              type="text"
              placeholder="Key name (e.g. production-agent)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm placeholder:text-text-muted focus:outline-none focus:border-border-strong mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowCreate(false);
                  setNewKeyName("");
                }}
                className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newKeyName.trim()}
                className="btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
