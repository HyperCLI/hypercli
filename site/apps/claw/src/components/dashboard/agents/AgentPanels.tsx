"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Bot, PanelLeftOpen, SlidersHorizontal, Sparkles, X } from "lucide-react";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";

import type { Agent, JsonObject } from "@/app/dashboard/agents/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@hypercli/shared-ui";
import { AgentCardTooltip, type AgentCardTooltipData } from "@/components/dashboard/modules/AgentCardModule";
import { AgentsChannelsSidebar, type ConversationThread } from "@/components/dashboard/AgentsChannelsSidebar";
import { FilePreview } from "@/components/dashboard/files/FilePreview";
import type { FileEntry } from "@/components/dashboard/files/types";
import { agentAvatar } from "@/lib/avatar";
import type { WorkspaceFile } from "@/lib/openclaw-chat";
import type { ActivityEntry } from "@/lib/openclaw-session";
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

interface AgentSettingsPanelProps {
  agent: Agent | null;
  settingsName: string;
  setSettingsName: (value: string) => void;
  savingName: boolean;
  handleSaveName: () => void;
  chat: SessionLike;
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
      className={`relative flex-shrink-0 h-full overflow-hidden bg-background ${mobileShowChat && !isDesktopViewport ? "hidden" : "flex"} flex-col`}
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
            className="w-12 h-full flex flex-col bg-background overflow-hidden"
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
}: {
  onCreate: () => void;
  onCreateAgent?: (params: { name: string; iconIndex: number; size: string }) => Promise<string | null>;
}) {
  const [showWizard, setShowWizard] = React.useState(false);

  if (showWizard) {
    return (
      <FirstAgentSetupWizard
        onCreateAgent={onCreateAgent ?? (async () => {
          onCreate();
          return null;
        })}
      />
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[560px] text-center">
        <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface-low/70 px-3 py-1 text-[11px] font-medium text-text-secondary">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>First agent setup</span>
        </div>
        <h1 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
          Launch your first agent
        </h1>
        <p className="mx-auto mt-3 max-w-[460px] text-sm leading-6 text-text-muted">
          Create a focused agent, add useful context, and choose a plan.
        </p>
        <motion.button
          whileHover={{ y: -2, boxShadow: "0 16px 44px rgba(0,0,0,0.25), 0 0 22px rgba(56,211,159,0.07)" }}
          whileTap={{ scale: 0.99 }}
          type="button"
          onClick={() => setShowWizard(true)}
          className="group mx-auto mt-7 flex w-full max-w-[480px] items-center justify-between gap-4 rounded-lg border border-border bg-surface-low/80 px-4 py-4 text-left shadow-[0_14px_44px_rgba(0,0,0,0.22)] transition-colors hover:border-primary/35 hover:bg-surface-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-border-medium bg-surface-high text-primary">
              <Bot className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold leading-tight text-foreground">Create a first agent</span>
              <span className="mt-1 block text-xs leading-5 text-text-muted">
                Guided setup that creates the agent directly.
              </span>
            </span>
          </span>
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors group-hover:bg-primary-hover">
            <ArrowRight className="h-[18px] w-[18px]" />
          </span>
        </motion.button>
      </div>
    </div>
  );
}
