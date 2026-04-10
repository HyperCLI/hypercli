"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Users,
  Bot,
  User,
  X,
  Trash2,
  Play,
  AlertTriangle,
  PenLine,
  SlidersHorizontal,
  Check,
} from "lucide-react";
import { agentAvatar } from "@/lib/avatar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@hypercli/shared-ui";
import { AgentCardTooltip } from "./modules/AgentCardModule";
import { QuickAgentCreator } from "./QuickAgentCreator";

// ── Types ──

export interface Participant {
  id: string;
  name: string;
  type: "user" | "agent";
}

export interface ConversationThread {
  id: string;
  sessionKey: string;
  participants: Participant[];
  kind: "user-agent" | "agent-agent" | "group";
  title?: string;
  lastMessage: string;
  lastMessageBy: string;
  lastMessageAt: number;
  messageCount: number;
  unreadCount: number;
  isActive: boolean;
}

export type ConversationsSidebarVariant = "v1" | "v2" | "v3" | "v3.1";

export interface ConversationsSidebarProps {
  variant: ConversationsSidebarVariant;
  threads: ConversationThread[];
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread?: () => void;
  onStartAgentChat?: (agent: Participant) => void;
  onDeleteThread?: (threadId: string) => void;
  onRenameThread?: (threadId: string, title: string) => void;
}

// ── Mock Data ──

export const MOCK_PARTICIPANTS: Participant[] = [
  { id: "user-1", name: "You", type: "user" },
  { id: "user-francisco", name: "Francisco", type: "user" },
  { id: "user-damian", name: "Damian", type: "user" },
  { id: "user-myo", name: "Myo", type: "user" },
  { id: "user-sam", name: "Sam", type: "user" },
  { id: "user-dimitry", name: "Dimitry", type: "user" },
  { id: "agent-research", name: "research-bot", type: "agent" },
  { id: "agent-code", name: "code-bot", type: "agent" },
  { id: "agent-data", name: "data-bot", type: "agent" },
  { id: "agent-deploy", name: "deploy-bot", type: "agent" },
  { id: "agent-writer", name: "writer-bot", type: "agent" },
  { id: "agent-qa", name: "qa-bot", type: "agent" },
  { id: "agent-design", name: "design-bot", type: "agent" },
  { id: "agent-ops", name: "ops-bot", type: "agent" },
  { id: "agent-security", name: "security-bot", type: "agent" },
];

const p = (id: string) => MOCK_PARTICIPANTS.find((p) => p.id === id)!;

export const MOCK_CONVERSATION_THREADS: ConversationThread[] = [
  {
    id: "t1",
    sessionKey: "session-research-1",
    participants: [p("user-1"), p("agent-research")],
    kind: "user-agent",
    lastMessage: "Can you analyze the latest quarterly report and summarize the key findings?",
    lastMessageBy: "user-1",
    lastMessageAt: Date.now() - 2 * 60_000,
    messageCount: 14,
    unreadCount: 3,
    isActive: true,
  },
  {
    id: "t2",
    sessionKey: "session-code-research",
    participants: [p("agent-code"), p("agent-research")],
    kind: "agent-agent",
    lastMessage: "The API endpoint at /v2/ingest needs the schema validated before we push the migration.",
    lastMessageBy: "agent-code",
    lastMessageAt: Date.now() - 60 * 60_000,
    messageCount: 28,
    unreadCount: 1,
    isActive: true,
  },
  {
    id: "t3",
    sessionKey: "session-project-alpha",
    participants: [p("user-1"), p("agent-research"), p("agent-data")],
    kind: "group",
    title: "Project Alpha",
    lastMessage: "Here are the cleaned datasets. I've flagged 3 anomalies in the Q4 batch.",
    lastMessageBy: "agent-data",
    lastMessageAt: Date.now() - 3 * 60 * 60_000,
    messageCount: 42,
    unreadCount: 0,
    isActive: false,
  },
  {
    id: "t4",
    sessionKey: "session-deploy-1",
    participants: [p("user-1"), p("agent-deploy")],
    kind: "user-agent",
    lastMessage: "Deploy completed successfully. All health checks passing.",
    lastMessageBy: "agent-deploy",
    lastMessageAt: Date.now() - 5 * 60 * 60_000,
    messageCount: 8,
    unreadCount: 0,
    isActive: false,
  },
  {
    id: "t5",
    sessionKey: "session-code-1",
    participants: [p("user-1"), p("agent-code")],
    kind: "user-agent",
    lastMessage: "I've refactored the authentication middleware. PR is ready for review.",
    lastMessageBy: "agent-code",
    lastMessageAt: Date.now() - 8 * 60 * 60_000,
    messageCount: 19,
    unreadCount: 0,
    isActive: false,
  },
  {
    id: "t6",
    sessionKey: "session-data-deploy",
    participants: [p("agent-data"), p("agent-deploy")],
    kind: "agent-agent",
    lastMessage: "Pipeline artifacts uploaded. Ready for staging deploy when you are.",
    lastMessageBy: "agent-data",
    lastMessageAt: Date.now() - 12 * 60 * 60_000,
    messageCount: 6,
    unreadCount: 0,
    isActive: false,
  },
  {
    id: "t7",
    sessionKey: "session-infra-sync",
    participants: [p("user-1"), p("agent-code"), p("agent-deploy"), p("agent-data")],
    kind: "group",
    title: "Infra Sync",
    lastMessage: "All services green. Next sync scheduled for Monday.",
    lastMessageBy: "agent-deploy",
    lastMessageAt: Date.now() - 24 * 60 * 60_000,
    messageCount: 31,
    unreadCount: 0,
    isActive: false,
  },
];

interface HandoffNeedsAttention {
  id: string;
  task: string;
  priority: "high" | "medium" | "low";
  note: string;
  ts: number;
}

