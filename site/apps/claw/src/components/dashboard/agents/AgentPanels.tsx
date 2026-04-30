"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Loader2, PanelLeftOpen, Plus, SlidersHorizontal, X } from "lucide-react";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";

import type { Agent, JsonObject } from "@/app/dashboard/agents/types";
import { IntegrationsPage } from "@/components/dashboard/integrations";
import { Tooltip, TooltipContent, TooltipTrigger } from "@hypercli/shared-ui";
import { AgentCardTooltip } from "@/components/dashboard/modules/AgentCardModule";
import { AgentsChannelsSidebar, type ConversationThread } from "@/components/dashboard/AgentsChannelsSidebar";
import { agentAvatar } from "@/lib/avatar";
import { formatCpu, formatMemory } from "@/lib/format";
import { asObject, getOpenClawUiHint, humanizeKey } from "@/lib/openclaw-config";
import type { WorkspaceFile } from "@/lib/openclaw-chat";
import type { ActivityEntry } from "@/lib/openclaw-session";
import { OpenClawErrorBoundary } from "./page-helpers";

interface SessionLike {
  connected: boolean;
  connecting: boolean;
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  saveConfig: (patch: Record<string, unknown>) => Promise<void>;
  channelsStatus: (probe?: boolean, timeoutMs?: number) => Promise<Record<string, any>>;
  activityFeed: ActivityEntry[];
  files: WorkspaceFile[];
}

