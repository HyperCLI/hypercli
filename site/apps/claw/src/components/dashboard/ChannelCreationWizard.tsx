"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Hash, X, Loader2, Search } from "lucide-react";
import type { Participant } from "./AgentsChannelsSidebar";

export interface ChannelDraft {
  name: string;
  description: string;
  agent: Participant | null;
  users: Participant[];
}

export interface ChannelCreationWizardProps {
  open: boolean;
  onClose: () => void;
  /** Called with the channel draft. Should resolve when creation is done. */
  onCreate: (channel: ChannelDraft) => Promise<void> | void;
  availableAgents: Participant[];
  availableUsers: Participant[];
}

export function ChannelCreationWizard({
  open,
  onClose,
  onCreate,
  availableAgents,
  availableUsers,
}: ChannelCreationWizardProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setDescription("");
    setSelectedAgentId(null);
    setSelectedUserIds(new Set());
    setSearch("");
    setError(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const toggleUser = (id: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return availableAgents;
    return availableAgents.filter((a) => a.name.toLowerCase().includes(q));
  }, [availableAgents, search]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return availableUsers;
    return availableUsers.filter((u) => u.name.toLowerCase().includes(q));
  }, [availableUsers, search]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Channel name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const agent = availableAgents.find((a) => a.id === selectedAgentId) ?? null;
      const users = availableUsers.filter((u) => selectedUserIds.has(u.id));
      await onCreate({ name: trimmed, description: description.trim(), agent, users });
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="mx-4 w-full max-w-md overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15">
                  <Hash className="h-4 w-4 text-primary" />
                </div>
                <h2 className="text-sm font-semibold text-foreground">New Channel</h2>
              </div>
              <button
                onClick={handleClose}
                disabled={submitting}
                className="text-text-muted hover:text-foreground transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Channel name</label>
                <input
                  autoFocus
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. project-alpha"
                  disabled={submitting}
                  className="w-full rounded-md border border-border bg-surface-low px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:border-border-strong focus:outline-none disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this channel for? (optional)"
                  disabled={submitting}
                  rows={2}
                  className="w-full resize-none rounded-md border border-border bg-surface-low px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:border-border-strong focus:outline-none disabled:opacity-50"
                />
              </div>

              {(availableAgents.length > 0 || availableUsers.length > 0) && (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search agents and users..."
                    disabled={submitting}
                    className="w-full rounded-md border border-border bg-surface-low py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-text-muted focus:border-border-strong focus:outline-none disabled:opacity-50"
                  />
                </div>
              )}

              {availableAgents.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    Agent {selectedAgentId && <span className="text-text-muted">· 1 selected</span>}
                  </label>
                  <div className="space-y-1 max-h-40 overflow-y-auto rounded-md border border-border bg-surface-low/30 p-1">
                    {filteredAgents.length === 0 ? (
                      <div className="px-2 py-2 text-[11px] text-text-muted">No matching agents</div>
                    ) : filteredAgents.map((a) => {
                      const selected = selectedAgentId === a.id;
                      return (
                        <button
                          key={a.id}
                          onClick={() => setSelectedAgentId(selected ? null : a.id)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors text-left text-xs ${
                            selected ? "bg-selection-accent/10 text-foreground" : "text-text-muted hover:bg-surface-low hover:text-foreground"
                          }`}
                        >
                          <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                            selected ? "border-selection-accent bg-selection-accent" : "border-text-muted"
                          }`}>
                            {selected && <span className="h-1.5 w-1.5 rounded-full bg-selection-accent-foreground" />}
                          </div>
                          <span>{a.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {availableUsers.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    Users ({selectedUserIds.size})
                  </label>
                  <div className="space-y-1 max-h-40 overflow-y-auto rounded-md border border-border bg-surface-low/30 p-1">
                    {filteredUsers.length === 0 ? (
                      <div className="px-2 py-2 text-[11px] text-text-muted">No matching users</div>
                    ) : filteredUsers.map((u) => {
                      const selected = selectedUserIds.has(u.id);
                      return (
                        <button
                          key={u.id}
                          onClick={() => toggleUser(u.id)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors text-left text-xs ${
                            selected ? "bg-primary/10 text-foreground" : "text-text-muted hover:bg-surface-low hover:text-foreground"
                          }`}
                        >
                          <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                            selected ? "border-primary bg-primary" : "border-text-muted"
                          }`}>
                            {selected && <span className="text-[8px] text-primary-foreground">✓</span>}
                          </div>
                          <span>{u.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-surface-low/30">
              <button
                onClick={handleClose}
                disabled={submitting}
                className="px-3 py-1.5 rounded-md text-xs text-text-muted hover:text-foreground hover:bg-surface-low transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting || !name.trim()}
                className="btn-primary px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
                Create channel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
