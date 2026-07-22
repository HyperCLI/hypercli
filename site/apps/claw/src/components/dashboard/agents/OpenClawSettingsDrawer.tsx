"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Loader2, SlidersHorizontal, X } from "lucide-react";
import {
  createOpenClawConfigValue,
  type OpenClawConfigSchemaResponse,
} from "@hypercli.com/sdk/openclaw/gateway";

import type { Agent, JsonObject } from "@/app/dashboard/agents/types";
import {
  OpenClawErrorBoundary,
} from "@/components/dashboard/agents/page-helpers";
import {
  asObject,
  deepCloneJsonObject,
  getOpenClawUiHint,
  getPathValue,
  humanizeKey,
  setPathValue,
  sortOpenClawEntries,
} from "@/lib/openclaw-config";
import { getAgentGatewayPanelBootStatus } from "./chat-boot-stage";
import { INITIAL_DYNAMIC_ENTRY_LIMIT, OpenClawFieldRenderer } from "./OpenClawSettingsFieldRenderer";
import { TooltipHint } from "@/components/ClawTooltip";

interface OpenClawSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  agent: Agent | null;
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  connected: boolean;
  connecting: boolean;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
  isDesktopViewport?: boolean;
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

function structuralRemovePath(root: JsonObject, path: string[]): JsonObject {
  if (path.length === 0) return root;
  const next = deepCloneJsonObject(root);
  const parentPath = path.slice(0, -1);
  const leafKey = path[path.length - 1];
  const parent = parentPath.length === 0 ? next : getPathValue(next, parentPath);
  if (parent && typeof parent === "object" && !Array.isArray(parent)) {
    delete (parent as JsonObject)[leafKey];
  }
  return next;
}

function SectionNav({
  sections,
  schemaBundle,
  activeSection,
  onSelect,
}: {
  sections: Array<[string, unknown]>;
  schemaBundle: OpenClawConfigSchemaResponse | null;
  activeSection: string | null;
  onSelect: (section: string) => void;
}) {
  return (
    <div className="space-y-1">
      {sections.map(([sectionKey, sectionSchema]) => {
        const sectionLabel = openclawSectionLabel(schemaBundle, sectionKey, sectionSchema);
        const sectionDescription = openclawSectionDescription(schemaBundle, sectionKey, sectionSchema, sectionKey);
        const selected = activeSection === sectionKey;
        return (
          <TooltipHint key={`openclaw-section-${sectionKey}`} label={sectionDescription} side="right">
            <button
              type="button"
              onClick={() => onSelect(sectionKey)}
              className={`block w-full rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                selected
                  ? "border-l-2 border-selection-accent bg-selection-accent/15 font-medium text-foreground"
                  : "text-text-muted hover:bg-surface-low/50 hover:text-foreground"
              }`}
            >
              <span className="block truncate">{sectionLabel}</span>
            </button>
          </TooltipHint>
        );
      })}
    </div>
  );
}