const NEEDS_ATTENTION_PRESETS: Omit<HandoffNeedsAttention, "id" | "ts">[] = [
  { task: "Review data anomalies", priority: "high", note: "3 flagged items need human review" },
  { task: "Approve staging deploy", priority: "medium", note: "Blocked on Myo's approval" },
  { task: "Update API docs", priority: "low", note: "Post-migration cleanup" },
  { task: "Rotate gateway tokens", priority: "high", note: "Expiring in 24h" },
  { task: "Review PR #847", priority: "medium", note: "Fix for revenue parsing bug" },
  { task: "Check pipeline health", priority: "low", note: "Scheduled after deploy" },
];

interface HandoffInProgress {
  id: string;
  task: string;
  owner: string;
  status: string;
  ts: number;
}

const IN_PROGRESS_PRESETS: Omit<HandoffInProgress, "id" | "ts">[] = [
  { task: "Q4 data analysis", owner: "research-bot", status: "3 anomalies found, pending review" },
  { task: "API migration", owner: "code-bot", status: "Waiting for staging approval" },
  { task: "Deploy to staging", owner: "deploy-bot", status: "Building container image" },
  { task: "Security audit", owner: "security-bot", status: "Scanning dependencies" },
  { task: "Docs generation", owner: "writer-bot", status: "Processing 12 endpoints" },
];

// ── Helpers ──

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function threadTitle(thread: ConversationThread): string {
  if (thread.title) return thread.title;
  if (thread.kind === "agent-agent") {
    return thread.participants.map((p) => p.name).join(" \u2194 ");
  }
  const agents = thread.participants.filter((p) => p.type === "agent");
  if (agents.length === 1) return agents[0].name;
  return agents.map((p) => p.name).join(", ");
}

function senderName(thread: ConversationThread): string {
  const sender = thread.participants.find((p) => p.id === thread.lastMessageBy);
  if (!sender) return "";
  return sender.type === "user" ? "You" : sender.name;
}

// ── Shared Sub-components ──