interface OpenClawConfigModalProps {
  open: boolean;
  agent: Agent | null;
  onClose: () => void;
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

export function OpenClawConfigModal({
  open,
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
}: OpenClawConfigModalProps) {
  return (
    <AnimatePresence>
      {open && agent && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="w-full max-w-2xl bg-background border-l border-border flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">OpenClaw Config</h2>
              <button onClick={onClose} className="text-text-muted hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="h-full min-h-0 flex flex-row">
                <aside className="w-[200px] shrink-0 border-r border-border bg-surface-low/20" style={{ minWidth: 160, maxWidth: 260 }}>
                  <div className="h-full overflow-y-auto p-3">
                    <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Sections</p>
                    <div className="space-y-0.5">
                      {openclawSections.map(([sectionKey, sectionSchema]) => {
                        const sectionHint = getOpenClawUiHint(openclawSchemaBundle, [sectionKey]);
                        const sectionLabel =
                          sectionHint?.label?.trim() ||
                          (typeof asObject(sectionSchema)?.title === "string"
                            ? String(asObject(sectionSchema)?.title)
                            : humanizeKey(sectionKey));
                        return (
                          <button
                            key={`modal-nav-${sectionKey}`}
                            onClick={() => setActiveOpenclawSection(sectionKey)}
                            className={`block w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors truncate ${
                              effectiveOpenclawSection === sectionKey
                                ? "bg-primary/15 text-foreground font-medium border-l-2 border-primary"
                                : "text-text-muted hover:text-foreground hover:bg-surface-low/40"
                            }`}
                          >
                            {sectionLabel}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </aside>
                <div ref={openclawPaneRef} className="flex-1 min-w-0 overflow-y-auto p-6">
                  <OpenClawErrorBoundary>
                    <div className="mx-auto max-w-5xl space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-foreground">
                            {activeOpenclawSectionLabel ?? "OpenClaw Config"}
                          </h3>
                        </div>
                        <button
                          onClick={() => void (effectiveOpenclawSection ? saveOpenclawSection(effectiveOpenclawSection) : saveAllOpenclaw())}
                          disabled={openclawSaving || !chat.connected || !openclawDraft}
                          className="btn-primary px-3 py-2 rounded-lg text-sm disabled:opacity-50 inline-flex items-center gap-2"
                        >
                          {openclawSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <SlidersHorizontal className="w-4 h-4" />}
                          {effectiveOpenclawSection ? "Save Section" : "Save All"}
                        </button>
                      </div>
                      {openclawError && (
                        <div className="rounded-lg border border-[#d05f5f]/30 bg-[#d05f5f]/10 px-3 py-2 text-sm text-[#d05f5f]">{openclawError}</div>
                      )}
                      {openclawSuccess && !openclawError && (
                        <div className="rounded-lg border border-[#38D39F]/30 bg-[#38D39F]/10 px-3 py-2 text-sm text-[#38D39F]">{openclawSuccess}</div>
                      )}
                      {!chat.connected && !chat.connecting && (
                        <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">Connect the agent gateway to edit OpenClaw settings.</div>
                      )}
                      {chat.connecting && !chat.connected && (
                        <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted inline-flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> Connecting to gateway…
                        </div>
                      )}
                      {openclawDraft && (
                        <div className="space-y-4">
                          {visibleOpenclawSections.map(([sectionKey, sectionSchema]) => {
                            const sectionHint = getOpenClawUiHint(openclawSchemaBundle, [sectionKey]);
                            const sectionDescription =
                              sectionHint?.help?.trim() ||
                              (typeof asObject(sectionSchema)?.description === "string"
                                ? String(asObject(sectionSchema)?.description)
                                : "");
                            return (
                              <div key={`modal-section-${sectionKey}`} className="rounded-xl border border-border bg-surface-low/30 p-4 space-y-4">
                                {sectionDescription && <p className="text-xs text-text-muted">{sectionDescription}</p>}
                                {renderOpenclawField(sectionSchema, [sectionKey])}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </OpenClawErrorBoundary>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface AgentSettingsModalProps {
  open: boolean;
  agent: Agent | null;
  onClose: () => void;
  settingsName: string;
  setSettingsName: (value: string) => void;
  savingName: boolean;
  handleSaveName: () => void;
  selectedAgentTier: string | null;
  chat: SessionLike;
  handleStop: (agentId: string) => void;
  stoppingId: string | null;
  setPendingAgentDelete: (value: { id: string; name: string } | null) => void;
}

export function AgentSettingsModal({
  open,
  agent,
  onClose,
  settingsName,
  setSettingsName,
  savingName,
  handleSaveName,
  selectedAgentTier,
  chat,
  handleStop,
  stoppingId,
  setPendingAgentDelete,
}: AgentSettingsModalProps) {
  return (
    <AnimatePresence>
      {open && agent && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="w-full max-w-lg bg-background border-l border-border flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Settings</h2>
              <button onClick={onClose} className="text-text-muted hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-8">
              <div className="max-w-2xl w-full mx-auto space-y-8">
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">Agent Identity</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-text-secondary mb-1">Name</label>
                      <div className="flex items-center gap-2">
                        <input
                          value={settingsName}
                          onChange={(e) => setSettingsName(e.target.value)}
                          disabled={agent.state !== "STOPPED"}
                          className={`flex-1 px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong ${agent.state !== "STOPPED" ? "opacity-50 cursor-not-allowed" : ""}`}
                          placeholder="Agent name"
                        />
                        {agent.state === "STOPPED" && settingsName.trim() && settingsName.trim() !== (agent.name || "") && (
                          <button
                            onClick={handleSaveName}
                            disabled={savingName}
                            className="flex-shrink-0 px-3 py-2 rounded-lg text-sm bg-[#38D39F] text-[#0a0a0b] font-medium hover:bg-[#38D39F]/90 disabled:opacity-60"
                          >
                            {savingName ? "Saving..." : "Save"}
                          </button>
                        )}
                      </div>
                      {agent.state !== "STOPPED" && (
                        <p className="text-xs text-text-muted mt-1">Stop the agent to change its name</p>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">Integrations</h3>
                  <IntegrationsPage
                    config={chat.config as Record<string, unknown> | null}
                    configSchema={chat.configSchema}
                    connected={chat.connected}
                    onSaveConfig={async (patch) => { await chat.saveConfig(patch); }}
                    onChannelProbe={async () => chat.channelsStatus(true)}
                  />
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-4">Information</h3>
                  <div className="glass-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">Agent ID</span>
                      <span className="text-sm text-text-tertiary font-mono truncate min-w-0">{agent.id.slice(0, 12)}...</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">Status</span>
                      <span className={`text-sm font-medium ${
                        agent.state === "RUNNING" ? "text-[#38D39F]" :
                        agent.state === "FAILED" ? "text-[#d05f5f]" :
                        agent.state === "STOPPED" ? "text-text-muted" :
                        "text-[#f0c56c]"
                      }`}>{agent.state}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">Resources</span>
                      <span className="text-sm text-text-tertiary truncate min-w-0">{formatCpu(agent.cpu_millicores)} · {formatMemory(agent.memory_mib)}</span>
                    </div>
                    {selectedAgentTier && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-secondary">Tier</span>
                        <span className="text-sm text-text-tertiary truncate min-w-0">{selectedAgentTier}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-[#d05f5f] mb-4">Danger Zone</h3>
                  <div className="border border-[#d05f5f]/20 rounded-lg p-4 space-y-3">
                    {agent.state === "RUNNING" && (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">Stop Agent</p>
                          <p className="text-xs text-text-muted">Stop the running agent container</p>
                        </div>
                        <button
                          onClick={() => { handleStop(agent.id); onClose(); }}
                          disabled={stoppingId === agent.id}
                          className="flex-shrink-0 px-3 py-1.5 rounded-lg text-sm border border-border text-foreground hover:bg-surface-low disabled:opacity-60"
                        >
                          {stoppingId === agent.id ? "Stopping..." : "Stop"}
                        </button>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">Delete Agent</p>
                        <p className="text-xs text-text-muted">Permanently delete this agent and all its data</p>
                      </div>
                      <button
                        onClick={() => { setPendingAgentDelete({ id: agent.id, name: agent.name || agent.id }); onClose(); }}
                        className="flex-shrink-0 px-3 py-1.5 rounded-lg text-sm border border-[#d05f5f]/30 text-[#d05f5f] hover:bg-[#d05f5f]/10"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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
  return (
    <motion.div
      className={`flex-shrink-0 h-full overflow-hidden ${mobileShowChat && !isDesktopViewport ? "hidden" : "flex"} flex-col`}
      animate={{ width: sidebarCollapsed && isDesktopViewport ? 48 : 280 }}
      transition={{ type: "spring", stiffness: 360, damping: 32 }}
    >
      <AnimatePresence initial={false} mode="wait">
        {sidebarCollapsed && isDesktopViewport ? (
          <motion.div
            key="rail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-12 h-full flex flex-col items-center gap-2 border-r border-border bg-background py-3 overflow-y-auto"
          >
            <button
              onClick={() => setSidebarCollapsed(false)}
              title="Expand sidebar"
              className="w-8 h-8 rounded-md flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
            >
              <PanelLeftOpen className="w-3.5 h-3.5" />
            </button>
            <div className="w-6 h-px bg-border my-1" />
            {agents.map((a) => {
              const av = agentAvatar(a.name || a.id);
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
                      className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${selected ? "ring-2 ring-[#38D39F] ring-offset-2 ring-offset-background" : ""}`}
                      style={{ backgroundColor: av.bgColor }}
                    >
                      <Icon className="w-4 h-4" style={{ color: av.fgColor }} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" align="start" className="bg-transparent border-0 p-0 shadow-none">
                    <AgentCardTooltip agentName={a.name || a.id} />
                  </TooltipContent>
                </Tooltip>
              );
            })}
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
              threads={syntheticThreads}
              selectedThreadId={selectedAgentId}
              showChannels={showChannels}
              availableAgents={agents.map((a) => ({
                id: a.id,
                name: a.name || a.id,
                type: "agent" as const,
              }))}
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
}: {
  onCreate: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <Bot className="w-10 h-10 text-text-muted mx-auto mb-3" />
        <p className="text-text-secondary mb-4">Select or create an agent to get started</p>
        <motion.button
          whileHover={{ scale: 1.02, boxShadow: "0 0 16px rgba(56,211,159,0.12)" }}
          whileTap={{ scale: 0.97 }}
          onClick={onCreate}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium bg-[#38D39F]/10 border border-[#38D39F]/20 hover:border-[#38D39F]/40 text-[#38D39F] transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create new agent</span>
        </motion.button>
      </div>
    </div>
  );
}
