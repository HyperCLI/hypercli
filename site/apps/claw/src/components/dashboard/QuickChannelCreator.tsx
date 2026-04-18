"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Hash, ChevronDown, Bot, User, Check } from "lucide-react";
import { agentAvatar } from "@/lib/avatar";
import type { Participant } from "./AgentsChannelsSidebar";

// ── Types ──

export interface QuickChannelCreatorProps {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string, agents: Participant[], users: Participant[]) => void;
  availableAgents: Participant[];
  availableUsers: Participant[];
}

// ── Single-select dropdown ──

function SingleSelect({
  label,
  icon: Icon,
  available,
  selectedId,
  onSelect,
  placeholder,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  available: Participant[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = available.find((p) => p.id === selectedId);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2.5 py-2 bg-surface-low border border-border rounded-lg text-xs text-foreground hover:border-border-strong transition-colors"
      >
        <span className={selected ? "text-foreground" : "text-text-muted"}>
          {selected ? selected.name : placeholder}
        </span>
        <ChevronDown className={`w-3 h-3 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 bottom-full mb-1 z-50 rounded-lg border border-border bg-[#1a1a1c] shadow-xl overflow-hidden max-h-48 overflow-y-auto"
          >
            {available.length === 0 ? (
              <p className="px-3 py-2 text-[10px] text-text-muted">No {label.toLowerCase()} available</p>
            ) : (
              available.map((p) => {
                const isSelected = p.id === selectedId;
                const isAgent = p.type === "agent";
                const av = isAgent ? agentAvatar(p.name) : null;
                const AvIcon = av?.icon;

                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      onSelect(isSelected ? null : p.id);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-surface-low transition-colors"
                  >
                    <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-colors ${
                      isSelected ? "bg-[#38D39F] border-[#38D39F]" : "border-text-muted"
                    }`}>
                      {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    {isAgent && av && AvIcon ? (
                      <div
                        className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: av.bgColor }}
                      >
                        <AvIcon className="w-3 h-3" style={{ color: av.fgColor }} />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded bg-surface-low flex items-center justify-center flex-shrink-0">
                        <User className="w-3 h-3 text-text-muted" />
                      </div>
                    )}
                    <span className={`text-[11px] truncate ${isSelected ? "text-foreground" : "text-text-muted"}`}>
                      {p.name}
                    </span>
                  </button>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Multi-select dropdown ──

function MultiSelect({
  label,
  available,
  selected,
  onToggle,
  placeholder,
}: {
  label: string;
  available: Participant[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selectedCount = available.filter((p) => selected.has(p.id)).length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2.5 py-2 bg-surface-low border border-border rounded-lg text-xs text-foreground hover:border-border-strong transition-colors"
      >
        <span className={selectedCount > 0 ? "text-foreground" : "text-text-muted"}>
          {selectedCount > 0
            ? `${selectedCount} selected`
            : placeholder}
        </span>
        <ChevronDown className={`w-3 h-3 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 bottom-full mb-1 z-50 rounded-lg border border-border bg-[#1a1a1c] shadow-xl overflow-hidden max-h-48 overflow-y-auto"
          >
            {available.length === 0 ? (
              <p className="px-3 py-2 text-[10px] text-text-muted">No {label.toLowerCase()} available</p>
            ) : (
              available.map((p) => {
                const isSelected = selected.has(p.id);

                return (
                  <button
                    key={p.id}
                    onClick={() => onToggle(p.id)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-surface-low transition-colors"
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                      isSelected ? "bg-[#38D39F] border-[#38D39F]" : "border-text-muted"
                    }`}>
                      {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <div className="w-5 h-5 rounded bg-surface-low flex items-center justify-center flex-shrink-0">
                      <User className="w-3 h-3 text-text-muted" />
                    </div>
                    <span className={`text-[11px] truncate ${isSelected ? "text-foreground" : "text-text-muted"}`}>
                      {p.name}
                    </span>
                  </button>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main component ──

export function QuickChannelCreator({
  open,
  onClose,
  onCreated,
  availableAgents,
  availableUsers,
}: QuickChannelCreatorProps) {
  const [name, setName] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());

  const toggleUser = (id: string) => {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const canCreate = name.trim().length > 0 && (selectedAgentId !== null || selectedUsers.size > 0);

  const handleCreate = () => {
    if (!canCreate) return;
    const agents = selectedAgentId ? availableAgents.filter((a) => a.id === selectedAgentId) : [];
    const users = availableUsers.filter((u) => selectedUsers.has(u.id));
    onCreated(name.trim(), agents, users);
    setName("");
    setSelectedAgentId(null);
    setSelectedUsers(new Set());
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="px-3 py-3 space-y-2.5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">New Channel</span>
              <button
                onClick={onClose}
                className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-foreground transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Name input */}
            <div className="flex items-center gap-2">
              <Hash className="w-4 h-4 text-text-muted flex-shrink-0" />
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Channel name..."
                className="flex-1 min-w-0 bg-surface-low border border-border rounded-lg px-2.5 py-2 text-xs text-foreground placeholder-text-muted focus:outline-none focus:border-[#38D39F]/40"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") onClose();
                }}
              />
            </div>

            {/* Agent picker (single select) */}
            <div className="space-y-1">
              <p className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1">
                <Bot className="w-3 h-3" /> Agent
              </p>
              <SingleSelect
                label="Agents"
                icon={Bot}
                available={availableAgents}
                selectedId={selectedAgentId}
                onSelect={setSelectedAgentId}
                placeholder="Select an agent..."
              />
            </div>

            {/* Users picker (multi select) */}
            <div className="space-y-1">
              <p className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1">
                <User className="w-3 h-3" /> Users
              </p>
              <MultiSelect
                label="Users"
                available={availableUsers}
                selected={selectedUsers}
                onToggle={toggleUser}
                placeholder="Select users..."
              />
            </div>

            {/* Create button */}
            <motion.button
              whileHover={canCreate ? { scale: 1.02 } : undefined}
              whileTap={canCreate ? { scale: 0.97 } : undefined}
              disabled={!canCreate}
              onClick={handleCreate}
              className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[#6b9eff]/15 text-[#6b9eff] border border-[#6b9eff]/20 hover:border-[#6b9eff]/40"
            >
              <Hash className="w-3.5 h-3.5" />
              <span>Create Channel</span>
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