function OpenClawSectionEditor({
  activeSectionEntry,
  activeSectionLabel,
  schemaBundle,
  draft,
  connected,
  connecting,
  saving,
  error,
  success,
  jsonDrafts,
  jsonDraftErrors,
  mapDraftKeys,
  expandedMaps,
  expandedDynamicEntries,
  visibleDynamicCounts,
  onUpdatePath,
  onUpdateJsonDraft,
  onRemovePath,
  onMapDraftKeyChange,
  onAddMapEntry,
  onToggleMap,
  onToggleDynamicEntry,
  onShowMoreDynamicEntries,
  onSave,
  onClose,
  isDesktopViewport,
  onMobileBack,
}: {
  activeSectionEntry: [string, unknown] | null;
  activeSectionLabel: string | null;
  schemaBundle: OpenClawConfigSchemaResponse | null;
  draft: JsonObject | null;
  connected: boolean;
  connecting: boolean;
  saving: boolean;
  error: string | null;
  success: string | null;
  jsonDrafts: Record<string, string>;
  jsonDraftErrors: Record<string, string>;
  mapDraftKeys: Record<string, string>;
  expandedMaps: Set<string>;
  expandedDynamicEntries: Set<string>;
  visibleDynamicCounts: Record<string, number>;
  onUpdatePath: (path: string[], value: unknown) => void;
  onUpdateJsonDraft: (path: string[], raw: string) => void;
  onRemovePath: (path: string[]) => void;
  onMapDraftKeyChange: (pathKey: string, value: string) => void;
  onAddMapEntry: (path: string[], schemaRaw: unknown) => void;
  onToggleMap: (pathKey: string) => void;
  onToggleDynamicEntry: (entryKey: string) => void;
  onShowMoreDynamicEntries: (pathKey: string, total: number) => void;
  onSave: () => Promise<void>;
  onClose?: () => void;
  isDesktopViewport: boolean;
  onMobileBack: () => void;
}) {
  const settingsBootStatus = getAgentGatewayPanelBootStatus({
    connected,
    connecting,
    loading: connected && !schemaBundle,
    loadingTitle: "Loading settings",
    loadingDetail: "Reading OpenClaw settings.",
    connectingDetail: "Opening the settings workspace.",
    waitingDetail: "Connect the agent gateway to edit OpenClaw settings.",
  });
  const [sectionKey, sectionSchema] = activeSectionEntry ?? [null, null];
  const sectionDescription = sectionKey ? openclawSectionDescription(schemaBundle, sectionKey, sectionSchema) : "";
  const jsonDraftError = Object.values(jsonDraftErrors)[0] ?? null;

  return (
    <OpenClawErrorBoundary>
      <div className={isDesktopViewport ? "mx-auto max-w-5xl space-y-4" : "mx-auto max-w-xl space-y-4"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {!isDesktopViewport && (
              <button
                type="button"
                onClick={onMobileBack}
                className="mb-3 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            )}
            <h3 className="truncate text-lg font-semibold text-foreground">
              {activeSectionLabel ?? "OpenClaw Config"}
            </h3>
            {schemaBundle?.version && (
              <p className="mt-1 text-xs text-text-muted">
                Schema version <span className="font-mono">{schemaBundle.version}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving || !connected || !draft || Boolean(jsonDraftError) || !sectionKey}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--button-primary)] px-3 py-2 text-sm font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
            Save Section
          </button>
          {onClose && (
            <TooltipHint label="Close OpenClaw settings">
              <button type="button" aria-label="Close OpenClaw settings" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </TooltipHint>
          )}
        </div>

        {(error || success || settingsBootStatus || jsonDraftError) && (
          <div className="space-y-2">
            {(error || jsonDraftError) && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error ?? jsonDraftError}
              </div>
            )}
            {success && !error && !jsonDraftError && (
              <div className="rounded-lg border border-selection-accent/30 bg-selection-accent/10 px-3 py-2 text-sm text-selection-accent">
                {success}
              </div>
            )}
            {settingsBootStatus && !connected && !connecting && (
              <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
                {settingsBootStatus.detail}
              </div>
            )}
            {settingsBootStatus && connecting && !connected && (
              <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                {settingsBootStatus.title}
              </div>
            )}
          </div>
        )}

        {sectionKey && activeSectionEntry && draft ? (
          <section key={`openclaw-editor-${sectionKey}`} className="space-y-4 rounded-xl border border-border bg-surface-low/30 p-4">
            {sectionDescription && <p className="text-xs leading-5 text-text-muted">{sectionDescription}</p>}
            <OpenClawFieldRenderer
              schemaRaw={sectionSchema}
              path={[sectionKey]}
              schemaBundle={schemaBundle}
              draft={draft}
              disabled={!connected || saving}
              jsonDrafts={jsonDrafts}
              jsonDraftErrors={jsonDraftErrors}
              mapDraftKeys={mapDraftKeys}
              expandedMaps={expandedMaps}
              expandedDynamicEntries={expandedDynamicEntries}
              visibleDynamicCounts={visibleDynamicCounts}
              onUpdatePath={onUpdatePath}
              onUpdateJsonDraft={onUpdateJsonDraft}
              onRemovePath={onRemovePath}
              onMapDraftKeyChange={onMapDraftKeyChange}
              onAddMapEntry={onAddMapEntry}
              onToggleMap={onToggleMap}
              onToggleDynamicEntry={onToggleDynamicEntry}
              onShowMoreDynamicEntries={onShowMoreDynamicEntries}
            />
          </section>
        ) : null}

        {connected && schemaBundle && !activeSectionEntry && (
          <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
            No config schema available from gateway.
          </div>
        )}
      </div>
    </OpenClawErrorBoundary>
  );
}