function ParticipantAvatars({ participants, size = 28 }: { participants: Participant[]; size?: number }) {
  const maxShow = 3;
  const shown = participants.slice(0, maxShow);
  const overflow = participants.length - maxShow;

  return (
    <div className="flex items-center" style={{ minWidth: size + (shown.length - 1) * (size * 0.55) }}>
      {shown.map((p, i) => {
        if (p.type === "user") {
          return (
            <div
              key={p.id}
              className="rounded-full bg-surface-low flex items-center justify-center border-2 border-background"
              style={{ width: size, height: size, marginLeft: i > 0 ? -(size * 0.35) : 0, zIndex: shown.length - i }}
            >
              <User className="text-text-muted" style={{ width: size * 0.5, height: size * 0.5 }} />
            </div>
          );
        }
        const avatar = agentAvatar(p.name);
        const Icon = avatar.icon;
        return (
          <Tooltip key={p.id} delayDuration={300}>
            <TooltipTrigger asChild>
              <div
                className="rounded-full flex items-center justify-center border-2 border-background"
                style={{
                  width: size,
                  height: size,
                  marginLeft: i > 0 ? -(size * 0.35) : 0,
                  zIndex: shown.length - i,
                  backgroundColor: avatar.bgColor,
                }}
              >
                <Icon style={{ width: size * 0.5, height: size * 0.5, color: avatar.fgColor }} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="bg-transparent border-0 p-0 shadow-none">
              <AgentCardTooltip agentName={p.name} />
            </TooltipContent>
          </Tooltip>
        );
      })}
      {overflow > 0 && (
        <div
          className="rounded-full bg-surface-low flex items-center justify-center border-2 border-background text-[10px] font-medium text-text-muted"
          style={{ width: size, height: size, marginLeft: -(size * 0.35), zIndex: 0 }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

function ThreadRow({
  thread,
  selected,
  onSelect,
  onDelete,
  onRename,
  compact = false,
}: {
  thread: ConversationThread;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onRename?: (title: string) => void;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const startEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRename) return;
    setEditValue(thread.title || threadTitle(thread));
    setEditing(true);
  }, [onRename, thread]);

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && onRename) onRename(trimmed);
    setEditing(false);
  }, [editValue, onRename]);

  return (
    <motion.div
      className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors relative group/row cursor-pointer ${
        selected
          ? "bg-surface-low border-l-2 border-[#38D39F]"
          : "border-l-2 border-transparent hover:bg-surface-low/50"
      }`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0, marginBottom: 0, overflow: "hidden" }}
      transition={{ duration: 0.15 }}
      onClick={onSelect}
    >
      {!compact && (
        <ParticipantAvatars
          participants={thread.kind === "user-agent" ? thread.participants.filter((p) => p.type === "agent") : thread.participants}
          size={28}
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {editing ? (
              <input
                autoFocus
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(false); }}
                onBlur={commitEdit}
                onClick={(e) => e.stopPropagation()}
                className="text-sm font-medium text-foreground bg-transparent border-b border-[#38D39F] focus:outline-none w-full min-w-0"
              />
            ) : (
              <>
                <span className="text-sm font-medium text-foreground truncate">{threadTitle(thread)}</span>
                {onRename && (
                  <button
                    onClick={startEdit}
                    className="flex-shrink-0 hidden group-hover/row:flex w-4 h-4 rounded items-center justify-center text-text-muted hover:text-foreground transition-colors"
                    title="Rename"
                  >
                    <PenLine className="w-2.5 h-2.5" />
                  </button>
                )}
              </>
            )}
            {!editing && thread.isActive && <span className="w-1.5 h-1.5 rounded-full bg-[#38D39F] flex-shrink-0" />}
          </div>
          {!editing && <span className="text-[10px] text-text-muted flex-shrink-0 group-hover/row:hidden">{relativeTime(thread.lastMessageAt)}</span>}
          {/* Delete button — visible on hover */}
          {!editing && onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="flex-shrink-0 hidden group-hover/row:flex w-5 h-5 rounded items-center justify-center text-text-muted hover:text-[#d05f5f] hover:bg-[#d05f5f]/10 transition-colors"
              title="Delete conversation"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-xs text-text-muted truncate">
            {thread.lastMessage ? (
              <><span className="text-text-secondary">{senderName(thread)}:</span>{" "}{thread.lastMessage}</>
            ) : (
              <span className="italic">No messages yet</span>
            )}
          </p>
          {thread.unreadCount > 0 && (
            <span className="flex-shrink-0 bg-[#38D39F] text-[#0a0a0b] text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {thread.unreadCount}
            </span>
          )}
        </div>
      </div>

      {/* Kind indicator */}
      {thread.kind === "group" && (
        <Users className="w-3 h-3 text-text-muted flex-shrink-0 mt-1" />
      )}
      {thread.kind === "agent-agent" && (
        <Bot className="w-3 h-3 text-text-muted flex-shrink-0 mt-1" />
      )}
    </motion.div>
  );
}

interface SidebarToggle {
  key: string;
  label: string;
  enabled: boolean;
}

function SidebarOptionsMenu({
  toggles,
  onToggle,
}: {
  toggles: SidebarToggle[];
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
          open ? "text-foreground bg-surface-low" : "text-text-muted hover:text-foreground hover:bg-surface-low"
        }`}
        title="Sidebar options"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-border bg-[#1a1a1c] shadow-xl overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-border">
              <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Options</span>
            </div>
            <div className="py-1">
              {toggles.map((t) => (
                <button
                  key={t.key}
                  onClick={() => onToggle(t.key)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-surface-low transition-colors"
                >
                  <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                    t.enabled ? "bg-[#38D39F] border-[#38D39F]" : "border-text-muted"
                  }`}>
                    {t.enabled && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <span className={`text-[11px] ${t.enabled ? "text-foreground" : "text-text-muted"}`}>{t.label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SidebarHeader({
  showSearch,
  searchQuery,
  onToggleSearch,
  onSearchChange,
  onNewThread,
  toggles,
  onToggle,
}: {
  showSearch: boolean;
  searchQuery: string;
  onToggleSearch: () => void;
  onSearchChange: (q: string) => void;
  onNewThread?: () => void;
  toggles: SidebarToggle[];
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex-shrink-0 border-b border-border">
      <div className="flex items-center justify-between px-3 h-12">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Agents / Channels</span>
        <div className="flex items-center gap-1">
          <SidebarOptionsMenu toggles={toggles} onToggle={onToggle} />
          <button
            onClick={onToggleSearch}
            className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
          >
            {showSearch ? <X className="w-3.5 h-3.5" /> : <Search className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onNewThread}
            className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
            title="New conversation"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2">
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search conversations..."
                className="w-full bg-surface-low border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground placeholder-text-muted focus:outline-none focus:border-border-strong"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── V1: Flat Thread List ──

function FlatThreadList({
  threads,
  selectedThreadId,
  onSelectThread,
  onDeleteThread,
}: {
  threads: ConversationThread[];
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  onDeleteThread?: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "active" | "unread">("all");

  const filtered = useMemo(() => {
    if (filter === "active") return threads.filter((t) => t.isActive);
    if (filter === "unread") return threads.filter((t) => t.unreadCount > 0);
    return threads;
  }, [threads, filter]);

  const filters: { key: typeof filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "unread", label: "Unread" },
  ];

  const privateThreads = useMemo(
    () => filtered.filter((t) => t.kind === "user-agent").sort((a, b) => b.lastMessageAt - a.lastMessageAt),
    [filtered],
  );
  const groupThreads = useMemo(
    () => filtered.filter((t) => t.kind === "group" || t.kind === "agent-agent").sort((a, b) => b.lastMessageAt - a.lastMessageAt),
    [filtered],
  );

  return (
    <>
      {/* Filter pills */}
      <div className="flex-shrink-0 flex gap-1.5 px-3 py-2 border-b border-border">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${
              filter === f.key
                ? "bg-[#38D39F]/10 text-[#38D39F] border-[#38D39F]/30"
                : "text-text-muted hover:text-foreground border-border"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {privateThreads.length === 0 && groupThreads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <MessageSquare className="w-6 h-6 mb-2" />
            <p className="text-xs">No conversations</p>
          </div>
        ) : (
          <>
            {privateThreads.length > 0 && (
              <>
                <div className="px-3 py-1.5 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted/60">My Agents</span>
                  <div className="flex-1 h-px bg-border/50" />
                  <span className="text-[10px] text-text-muted">{privateThreads.length}</span>
                </div>
                <AnimatePresence mode="popLayout">
                  {privateThreads.map((thread) => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      selected={selectedThreadId === thread.id}
                      onSelect={() => onSelectThread(thread.id)}
                      onDelete={onDeleteThread ? () => onDeleteThread(thread.id) : undefined}
                    />
                  ))}
                </AnimatePresence>
              </>
            )}
            {groupThreads.length > 0 && (
              <>
                <div className="px-3 py-1.5 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted/60">Channels</span>
                  <div className="flex-1 h-px bg-border/50" />
                  <span className="text-[10px] text-text-muted">{groupThreads.length}</span>
                </div>
                <AnimatePresence mode="popLayout">
                  {groupThreads.map((thread) => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      selected={selectedThreadId === thread.id}
                      onSelect={() => onSelectThread(thread.id)}
                      onDelete={onDeleteThread ? () => onDeleteThread(thread.id) : undefined}
                    />
                  ))}
                </AnimatePresence>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ── V2: Grouped by Agent ──

interface AgentGroup {
  agentId: string;
  agentName: string;
  threads: ConversationThread[];
  totalUnread: number;
}

function GroupedByAgent({
  threads,
  selectedThreadId,
  onSelectThread,
  onDeleteThread,
}: {
  threads: ConversationThread[];
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  onDeleteThread?: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { agentGroups, groupThreads } = useMemo(() => {
    const agentMap = new Map<string, AgentGroup>();
    const groupList: ConversationThread[] = [];

    for (const thread of threads) {
      if (thread.kind === "group") {
        groupList.push(thread);
        continue;
      }

      // For user-agent: group under the agent
      // For agent-agent: group under the first agent only (avoid duplication)
      const agents = thread.participants.filter((p) => p.type === "agent");
      const primary = agents[0];
      if (!primary) continue;

      if (!agentMap.has(primary.id)) {
        agentMap.set(primary.id, {
          agentId: primary.id,
          agentName: primary.name,
          threads: [],
          totalUnread: 0,
        });
      }
      const group = agentMap.get(primary.id)!;
      group.threads.push(thread);
      group.totalUnread += thread.unreadCount;
    }

    // Sort agent groups by most recent thread
    const sorted = Array.from(agentMap.values()).sort((a, b) => {
      const aMax = Math.max(...a.threads.map((t) => t.lastMessageAt));
      const bMax = Math.max(...b.threads.map((t) => t.lastMessageAt));
      return bMax - aMax;
    });

    return { agentGroups: sorted, groupThreads: groupList };
  }, [threads]);

  const toggleCollapse = useCallback((agentId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  return (
    <div className="flex-1 overflow-y-auto">
      {agentGroups.map((group) => {
        const isCollapsed = collapsed.has(group.agentId);
        const avatar = agentAvatar(group.agentName);
        const Icon = avatar.icon;

        return (
          <div key={group.agentId}>
            {/* Agent group header */}
            <button
              onClick={() => toggleCollapse(group.agentId)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-low/50 transition-colors"
            >
              <motion.div animate={{ rotate: isCollapsed ? -90 : 0 }} transition={{ duration: 0.15 }}>
                <ChevronDown className="w-3 h-3 text-text-muted" />
              </motion.div>
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center"
                style={{ backgroundColor: avatar.bgColor }}
              >
                <Icon className="w-3 h-3" style={{ color: avatar.fgColor }} />
              </div>
              <span className="text-xs font-medium text-foreground flex-1 text-left truncate">
                {group.agentName}
              </span>
              <span className="text-[10px] text-text-muted">
                {group.threads.length} {group.threads.length === 1 ? "thread" : "threads"}
              </span>
              {group.totalUnread > 0 && (
                <span className="bg-[#38D39F] text-[#0a0a0b] text-[10px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1">
                  {group.totalUnread}
                </span>
              )}
            </button>

            {/* Threads within group */}
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="pl-5 border-l border-border/50 ml-[18px]">
                    {group.threads
                      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
                      .map((thread) => (
                        <ThreadRow
                          key={thread.id}
                          thread={thread}
                          selected={selectedThreadId === thread.id}
                          onSelect={() => onSelectThread(thread.id)}
                          onDelete={onDeleteThread ? () => onDeleteThread(thread.id) : undefined}
                          compact
                        />
                      ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Group chats section */}
      {groupThreads.length > 0 && (
        <div className="mt-1 border-t border-border">
          <div className="px-3 py-2 flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
              Channels
            </span>
            <span className="text-[10px] text-text-muted">({groupThreads.length})</span>
          </div>
          {groupThreads
            .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
            .map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                selected={selectedThreadId === thread.id}
                onSelect={() => onSelectThread(thread.id)}
                onDelete={onDeleteThread ? () => onDeleteThread(thread.id) : undefined}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ── V3: Graph/Network + Thread List ──

interface NodePosition {
  id: string;
  name: string;
  type: "user" | "agent";
  x: number;
  y: number;
}

interface Edge {
  from: string;
  to: string;
  threadId: string;
  messageCount: number;
  isActive: boolean;
}

export function ConversationGraphModule({
  threads,
  selectedThreadId,
  variant = "v1",
}: {
  threads: ConversationThread[];
  selectedThreadId: string | null;
  variant?: "off" | "v1" | "v2" | "v3";
}) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [graphScope, setGraphScope] = useState<"all" | "thread">("all");

  const scopedThreads = useMemo(() => {
    if (graphScope === "thread" && selectedThreadId) {
      const t = threads.find((t) => t.id === selectedThreadId);
      return t ? [t] : threads;
    }
    return threads;
  }, [threads, selectedThreadId, graphScope]);

  const isCompact = variant === "v2";
  const isCircles = variant === "v3";
  const graphHeight = isCompact ? 100 : 160;
  const nodeSizeVal = isCompact ? 22 : 28;

  const { nodes, edges } = useMemo(() => {
    // Collect unique participants
    const participantMap = new Map<string, Participant>();
    for (const thread of scopedThreads) {
      for (const p of thread.participants) {
        participantMap.set(p.id, p);
      }
    }

    const all = Array.from(participantMap.values());

    if (isCircles) {
      // v3: horizontal row layout, no edges
      const spacing = Math.min(36, 260 / Math.max(all.length, 1));
      const totalWidth = (all.length - 1) * spacing;
      const startX = (260 - totalWidth) / 2;
      const nodePositions: NodePosition[] = all.map((p, i) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        x: startX + i * spacing,
        y: 20,
      }));
      return { nodes: nodePositions, edges: [] as Edge[] };
    }

    // Circular layout
    const cx = 130;
    const cy = isCompact ? 42 : 70;
    const rx = isCompact ? 65 : 90;
    const ry = isCompact ? 30 : 50;
    const nodePositions: NodePosition[] = all.map((p, i) => {
      const angle = (2 * Math.PI * i) / all.length - Math.PI / 2;
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle),
      };
    });

    // Build edges from 2-participant threads
    const edgeList: Edge[] = [];
    for (const thread of scopedThreads) {
      if (thread.participants.length === 2) {
        edgeList.push({
          from: thread.participants[0].id,
          to: thread.participants[1].id,
          threadId: thread.id,
          messageCount: thread.messageCount,
          isActive: thread.isActive,
        });
      } else {
        // For group threads, create edges between all pairs
        for (let i = 0; i < thread.participants.length; i++) {
          for (let j = i + 1; j < thread.participants.length; j++) {
            const existsAlready = edgeList.some(
              (e) =>
                (e.from === thread.participants[i].id && e.to === thread.participants[j].id) ||
                (e.from === thread.participants[j].id && e.to === thread.participants[i].id)
            );
            if (!existsAlready) {
              edgeList.push({
                from: thread.participants[i].id,
                to: thread.participants[j].id,
                threadId: thread.id,
                messageCount: thread.messageCount,
                isActive: thread.isActive,
              });
            }
          }
        }
      }
    }

    return { nodes: nodePositions, edges: edgeList };
  }, [scopedThreads, isCircles, isCompact]);

  const nodeById = useMemo(() => {
    const map = new Map<string, NodePosition>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const filterLabel = selectedNode
    ? (nodeById.get(selectedNode)?.name ?? "Unknown")
    : "All threads";

  // Determine which nodes have active edges (for pulse animation)
  const activeNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of edges) {
      if (edge.isActive) {
        ids.add(edge.from);
        ids.add(edge.to);
      }
    }
    return ids;
  }, [edges]);

  const isEmptyGraph = nodes.length === 0;
  const isSoloUser = nodes.length === 1 && nodes[0].type === "user";

  if (variant === "off") return null;

  // ── v3: participant circles in a row ──
  if (isCircles) {
    return (
      <div className="flex-shrink-0 border-b border-border">
        <div className="flex items-center justify-center gap-1.5 px-3 py-2.5">
          {isEmptyGraph ? (
            <span className="text-[10px] text-text-muted">No participants</span>
          ) : (
            nodes.map((node, nodeIdx) => {
              const isActive = activeNodeIds.has(node.id);
              if (node.type === "user") {
                return (
                  <motion.div
                    key={node.id}
                    className="relative rounded-full bg-surface-low flex items-center justify-center"
                    style={{ width: 28, height: 28 }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25, delay: nodeIdx * 0.06 }}
                    title={node.name}
                  >
                    <User className="w-3.5 h-3.5 text-text-muted" />
                    {isActive && (
                      <motion.span
                        className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#38D39F] border border-background"
                        style={{ zIndex: 3 }}
                        animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                      />
                    )}
                  </motion.div>
                );
              }
              const avatar = agentAvatar(node.name);
              const Icon = avatar.icon;
              return (
                <motion.div
                  key={node.id}
                  className="relative rounded-full flex items-center justify-center"
                  style={{ width: 28, height: 28, backgroundColor: avatar.bgColor }}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25, delay: nodeIdx * 0.06 }}
                  title={node.name}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: avatar.fgColor }} />
                  {isActive && (
                    <motion.span
                      className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#38D39F] border border-background"
                      style={{ zIndex: 3 }}
                      animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.6, 1, 0.6] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                </motion.div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ── v1 / v2: full graph with SVG ──
  return (
    <>
      {/* Graph area */}
      <motion.div
        className="flex-shrink-0 relative border-b border-border cursor-pointer overflow-hidden"
        style={{ height: graphHeight }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedNode(null);
        }}
      >
        {/* Empty / solo states */}
        {isEmptyGraph && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted">
            <MessageSquare className="w-6 h-6 mb-1.5 text-text-muted/30" />
            <p className="text-[11px]">No conversations yet</p>
            <p className="text-[10px] text-text-muted/50">Start one to see the network</p>
          </div>
        )}
        {isSoloUser && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted">
            <div className="w-10 h-10 rounded-full bg-surface-low flex items-center justify-center mb-2">
              <User className="w-5 h-5 text-text-muted/40" />
            </div>
            <p className="text-[11px]">Just you for now</p>
            <p className="text-[10px] text-text-muted/50">Add participants to build the graph</p>
          </div>
        )}

        {/* Ambient background glow behind active cluster */}
        {!isEmptyGraph && !isSoloUser && (
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{ width: 120, height: 120, left: 70, top: isCompact ? -10 : 10, background: "radial-gradient(circle, rgba(56,211,159,0.06) 0%, transparent 70%)" }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />)}

        {/* SVG edges */}
        {!isEmptyGraph && !isSoloUser && <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
          <defs>
            {/* Animated dash pattern for active edges */}
            <linearGradient id="edgeGradientActive" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38D39F" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#38D39F" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#38D39F" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          {edges.map((edge, edgeIdx) => {
            const fromNode = nodeById.get(edge.from);
            const toNode = nodeById.get(edge.to);
            if (!fromNode || !toNode) return null;

            const isHighlighted =
              edge.isActive ||
              edge.threadId === selectedThreadId ||
              selectedNode === edge.from ||
              selectedNode === edge.to;

            const isDimmed = selectedNode !== null && !isHighlighted;

            if (isHighlighted) {
              // Active/highlighted edges: animated dash flow + glow
              return (
                <g key={`${edge.from}-${edge.to}-${edgeIdx}`}>
                  {/* Glow layer */}
                  <motion.line
                    x1={fromNode.x} y1={fromNode.y}
                    x2={toNode.x} y2={toNode.y}
                    stroke="#38D39F"
                    strokeWidth={4}
                    strokeLinecap="round"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0.1, 0.25, 0.1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: edgeIdx * 0.3 }}
                  />
                  {/* Main line */}
                  <motion.line
                    x1={fromNode.x} y1={fromNode.y}
                    x2={toNode.x} y2={toNode.y}
                    stroke="url(#edgeGradientActive)"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeDasharray="6 4"
                    initial={{ strokeDashoffset: 0 }}
                    animate={{ strokeDashoffset: -20 }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  />
                  {/* Traveling particle */}
                  <motion.circle
                    r={2}
                    fill="#38D39F"
                    initial={{ cx: fromNode.x, cy: fromNode.y, opacity: 0 }}
                    animate={{
                      cx: [fromNode.x, toNode.x],
                      cy: [fromNode.y, toNode.y],
                      opacity: [0, 1, 1, 0],
                    }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: edgeIdx * 0.6 }}
                  />
                </g>
              );
            }

            // Inactive edges
            return (
              <motion.line
                key={`${edge.from}-${edge.to}-${edgeIdx}`}
                x1={fromNode.x} y1={fromNode.y}
                x2={toNode.x} y2={toNode.y}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={1}
                strokeLinecap="round"
                animate={{ opacity: isDimmed ? 0.15 : 0.4 }}
                transition={{ duration: 0.3 }}
              />
            );
          })}
        </svg>}

        {/* Nodes */}
        {!isEmptyGraph && !isSoloUser && (<>
        {nodes.map((node, nodeIdx) => {
          const isSelected = selectedNode === node.id;
          const isActive = activeNodeIds.has(node.id);
          const isDimmed = selectedNode !== null && !isSelected &&
            !edges.some((e) =>
              (e.from === selectedNode || e.to === selectedNode) &&
              (e.from === node.id || e.to === node.id)
            );

          if (node.type === "user") {
            return (
              <motion.button
                key={node.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedNode(isSelected ? null : node.id);
                }}
                className="absolute rounded-full bg-surface-low flex items-center justify-center"
                style={{
                  width: nodeSizeVal,
                  height: nodeSizeVal,
                  left: node.x - nodeSizeVal / 2,
                  top: node.y - nodeSizeVal / 2,
                  zIndex: 2,
                }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{
                  scale: isDimmed ? 0.8 : 1,
                  opacity: isDimmed ? 0.4 : 1,
                  boxShadow: isSelected
                    ? "0 0 0 2px #38D39F, 0 0 12px rgba(56,211,159,0.3)"
                    : isActive
                      ? "0 0 8px rgba(56,211,159,0.15)"
                      : "none",
                }}
                transition={{ type: "spring", stiffness: 400, damping: 25, delay: nodeIdx * 0.06 }}
                whileHover={{ scale: 1.2 }}
                whileTap={{ scale: 0.9 }}
                title={node.name}
              >
                <User className={isCompact ? "w-2.5 h-2.5 text-text-muted" : "w-3.5 h-3.5 text-text-muted"} />
                {/* Active pulse ring */}
                {isActive && !isSelected && (
                  <motion.span
                    className="absolute inset-0 rounded-full border border-[#38D39F]/30"
                    animate={{ scale: [1, 1.6], opacity: [0.4, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: nodeIdx * 0.4 }}
                  />
                )}
              </motion.button>
            );
          }

          const avatar = agentAvatar(node.name);
          const Icon = avatar.icon;

          return (
            <motion.button
              key={node.id}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedNode(isSelected ? null : node.id);
              }}
              className="absolute rounded-full flex items-center justify-center"
              style={{
                width: nodeSizeVal,
                height: nodeSizeVal,
                left: node.x - nodeSizeVal / 2,
                top: node.y - nodeSizeVal / 2,
                zIndex: 2,
                backgroundColor: avatar.bgColor,
              }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{
                scale: isDimmed ? 0.8 : 1,
                opacity: isDimmed ? 0.4 : 1,
                boxShadow: isSelected
                  ? `0 0 0 2px #38D39F, 0 0 12px rgba(56,211,159,0.3)`
                  : isActive
                    ? `0 0 8px ${avatar.fgColor}33`
                    : "none",
              }}
              transition={{ type: "spring", stiffness: 400, damping: 25, delay: nodeIdx * 0.06 }}
              whileHover={{ scale: 1.2 }}
              whileTap={{ scale: 0.9 }}
              title={node.name}
            >
              <Icon className={isCompact ? "w-2.5 h-2.5" : "w-3.5 h-3.5"} style={{ color: avatar.fgColor }} />
              {/* Active pulse ring */}
              {isActive && !isSelected && (
                <motion.span
                  className="absolute inset-0 rounded-full"
                  style={{ border: `1px solid ${avatar.fgColor}40` }}
                  animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: nodeIdx * 0.4 }}
                />
              )}
              {/* Working indicator — subtle breathing */}
              {isActive && (
                <motion.span
                  className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#38D39F] border border-background"
                  style={{ zIndex: 3 }}
                  animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
            </motion.button>
          );
        })}

        {/* Node labels */}
        {nodes.map((node, nodeIdx) => {
          const isDimmed = selectedNode !== null && selectedNode !== node.id &&
            !edges.some((e) =>
              (e.from === selectedNode || e.to === selectedNode) &&
              (e.from === node.id || e.to === node.id)
            );

          return (
            <motion.span
              key={`label-${node.id}`}
              className={`absolute whitespace-nowrap pointer-events-none ${isCompact ? "text-[8px]" : "text-[9px]"}`}
              style={{
                left: node.x,
                top: node.y + nodeSizeVal / 2 + 4,
                transform: "translateX(-50%)",
                zIndex: 1,
              }}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: isDimmed ? 0.2 : 0.6, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 + nodeIdx * 0.06 }}
            >
              {node.type === "user" ? "You" : node.name}
            </motion.span>
          );
        })}
        </>)}
      </motion.div>

      {/* Scope toggle + filter label */}
      <div className="flex-shrink-0 border-b border-border">
        {/* Scope pills */}
        <div className="flex gap-1 px-3 pt-1.5 pb-1">
          <button
            onClick={() => { setGraphScope("all"); setSelectedNode(null); }}
            className={`px-2 py-0.5 rounded-full text-[9px] font-medium border transition-colors ${
              graphScope === "all"
                ? "bg-[#38D39F]/10 text-[#38D39F] border-[#38D39F]/30"
                : "text-text-muted hover:text-foreground border-border"
            }`}
          >
            All
          </button>
          <button
            onClick={() => { setGraphScope("thread"); setSelectedNode(null); }}
            disabled={!selectedThreadId}
            className={`px-2 py-0.5 rounded-full text-[9px] font-medium border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              graphScope === "thread"
                ? "bg-[#38D39F]/10 text-[#38D39F] border-[#38D39F]/30"
                : "text-text-muted hover:text-foreground border-border"
            }`}
          >
            This thread
          </button>
        </div>
        {/* Filter row */}
        <div className="flex items-center justify-between px-3 pb-1.5">
          <motion.span
            key={filterLabel}
            className="text-[10px] text-text-muted truncate"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
          >
            {filterLabel}
          </motion.span>
          {selectedNode && (
            <motion.button
              onClick={() => setSelectedNode(null)}
              className="text-[10px] text-text-muted hover:text-foreground transition-colors"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              Clear
            </motion.button>
          )}
        </div>
      </div>
    </>
  );
}

