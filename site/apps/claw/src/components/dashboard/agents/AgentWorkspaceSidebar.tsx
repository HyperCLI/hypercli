"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Blocks,
  CalendarClock,
  ChevronUp,
  Codepen,
  FolderOpen,
  HardDrive,
  Loader2,
  Monitor,
  MoreVertical,
  PanelLeft,
  PanelRight,
  PenLine,
  Plus,
  Settings,
  Sparkles,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";

import type { Agent, AgentState } from "@/app/dashboard/agents/types";
import type { AgentMainTab } from "@/components/dashboard/DashboardMobileAgentMenuContext";
import { PulsingDotIndicator } from "@/components/dashboard/PulsingDotIndicator";
import { resolveSessionSourceChannel, type SessionSourceChannel } from "@/components/dashboard/session-source-channel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@hypercli/shared-ui";
import { formatTokens } from "@/lib/format";
import {
  displayOpenClawSessionName,
  fallbackOpenClawSessionDisplayName,
  sameOpenClawSelectableSessionKey,
  type OpenClawSessionRecord,
  unscopedOpenClawSessionKey,
} from "@/lib/openclaw-session-sdk-surface";

const WORKSPACE_COLLAPSED_KEY = "agents.workspaceCollapsed.v2";

interface AgentWorkspaceSidebarProps {
  selectedAgent: Agent | null;
  activeTab: AgentMainTab;
  skillsActive?: boolean;
  knowledgeActive?: boolean;
  tokenUsed?: number | null;
  tokenLimit?: number | null;
  disabled?: boolean;
  disabledReason?: string;
  scheduledDisabled?: boolean;
  scheduledDisabledReason?: string;
  isDesktopViewport: boolean;
  onCreateSession?: () => Promise<void> | void;
  onOpenFiles: () => void;
  onOpenIntegrations: () => void;
  onOpenSkills: () => void;
  onOpenKnowledge?: () => void;
  onOpenScheduled: () => void;
  onOpenDesktop?: (agent: Agent) => Promise<void> | void;
  onOpenLogs: () => void;
  onOpenShell: () => void;
  onOpenOpenClaw: () => void;
  onOpenSettings: () => void;
  onUpgrade: () => void;
  renderMobile?: boolean;
  forceExpanded?: boolean;
  fillParent?: boolean;
  onClose?: () => void;
  sessions?: OpenClawSessionRecord[] | null;
  sessionsFetched?: boolean;
  creatingSessionKeys?: string[];
  thinkingSessionKeys?: string[];
  selectedSessionKey?: string | null;
  onSelectSession?: (sessionKey: string) => void;
  onRenameSession?: (sessionKey: string, title: string) => Promise<void> | void;
  onDeleteSession?: (sessionKey: string) => Promise<void> | void;
  openingDesktop?: boolean;
}

type WorkspaceItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
  onClick: () => void;
};

