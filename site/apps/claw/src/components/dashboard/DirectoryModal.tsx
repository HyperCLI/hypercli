"use client";

import React, { useCallback, useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Sparkles,
  Globe,
  MessageSquare,
  Wrench,
  Palette,
  ArrowLeft,
  BriefcaseBusiness,
  Box,
  Check,
  Code2,
  Loader2,
  Search,
  FileText,
  BookOpen,
  FileCode2,
  Monitor,
  PackageCheck,
} from "lucide-react";
import {
  type DirectoryCategory,
} from "./directory/directory-utils";
import { DirectoryDetail } from "./directory/DirectoryDetail";
import { isPluginConnected } from "./directory/directory-utils";
import { loadSystemSkills, type AgentFileSource, type WorkspaceSkill } from "./directory/workspace-skills";
import {
  PLUGIN_REGISTRY,
  type PluginMeta,
} from "./integrations/plugin-registry";
import type { FileEntry } from "./files/types";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";

type DirectoryFilter = "all" | DirectorySectionId;
type DirectorySectionId = DirectoryCategory | "productivity" | "coding";

interface DirectorySectionDef {
  id: DirectorySectionId;
  label: string;
  description: string;
  icon: React.ElementType;
}

const WEB_PLUGIN_IDS = new Set(["brave", "duckduckgo", "exa", "tavily", "firecrawl"]);
const CODING_PLUGIN_IDS = new Set(["diffs", "kilocode", "open-prose", "opencode", "opencode-go", "acpx"]);
const PRODUCTIVITY_PLUGIN_IDS = new Set([
  "memory-core",
  "memory-lancedb",
  "llm-task",
  "synthetic",
  "thread-ownership",
  "diagnostics-otel",
  "device-pair",
]);
const MEDIA_PLUGIN_IDS = new Set(["elevenlabs", "deepgram", "fal", "voice-call", "talk-voice", "phone-control"]);

const DIRECTORY_SECTIONS: DirectorySectionDef[] = [
  { id: "channels", label: "Channels", description: "Messaging platforms and inboxes", icon: MessageSquare },
  { id: "intelligence", label: "Intelligence", description: "Model providers and inference", icon: Sparkles },
  { id: "productivity", label: "Productivity", description: "Memory, workflow, and operations", icon: BriefcaseBusiness },
  { id: "coding", label: "Coding", description: "Developer tools and code workflows", icon: Code2 },
  { id: "media", label: "Media", description: "Voice, speech, images, video, and devices", icon: Palette },
  { id: "web", label: "Web", description: "Search, crawl, and browse the internet", icon: Globe },
  { id: "skills", label: "Skills", description: "App SKILL.md files available to this agent", icon: Box },
  { id: "tools", label: "Tools", description: "General utilities and agent capabilities", icon: Wrench },
];

function schemaPathExists(schema: Record<string, any> | null | undefined, path: string): boolean {
  if (!schema) return false;
  let node: Record<string, any> | undefined = schema;
  for (const part of path.split(".")) {
    const properties = node?.properties;
    if (!properties || typeof properties !== "object" || !(part in properties)) {
      return false;
    }
    node = properties[part] as Record<string, any>;
  }
  return true;
}

function isPluginAvailableInSdk(plugin: PluginMeta, configSchema: OpenClawConfigSchemaResponse | null): boolean {
  if (!configSchema) return false;
  return (
    schemaPathExists(configSchema.schema, plugin.configPath) ||
    Boolean(configSchema.uiHints?.[plugin.configPath] || configSchema.uiHints?.[`${plugin.configPath}.enabled`])
  );
}

function getPluginSectionId(plugin: PluginMeta): DirectorySectionId {
  if (plugin.category === "chat") return "channels";
  if (plugin.category === "ai-providers") return "intelligence";
  if (plugin.category === "built-in" || MEDIA_PLUGIN_IDS.has(plugin.id)) return "media";
  if (WEB_PLUGIN_IDS.has(plugin.id)) return "web";
  if (CODING_PLUGIN_IDS.has(plugin.id)) return "coding";
  if (PRODUCTIVITY_PLUGIN_IDS.has(plugin.id)) return "productivity";
  return "tools";
}

function getInitialFilter(category?: DirectoryCategory): DirectoryFilter {
  return category ?? "all";
}