function useOpenClawConfigDraft(config: Record<string, unknown> | null) {
  const [draft, setDraft] = useState<JsonObject | null>(() => deepCloneJsonObject(asObject(config) ?? {}));
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [jsonDraftErrors, setJsonDraftErrors] = useState<Record<string, string>>({});
  const [mapDraftKeys, setMapDraftKeys] = useState<Record<string, string>>({});

  const updatePath = useCallback((path: string[], value: unknown) => {
    setDraft((prev) => setPathValue(prev ?? {}, path, value));
  }, []);

  const removePath = useCallback((path: string[]) => {
    setDraft((prev) => prev ? structuralRemovePath(prev, path) : prev);
  }, []);

  const setJsonDraftError = useCallback((pathKey: string, message: string | null) => {
    setJsonDraftErrors((prev) => {
      const next = { ...prev };
      if (message) next[pathKey] = message;
      else delete next[pathKey];
      return next;
    });
  }, []);

  const updateJsonDraft = useCallback((path: string[], raw: string) => {
    const pathKey = path.join(".");
    setJsonDrafts((prev) => ({ ...prev, [pathKey]: raw }));
    try {
      updatePath(path, JSON.parse(raw));
      setJsonDraftError(pathKey, null);
    } catch {
      setJsonDraftError(pathKey, `Invalid JSON at ${path.join(".")}`);
    }
  }, [setJsonDraftError, updatePath]);

  const onMapDraftKeyChange = useCallback((pathKey: string, value: string) => {
    setMapDraftKeys((prev) => ({ ...prev, [pathKey]: value }));
  }, []);

  const addMapEntry = useCallback((path: string[], schemaRaw: unknown) => {
    const pathKey = path.join(".");
    const nextKey = (mapDraftKeys[pathKey] ?? "").trim();
    if (!nextKey) return;
    updatePath([...path, nextKey], createOpenClawConfigValue(schemaRaw));
    setMapDraftKeys((prev) => ({ ...prev, [pathKey]: "" }));
  }, [mapDraftKeys, updatePath]);

  return {
    draft,
    jsonDrafts,
    jsonDraftErrors,
    mapDraftKeys,
    updatePath,
    updateJsonDraft,
    removePath,
    onMapDraftKeyChange,
    addMapEntry,
    clearJsonDraftState: () => {
      setJsonDrafts({});
      setJsonDraftErrors({});
    },
  };
}

type OpenClawSettingsDrawerContentProps = Omit<OpenClawSettingsDrawerProps, "agent"> & { agent: Agent };

