"use client";

import Link from "next/link";
import React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, ArrowLeft, ArrowRight, BarChart3, Blocks, CalendarClock, Check, Codepen, Copy, FolderOpen, House, KeyRound, LibraryBig, Loader2, LogOut, MessageSquare, Monitor, PanelRight, Plus, Play, RotateCcw, Send, SlidersHorizontal, Sparkles, Square, UsersRound, X } from "lucide-react";
import type { HyperAgentPlan, HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";
import type { AgentChannelSummary } from "@hypercli.com/sdk/channels";
import { buildHostedSlackLaunchEnv, HOSTED_SLACK_LAUNCH_ENV_KEYS } from "@hypercli.com/sdk/channels";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import { Button, Input, Switch, writeClipboardText } from "@hypercli/shared-ui";

import type { Agent, JsonObject } from "@/app/dashboard/agents/types";
import { isAgentDeletable, isAgentOffline, isAgentStartable, isAgentStoppable, isAgentTransitionalState } from "@/app/dashboard/agents/types";
import { SLACK_APP_HANDLE, SLACK_RELAY_BASE_URL } from "@/lib/api";
import { asObject, getOpenClawUiHint, humanizeKey } from "@/lib/openclaw-config";
import { Tooltip, TooltipContent, TooltipHint, TooltipTrigger } from "@/components/ClawTooltip";
import { AgentCardTooltip, type AgentCardTooltipData } from "@/components/dashboard/modules/AgentCardModule";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { AgentsChannelsSidebar, AgentsSidebarDashboardLinks, RosterNavigationItem, type ConversationThread } from "@/components/dashboard/AgentsChannelsSidebar";
import { FilePreview, type FileEntry } from "@hypercli/shared-ui/files";
import { HyperCLILogoMark } from "@/components/HyperCLILogoLink";
import { ResourceImage } from "@/components/ResourceImage";
import { createAgentClient, createBrowserHyperCLIClient, waitForCreatedAgentStopped } from "@/lib/agent-client";
import { displayNameFromAgentHandle, normalizeAgentHandle } from "@/lib/agent-profile-updates";
import { describeStarterFileFailures, stageAgentStarterFilesAndStart } from "@/lib/agent-starter-files";
import { useAgentRosterOrder } from "@/hooks/useAgentRosterOrder";
import { useAgentRosterShowOffline } from "@/hooks/useAgentRosterShowOffline";
import {
  buildOpenClawLaunchOptions,
  buildOpenClawMemoryIndexEnv,
  buildOpenClawWorkspacesSyncEnv,
  type OpenClawWorkspacesSyncOptions,
} from "@/lib/openclaw-launch";
import { agentAvatar, agentProfileImageUrl } from "@/lib/avatar";
import { parseAgentCapacityError } from "@/lib/agent-tier";
import type { WorkspaceFile } from "@/lib/openclaw-chat";
import type { ActivityEntry } from "@/lib/openclaw-session";
import {
  buildOpenClawDefaultModelPatch,
  getOpenClawDefaultModel,
  normalizeOpenClawModelOptions,
  type OpenClawModelOption,
} from "@/lib/openclaw-models";
import { OpenClawErrorBoundary } from "./page-helpers";
import { AgentCreationSetupWizard, type AgentCreationSetupCreateParams } from "./AgentCreationSetupWizard";
import { AgentSettingsMobileChrome } from "./AgentSettingsMobileChrome";
import { AgentTeamSettingsContent } from "./AgentTeamSettingsContent";
import { getAgentGatewayPanelBootStatus } from "./chat-boot-stage";
import { DASHBOARD_VIEW_HREFS, KNOWLEDGE_HUB_HREF } from "@/lib/dashboard-route";
import { agentDisplayLabel } from "./agentViewModel";
import { AgentChatComposerShell } from "./AgentChatComposerShell";
import { AgentFeatureEmptyState } from "./AgentFeatureEmptyState";

interface SessionLike {
  connected: boolean;
  connecting: boolean;
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  models: unknown[];
  saveConfig: (patch: Record<string, unknown>) => Promise<void>;
  saveFullConfig: (config: Record<string, unknown>) => Promise<void>;
  channelsStatus: (probe?: boolean, timeoutMs?: number) => Promise<Record<string, any>>;
  activityFeed: ActivityEntry[];
  files: WorkspaceFile[];
}

interface OpenClawConfigPanelProps {
  open?: boolean;
  agent: Agent | null;
  onClose?: () => void;
  embedded?: boolean;
  openclawSections: Array<[string, unknown]>;
  openclawSchemaBundle: OpenClawConfigSchemaResponse | null;
  effectiveOpenclawSection: string | null;
  setActiveOpenclawSection: (section: string) => void;
  activeOpenclawSectionLabel: string | null;
  openclawSaving: boolean;
  openclawDraft: JsonObject | null;
  openclawError: string | null;
  openclawSuccess: string | null;
  chat: SessionLike;
  visibleOpenclawSections: Array<[string, unknown]>;
  renderOpenclawField: (schemaRaw: unknown, path: string[], depth?: number) => React.ReactNode;
  saveOpenclawSection: (sectionKey: string) => Promise<void>;
  saveAllOpenclaw: () => Promise<void>;
  openclawPaneRef: React.RefObject<HTMLDivElement | null>;
  isDesktopViewport?: boolean;
}

export function OpenClawConfigPanel({
  open = true,
  agent,
  onClose,
  embedded = false,
  openclawSaving,
  openclawDraft,
  openclawError,
  openclawSuccess,
  chat,
}: OpenClawConfigPanelProps) {
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = React.useState<string | null>(null);
  const [localSaving, setLocalSaving] = React.useState(false);
  const configBootStatus = getAgentGatewayPanelBootStatus({
    connected: chat.connected,
    connecting: chat.connecting,
    loadingTitle: "Loading settings",
    loadingDetail: "Reading OpenClaw settings.",
    connectingDetail: "Opening the settings workspace.",
    waitingDetail: "Reconnect the gateway before editing openclaw.json.",
  });
  const editorContent = React.useMemo(() => JSON.stringify(openclawDraft ?? {}, null, 2), [openclawDraft]);
  const editorEntry = React.useMemo<FileEntry>(() => ({
    name: "openclaw.json",
    path: "openclaw.json",
    type: "file",
    size: editorContent.length,
  }), [editorContent]);

  React.useEffect(() => {
    if (!open) {
      setLocalError(null);
      setLocalSuccess(null);
      setLocalSaving(false);
    }
  }, [open]);

  const saveOpenclawJson = React.useCallback(async (_path: string, content: string) => {
    setLocalError(null);
    setLocalSuccess(null);

    if (!chat.connected) {
      setLocalError("Gateway disconnected. Reconnect before editing openclaw.json.");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      setLocalError(error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON");
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setLocalError("openclaw.json must contain a JSON object.");
      return;
    }

    setLocalSaving(true);
    try {
      await chat.saveFullConfig(parsed as Record<string, unknown>);
      setLocalSuccess("Saved openclaw.json");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Failed to save openclaw.json");
    } finally {
      setLocalSaving(false);
    }
  }, [chat]);

  const effectiveError = localError ?? openclawError;
  const effectiveSuccess = localSuccess ?? openclawSuccess;
  const saving = openclawSaving || localSaving;

  if (!open || !agent) return null;

  return (
    <div className={`flex h-full min-h-0 flex-col bg-background ${embedded ? "rounded-lg border border-border" : ""}`}>
      <div className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-border px-4">
        <SlidersHorizontal className="h-4 w-4 text-[var(--selection-accent)]" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">OpenClaw Config</p>
          <p className="text-[10px] text-text-muted">Editing openclaw.json</p>
        </div>
        <div className="flex-1" />
        {saving && <p className="text-[10px] text-text-muted">Saving openclaw.json</p>}
        {onClose && (
          <TooltipHint label="Close OpenClaw config">
            <button type="button" aria-label="Close OpenClaw config" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipHint>
        )}
      </div>
      {(effectiveError || effectiveSuccess) && (
        <div className="flex-shrink-0 space-y-2 border-b border-border px-4 py-3">
          {effectiveError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{effectiveError}</div>
          )}
          {effectiveSuccess && !effectiveError && (
            <div className="rounded-lg border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-3 py-2 text-sm text-[var(--selection-accent)]">{effectiveSuccess}</div>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <FilePreview
          key={agent.id}
          entry={editorEntry}
          content={editorContent}
          loading={chat.connecting && !chat.connected}
          error={null}
          readOnly={!chat.connected}
          readOnlyLabel="Disconnected"
          readOnlyDescription={configBootStatus?.detail ?? "Reconnect the gateway before editing openclaw.json."}
          onClose={onClose ?? (() => {})}
          showClose={Boolean(onClose)}
          onSave={chat.connected ? saveOpenclawJson : undefined}
        />
      </div>
    </div>
  );
}

function openclawSectionLabel(
  schemaBundle: OpenClawConfigSchemaResponse | null,
  sectionKey: string,
  sectionSchema: unknown,
): string {
  const hint = getOpenClawUiHint(schemaBundle, [sectionKey]);
  return hint?.label?.trim() ||
    (typeof asObject(sectionSchema)?.title === "string"
      ? String(asObject(sectionSchema)?.title)
      : humanizeKey(sectionKey));
}

function openclawSectionDescription(
  schemaBundle: OpenClawConfigSchemaResponse | null,
  sectionKey: string,
  sectionSchema: unknown,
  fallback = "",
): string {
  const hint = getOpenClawUiHint(schemaBundle, [sectionKey]);
  return hint?.help?.trim() ||
    (typeof asObject(sectionSchema)?.description === "string"
      ? String(asObject(sectionSchema)?.description)
      : fallback);
}

export function OpenClawSettingsPanel({
  open = true,
  agent,
  onClose,
  openclawSections,
  openclawSchemaBundle,
  effectiveOpenclawSection,
  setActiveOpenclawSection,
  activeOpenclawSectionLabel,
  openclawSaving,
  openclawDraft,
  openclawError,
  openclawSuccess,
  chat,
  visibleOpenclawSections,
  renderOpenclawField,
  saveOpenclawSection,
  saveAllOpenclaw,
  openclawPaneRef,
  isDesktopViewport = true,
}: OpenClawConfigPanelProps) {
  const [mobileSectionsOpen, setMobileSectionsOpen] = React.useState(true);
  const hasSections = openclawSections.length > 0;
  const saveLabel = effectiveOpenclawSection ? "Save Section" : "Save All";
  const settingsBootStatus = getAgentGatewayPanelBootStatus({
    connected: chat.connected,
    connecting: chat.connecting,
    loading: chat.connected && !openclawSchemaBundle,
    loadingTitle: "Loading settings",
    loadingDetail: "Reading OpenClaw settings.",
    connectingDetail: "Opening the settings workspace.",
    waitingDetail: "Connect the agent gateway to edit OpenClaw settings.",
  });

  React.useEffect(() => {
    if (isDesktopViewport) setMobileSectionsOpen(false);
  }, [isDesktopViewport]);

  if (!open || !agent) return null;

  const sectionList = (
    <div className="space-y-1">
      {openclawSections.map(([sectionKey, sectionSchema]) => {
        const sectionLabel = openclawSectionLabel(openclawSchemaBundle, sectionKey, sectionSchema);
        const sectionDescription = openclawSectionDescription(openclawSchemaBundle, sectionKey, sectionSchema, sectionKey);
        const selected = effectiveOpenclawSection === sectionKey;
        return (
          <TooltipHint key={`openclaw-section-${sectionKey}`} label={sectionDescription} side="right">
            <button
              type="button"
              onClick={() => {
                setActiveOpenclawSection(sectionKey);
                setMobileSectionsOpen(false);
              }}
              className={`block w-full rounded-lg border px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected
                  ? "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] font-medium text-foreground"
                  : "border-transparent text-text-muted hover:bg-surface-low/50 hover:text-foreground"
              }`}
            >
              <span className="block truncate">{sectionLabel}</span>
            </button>
          </TooltipHint>
        );
      })}
    </div>
  );

  const statusMessages = (
    <>
      {openclawError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {openclawError}
        </div>
      )}
      {openclawSuccess && !openclawError && (
        <div className="rounded-lg border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-3 py-2 text-sm text-[var(--selection-accent)]">
          {openclawSuccess}
        </div>
      )}
      {settingsBootStatus && !chat.connected && !chat.connecting && (
        <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
          {settingsBootStatus.detail}
        </div>
      )}
      {settingsBootStatus && chat.connecting && !chat.connected && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {settingsBootStatus.title}
        </div>
      )}
      {settingsBootStatus && chat.connected && !hasSections && !openclawSchemaBundle && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {settingsBootStatus.detail}
        </div>
      )}
      {chat.connected && !hasSections && openclawSchemaBundle && (
        <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
          No config schema available from gateway.
        </div>
      )}
    </>
  );

  const editorContent = (
    <OpenClawErrorBoundary>
      <div className={isDesktopViewport ? "mx-auto w-full max-w-6xl space-y-4" : "mx-auto max-w-xl space-y-4"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {!isDesktopViewport && (
              <button
                type="button"
                onClick={() => setMobileSectionsOpen(true)}
                className="mb-3 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            )}
            <h3 className="truncate text-lg font-semibold text-foreground">
              {activeOpenclawSectionLabel ?? "OpenClaw Config"}
            </h3>
            {openclawSchemaBundle?.version && (
              <p className="mt-1 text-xs text-text-muted">
                Schema version <span className="font-mono">{openclawSchemaBundle.version}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void (effectiveOpenclawSection ? saveOpenclawSection(effectiveOpenclawSection) : saveAllOpenclaw())}
            disabled={openclawSaving || !chat.connected || !openclawDraft}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--button-primary)] px-3 py-2 text-sm font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {openclawSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
            {saveLabel}
          </button>
          {onClose && (
            <TooltipHint label="Close OpenClaw settings">
              <button type="button" aria-label="Close OpenClaw settings" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </TooltipHint>
          )}
        </div>

        {statusMessages}

        {hasSections && openclawDraft && (
          <div className="space-y-4">
            {visibleOpenclawSections.map(([sectionKey, sectionSchema]) => {
              const sectionDescription = openclawSectionDescription(openclawSchemaBundle, sectionKey, sectionSchema);
              return (
                <section key={`openclaw-editor-${sectionKey}`} className="space-y-4 rounded-xl border border-border bg-surface-low/30 p-4">
                  {sectionDescription && (
                    <p className="text-xs leading-5 text-text-muted">{sectionDescription}</p>
                  )}
                  {renderOpenclawField(sectionSchema, [sectionKey])}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </OpenClawErrorBoundary>
  );

  if (!isDesktopViewport && mobileSectionsOpen) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <SlidersHorizontal className="h-4 w-4 text-[var(--selection-accent)]" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">OpenClaw settings</p>
            <p className="text-[10px] text-text-muted">Choose a section to edit</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-xl rounded-xl border border-border bg-surface-low/20 p-4">
            <h3 className="text-lg font-semibold text-foreground">OpenClaw Sections</h3>
            <p className="mt-1 text-sm text-text-muted">Choose a section to edit.</p>
            <div className="mt-4">{sectionList}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full min-h-0 bg-background ${isDesktopViewport ? "flex-row" : "flex-col"}`}>
      {isDesktopViewport && (
        <aside className="w-[200px] min-w-[160px] max-w-[260px] shrink-0 border-r border-border bg-surface-low/20">
          <div className="h-full overflow-y-auto p-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Sections</p>
            {sectionList}
          </div>
        </aside>
      )}
      <div ref={openclawPaneRef} className={`min-w-0 flex-1 overflow-y-auto ${isDesktopViewport ? "p-6" : "p-4"}`}>
        {editorContent}
      </div>
    </div>
  );
}

interface AgentSettingsPanelProps {
  agent: Agent | null;
  activeSection?: AgentSettingsSection;
  onSectionChange?: (section: AgentSettingsSection) => void;
  showSectionNavigation?: boolean;
  user?: {
    id?: string;
    email?: string;
    name?: string;
    fullName?: string;
    avatarUrl?: string;
    imageUrl?: string;
    walletAddress?: string;
  } | null;
  getToken?: () => Promise<string>;
  onProfileNameChange?: (name: string | null) => void;
  onProfileAvatarChange?: (avatarUrl: string | null, file?: File) => void;
  onStartAgent?: () => void;
  onStopAgent?: () => void;
  onArchiveAgent?: () => void;
  onRestoreAgent?: () => void;
  onDeleteAgent?: () => void;
  onLogout?: () => void | Promise<void>;
  agentStarting?: boolean;
  agentStopping?: boolean;
  agentArchiving?: boolean;
  agentRestoring?: boolean;
  agentDeleting?: boolean;
  agentStartBlocked?: boolean;
  agentStartBlockedReason?: string | null;
  openclawConfig?: Record<string, unknown> | null;
  openclawModels?: Array<Record<string, unknown>> | null;
  reportedChannels?: AgentChannelSummary[];
  reportedChannelsReady?: boolean;
  onUpdateAgentProfile?: (agentId: string, profile: { name?: string; handle?: string | null }) => Promise<void>;
  onUpdateExternalAgentProfile?: (agentId: string, profile: { name?: string; displayName?: string | null; handle?: string | null }) => Promise<void>;
  onUploadAgentAvatar?: (agentId: string, file: File) => Promise<string>;
  onDeleteAgentAvatar?: (agentId: string) => Promise<void>;
  onUpdateAgentLaunchConfig?: (agentId: string, launchConfig: Record<string, unknown>) => Promise<void>;
  onSaveOpenClawConfig?: (patch: Record<string, unknown>) => Promise<void>;
  isDesktopViewport?: boolean;
}

export type AgentSettingsSection = "general" | "agent" | "index" | "usage" | "team";

const AGENT_SETTINGS_SECTIONS: Array<{ id: AgentSettingsSection; label: string }> = [
  { id: "general", label: "General" },
  { id: "agent", label: "Agent" },
  { id: "index", label: "Index" },
  { id: "usage", label: "Usage" },
  { id: "team", label: "Team" },
];

type MemoryIndexSettings = {
  enabled: boolean;
  onSessionStart: boolean;
  onSearch: boolean;
  watch: boolean;
  watchDebounceMs: number;
  intervalMinutes: number;
};

type WorkspacesSyncSettings = {
  enabled: boolean;
  readyOnly: boolean;
  workspace: string;
};

const DEFAULT_MEMORY_INDEX_SETTINGS: MemoryIndexSettings = {
  enabled: true,
  onSessionStart: false,
  onSearch: false,
  watch: false,
  watchDebounceMs: 30000,
  intervalMinutes: 0,
};

const DEFAULT_WORKSPACES_SYNC_SETTINGS: WorkspacesSyncSettings = {
  enabled: true,
  readyOnly: true,
  workspace: "",
};

const SETTINGS_FIELD_CLASS =
  "h-9 w-full rounded-lg border border-input bg-input-background px-3 text-sm text-foreground placeholder:text-text-muted transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";
const SETTINGS_TEXTAREA_CLASS =
  "min-h-[112px] w-full resize-y rounded-lg border border-input bg-input-background px-3 py-2 text-sm leading-5 text-foreground placeholder:text-text-muted transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";
const SETTINGS_CHECKBOX_CLASS = "h-4 w-4 rounded border-input bg-input-background accent-[var(--button-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SETTINGS_SMALL_BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface-low px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const SETTINGS_DANGER_BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center rounded-lg border border-destructive/30 bg-background px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-60";
const SETTINGS_FILLED_DANGER_BUTTON_CLASS =
  "inline-flex h-8 min-w-[96px] shrink-0 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/15 px-3 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-50";
const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function profileImageValidationError(file: File): string | null {
  if (!PROFILE_IMAGE_TYPES.has(file.type)) {
    return "Choose a PNG, JPEG, WebP, or GIF image.";
  }
  if (file.size === 0) return "Choose a non-empty image file.";
  if (file.size > PROFILE_IMAGE_MAX_BYTES) return "Image must be 2MB or smaller.";
  return null;
}

function errorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

function avatarMutationErrorMessage(error: unknown, target: "profile" | "agent"): string {
  const subject = target === "profile" ? "Profile image" : "Agent image";
  const statusCode = errorStatusCode(error);
  if (statusCode === 404 || statusCode === 405) {
    return `${subject} updates are not available in this environment.`;
  }
  if (statusCode === 413) return "Image must be 2MB or smaller.";
  if (statusCode === 415) return "Choose a PNG, JPEG, WebP, or GIF image.";
  return error instanceof Error ? error.message : `Failed to update ${subject.toLowerCase()}.`;
}

function profileNameFromUser(user: AgentSettingsPanelProps["user"]): string {
  return user?.fullName || user?.name || "";
}

function profileAvatarFromUser(user: AgentSettingsPanelProps["user"]): string | null {
  return user?.avatarUrl || user?.imageUrl || null;
}

function profileUserIdFromUser(user: AgentSettingsPanelProps["user"]): string {
  const id = user?.id?.trim() || "";
  return id === "stored-session" || id.startsWith("did:") ? "" : id;
}

function profileInitials(name: string, email?: string): string {
  const source = name.trim() || email?.split("@")[0] || "";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";
}

function agentSettingsName(agent: Agent | null): string {
  return agent?.name || agent?.id || "";
}

function agentSettingsDisplayName(agent: Agent | null): string {
  return agent ? agentDisplayLabel(agent) : "";
}

function agentSettingsHandle(agent: Agent | null): string {
  return agent?.handle || "";
}

function agentSettingsAvatar(agent: Agent | null): string | null {
  if (!agent) return null;
  return agentAvatar(agentDisplayLabel(agent), agent.meta, agentProfileImageUrl(agent)).imageUrl ?? null;
}

function agentSettingsAvatarFallback(agent: Agent | null): string | null {
  if (!agent) return null;
  const identityAvatar = agent.displayIdentity?.avatar_url;
  return agentAvatar(
    agentDisplayLabel(agent),
    agent.meta,
    typeof identityAvatar === "string" ? identityAvatar : null,
  ).imageUrl ?? null;
}

function validAgentHandle(value: string | null): boolean {
  return value === null || /^[a-z0-9][a-z0-9_-]{1,63}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const OPENCLAW_GATEWAY_TOKEN_ENV = "OPENCLAW_GATEWAY_TOKEN";
const SLACK_APP_ENABLED_ENV = "HYPER_SLACK_APP_ENABLED";
const RESERVED_SLACK_LAUNCH_ENV_KEYS = new Set<string>(HOSTED_SLACK_LAUNCH_ENV_KEYS);

const MANAGED_LAUNCH_ENV_KEYS = new Set([
  "HYPER_API_BASE",
  "HYPER_API_KEY",
  "HYPER_AGENTS_API_BASE",
  "HYPER_AGENTS_API_KEY",
  "HYPER_AGENTS_KEY_REF",
  "HYPER_AGENTS_WEB_SEARCH_BASE",
  "HYPER_WORKSPACES_BOOT_SYNC",
  "HYPER_WORKSPACES_DIR",
  "HYPER_WORKSPACES_SYNC_READY_ONLY",
  "HYPER_WORKSPACES_SYNC_WORKSPACE",
  "OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN",
  "OPENCLAW_BRAVE_PLUGIN_PACKAGE",
  "OPENCLAW_CONFIG_PATH",
  "OPENCLAW_CONFIG_TEMPLATE",
  "OPENCLAW_DESKTOP_ENABLED",
  "OPENCLAW_DESKTOP_PORT",
  "OPENCLAW_GATEWAY_BIND",
  OPENCLAW_GATEWAY_TOKEN_ENV,
  "OPENCLAW_MEMORY_SEARCH_ENABLED",
  "OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES",
  "OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH",
  "OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START",
  "OPENCLAW_MEMORY_SEARCH_SYNC_WATCH",
  "OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS",
  "OPENCLAW_PORT",
  "OPENCLAW_STATE_DIR",
  "OPENCLAW_WORKSPACES_SYNC_HANDLED_BY_INIT",
  "OPENCLAW_WORKSPACES_SYNC_ONLY",
]);

const MANAGED_LAUNCH_ENV_PREFIXES = [
  "LAGOON_",
  "REEF_",
];
const SECRET_ONLY_LAUNCH_ENV_KEYS = new Set(["OPENCLAW_GATEWAY_TOKEN"]);

const PUBLIC_CANONICAL_LAUNCH_CONFIG_KEYS = new Set([
  "config",
  "image",
  "env",
  "routes",
  "command",
  "entrypoint",
  "restart",
  "sync_root",
  "sync_include",
  "sync_exclude",
  "sync_uid",
  "sync_gid",
  "registry_url",
  "runtime_scopes",
]);

const DEFAULT_OPENCLAW_ROUTE = { port: 18789, auth: false, prefix: "" } as const;
const DEFAULT_DESKTOP_ROUTE = { port: 3000, auth: true, prefix: "desktop" } as const;

function isManagedLaunchEnvKey(key: string): boolean {
  return MANAGED_LAUNCH_ENV_KEYS.has(key) || MANAGED_LAUNCH_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function launchConfigFromAgent(agent: Agent | null): Record<string, unknown> {
  return isRecord(agent?.launchConfig) ? structuredClone(agent.launchConfig) : {};
}

function editableLaunchConfigFromAgent(agent: Agent): Record<string, unknown> {
  const launchConfig = launchConfigFromAgent(agent);
  const canonical = Object.fromEntries(
    Object.entries(launchConfig).filter(([key]) => PUBLIC_CANONICAL_LAUNCH_CONFIG_KEYS.has(key)),
  );
  if (isRecord(canonical.env)) {
    const env = { ...canonical.env };
    delete env[OPENCLAW_GATEWAY_TOKEN_ENV];
    canonical.env = env;
  }
  return canonical;
}

function launchConfigImage(agent: Agent | null): string {
  const launchConfig = launchConfigFromAgent(agent);
  return typeof launchConfig.image === "string" ? launchConfig.image : "";
}

function launchConfigEnv(agent: Agent | null): Record<string, string> {
  const launchConfig = launchConfigFromAgent(agent);
  if (!isRecord(launchConfig.env)) return {};
  return Object.fromEntries(
    Object.entries(launchConfig.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function additionalEnvTextFromAgent(agent: Agent | null): string {
  return Object.entries(launchConfigEnv(agent))
    .filter(([key]) => !isManagedLaunchEnvKey(key) && !RESERVED_SLACK_LAUNCH_ENV_KEYS.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function managedHyperEnvTextFromAgent(agent: Agent | null): string {
  return Object.entries(launchConfigEnv(agent))
    .filter(([key]) => (
      key.startsWith("HYPER_")
      && isManagedLaunchEnvKey(key)
      && key !== "HYPER_WORKSPACES_DIR"
    ))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function parseManagedHyperEnvText(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = value.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Managed HYPER env line ${index + 1} must use KEY=value.`);
    }
    const key = line.slice(0, separatorIndex).trim();
    if (key === "HYPER_WORKSPACES_DIR") {
      throw new Error("HYPER_WORKSPACES_DIR is fixed at $HOME/shared.");
    }
    if (!key.startsWith("HYPER_") || !isManagedLaunchEnvKey(key)) {
      throw new Error(`${key} is not an editable managed HYPER_* variable.`);
    }
    env[key] = line.slice(separatorIndex + 1);
  }
  return env;
}

function workspacesSyncSettingsFromManagedEnv(
  managedHyperEnvText: string,
  fallback: WorkspacesSyncSettings,
): WorkspacesSyncSettings {
  const env = parseManagedHyperEnvText(managedHyperEnvText);
  return {
    enabled: envBooleanFromString(env.HYPER_WORKSPACES_BOOT_SYNC, fallback.enabled),
    readyOnly: envBooleanFromString(env.HYPER_WORKSPACES_SYNC_READY_ONLY, fallback.readyOnly),
    workspace: (env.HYPER_WORKSPACES_SYNC_WORKSPACE ?? fallback.workspace.trim()) || "",
  };
}

function parseAdditionalEnvText(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = value.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Additional env line ${index + 1} must use KEY=value.`);
    }
    const key = line.slice(0, separatorIndex).trim();
    const envValue = line.slice(separatorIndex + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Additional env line ${index + 1} has an invalid key.`);
    }
    if (RESERVED_SLACK_LAUNCH_ENV_KEYS.has(key)) {
      throw new Error(`${key} is managed by the Slack setting and cannot be edited here.`);
    }
    if (isManagedLaunchEnvKey(key)) {
      throw new Error(`${key} is managed by HyperCLI and cannot be edited here.`);
    }
    env[key] = envValue;
  }
  return env;
}

function buildUpdatedLaunchConfig(
  agent: Agent,
  image: string,
  additionalEnvText: string,
  managedHyperEnvText: string,
  desktopEnabled: boolean,
  slackEnabled: boolean,
  workspacesSync: WorkspacesSyncSettings,
  workspacesSyncChanged: boolean,
  memoryIndex: MemoryIndexSettings | null = null,
): Record<string, unknown> {
  const launchConfig = editableLaunchConfigFromAgent(agent);
  if (image) launchConfig.image = image;
  const routes = isRecord(launchConfig.routes) ? { ...launchConfig.routes } : {};
  if (!isRecord(routes.openclaw)) {
    routes.openclaw = { ...DEFAULT_OPENCLAW_ROUTE };
  }
  if (desktopEnabled) {
    routes.desktop = { ...DEFAULT_DESKTOP_ROUTE };
  } else {
    delete routes.desktop;
  }
  launchConfig.routes = routes;
  const preservedEnv = Object.fromEntries(
    Object.entries(launchConfigEnv(agent)).filter(([key]) => (
      isManagedLaunchEnvKey(key) && !(key.startsWith("HYPER_") && isManagedLaunchEnvKey(key))
      && !SECRET_ONLY_LAUNCH_ENV_KEYS.has(key)
    )),
  );
  const managedHyperEnv = parseManagedHyperEnvText(managedHyperEnvText);
  const resolvedWorkspacesSync = workspacesSyncChanged
    ? workspacesSync
    : workspacesSyncSettingsFromManagedEnv(managedHyperEnvText, workspacesSync);
  const workspaceOptions: OpenClawWorkspacesSyncOptions = {
    enabled: resolvedWorkspacesSync.enabled,
    readyOnly: resolvedWorkspacesSync.readyOnly,
    workspace: resolvedWorkspacesSync.workspace.trim() || null,
  };
  const launchEnv: Record<string, string> = {
    ...preservedEnv,
    OPENCLAW_DESKTOP_ENABLED: desktopEnabled ? "1" : "0",
    // Keep the injected indexing envs in line with the saved toggles; the
    // container entrypoint re-applies them to openclaw.json on every boot.
    ...(memoryIndex ? buildOpenClawMemoryIndexEnv(memoryIndex) : {}),
    ...managedHyperEnv,
    ...buildOpenClawWorkspacesSyncEnv(workspaceOptions),
    ...parseAdditionalEnvText(additionalEnvText),
  };
  for (const key of RESERVED_SLACK_LAUNCH_ENV_KEYS) delete launchEnv[key];
  if (slackEnabled) {
    if (!SLACK_RELAY_BASE_URL) throw new Error("Slack is unavailable because the hosted relay is not configured.");
    // The Agent exists here, so the gateway id is known: use the SDK builder
    // rather than a local copy that can omit a key the pod needs to boot.
    Object.assign(launchEnv, buildHostedSlackLaunchEnv({
      relayBaseUrl: SLACK_RELAY_BASE_URL,
      gatewayId: agent.gatewayId,
      agentId: agent.id,
    }));
  }
  if (workspaceOptions.enabled) {
    launchEnv.HYPER_WORKSPACES_DIR = "/home/node/shared";
  } else {
    delete launchEnv.HYPER_WORKSPACES_DIR;
  }
  launchConfig.env = launchEnv;
  return launchConfig;
}

function booleanFromConfig(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function nonNegativeIntegerFromConfig(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function envBooleanFromString(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function getDesktopEnabled(agent: Agent | null): boolean {
  const env = launchConfigEnv(agent);
  const launchConfig = launchConfigFromAgent(agent);
  const routes = isRecord(launchConfig.routes) ? launchConfig.routes : {};
  const hasDesktopRoute = isRecord(routes.desktop);
  if (env.OPENCLAW_DESKTOP_ENABLED !== undefined) {
    return envBooleanFromString(env.OPENCLAW_DESKTOP_ENABLED, hasDesktopRoute || Boolean(agent?.hasDesktop));
  }
  return hasDesktopRoute || Boolean(agent?.hasDesktop);
}

function getSlackEnabled(agent: Agent | null): boolean {
  return envBooleanFromString(launchConfigEnv(agent)[SLACK_APP_ENABLED_ENV], false);
}

function getWorkspacesSyncSettings(agent: Agent | null): WorkspacesSyncSettings {
  const env = launchConfigEnv(agent);
  return {
    enabled: envBooleanFromString(env.HYPER_WORKSPACES_BOOT_SYNC, DEFAULT_WORKSPACES_SYNC_SETTINGS.enabled),
    readyOnly: envBooleanFromString(env.HYPER_WORKSPACES_SYNC_READY_ONLY, DEFAULT_WORKSPACES_SYNC_SETTINGS.readyOnly),
    workspace: env.HYPER_WORKSPACES_SYNC_WORKSPACE || DEFAULT_WORKSPACES_SYNC_SETTINGS.workspace,
  };
}

function workspacesSyncSettingsEqual(left: WorkspacesSyncSettings, right: WorkspacesSyncSettings): boolean {
  return left.enabled === right.enabled
    && left.readyOnly === right.readyOnly
    && left.workspace === right.workspace;
}

function getMemoryIndexSettings(config: Record<string, unknown> | null | undefined): MemoryIndexSettings {
  const agents = asObject(config?.agents);
  const defaults = asObject(agents?.defaults);
  const memorySearch = asObject(defaults?.memorySearch);
  const sync = asObject(memorySearch?.sync);
  return {
    enabled: booleanFromConfig(memorySearch?.enabled, DEFAULT_MEMORY_INDEX_SETTINGS.enabled),
    onSessionStart: booleanFromConfig(sync?.onSessionStart, DEFAULT_MEMORY_INDEX_SETTINGS.onSessionStart),
    onSearch: booleanFromConfig(sync?.onSearch, DEFAULT_MEMORY_INDEX_SETTINGS.onSearch),
    watch: booleanFromConfig(sync?.watch, DEFAULT_MEMORY_INDEX_SETTINGS.watch),
    watchDebounceMs: nonNegativeIntegerFromConfig(sync?.watchDebounceMs, DEFAULT_MEMORY_INDEX_SETTINGS.watchDebounceMs),
    intervalMinutes: nonNegativeIntegerFromConfig(sync?.intervalMinutes, DEFAULT_MEMORY_INDEX_SETTINGS.intervalMinutes),
  };
}

function memoryIndexSettingsEqual(left: MemoryIndexSettings, right: MemoryIndexSettings): boolean {
  return left.enabled === right.enabled
    && left.onSessionStart === right.onSessionStart
    && left.onSearch === right.onSearch
    && left.watch === right.watch
    && left.watchDebounceMs === right.watchDebounceMs
    && left.intervalMinutes === right.intervalMinutes;
}

function buildMemoryIndexPatch(settings: MemoryIndexSettings): Record<string, unknown> {
  return {
    agents: {
      defaults: {
        memorySearch: {
          enabled: settings.enabled,
          sync: {
            onSessionStart: settings.onSessionStart,
            onSearch: settings.onSearch,
            watch: settings.watch,
            watchDebounceMs: settings.watchDebounceMs,
            intervalMinutes: settings.intervalMinutes,
          },
        },
      },
    },
  };
}

function initialsFromName(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";
}

function AgentProfileSettingsRow({
  id,
  label,
  description,
  children,
  minHeight = "min-h-[100px]",
  compact = false,
}: {
  id?: string;
  label: string;
  description?: string;
  children: React.ReactNode;
  minHeight?: string;
  compact?: boolean;
}) {
  return (
    <div id={id} className={`grid min-w-0 scroll-mt-6 grid-cols-1 gap-2 lg:grid-cols-[260px_minmax(0,440px)] lg:items-start lg:justify-between lg:gap-4 ${compact ? "min-h-0 py-4" : `${minHeight} py-5 lg:py-7`}`}>
      <div>
        <p className="text-sm font-semibold leading-5 text-foreground">{label}</p>
        {description ? <p className="mt-1 text-xs leading-5 text-text-muted">{description}</p> : null}
      </div>
      <div className="w-full min-w-0 lg:max-w-[440px]">{children}</div>
    </div>
  );
}

function AgentGeneralSettingsContent({
  user,
  profileUserId,
  profileName,
  profileAvatar,
  profileError,
  profileSuccess,
  onProfileNameChange,
  onAvatarSelect,
  onAvatarRemove,
  avatarUpdatesEnabled,
  onLogout,
  showSessionActions = true,
}: {
  user: AgentSettingsPanelProps["user"];
  profileUserId: string;
  profileName: string;
  profileAvatar: string | null;
  profileError: string | null;
  profileSuccess: string | null;
  onProfileNameChange: (value: string) => void;
  onAvatarSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAvatarRemove: () => void;
  avatarUpdatesEnabled: boolean;
  onLogout?: () => void | Promise<void>;
  showSessionActions?: boolean;
}) {
  const avatarInputRef = React.useRef<HTMLInputElement | null>(null);
  const [uuidCopyResult, setUuidCopyResult] = React.useState<{ userId: string; copied: boolean } | null>(null);
  const email = user?.email || "";
  const uuidCopyStatus = uuidCopyResult?.userId === profileUserId
    ? uuidCopyResult.copied ? "copied" : "failed"
    : "idle";

  React.useEffect(() => {
    if (uuidCopyStatus !== "copied") return;
    const timeout = window.setTimeout(() => setUuidCopyResult(null), 2000);
    return () => window.clearTimeout(timeout);
  }, [uuidCopyStatus]);

  const copyUserUuid = async () => {
    if (!profileUserId) return;
    setUuidCopyResult({ userId: profileUserId, copied: await writeClipboardText(profileUserId) });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-7 text-left sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <h2 className="text-xl font-semibold leading-tight text-foreground">Profile</h2>
        {(profileError || profileSuccess) && (
          <div className="mt-4">
            {profileError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {profileError}
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-3 py-2 text-sm text-[var(--selection-accent)]">
                {profileSuccess}
              </div>
            )}
          </div>
        )}

        <section className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-low/30 px-4 sm:px-5 md:mt-7">
          <AgentProfileSettingsRow label="Full Name" description="Shown across your workspace.">
            <input
              value={profileName}
              onChange={(event) => onProfileNameChange(event.target.value)}
              placeholder="Full name"
              className={SETTINGS_FIELD_CLASS}
            />
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow label="Email" description="Used for login and notifications.">
            <input
              value={email}
              disabled
              placeholder="Email"
              className={SETTINGS_FIELD_CLASS}
            />
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow label="User UUID" description="Share this ID when someone adds you directly to a Collection.">
            <div className="flex min-w-0 gap-2">
              <Input
                aria-label="User UUID"
                readOnly
                value={profileUserId}
                placeholder="Loading user UUID"
                className={`${SETTINGS_FIELD_CLASS} min-w-0 font-mono text-xs`}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => { void copyUserUuid(); }}
                disabled={!profileUserId}
                aria-label={uuidCopyStatus === "copied" ? "User UUID copied" : "Copy user UUID"}
                className="h-9 min-w-[92px] rounded-lg px-3 text-xs"
              >
                {uuidCopyStatus === "copied" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {uuidCopyStatus === "copied" ? "Copied" : uuidCopyStatus === "failed" ? "Try again" : "Copy"}
              </Button>
            </div>
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow
            label="Avatar"
            description="Personalize your profile image."
            minHeight="min-h-[144px]"
          >
            <div className="flex items-start gap-5">
              <TooltipHint label={avatarUpdatesEnabled ? "Upload profile avatar" : "Avatar uploads are coming soon."} disabled={!avatarUpdatesEnabled}>
                <button
                  type="button"
                  onClick={() => {
                    if (avatarUpdatesEnabled) avatarInputRef.current?.click();
                  }}
                  disabled={!avatarUpdatesEnabled}
                  className="relative flex h-[64px] w-[64px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-high text-sm font-semibold text-text-muted"
                  aria-label="Upload profile avatar"
                >
                  {profileAvatar ? (
                    <ResourceImage src={profileAvatar} alt="Profile avatar" fill sizes="64px" className="object-cover" />
                  ) : (
                    <span>{profileInitials(profileName, email)}</span>
                  )}
                </button>
              </TooltipHint>
              <div className="min-w-0">
                <p className="text-base font-semibold leading-5 text-foreground">Upload Image</p>
                <p className="mt-1 text-sm font-medium leading-5 text-text-muted">PNG, JPEG, WebP, or GIF up to 2MB</p>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={onAvatarSelect}
                  disabled={!avatarUpdatesEnabled}
                  className="hidden"
                />
                {profileAvatar ? (
                  <TooltipHint label={avatarUpdatesEnabled ? "Remove profile avatar" : "Avatar uploads are coming soon."} disabled={!avatarUpdatesEnabled}>
                    <button type="button" onClick={onAvatarRemove} disabled={!avatarUpdatesEnabled} className={`mt-3 ${SETTINGS_DANGER_BUTTON_CLASS}`}>
                      Remove
                    </button>
                  </TooltipHint>
                ) : (
                  <TooltipHint label={avatarUpdatesEnabled ? "Upload profile avatar" : "Avatar uploads are coming soon."} disabled={!avatarUpdatesEnabled}>
                    <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={!avatarUpdatesEnabled} className={`mt-3 ${SETTINGS_SMALL_BUTTON_CLASS}`}>
                      Upload
                    </button>
                  </TooltipHint>
                )}
              </div>
            </div>
          </AgentProfileSettingsRow>

          {onLogout && showSessionActions ? (
            <AgentProfileSettingsRow label="Sign out" description="End your session on this browser.">
              <button
                type="button"
                onClick={() => { void onLogout(); }}
                className={`${SETTINGS_DANGER_BUTTON_CLASS} gap-2`}
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </AgentProfileSettingsRow>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function AgentSectionSettingsContent({
  agent,
  agentName,
  agentDisplayName,
  agentHandle,
  agentAvatarPreview,
  onAgentNameChange,
  onAgentDisplayNameChange,
  onAgentHandleChange,
  onAgentAvatarSelect,
  onAgentAvatarRemove,
  agentAvatarUploadPending,
  agentAvatarCanRemove,
  agentAvatarUploadEnabled,
  agentAvatarRemoveEnabled,
  agentImageDraft,
  onAgentImageChange,
  additionalEnvDraft,
  onAdditionalEnvChange,
  managedHyperEnvDraft,
  onManagedHyperEnvChange,
  desktopEnabled,
  onDesktopEnabledChange,
  slackEnabled,
  onSlackEnabledChange,
  workspacesSync,
  onWorkspacesSyncChange,
  modelDraft,
  modelOptions,
  modelSelectionDisabled,
  onModelChange,
  archiveDraft,
  onArchiveChange,
  agentSettingsError,
  agentSettingsSuccess,
  onStartAgent,
  onStopAgent,
  onArchiveAgent,
  onRestoreAgent,
  onDeleteAgent,
  agentStarting,
  agentStopping,
  agentArchiving,
  agentRestoring,
  agentDeleting,
  agentStartBlocked,
  agentStartBlockedReason,
}: {
  agent: Agent;
  agentName: string;
  agentDisplayName: string;
  agentHandle: string;
  agentAvatarPreview: string | null;
  onAgentNameChange: (value: string) => void;
  onAgentDisplayNameChange: (value: string) => void;
  onAgentHandleChange: (value: string) => void;
  onAgentAvatarSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAgentAvatarRemove: () => void;
  agentAvatarUploadPending?: boolean;
  agentAvatarCanRemove: boolean;
  agentAvatarUploadEnabled: boolean;
  agentAvatarRemoveEnabled: boolean;
  agentImageDraft: string;
  onAgentImageChange: (value: string) => void;
  additionalEnvDraft: string;
  onAdditionalEnvChange: (value: string) => void;
  managedHyperEnvDraft: string;
  onManagedHyperEnvChange: (value: string) => void;
  desktopEnabled: boolean;
  onDesktopEnabledChange: (value: boolean) => void;
  slackEnabled: boolean;
  onSlackEnabledChange: (value: boolean) => void;
  workspacesSync: WorkspacesSyncSettings;
  onWorkspacesSyncChange: (settings: WorkspacesSyncSettings) => void;
  modelDraft: string;
  modelOptions: OpenClawModelOption[];
  modelSelectionDisabled?: boolean;
  onModelChange: (value: string) => void;
  archiveDraft: string;
  onArchiveChange: (value: string) => void;
  agentSettingsError?: string | null;
  agentSettingsSuccess?: string | null;
  onStartAgent?: () => void;
  onStopAgent?: () => void;
  onArchiveAgent?: () => void;
  onRestoreAgent?: () => void;
  onDeleteAgent?: () => void;
  agentStarting?: boolean;
  agentStopping?: boolean;
  agentArchiving?: boolean;
  agentRestoring?: boolean;
  agentDeleting?: boolean;
  agentStartBlocked?: boolean;
  agentStartBlockedReason?: string | null;
}) {
  const avatarInputRef = React.useRef<HTMLInputElement | null>(null);
  const [savedHyperEnvReveal, setSavedHyperEnvReveal] = React.useState({ agentId: agent.id, visible: false });
  const showSavedHyperEnv = savedHyperEnvReveal.agentId === agent.id && savedHyperEnvReveal.visible;
  const externalAgent = agent.managed === false;
  const failedRuntimeNeedsCleanup = agent.state === "FAILED";
  const canStartAgent = isAgentStartable(agent);
  const canStopAgent = isAgentStoppable(agent);
  const canDeleteAgent = isAgentDeletable(agent);
  const startupCanBeCancelled = agent.state === "CREATING" || agent.state === "STARTING";
  const stopped = agent.state === "STOPPED";
  const archived = agent.state === "ARCHIVED";
  const archiving = Boolean(agentArchiving || agent.state === "ARCHIVING");
  const restoring = Boolean(agentRestoring || agent.state === "RESTORING");
  const stopping = Boolean(agentStopping || agent.state === "STOPPING");
  const starting = Boolean(agentStarting || (isAgentTransitionalState(agent.state) && !stopping));
  const lifecycleBusy = Boolean(agentStarting || agentStopping || agentArchiving || agentRestoring || isAgentTransitionalState(agent.state));
  const lifecycleDescription = archiving
    ? "Agent is archiving"
    : restoring
      ? "Agent is restoring files"
      : canStopAgent
    ? failedRuntimeNeedsCleanup
      ? "Remove resources left behind by the failed launch"
      : startupCanBeCancelled
        ? "Cancel startup and release the admitted runtime"
        : "Pause compute and disconnect the gateway"
    : stopped && canStartAgent
      ? (agentStartBlockedReason ?? "Start compute and reconnect the gateway")
      : archived
        ? "Restore the verified archive to persistent storage"
      : agent.state === "CREATING" || agent.state === "STARTING"
        ? "Agent is starting"
      : agent.state === "STOPPING"
          ? "Agent is stopping"
          : "Lifecycle controls are unavailable";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-7 text-left sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-7 flex min-h-[72px] items-center justify-between gap-4 rounded-xl border border-border bg-surface-low p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-5 text-foreground">Agent runtime</p>
            <p className="mt-1 text-sm leading-5 text-text-muted">{lifecycleDescription}</p>
          </div>
          {archiving ? (
            <button
              type="button"
              aria-label="Archiving agent"
              disabled
              className={`${SETTINGS_SMALL_BUTTON_CLASS} shrink-0 gap-2`}
            >
              Archiving...
              <Archive className="h-3.5 w-3.5" />
            </button>
          ) : restoring ? (
            <button
              type="button"
              aria-label="Restoring agent"
              disabled
              className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-3 text-xs font-medium text-[var(--selection-accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Restoring...
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          ) : canStopAgent || stopping ? (
            <button
              type="button"
              aria-label={failedRuntimeNeedsCleanup ? "Clean up failed launch" : "Stop agent"}
              data-testid="agent-stop"
              onClick={onStopAgent}
              disabled={!onStopAgent || stopping}
              className={`${SETTINGS_SMALL_BUTTON_CLASS} shrink-0 gap-2`}
            >
              {stopping ? "Stopping..." : failedRuntimeNeedsCleanup ? "Clean up failed launch" : "Stop agent"}
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : stopped ? (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                aria-label="Archive agent"
                onClick={onArchiveAgent}
                disabled={!onArchiveAgent || lifecycleBusy}
                className={`${SETTINGS_SMALL_BUTTON_CLASS} gap-2`}
              >
                Archive
                <Archive className="h-3.5 w-3.5" />
              </button>
              <TooltipHint label={agentStartBlockedReason ?? "Start agent"} disabled={!canStartAgent || !onStartAgent || lifecycleBusy || agentStartBlocked}>
                <button
                  type="button"
                  aria-label="Start agent"
                  onClick={onStartAgent}
                  disabled={!canStartAgent || !onStartAgent || lifecycleBusy || agentStartBlocked}
                  className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-3 text-xs font-medium text-[var(--selection-accent)] transition-colors hover:bg-surface-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {starting ? "Starting..." : "Start agent"}
                  <Play className="h-3.5 w-3.5 fill-current" />
                </button>
              </TooltipHint>
            </div>
          ) : archived ? (
            <button
              type="button"
              aria-label="Restore agent"
              onClick={onRestoreAgent}
              disabled={!onRestoreAgent || lifecycleBusy}
              className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-3 text-xs font-medium text-[var(--selection-accent)] transition-colors hover:bg-surface-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              Restore
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <h2 className="text-xl font-semibold leading-tight text-foreground">Agent Settings</h2>
        {(agentSettingsError || agentSettingsSuccess) && (
          <div className="mt-4">
            {agentSettingsError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {agentSettingsError}
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-3 py-2 text-sm text-[var(--selection-accent)]">
                {agentSettingsSuccess}
              </div>
            )}
          </div>
        )}

        <section className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-low/30 px-4 sm:px-5 md:mt-7">
          <AgentProfileSettingsRow label="Agent name" description="Unique name used to identify this agent.">
            <input
              aria-label="Agent name"
              value={agentName}
              onChange={(event) => onAgentNameChange(event.target.value)}
              placeholder="Agent name"
              maxLength={externalAgent ? 64 : 32}
              spellCheck={false}
              className={SETTINGS_FIELD_CLASS}
            />
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow
            label="Display name"
            description={externalAgent
              ? "Shown in the agent roster and other user-facing views."
              : `Shown across HyperCLI. Spaces become dashes when this name is used with @${SLACK_APP_HANDLE} in Slack.`}
          >
            <input
              aria-label="Agent display name"
              value={agentDisplayName}
              onChange={(event) => onAgentDisplayNameChange(event.target.value)}
              placeholder="Display name"
              maxLength={externalAgent ? 255 : 64}
              spellCheck={externalAgent}
              className={SETTINGS_FIELD_CLASS}
            />
          </AgentProfileSettingsRow>

          {externalAgent ? (
            <AgentProfileSettingsRow label="Slack handle" description={`Mention as @${SLACK_APP_HANDLE} ${agentHandle || "agent"}.`}>
              <input
                value={agentHandle}
                onChange={(event) => onAgentHandleChange(event.target.value)}
                placeholder="coder"
                spellCheck={false}
                className={SETTINGS_FIELD_CLASS}
              />
            </AgentProfileSettingsRow>
          ) : null}

          <AgentProfileSettingsRow
            label="Avatar"
            description="Helps identify this agent."
            minHeight="min-h-[144px]"
          >
            <div className="flex items-start gap-5">
              <TooltipHint label={agentAvatarUploadEnabled ? "Upload agent avatar" : "Agent avatar uploads are unavailable."} disabled={!agentAvatarUploadEnabled}>
                <button
                  type="button"
                  onClick={() => {
                    if (agentAvatarUploadEnabled) avatarInputRef.current?.click();
                  }}
                  disabled={!agentAvatarUploadEnabled}
                  className="relative flex h-[64px] w-[64px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-high text-sm font-semibold text-text-muted"
                  aria-label="Upload agent avatar"
                >
                  {agentAvatarPreview ? (
                    <ResourceImage src={agentAvatarPreview} alt="Agent avatar" fill sizes="64px" className="object-cover" />
                  ) : (
                    <span>{initialsFromName(agentDisplayName || agentName)}</span>
                  )}
                </button>
              </TooltipHint>
              <div className="min-w-0">
                <p className="text-base font-semibold leading-5 text-foreground">Upload Image</p>
                <p className="mt-1 text-sm font-medium leading-5 text-text-muted">PNG, JPEG, WebP, or GIF up to 2MB</p>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={onAgentAvatarSelect}
                  disabled={!agentAvatarUploadEnabled}
                  className="hidden"
                />
                {agentAvatarUploadPending || agentAvatarCanRemove ? (
                  <TooltipHint label={agentAvatarUploadPending ? "Cancel avatar replacement" : agentAvatarRemoveEnabled ? "Remove agent avatar" : "Agent avatar removal is unavailable."} disabled={!agentAvatarUploadPending && !agentAvatarRemoveEnabled}>
                    <button type="button" onClick={onAgentAvatarRemove} disabled={!agentAvatarUploadPending && !agentAvatarRemoveEnabled} className={`mt-3 ${SETTINGS_DANGER_BUTTON_CLASS}`}>
                      {agentAvatarUploadPending ? "Cancel" : "Remove"}
                    </button>
                  </TooltipHint>
                ) : (
                  <TooltipHint label={agentAvatarUploadEnabled ? "Upload agent avatar" : "Agent avatar uploads are unavailable."} disabled={!agentAvatarUploadEnabled}>
                    <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={!agentAvatarUploadEnabled} className={`mt-3 ${SETTINGS_SMALL_BUTTON_CLASS}`}>
                      {agentAvatarUploadPending ? "Selected" : "Upload"}
                    </button>
                  </TooltipHint>
                )}
              </div>
            </div>
          </AgentProfileSettingsRow>

          <div hidden>
            <AgentProfileSettingsRow label="Docker image" description="Container image used when this agent starts.">
              <input
                value={agentImageDraft}
                onChange={(event) => onAgentImageChange(event.target.value)}
                placeholder="ghcr.io/hypercli/hypercli-openclaw:pro-latest"
                aria-label="Agent Docker image"
                className={SETTINGS_FIELD_CLASS}
              />
            </AgentProfileSettingsRow>
          </div>

          <AgentProfileSettingsRow id="agent-desktop-setting" label="Desktop" description="Expose the protected browser desktop route when the agent starts.">
            <div className="flex h-9 items-center justify-end">
              <Switch
                checked={desktopEnabled}
                onCheckedChange={onDesktopEnabledChange}
                aria-label="Enable desktop route"
              />
            </div>
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow label="Slack" description="Enable Slack for this agent when it starts.">
            <div className="flex h-9 items-center justify-end">
              <Switch
                checked={slackEnabled}
                onCheckedChange={onSlackEnabledChange}
                aria-label="Enable Slack"
              />
            </div>
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow label="Shared knowledge" description="Sync shared knowledge Markdown before OpenClaw starts.">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex h-9 items-center gap-2">
                  <Switch
                    id="agent-shared-knowledge-sync"
                    checked={workspacesSync.enabled}
                    onCheckedChange={(checked) => onWorkspacesSyncChange({ ...workspacesSync, enabled: checked })}
                    aria-label="Boot sync"
                  />
                  <label htmlFor="agent-shared-knowledge-sync" className="text-sm font-medium text-foreground">Boot sync</label>
                </div>
                <span className="text-xs text-text-muted">$HOME/shared</span>
              </div>
              <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="flex h-9 items-center gap-2">
                  <Switch
                    id="agent-shared-knowledge-ready-only"
                    checked={workspacesSync.readyOnly}
                    onCheckedChange={(checked) => onWorkspacesSyncChange({ ...workspacesSync, readyOnly: checked })}
                    disabled={!workspacesSync.enabled}
                    aria-label="Ready files only"
                  />
                  <label htmlFor="agent-shared-knowledge-ready-only" className="text-sm font-medium text-foreground">Ready files only</label>
                </div>
                <input
                  value={workspacesSync.workspace}
                  onChange={(event) => onWorkspacesSyncChange({ ...workspacesSync, workspace: event.target.value })}
                  disabled={!workspacesSync.enabled}
                  placeholder="All accessible shared knowledge"
                  aria-label="Shared knowledge sync selection"
                  className={SETTINGS_FIELD_CLASS}
                />
              </div>
            </div>
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow label="Additional env" description="Extra runtime variables, one KEY=value per line.">
            <div className="space-y-3">
              <textarea
                value={additionalEnvDraft}
                onChange={(event) => onAdditionalEnvChange(event.target.value)}
                placeholder={"EXAMPLE_FLAG=1\nCUSTOM_ENDPOINT=https://example.com"}
                aria-label="Additional env"
                spellCheck={false}
                className={SETTINGS_TEXTAREA_CLASS}
              />
              <label className="flex items-center gap-2 text-sm font-medium text-destructive">
                <input
                  type="checkbox"
                  checked={showSavedHyperEnv}
                  onChange={(event) => setSavedHyperEnvReveal({ agentId: agent.id, visible: event.target.checked })}
                  className={SETTINGS_CHECKBOX_CLASS}
                />
                Show saved HYPER_* variables (dangerous)
              </label>
              {showSavedHyperEnv ? (
                <div className="space-y-2">
                  <p className="text-xs text-destructive">
                    Saved launch values may contain credentials. Changes apply on the next agent launch and may differ from the live container environment.
                  </p>
                  <textarea
                    value={managedHyperEnvDraft}
                    onChange={(event) => onManagedHyperEnvChange(event.target.value)}
                    placeholder="No saved managed HYPER_* variables."
                    aria-label="Managed HYPER environment variables"
                    spellCheck={false}
                    className={SETTINGS_TEXTAREA_CLASS}
                  />
                </div>
              ) : null}
            </div>
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow label="Default model" description="Model used by this agent.">
            <select
              aria-label="Default model"
              value={modelDraft}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={modelSelectionDisabled || modelOptions.length === 0}
              className={SETTINGS_FIELD_CLASS}
            >
              {modelOptions.length === 0 ? (
                <option value="">No models available</option>
              ) : (
                <>
                  <option value="">Use OpenClaw default</option>
                  {modelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </>
              )}
            </select>
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow label="Visibility" description="Who can access this agent.">
            <select
              aria-label="Visibility"
              value=""
              disabled
              className={SETTINGS_FIELD_CLASS}
            >
              <option value="">Collection members</option>
            </select>
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow label="Auto-archive idle projects" description="Archive inactive projects automatically.">
            <select
              aria-label="Auto-archive idle projects"
              value={archiveDraft}
              onChange={(event) => onArchiveChange(event.target.value)}
              className={SETTINGS_FIELD_CLASS}
            >
              <option value="not-configured">Not configured</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </AgentProfileSettingsRow>

        </section>

        <section className="mt-8 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5">
          <h2 className="text-xl font-semibold leading-tight text-foreground">Danger Zone</h2>
          <div className="mt-5 flex min-h-[68px] items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-5 text-foreground">Delete agent</p>
              <p className="mt-1 max-w-[420px] text-sm leading-5 text-text-muted">
                {canDeleteAgent
                  ? "Permanently delete this agent and all related settings. This action cannot be undone."
                  : "Stop the agent and wait for cleanup to finish before deleting it."}
              </p>
            </div>
            <button
              type="button"
              data-testid="agent-danger-delete"
              onClick={onDeleteAgent}
              disabled={!onDeleteAgent || agentDeleting || !canDeleteAgent}
              className={SETTINGS_FILLED_DANGER_BUTTON_CLASS}
            >
              {agentDeleting ? "Deleting..." : "Delete agent"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function AgentSettingsLinkButton({
  children,
  href,
  tone = "default",
}: {
  children: React.ReactNode;
  href: string;
  tone?: "default" | "danger";
}) {
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className={`rounded-lg text-xs ${tone === "danger" ? "border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive" : "bg-surface-low hover:bg-surface-high"}`}
    >
      <Link href={href}>{children}</Link>
    </Button>
  );
}

function AgentIndexSettingsContent({
  settings,
  onSettingsChange,
  error,
  success,
  disabled,
}: {
  settings: MemoryIndexSettings;
  onSettingsChange: (settings: MemoryIndexSettings) => void;
  error?: string | null;
  success?: string | null;
  disabled?: boolean;
}) {
  const setBoolean = (key: keyof Pick<MemoryIndexSettings, "enabled" | "onSessionStart" | "onSearch" | "watch">) =>
    (checked: boolean) => {
      onSettingsChange({ ...settings, [key]: checked });
    };
  const setDebounceSeconds = (event: React.ChangeEvent<HTMLInputElement>) => {
    const seconds = Math.max(0, Number.parseFloat(event.target.value || "0") || 0);
    onSettingsChange({ ...settings, watchDebounceMs: Math.round(seconds * 1000) });
  };
  const setIntervalMinutes = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Math.max(0, Number.parseInt(event.target.value || "0", 10) || 0);
    onSettingsChange({ ...settings, intervalMinutes: value });
  };

  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-7 text-left sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <h2 className="text-xl font-semibold leading-tight text-foreground">Memory index</h2>
        {(error || success) && (
          <div className="mt-4">
            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-3 py-2 text-sm text-[var(--selection-accent)]">
                {success}
              </div>
            )}
          </div>
        )}
        <section className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-low/30 px-4 sm:px-5 md:mt-7">
          <AgentProfileSettingsRow compact label="Memory search" description="Enable semantic search over indexed memory files.">
            <div className="flex h-9 items-center justify-end">
              <Switch
                checked={settings.enabled}
                onCheckedChange={setBoolean("enabled")}
                disabled={disabled}
                aria-label="Enable memory search"
              />
            </div>
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow compact label="Session start" description="Refresh the index when a new agent session starts.">
            <div className="flex h-9 items-center justify-end">
              <Switch
                checked={settings.onSessionStart}
                onCheckedChange={setBoolean("onSessionStart")}
                disabled={disabled}
                aria-label="Sync on session start"
              />
            </div>
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow compact label="Search fallback" description="Let memory search trigger a sync when the index is missing or stale.">
            <div className="flex h-9 items-center justify-end">
              <Switch
                checked={settings.onSearch}
                onCheckedChange={setBoolean("onSearch")}
                disabled={disabled}
                aria-label="Sync on search"
              />
            </div>
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow compact label="File watcher" description="Watch memory files and sync after writes settle.">
            <div className="flex h-9 items-center justify-end">
              <Switch
                checked={settings.watch}
                onCheckedChange={setBoolean("watch")}
                disabled={disabled}
                aria-label="Watch memory files"
              />
            </div>
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow compact label="Watch debounce" description="Seconds of quiet time before watcher sync runs.">
            <input
              type="number"
              min={0}
              step={1}
              value={settings.watchDebounceMs / 1000}
              onChange={setDebounceSeconds}
              disabled={disabled}
              aria-label="Watch debounce seconds"
              className={SETTINGS_FIELD_CLASS}
            />
          </AgentProfileSettingsRow>

          <AgentProfileSettingsRow compact label="Interval sync" description="Periodic sync interval in minutes. Use 0 to disable.">
            <input
              type="number"
              min={0}
              step={1}
              value={settings.intervalMinutes}
              onChange={setIntervalMinutes}
              disabled={disabled}
              aria-label="Interval sync minutes"
              className={SETTINGS_FIELD_CLASS}
            />
          </AgentProfileSettingsRow>
        </section>
      </div>
    </div>
  );
}

function AgentUsageSettingsContent() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-7 text-left sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <h2 className="text-xl font-semibold leading-tight text-foreground">Usage</h2>
        <section className="mt-7 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Link
              href={DASHBOARD_VIEW_HREFS.usage}
              className="flex min-h-[92px] items-center gap-3 rounded-xl border border-border bg-surface-low/40 px-4 transition-colors hover:bg-surface-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-high">
                <BarChart3 className="h-4 w-4 text-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-5 text-foreground">Usage dashboard</p>
                <p className="mt-1 text-xs font-medium leading-5 text-text-muted">View token usage, requests, and current limits.</p>
              </div>
            </Link>
            <Link
              href="/keys"
              className="flex min-h-[92px] items-center gap-3 rounded-xl border border-border bg-surface-low/40 px-4 transition-colors hover:bg-surface-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-high">
                <KeyRound className="h-4 w-4 text-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-5 text-foreground">API keys</p>
                <p className="mt-1 text-xs font-medium leading-5 text-text-muted">Manage keys and inspect key-level activity.</p>
              </div>
            </Link>
          </div>
          <div className="flex min-h-[76px] items-center justify-between gap-4 rounded-xl border border-border bg-surface-low/40 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-5 text-foreground">Current plan limits</p>
              <p className="mt-1 text-sm leading-5 text-text-muted">Open the usage dashboard for live plan limits.</p>
            </div>
            <AgentSettingsLinkButton href={DASHBOARD_VIEW_HREFS.usage}>Open usage</AgentSettingsLinkButton>
          </div>
        </section>
      </div>
    </div>
  );
}

export function AgentSettingsPanel(props: AgentSettingsPanelProps) {
  const {
    agent,
    activeSection: controlledActiveSection,
    onSectionChange,
    showSectionNavigation = true,
    user,
    getToken,
    onProfileNameChange,
    onProfileAvatarChange,
    onStartAgent,
    onStopAgent,
    onArchiveAgent,
    onRestoreAgent,
    onDeleteAgent,
    onLogout,
    agentStarting = false,
    agentStopping = false,
    agentArchiving = false,
    agentRestoring = false,
    agentDeleting = false,
    agentStartBlocked = false,
    agentStartBlockedReason = null,
    openclawConfig = null,
    openclawModels = null,
    reportedChannels = [],
    reportedChannelsReady = false,
    onUpdateAgentProfile,
    onUpdateExternalAgentProfile,
    onUploadAgentAvatar,
    onDeleteAgentAvatar,
    onUpdateAgentLaunchConfig,
    onSaveOpenClawConfig,
    isDesktopViewport = true,
  } = props;
  const [internalActiveSection, setInternalActiveSection] = React.useState<AgentSettingsSection>("general");
  const activeSettingsSection = controlledActiveSection ?? internalActiveSection;
  const selectSettingsSection = (section: AgentSettingsSection) => {
    setInternalActiveSection(section);
    onSectionChange?.(section);
  };
  const [savedProfileName, setSavedProfileName] = React.useState(() => profileNameFromUser(user));
  const [profileName, setProfileName] = React.useState(() => profileNameFromUser(user));
  const [loadedProfileUser, setLoadedProfileUser] = React.useState<{ authUserId: string | null; userId: string } | null>(null);
  const [savedProfileAvatar, setSavedProfileAvatar] = React.useState<string | null>(() => profileAvatarFromUser(user));
  const [profileAvatar, setProfileAvatar] = React.useState<string | null>(() => profileAvatarFromUser(user));
  const [profileAvatarFile, setProfileAvatarFile] = React.useState<File | null>(null);
  const [profileSaving, setProfileSaving] = React.useState(false);
  const [profileError, setProfileError] = React.useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = React.useState<string | null>(null);
  const [savedAgentName, setSavedAgentName] = React.useState(() => agentSettingsName(agent));
  const [agentNameDraft, setAgentNameDraft] = React.useState(() => agentSettingsName(agent));
  const [savedAgentDisplayName, setSavedAgentDisplayName] = React.useState(() => agentSettingsDisplayName(agent));
  const [agentDisplayNameDraft, setAgentDisplayNameDraft] = React.useState(() => agentSettingsDisplayName(agent));
  const [savedAgentHandle, setSavedAgentHandle] = React.useState(() => agentSettingsHandle(agent));
  const [agentHandleDraft, setAgentHandleDraft] = React.useState(() => agentSettingsHandle(agent));
  const [savedAgentAvatar, setSavedAgentAvatar] = React.useState<string | null>(() => agentSettingsAvatar(agent));
  const [agentAvatarDraft, setAgentAvatarDraft] = React.useState<string | null>(() => agentSettingsAvatar(agent));
  const [agentAvatarFile, setAgentAvatarFile] = React.useState<File | null>(null);
  const [savedAgentAvatarRemovable, setSavedAgentAvatarRemovable] = React.useState(Boolean(agent?.avatarUrl));
  const [savedAgentImage, setSavedAgentImage] = React.useState(() => launchConfigImage(agent));
  const [agentImageDraft, setAgentImageDraft] = React.useState(() => launchConfigImage(agent));
  const [savedAdditionalEnvDraft, setSavedAdditionalEnvDraft] = React.useState(() => additionalEnvTextFromAgent(agent));
  const [additionalEnvDraft, setAdditionalEnvDraft] = React.useState(() => additionalEnvTextFromAgent(agent));
  const [savedManagedHyperEnvDraft, setSavedManagedHyperEnvDraft] = React.useState(() => managedHyperEnvTextFromAgent(agent));
  const [managedHyperEnvDraft, setManagedHyperEnvDraft] = React.useState(() => managedHyperEnvTextFromAgent(agent));
  const [savedDesktopEnabled, setSavedDesktopEnabled] = React.useState(() => getDesktopEnabled(agent));
  const [desktopEnabledDraft, setDesktopEnabledDraft] = React.useState(() => getDesktopEnabled(agent));
  const [savedSlackEnabled, setSavedSlackEnabled] = React.useState(() => getSlackEnabled(agent));
  const [slackEnabledDraft, setSlackEnabledDraft] = React.useState(() => getSlackEnabled(agent));
  const [savedWorkspacesSyncDraft, setSavedWorkspacesSyncDraft] = React.useState(() => getWorkspacesSyncSettings(agent));
  const [workspacesSyncDraft, setWorkspacesSyncDraft] = React.useState(() => getWorkspacesSyncSettings(agent));
  const [savedArchiveDraft, setSavedArchiveDraft] = React.useState("not-configured");
  const [archiveDraft, setArchiveDraft] = React.useState("not-configured");
  const [savedModelDraft, setSavedModelDraft] = React.useState(() => getOpenClawDefaultModel(openclawConfig));
  const [modelDraft, setModelDraft] = React.useState(() => getOpenClawDefaultModel(openclawConfig));
  const [savedMemoryIndexDraft, setSavedMemoryIndexDraft] = React.useState(() => getMemoryIndexSettings(openclawConfig));
  const [memoryIndexDraft, setMemoryIndexDraft] = React.useState(() => getMemoryIndexSettings(openclawConfig));
  const [agentSettingsError, setAgentSettingsError] = React.useState<string | null>(null);
  const [agentSettingsSuccess, setAgentSettingsSuccess] = React.useState<string | null>(null);
  const [confirmImageChange, setConfirmImageChange] = React.useState(false);
  const objectUrlsRef = React.useRef<string[]>([]);
  const profileLoadRequestRef = React.useRef(0);
  const profileAvatarMutationUserIdRef = React.useRef<string | null>(null);
  const profileAuthUserIdRef = React.useRef(user?.id ?? null);
  const syncedAgentSettingsIdRef = React.useRef(agent?.id ?? null);
  const syncedAgentAvatarRef = React.useRef(agentSettingsAvatar(agent));
  const authUserId = user?.id ?? null;
  const authProfileName = profileNameFromUser(user);
  const authProfileAvatar = profileAvatarFromUser(user);
  const profileUserId = loadedProfileUser?.authUserId === authUserId
    ? loadedProfileUser.userId
    : profileUserIdFromUser(user);

  React.useEffect(() => {
    if (!agentSettingsError) return;
    const timer = window.setTimeout(() => setAgentSettingsError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [agentSettingsError]);

  React.useEffect(() => {
    const userChanged = profileAuthUserIdRef.current !== authUserId;
    profileAuthUserIdRef.current = authUserId;
    if (userChanged) profileAvatarMutationUserIdRef.current = null;
    profileLoadRequestRef.current += 1;
    setSavedProfileName(authProfileName);
    setProfileName(authProfileName);
    if (profileAvatarMutationUserIdRef.current !== authUserId) {
      setSavedProfileAvatar(authProfileAvatar);
      setProfileAvatar(authProfileAvatar);
      setProfileAvatarFile(null);
    }
    setProfileError(null);
    setProfileSuccess(null);
  }, [authProfileAvatar, authProfileName, authUserId]);

  React.useEffect(() => {
    if (!getToken || !authUserId) return;

    let active = true;
    const requestId = ++profileLoadRequestRef.current;

    const loadProfile = async () => {
      try {
        const token = await getToken();
        const client = createBrowserHyperCLIClient(token);
        const [profile, profileImage] = await Promise.all([
          client.user.get(),
          client.user.getProfileImage().catch(() => undefined),
        ]);
        if (!active || requestId !== profileLoadRequestRef.current) return;
        const nextName = profile.name ?? authProfileName;
        setLoadedProfileUser({ authUserId, userId: profile.userId });
        setSavedProfileName(nextName);
        setProfileName(nextName);
        if (profileImage && profileAvatarMutationUserIdRef.current !== authUserId) {
          const nextAvatar = profileImage.avatarUrl ?? null;
          setSavedProfileAvatar(nextAvatar);
          setProfileAvatar(nextAvatar);
          setProfileAvatarFile(null);
        }
      } catch (error) {
        if (!active) return;
        setProfileError(error instanceof Error ? error.message : "Failed to load profile.");
      }
    };

    void loadProfile();

    return () => {
      active = false;
    };
  }, [authProfileName, authUserId, getToken]);

  React.useEffect(() => {
    const nextAgentId = agent?.id ?? null;
    const agentChanged = syncedAgentSettingsIdRef.current !== nextAgentId;
    syncedAgentSettingsIdRef.current = nextAgentId;
    const nextName = agentSettingsName(agent);
    const nextDisplayName = agentSettingsDisplayName(agent);
    const nextHandle = agentSettingsHandle(agent);
    const nextAvatar = agentSettingsAvatar(agent);
    const agentAvatarPropChanged = agentChanged || syncedAgentAvatarRef.current !== nextAvatar;
    syncedAgentAvatarRef.current = nextAvatar;
    setAgentNameDraft((current) => agentChanged || current === savedAgentName ? nextName : current);
    setSavedAgentName(nextName);
    setAgentDisplayNameDraft((current) => agentChanged || current === savedAgentDisplayName ? nextDisplayName : current);
    setSavedAgentDisplayName(nextDisplayName);
    setAgentHandleDraft((current) => agentChanged || current === savedAgentHandle ? nextHandle : current);
    setSavedAgentHandle(nextHandle);
    if (agentAvatarPropChanged) {
      setAgentAvatarDraft((current) => agentChanged || current === savedAgentAvatar ? nextAvatar : current);
      setSavedAgentAvatar(nextAvatar);
      setSavedAgentAvatarRemovable(Boolean(agent?.avatarUrl));
    }
    const nextImage = launchConfigImage(agent);
    const nextAdditionalEnv = additionalEnvTextFromAgent(agent);
    const nextManagedHyperEnv = managedHyperEnvTextFromAgent(agent);
    const nextDesktopEnabled = getDesktopEnabled(agent);
    const nextSlackEnabled = getSlackEnabled(agent);
    const nextWorkspacesSync = getWorkspacesSyncSettings(agent);
    setAgentImageDraft((current) => agentChanged || current === savedAgentImage ? nextImage : current);
    setSavedAgentImage(nextImage);
    setAdditionalEnvDraft((current) => agentChanged || current === savedAdditionalEnvDraft ? nextAdditionalEnv : current);
    setSavedAdditionalEnvDraft(nextAdditionalEnv);
    setManagedHyperEnvDraft((current) => agentChanged || current === savedManagedHyperEnvDraft ? nextManagedHyperEnv : current);
    setSavedManagedHyperEnvDraft(nextManagedHyperEnv);
    setDesktopEnabledDraft((current) => agentChanged || current === savedDesktopEnabled ? nextDesktopEnabled : current);
    setSavedDesktopEnabled(nextDesktopEnabled);
    setSlackEnabledDraft((current) => agentChanged || current === savedSlackEnabled ? nextSlackEnabled : current);
    setSavedSlackEnabled(nextSlackEnabled);
    setWorkspacesSyncDraft((current) => (
      agentChanged || workspacesSyncSettingsEqual(current, savedWorkspacesSyncDraft)
        ? nextWorkspacesSync
        : current
    ));
    setSavedWorkspacesSyncDraft((current) => (
      workspacesSyncSettingsEqual(current, nextWorkspacesSync) ? current : nextWorkspacesSync
    ));
    if (agentChanged) {
      setAgentAvatarFile(null);
      setSavedArchiveDraft("not-configured");
      setArchiveDraft("not-configured");
      setAgentSettingsError(null);
      setAgentSettingsSuccess(null);
      setConfirmImageChange(false);
    }
  }, [agent, savedAdditionalEnvDraft, savedAgentAvatar, savedAgentDisplayName, savedAgentHandle, savedAgentImage, savedAgentName, savedDesktopEnabled, savedManagedHyperEnvDraft, savedSlackEnabled, savedWorkspacesSyncDraft]);

  React.useEffect(() => {
    const nextModel = getOpenClawDefaultModel(openclawConfig);
    const nextMemoryIndex = getMemoryIndexSettings(openclawConfig);
    setSavedModelDraft(nextModel);
    setModelDraft(nextModel);
    setSavedMemoryIndexDraft(nextMemoryIndex);
    setMemoryIndexDraft(nextMemoryIndex);
    setAgentSettingsError(null);
    setAgentSettingsSuccess(null);
  }, [agent?.id, openclawConfig]);

  React.useEffect(() => () => {
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current = [];
  }, []);

  const modelOptions = React.useMemo(
    () => normalizeOpenClawModelOptions(openclawConfig, openclawModels, modelDraft),
    [modelDraft, openclawConfig, openclawModels],
  );

  const profileNameChanged = profileName !== savedProfileName;
  const profileAvatarChanged = Boolean(profileAvatarFile) || profileAvatar !== savedProfileAvatar;
  const profileChanged = profileNameChanged || profileAvatarChanged;
  const externalAgent = agent?.managed === false;
  const normalizedSavedAgentHandle = normalizeAgentHandle(savedAgentHandle);
  const normalizedAgentHandleDraft = normalizeAgentHandle(agentHandleDraft);
  const agentAvatarChanged = Boolean(agentAvatarFile) || agentAvatarDraft !== savedAgentAvatar;
  const agentProfileChanged = agentNameDraft !== savedAgentName
    || agentDisplayNameDraft !== savedAgentDisplayName
    || normalizedAgentHandleDraft !== normalizedSavedAgentHandle
    || agentAvatarChanged
    || archiveDraft !== savedArchiveDraft;
  const desktopChanged = desktopEnabledDraft !== savedDesktopEnabled;
  const slackChanged = slackEnabledDraft !== savedSlackEnabled;
  const workspacesSyncChanged = !workspacesSyncSettingsEqual(workspacesSyncDraft, savedWorkspacesSyncDraft);
  const agentLaunchChanged = agentImageDraft !== savedAgentImage
    || additionalEnvDraft !== savedAdditionalEnvDraft
    || managedHyperEnvDraft !== savedManagedHyperEnvDraft
    || desktopChanged
    || slackChanged
    || workspacesSyncChanged;
  const modelChanged = modelDraft !== savedModelDraft;
  const memoryIndexChanged = !memoryIndexSettingsEqual(memoryIndexDraft, savedMemoryIndexDraft);
  const agentChanged = agentProfileChanged || agentLaunchChanged || modelChanged || memoryIndexChanged;
  const hasSettingsChanges = profileChanged || agentChanged;
  const configuredChannelIds = React.useMemo(() => Array.from(new Set(
    reportedChannels
      .filter((channel) => channel.configured)
      .map((channel) => channel.channelId),
  )), [reportedChannels]);

  const discardProfileChanges = React.useCallback(() => {
    setProfileName(savedProfileName);
    setProfileAvatar(savedProfileAvatar);
    setProfileAvatarFile(null);
    setAgentNameDraft(savedAgentName);
    setAgentDisplayNameDraft(savedAgentDisplayName);
    setAgentHandleDraft(savedAgentHandle);
    setAgentAvatarDraft(savedAgentAvatar);
    setAgentAvatarFile(null);
    setAgentImageDraft(savedAgentImage);
    setAdditionalEnvDraft(savedAdditionalEnvDraft);
    setManagedHyperEnvDraft(savedManagedHyperEnvDraft);
    setDesktopEnabledDraft(savedDesktopEnabled);
    setSlackEnabledDraft(savedSlackEnabled);
    setWorkspacesSyncDraft(savedWorkspacesSyncDraft);
    setArchiveDraft(savedArchiveDraft);
    setModelDraft(savedModelDraft);
    setMemoryIndexDraft(savedMemoryIndexDraft);
    setAgentSettingsError(null);
    setAgentSettingsSuccess(null);
  }, [savedAdditionalEnvDraft, savedAgentAvatar, savedAgentDisplayName, savedAgentHandle, savedAgentImage, savedAgentName, savedArchiveDraft, savedDesktopEnabled, savedManagedHyperEnvDraft, savedMemoryIndexDraft, savedModelDraft, savedProfileAvatar, savedProfileName, savedSlackEnabled, savedWorkspacesSyncDraft]);

  const saveProfileChanges = React.useCallback(async (removeConfiguredChannels = false) => {
    setProfileError(null);
    setProfileSuccess(null);
    setAgentSettingsError(null);
    setAgentSettingsSuccess(null);

    if (!agent) return;
    if (!hasSettingsChanges) return;

    if (profileChanged && !getToken) {
      setProfileError("Profile updates are unavailable without an authenticated account session.");
      return;
    }

    const agentNameChanged = agentNameDraft !== savedAgentName;
    const nextAgentName = agentNameDraft.trim();
    const agentDisplayNameChanged = agentDisplayNameDraft !== savedAgentDisplayName;
    const nextAgentDisplayName = agentDisplayNameDraft.trim() || null;
    const managedDisplayNameChanged = !externalAgent && agentDisplayNameChanged;
    const nextAgentHandle = externalAgent
      ? normalizedAgentHandleDraft
      : nextAgentDisplayName === nextAgentName
        ? null
        : normalizeAgentHandle(agentDisplayNameDraft);
    const agentHandleChanged = externalAgent
      ? normalizedAgentHandleDraft !== normalizedSavedAgentHandle
      : managedDisplayNameChanged;
    const backendProfileChanged = agentNameChanged || agentHandleChanged || (externalAgent && agentDisplayNameChanged);
    const agentImageChanged = agentImageDraft !== savedAgentImage;
    const additionalEnvChanged = additionalEnvDraft !== savedAdditionalEnvDraft;
    const managedHyperEnvChanged = managedHyperEnvDraft !== savedManagedHyperEnvDraft;
    const nextAgentImage = agentImageDraft.trim();

    if (agentNameChanged && !nextAgentName) {
      setAgentSettingsError("Agent name is required.");
      return;
    }

    if (agentHandleChanged && !validAgentHandle(nextAgentHandle)) {
      setAgentSettingsError(externalAgent
        ? "Slack handles must start with a letter or number and contain 2-64 letters, numbers, spaces, underscores, or dashes."
        : "Display names must start with a letter or number and contain 2-64 letters, numbers, spaces, underscores, or dashes.");
      return;
    }

    if (agentLaunchChanged && !nextAgentImage) {
      setAgentSettingsError("Docker image is required.");
      return;
    }

    if (agentLaunchChanged) {
      try {
        parseAdditionalEnvText(additionalEnvDraft);
        parseManagedHyperEnvText(managedHyperEnvDraft);
      } catch (error) {
        setAgentSettingsError(error instanceof Error ? error.message : "Environment variables are invalid.");
        return;
      }
    }

    if (backendProfileChanged && (externalAgent ? !onUpdateExternalAgentProfile : !onUpdateAgentProfile)) {
      setAgentSettingsError("Agent profile updates are unavailable.");
      return;
    }

    if (agentAvatarFile && !onUploadAgentAvatar) {
      setAgentSettingsError("Agent avatar uploads are unavailable.");
      return;
    }
    if (agentAvatarChanged && !agentAvatarFile && !agentAvatarDraft && !onDeleteAgentAvatar) {
      setAgentSettingsError("Agent avatar removal is unavailable.");
      return;
    }

    if ((agentLaunchChanged || memoryIndexChanged) && !onUpdateAgentLaunchConfig) {
      setAgentSettingsError("Runtime launch updates are unavailable.");
      return;
    }

    if (modelChanged && !onSaveOpenClawConfig) {
      setAgentSettingsError("Model updates are unavailable until the agent gateway is connected.");
      return;
    }

    if (memoryIndexChanged && !onSaveOpenClawConfig) {
      setAgentSettingsError("Index updates are unavailable until the agent gateway is connected.");
      return;
    }

    if (agentImageChanged && !reportedChannelsReady) {
      setAgentSettingsError("Connect the agent and wait for its channels to load before changing the Docker image.");
      return;
    }

    if (agentImageChanged && configuredChannelIds.length > 0 && !removeConfiguredChannels) {
      setConfirmImageChange(true);
      return;
    }

    if (agentImageChanged && configuredChannelIds.length > 0 && !onSaveOpenClawConfig) {
      setAgentSettingsError("Channel setup cannot be removed until the agent gateway is connected.");
      return;
    }

    setProfileSaving(true);
    let savingSection: "profile" | "agent" | null = null;
    let savingAvatar: "profile" | "agent" | null = null;
    try {
      if (profileChanged && getToken) {
        savingSection = "profile";
        profileLoadRequestRef.current += 1;
        const token = await getToken();
        const client = createBrowserHyperCLIClient(token);
        if (profileNameChanged) {
          const updated = await client.user.update({ name: profileName.trim() });
          const nextName = updated.name ?? profileName.trim();
          setSavedProfileName(nextName);
          setProfileName(nextName);
          onProfileNameChange?.(nextName);
        }
        if (profileAvatarFile) {
          savingAvatar = "profile";
          const selectedFile = profileAvatarFile;
          const localAvatarUrl = profileAvatar;
          const uploaded = await client.user.uploadProfileImage(selectedFile);
          if (!uploaded.avatarUrl) throw new Error("Profile image upload returned no URL.");
          setSavedProfileAvatar(localAvatarUrl ?? uploaded.avatarUrl);
          setProfileAvatar(localAvatarUrl ?? uploaded.avatarUrl);
          setProfileAvatarFile(null);
          onProfileAvatarChange?.(uploaded.avatarUrl, selectedFile);
        } else if (profileAvatarChanged && !profileAvatar) {
          savingAvatar = "profile";
          await client.user.deleteProfileImage();
          setSavedProfileAvatar(null);
          setProfileAvatar(null);
          onProfileAvatarChange?.(null);
        }
        setProfileSuccess("Profile updated.");
      }

      if (backendProfileChanged && externalAgent && onUpdateExternalAgentProfile) {
        savingSection = "agent";
        await onUpdateExternalAgentProfile(agent.id, {
          ...(agentNameChanged ? { name: nextAgentName } : {}),
          ...(agentDisplayNameChanged ? { displayName: nextAgentDisplayName } : {}),
          ...(agentHandleChanged ? { handle: nextAgentHandle } : {}),
        });
        if (agentNameChanged) {
          setAgentNameDraft(nextAgentName);
          setSavedAgentName(nextAgentName);
        }
        if (agentDisplayNameChanged) {
          const savedDisplayName = nextAgentDisplayName ?? nextAgentName;
          setAgentDisplayNameDraft(savedDisplayName);
          setSavedAgentDisplayName(savedDisplayName);
        }
        if (agentHandleChanged) {
          setAgentHandleDraft(nextAgentHandle ?? "");
          setSavedAgentHandle(nextAgentHandle ?? "");
        }
        setAgentSettingsSuccess("Agent settings updated.");
      } else if (backendProfileChanged && !externalAgent && onUpdateAgentProfile) {
        savingSection = "agent";
        await onUpdateAgentProfile(agent.id, {
          ...(agentNameChanged ? { name: nextAgentName } : {}),
          ...(agentHandleChanged ? { handle: nextAgentHandle } : {}),
        });
        if (agentNameChanged) {
          setAgentNameDraft(nextAgentName);
          setSavedAgentName(nextAgentName);
        }
        if (agentHandleChanged) {
          setAgentHandleDraft(nextAgentHandle ?? "");
          setSavedAgentHandle(nextAgentHandle ?? "");
          const savedDisplayName = nextAgentHandle
            ? displayNameFromAgentHandle(nextAgentHandle)
            : nextAgentName;
          setAgentDisplayNameDraft(savedDisplayName);
          setSavedAgentDisplayName(savedDisplayName);
        }
        setAgentSettingsSuccess("Agent settings updated.");
      }

      if (agentAvatarFile && onUploadAgentAvatar) {
        savingSection = "agent";
        savingAvatar = "agent";
        const selectedFile = agentAvatarFile;
        const localAvatarUrl = agentAvatarDraft;
        const avatarUrl = await onUploadAgentAvatar(agent.id, selectedFile);
        setAgentAvatarDraft(localAvatarUrl ?? avatarUrl);
        setSavedAgentAvatar(localAvatarUrl ?? avatarUrl);
        setSavedAgentAvatarRemovable(true);
        setAgentAvatarFile(null);
        setAgentSettingsSuccess("Agent settings updated.");
      } else if (agentAvatarChanged && !agentAvatarDraft && onDeleteAgentAvatar) {
        savingSection = "agent";
        savingAvatar = "agent";
        await onDeleteAgentAvatar(agent.id);
        const fallbackAvatar = agentSettingsAvatarFallback(agent);
        setSavedAgentAvatar(fallbackAvatar);
        setAgentAvatarDraft(fallbackAvatar);
        setSavedAgentAvatarRemovable(false);
        setAgentSettingsSuccess("Agent settings updated.");
      }

      if (agentImageChanged && configuredChannelIds.length > 0 && onSaveOpenClawConfig) {
        savingSection = "agent";
        await onSaveOpenClawConfig({ channels: null });
      }

      if ((agentImageChanged || additionalEnvChanged || managedHyperEnvChanged || desktopChanged || slackChanged || workspacesSyncChanged || memoryIndexChanged) && onUpdateAgentLaunchConfig) {
        savingSection = "agent";
        await onUpdateAgentLaunchConfig(agent.id, buildUpdatedLaunchConfig(
          agent,
          nextAgentImage,
          additionalEnvDraft,
          managedHyperEnvDraft,
          desktopEnabledDraft,
          slackEnabledDraft,
          workspacesSyncDraft,
          workspacesSyncChanged,
          memoryIndexChanged ? memoryIndexDraft : null,
        ));
        setAgentImageDraft(nextAgentImage);
        setSavedAgentImage(nextAgentImage);
        setSavedAdditionalEnvDraft(additionalEnvDraft);
        setSavedManagedHyperEnvDraft(managedHyperEnvDraft);
        setSavedDesktopEnabled(desktopEnabledDraft);
        setSavedSlackEnabled(slackEnabledDraft);
        const savedWorkspacesSync = workspacesSyncChanged
          ? workspacesSyncDraft
          : workspacesSyncSettingsFromManagedEnv(managedHyperEnvDraft, workspacesSyncDraft);
        setWorkspacesSyncDraft(savedWorkspacesSync);
        setSavedWorkspacesSyncDraft(savedWorkspacesSync);
        setAgentSettingsSuccess("Agent settings updated.");
        setConfirmImageChange(false);
      }

      if (modelChanged && onSaveOpenClawConfig) {
        savingSection = "agent";
        await onSaveOpenClawConfig(buildOpenClawDefaultModelPatch(modelDraft));
        setSavedModelDraft(modelDraft);
        setAgentSettingsSuccess("Agent settings updated.");
      }

      if (memoryIndexChanged && onSaveOpenClawConfig) {
        savingSection = "agent";
        await onSaveOpenClawConfig(buildMemoryIndexPatch(memoryIndexDraft));
        setSavedMemoryIndexDraft(memoryIndexDraft);
        setAgentSettingsSuccess("Agent settings updated.");
      }

      setSavedArchiveDraft(archiveDraft);
    } catch (error) {
      const message = savingAvatar
        ? avatarMutationErrorMessage(error, savingAvatar)
        : error instanceof Error ? error.message : "Failed to save settings.";
      if (removeConfiguredChannels) setConfirmImageChange(false);
      if (savingSection === "agent") {
        setAgentSettingsError(message);
      } else {
        setProfileError(message);
      }
    } finally {
      setProfileSaving(false);
    }
  }, [
    additionalEnvDraft,
    agentLaunchChanged,
    agentAvatarDraft,
    agentAvatarChanged,
    agentAvatarFile,
    agentDisplayNameDraft,
    agentImageDraft,
    agentNameDraft,
    agent,
    archiveDraft,
    configuredChannelIds,
    desktopChanged,
    desktopEnabledDraft,
    externalAgent,
    getToken,
    hasSettingsChanges,
    memoryIndexChanged,
    memoryIndexDraft,
    managedHyperEnvDraft,
    savedManagedHyperEnvDraft,
    modelChanged,
    modelDraft,
    normalizedAgentHandleDraft,
    normalizedSavedAgentHandle,
    onUpdateExternalAgentProfile,
    onUpdateAgentLaunchConfig,
    onUpdateAgentProfile,
    onProfileAvatarChange,
    onProfileNameChange,
    onUploadAgentAvatar,
    onDeleteAgentAvatar,
    onSaveOpenClawConfig,
    profileAvatar,
    profileAvatarChanged,
    profileAvatarFile,
    profileChanged,
    profileName,
    profileNameChanged,
    reportedChannelsReady,
    savedAdditionalEnvDraft,
    savedAgentDisplayName,
    savedAgentImage,
    savedAgentName,
    slackChanged,
    slackEnabledDraft,
    savedProfileAvatar,
    workspacesSyncChanged,
    workspacesSyncDraft,
  ]);

  const handleAvatarSelect = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const validationError = profileImageValidationError(file);
    if (validationError) {
      setProfileError(validationError);
      setProfileSuccess(null);
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    objectUrlsRef.current.push(nextUrl);
    profileLoadRequestRef.current += 1;
    profileAvatarMutationUserIdRef.current = authUserId;
    setProfileAvatarFile(file);
    setProfileAvatar(nextUrl);
    setProfileError(null);
    setProfileSuccess(null);
  }, [authUserId]);

  const handleAgentAvatarSelect = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const validationError = profileImageValidationError(file);
    if (validationError) {
      setAgentSettingsError(validationError);
      setAgentSettingsSuccess(null);
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    objectUrlsRef.current.push(nextUrl);
    setAgentAvatarFile(file);
    setAgentAvatarDraft(nextUrl);
    setAgentSettingsError(null);
    setAgentSettingsSuccess(null);
  }, []);

  if (!agent) return null;

  return (
    <div className={`flex h-full min-h-0 bg-background ${isDesktopViewport ? "flex-row" : "flex-col"}`}>
      {showSectionNavigation && isDesktopViewport ? (
        <aside className="h-full w-[208px] shrink-0 border-r border-border px-4 py-5">
          <h2 className="text-xl font-semibold leading-none text-foreground">Settings</h2>
          <nav aria-label="Settings sections" className="mt-6 flex flex-col gap-1">
            {AGENT_SETTINGS_SECTIONS.map((section) => {
              const active = activeSettingsSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => selectSettingsSection(section.id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-8 min-w-0 w-full items-center rounded-lg px-2.5 text-left font-sans text-sm font-normal not-italic leading-5 text-sidebar-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      ? "bg-surface-low"
                      : "hover:bg-surface-low/70"
                  }`}
                >
                  <span className="min-w-0 truncate">{section.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>
      ) : showSectionNavigation ? (
        <AgentSettingsMobileChrome
          activeSection={activeSettingsSection}
          onSectionChange={(sectionId) => selectSettingsSection(sectionId as AgentSettingsSection)}
          sections={AGENT_SETTINGS_SECTIONS}
        />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {activeSettingsSection === "general" ? (
          <AgentGeneralSettingsContent
            user={user}
            profileUserId={profileUserId}
            profileName={profileName}
            profileAvatar={profileAvatar}
            profileError={profileError}
            profileSuccess={profileSuccess}
            onProfileNameChange={setProfileName}
            onAvatarSelect={handleAvatarSelect}
            onAvatarRemove={() => {
              profileLoadRequestRef.current += 1;
              profileAvatarMutationUserIdRef.current = authUserId;
              setProfileAvatarFile(null);
              setProfileAvatar(null);
            }}
            avatarUpdatesEnabled={Boolean(getToken)}
            onLogout={onLogout}
            showSessionActions={isDesktopViewport}
          />
        ) : activeSettingsSection === "agent" ? (
          <AgentSectionSettingsContent
            agent={agent}
            agentName={agentNameDraft}
            agentDisplayName={agentDisplayNameDraft}
            agentHandle={agentHandleDraft}
            agentAvatarPreview={agentAvatarDraft}
            onAgentNameChange={setAgentNameDraft}
            onAgentDisplayNameChange={setAgentDisplayNameDraft}
            onAgentHandleChange={setAgentHandleDraft}
            onAgentAvatarSelect={handleAgentAvatarSelect}
            onAgentAvatarRemove={() => {
              if (agentAvatarFile) {
                setAgentAvatarFile(null);
                setAgentAvatarDraft(savedAgentAvatar);
              } else {
                setAgentAvatarDraft(null);
              }
            }}
            agentAvatarUploadPending={Boolean(agentAvatarFile)}
            agentAvatarCanRemove={savedAgentAvatarRemovable}
            agentAvatarUploadEnabled={Boolean(onUploadAgentAvatar)}
            agentAvatarRemoveEnabled={Boolean(onDeleteAgentAvatar)}
            agentImageDraft={agentImageDraft}
            onAgentImageChange={setAgentImageDraft}
            additionalEnvDraft={additionalEnvDraft}
            onAdditionalEnvChange={setAdditionalEnvDraft}
            managedHyperEnvDraft={managedHyperEnvDraft}
            onManagedHyperEnvChange={setManagedHyperEnvDraft}
            desktopEnabled={desktopEnabledDraft}
            onDesktopEnabledChange={setDesktopEnabledDraft}
            slackEnabled={slackEnabledDraft}
            onSlackEnabledChange={setSlackEnabledDraft}
            workspacesSync={workspacesSyncDraft}
            onWorkspacesSyncChange={setWorkspacesSyncDraft}
            modelDraft={modelDraft}
            modelOptions={modelOptions}
            modelSelectionDisabled={!onSaveOpenClawConfig}
            onModelChange={setModelDraft}
            archiveDraft={archiveDraft}
            onArchiveChange={setArchiveDraft}
            agentSettingsError={agentSettingsError}
            agentSettingsSuccess={agentSettingsSuccess}
            onStartAgent={onStartAgent}
            onStopAgent={onStopAgent}
            onArchiveAgent={onArchiveAgent}
            onRestoreAgent={onRestoreAgent}
            onDeleteAgent={onDeleteAgent}
            agentStarting={agentStarting}
            agentStopping={agentStopping}
            agentArchiving={agentArchiving}
            agentRestoring={agentRestoring}
            agentDeleting={agentDeleting}
            agentStartBlocked={agentStartBlocked}
            agentStartBlockedReason={agentStartBlockedReason}
          />
        ) : activeSettingsSection === "index" ? (
          <AgentIndexSettingsContent
            settings={memoryIndexDraft}
            onSettingsChange={setMemoryIndexDraft}
            error={agentSettingsError}
            success={agentSettingsSuccess}
            disabled={!onSaveOpenClawConfig}
          />
        ) : activeSettingsSection === "usage" ? (
          <AgentUsageSettingsContent />
        ) : activeSettingsSection === "team" ? (
          <AgentTeamSettingsContent />
        ) : (
          <div className="min-h-0 flex-1" aria-hidden />
        )}
        <footer className="flex h-[54px] shrink-0 items-center border-t border-border px-4 sm:px-6 md:h-[83px] lg:px-8">
          <div className="mx-auto flex w-full max-w-6xl justify-end gap-3">
            <button
              type="button"
              onClick={discardProfileChanges}
              disabled={!hasSettingsChanges || profileSaving}
              className="h-9 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-low disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => { void saveProfileChanges(); }}
              disabled={!hasSettingsChanges || profileSaving}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--button-primary)] px-3.5 text-sm font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {profileSaving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </footer>
      </div>
      <ConfirmDialog
        open={confirmImageChange}
        title="Remove channels and change image?"
        message={`Changing the runtime image requires permanently removing setup for ${configuredChannelIds.map(humanizeKey).join(", ")}. If the image update fails, that channel setup will still be removed.`}
        confirmLabel="Remove channels and save"
        danger
        loading={profileSaving}
        onCancel={() => { if (!profileSaving) setConfirmImageChange(false); }}
        onConfirm={() => { void saveProfileChanges(true); }}
      />
    </div>
  );
}


export function ErrorBanner({
  error,
  onDismiss,
  onOpenPlanCatalog,
}: {
  error: string | null;
  onDismiss: () => void;
  onOpenPlanCatalog?: () => void | Promise<void>;
}) {
  const capacityError = React.useMemo(() => parseAgentCapacityError(error), [error]);

  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          {capacityError ? (
            <div className="mx-4 mt-3 rounded-[14px] border border-warning/25 bg-warning/10 p-4 text-sm text-warning sm:mx-6 lg:mx-8">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-warning/25 bg-warning/10">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{capacityError.title}</p>
                  <p className="mt-1 max-w-3xl text-[13px] leading-5 text-text-secondary">{capacityError.message}</p>
                  {(capacityError.requestedInventory || capacityError.accountInventory.length > 0) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {capacityError.requestedInventory && (
                        <span className="rounded-full border border-warning/25 bg-background/40 px-2.5 py-1 text-[11px] font-medium text-warning">
                          Requested {capacityError.requestedInventory.free} free / {capacityError.requestedInventory.total} total
                        </span>
                      )}
                      {capacityError.accountInventory.map((entry) => (
                        <span key={entry.tier} className="rounded-full border border-border bg-background/40 px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                          {entry.tier}: {entry.free} free / {entry.total} total
                        </span>
                      ))}
                    </div>
                  )}
                  {onOpenPlanCatalog && (
                    <button
                      type="button"
                      onClick={() => { void onOpenPlanCatalog(); }}
                      className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg bg-[var(--button-primary)] px-3 text-xs font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)]"
                    >
                      Add capacity
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <button type="button" onClick={onDismiss} className="rounded-md p-1 text-warning/80 transition-colors hover:bg-warning/10 hover:text-foreground" aria-label="Dismiss capacity alert">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div
              role="alert"
              data-testid="agent-error-banner"
              className="mx-4 sm:mx-6 lg:mx-8 mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive flex items-center justify-between"
            >
              <span>{error}</span>
              <button onClick={onDismiss} className="ml-2 hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface AgentTierSelectionModalProps {
  tierSelection: {
    agentId: string;
    guidance: {
      title: string;
      message: string;
      availableTiers: Array<{ tier: string; available: number }>;
    };
  } | null;
  setTierSelection: (value: null) => void;
  handleResizeAndStart: (agentId: string, tier: string) => void;
  titleizeTier: (value: string) => string;
}

export function AgentTierSelectionModal({
  tierSelection,
  setTierSelection,
  handleResizeAndStart,
  titleizeTier,
}: AgentTierSelectionModalProps) {
  return (
    <AnimatePresence>
      {tierSelection && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
          onClick={() => setTierSelection(null)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="glass-card w-full max-w-md mx-4 p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">{tierSelection.guidance.title}</h3>
                <p className="mt-1 text-sm text-text-secondary">{tierSelection.guidance.message}</p>
              </div>
              <button
                onClick={() => setTierSelection(null)}
                className="text-text-muted transition-colors hover:text-foreground"
                aria-label="Close size selector"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {tierSelection.guidance.availableTiers.map((entry) => (
                <button
                  key={entry.tier}
                  onClick={() => { void handleResizeAndStart(tierSelection.agentId, entry.tier); }}
                  className="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-left transition-colors hover:bg-surface-low"
                >
                  <span className="text-sm font-medium text-foreground">{titleizeTier(entry.tier)}</span>
                  <span className="text-xs text-text-muted">{entry.available} free</span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


interface AgentListProps {
  sidebarCollapsed: boolean;
  isDesktopViewport: boolean;
  renderMobileNavigation?: boolean;
  mobileShowChat: boolean;
  agents: Agent[];
  rosterLoading?: boolean;
  rosterOrderScope?: string | null;
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string) => void;
  setMobileShowChat: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  syntheticThreads: ConversationThread[];
  agentCardDataById?: Record<string, AgentCardTooltipData>;
  getToken: () => Promise<string>;
  createOpenClawAgent: (apiKey: string, options?: Record<string, unknown>) => Promise<{ id?: string | null }>;
  onCreateAgent?: (params: AgentCreationSetupCreateParams) => Promise<string | null>;
  associateCreatedAgent?: (agentId: string, collectionId: string) => Promise<void>;
  agentCreationDisabledReason?: string | null;
  onOpenAgentLauncher?: () => void;
  agentLauncherSuspended?: boolean;
  fetchAgents: () => Promise<boolean | void>;
  setError: (value: string | null) => void;
  sidebarCreatorSignal: number;
  setPendingAgentDelete: (value: { id: string; name: string } | null) => void;
  accountInitial?: string;
  accountAvatarUrl?: string | null;
  accountName?: string | null;
  accountEmail?: string | null;
  onLogin?: () => void;
  onLogout?: () => void | Promise<void>;
  budget?: {
    slots: Record<string, { granted: number; used: number; available: number }>;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: HyperAgentSubscriptionSummary | null;
  catalogPlans?: HyperAgentPlan[] | null;
  onOpenPlanCatalog?: (planId?: string) => void | Promise<void>;
  preferredPlanId?: string | null;
  onOpenAccountSettings?: () => void;
  accountSettingsActive?: boolean;
  onOpenHome?: () => void;
  homeActive?: boolean;
  homeHref?: string;
  onOpenKnowledgeHub?: () => void;
  knowledgeHubActive?: boolean;
  knowledgeHubHref?: string;
  onOpenMembers?: () => void;
  membersActive?: boolean;
  membersHref?: string;
  onOpenUsage?: () => void;
  usageActive?: boolean;
  usageHref?: string;
  pendingSlotReleases?: Record<string, number>;
  embeddedInNavigation?: boolean;
  /**
   * When true, surfaces the Channels section and the inline user/agent picker that lets
   * teammates be added to a channel. Gated on the Team plan in agent-setup. Default: false.
   */
  showChannels?: boolean;
}

function toAgentCardTooltipData(agent: Agent): AgentCardTooltipData {
  return {
    id: agent.id,
    name: agentDisplayLabel(agent),
    state: agent.state,
    cpuMillicores: agent.cpu_millicores,
    memoryMib: agent.memory_mib,
    hostname: agent.hostname,
    startedAt: agent.started_at,
    updatedAt: agent.updated_at,
    meta: agent.meta,
    avatarUrl: agentProfileImageUrl(agent),
  };
}

export function AgentList({
  sidebarCollapsed,
  isDesktopViewport,
  renderMobileNavigation = false,
  mobileShowChat,
  agents,
  rosterLoading = false,
  rosterOrderScope,
  selectedAgentId,
  setSelectedAgentId,
  setMobileShowChat,
  setSidebarCollapsed,
  syntheticThreads,
  agentCardDataById,
  getToken,
  createOpenClawAgent,
  onCreateAgent,
  associateCreatedAgent,
  agentCreationDisabledReason,
  onOpenAgentLauncher,
  agentLauncherSuspended = false,
  fetchAgents,
  setError,
  sidebarCreatorSignal,
  setPendingAgentDelete,
  accountInitial,
  accountAvatarUrl,
  accountName,
  accountEmail,
  onLogin,
  onLogout,
  budget,
  subscriptionSummary,
  catalogPlans,
  onOpenPlanCatalog,
  preferredPlanId,
  onOpenAccountSettings,
  accountSettingsActive = false,
  onOpenHome,
  homeActive = false,
  homeHref = DASHBOARD_VIEW_HREFS.overview,
  onOpenKnowledgeHub,
  knowledgeHubActive = false,
  knowledgeHubHref = KNOWLEDGE_HUB_HREF,
  onOpenMembers,
  membersActive = false,
  membersHref = "/dashboard/agents?section=members",
  onOpenUsage,
  usageActive = false,
  usageHref = DASHBOARD_VIEW_HREFS.usage,
  pendingSlotReleases,
  embeddedInNavigation = false,
  showChannels = false,
}: AgentListProps) {
  const [showAgentLauncher, setShowAgentLauncher] = React.useState(false);
  const effectiveCreationDisabledReason = rosterLoading
    ? "Agent roster is still loading."
    : agentCreationDisabledReason;
  const openAgentLauncher = React.useCallback(() => {
    if (effectiveCreationDisabledReason) {
      setError(effectiveCreationDisabledReason);
      return;
    }
    if (onOpenAgentLauncher) {
      onOpenAgentLauncher();
      return;
    }
    setShowAgentLauncher(true);
  }, [effectiveCreationDisabledReason, onOpenAgentLauncher, setError]);
  const handledSidebarCreatorSignalRef = React.useRef(0);
  const [showOfflineAgents, setShowOfflineAgents] = useAgentRosterShowOffline();
  const agentIds = React.useMemo(() => agents.map((agent) => agent.id), [agents]);
  const { orderedAgentIds, setVisibleAgentOrder } = useAgentRosterOrder(agentIds, rosterOrderScope);
  const orderedAgents = React.useMemo(() => {
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    return orderedAgentIds.map((agentId) => agentById.get(agentId)).filter((agent): agent is Agent => Boolean(agent));
  }, [agents, orderedAgentIds]);
  const orderedSyntheticThreads = React.useMemo(() => {
    const orderById = new Map(orderedAgentIds.map((agentId, index) => [agentId, index]));
    return [...syntheticThreads].sort((left, right) => (
      (orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    ));
  }, [orderedAgentIds, syntheticThreads]);
  const offlineAgentIds = React.useMemo(
    () => new Set(orderedAgents.filter((agent) => isAgentOffline(agent.state)).map((agent) => agent.id)),
    [orderedAgents],
  );
  const visibleAgents = React.useMemo(
    () => showOfflineAgents ? orderedAgents : orderedAgents.filter((agent) => !offlineAgentIds.has(agent.id)),
    [offlineAgentIds, orderedAgents, showOfflineAgents],
  );
  const visibleSyntheticThreads = React.useMemo(
    () => showOfflineAgents
      ? orderedSyntheticThreads
      : orderedSyntheticThreads.filter((thread) => thread.kind !== "user-agent" || !offlineAgentIds.has(thread.id)),
    [offlineAgentIds, orderedSyntheticThreads, showOfflineAgents],
  );
  const mergedAgentCardDataById = React.useMemo(() => {
    const next: Record<string, AgentCardTooltipData> = {};
    for (const agent of agents) {
      next[agent.id] = toAgentCardTooltipData(agent);
    }
    for (const [agentId, cardData] of Object.entries(agentCardDataById ?? {})) {
      const existing = next[agentId];
      next[agentId] = existing ? { ...existing, ...cardData } : cardData;
    }
    return next;
  }, [agents, agentCardDataById]);

  React.useEffect(() => {
    if (!isDesktopViewport && !renderMobileNavigation) return;
    if (sidebarCreatorSignal === 0 || handledSidebarCreatorSignalRef.current === sidebarCreatorSignal) return;
    if (rosterLoading) return;
    handledSidebarCreatorSignalRef.current = sidebarCreatorSignal;
    openAgentLauncher();
  }, [isDesktopViewport, openAgentLauncher, renderMobileNavigation, rosterLoading, sidebarCreatorSignal]);

  const createAgentFromLauncher = React.useCallback(async ({ name, handle = null, iconIndex, size, files, enableDesktop, enableMemoryIndex = false, customImage = null, knowledgeCollectionId }: AgentCreationSetupCreateParams) => {
    try {
      if (effectiveCreationDisabledReason) throw new Error(effectiveCreationDisabledReason);
      const token = await getToken();
      const created = await createOpenClawAgent(token, {
        name: name || undefined,
        handle,
        size,
        meta: { ui: { avatar: { icon_index: iconIndex } } },
        ...buildOpenClawLaunchOptions({
          desktopEnabled: enableDesktop,
          customImage,
          skipBootstrap: files.length > 0,
          memoryIndex: enableMemoryIndex
            ? { onSessionStart: true, onSearch: true, watch: true, watchDebounceMs: 30000, intervalMinutes: 0 }
            : null,
        }),
      });
      const createdId = created.id ?? null;
      if (createdId) {
        const agentClient = createAgentClient(token);
        await waitForCreatedAgentStopped(agentClient, { ...created, id: createdId });
        try {
          await fetchAgents();
        } catch {}
        if (associateCreatedAgent && knowledgeCollectionId) {
          try {
            await associateCreatedAgent(createdId, knowledgeCollectionId);
          } catch (associationError) {
            const detail = associationError instanceof Error
              ? associationError.message
              : "Collection access is unavailable right now.";
            throw new Error(`Agent was created, but Collection assignment did not complete: ${detail}`);
          }
        }
        const startCreatedAgent = async (agentId: string) => {
          const accepted = await agentClient.start(agentId);
          if (accepted.state.toUpperCase() !== "RUNNING") {
            void Promise.resolve(fetchAgents()).catch(() => undefined);
            await accepted.waitRunning();
          }
        };
        // The workspace write route only answers once the pod is ready, so the
        // starter files are staged alongside the start; a file that never lands
        // is reported afterwards instead of stranding a created Agent.
        let starterFileWarning: string | null = null;
        if (files.length > 0) {
          const staged = await stageAgentStarterFilesAndStart({
            agentId: createdId,
            files,
            writeFileBytes: (agentId, path, content) => (
              agentClient.fileWriteBytes(agentId, path, content)
            ),
            startAgent: startCreatedAgent,
          });
          starterFileWarning = describeStarterFileFailures(staged.failures) || null;
        } else {
          await startCreatedAgent(createdId);
        }
        const agentsRefreshed = await fetchAgents();
        if (agentsRefreshed === false) {
          throw new Error("Agent was created, but agents could not be refreshed.");
        }
        setSelectedAgentId(createdId);
        setMobileShowChat(true);
        setShowAgentLauncher(false);
        if (starterFileWarning) setError(starterFileWarning);
      } else {
        await fetchAgents();
      }
      return createdId;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
      return null;
    }
  }, [associateCreatedAgent, createOpenClawAgent, effectiveCreationDisabledReason, fetchAgents, getToken, setError, setMobileShowChat, setSelectedAgentId]);

  const createAgentAndCloseLauncher = React.useCallback(async (params: AgentCreationSetupCreateParams) => {
    const createdId = await (onCreateAgent ?? createAgentFromLauncher)(params);
    if (createdId) setShowAgentLauncher(false);
    return createdId;
  }, [createAgentFromLauncher, onCreateAgent]);

  const selectRosterAgent = React.useCallback((agentId: string) => {
    setShowAgentLauncher(false);
    setSelectedAgentId(agentId);
    setMobileShowChat(true);
  }, [setMobileShowChat, setSelectedAgentId]);

  if (!isDesktopViewport && !renderMobileNavigation) return null;

  const navigationVisible = isDesktopViewport || renderMobileNavigation;

  return (
    <motion.div
      className={`agents-roster-shell relative h-full flex-shrink-0 overflow-visible bg-surface-low transition-[width] duration-200 ease-out ${sidebarCollapsed ? "w-12" : "w-52"} ${mobileShowChat && !navigationVisible ? "hidden" : "flex"} flex-col`}
      aria-busy={rosterLoading}
    >
      {sidebarCollapsed && navigationVisible ? (
          <motion.div
            key="rail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="agents-roster-rail flex h-full w-12 flex-col overflow-visible bg-surface-low"
          >
            {!embeddedInNavigation ? (
              <div className="agents-roster-header flex h-14 shrink-0 items-center justify-center border-b border-border bg-background">
                <div className="flex h-8 w-8 items-center justify-center text-text-muted" aria-hidden="true">
                  <HyperCLILogoMark className="h-[17px] w-[17px]" />
                </div>
              </div>
            ) : null}
            <div className="agents-roster-scroll flex min-h-0 flex-1 flex-col items-center overflow-hidden bg-[var(--agent-roster-background)] py-3">
              <div className="agents-roster-rail-primary flex shrink-0 flex-col items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed(false)}
                    aria-label="Expand agents sidebar"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
                  >
                    <PanelRight className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Expand agents sidebar</TooltipContent>
              </Tooltip>
              </div>
              <div className="agents-roster-rail-home mt-2 flex shrink-0 flex-col items-center gap-2">
                <RosterNavigationItem
                  compact
                  label="Home"
                  href={homeHref}
                  active={homeActive}
                  onOpen={onOpenHome}
                  icon={House}
                />
                <RosterNavigationItem
                  compact
                  label="Knowledge Hub"
                  href={knowledgeHubHref}
                  active={knowledgeHubActive}
                  onOpen={onOpenKnowledgeHub}
                  icon={LibraryBig}
                />
              </div>
              <div aria-hidden="true" className="agents-roster-rail-divider my-2 h-px w-8 shrink-0 bg-border/70" />
              <div className="agents-roster-rail-agents min-h-0 w-full shrink overflow-y-auto py-1">
                <div className="flex w-full flex-col items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-testid="agent-launch-entry"
                    onClick={openAgentLauncher}
                    aria-label="Launch agent"
                    disabled={Boolean(effectiveCreationDisabledReason)}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.25)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)] transition-transform hover:scale-110 hover:border-[rgb(var(--selection-accent-rgb)_/_0.45)] hover:bg-[rgb(var(--selection-accent-rgb)_/_0.15)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Launch agent</TooltipContent>
              </Tooltip>
              {rosterLoading ? (
                <div role="status" aria-live="polite" className="flex h-8 w-8 items-center justify-center text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span className="sr-only">Loading Collection agents</span>
                </div>
              ) : (
                visibleAgents.map((a) => {
                  const agentName = agentDisplayLabel(a);
                  const av = agentAvatar(agentName, a.meta, agentProfileImageUrl(a));
                  const Icon = av.icon;
                  const selected = selectedAgentId === a.id;
                  return (
                    <Tooltip key={a.id}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => {
                            selectRosterAgent(a.id);
                            if (!renderMobileNavigation) setSidebarCollapsed(false);
                          }}
                          data-roster-id={a.id}
                          aria-label={`Select ${agentName}`}
                          className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110 ${selected ? "ring-2 ring-[var(--selection-accent)]" : ""}`}
                          style={{ backgroundColor: av.bgColor }}
                        >
                          {av.imageUrl ? (
                            <ResourceImage
                              src={av.imageUrl}
                              alt={`${agentName} avatar`}
                              fill
                              sizes="32px"
                              className="rounded-full object-cover"
                            />
                          ) : (
                            <Icon className="h-4 w-4" style={{ color: av.fgColor }} />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" align="start" className="border-0 bg-transparent p-0 shadow-none">
                        <AgentCardTooltip agentName={agentName} agent={mergedAgentCardDataById[a.id]} />
                      </TooltipContent>
                    </Tooltip>
                  );
                })
              )}
                </div>
              </div>
              <div aria-hidden="true" className="agents-roster-rail-divider my-2 h-px w-8 shrink-0 bg-border/70" />
              <div className="agents-roster-rail-administration flex shrink-0 flex-col items-center gap-2">
                <RosterNavigationItem
                  compact
                  label="Members"
                  href={membersHref}
                  active={membersActive}
                  onOpen={onOpenMembers}
                  icon={UsersRound}
                />
                <RosterNavigationItem
                  compact
                  label="Usage"
                  href={usageHref}
                  active={usageActive}
                  onOpen={onOpenUsage}
                  icon={BarChart3}
                />
              </div>
            </div>
            <AgentsSidebarDashboardLinks
              compact
              accountInitial={accountInitial}
              accountAvatarUrl={accountAvatarUrl}
              accountName={accountName}
              accountEmail={accountEmail}
              onLogin={onLogin}
              onOpenSettings={onOpenAccountSettings}
              settingsActive={accountSettingsActive}
              onLogout={onLogout}
            />
          </motion.div>
        ) : (
          <motion.div
            key="full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            <AgentsChannelsSidebar
              variant="v3"
              showDivider={false}
              fillParent
              embeddedInNavigation={embeddedInNavigation}
              mobileMode={renderMobileNavigation}
              threads={visibleSyntheticThreads}
              selectedThreadId={selectedAgentId}
              showChannels={showChannels}
              availableAgents={orderedAgents.map((a) => ({
                id: a.id,
                name: agentDisplayLabel(a),
                type: "agent" as const,
                meta: a.meta ?? null,
                avatarUrl: agentProfileImageUrl(a),
              }))}
              offlineAgentCount={offlineAgentIds.size}
              showOfflineAgents={showOfflineAgents}
              onShowOfflineAgentsChange={setShowOfflineAgents}
              onReorderAgents={setVisibleAgentOrder}
              agentCardDataById={mergedAgentCardDataById}
              onSelectThread={(threadId) => {
                selectRosterAgent(threadId);
              }}
              onStartAgentChat={(agent) => {
                selectRosterAgent(agent.id);
              }}
              onCreateAgent={createAgentAndCloseLauncher}
              onOpenAgentLauncher={openAgentLauncher}
              agentCreationDisabledReason={agentCreationDisabledReason}
              rosterLoading={rosterLoading}
              onOpenAccountSettings={onOpenAccountSettings}
              accountSettingsActive={accountSettingsActive}
              onOpenHome={onOpenHome}
              homeActive={homeActive}
              homeHref={homeHref}
              onOpenKnowledgeHub={onOpenKnowledgeHub}
              knowledgeHubActive={knowledgeHubActive}
              knowledgeHubHref={knowledgeHubHref}
              onOpenMembers={onOpenMembers}
              membersActive={membersActive}
              membersHref={membersHref}
              onOpenUsage={onOpenUsage}
              usageActive={usageActive}
              usageHref={usageHref}
              accountInitial={accountInitial}
              accountAvatarUrl={accountAvatarUrl}
              accountName={accountName}
              accountEmail={accountEmail}
              onLogin={onLogin}
              onLogout={onLogout}
              onDeleteThread={(threadId) => {
                const a = agents.find((x) => x.id === threadId);
                if (a) setPendingAgentDelete({ id: a.id, name: agentDisplayLabel(a) });
              }}
              onCollapse={navigationVisible ? () => setSidebarCollapsed(true) : undefined}
            />
          </motion.div>
        )}
      {typeof document !== "undefined" ? createPortal(
        <AnimatePresence>
          {showAgentLauncher && (
            <motion.div
              data-testid="agent-launcher-overlay"
              aria-hidden={agentLauncherSuspended || undefined}
              className={`fixed inset-0 z-[80] flex items-center justify-center bg-background/70 p-2 backdrop-blur-sm ${agentLauncherSuspended ? "invisible pointer-events-none" : ""}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              <motion.div
                data-testid="agent-launcher-dialog"
                initial={{ opacity: 0, scale: 0.98, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 8 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="relative h-[min(712px,calc(100dvh-1rem))] w-[calc(100vw-1rem)] max-w-[1200px] sm:h-[min(852px,calc(100dvh-1rem))] sm:max-w-[1200px]"
              >
                <AgentCreationSetupWizard
                  size="inline"
                  onClose={() => setShowAgentLauncher(false)}
                  initialPlanId={preferredPlanId}
                  budget={budget}
                  subscriptionSummary={subscriptionSummary}
                  catalogPlans={catalogPlans}
                  pendingSlotReleases={pendingSlotReleases}
                  onOpenPlanCatalog={onOpenPlanCatalog}
                  onCreateAgent={createAgentAndCloseLauncher}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      ) : null}
    </motion.div>
  );
}

export { AgentList as AgentSidebarPane };

type AgentEmptyStateProps = {
  onCreate: () => void;
  onCreateAgent?: (params: AgentCreationSetupCreateParams) => Promise<string | null>;
  budget?: {
    slots: Record<string, { granted: number; used: number; available: number }>;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: import("@hypercli.com/sdk/agent").HyperAgentSubscriptionSummary | null;
  catalogPlans?: HyperAgentPlan[] | null;
  onOpenPlanCatalog?: (planId?: string) => void | Promise<void>;
  preferredPlanId?: string | null;
  pendingSlotReleases?: Record<string, number>;
  workspaceName?: string | null;
  hasAccountAgents?: boolean;
  creationDisabledReason?: string | null;
  onCreateWorkspace?: () => void;
  onOpenMembers?: () => void;
};

type AgentLaunchActionProps = {
  launchLabel?: string;
  launchingLabel?: string;
  launching?: boolean;
  launchBlocked?: boolean;
  launchBlockedReason?: string | null;
  onLaunchAction?: () => void;
};

export function LaunchFirstAgentEmptyState({
  onCreate,
  workspaceName,
  hasAccountAgents = false,
  creationDisabledReason,
  onCreateWorkspace,
  onOpenMembers,
}: AgentEmptyStateProps) {
  const workspaceScoped = Boolean(workspaceName);
  const workspaceSetupRequired = !workspaceScoped && Boolean(onCreateWorkspace);
  const firstAgentOnboarding = !hasAccountAgents;

  return (
    <div data-slot="first-agent-empty-state" className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-8">
        <div className="flex w-full max-w-[600px] flex-col items-center text-center">
        {firstAgentOnboarding ? (
          <div className="mb-6 inline-flex h-5 items-center gap-1.5 rounded-full border border-foreground px-2.5 text-[11px] font-semibold leading-none text-foreground">
            <Sparkles className="h-3 w-3" />
            <span>{"Let's get started"}</span>
          </div>
        ) : null}

        <h1 className={`font-semibold leading-none tracking-normal text-foreground ${
          firstAgentOnboarding
            ? "whitespace-nowrap text-[clamp(1.75rem,7vw,3.625rem)]"
            : "text-[40px] sm:text-[52px]"
        }`}>
          {firstAgentOnboarding ? "Launch your first agent" : `Welcome to ${workspaceName}`}
        </h1>
        <p className="mt-6 text-[16px] font-medium leading-6 text-text-muted">
          {workspaceScoped && hasAccountAgents
            ? "Launch a new agent for this Collection or add an existing agent from Members."
            : "Agents handle projects, tasks, and workflows on your behalf."}
        </p>

        <TooltipHint
          label={workspaceSetupRequired ? "Create your first Collection" : creationDisabledReason ?? (workspaceScoped ? "Launch an agent" : "Create an agent")}
          disabled={!workspaceSetupRequired && Boolean(creationDisabledReason)}
          triggerClassName="w-full"
        >
          <motion.button
            type="button"
            data-testid="agent-launch-entry"
            onClick={() => {
              if (workspaceSetupRequired && onCreateWorkspace) {
                onCreateWorkspace();
                return;
              }
              onCreate();
            }}
            disabled={!workspaceSetupRequired && Boolean(creationDisabledReason)}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.99 }}
            className="mt-9 flex min-h-[86px] w-full items-center gap-4 rounded-[8px] border border-foreground bg-surface-low px-6 py-4 text-left transition-colors hover:bg-surface-mid disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--button-primary-rgb)_/_0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-border bg-surface-mid text-foreground">
              {workspaceSetupRequired ? <Blocks className="h-4 w-4" /> : <Codepen className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold leading-5 text-foreground">
                {workspaceSetupRequired ? "Create your first Collection" : workspaceScoped ? "Launch an agent" : "Create an agent"}
              </span>
              <span className="mt-0.5 block text-[12px] font-medium leading-4 text-text-muted">
                {workspaceSetupRequired
                  ? "Set up a home for your agents, shared knowledge, and team."
                  : "Name it, pick a plan, and connect it to where your team already works."}
              </span>
            </span>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--button-primary)] text-[var(--button-primary-foreground)]">
              <ArrowRight className="h-4 w-4" />
            </span>
          </motion.button>
        </TooltipHint>
        {workspaceSetupRequired ? (
          <p className="mt-3 text-sm text-text-muted">One quick step, then you can launch your first agent.</p>
        ) : creationDisabledReason ? (
          <p className="mt-3 text-sm text-text-muted">{creationDisabledReason}</p>
        ) : null}
        {workspaceScoped && hasAccountAgents && onOpenMembers ? (
          <button
            type="button"
            onClick={onOpenMembers}
            className="mt-4 text-sm font-semibold text-[var(--selection-accent)] transition-colors hover:text-foreground"
          >
            Add an existing agent in Members
          </button>
        ) : null}
        </div>
      </div>
      {workspaceScoped ? (
        <div className="w-full shrink-0 px-3 pb-[max(0.625rem,env(safe-area-inset-bottom,0.625rem))] pt-2 md:p-3">
          <div className="mx-auto flex w-full max-w-5xl min-w-0">
            <AgentChatComposerShell
              aria-label="Message agent"
              placeholder="Launch an agent to start chatting..."
              disabled
              inputClassName="pr-14 disabled:cursor-not-allowed disabled:opacity-100"
            >
              <div className="absolute right-2 top-[calc(50%-3px)] -translate-y-1/2">
                <button
                  type="button"
                  aria-label="Send message"
                  disabled
                  className="btn-primary flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </AgentChatComposerShell>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AgentEmptyState({
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
  catalogPlans,
  onOpenPlanCatalog,
  preferredPlanId,
  pendingSlotReleases,
  launchLabel,
  launchingLabel,
  launching,
  launchBlocked,
  launchBlockedReason,
  onLaunchAction,
}: AgentEmptyStateProps & AgentLaunchActionProps) {
  const [showWizard, setShowWizard] = React.useState(false);

  if (showWizard) {
    return (
      <AgentCreationSetupWizard
        initialPlanId={preferredPlanId}
        budget={budget}
        subscriptionSummary={subscriptionSummary}
        catalogPlans={catalogPlans}
        pendingSlotReleases={pendingSlotReleases}
        onOpenPlanCatalog={onOpenPlanCatalog}
        onClose={() => setShowWizard(false)}
        onCreateAgent={onCreateAgent ?? (async () => {
          onCreate();
          return null;
        })}
      />
    );
  }

  const examples = [
    "Ask questions across Slack, email, docs, and CRM data in one project",
    "Get instant answers with company-specific context instead of generic AI responses",
    "Trigger actions like drafting replies, updating records, or creating follow-ups directly from chat",
  ];

  return (
    <LaunchAgentCenteredEmptyStateContent
      icon={MessageSquare}
      title="Your business, one chat"
      description="Talk to your entire business like it is one system. Your agent understands your context, remembers your workflows, and takes action across your stack."
      examples={examples}
      cardMinHeightClass="md:min-h-[118px]"
      launchLabel={launchLabel}
      launchingLabel={launchingLabel}
      launching={launching}
      launchBlocked={launchBlocked}
      launchBlockedReason={launchBlockedReason}
      onLaunch={onLaunchAction ?? (() => setShowWizard(true))}
    />
  );
}

export function AgentFilesEmptyState({
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
  catalogPlans,
  onOpenPlanCatalog,
  pendingSlotReleases,
  launchLabel,
  launchingLabel,
  launching,
  launchBlocked,
  launchBlockedReason,
  onLaunchAction,
}: AgentEmptyStateProps & AgentLaunchActionProps) {
  const [showWizard, setShowWizard] = React.useState(false);

  if (showWizard) {
    return (
      <AgentCreationSetupWizard
        budget={budget}
        subscriptionSummary={subscriptionSummary}
        catalogPlans={catalogPlans}
        pendingSlotReleases={pendingSlotReleases}
        onOpenPlanCatalog={onOpenPlanCatalog}
        onClose={() => setShowWizard(false)}
        onCreateAgent={onCreateAgent ?? (async () => {
          onCreate();
          return null;
        })}
      />
    );
  }

  return (
    <LaunchAgentCenteredEmptyStateContent
      icon={FolderOpen}
      title="Your files, working for you"
      description="Your documents become usable intelligence. Your agent can search, understand, compare, summarize, and execute against your files instead of treating them like static uploads."
      examples={[
        "Search thousands of files using natural language instead of folder structures",
        "Compare contracts, proposals, reports, or spreadsheets in seconds",
        "Extract insights, summaries, action items, and data from PDFs, docs, and presentations automatically",
      ]}
      launchLabel={launchLabel}
      launchingLabel={launchingLabel}
      launching={launching}
      launchBlocked={launchBlocked}
      launchBlockedReason={launchBlockedReason}
      onLaunch={onLaunchAction ?? (() => setShowWizard(true))}
    />
  );
}

function LaunchAgentCenteredEmptyStateContent({
  icon: Icon,
  title,
  description,
  examples,
  onLaunch,
  launchLabel = "Launch agent",
  launchingLabel = "Starting agent",
  launching = false,
  launchBlocked = false,
  launchBlockedReason,
  cardMinHeightClass = "md:min-h-[102px]",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  examples: string[];
  onLaunch: () => void;
  launchLabel?: string;
  launchingLabel?: string;
  launching?: boolean;
  launchBlocked?: boolean;
  launchBlockedReason?: string | null;
  cardMinHeightClass?: "md:min-h-[102px]" | "md:min-h-[118px]";
}) {
  const launchButtonLabel = launching ? launchingLabel : launchLabel;
  const launchDisabled = launching || launchBlocked;

  return (
    <AgentFeatureEmptyState
      icon={Icon}
      title={title}
      description={description}
      examples={examples}
      actionLabel={launchButtonLabel}
      actionPending={launching}
      actionDisabled={launchDisabled}
      actionDisabledReason={launchBlockedReason}
      onAction={onLaunch}
      cardMinHeightClass={cardMinHeightClass}
      testId="agent-launch-empty-state"
    />
  );
}

export function AgentIntegrationsEmptyState({
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
  catalogPlans,
  onOpenPlanCatalog,
  pendingSlotReleases,
  launchLabel,
  launchingLabel,
  launching,
  launchBlocked,
  launchBlockedReason,
  onLaunchAction,
}: AgentEmptyStateProps & AgentLaunchActionProps) {
  const [showWizard, setShowWizard] = React.useState(false);

  if (showWizard) {
    return (
      <AgentCreationSetupWizard
        budget={budget}
        subscriptionSummary={subscriptionSummary}
        catalogPlans={catalogPlans}
        pendingSlotReleases={pendingSlotReleases}
        onOpenPlanCatalog={onOpenPlanCatalog}
        onClose={() => setShowWizard(false)}
        onCreateAgent={onCreateAgent ?? (async () => {
          onCreate();
          return null;
        })}
      />
    );
  }

  return (
    <LaunchAgentCenteredEmptyStateContent
      icon={Blocks}
      title="Your stack, unified"
      description="Connect the tools you already use. Unlike standalone LLMs, your agent works inside your real workflows - pulling from CRMs, Slack, email, databases, and internal systems in real time."
      examples={[
        "Pull live data from tools like HubSpot, Salesforce, Gmail, Slack, Notion, or databases",
        "Update records, create tickets, send emails, and sync workflows without switching apps",
        "Build cross-platform automations that work across your existing stack",
      ]}
      launchLabel={launchLabel}
      launchingLabel={launchingLabel}
      launching={launching}
      launchBlocked={launchBlocked}
      launchBlockedReason={launchBlockedReason}
      onLaunch={onLaunchAction ?? (() => setShowWizard(true))}
    />
  );
}

export function AgentSkillsEmptyState({
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
  catalogPlans,
  onOpenPlanCatalog,
  pendingSlotReleases,
  launchLabel,
  launchingLabel,
  launching,
  launchBlocked,
  launchBlockedReason,
  onLaunchAction,
}: AgentEmptyStateProps & AgentLaunchActionProps) {
  const [showWizard, setShowWizard] = React.useState(false);

  if (showWizard) {
    return (
      <AgentCreationSetupWizard
        budget={budget}
        subscriptionSummary={subscriptionSummary}
        catalogPlans={catalogPlans}
        pendingSlotReleases={pendingSlotReleases}
        onOpenPlanCatalog={onOpenPlanCatalog}
        onClose={() => setShowWizard(false)}
        onCreateAgent={onCreateAgent ?? (async () => {
          onCreate();
          return null;
        })}
      />
    );
  }

  return (
    <LaunchAgentCenteredEmptyStateContent
      icon={Codepen}
      title="Your expertise, reusable"
      description="Turn repeatable work into reusable intelligence. Skills let your team package expertise, workflows, and automations so anyone can execute high-level tasks instantly."
      examples={[
        "Save repeatable workflows as reusable AI-powered playbooks",
        "Let anyone on your team execute expert-level tasks with one command",
        "Standardize onboarding, reporting, sales research, QA, support, and operations workflows",
      ]}
      launchLabel={launchLabel}
      launchingLabel={launchingLabel}
      launching={launching}
      launchBlocked={launchBlocked}
      launchBlockedReason={launchBlockedReason}
      onLaunch={onLaunchAction ?? (() => setShowWizard(true))}
    />
  );
}

export function AgentScheduledEmptyState({
  onCreate,
  launchLabel,
  launchingLabel,
  launching,
  launchBlocked,
  launchBlockedReason,
  onLaunchAction,
}: AgentEmptyStateProps & AgentLaunchActionProps) {
  return (
    <LaunchAgentCenteredEmptyStateContent
      icon={CalendarClock}
      title="Work that keeps moving"
      description="Schedule recurring jobs and one-off tasks so your agent can keep projects moving without waiting for the next prompt."
      examples={[
        "Run recurring research, reporting, and follow-up work on a dependable schedule",
        "Send each task to the right conversation with the context it needs",
        "Review upcoming runs and adjust schedules as priorities change",
      ]}
      launchLabel={launchLabel}
      launchingLabel={launchingLabel}
      launching={launching}
      launchBlocked={launchBlocked}
      launchBlockedReason={launchBlockedReason}
      onLaunch={onLaunchAction ?? onCreate}
    />
  );
}

export function AgentDesktopEmptyState({
  onCreate,
  desktopEnabled,
  settingsHref,
  launchLabel,
  launchingLabel,
  launching,
  launchBlocked,
  launchBlockedReason,
  onLaunchAction,
}: AgentEmptyStateProps & AgentLaunchActionProps & {
  desktopEnabled?: boolean;
  settingsHref?: string;
}) {
  const settingsRequired = desktopEnabled === false && Boolean(settingsHref);
  const actionLabel = settingsRequired
    ? "Enable in settings"
    : launching
      ? desktopEnabled === true ? "Opening desktop" : "Starting agent"
      : launchLabel ?? (desktopEnabled === true ? "Launch desktop" : "Launch agent");

  return (
    <AgentFeatureEmptyState
      icon={Monitor}
      title="Your agent's desktop"
      description="The tools your team lives in don't all have APIs. With desktop and browser access, your agent works inside them anyway, filling forms, pulling reports, and clicking through the same interfaces your people do."
      examples={[
        "Connect to any web-based tool, even legacy or partner systems with no API",
        "Automate multi-step browser workflows from start to finish",
        "See visual state, validate UI, and act on what appears on screen",
      ]}
      actionLabel={actionLabel}
      actionHref={settingsRequired ? settingsHref : undefined}
      actionPending={!settingsRequired && launching}
      actionDisabled={!settingsRequired && launchBlocked}
      actionDisabledReason={launchBlockedReason}
      onAction={onLaunchAction ?? onCreate}
      testId="agent-desktop-empty-state"
    />
  );
}

function LaunchAgentEmptyStateContent({
  icon: Icon,
  title,
  description,
  examples,
  onLaunch,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  examples: string[];
  onLaunch: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background px-5 py-8">
      <div className="w-full max-w-[610px] text-left">
        <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-[7px] border border-border bg-surface-low text-foreground">
          <Icon className="h-4 w-4" />
        </div>

        <h1 className="text-[18px] font-semibold leading-tight text-foreground sm:text-[20px]">
          {title}
        </h1>
        <p className="mt-4 max-w-[600px] text-[14px] leading-6 text-text-muted">
          {description}
        </p>

        <div className="mt-8 space-y-2">
          {examples.map((example) => (
            <div
              key={example}
              className="rounded-[9px] border border-foreground bg-background px-3 py-3 text-[13px] font-semibold leading-5 text-foreground"
            >
              {example}
            </div>
          ))}
        </div>

        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          data-testid="agent-launch-entry"
          onClick={onLaunch}
          className="mt-8 inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--button-primary)] px-3.5 text-[13px] font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--button-primary-rgb)_/_0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Launch agent
          <ArrowRight className="h-4 w-4" />
        </motion.button>
      </div>
    </div>
  );
}
