"use client";

import { useState, useEffect, useCallback } from "react";
import { Key, Plus, Copy, Check, Ban, Play } from "lucide-react";
import { useClawAuth } from "@/hooks/useClawAuth";
import { clawFetch } from "@/lib/api";

interface ApiKey {
  token: string;
  key_alias: string;
  key_name: string;
  blocked: boolean;
  created_at: string;
  last_used?: string;
}

export default function KeysPage() {
  const { getToken } = useClawAuth();
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

  const fetchKeys = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await clawFetch<{ keys: ApiKey[] }>("/keys", token);
      setKeys(data.keys || []);
    } catch {
      // Backend may be stubbed
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
      const data = await clawFetch<{ key: string; key_alias: string }>(
        "/keys",
        token,
        {
          method: "POST",
          body: JSON.stringify({ key_alias: newKeyName.trim() }),
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

  const handleToggleKey = async (keyRef: string, blocked: boolean) => {
    try {
      const token = await getToken();
      const action = blocked ? "enable" : "disable";
      await clawFetch(`/keys/${keyRef}/${action}`, token, { method: "POST" });
      fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update key");
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

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-sm text-[#d05f5f]">
          {error}
        </div>
      )}

      {/* Created key reveal */}
      {createdKey && (
        <div className="mb-6 glass-card p-4 border-[#38D39F]/30">
          <p className="text-sm text-primary font-medium mb-2">
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
                <Check className="w-4 h-4 text-primary" />
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
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted">Loading...</div>
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
              {keys.map((key) => (
                <tr key={key.token} className="hover:bg-surface-low/50">
                  <td className="px-6 py-4 text-sm text-foreground">
                    {key.key_alias || key.key_name || "Unnamed"}
                  </td>
                  <td className="px-6 py-4 text-sm text-text-muted font-mono">
                    {key.token.slice(0, 8)}...{key.token.slice(-4)}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                        key.blocked
                          ? "bg-[#d05f5f]/10 text-[#d05f5f]"
                          : "bg-[#38D39F]/10 text-primary"
                      }`}
                    >
                      {key.blocked ? "Disabled" : "Active"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-text-muted">
                    {new Date(key.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() =>
                        handleToggleKey(key.token, key.blocked)
                      }
                      className="text-sm text-text-tertiary hover:text-foreground transition-colors inline-flex items-center gap-1"
                    >
                      {key.blocked ? (
                        <>
                          <Play className="w-3 h-3" /> Enable
                        </>
                      ) : (
                        <>
                          <Ban className="w-3 h-3" /> Disable
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
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
              className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm placeholder:text-text-muted focus:outline-none focus:border-primary mb-4"
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
