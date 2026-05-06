"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Blocks, CalendarClock, Codepen, FolderOpen, Loader2, MessageSquare, PanelLeftOpen, Play, SlidersHorizontal, Square, X } from "lucide-react";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";

import type { Agent, JsonObject } from "@/app/dashboard/agents/types";
import { asObject, getOpenClawUiHint, humanizeKey } from "@/lib/openclaw-config";
import { Tooltip, TooltipContent, TooltipTrigger } from "@hypercli/shared-ui";
import { AgentCardTooltip, type AgentCardTooltipData } from "@/components/dashboard/modules/AgentCardModule";
import { AgentsChannelsSidebar, AgentsSidebarDashboardLinks, type ConversationThread } from "@/components/dashboard/AgentsChannelsSidebar";
import { FilePreview } from "@/components/dashboard/files/FilePreview";
import type { FileEntry } from "@/components/dashboard/files/types";
import { agentAvatar } from "@/lib/avatar";
import type { WorkspaceFile } from "@/lib/openclaw-chat";
import type { ActivityEntry } from "@/lib/openclaw-session";
import { OpenClawErrorBoundary } from "./page-helpers";
import { FirstAgentSetupWizard } from "./FirstAgentSetupWizard";

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
        <SlidersHorizontal className="h-4 w-4 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">OpenClaw Config</p>
          <p className="text-[10px] text-text-muted">Editing openclaw.json</p>
        </div>
        <div className="flex-1" />
        {saving && <p className="text-[10px] text-text-muted">Saving openclaw.json</p>}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
            title="Close OpenClaw config"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {(effectiveError || effectiveSuccess) && (
        <div className="flex-shrink-0 space-y-2 border-b border-border px-4 py-3">
          {effectiveError && (
            <div className="rounded-lg border border-[#d05f5f]/30 bg-[#d05f5f]/10 px-3 py-2 text-sm text-[#d05f5f]">{effectiveError}</div>
          )}
          {effectiveSuccess && !effectiveError && (
            <div className="rounded-lg border border-[#38D39F]/30 bg-[#38D39F]/10 px-3 py-2 text-sm text-[#38D39F]">{effectiveSuccess}</div>
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
          readOnlyDescription="Reconnect the gateway before editing openclaw.json."
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
          <button
            key={`openclaw-section-${sectionKey}`}
            type="button"
            onClick={() => {
              setActiveOpenclawSection(sectionKey);
              setMobileSectionsOpen(false);
            }}
            className={`block w-full rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
              selected
                ? "border-l-2 border-primary bg-primary/15 font-medium text-foreground"
                : "text-text-muted hover:bg-surface-low/50 hover:text-foreground"
            }`}
            title={sectionDescription}
          >
            <span className="block truncate">{sectionLabel}</span>
          </button>
        );
      })}
    </div>
  );

  const statusMessages = (
    <>
      {openclawError && (
        <div className="rounded-lg border border-[#d05f5f]/30 bg-[#d05f5f]/10 px-3 py-2 text-sm text-[#d05f5f]">
          {openclawError}
        </div>
      )}
      {openclawSuccess && !openclawError && (
        <div className="rounded-lg border border-[#38D39F]/30 bg-[#38D39F]/10 px-3 py-2 text-sm text-[#38D39F]">
          {openclawSuccess}
        </div>
      )}
      {!chat.connected && !chat.connecting && (
        <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
          Connect the agent gateway to edit OpenClaw settings.
        </div>
      )}
      {chat.connecting && !chat.connected && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Connecting to gateway...
        </div>
      )}
      {chat.connected && !hasSections && (
        <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
          No config schema available from gateway.
        </div>
      )}
    </>
  );

  const editorContent = (
    <OpenClawErrorBoundary>
      <div className={isDesktopViewport ? "mx-auto max-w-5xl space-y-4" : "mx-auto max-w-xl space-y-4"}>
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
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {openclawSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
            {saveLabel}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
              title="Close OpenClaw settings"
            >
              <X className="h-4 w-4" />
            </button>
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
          <SlidersHorizontal className="h-4 w-4 text-primary" />
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

export function OpenClawSettingsDrawer({
  open,
  onClose,
  isDesktopViewport = true,
  ...panelProps
}: OpenClawConfigPanelProps & { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.button
            type="button"
            aria-label="Close OpenClaw settings"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
            className="relative z-10 h-full w-full max-w-[920px] border-l border-border bg-background shadow-2xl sm:w-[min(920px,calc(100vw-3rem))]"
          >
            <OpenClawSettingsPanel
              {...panelProps}
              open
              onClose={onClose}
              isDesktopViewport={isDesktopViewport}
            />
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

interface AgentSettingsPanelProps {
  agent: Agent | null;
  settingsName: string;
  setSettingsName: (value: string) => void;
  savingName: boolean;
  handleSaveName: () => void;
  chat: SessionLike;
  onStartAgent?: () => void;
  onStopAgent?: () => void;
  agentStarting?: boolean;
  agentStopping?: boolean;
  agentStartBlocked?: boolean;
  agentStartBlockedReason?: string | null;
  openclawConfig?: React.ReactNode;
}

interface AgentSettingsRowProps {
  id: string;
  label: string;
  description: string;
  children: React.ReactNode;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readDefaultModel(config: Record<string, unknown> | null): string {
  const root = asRecord(config);
  const llm = asRecord(root?.llm);
  const models = asRecord(root?.models);
  return readString(llm?.model) ?? readString(models?.default) ?? "";
}

function buildDefaultModelPatch(config: Record<string, unknown> | null, model: string): Record<string, unknown> {
  const root = asRecord(config);
  const llm = asRecord(root?.llm);
  const models = asRecord(root?.models);

  if (models && typeof models.default === "string" && !llm) {
    return { models: { ...models, default: model } };
  }

  return { llm: { ...(llm ?? {}), model } };
}

function addModelOption(options: Map<string, string>, id: unknown, label?: unknown) {
  const value = readString(id);
  if (!value || options.has(value)) return;
  options.set(value, readString(label) ?? value);
}

function collectModelOptions(
  config: Record<string, unknown> | null,
  models: unknown[],
  currentDefaultModel: string,
): Array<{ value: string; label: string }> {
  const options = new Map<string, string>();
  addModelOption(options, currentDefaultModel);

  for (const model of models) {
    if (typeof model === "string") {
      addModelOption(options, model);
      continue;
    }
    const entry = asRecord(model);
    addModelOption(options, entry?.id ?? entry?.model ?? entry?.name, entry?.name ?? entry?.label);
  }

  const configuredProviders = asRecord(asRecord(asRecord(config)?.models)?.providers);
  for (const provider of Object.values(configuredProviders ?? {})) {
    const providerModels = asRecord(provider)?.models;
    if (!Array.isArray(providerModels)) continue;
    for (const model of providerModels) {
      if (typeof model === "string") {
        addModelOption(options, model);
        continue;
      }
      const entry = asRecord(model);
      addModelOption(options, entry?.id ?? entry?.model ?? entry?.name, entry?.name ?? entry?.label);
    }
  }

  return Array.from(options.entries()).map(([value, label]) => ({ value, label }));
}

function readAgentUiPreference(agent: Agent | null, key: string, fallback: string): string {
  const ui = asRecord(agent?.meta?.ui);
  return readString(ui?.[key]) ?? fallback;
}

function AgentSettingsRow({ id, label, description, children }: AgentSettingsRowProps) {
  return (
    <div className="flex min-h-[52px] flex-col gap-3 rounded-lg border border-border bg-surface-low/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-semibold leading-5 text-foreground">
          {label}
        </label>
        <p className="mt-0.5 text-[11px] leading-4 text-text-muted">{description}</p>
      </div>
      <div className="w-full shrink-0 sm:w-[180px]">{children}</div>
    </div>
  );
}

export function AgentSettingsPanel(props: AgentSettingsPanelProps) {
  const {
    agent,
    settingsName,
    setSettingsName,
    savingName,
    handleSaveName,
    chat,
    onStartAgent,
    onStopAgent,
    agentStarting = false,
    agentStopping = false,
    agentStartBlocked = false,
    agentStartBlockedReason = null,
    openclawConfig,
  } = props;
  const currentDefaultModel = React.useMemo(() => readDefaultModel(chat.config), [chat.config]);
  const modelOptions = React.useMemo(
    () => collectModelOptions(chat.config, chat.models, currentDefaultModel),
    [chat.config, chat.models, currentDefaultModel],
  );
  const [defaultModelDraft, setDefaultModelDraft] = React.useState("");
  const [savedDefaultModel, setSavedDefaultModel] = React.useState("");
  const [archiveDraft, setArchiveDraft] = React.useState("enabled");
  const [savedPreferences, setSavedPreferences] = React.useState<Record<string, { archive: string }>>({});
  const [savingSettings, setSavingSettings] = React.useState(false);
  const [settingsError, setSettingsError] = React.useState<string | null>(null);

  const agentId = agent?.id ?? null;
  const agentPreferences = agentId ? savedPreferences[agentId] : undefined;
  const currentVisibility = readAgentUiPreference(agent, "visibility", "just_me");
  const currentArchive = agentPreferences?.archive ?? readAgentUiPreference(agent, "autoArchiveIdleConversations", "enabled");
  const effectiveCurrentModel = savedDefaultModel || currentDefaultModel;
  const canEditName = agent?.state === "STOPPED";
  const trimmedName = settingsName.trim();
  const nameChanged = Boolean(agent && canEditName && trimmedName && trimmedName !== (agent.name || ""));
  const modelChanged = Boolean(defaultModelDraft && defaultModelDraft !== effectiveCurrentModel);
  const preferencesChanged = Boolean(agent && archiveDraft !== currentArchive);
  const canSaveModel = chat.connected && modelChanged;
  const hasChanges = nameChanged || canSaveModel || preferencesChanged;
  const saving = savingSettings || savingName;
  const canStartAgent = agent?.state === "STOPPED" || agent?.state === "FAILED";
  const canStopAgent = agent?.state === "RUNNING";
  const lifecycleBusy = agentStarting || agentStopping || agent?.state === "PENDING" || agent?.state === "STARTING" || agent?.state === "STOPPING";
  const lifecycleDescription = canStopAgent
    ? "Pause compute and disconnect the gateway"
    : canStartAgent
      ? (agentStartBlockedReason ?? "Start compute and reconnect the gateway")
      : agent?.state === "PENDING" || agent?.state === "STARTING"
        ? "Agent is starting"
        : agent?.state === "STOPPING"
          ? "Agent is stopping"
          : "Lifecycle controls are unavailable";

  const resetDraft = React.useCallback(() => {
    if (!agentId) return;
    const nextDefaultModel = currentDefaultModel || modelOptions[0]?.value || "";
    setDefaultModelDraft(nextDefaultModel);
    setSavedDefaultModel(currentDefaultModel);
    setArchiveDraft(currentArchive);
    setSettingsName(agent?.name || "");
    setSettingsError(null);
  }, [agent?.name, agentId, currentDefaultModel, currentArchive, modelOptions, setSettingsName]);

  React.useEffect(() => {
    resetDraft();
  }, [resetDraft]);

  const saveSettings = async () => {
    if (!agent || saving) return;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      if (nameChanged) {
        await handleSaveName();
      }
      if (canSaveModel) {
        await chat.saveConfig(buildDefaultModelPatch(chat.config, defaultModelDraft));
        setSavedDefaultModel(defaultModelDraft);
      }
      if (preferencesChanged) {
        setSavedPreferences((prev) => ({
          ...prev,
          [agent.id]: { archive: archiveDraft },
        }));
      }
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  if (!agent) return null;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[720px] px-4 py-5 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
        >
          <h2 className="mb-4 text-sm font-semibold text-foreground">Settings</h2>

          <div className="space-y-2">
            <AgentSettingsRow
              id="agent-lifecycle"
              label="Agent runtime"
              description={lifecycleDescription}
            >
              {canStopAgent ? (
                <button
                  id="agent-lifecycle"
                  type="button"
                  aria-label="Stop agent"
                  onClick={onStopAgent}
                  disabled={!onStopAgent || lifecycleBusy}
                  className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-[#d05f5f]/40 bg-[#d05f5f]/10 px-3 text-xs font-semibold text-[#d05f5f] transition-colors hover:bg-[#d05f5f]/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {agentStopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                  {agentStopping ? "Stopping..." : "Stop agent"}
                </button>
              ) : (
                <button
                  id="agent-lifecycle"
                  type="button"
                  aria-label="Start agent"
                  onClick={onStartAgent}
                  disabled={!canStartAgent || !onStartAgent || lifecycleBusy || agentStartBlocked}
                  title={agentStartBlockedReason ?? undefined}
                  className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-[#38D39F]/40 bg-[#38D39F]/10 px-3 text-xs font-semibold text-[#38D39F] transition-colors hover:bg-[#38D39F]/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {agentStarting || agent?.state === "PENDING" || agent?.state === "STARTING" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {agentStarting || agent?.state === "PENDING" || agent?.state === "STARTING" ? "Starting..." : "Start agent"}
                </button>
              )}
            </AgentSettingsRow>

            <AgentSettingsRow
              id="agent-name"
              label="Agent name"
              description={canEditName ? "Shown in the sidebar and breadcrumbs" : "Stop the agent to change its name"}
            >
              <input
                id="agent-name"
                value={settingsName}
                onChange={(event) => setSettingsName(event.target.value)}
                disabled={!canEditName || saving}
                placeholder="Agent name"
                className="h-8 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground transition-colors placeholder:text-text-muted focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            </AgentSettingsRow>

            <AgentSettingsRow
              id="default-model"
              label="Default model"
              description={chat.connected ? "Used when no override is set" : "Connect the agent gateway to edit"}
            >
              <select
                id="default-model"
                value={defaultModelDraft}
                onChange={(event) => setDefaultModelDraft(event.target.value)}
                disabled={!chat.connected || saving || modelOptions.length === 0}
                className="h-8 w-full rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {modelOptions.length === 0 ? (
                  <option value="">{chat.connecting ? "Loading models" : "No model loaded"}</option>
                ) : (
                  modelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                )}
              </select>
            </AgentSettingsRow>

            <AgentSettingsRow id="agent-visibility" label="Visibility" description="Visibility controls are currently disabled">
              <select
                id="agent-visibility"
                value={currentVisibility}
                disabled
                className="h-8 w-full rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="just_me">Just me</option>
                <option value="team">Team</option>
                <option value="organization">Organization</option>
              </select>
            </AgentSettingsRow>

            <AgentSettingsRow
              id="auto-archive"
              label="Auto-archive idle conversations"
              description="After 30 days"
            >
              <select
                id="auto-archive"
                value={archiveDraft}
                onChange={(event) => setArchiveDraft(event.target.value)}
                disabled={saving}
                className="h-8 w-full rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </AgentSettingsRow>
          </div>

          {settingsError && (
            <div className="mt-3 rounded-lg border border-[#d05f5f]/30 bg-[#d05f5f]/10 px-3 py-2 text-xs text-[#d05f5f]">
              {settingsError}
            </div>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={resetDraft}
              disabled={!hasChanges || saving}
              className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-low disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { void saveSettings(); }}
              disabled={!hasChanges || saving}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>

          {openclawConfig && (
            <section className="mt-6">
              <h3 className="mb-3 text-sm font-semibold text-foreground">OpenClaw settings</h3>
              <div className="h-[560px] min-h-[420px] overflow-hidden">
                {openclawConfig}
              </div>
            </section>
          )}
        </motion.div>
      </div>
    </div>
  );
}


export function ErrorBanner({ error, onDismiss }: { error: string | null; onDismiss: () => void }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          <div className="mx-4 sm:mx-6 lg:mx-8 mt-3 p-3 rounded-lg bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-sm text-[#d05f5f] flex items-center justify-between">
            <span>{error}</span>
            <button onClick={onDismiss} className="ml-2 hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
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
  mobileShowChat: boolean;
  agents: Agent[];
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string) => void;
  setMobileShowChat: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  syntheticThreads: ConversationThread[];
  agentCardDataById?: Record<string, AgentCardTooltipData>;
  getToken: () => Promise<string>;
  createOpenClawAgent: (apiKey: string, options?: Record<string, unknown>) => Promise<{ id?: string | null }>;
  fetchAgents: () => Promise<void>;
  setError: (value: string | null) => void;
  openCreateDialog: () => void;
  sidebarCreatorSignal: number;
  setPendingAgentDelete: (value: { id: string; name: string } | null) => void;
  updateAgentName: (agentId: string, name: string) => Promise<void>;
  accountInitial?: string;
  /**
   * When true, surfaces the Channels section and the inline user/agent picker that lets
   * teammates be added to a channel. Gated on the Team plan in agent-setup. Default: false.
   */
  showChannels?: boolean;
}

function toAgentCardTooltipData(agent: Agent): AgentCardTooltipData {
  return {
    id: agent.id,
    name: agent.name || agent.id,
    state: agent.state,
    cpuMillicores: agent.cpu_millicores,
    memoryMib: agent.memory_mib,
    hostname: agent.hostname,
    startedAt: agent.started_at,
    updatedAt: agent.updated_at,
    lastError: agent.last_error,
    meta: agent.meta,
  };
}

export function AgentList({
  sidebarCollapsed,
  isDesktopViewport,
  mobileShowChat,
  agents,
  selectedAgentId,
  setSelectedAgentId,
  setMobileShowChat,
  setSidebarCollapsed,
  syntheticThreads,
  agentCardDataById,
  getToken,
  createOpenClawAgent,
  fetchAgents,
  setError,
  openCreateDialog,
  sidebarCreatorSignal,
  setPendingAgentDelete,
  updateAgentName,
  accountInitial,
  showChannels = false,
}: AgentListProps) {
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

  return (
    <motion.div
      className={`relative flex-shrink-0 h-full overflow-visible bg-background ${mobileShowChat && !isDesktopViewport ? "hidden" : "flex"} flex-col`}
      animate={{ width: sidebarCollapsed && isDesktopViewport ? 48 : 280 }}
      transition={{ type: "spring", stiffness: 360, damping: 32 }}
    >
      <div aria-hidden className="pointer-events-none absolute right-0 top-0 z-30 h-full w-px bg-border" />
      <AnimatePresence initial={false} mode="wait">
        {sidebarCollapsed && isDesktopViewport ? (
          <motion.div
            key="rail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-12 h-full flex flex-col bg-background overflow-visible"
          >
            <div className="flex h-14 shrink-0 items-center justify-center border-b border-border">
              <button
                onClick={() => setSidebarCollapsed(false)}
                title="Expand sidebar"
                className="w-8 h-8 rounded-md flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
              >
                <PanelLeftOpen className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto py-3">
              {agents.map((a) => {
                const av = agentAvatar(a.name || a.id, a.meta);
                const Icon = av.icon;
                const selected = selectedAgentId === a.id;
                return (
                  <Tooltip key={a.id} delayDuration={300}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          setSelectedAgentId(a.id);
                          setMobileShowChat(true);
                        }}
                        aria-label={`Select ${a.name || a.id}`}
                        className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${selected ? "ring-2 ring-[#38D39F] ring-offset-2 ring-offset-background" : ""}`}
                        style={{ backgroundColor: av.bgColor }}
                      >
                        {av.imageUrl ? (
                          <span
                            aria-label={`${a.name || a.id} avatar`}
                            className="h-full w-full rounded-full bg-cover bg-center"
                            style={{ backgroundImage: `url(${JSON.stringify(av.imageUrl)})` }}
                          />
                        ) : (
                          <Icon className="w-4 h-4" style={{ color: av.fgColor }} />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="start" className="bg-transparent border-0 p-0 shadow-none">
                      <AgentCardTooltip agentName={a.name || a.id} agent={mergedAgentCardDataById[a.id]} />
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
            <AgentsSidebarDashboardLinks compact accountInitial={accountInitial} />
          </motion.div>
        ) : (
          <motion.div
            key="full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            <AgentsChannelsSidebar
              variant="v3"
              showDivider={false}
              fillParent
              threads={syntheticThreads}
              selectedThreadId={selectedAgentId}
              showChannels={showChannels}
              availableAgents={agents.map((a) => ({
                id: a.id,
                name: a.name || a.id,
                type: "agent" as const,
                meta: a.meta ?? null,
              }))}
              agentCardDataById={mergedAgentCardDataById}
              onSelectThread={(threadId) => {
                setSelectedAgentId(threadId);
                setMobileShowChat(true);
              }}
              onStartAgentChat={(agent) => {
                setSelectedAgentId(agent.id);
                setMobileShowChat(true);
              }}
              onCreateAgent={async ({ name, iconIndex, size }) => {
                try {
                  const token = await getToken();
                  const created = await createOpenClawAgent(token, {
                    name: name || undefined,
                    start: true,
                    size,
                    meta: { ui: { avatar: { icon_index: iconIndex } } },
                  });
                  await fetchAgents();
                  return created.id ?? null;
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to create agent");
                  return null;
                }
              }}
              onNewThread={openCreateDialog}
              openAgentCreatorSignal={sidebarCreatorSignal}
              accountInitial={accountInitial}
              onDeleteThread={(threadId) => {
                const a = agents.find((x) => x.id === threadId);
                if (a) setPendingAgentDelete({ id: a.id, name: a.name || a.id });
              }}
              onRenameThread={async (threadId, title) => {
                const a = agents.find((x) => x.id === threadId);
                if (!a) return;
                try {
                  await updateAgentName(a.id, title);
                  await fetchAgents();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
              onCollapse={isDesktopViewport ? () => setSidebarCollapsed(true) : undefined}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export { AgentList as AgentSidebarPane };

export function AgentEmptyState({
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
}: {
  onCreate: () => void;
  onCreateAgent?: (params: { name: string; iconIndex: number; size: string }) => Promise<string | null>;
  budget?: {
    slots: Record<string, { granted: number; used: number; available: number }>;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: import("@hypercli.com/sdk/agent").HyperAgentSubscriptionSummary | null;
}) {
  const [showWizard, setShowWizard] = React.useState(false);

  if (showWizard) {
    return (
      <FirstAgentSetupWizard
        budget={budget}
        subscriptionSummary={subscriptionSummary}
        onCreateAgent={onCreateAgent ?? (async () => {
          onCreate();
          return null;
        })}
      />
    );
  }

  const examples = [
    "Ask questions across Slack, email, docs, and CRM data in one place.",
    "Get instant answers with company-specific context instead of hunting across tabs.",
    "Trigger actions like drafting replies, updating records, or creating follow-ups directly from chat.",
  ];

  return (
    <LaunchAgentEmptyStateContent
      icon={MessageSquare}
      title="Your business, one chat"
      description="Talk to your entire business like it is one system. Your agent understands your context, remembers your workflows, and takes action across your stack."
      examples={examples}
      onLaunch={() => setShowWizard(true)}
    />
  );
}

export function AgentFilesEmptyState({
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
}: {
  onCreate: () => void;
  onCreateAgent?: (params: { name: string; iconIndex: number; size: string }) => Promise<string | null>;
  budget?: {
    slots: Record<string, { granted: number; used: number; available: number }>;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: import("@hypercli.com/sdk/agent").HyperAgentSubscriptionSummary | null;
}) {
  const [showWizard, setShowWizard] = React.useState(false);

  if (showWizard) {
    return (
      <FirstAgentSetupWizard
        budget={budget}
        subscriptionSummary={subscriptionSummary}
        onCreateAgent={onCreateAgent ?? (async () => {
          onCreate();
          return null;
        })}
      />
    );
  }

  return (
    <LaunchAgentEmptyStateContent
      icon={FolderOpen}
      title="Your files, working for you"
      description="Your documents become usable intelligence. Your agent can search, understand, compare, summarize, and execute against your files instead of treating them like static uploads."
      examples={[
        "Search thousands of files using natural language instead of folder structures",
        "Compare contracts, proposals, reports, or spreadsheets in seconds",
        "Extract insights, summaries, action items, and data from PDFs, docs, and presentations automatically",
      ]}
      onLaunch={() => setShowWizard(true)}
    />
  );
}

export function AgentIntegrationsEmptyState({
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
}: {
  onCreate: () => void;
  onCreateAgent?: (params: { name: string; iconIndex: number; size: string }) => Promise<string | null>;
  budget?: {
    slots: Record<string, { granted: number; used: number; available: number }>;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: import("@hypercli.com/sdk/agent").HyperAgentSubscriptionSummary | null;
}) {
  const [showWizard, setShowWizard] = React.useState(false);

  if (showWizard) {
    return (
      <FirstAgentSetupWizard
        budget={budget}
        subscriptionSummary={subscriptionSummary}
        onCreateAgent={onCreateAgent ?? (async () => {
          onCreate();
          return null;
        })}
      />
    );
  }

  return (
    <LaunchAgentEmptyStateContent
      icon={Blocks}
      title="Your stack, unified"
      description="Connect the tools you already use. Unlike standalone LLMs, your agent works inside your real workflows - pulling from CRMs, Slack, email, databases, and internal systems in real time."
      examples={[
        "Pull live data from tools like HubSpot, Salesforce, Gmail, Slack, Notion, or databases",
        "Update records, create tickets, send emails, and sync workflows without switching apps",
        "Build cross-platform automations that work across your existing stack",
      ]}
      onLaunch={() => setShowWizard(true)}
    />
  );
}

export function AgentSkillsEmptyState({
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
}: {
  onCreate: () => void;
  onCreateAgent?: (params: { name: string; iconIndex: number; size: string }) => Promise<string | null>;
  budget?: {
    slots: Record<string, { granted: number; used: number; available: number }>;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: import("@hypercli.com/sdk/agent").HyperAgentSubscriptionSummary | null;
}) {
  const [showWizard, setShowWizard] = React.useState(false);

  if (showWizard) {
    return (
      <FirstAgentSetupWizard
        budget={budget}
        subscriptionSummary={subscriptionSummary}
        onCreateAgent={onCreateAgent ?? (async () => {
          onCreate();
          return null;
        })}
      />
    );
  }

  return (
    <LaunchAgentEmptyStateContent
      icon={Codepen}
      title="Your expertise, reusable"
      description="Turn repeatable work into reusable intelligence. Skills let your team package expertise, workflows, and automations so anyone can execute high-level tasks instantly."
      examples={[
        "Save repeatable workflows as reusable AI-powered playbooks",
        "Let anyone on your team execute expert-level tasks with one command",
        "Standardize onboarding, reporting, sales research, QA, support, and operations workflows",
      ]}
      onLaunch={() => setShowWizard(true)}
    />
  );
}

export function AgentScheduledEmptyState({
  onCreate,
  onCreateAgent,
  budget,
  subscriptionSummary,
}: {
  onCreate: () => void;
  onCreateAgent?: (params: { name: string; iconIndex: number; size: string }) => Promise<string | null>;
  budget?: {
    slots: Record<string, { granted: number; used: number; available: number }>;
    pooled_tpd: number;
  } | null;
  subscriptionSummary?: import("@hypercli.com/sdk/agent").HyperAgentSubscriptionSummary | null;
}) {
  const [showWizard, setShowWizard] = React.useState(false);

  if (showWizard) {
    return (
      <FirstAgentSetupWizard
        budget={budget}
        subscriptionSummary={subscriptionSummary}
        onCreateAgent={onCreateAgent ?? (async () => {
          onCreate();
          return null;
        })}
      />
    );
  }

  return (
    <LaunchAgentEmptyStateContent
      icon={CalendarClock}
      title="Your work, on autopilot"
      description="Make AI proactive instead of reactive. Your agent can monitor, report, follow up, and trigger workflows automatically on schedules - without waiting for someone to ask."
      examples={[
        "Schedule daily reports, summaries, and automated follow-ups",
        "Monitor pipelines, inboxes, or KPIs and trigger actions automatically",
        "Run recurring workflows without needing someone to manually prompt the AI",
      ]}
      onLaunch={() => setShowWizard(true)}
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
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background px-5 py-8">
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
          onClick={onLaunch}
          className="mt-8 inline-flex h-9 items-center gap-2 rounded-[8px] bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Launch agent
          <ArrowRight className="h-4 w-4" />
        </motion.button>
      </div>
    </div>
  );
}
