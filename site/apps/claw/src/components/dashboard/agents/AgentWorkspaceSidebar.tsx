"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Blocks,
  CalendarClock,
  Check,
  ChevronUp,
  ChevronsUpDown,
  Codepen,
  Command,
  FolderOpen,
  Loader2,
  Monitor,
  MoreVertical,
  PanelLeft,
  PanelRight,
  PenLine,
  Pin,
  PinOff,
  Plus,
  Settings,
  Sparkles,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";

import type { Agent, AgentState } from "@/app/dashboard/agents/types";
import { HyperCLILogoMark } from "@/components/HyperCLILogoLink";
import type { AgentMainTab } from "@/components/dashboard/DashboardMobileAgentMenuContext";
import { PulsingDotIndicator } from "@/components/dashboard/PulsingDotIndicator";
import { resolveSessionSourceChannel, type SessionSourceChannel } from "@/components/dashboard/session-source-channel";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@hypercli/shared-ui";
import { Tooltip, TooltipContent, TooltipHint, TooltipTrigger } from "@/components/ClawTooltip";
import { useWorkspace, workspaceDisplayName } from "@/components/dashboard/WorkspaceContext";
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
  activeTab: AgentMainTab | null;
  skillsActive?: boolean;
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
  onOpenScheduled: () => void;
  onOpenDesktop?: (agent: Agent) => Promise<void> | void;
  onOpenLogs: () => void;
  onOpenShell: () => void;
  onOpenOpenClaw: () => void;
  onOpenSettings: () => void;
  onUpgrade: () => void;
  renderMobile?: boolean;
  forceExpanded?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  fillParent?: boolean;
  embeddedInNavigation?: boolean;
  onClose?: () => void;
  sessions?: OpenClawSessionRecord[] | null;
  sessionsFetched?: boolean;
  sessionsUnavailableReason?: string;
  creatingSessionKeys?: string[];
  thinkingSessionKeys?: string[];
  selectedSessionKey?: string | null;
  pinnedSessionKeys?: readonly string[];
  onSelectSession?: (sessionKey: string) => void;
  onSetSessionPinned?: (sessionKey: string, pinned: boolean) => void;
  onRenameSession?: (sessionKey: string, title: string) => Promise<void> | void;
  onDeleteSession?: (sessionKey: string) => Promise<void> | void;
  openingDesktop?: boolean;
  showDesktop?: boolean;
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
  navigationMode = false,
}: {
  item: WorkspaceItem;
  collapsed?: boolean;
  mobileMode?: boolean;
  navigationMode?: boolean;
}) {
  const Icon = item.icon;
  const disabled = Boolean(item.disabled);
  const buttonSizeClass = collapsed
    ? "h-9 w-9 justify-center"
    : mobileMode
      ? "h-10 w-full gap-3.5 px-3.5 text-left"
      : navigationMode
        ? "h-9 w-full gap-3 px-3 text-left"
        : "h-7 w-full gap-2 px-2 text-left";
  const iconClassName = `${mobileMode && !collapsed ? "h-5 w-5" : "h-4 w-4"} shrink-0 ${item.busy ? "animate-spin" : ""}`;
  const roundedClassName = "rounded-full";
  const buttonClassName = `flex ${buttonSizeClass} items-center ${roundedClassName} text-sm transition-colors ${
    disabled
      ? `${item.busy ? "cursor-wait" : "cursor-not-allowed"} text-text-muted/45`
      : item.active
        ? mobileMode
          ? "border border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]"
          : "bg-surface-low text-foreground"
        : `${mobileMode ? "border border-transparent" : ""} text-text-secondary hover:bg-surface-low/60 hover:text-foreground`
  }`;

  if (collapsed) {
    return (
      <Tooltip>
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
  const button = (
    <button
      type="button"
      onClick={disabled ? undefined : () => item.onClick()}
      disabled={disabled}
      aria-disabled={disabled}
      aria-busy={item.busy || undefined}
      className={buttonClassName}
    >
      <Icon className={iconClassName} />
      <span className="truncate">{item.label}</span>
    </button>
  );
  return item.disabledReason ? (
    <TooltipHint label={item.disabledReason} disabled={disabled} side="right" triggerClassName="w-full">
      {button}
    </TooltipHint>
  ) : button;
}

function SessionThinkingIndicator() {
  return (
    <PulsingDotIndicator className="ml-1.5 shrink-0 align-middle" aria-label="Session is thinking" />
  );
}

function sessionTitle(session: OpenClawSessionRecord): string {
  return displayOpenClawSessionName(session);
}

function isUnresolvedPlaceholderSession(session: OpenClawSessionRecord): boolean {
  const fallbackTitle = fallbackOpenClawSessionDisplayName(session.key);
  return (fallbackTitle === "Main Session" || fallbackTitle === "New Session") &&
    sessionTitle(session) === fallbackTitle;
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

function isSessionPinned(sessionKey: string, pinnedSessionKeys: readonly string[]): boolean {
  return pinnedSessionKeys.some((pinnedSessionKey) => sameOpenClawSelectableSessionKey(pinnedSessionKey, sessionKey));
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
  const button = (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
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
  return disabledReason ? (
    <TooltipHint label={disabledReason} disabled={disabled} side="right" triggerClassName="w-full">
      {button}
    </TooltipHint>
  ) : button;
}

function RecentSessionRow({
  title,
  sourceChannel,
  active,
  pinned,
  onSelect,
  onSetPinned,
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
  pinned: boolean;
  onSelect?: () => void;
  onSetPinned?: (pinned: boolean) => void;
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
  const [unpinAnimating, setUnpinAnimating] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const SourceChannelIcon = sourceChannel?.Icon;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  const tooltipLabel = disabledReason ?? [
    title,
    sourceChannel ? `${sourceChannel.label} channel` : null,
    pinned ? "Pinned session" : null,
    creating ? "Creating..." : thinking ? "Thinking..." : null,
  ].filter(Boolean).join(" - ");

  return (
    <motion.div
      layout={reduceMotion ? false : "position"}
      transition={{
        layout: reduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 520, damping: 36, mass: 0.65 },
      }}
      data-session-pinned={pinned ? "true" : "false"}
      className={`group/session relative isolate flex w-full min-w-0 items-center ${menuOpen ? "z-40" : "z-0"}`}
    >
      <AnimatePresence initial={false}>
        {pinned && !reduceMotion ? (
          <motion.span
            key="pin-sweep"
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 right-8 z-0 rounded-full bg-[linear-gradient(90deg,transparent,rgb(var(--selection-accent-rgb)_/_0.24),transparent)]"
            initial={{ opacity: 0, scaleX: 0.35, x: "-28%" }}
            animate={{ opacity: [0, 1, 0], scaleX: [0.35, 1, 0.85], x: ["-28%", "4%", "18%"] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.58, ease: [0.2, 0.75, 0.25, 1] }}
          />
        ) : null}
      </AnimatePresence>
      <TooltipHint
        label={tooltipLabel}
        disabled={disabled}
        side="right"
        triggerClassName="min-w-0 flex-1"
      >
        <button
          type="button"
          onClick={disabled ? undefined : onSelect}
          disabled={disabled}
          aria-label={title}
          aria-disabled={disabled}
          aria-current={active ? "page" : undefined}
          aria-busy={creating || thinking || undefined}
          className={`relative z-10 min-w-0 flex-1 rounded-full px-2 py-1.5 text-left text-[13px] leading-4 transition-colors ${
            disabled
              ? "cursor-not-allowed text-text-muted/45"
              : active
                ? "bg-surface-low text-foreground"
                : "text-text-secondary hover:bg-surface-low/60 hover:text-foreground"
          }`}
        >
        <span className="flex min-w-0 items-center gap-1.5">
          {sourceChannel && SourceChannelIcon ? (
            <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface-high ring-1 ring-border">
              <SourceChannelIcon className="h-3 w-3" style={sourceChannel.color ? { color: sourceChannel.color } : undefined} />
            </span>
          ) : null}
          <span className="relative h-4 min-w-0 flex-1 overflow-hidden">
            <AnimatePresence initial={false}>
              <motion.span
                key={title}
                aria-hidden="true"
                data-session-title={title}
                className="absolute inset-0 block truncate"
                initial={reduceMotion ? false : { opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.2, 0.75, 0.25, 1] }}
              >
                {title}
              </motion.span>
            </AnimatePresence>
          </span>
          {pinned || unpinAnimating ? (
            <span className="relative inline-flex h-3 w-3 shrink-0">
              {pinned ? (
                <motion.span
                  aria-hidden="true"
                  className="absolute inset-0 inline-flex text-[var(--selection-accent)]"
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.25, rotate: -42, y: 4 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
                  transition={reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 650, damping: 20, mass: 0.55 }}
                >
                  <Pin className="h-3 w-3" />
                </motion.span>
              ) : null}
              {unpinAnimating ? (
                <motion.span
                  data-session-unpin-animation="true"
                  aria-hidden="true"
                  className="absolute inset-0 inline-flex text-[var(--selection-accent)]"
                  initial={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
                  animate={reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.35, rotate: 28, y: -5 }}
                  transition={reduceMotion ? { duration: 0 } : { duration: 0.14, ease: "easeOut" }}
                  onAnimationComplete={() => setUnpinAnimating(false)}
                >
                  <Pin className="h-3 w-3" />
                </motion.span>
              ) : null}
            </span>
          ) : null}
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
      </TooltipHint>

      <div
        ref={menuRef}
        data-session-options
        className="pointer-events-none absolute right-0 top-1/2 z-20 h-7 w-7 -translate-y-1/2 group-hover/session:pointer-events-auto focus-within:pointer-events-auto"
      >
        <TooltipHint label={disabledReason ?? `Session options for ${title}`} disabled={disabled} side="right">
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
            className={`flex h-7 w-7 items-center justify-center rounded-full bg-surface-low/95 transition-all ${
              disabled
                ? "cursor-not-allowed text-text-muted/30 opacity-0 group-hover/session:opacity-100 focus:opacity-100"
                : `text-text-muted hover:bg-surface-low hover:text-foreground ${menuOpen ? "opacity-100" : "opacity-0 group-hover/session:opacity-100 focus:opacity-100"}`
            }`}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </TooltipHint>

        {menuOpen && !disabled && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.1 }}
            className="absolute right-0 top-full z-50 mt-1 w-[11.5rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-2xl"
          >
            {onSetPinned ? (
              <SessionMenuButton
                icon={pinned ? PinOff : Pin}
                label={pinned ? "Unpin" : "Pin"}
                onClick={() => {
                  setMenuOpen(false);
                  setUnpinAnimating(pinned);
                  onSetPinned(!pinned);
                }}
              />
            ) : null}
            <SessionMenuButton icon={PenLine} label="Rename" onClick={() => { setMenuOpen(false); onRename(); }} />
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
    </motion.div>
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
  const titleId = React.useId();

  useEffect(() => {
    setDeleting(false);
    setError(null);
  }, [session?.key]);

  if (!session || typeof document === "undefined") return null;

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

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm" onClick={deleting ? undefined : onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="isolate w-full max-w-md overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
      >
        <div className="border-b border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={titleId} className="text-lg font-semibold leading-6 text-foreground">Delete session?</h2>
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
    </div>,
    document.body,
  );
}

type WorkspaceInviteRole = "viewer" | "contributor" | "admin";
type WorkspaceDialogStep = "details" | "members";
type WorkspaceInviteMode = "email" | "uuid";

const WORKSPACE_ROLE_OPTIONS: Array<{ value: WorkspaceInviteRole; label: string }> = [
  { value: "viewer", label: "Viewer" },
  { value: "contributor", label: "Member" },
  { value: "admin", label: "Admin" },
];
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

// Email delivery will replace this callback when the Workspace service exposes invitations.
function mockWorkspaceEmailInvites(
  _workspaceId: string,
  _emails: string[],
  _role: WorkspaceInviteRole,
): Promise<void> {
  return Promise.resolve();
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreate,
  onGrantByUuid,
  onInviteByEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; description?: string }) => Promise<{ id: string }>;
  onGrantByUuid: (workspaceId: string, userId: string, role: WorkspaceInviteRole) => Promise<unknown>;
  onInviteByEmail: (workspaceId: string, emails: string[], role: WorkspaceInviteRole) => Promise<unknown>;
}) {
  const [step, setStep] = useState<WorkspaceDialogStep>("details");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [inviteMode, setInviteMode] = useState<WorkspaceInviteMode>("email");
  const [emails, setEmails] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState("");
  const [userUuid, setUserUuid] = useState("");
  const [role, setRole] = useState<WorkspaceInviteRole>("contributor");
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep("details");
    setName("");
    setDescription("");
    setInviteMode("email");
    setEmails([]);
    setEmailDraft("");
    setUserUuid("");
    setRole("contributor");
    setCreatedWorkspaceId(null);
    setSubmitting(false);
    setError(null);
  };
  const close = () => {
    if (submitting) return;
    reset();
    onOpenChange(false);
  };

  const addEmailAddresses = (value: string): boolean => {
    const additions = value
      .split(/[,;\n]/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    const invalidEmail = additions.find((email) => !EMAIL_ADDRESS_PATTERN.test(email));
    if (invalidEmail) {
      setError(`Enter a valid email address for ${invalidEmail}.`);
      return false;
    }
    if (additions.length > 0) setEmails((current) => uniqueValues([...current, ...additions]));
    setError(null);
    return true;
  };

  const updateEmailDraft = (value: string) => {
    if (!/[,;\n]/.test(value)) {
      setEmailDraft(value);
      return;
    }
    const parts = value.split(/[,;\n]/);
    const trailing = parts.pop() ?? "";
    if (addEmailAddresses(parts.join(","))) setEmailDraft(trailing.trimStart());
  };

  const commitEmailDraft = (): boolean => {
    if (!emailDraft.trim()) return true;
    if (!addEmailAddresses(emailDraft)) return false;
    setEmailDraft("");
    return true;
  };

  const continueToMembers = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || submitting) return;
    setError(null);
    setStep("members");
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const workspaceName = name.trim();
    if (!workspaceName || submitting || !commitEmailDraft()) return;
    const resolvedEmails = uniqueValues([
      ...emails,
      ...emailDraft.split(/[,;\n]/).map((email) => email.trim().toLowerCase()).filter(Boolean),
    ]);
    const resolvedUserUuid = userUuid.trim();
    setSubmitting(true);
    setError(null);
    try {
      let workspaceId = createdWorkspaceId;
      if (!workspaceId) {
        const created = await onCreate({
          name: workspaceName,
          description: description.trim() || undefined,
        });
        workspaceId = created.id;
        setCreatedWorkspaceId(workspaceId);
      }
      if (resolvedEmails.length > 0) await onInviteByEmail(workspaceId, resolvedEmails, role);
      if (resolvedUserUuid) await onGrantByUuid(workspaceId, resolvedUserUuid, role);
      reset();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to finish setting up the Workspace.");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (nextOpen) onOpenChange(true); else close(); }}>
      <DialogContent closeLabel="Close new Workspace" overlayClassName="z-[89] bg-black/60 backdrop-blur-sm" className="z-[90] gap-0 overflow-hidden rounded-2xl border-border bg-background p-0 shadow-2xl sm:max-w-[540px]">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-base">{step === "details" ? "New Workspace" : "Invite team members"}</DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed text-text-muted">
            {step === "details"
              ? "Create a shared space for knowledge, members, and agents."
              : "Add people who should collaborate in this Workspace, or skip this step for now."}
          </DialogDescription>
        </DialogHeader>
        {step === "details" ? (
          <form onSubmit={continueToMembers}>
            <div className="space-y-4 px-5 py-5">
              <div className="space-y-1.5">
                <Label htmlFor="workspace-name" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Workspace name</Label>
                <Input id="workspace-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} disabled={submitting} className="h-10 rounded-xl bg-surface-low/35 text-[13px]" placeholder="Product operations" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="workspace-description" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Description <span className="normal-case tracking-normal">(optional)</span></Label>
                <Textarea id="workspace-description" value={description} onChange={(event) => setDescription(event.target.value)} disabled={submitting} rows={3} className="min-h-[84px] rounded-xl bg-surface-low/35 text-[13px] leading-relaxed" placeholder="What belongs in this Workspace?" />
              </div>
              {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            </div>
            <DialogFooter className="border-t border-border px-5 py-4">
              <Button type="button" variant="outline" onClick={close} disabled={submitting} className="rounded-xl text-xs">Cancel</Button>
              <Button type="submit" disabled={!name.trim() || submitting} className="rounded-xl text-xs">Continue</Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={(event) => { void submit(event); }}>
            <div className="space-y-5 px-5 py-5">
              <Tabs value={inviteMode} onValueChange={(value) => { setInviteMode(value as WorkspaceInviteMode); setError(null); }}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="email">Email invite</TabsTrigger>
                  <TabsTrigger value="uuid">User UUID</TabsTrigger>
                </TabsList>
                <TabsContent value="email" className="space-y-2 pt-2">
                  <Label htmlFor="workspace-member-emails">Email addresses</Label>
                  {emails.length > 0 ? (
                    <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface-low/25 p-2.5">
                      {emails.map((email) => (
                        <Badge key={email} variant="outline" className="gap-1 rounded-lg py-1 pl-2.5 pr-1 font-normal">
                          {email}
                          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${email}`} onClick={() => setEmails((current) => current.filter((item) => item !== email))} disabled={submitting} className="size-5 rounded-md p-0">
                            <X className="size-3" />
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <Input
                    id="workspace-member-emails"
                    autoFocus
                    type="email"
                    inputMode="email"
                    multiple
                    value={emailDraft}
                    onChange={(event) => updateEmailDraft(event.target.value)}
                    onBlur={() => { commitEmailDraft(); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitEmailDraft();
                      }
                    }}
                    disabled={submitting}
                    className="h-11 rounded-xl"
                    placeholder="Separate emails with commas"
                  />
                  <p className="text-[11px] leading-relaxed text-text-muted">Add several addresses with commas. Email delivery is being connected separately.</p>
                </TabsContent>
                <TabsContent value="uuid" className="space-y-2 pt-2">
                  <Label htmlFor="workspace-member-uuid">User UUID</Label>
                  <Input id="workspace-member-uuid" autoFocus value={userUuid} onChange={(event) => setUserUuid(event.target.value)} disabled={submitting} className="h-11 rounded-xl font-mono text-xs" placeholder="00000000-0000-0000-0000-000000000000" />
                  <p className="text-[11px] leading-relaxed text-text-muted">Adds an existing user immediately. They can copy this value from their Profile settings.</p>
                </TabsContent>
              </Tabs>

              <div className="space-y-1.5">
                <Label htmlFor="workspace-member-role">Workspace role</Label>
                <Select value={role} onValueChange={(value) => setRole(value as WorkspaceInviteRole)} disabled={submitting}>
                  <SelectTrigger id="workspace-member-role" aria-label="Workspace role" className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    {WORKSPACE_ROLE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            </div>
            <DialogFooter className="border-t border-border px-5 py-4">
              <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button type="button" variant="ghost" onClick={() => { setError(null); setStep("details"); }} disabled={submitting} className="rounded-xl text-xs">Back</Button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button type="button" variant="outline" onClick={close} disabled={submitting} className="rounded-xl text-xs">Cancel</Button>
                  <Button type="submit" disabled={submitting} className="rounded-xl text-xs">
                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Create Workspace
                  </Button>
                </div>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceCreationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    principalId,
    workspacesClient,
    createWorkspace,
  } = useWorkspace();
  const workspaceScope = principalId ?? "current";

  return (
    <CreateWorkspaceDialog
      key={workspaceScope}
      open={open}
      onOpenChange={onOpenChange}
      onCreate={createWorkspace}
      onInviteByEmail={mockWorkspaceEmailInvites}
      onGrantByUuid={async (workspaceId, userId, role) => {
        if (!workspacesClient) throw new Error("Workspace access is unavailable right now.");
        await workspacesClient.grant(workspaceId, {
          subjectType: "user",
          subjectId: userId,
          role,
        });
      }}
    />
  );
}

function WorkspacePicker({ sharedHeader = false }: { sharedHeader?: boolean }) {
  const {
    principalId,
    workspacesClient,
    workspaces,
    selectedWorkspace,
    isLoading: workspacesLoading,
    error: workspacesError,
    selectWorkspace,
  } = useWorkspace();
  const workspaceScope = principalId ?? "current";
  const [createWorkspaceScope, setCreateWorkspaceScope] = useState<string | null>(null);
  const currentWorkspaceName = selectedWorkspace
    ? workspaceDisplayName(selectedWorkspace)
    : workspacesLoading
      ? "Loading Workspaces"
      : "No Workspace";

  useEffect(() => {
    if (!createWorkspaceScope || createWorkspaceScope === workspaceScope) return;
    const timeout = window.setTimeout(() => setCreateWorkspaceScope(null), 0);
    return () => window.clearTimeout(timeout);
  }, [createWorkspaceScope, workspaceScope]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Current workspace: ${currentWorkspaceName}`}
            className={`flex min-w-0 flex-1 items-center text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] ${
              sharedHeader
                ? "h-10 gap-2 rounded-xl border border-border bg-background/50 px-2 hover:bg-surface-low"
                : "h-8 gap-2 rounded-lg px-2 hover:bg-surface-low"
            }`}
          >
            {sharedHeader ? (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-low text-text-muted">
                <Command className="h-4 w-4" />
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{currentWorkspaceName}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="w-[280px] rounded-xl border-border bg-popover p-2 shadow-2xl">
          <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            Workspaces
          </DropdownMenuLabel>
          {workspacesLoading && workspaces.length === 0 ? (
            <div role="status" className="mt-1 flex items-center gap-2 px-2 py-3 text-[12px] text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading Workspaces
            </div>
          ) : workspacesError && workspaces.length === 0 ? (
            <div role="alert" className="mx-1 mt-1 rounded-lg border border-destructive/25 bg-destructive/10 px-2.5 py-2 text-[11px] leading-relaxed text-destructive">
              {workspacesError}
            </div>
          ) : workspaces.length === 0 ? (
            <p className="mt-1 px-2 py-3 text-[12px] text-text-muted">No Workspaces available.</p>
          ) : workspaces.map((workspace) => {
            const active = workspace.id === selectedWorkspace?.id;
            const displayName = workspaceDisplayName(workspace);
            return (
              <DropdownMenuItem
                key={workspace.id}
                aria-current={active ? "page" : undefined}
                onSelect={() => selectWorkspace(workspace.id)}
                className="mt-1 flex items-center gap-3 rounded-lg px-2 py-2.5 focus:bg-surface-low"
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[10px] font-semibold ${active ? "border-[rgb(var(--selection-accent-rgb)_/_0.25)] bg-[radial-gradient(circle_at_35%_30%,rgb(var(--selection-accent-rgb)_/_0.95),rgb(var(--selection-accent-rgb)_/_0.35))] text-[var(--selection-accent-foreground)]" : "border-border bg-surface-low text-text-secondary"}`}>
                  {displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{displayName}</span>
                  <span className="block text-[11px] capitalize text-text-muted">{workspace.role ? `${workspace.role} access` : "Available Workspace"}</span>
                </span>
                {active ? <Check className="h-4 w-4 shrink-0 text-[var(--selection-accent)]" /> : null}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator className="my-1.5 bg-border" />
          <DropdownMenuItem
            disabled={!workspacesClient}
            onSelect={() => setCreateWorkspaceScope(workspaceScope)}
            className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-text-secondary focus:bg-surface-low focus:text-foreground"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-low">
              <Plus className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">New Workspace</span>
              <span className="block text-[11px] text-text-muted">Create a shared workspace</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <WorkspaceCreationDialog
        open={createWorkspaceScope === workspaceScope}
        onOpenChange={(open) => setCreateWorkspaceScope(open ? workspaceScope : null)}
      />
    </>
  );
}

export function AgentWorkspaceSidebar({
  selectedAgent,
  activeTab,
  skillsActive = false,
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
  onOpenScheduled,
  onOpenDesktop,
  onOpenLogs,
  onOpenShell,
  onOpenOpenClaw,
  onOpenSettings,
  onUpgrade,
  renderMobile = false,
  forceExpanded = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  fillParent = false,
  embeddedInNavigation = false,
  onClose,
  sessions,
  sessionsFetched = sessions != null,
  sessionsUnavailableReason = "Sessions are loading.",
  creatingSessionKeys = [],
  thinkingSessionKeys = [],
  selectedSessionKey,
  pinnedSessionKeys = [],
  onSelectSession,
  onSetSessionPinned,
  onRenameSession,
  onDeleteSession,
  openingDesktop = false,
  showDesktop = true,
}: AgentWorkspaceSidebarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [renameTarget, setRenameTarget] = useState<OpenClawSessionRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OpenClawSessionRecord | null>(null);
  const advancedMenuRef = useRef<HTMLDivElement | null>(null);
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(WORKSPACE_COLLAPSED_KEY) === "1";
  });
  useEffect(() => {
    if (controlledCollapsed !== undefined || typeof window === "undefined") return;
    window.localStorage.setItem(WORKSPACE_COLLAPSED_KEY, uncontrolledCollapsed ? "1" : "0");
  }, [controlledCollapsed, uncontrolledCollapsed]);
  const collapsed = controlledCollapsed ?? uncontrolledCollapsed;
  const isCollapsed = forceExpanded ? false : !isDesktopViewport || collapsed;
  const toggleCollapsed = () => {
    const nextCollapsed = !collapsed;
    if (controlledCollapsed === undefined) setUncontrolledCollapsed(nextCollapsed);
    onCollapsedChange?.(nextCollapsed);
  };
  const tokensUsed = typeof tokenUsed === "number" && Number.isFinite(tokenUsed) ? Math.max(0, tokenUsed) : null;
  const tokenTotal = tokenLimit && tokenLimit > 0 ? tokenLimit : null;
  const tokenProgress = tokenTotal && tokensUsed != null ? Math.min(100, Math.round((tokensUsed / tokenTotal) * 100)) : 0;
  const tokenUsageLabel = tokenTotal
    ? `${tokensUsed == null ? "--" : formatTokens(tokensUsed)} / ${formatTokens(tokenTotal)}`
    : `${tokensUsed == null ? "--" : formatTokens(tokensUsed)} / --`;
  const hasSelectedAgent = Boolean(selectedAgent);
  const sessionsInteractive = hasSelectedAgent && sessionsFetched && !disabled;
  const sessionsDisabledReason = disabled ? disabledReason : sessionsFetched ? undefined : sessionsUnavailableReason;
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
    return sessionRecords.sort((a, b) => {
      const pinOrder = Number(isSessionPinned(b.key, pinnedSessionKeys)) - Number(isSessionPinned(a.key, pinnedSessionKeys));
      return pinOrder || b.lastMessageAt - a.lastMessageAt;
    });
  }, [hasSelectedAgent, pinnedSessionKeys, sessions, selectedSessionKey]);
  const titledSessions = useMemo(
    () => sessionsFetched ? sortedSessions : sortedSessions.filter((session) => !isUnresolvedPlaceholderSession(session)),
    [sessionsFetched, sortedSessions],
  );
  const visibleSessions = useMemo(() => {
    if (showAllRecent) return titledSessions;
    const pinnedCount = titledSessions.filter((session) => isSessionPinned(session.key, pinnedSessionKeys)).length;
    const visibleCount = Math.max(8, pinnedCount);
    const initialSessions = titledSessions.slice(0, visibleCount);
    const activeSession = titledSessions.find((session) => isSessionActive(session, selectedSessionKey, sortedSessions));
    if (!activeSession || hasSession(initialSessions, activeSession.key)) return initialSessions;
    return titledSessions.filter((session, index) => index < visibleCount || sameOpenClawSelectableSessionKey(session.key, activeSession.key));
  }, [pinnedSessionKeys, selectedSessionKey, showAllRecent, sortedSessions, titledSessions]);
  const hiddenSessionCount = Math.max(0, titledSessions.length - visibleSessions.length);
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
          ? sessionsUnavailableReason
          : creatingSession
            ? "Creating session..."
            : onCreateSession
              ? undefined
              : "New sessions are unavailable.";
  const desktopVisible = showDesktop && Boolean(selectedAgent?.hasDesktop);
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
    { id: "integrations", label: "Integrations", icon: Blocks, active: activeTab === "integrations" && !skillsActive, onClick: onOpenIntegrations, ...disabledItemProps },
    { id: "skills", label: "Skills", icon: Codepen, active: activeTab === "skills" || skillsActive, onClick: onOpenSkills, ...disabledItemProps },
    {
      id: "scheduled",
      label: "Scheduled",
      icon: CalendarClock,
      active: activeTab === "scheduled",
      onClick: onOpenScheduled,
      ...(scheduledDisabled ? { disabled: true, disabledReason: scheduledDisabledReason } : disabledItemProps),
    },
    ...(desktopVisible ? [{
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
      data-collapsed={isCollapsed}
      initial={embeddedInNavigation ? false : { opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={`agent-workspace-shell flex ${
        fillParent ? "w-full" : isCollapsed ? "w-12" : "w-52"
      } relative h-full shrink-0 flex-col bg-surface-low transition-[width] duration-200 ease-out ${embeddedInNavigation ? "" : "border-r border-border"}`}
    >
      {embeddedInNavigation ? (
        <div
          className={`agent-desktop-navigation-header absolute -top-16 z-30 flex h-14 w-64 items-center gap-2 border-b border-r border-border bg-[var(--agent-panel-background)] px-3 transition-[left] duration-200 ease-out ${
            isCollapsed ? "-left-52" : "-left-12"
          }`}
        >
          <Link
            href="/"
            aria-label="HyperCLI home"
            className="flex h-10 w-8 shrink-0 items-center justify-center text-foreground"
          >
            <HyperCLILogoMark className="h-6 w-6" />
          </Link>
          <WorkspacePicker sharedHeader />
        </div>
      ) : (
        <div
          className={`agent-workspace-header flex h-14 shrink-0 items-center border-b border-border ${
            isCollapsed ? "justify-center px-0" : "gap-2 px-4"
          }`}
        >
          {!isCollapsed ? <WorkspacePicker /> : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close workspace sidebar"
              className="flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          ) : isDesktopViewport && !forceExpanded ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleCollapsed}
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
          ) : !isDesktopViewport ? (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted"
              aria-hidden="true"
            >
              <PanelRight className={renderMobile ? "h-5 w-5" : "h-4 w-4"} />
            </div>
          ) : null}
        </div>
      )}

      <div className={`agent-workspace-scroll flex-1 overflow-y-auto ${
        isCollapsed ? `px-1.5 ${embeddedInNavigation ? "py-3" : "py-5"}` : renderMobile ? "px-3 py-5" : "px-3 py-2"
      }`}>
        {!isCollapsed && renderMobile && (
          <div className="mb-2 flex items-center justify-between gap-2 px-3">
            <p className="text-xs text-text-muted">Agent</p>
          </div>
        )}
        <nav className={isCollapsed ? "flex flex-col items-center space-y-1" : renderMobile ? "space-y-1" : "space-y-0"}>
          {workspaceItems.map((item) => (
            <WorkspaceButton key={item.id} item={item} collapsed={isCollapsed} mobileMode={renderMobile} navigationMode={embeddedInNavigation} />
          ))}
        </nav>

        {!isCollapsed && hasSelectedAgent && titledSessions.length > 0 && (
          <section className={renderMobile ? "mt-7" : "mt-2"}>
            <button
              type="button"
              onClick={() => setRecentOpen((open) => !open)}
              className={`flex w-full items-center justify-between gap-2 text-left ${renderMobile ? "mb-2 px-3" : "mb-0.5 px-2"}`}
            >
              <span className="text-xs text-text-muted">Sessions</span>
              <ChevronUp className={`h-4 w-4 text-foreground transition-transform ${recentOpen ? "" : "rotate-180"}`} />
            </button>
            {recentOpen && (
              <div className={renderMobile ? "space-y-0.5 border-l border-border pl-1.5" : "space-y-0.5"}>
                {visibleSessions.map((session) => {
                  const title = sessionTitle(session);
                  const sourceChannel = resolveSessionSourceChannel(session.sourceChannelId);
                  const thinking = thinkingSessionKeys.some((sessionKey) => isSessionActive(session, sessionKey, sortedSessions));
                  const pinned = isSessionPinned(session.key, pinnedSessionKeys);
                  return (
                    <RecentSessionRow
                      key={session.key}
                      title={title}
                      sourceChannel={sourceChannel}
                      active={isSessionActive(session, selectedSessionKey, sortedSessions)}
                      pinned={pinned}
                      disabled={!sessionsInteractive}
                      disabledReason={sessionsDisabledReason}
                      deleteDisabled={session.readOnly === true || isCanonicalMainSession(session)}
                      deleteDisabledReason={isCanonicalMainSession(session)
                        ? "The main session cannot be deleted."
                        : session.readOnlyReason ?? "Connected conversations cannot be deleted here."}
                      creating={creatingSessionKeys.some((sessionKey) => sameOpenClawSelectableSessionKey(sessionKey, session.key))}
                      thinking={thinking}
                      onSelect={onSelectSession ? () => onSelectSession(session.key) : undefined}
                      onSetPinned={onSetSessionPinned ? (nextPinned) => onSetSessionPinned(session.key, nextPinned) : undefined}
                      onRename={() => setRenameTarget(session)}
                      onDelete={() => setDeleteTarget(session)}
                    />
                  );
                })}
                {hiddenSessionCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllRecent(true)}
                    className={`${renderMobile ? "px-3" : "px-2.5"} py-1.5 text-left text-[13px] text-text-muted transition-colors hover:text-foreground`}
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

      <div ref={advancedMenuRef} className={`agent-workspace-advanced relative border-b border-border pb-4 ${isCollapsed ? "px-1.5" : "px-3"}`}>
        {isCollapsed ? (
          <div className="flex justify-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={advancedDropdownDisabled ? undefined : () => setAdvancedOpen((open) => !open)}
                  disabled={advancedDropdownDisabled}
                  aria-label="Advanced"
                  aria-expanded={advancedItemsOpen}
                  aria-haspopup="menu"
                  aria-disabled={advancedDropdownDisabled}
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
              <TooltipContent side="right">{advancedDropdownDisabled ? advancedDropdownDisabledReason : "Advanced"}</TooltipContent>
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
            className={`absolute z-50 overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-[0_14px_40px_color-mix(in_srgb,var(--foreground)_7%,transparent)] ring-1 ring-border/40 ${
              isCollapsed
                 ? "bottom-4 left-full ml-2 w-52"
                 : renderMobile
                   ? "bottom-full left-3 right-3 mb-2"
                  : "bottom-full left-3 right-3 mb-2"
             }`}
          >
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

      <div className={`agent-workspace-usage ${isCollapsed ? "p-1.5" : "p-3"}`}>
        {isCollapsed ? (
          <Tooltip>
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