function FilterPill({
  active,
  label,
  count,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  icon: React.ElementType;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${
        active
          ? "border-[#38D39F]/50 bg-[#38D39F]/12 text-foreground"
          : "border-border bg-surface-low/25 text-text-secondary hover:bg-surface-low/60 hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      <span className={active ? "text-[#38D39F]" : "text-text-muted"}>{count}</span>
    </button>
  );
}

function IntegrationDirectoryCard({
  plugin,
  config,
  compact = false,
  onClick,
}: {
  plugin: PluginMeta;
  config: Record<string, unknown> | null;
  compact?: boolean;
  onClick: () => void;
}) {
  const Icon = plugin.icon;
  const active = isPluginConnected(plugin.id, config);
  const included = plugin.category === "built-in";
  const showBadge = active || included;

  return (
    <motion.button
      type="button"
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-lg border border-border bg-surface-low/25 text-left transition-colors hover:border-[#38D39F]/35 hover:bg-surface-low/50 ${
        compact ? "px-3 py-2.5" : "px-3 py-3"
      }`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/70">
        <Icon className="h-4 w-4 text-text-secondary transition-colors group-hover:text-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{plugin.displayName}</p>
          {showBadge && (
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                active
                  ? "bg-[#38D39F]/12 text-[#38D39F]"
                  : "bg-surface-low text-text-muted"
              }`}
            >
              {active && <Check className="h-3 w-3" />}
              {active ? "Active" : "Included"}
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{plugin.description}</p>
      </div>
    </motion.button>
  );
}

function SkillDirectoryCard({ skill }: { skill: WorkspaceSkill }) {
  const capabilities = [
    skill.hasScripts ? { label: "Scripts", icon: FileCode2 } : null,
    skill.hasReferences ? { label: "References", icon: BookOpen } : null,
    skill.hasAssets ? { label: "Assets", icon: PackageCheck } : null,
  ].filter(Boolean) as Array<{ label: string; icon: React.ElementType }>;
  const requirementLabel = skill.requiresBins.length > 0 ? `${skill.requiresBins.length} bin${skill.requiresBins.length === 1 ? "" : "s"}` : null;
  const osLabel = skill.os.length > 0 ? skill.os.join(", ") : null;
  const installLabel = skill.installHints.length > 0 ? "Install hints" : null;

  return (
    <div className="flex w-full items-start gap-3 rounded-lg border border-border bg-surface-low/25 px-3 py-3 text-left">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background/70">
        {skill.emoji ? (
          <span className="text-lg leading-none" aria-hidden="true">{skill.emoji}</span>
        ) : (
          <FileText className="h-4 w-4 text-text-secondary" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{skill.name}</p>
          <span className="inline-flex shrink-0 rounded-full bg-[#38D39F]/12 px-2 py-0.5 text-[10px] font-medium text-[#38D39F]">
            Available
          </span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{skill.description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10px] text-text-secondary">
            {skill.category}
          </span>
          {capabilities.map(({ label, icon: Icon }) => (
            <span key={label} className="inline-flex items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10px] text-text-muted">
              <Icon className="h-3 w-3" />
              {label}
            </span>
          ))}
          {requirementLabel && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10px] text-text-muted">
              <PackageCheck className="h-3 w-3" />
              {requirementLabel}
            </span>
          )}
          {osLabel && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10px] text-text-muted">
              <Monitor className="h-3 w-3" />
              {osLabel}
            </span>
          )}
          {installLabel && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10px] text-text-muted">
              <Wrench className="h-3 w-3" />
              {installLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Props ──

export interface DirectoryModalProps {
  open: boolean;
  onClose: () => void;
  initialCategory?: DirectoryCategory;
  initialItemId?: string;
  agentName?: string | null;
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  channelsStatus: Record<string, unknown> | null;
  connected: boolean;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, unknown>>;
  onOpenShell: () => void;
  onListFiles?: (path?: string, source?: AgentFileSource) => Promise<FileEntry[]>;
  onReadFile?: (path: string, source?: AgentFileSource) => Promise<string>;
}

// ── Component ──

export function DirectoryModal({
  open,
  onClose,
  initialCategory,
  initialItemId,
  agentName,
  config,
  configSchema,
  connected,
  onSaveConfig,
  onChannelProbe,
  onOpenShell,
  onListFiles,
  onReadFile,
}: DirectoryModalProps) {
  const [activeFilter, setActiveFilter] = useState<DirectoryFilter>(getInitialFilter(initialCategory));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId ?? null);
  const [searchQuery, setSearchQuery] = useState("");
  const [workspaceSkills, setWorkspaceSkills] = useState<WorkspaceSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const canLoadWorkspaceSkills = Boolean(onListFiles && onReadFile);

  useEffect(() => {
    if (open) {
      setActiveFilter(getInitialFilter(initialCategory));
      setSelectedItemId(initialItemId ?? null);
      setSearchQuery("");
    }
  }, [open, initialCategory, initialItemId]);

  const availablePlugins = useMemo(
    () => PLUGIN_REGISTRY.filter((plugin) => isPluginAvailableInSdk(plugin, configSchema)),
    [configSchema],
  );

  const activePlugins = useMemo(
    () => availablePlugins.filter((plugin) => isPluginConnected(plugin.id, config)),
    [availablePlugins, config],
  );

  useEffect(() => {
    if (!open || activeFilter !== "skills") return;
    if (!onListFiles || !onReadFile) {
      return;
    }

    let cancelled = false;
    void Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setSkillsLoading(true);
        setSkillsError(null);
        return loadSystemSkills(onListFiles, onReadFile);
      })
      .then((skills) => {
        if (!cancelled && skills) setWorkspaceSkills(skills);
      })
      .catch((error) => {
        if (!cancelled) {
          setWorkspaceSkills([]);
          setSkillsError(error instanceof Error ? error.message : "Failed to load workspace skills.");
        }
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeFilter, onListFiles, onReadFile, open]);

  const sectionedPlugins = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return DIRECTORY_SECTIONS.map((section) => {
      const plugins = availablePlugins.filter((plugin) => {
        if (getPluginSectionId(plugin) !== section.id) return false;
        if (!query) return true;
        return (
          plugin.displayName.toLowerCase().includes(query) ||
          plugin.description.toLowerCase().includes(query) ||
          plugin.id.toLowerCase().includes(query)
        );
      });
      return { ...section, plugins };
    }).filter((section) => section.plugins.length > 0 && (activeFilter === "all" || activeFilter === section.id));
  }, [activeFilter, availablePlugins, searchQuery]);

  const sectionCounts = useMemo(() => {
    const counts = new Map<DirectorySectionId, number>();
    for (const plugin of availablePlugins) {
      const sectionId = getPluginSectionId(plugin);
      counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1);
    }
    counts.set("skills", workspaceSkills.length);
    return counts;
  }, [availablePlugins, workspaceSkills.length]);

  const filteredSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return workspaceSkills;
    return workspaceSkills.filter((skill) => (
      skill.name.toLowerCase().includes(query) ||
      skill.description.toLowerCase().includes(query) ||
      skill.id.toLowerCase().includes(query) ||
      skill.path.toLowerCase().includes(query)
    ));
  }, [searchQuery, workspaceSkills]);

  const selectedPluginAvailable = selectedItemId
    ? availablePlugins.some((plugin) => plugin.id === selectedItemId)
    : false;
  const showingSkills = activeFilter === "skills" && !selectedItemId;
  const effectiveSkillsError = showingSkills && !canLoadWorkspaceSkills
    ? "Workspace file access is unavailable."
    : skillsError;

  const handleFilterChange = useCallback((filter: DirectoryFilter) => {
    setActiveFilter(filter);
    setSelectedItemId(null);
  }, []);

  const handleBackToGrid = useCallback(() => {
    setSelectedItemId(null);
  }, []);

  const handleCloseModal = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCloseModal();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, handleCloseModal]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60"
            onClick={handleCloseModal}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-4 z-50 flex overflow-hidden rounded-2xl border border-border bg-[#111113] shadow-2xl sm:inset-8 lg:inset-12"
          >
            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="flex items-center gap-3">
                  {selectedItemId && (
                    <button
                      onClick={handleBackToGrid}
                      className="text-text-muted hover:text-foreground transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{showingSkills ? "Skills" : "Integrations"}</h3>
                    <p className="text-xs text-text-muted">
                      {selectedItemId
                        ? "Configure this integration"
                        : showingSkills
                          ? "Available from the workspace skills directory"
                          : `Available for ${agentName || "this agent"}`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCloseModal}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {showingSkills ? (
                  <div className="mx-auto max-w-5xl space-y-6 pb-8">
                    <section className="space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h4 className="text-sm font-semibold text-foreground">App skills</h4>
                          <p className="mt-0.5 text-xs text-text-muted">
                            Global skills discovered from `/app/skills/*/SKILL.md` on the agent system.
                          </p>
                        </div>
                        <span className="text-xs text-text-muted">{workspaceSkills.length} available</span>
                      </div>
                      <div className="relative max-w-sm">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          placeholder="Search skills..."
                          className="h-9 w-full rounded-lg border border-border bg-surface-low/40 pl-9 pr-3 text-sm text-foreground placeholder:text-text-muted outline-none transition-colors focus:border-[#38D39F]/60"
                        />
                      </div>
                    </section>
                    {skillsLoading ? (
                      <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-border bg-surface-low/20">
                        <div className="flex items-center gap-3 text-sm text-text-secondary">
                          <Loader2 className="h-4 w-4 animate-spin text-[var(--primary)]" />
                          Loading workspace skills...
                        </div>
                      </div>
                    ) : effectiveSkillsError ? (
                      <div className="rounded-lg border border-border bg-surface-low/20 px-4 py-8 text-center text-sm text-text-muted">
                        {effectiveSkillsError}
                      </div>
                    ) : filteredSkills.length > 0 ? (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {filteredSkills.map((skill) => (
                          <SkillDirectoryCard key={skill.path} skill={skill} />
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-border bg-surface-low/20 px-4 py-8 text-center text-sm text-text-muted">
                        No app skills found in `/app/skills`.
                      </div>
                    )}
                  </div>
                ) : !configSchema ? (
                  <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl border border-border bg-surface-low/20">
                    <div className="flex items-center gap-3 text-sm text-text-secondary">
                      <Loader2 className="h-4 w-4 animate-spin text-[var(--primary)]" />
                      Loading SDK integrations...
                    </div>
                  </div>
                ) : selectedItemId && selectedPluginAvailable ? (
                  <DirectoryDetail
                    pluginId={selectedItemId}
                    config={config}
                    connected={connected}
                    onSaveConfig={onSaveConfig}
                    onChannelProbe={onChannelProbe}
                    onOpenShell={onOpenShell}
                    onBack={handleBackToGrid}
                    onCloseModal={handleCloseModal}
                  />
                ) : selectedItemId && !selectedPluginAvailable ? (
                  <div className="flex h-full min-h-[260px] items-center justify-center rounded-xl border border-border bg-surface-low/20 p-6 text-center">
                    <div>
                      <p className="text-sm font-medium text-foreground">Integration unavailable</p>
                      <p className="mt-1 text-xs text-text-muted">This agent&apos;s SDK does not expose that integration.</p>
                      <button
                        type="button"
                        onClick={handleBackToGrid}
                        className="mt-4 rounded-lg border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground"
                      >
                        Back to integrations
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-5xl space-y-6 pb-8">
                    <section className="space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h4 className="text-sm font-semibold text-foreground">Active for {agentName || "this agent"}</h4>
                          <p className="mt-0.5 text-xs text-text-muted">
                            Connected integrations from the current SDK schema.
                          </p>
                        </div>
                        <span className="text-xs text-text-muted">{activePlugins.length} active</span>
                      </div>
                      {activePlugins.length > 0 ? (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          {activePlugins.slice(0, 4).map((plugin) => (
                            <IntegrationDirectoryCard
                              key={plugin.id}
                              plugin={plugin}
                              config={config}
                              compact
                              onClick={() => setSelectedItemId(plugin.id)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-border bg-surface-low/20 px-4 py-4 text-sm text-text-muted">
                          No active integrations yet. Pick one below to connect it.
                        </div>
                      )}
                    </section>

                    <div className="flex flex-col gap-3 border-t border-border pt-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <FilterPill
                          active={activeFilter === "all"}
                          label="All"
                          count={availablePlugins.length}
                          icon={Sparkles}
                          onClick={() => handleFilterChange("all")}
                        />
                        {DIRECTORY_SECTIONS.map((section) => {
                          const count = sectionCounts.get(section.id) ?? 0;
                          if (count === 0 && activeFilter !== section.id) return null;
                          return (
                            <FilterPill
                              key={section.id}
                              active={activeFilter === section.id}
                              label={section.label}
                              count={count}
                              icon={section.icon}
                              onClick={() => handleFilterChange(section.id)}
                            />
                          );
                        })}
                      </div>
                      <div className="relative max-w-sm">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          placeholder="Search integrations..."
                          className="h-9 w-full rounded-lg border border-border bg-surface-low/40 pl-9 pr-3 text-sm text-foreground placeholder:text-text-muted outline-none transition-colors focus:border-[#38D39F]/60"
                        />
                      </div>
                    </div>

                    {sectionedPlugins.length > 0 ? (
                      <div className="space-y-8">
                        {sectionedPlugins.map((section) => (
                          <section key={section.id} className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <h4 className="text-sm font-semibold text-foreground">{section.label}</h4>
                                <p className="mt-0.5 text-xs text-text-muted">{section.description}</p>
                              </div>
                              <span className="text-xs text-text-muted">{section.plugins.length}</span>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                              {section.plugins.map((plugin) => (
                                <IntegrationDirectoryCard
                                  key={plugin.id}
                                  plugin={plugin}
                                  config={config}
                                  onClick={() => setSelectedItemId(plugin.id)}
                                />
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-border bg-surface-low/20 px-4 py-8 text-center text-sm text-text-muted">
                        No SDK integrations match this filter.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
