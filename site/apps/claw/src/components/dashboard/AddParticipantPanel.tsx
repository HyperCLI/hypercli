"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, Check, Bot, User, UserPlus } from "lucide-react";
import { agentAvatar } from "@/lib/avatar";
import type { Participant } from "./AgentsChannelsSidebar";

interface AddParticipantPanelProps {
  currentParticipants: Participant[];
  allParticipants: Participant[];
  onAdd: (participant: Participant) => void;
  onClose: () => void;
  isGroup?: boolean;
}

export function AddParticipantPanel({
  currentParticipants,
  allParticipants,
  onAdd,
  onClose,
  isGroup = false,
}: AddParticipantPanelProps) {
  const [search, setSearch] = useState("");
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());

  const currentIds = useMemo(
    () => new Set(currentParticipants.map((p) => p.id)),
    [currentParticipants],
  );

  const available = useMemo(() => {
    const list = allParticipants.filter((p) => !currentIds.has(p.id));
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [allParticipants, currentIds, search]);

  const hasAgent = useMemo(
    () => currentParticipants.some((p) => p.type === "agent"),
    [currentParticipants],
  );
  // No agent yet: show only agents. Once an agent is added: show only users.
  const agents = useMemo(
    () => hasAgent ? [] : available.filter((p) => p.type === "agent"),
    [available, hasAgent],
  );
  const users = useMemo(
    () => hasAgent ? available.filter((p) => p.type === "user") : [],
    [available, hasAgent],
  );

  const handleAdd = (participant: Participant) => {
    setRecentlyAdded((prev) => new Set(prev).add(participant.id));
    onAdd(participant);
    // Brief checkmark feedback before item animates out
    setTimeout(() => {
      setRecentlyAdded((prev) => {
        const next = new Set(prev);
        next.delete(participant.id);
        return next;
      });
    }, 600);
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />

      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute top-full right-0 mt-1 z-50 w-64 rounded-xl border border-border bg-[#111113] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <div className="flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5 text-[#38D39F]" />
            <span className="text-xs font-semibold text-foreground">Add to conversation</span>
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search participants..."
              className="w-full bg-surface-low border border-border rounded-md pl-7 pr-2.5 py-1.5 text-xs text-foreground placeholder-text-muted focus:outline-none focus:border-border-strong"
            />
          </div>
        </div>

        {/* List */}
        <div className="max-h-64 overflow-y-auto py-1">
          {agents.length === 0 && users.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-text-muted">
              <Check className="w-5 h-5 mb-1.5 text-[#38D39F]" />
              <p className="text-[11px]">Everyone is already in this conversation</p>
            </div>
          )}

          {/* Agents section */}
          {agents.length > 0 && (
            <>
              <div className="px-3 pt-1.5 pb-1">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted/60">Agents</span>
              </div>
              <AnimatePresence mode="popLayout">
                {agents.map((participant) => {
                  const avatar = agentAvatar(participant.name);
                  const Icon = avatar.icon;
                  const justAdded = recentlyAdded.has(participant.id);

                  return (
                    <motion.button
                      key={participant.id}
                      layout
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 12, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                      transition={{ duration: 0.2 }}
                      onClick={() => handleAdd(participant)}
                      disabled={justAdded}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-surface-low/50 transition-colors disabled:opacity-60"
                    >
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: avatar.bgColor }}
                      >
                        <Icon className="w-3 h-3" style={{ color: avatar.fgColor }} />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <span className="text-xs text-foreground truncate block">{participant.name}</span>
                      </div>
                      <motion.div
                        className="flex-shrink-0"
                        animate={justAdded ? { scale: [1, 1.3, 1] } : {}}
                        transition={{ duration: 0.3 }}
                      >
                        {justAdded ? (
                          <Check className="w-3.5 h-3.5 text-[#38D39F]" />
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#38D39F]/10 text-[#38D39F] font-medium hover:bg-[#38D39F]/20 transition-colors">
                            Add
                          </span>
                        )}
                      </motion.div>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </>
          )}

          {/* Users section */}
          {users.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted/60">Users</span>
              </div>
              <AnimatePresence mode="popLayout">
                {users.map((participant) => {
                  const justAdded = recentlyAdded.has(participant.id);

                  return (
                    <motion.button
                      key={participant.id}
                      layout
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 12, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                      transition={{ duration: 0.2 }}
                      onClick={() => handleAdd(participant)}
                      disabled={justAdded}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-surface-low/50 transition-colors disabled:opacity-60"
                    >
                      <div className="w-6 h-6 rounded-full bg-surface-low flex items-center justify-center flex-shrink-0">
                        <User className="w-3 h-3 text-text-muted" />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <span className="text-xs text-foreground truncate block">{participant.name}</span>
                      </div>
                      <motion.div
                        className="flex-shrink-0"
                        animate={justAdded ? { scale: [1, 1.3, 1] } : {}}
                        transition={{ duration: 0.3 }}
                      >
                        {justAdded ? (
                          <Check className="w-3.5 h-3.5 text-[#38D39F]" />
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#38D39F]/10 text-[#38D39F] font-medium hover:bg-[#38D39F]/20 transition-colors">
                            Add
                          </span>
                        )}
                      </motion.div>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </>
          )}
        </div>

        {/* Footer — current participant count */}
        <div className="px-3 py-2 border-t border-border">
          <span className="text-[10px] text-text-muted">
            {currentParticipants.length} participant{currentParticipants.length !== 1 ? "s" : ""} in conversation
          </span>
        </div>
      </motion.div>
    </>
  );
}