function OpenClawSettingsDrawerContent({
  open,
  onClose,
  agent,
  config,
  configSchema,
  connected,
  connecting,
  onSaveConfig,
  isDesktopViewport = true,
}: OpenClawSettingsDrawerContentProps) {
  const agentId = agent?.id ?? null;
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [mobileSectionsOpen, setMobileSectionsOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ agentId: string | null; error: string | null; success: string | null }>({
    agentId: null,
    error: null,
    success: null,
  });
  const [expandedMaps, setExpandedMaps] = useState<Set<string>>(new Set());
  const [expandedDynamicEntries, setExpandedDynamicEntries] = useState<Set<string>>(new Set());
  const [visibleDynamicCounts, setVisibleDynamicCounts] = useState<Record<string, number>>({});
  const {
    draft,
    jsonDrafts,
    jsonDraftErrors,
    mapDraftKeys,
    updatePath,
    updateJsonDraft,
    removePath,
    onMapDraftKeyChange,
    addMapEntry,
    clearJsonDraftState,
  } = useOpenClawConfigDraft(config);

  const schemaRoot = useMemo(() => asObject(configSchema?.schema ?? null), [configSchema]);
  const schemaProperties = useMemo(() => asObject(schemaRoot?.properties ?? null), [schemaRoot]);
  const sections = useMemo(
    () => sortOpenClawEntries(Object.entries(schemaProperties ?? {}), configSchema),
    [configSchema, schemaProperties],
  );
  const activeSection = useMemo(() => {
    if (selectedSection && sections.some(([sectionKey]) => sectionKey === selectedSection)) return selectedSection;
    return sections[0]?.[0] ?? null;
  }, [selectedSection, sections]);
  const activeSectionEntry = useMemo(
    () => sections.find(([sectionKey]) => sectionKey === activeSection) ?? null,
    [activeSection, sections],
  );
  const activeSectionLabel = useMemo(() => {
    if (!activeSectionEntry) return null;
    const [sectionKey, sectionSchema] = activeSectionEntry;
    return openclawSectionLabel(configSchema, sectionKey, sectionSchema);
  }, [activeSectionEntry, configSchema]);

  useEffect(() => {
    if (!open) return;
    const pane = paneRef.current;
    if (pane && typeof pane.scrollTo === "function") {
      pane.scrollTo({ top: 0, behavior: "auto" });
    } else if (pane) {
      pane.scrollTop = 0;
    }
  }, [activeSection, open]);

  const selectSection = useCallback((section: string) => {
    setSelectedSection((current) => current === section ? current : section);
    setMobileSectionsOpen(false);
  }, []);

  const toggleMap = useCallback((pathKey: string) => {
    setExpandedMaps((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) next.delete(pathKey);
      else next.add(pathKey);
      return next;
    });
  }, []);

  const toggleDynamicEntry = useCallback((entryKey: string) => {
    setExpandedDynamicEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryKey)) next.delete(entryKey);
      else next.add(entryKey);
      return next;
    });
  }, []);

  const showMoreDynamicEntries = useCallback((pathKey: string, total: number) => {
    setVisibleDynamicCounts((prev) => ({
      ...prev,
      [pathKey]: Math.min((prev[pathKey] ?? INITIAL_DYNAMIC_ENTRY_LIMIT) + INITIAL_DYNAMIC_ENTRY_LIMIT, total),
    }));
  }, []);

  const saveActiveSection = useCallback(async () => {
    if (!draft || !activeSection || !connected) return;
    const jsonDraftError = Object.values(jsonDraftErrors)[0];
    if (jsonDraftError) {
      setStatusMessage({ agentId, error: jsonDraftError, success: null });
      return;
    }
    setSaving(true);
    setStatusMessage({ agentId, error: null, success: null });
    try {
      await onSaveConfig({ [activeSection]: draft[activeSection] });
      clearJsonDraftState();
      setStatusMessage({ agentId, error: null, success: `Saved section: ${activeSection}` });
    } catch (err) {
      setStatusMessage({
        agentId,
        error: err instanceof Error ? err.message : "Failed to save OpenClaw config",
        success: null,
      });
    } finally {
      setSaving(false);
    }
  }, [activeSection, agentId, clearJsonDraftState, connected, draft, jsonDraftErrors, onSaveConfig]);

  const sectionNav = (
    <SectionNav
      sections={sections}
      schemaBundle={configSchema}
      activeSection={activeSection}
      onSelect={selectSection}
    />
  );

  const showMobileSections = !isDesktopViewport && mobileSectionsOpen;
  const visibleStatusMessage = statusMessage.agentId === agentId ? statusMessage : { error: null, success: null };

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
            className="absolute inset-0 bg-background/75 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
            className="relative z-10 h-full w-full max-w-[920px] border-l border-border bg-background shadow-2xl sm:w-[min(920px,calc(100vw-3rem))]"
          >
            {showMobileSections ? (
              <div className="flex h-full min-h-0 flex-col bg-background">
                <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
                  <SlidersHorizontal className="h-4 w-4 text-selection-accent" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">OpenClaw settings</p>
                    <p className="text-[10px] text-text-muted">Choose a section to edit</p>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <div className="mx-auto max-w-xl rounded-xl border border-border bg-surface-low/20 p-4">
                    <h3 className="text-lg font-semibold text-foreground">OpenClaw Sections</h3>
                    <p className="mt-1 text-sm text-text-muted">Choose a section to edit.</p>
                    <div className="mt-4">{sectionNav}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`flex h-full min-h-0 bg-background ${isDesktopViewport ? "flex-row" : "flex-col"}`}>
                {isDesktopViewport && (
                  <aside className="w-[200px] min-w-[160px] max-w-[260px] shrink-0 border-r border-border bg-surface-low/20">
                    <div className="h-full overflow-y-auto p-3">
                      <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Sections</p>
                      {sectionNav}
                    </div>
                  </aside>
                )}
                <div ref={paneRef} className={`min-w-0 flex-1 overflow-y-auto ${isDesktopViewport ? "p-6" : "p-4"}`}>
                  <OpenClawSectionEditor
                    activeSectionEntry={activeSectionEntry}
                    activeSectionLabel={activeSectionLabel}
                    schemaBundle={configSchema}
                    draft={draft}
                    connected={connected}
                    connecting={connecting}
                    saving={saving}
                    error={visibleStatusMessage.error}
                    success={visibleStatusMessage.success}
                    jsonDrafts={jsonDrafts}
                    jsonDraftErrors={jsonDraftErrors}
                    mapDraftKeys={mapDraftKeys}
                    expandedMaps={expandedMaps}
                    expandedDynamicEntries={expandedDynamicEntries}
                    visibleDynamicCounts={visibleDynamicCounts}
                    onUpdatePath={updatePath}
                    onUpdateJsonDraft={updateJsonDraft}
                    onRemovePath={removePath}
                    onMapDraftKeyChange={onMapDraftKeyChange}
                    onAddMapEntry={addMapEntry}
                    onToggleMap={toggleMap}
                    onToggleDynamicEntry={toggleDynamicEntry}
                    onShowMoreDynamicEntries={showMoreDynamicEntries}
                    onSave={saveActiveSection}
                    onClose={onClose}
                    isDesktopViewport={isDesktopViewport}
                    onMobileBack={() => setMobileSectionsOpen(true)}
                  />
                </div>
              </div>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

export function OpenClawSettingsDrawer(props: OpenClawSettingsDrawerProps) {
  if (!props.open || !props.agent) return null;

  const { agent, ...rest } = props;
  const configReadyKey = props.config ? "config" : "empty";
  const schemaVersionKey = props.configSchema?.version ?? "schema";

  return (
    <OpenClawSettingsDrawerContent
      key={`${agent.id}:${configReadyKey}:${schemaVersionKey}`}
      {...rest}
      agent={agent}
    />
  );
}