function WorkspaceButton({
  item,
  collapsed,
  mobileMode = false,
}: {
  item: WorkspaceItem;
  collapsed?: boolean;
  mobileMode?: boolean;
}) {
  const Icon = item.icon;
  const disabled = Boolean(item.disabled);
  const buttonSizeClass = collapsed
    ? "h-9 w-9 justify-center"
    : mobileMode
      ? "h-10 w-full gap-3.5 px-3.5 text-left"
      : "h-9 w-full gap-3 px-3 text-left";
  const iconClassName = `${mobileMode && !collapsed ? "h-5 w-5" : "h-4 w-4"} shrink-0 ${item.busy ? "animate-spin" : ""}`;
  const roundedClassName = "rounded-full";
  const buttonClassName = `flex ${buttonSizeClass} items-center ${roundedClassName} text-sm transition-colors ${
    disabled
      ? "cursor-not-allowed text-text-muted/45"
      : item.active
        ? mobileMode
          ? "border border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]"
          : "bg-surface-low text-foreground"
        : `${mobileMode ? "border border-transparent" : ""} text-text-secondary hover:bg-surface-low/60 hover:text-foreground`
  }`;

  if (collapsed) {
    return (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={disabled ? undefined : () => item.onClick()}
            disabled={disabled}
            aria-label={item.label}
            aria-disabled={disabled}
            aria-busy={item.busy || undefined}
            className={buttonClassName}
          >
            <Icon className={iconClassName} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{item.disabledReason ?? item.label}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <button
      type="button"
      onClick={disabled ? undefined : () => item.onClick()}
      disabled={disabled}
      aria-disabled={disabled}
      aria-busy={item.busy || undefined}
      title={item.disabledReason}
      className={buttonClassName}
    >
      <Icon className={iconClassName} />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

function SessionThinkingIndicator() {
  return (
    <PulsingDotIndicator className="ml-1.5 shrink-0 align-middle" aria-label="Session is thinking" />
  );
}

function sessionTitle(session: OpenClawSessionRecord): string {
  return displayOpenClawSessionName(session);
}

function selectedSessionRecord(sessionKey: string, lastMessageAt = Number.MAX_SAFE_INTEGER): OpenClawSessionRecord {
  const title = fallbackOpenClawSessionDisplayName(sessionKey);
  return {
    key: sessionKey,
    clientMode: "openclaw",
    clientDisplayName: title,
    createdAt: 0,
    lastMessageAt,
    title,
    messageCount: 0,
    raw: { key: sessionKey, title },
  };
}

function isMainEquivalentSessionKey(sessionKey: string | null | undefined): boolean {
  return unscopedOpenClawSessionKey(sessionKey) === "main";
}

function isCanonicalMainSession(session: OpenClawSessionRecord): boolean {
  return session.key === "main" || (
    isMainEquivalentSessionKey(session.key) &&
    session.readOnly !== true &&
    !session.sourceChannelId
  );
}

function hasSession(sessions: OpenClawSessionRecord[], sessionKey: string): boolean {
  if (sessions.some((session) => sameOpenClawSelectableSessionKey(session.key, sessionKey))) return true;
  return isMainEquivalentSessionKey(sessionKey) && sessions.some(isCanonicalMainSession);
}

function isSessionActive(
  session: OpenClawSessionRecord,
  selectedSessionKey: string | null | undefined,
  sessions: OpenClawSessionRecord[],
): boolean {
  if (sameOpenClawSelectableSessionKey(selectedSessionKey, session.key)) return true;
  if (!isMainEquivalentSessionKey(selectedSessionKey) || session.key !== "main") return false;
  return !sessions.some((item) => item.key === selectedSessionKey && item.key !== "main");
}

function SessionMenuButton({
  icon: Icon,
  label,
  danger = false,
  disabled = false,
  disabledReason,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabledReason}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] transition-colors ${
        disabled
          ? "cursor-not-allowed text-text-muted/45"
          : danger
            ? "text-destructive hover:bg-destructive/10"
            : "text-foreground hover:bg-surface-low"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function RecentSessionRow({
  title,
  sourceChannel,
  active,
  onSelect,
  onRename,
  onDelete,
  creating = false,
  disabled = false,
  disabledReason,
  deleteDisabled = false,
  deleteDisabledReason,
  thinking = false,
}: {
  title: string;
  sourceChannel?: SessionSourceChannel | null;
  active: boolean;
  onSelect?: () => void;
  onRename: () => void;
  onDelete: () => void;
  creating?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  deleteDisabled?: boolean;
  deleteDisabledReason?: string;
  thinking?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const SourceChannelIcon = sourceChannel?.Icon;

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  return (
    <div className="group/session relative flex items-center gap-1">
      <button
        type="button"
        onClick={disabled ? undefined : onSelect}
        disabled={disabled}
        aria-disabled={disabled}
        aria-current={active ? "page" : undefined}
        aria-busy={creating || thinking || undefined}
        className={`min-w-0 flex-1 rounded-full px-3 py-1.5 text-left text-[13px] leading-4 transition-colors ${
          disabled
            ? "cursor-not-allowed text-text-muted/45"
            : active
              ? "bg-surface-low text-foreground"
              : "text-text-secondary hover:bg-surface-low/60 hover:text-foreground"
        }`}
        title={disabledReason ?? (creating ? `${title} - Creating...` : thinking ? `${title} - Thinking...` : title)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {sourceChannel && SourceChannelIcon ? (
            <span
              aria-hidden="true"
              title={`${sourceChannel.label} channel`}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-black/25 ring-1 ring-white/10"
            >
              <SourceChannelIcon className="h-3 w-3" style={sourceChannel.color ? { color: sourceChannel.color } : undefined} />
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {creating ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-text-muted" aria-label="Creating session">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              <span>Creating...</span>
            </span>
          ) : thinking ? (
            <SessionThinkingIndicator />
          ) : null}
        </span>
      </button>

      <div className="relative h-7 w-7 shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (disabled) return;
            setMenuOpen((open) => !open);
          }}
          disabled={disabled}
          aria-disabled={disabled}
          aria-label={`Session options for ${title}`}
          title={disabledReason}
          className={`flex h-7 w-7 items-center justify-center rounded-full transition-all ${
            disabled
              ? "cursor-not-allowed text-text-muted/30 opacity-0 group-hover/session:opacity-100 focus:opacity-100"
              : `text-text-muted hover:bg-surface-low hover:text-foreground ${menuOpen ? "opacity-100" : "opacity-0 group-hover/session:opacity-100 focus:opacity-100"}`
          }`}
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {menuOpen && !disabled && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-[#242424] py-1 shadow-2xl"
          >
            <SessionMenuButton icon={PenLine} label="Rename" onClick={() => { setMenuOpen(false); onRename(); }} />
            <SessionMenuButton icon={ArrowRight} label="Move to channels" disabled onClick={() => undefined} />
            <SessionMenuButton
              icon={Trash2}
              label="Delete"
              danger
              disabled={deleteDisabled}
              disabledReason={deleteDisabledReason}
              onClick={() => { setMenuOpen(false); onDelete(); }}
            />
          </motion.div>
        )}
      </div>
    </div>
  );
}

function RenameSessionDialog({
  session,
  title,
  onClose,
  onSave,
}: {
  session: OpenClawSessionRecord | null;
  title: string;
  onClose: () => void;
  onSave: (sessionKey: string, title: string) => Promise<void>;
}) {
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(title);
    setError(null);
    setSaving(false);
  }, [session?.key, title]);

  if (!session) return null;

  const trimmed = value.trim();
  const canSave = Boolean(trimmed) && trimmed !== title.trim() && !saving;
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(session.key, trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename session.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm" onClick={saving ? undefined : onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      >
        <div className="border-b border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold leading-6 text-foreground">Rename session</h2>
              <p className="mt-2 text-sm text-text-muted">Update this session&apos;s name</p>
            </div>
            <button
              type="button"
              onClick={saving ? undefined : onClose}
              disabled={saving}
              aria-label="Close rename session"
              className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <input
            autoFocus
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
              if (event.key === "Escape" && !saving) onClose();
            }}
            disabled={saving}
            className="mt-4 h-9 w-full rounded-lg border border-border bg-surface-low px-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-border-strong disabled:opacity-60"
          />
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-4 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-9 rounded-lg border border-border px-4 text-sm text-foreground transition-colors hover:bg-surface-low disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void save(); }}
            disabled={!canSave}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[var(--button-primary)] px-4 text-sm font-medium text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save changes
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function DeleteSessionDialog({
  session,
  onClose,
  onDelete,
}: {
  session: OpenClawSessionRecord | null;
  onClose: () => void;
  onDelete: (sessionKey: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDeleting(false);
    setError(null);
  }, [session?.key]);

  if (!session) return null;

  const confirmDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete(session.key);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete session.");
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm" onClick={deleting ? undefined : onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      >
        <div className="border-b border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold leading-6 text-foreground">Delete session?</h2>
              <p className="mt-2 text-sm text-text-muted">This session will be removed from your history.</p>
            </div>
            <button
              type="button"
              onClick={deleting ? undefined : onClose}
              disabled={deleting}
              aria-label="Close delete session"
              className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-4 p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="h-9 rounded-lg border border-border px-4 text-sm text-foreground transition-colors hover:bg-surface-low disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void confirmDelete(); }}
            disabled={deleting}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-destructive/35 bg-destructive/10 px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Delete session
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function AgentWorkspaceSidebar({
  selectedAgent,
  activeTab,
  skillsActive = false,
  knowledgeActive = false,
  tokenUsed,
  tokenLimit,
  disabled = false,
  disabledReason = "Workspace is loading",
  scheduledDisabled = false,
  scheduledDisabledReason = "Scheduled workflows are not available yet.",
  isDesktopViewport,
  onCreateSession,
  onOpenFiles,
  onOpenIntegrations,
  onOpenSkills,
  onOpenKnowledge = () => undefined,
  onOpenScheduled,
  onOpenDesktop,
  onOpenLogs,
  onOpenShell,
  onOpenOpenClaw,
  onOpenSettings,
  onUpgrade,
  renderMobile = false,
  forceExpanded = false,
  fillParent = false,
  onClose,
  sessions,
  sessionsFetched = sessions != null,
  creatingSessionKeys = [],
  thinkingSessionKeys = [],
  selectedSessionKey,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  openingDesktop = false,
}: AgentWorkspaceSidebarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [renameTarget, setRenameTarget] = useState<OpenClawSessionRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OpenClawSessionRecord | null>(null);
  const advancedMenuRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(WORKSPACE_COLLAPSED_KEY) === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(WORKSPACE_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);
  const isCollapsed = forceExpanded ? false : !isDesktopViewport || collapsed;
  const tokensUsed = typeof tokenUsed === "number" && Number.isFinite(tokenUsed) ? Math.max(0, tokenUsed) : null;
  const tokenTotal = tokenLimit && tokenLimit > 0 ? tokenLimit : null;
  const tokenProgress = tokenTotal && tokensUsed != null ? Math.min(100, Math.round((tokensUsed / tokenTotal) * 100)) : 0;
  const tokenUsageLabel = tokenTotal
    ? `${tokensUsed == null ? "--" : formatTokens(tokensUsed)} / ${formatTokens(tokenTotal)}`
    : `${tokensUsed == null ? "0" : formatTokens(tokensUsed)} / --`;
  const hasSelectedAgent = Boolean(selectedAgent);
  const selectedAgentName = selectedAgent?.name?.trim() || selectedAgent?.id || "";
  const sessionsInteractive = hasSelectedAgent && sessionsFetched && !disabled;
  const sessionsDisabledReason = disabled ? disabledReason : sessionsFetched ? undefined : "Sessions are loading.";
  const sortedSessions = useMemo(() => {
    if (!hasSelectedAgent) return [];
    const sessionRecords = (sessions ?? []).filter((session) => session.ephemeral !== true);
    const activeKey = selectedSessionKey?.trim() || "";
    if (!sessionRecords.some(isCanonicalMainSession)) {
      sessionRecords.unshift(selectedSessionRecord("main", 0));
    }
    if (activeKey && !hasSession(sessionRecords, activeKey)) {
      sessionRecords.unshift(selectedSessionRecord(activeKey));
    }
    return sessionRecords.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }, [hasSelectedAgent, sessions, selectedSessionKey]);
  const visibleSessions = showAllRecent ? sortedSessions : sortedSessions.slice(0, 8);
  const hiddenSessionCount = Math.max(0, sortedSessions.length - visibleSessions.length);
  const renameTargetTitle = renameTarget ? sessionTitle(renameTarget) : "";

  const agentState: AgentState | undefined = selectedAgent?.state;
  const noSelectedAgent = !selectedAgent;
  const agentNotRunning = agentState !== "RUNNING";
  const stoppedReason = "Agent must be running";
  const emptyStateReason = "Select or create an agent first.";

  const disabledItemProps = disabled
    ? { disabled: true, disabledReason }
    : noSelectedAgent
      ? { disabled: true, disabledReason: emptyStateReason }
      : {};
  const newSessionDisabledReason = disabled
    ? disabledReason
    : noSelectedAgent
      ? emptyStateReason
      : agentNotRunning
        ? stoppedReason
        : !sessionsFetched
          ? "Sessions are loading."
          : creatingSession
            ? "Creating session..."
            : onCreateSession
              ? undefined
              : "New sessions are unavailable.";
  const showDesktop = Boolean(selectedAgent?.hasDesktop);
  const openDesktopDisabledReason = disabled
    ? disabledReason
    : noSelectedAgent
      ? emptyStateReason
      : agentNotRunning
        ? stoppedReason
        : !selectedAgent?.hostname
          ? "Desktop hostname is not ready."
          : onOpenDesktop
            ? undefined
            : "Desktop is unavailable.";
  const createNewSession = async () => {
    if (newSessionDisabledReason || !onCreateSession) return;
    setCreatingSession(true);
    try {
      await onCreateSession();
    } finally {
      setCreatingSession(false);
    }
  };
  const workspaceItems: WorkspaceItem[] = [
    {
      id: "new-session",
      label: creatingSession ? "Creating Session" : "New Session",
      icon: creatingSession ? Loader2 : Plus,
      busy: creatingSession,
      disabled: Boolean(newSessionDisabledReason),
      disabledReason: newSessionDisabledReason,
      onClick: () => { void createNewSession(); },
    },
    {
      id: "files",
      label: "Files",
      icon: FolderOpen,
      active: activeTab === "files",
      onClick: () => onOpenFiles(),
      ...disabledItemProps,
    },
    { id: "integrations", label: "Integrations", icon: Blocks, active: activeTab === "integrations" && !skillsActive && !knowledgeActive, onClick: onOpenIntegrations, ...disabledItemProps },
    { id: "skills", label: "Skills", icon: Codepen, active: activeTab === "skills" || skillsActive, onClick: onOpenSkills, ...disabledItemProps },
    {
      id: "scheduled",
      label: "Scheduled",
      icon: CalendarClock,
      active: activeTab === "scheduled",
      onClick: onOpenScheduled,
      ...(scheduledDisabled ? { disabled: true, disabledReason: scheduledDisabledReason } : disabledItemProps),
    },
    ...(showDesktop ? [{
      id: "desktop",
      label: openingDesktop ? "Opening Desktop" : "Desktop",
      icon: openingDesktop ? Loader2 : Monitor,
      busy: openingDesktop,
      disabled: Boolean(openDesktopDisabledReason),
      disabledReason: openDesktopDisabledReason,
      onClick: () => {
        if (selectedAgent && onOpenDesktop) void onOpenDesktop(selectedAgent);
      },
    } satisfies WorkspaceItem] : []),
    { id: "knowledge", label: "Workspaces", icon: HardDrive, active: activeTab === "knowledge" || knowledgeActive, onClick: onOpenKnowledge, ...disabledItemProps },
  ];

  const advancedDropdownDisabled = disabled || noSelectedAgent;
  const advancedDropdownDisabledReason = disabled ? disabledReason : emptyStateReason;
  const advancedItemsOpen = advancedOpen && !advancedDropdownDisabled;
  const advancedDisabled = disabled
    ? disabledItemProps
    : noSelectedAgent
      ? { disabled: true, disabledReason: emptyStateReason }
      : agentNotRunning
        ? { disabled: true, disabledReason: stoppedReason }
        : {};
  const advancedItems: WorkspaceItem[] = [
    { id: "logs", label: "Logs", icon: TerminalSquare, active: activeTab === "logs", onClick: onOpenLogs, ...advancedDisabled },
    { id: "shell", label: "Shell", icon: TerminalSquare, active: activeTab === "shell", onClick: onOpenShell, ...advancedDisabled },
    { id: "openclaw", label: "OpenClaw Settings", icon: SlidersHorizontal, active: activeTab === "openclaw", onClick: onOpenOpenClaw, ...(disabled || noSelectedAgent ? { disabled: true, disabledReason: advancedDropdownDisabledReason } : {}) },
    { id: "settings", label: "Settings", icon: Settings, active: activeTab === "settings", onClick: onOpenSettings, ...(disabled || noSelectedAgent ? { disabled: true, disabledReason: advancedDropdownDisabledReason } : {}) },
  ];
  const advancedActive = advancedItems.some((item) => item.active);

  useEffect(() => {
    if (!advancedOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (advancedMenuRef.current && !advancedMenuRef.current.contains(event.target as Node)) setAdvancedOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAdvancedOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [advancedOpen]);

  if (!isDesktopViewport && !renderMobile) return null;

  return (
    <motion.aside
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={`flex ${
        fillParent ? "w-full" : isCollapsed ? "w-12" : "w-52"
      } relative h-full shrink-0 flex-col border-r border-border bg-surface-low transition-[width] duration-200 ease-out`}
    >
      <div
        className={`flex h-14 shrink-0 items-center border-b border-border ${
          isCollapsed ? "justify-center px-0" : "gap-2 px-4"
        }`}
      >
        {!isCollapsed && (
          <div className="min-w-0 flex-1">
            {selectedAgentName ? (
              <p className="truncate text-[13px] font-medium leading-tight text-foreground" title={selectedAgentName}>
                {selectedAgentName}
              </p>
            ) : null}
          </div>
        )}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close workspace sidebar"
            className="flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        ) : isDesktopViewport ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                aria-label={isCollapsed ? "Expand workspace sidebar" : "Collapse workspace sidebar"}
                className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
              >
                {isCollapsed ? <PanelRight className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isCollapsed ? "Expand workspace" : "Collapse workspace"}
            </TooltipContent>
          </Tooltip>
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted"
            title="Workspace navigation"
            aria-hidden="true"
          >
            <PanelRight className={renderMobile ? "h-5 w-5" : "h-4 w-4"} />
          </div>
        )}
      </div>

      <div className={`flex-1 overflow-y-auto py-5 ${isCollapsed ? "px-1.5" : "px-3"}`}>
        {!isCollapsed && (
          <div className="mb-2 flex items-center justify-between gap-2 px-3">
            <p className="text-xs text-text-muted">Agent</p>
          </div>
        )}
        <nav className={`space-y-1 ${isCollapsed ? "flex flex-col items-center" : ""}`}>
          {workspaceItems.map((item) => (
            <WorkspaceButton key={item.id} item={item} collapsed={isCollapsed} mobileMode={renderMobile} />
          ))}
        </nav>

        {!isCollapsed && hasSelectedAgent && sortedSessions.length > 0 && (
          <section className="mt-7">
            <button
              type="button"
              onClick={() => setRecentOpen((open) => !open)}
              className="mb-2 flex w-full items-center justify-between gap-2 px-3 text-left"
            >
              <span className="text-xs text-text-muted">Sessions</span>
              <ChevronUp className={`h-4 w-4 text-foreground transition-transform ${recentOpen ? "" : "rotate-180"}`} />
            </button>
            {recentOpen && (
              <div className="space-y-0.5 border-l border-border pl-1.5">
                {visibleSessions.map((session) => {
                  const title = sessionTitle(session);
                  const sourceChannel = resolveSessionSourceChannel(session.sourceChannelId);
                  const thinking = thinkingSessionKeys.some((sessionKey) => isSessionActive(session, sessionKey, sortedSessions));
                  return (
                    <RecentSessionRow
                      key={session.key}
                      title={title}
                      sourceChannel={sourceChannel}
                      active={isSessionActive(session, selectedSessionKey, sortedSessions)}
                      disabled={!sessionsInteractive}
                      disabledReason={sessionsDisabledReason}
                      deleteDisabled={session.readOnly === true}
                      deleteDisabledReason={session.readOnlyReason ?? "Connected conversations cannot be deleted here."}
                      creating={creatingSessionKeys.some((sessionKey) => sameOpenClawSelectableSessionKey(sessionKey, session.key))}
                      thinking={thinking}
                      onSelect={onSelectSession ? () => onSelectSession(session.key) : undefined}
                      onRename={() => setRenameTarget(session)}
                      onDelete={() => setDeleteTarget(session)}
                    />
                  );
                })}
                {hiddenSessionCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllRecent(true)}
                    className="px-3 py-1.5 text-left text-[13px] text-text-muted transition-colors hover:text-foreground"
                  >
                    Show more
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      <RenameSessionDialog
        session={renameTarget}
        title={renameTargetTitle}
        onClose={() => setRenameTarget(null)}
        onSave={async (sessionKey, title) => {
          if (!onRenameSession) throw new Error("Rename is unavailable.");
          await onRenameSession(sessionKey, title);
        }}
      />
      <DeleteSessionDialog
        session={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDelete={async (sessionKey) => {
          if (!onDeleteSession) throw new Error("Delete is unavailable.");
          await onDeleteSession(sessionKey);
        }}
      />

      <div ref={advancedMenuRef} className={`relative border-b border-border pb-4 ${isCollapsed ? "px-1.5" : "px-3"}`}>
        {isCollapsed ? (
          <div className="flex justify-center">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={advancedDropdownDisabled ? undefined : () => setAdvancedOpen((open) => !open)}
                  disabled={advancedDropdownDisabled}
                  aria-label="Advanced"
                  aria-expanded={advancedItemsOpen}
                  aria-haspopup="menu"
                  aria-disabled={advancedDropdownDisabled}
                  title={advancedDropdownDisabled ? advancedDropdownDisabledReason : undefined}
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm transition-colors ${
                    advancedDropdownDisabled
                      ? "cursor-not-allowed text-text-muted/45"
                      : advancedItemsOpen || advancedActive
                        ? "bg-surface-low text-foreground"
                        : "text-text-secondary hover:bg-surface-low/60 hover:text-foreground"
                  }`}
                >
                  <Settings className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Advanced</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <button
            type="button"
            onClick={advancedDropdownDisabled ? undefined : () => setAdvancedOpen((open) => !open)}
            disabled={advancedDropdownDisabled}
            aria-expanded={advancedItemsOpen}
            aria-haspopup="menu"
            aria-disabled={advancedDropdownDisabled}
            title={advancedDropdownDisabled ? advancedDropdownDisabledReason : undefined}
            className={`flex ${renderMobile ? "h-10 rounded-full px-3.5" : "h-9 rounded-full px-3"} w-full items-center justify-between text-sm transition-colors ${
              advancedDropdownDisabled
                ? "cursor-not-allowed text-text-muted/45"
                : advancedItemsOpen || advancedActive
                  ? "bg-surface-low text-foreground"
                  : "text-foreground hover:bg-surface-low/60"
            }`}
          >
            <span className={`inline-flex items-center ${renderMobile ? "gap-3.5" : "gap-3"}`}>
              <Settings className={renderMobile ? "h-5 w-5" : "h-4 w-4"} />
              Advanced
            </span>
            <ChevronUp className={`${renderMobile ? "h-5 w-5" : "h-4 w-4"} transition-transform ${advancedItemsOpen ? "rotate-180" : ""}`} />
          </button>
        )}

        {advancedItemsOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97, x: isCollapsed ? -4 : 0, y: isCollapsed ? 0 : 4 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            transition={{ duration: 0.12 }}
            role="menu"
            className={`absolute z-50 overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-[0_18px_55px_color-mix(in_srgb,var(--foreground)_14%,transparent)] ring-1 ring-border ${
              isCollapsed
                ? "bottom-4 left-full ml-2 w-52"
                : renderMobile
                  ? "bottom-full left-3 right-3 mb-2"
                  : "bottom-full left-3 mb-2 w-52"
            }`}
          >
            <p className="px-2.5 pb-1 pt-1.5 text-xs leading-5 text-text-muted">Advanced</p>
            <div className="space-y-0.5">
              {advancedItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={item.disabled ? undefined : () => {
                    setAdvancedOpen(false);
                    item.onClick();
                  }}
                  disabled={item.disabled}
                  aria-disabled={item.disabled}
                  title={item.disabledReason}
                  className={`block w-full whitespace-nowrap rounded-full px-2.5 py-1.5 text-left text-sm leading-5 transition-colors ${
                    item.disabled
                      ? "cursor-not-allowed text-text-muted/45"
                      : item.active
                        ? "bg-surface-low text-foreground"
                        : "text-foreground hover:bg-surface-low"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      <div className={isCollapsed ? "p-1.5" : "p-3"}>
        {isCollapsed ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onUpgrade}
                aria-label={`Tokens today: ${tokenUsageLabel}`}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
              >
                <Sparkles className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Tokens today: {tokenUsageLabel}</TooltipContent>
          </Tooltip>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-text-muted">Tokens today</span>
              <span className="font-medium text-foreground">{tokenUsageLabel}</span>
            </div>
            <div className="h-1 rounded-full bg-surface-low">
              <div className="h-full rounded-full bg-foreground/45" style={{ width: `${tokenProgress}%` }} />
            </div>
            <button
              type="button"
              onClick={onUpgrade}
              className={`flex w-full items-center justify-center gap-2 border border-border bg-background font-medium text-foreground transition-colors hover:bg-surface-low ${
                renderMobile ? "h-10 rounded-full text-sm" : "h-8 rounded-full text-xs"
              }`}
            >
              <Sparkles className={renderMobile ? "h-5 w-5" : "h-3.5 w-3.5"} />
              Upgrade
            </button>
          </div>
        )}
      </div>
    </motion.aside>
  );
}