// ── V3: Handoff + Thread List ──

function HandoffSection({
  icon: SectionIcon,
  color,
  items,
  presets,
  onAdd,
  onRemove,
}: {
  icon: typeof Play;
  color: string;
  items: { id: string; task: string; subtitle: string; ts: number }[];
  presets: { task: string; subtitle: string }[];
  onAdd: (preset: { task: string; subtitle: string }) => void;
  onRemove: (id: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const available = useMemo(
    () => presets.filter((p) => !items.some((item) => item.task === p.task)),
    [presets, items],
  );

  return (
    <>
      <AnimatePresence>
        {picking && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden px-3">
            <div className="rounded-md border border-border bg-surface-low p-1.5 mb-1.5 space-y-0.5">
              {available.length === 0 ? (
                <p className="text-[11px] text-text-muted/50 text-center py-1">All items added</p>
              ) : available.map((preset) => (
                <button key={preset.task} onClick={() => { onAdd(preset); if (available.length <= 1) setPicking(false); }}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-surface-low/80 transition-colors flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] text-foreground">{preset.task}</span>
                    <p className="text-[10px] text-text-muted truncate">{preset.subtitle}</p>
                  </div>
                </button>
              ))}
              <button onClick={() => setPicking(false)} className="w-full text-center text-[11px] text-text-muted hover:text-foreground py-1 transition-colors">Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {items.length === 0 && !picking ? (
        <div className="px-3 py-2 text-center">
          <p className="text-[11px] text-text-muted/50">No items yet</p>
        </div>
      ) : (
        <div className="px-3">
          <AnimatePresence mode="popLayout">
            {items.map((item) => (
              <motion.button key={item.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0, marginBottom: 0 }}
                transition={{ duration: 0.15 }}
                className="group/item w-full text-left p-1.5 my-1 rounded-md flex items-start justify-between cursor-pointer transition-colors"
                style={{ border: `1px solid ${color}30`, backgroundColor: `${color}08` }}
                whileHover={{ backgroundColor: `${color}18` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] text-foreground truncate">{item.task}</span>
                    <span className="text-[9px] text-text-muted/50 flex-shrink-0">{relativeTime(item.ts)}</span>
                  </div>
                  <p className="text-[11px] text-text-muted">{item.subtitle}</p>
                </div>
                <span role="button" onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
                  className="flex-shrink-0 w-4 h-4 rounded flex items-center justify-center text-text-muted hover:text-[#d05f5f] opacity-0 group-hover/item:opacity-100 transition-all mt-0.5">
                  <X className="w-2.5 h-2.5" />
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

function HandoffWidget() {
  const [items] = useState<{ id: string; task: string; priority: "high" | "medium" | "low"; note: string; ts: number }[]>([]);

  if (items.length === 0) return null;

  const priorityColor: Record<string, string> = {
    high: "#d05f5f",
    medium: "#f0c56c",
    low: "#6b9eff",
  };

  return (
    <div className="flex-shrink-0 border-b border-border">
      <div className="px-3 py-2 space-y-1.5">
        <AnimatePresence initial={false}>
          {items.map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: -20, scale: 0.9 }}
              transition={{ duration: 0.2, delay: idx * 0.04 }}
              className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-surface-low/50 border border-border group/card hover:bg-surface-low transition-colors"
            >
              <div
                className="w-1 h-full min-h-[24px] rounded-full flex-shrink-0 mt-0.5"
                style={{ backgroundColor: priorityColor[item.priority] ?? "#6b9eff" }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-foreground truncate">{item.task}</p>
                <p className="text-[10px] text-text-muted truncate">{item.note}</p>
              </div>
              <span
                className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5"
                style={{
                  color: priorityColor[item.priority] ?? "#6b9eff",
                  backgroundColor: `${priorityColor[item.priority] ?? "#6b9eff"}15`,
                }}
              >
                {item.priority}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function HandoffThreadView({
  threads,
  selectedThreadId,
  onSelectThread,
  onDeleteThread,
  onRenameThread,
}: {
  threads: ConversationThread[];
  selectedThreadId: string | null;
  onSelectThread: (id: string) => void;
  onDeleteThread?: (id: string) => void;
  onRenameThread?: (threadId: string, title: string) => void;
}) {
  const sortedThreads = useMemo(
    () => [...threads].sort((a, b) => b.lastMessageAt - a.lastMessageAt),
    [threads],
  );

  const privateThreads = useMemo(
    () => sortedThreads.filter((t) => t.kind === "user-agent"),
    [sortedThreads],
  );
  const groupThreads = useMemo(
    () => sortedThreads.filter((t) => t.kind === "group" || t.kind === "agent-agent"),
    [sortedThreads],
  );

  return (
    <>
      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {sortedThreads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <MessageSquare className="w-6 h-6 mb-2" />
            <p className="text-xs">No threads</p>
          </div>
        ) : (
          <>
            {privateThreads.length > 0 && (
              <>
                <div className="px-3 py-1.5 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted/60">My Agents</span>
                  <div className="flex-1 h-px bg-border/50" />
                  <span className="text-[10px] text-text-muted">{privateThreads.length}</span>
                </div>
                {privateThreads.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    selected={selectedThreadId === thread.id}
                    onSelect={() => onSelectThread(thread.id)}
                    onDelete={onDeleteThread ? () => onDeleteThread(thread.id) : undefined}
                    onRename={onRenameThread ? (title) => onRenameThread(thread.id, title) : undefined}
                  />
                ))}
              </>
            )}
            {groupThreads.length > 0 && (
              <>
                <div className="px-3 py-1.5 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted/60">Channels</span>
                  <div className="flex-1 h-px bg-border/50" />
                  <span className="text-[10px] text-text-muted">{groupThreads.length}</span>
                </div>
                {groupThreads.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    selected={selectedThreadId === thread.id}
                    onSelect={() => onSelectThread(thread.id)}
                    onDelete={onDeleteThread ? () => onDeleteThread(thread.id) : undefined}
                    onRename={onRenameThread ? (title) => onRenameThread(thread.id, title) : undefined}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ── Empty State Prompt ──

const AVAILABLE_AGENTS = MOCK_PARTICIPANTS.filter((p) => p.type === "agent");

function ConversationsEmptyPrompt({
  hasThreads,
  onNewThread,
  onStartAgentChat,
}: {
  hasThreads: boolean;
  onNewThread?: () => void;
  onStartAgentChat?: (agent: Participant) => void;
}) {
  const [showCreator, setShowCreator] = useState(false);

  if (hasThreads) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="flex-1 flex flex-col items-center justify-center px-6 py-10"
      >
        <Search className="w-5 h-5 text-text-muted/40 mb-2" />
        <p className="text-xs text-text-muted">No matching results</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex-1 flex flex-col min-h-0"
    >
      {/* New Agent button / inline creator */}
      {!showCreator && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="flex-shrink-0 px-3 py-2.5 border-b border-border"
        >
          <motion.button
            whileHover={{ scale: 1.02, boxShadow: "0 0 16px rgba(56,211,159,0.1)" }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowCreator(true)}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg bg-[#38D39F]/10 border border-[#38D39F]/20 hover:border-[#38D39F]/35 transition-colors text-xs font-medium text-[#38D39F]"
          >
            <Plus className="w-4 h-4" />
            <span>New Agent</span>
          </motion.button>
        </motion.div>
      )}
      <QuickAgentCreator
        open={showCreator}
        onClose={() => setShowCreator(false)}
        onCreated={(name, _iconIndex, _size) => {
          setShowCreator(false);
          // Create a mock agent participant and start chat
          const newAgent: Participant = { id: `agent-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`, name, type: "agent" };
          onStartAgentChat?.(newAgent);
        }}
      />

      {/* Available agents list */}
      <div className="flex-1 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="px-3 py-2"
        >
          <p className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider px-1 mb-2">Available Agents</p>
          <div className="space-y-0.5">
            {AVAILABLE_AGENTS.map((agent, idx) => {
              const av = agentAvatar(agent.name);
              const AvIcon = av.icon;
              return (
                <motion.button
                  key={agent.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: 0.25 + idx * 0.04 }}
                  whileHover={{ x: 3, backgroundColor: "rgba(255,255,255,0.04)" }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onStartAgentChat?.(agent)}
                  className="flex items-center gap-2.5 w-full px-2 py-2 rounded-lg transition-colors text-left group/agent"
                >
                  <motion.div
                    whileHover={{ scale: 1.1 }}
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: av.bgColor }}
                  >
                    <AvIcon className="w-4 h-4" style={{ color: av.fgColor }} />
                  </motion.div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-foreground truncate">{agent.name}</p>
                    <p className="text-[10px] text-text-muted">Start chat</p>
                  </div>
                  <ChevronRight className="w-3 h-3 text-text-muted/0 group-hover/agent:text-text-muted transition-colors flex-shrink-0" />
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ── Main Component ──

export function ConversationsSidebar({
  variant,
  threads,
  selectedThreadId,
  onSelectThread,
  onNewThread,
  onStartAgentChat,
  onDeleteThread,
  onRenameThread,
}: ConversationsSidebarProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarToggles, setSidebarToggles] = useState<Record<string, boolean>>(() => ({
    needsAttention: true,
  }));

  const toggles: SidebarToggle[] = [
    { key: "needsAttention", label: "Needs Attention", enabled: sidebarToggles.needsAttention ?? true },
  ];

  const handleToggle = useCallback((key: string) => {
    setSidebarToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const q = searchQuery.toLowerCase();
    return threads.filter(
      (t) =>
        threadTitle(t).toLowerCase().includes(q) ||
        t.lastMessage.toLowerCase().includes(q) ||
        t.participants.some((p) => p.name.toLowerCase().includes(q))
    );
  }, [threads, searchQuery]);

  return (
    <div className="w-[280px] flex-shrink-0 flex flex-col border-r border-border min-h-0 bg-background">
      {sidebarToggles.needsAttention && <HandoffWidget />}
      <SidebarHeader
        showSearch={showSearch}
        searchQuery={searchQuery}
        onToggleSearch={() => {
          setShowSearch((v) => !v);
          if (showSearch) setSearchQuery("");
        }}
        onSearchChange={setSearchQuery}
        onNewThread={onNewThread}
        toggles={toggles}
        onToggle={handleToggle}
      />

      {filtered.length === 0 ? (
        <ConversationsEmptyPrompt
          hasThreads={threads.length > 0}
          onNewThread={onNewThread}
          onStartAgentChat={onStartAgentChat}
        />
      ) : (
        <>
          {variant === "v1" && (
            <FlatThreadList
              threads={filtered}
              selectedThreadId={selectedThreadId}
              onSelectThread={onSelectThread}
              onDeleteThread={onDeleteThread}
            />
          )}
          {variant === "v2" && (
            <GroupedByAgent
              threads={filtered}
              selectedThreadId={selectedThreadId}
              onSelectThread={onSelectThread}
              onDeleteThread={onDeleteThread}
            />
          )}
          {variant === "v3" && (
            <HandoffThreadView
              threads={filtered}
              selectedThreadId={selectedThreadId}
              onSelectThread={onSelectThread}
              onDeleteThread={onDeleteThread}
            />
          )}
          {variant === "v3.1" && (
            <HandoffThreadView
              threads={filtered}
              selectedThreadId={selectedThreadId}
              onSelectThread={onSelectThread}
              onDeleteThread={onDeleteThread}
              onRenameThread={onRenameThread}
            />
          )}
        </>
      )}
    </div>
  );
}
