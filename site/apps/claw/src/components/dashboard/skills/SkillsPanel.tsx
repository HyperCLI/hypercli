"use client";

import * as React from "react";
import type { AgentSkillCreateRequest } from "@hypercli.com/sdk/skills";
import { Plus, Search, Settings2, TestTube2, Upload } from "lucide-react";
import { Button, Switch, toast } from "@hypercli/shared-ui";
import {
  SkillCard,
  SkillCategoryFilter,
  SkillsEmptyState,
  type SkillCardOrigin,
} from "@hypercli/shared-ui/skills";

import { AgentLoadingState } from "../agents/page-helpers";
import { getAgentGatewayPanelBootStatus } from "../agents/chat-boot-stage";
import { SkillDetail } from "./SkillDetail";
import type { SkillResourceOperations } from "./SkillFilesPanel";
import { SkillMarkdown } from "./SkillMarkdown";
import { SkillsCreateModal } from "./SkillsCreateModal";
import { SkillsImportModal } from "./SkillsImportModal";
import { SkillsLoadingState } from "./SkillsLoadingState";
import { buildSkillGenerationPrompt, parseGeneratedSkillDraft, skillSlugFromName, type SkillGeneratedOutput, type SkillImportItem } from "./skill-authoring";
import {
  formatSkillRequirement,
  getSkillConfigEntry,
  skillCardForRow,
  statusForSkill,
  type SkillConfigEntry,
  type SkillListRow,
  type SkillStatus,
  type SkillStatusFilter,
} from "./skill-model";
import { applySkillDocument, parseSkillFile, type AgentSkill } from "./provider-skills";

const SKILL_STATUS_FILTERS: Array<{ id: SkillStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "disabled", label: "Disabled" },
  { id: "needs-setup", label: "Needs setup" },
  { id: "blocked", label: "Blocked" },
  { id: "preview", label: "Preview" },
];

const SKILL_ORIGIN_LABELS: Record<SkillListRow["origin"], string> = {
  "built-in": "Built-in",
  extension: "Extension",
  registry: "Registry",
  custom: "Custom",
  unknown: "Unknown",
  created: "Created",
  imported: "Imported",
};

function generatedSkillToAgentSkill(skill: SkillGeneratedOutput): AgentSkill {
  return {
    ...parseSkillFile(skill.id, `/local-preview/skills/${skill.id}/SKILL.md`, skill.content, []),
    origin: "created",
    editable: true,
    persistent: false,
    localPreview: true,
    localDirectories: [],
    contentLoaded: true,
    resourcesAvailable: true,
    resourceAccess: "read-only",
  };
}

function importItemToAgentSkill(item: SkillImportItem): AgentSkill {
  const fallbackId = skillSlugFromName(item.name.replace(/\.(md|txt)$/i, "")) || "imported-skill";
  const initialContent = item.content || `# ${item.name}\n`;
  const initial = parseSkillFile(fallbackId, `/local-preview/skills/${fallbackId}/SKILL.md`, initialContent, []);
  const id = skillSlugFromName(initial.name) || fallbackId;
  const frontmatterMatch = initialContent.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const existingFrontmatter = frontmatterMatch?.[1] ?? "";
  const importedDescription = JSON.stringify(`Imported skill from ${item.name}.`);
  const additions = [
    !/^\s*["']?name["']?\s*:/mi.test(existingFrontmatter) ? `name: ${id}` : null,
    !/^\s*["']?description["']?\s*:/mi.test(existingFrontmatter) ? `description: ${importedDescription}` : null,
  ].filter(Boolean);
  const content = frontmatterMatch
    ? `---\n${[...additions, existingFrontmatter].filter(Boolean).join("\n")}\n---\n${initialContent.slice(frontmatterMatch[0].length)}`
    : `---\nname: ${id}\ndescription: ${importedDescription}\n---\n${initialContent}`;
  return {
    ...parseSkillFile(id, `/local-preview/skills/${id}/SKILL.md`, content, []),
    origin: "imported",
    editable: true,
    persistent: false,
    localPreview: true,
    localDirectories: [],
    contentLoaded: true,
    resourcesAvailable: true,
    resourceAccess: "read-only",
  };
}

export interface SkillsPanelProps {
  agentName?: string | null;
  connected: boolean;
  isDesktopViewport?: boolean;
  installedSkills: AgentSkill[];
  loading: boolean;
  error: string | null;
  requestedSkillId?: string | null;
  onUpdateSkill?: (skillId: string, update: { enabled?: boolean; env?: Record<string, string> }) => Promise<void>;
  onLoadSkillDocument?: (skillId: string) => Promise<unknown>;
  skillResourceOperations?: SkillResourceOperations;
  onCreateSkill?: (request: AgentSkillCreateRequest) => Promise<unknown>;
  onRefreshSkills?: () => Promise<AgentSkill[]>;
  onGenerateSkill?: (prompt: string, options: { signal: AbortSignal; timeoutMs: number; maxResponseChars: number }) => Promise<string>;
  onTestSkill: (skill: AgentSkill) => Promise<void> | void;
}

export function SkillsPanel({
  agentName,
  connected,
  isDesktopViewport = true,
  installedSkills,
  loading,
  error,
  requestedSkillId,
  onUpdateSkill,
  onLoadSkillDocument,
  skillResourceOperations,
  onCreateSkill,
  onRefreshSkills,
  onGenerateSkill,
  onTestSkill,
}: SkillsPanelProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<SkillStatusFilter>("all");
  const [selectedFilters, setSelectedFilters] = React.useState<string[]>([]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [selectedSkillId, setSelectedSkillId] = React.useState<string | null>(null);
  const [dismissedRequestedSkillId, setDismissedRequestedSkillId] = React.useState<string | null>(null);
  const [configOverrides, setConfigOverrides] = React.useState<Record<string, SkillConfigEntry>>({});
  const [localStatuses, setLocalStatuses] = React.useState<Record<string, SkillStatus>>({});
  const [localOrigins, setLocalOrigins] = React.useState<Record<string, SkillCardOrigin>>({});
  const [togglingSkillId, setTogglingSkillId] = React.useState<string | null>(null);
  const [localSkills, setLocalSkills] = React.useState<AgentSkill[]>([]);
  const [installedSkillEdits, setInstalledSkillEdits] = React.useState<Record<string, AgentSkill>>({});
  const scopeLabel = agentName?.trim() || "this agent";

  const effectiveInstalledSkills = React.useMemo(
    () => installedSkills.map((skill) => installedSkillEdits[skill.id] ?? skill),
    [installedSkillEdits, installedSkills],
  );

  const skillRows = React.useMemo<SkillListRow[]>(() => [
    ...effectiveInstalledSkills.map((skill) => {
      const entry = getSkillConfigEntry(skill.id, configOverrides);
      return {
        skill,
        origin: skill.origin ?? "unknown",
        requirement: formatSkillRequirement(skill, entry),
        status: statusForSkill(skill, configOverrides),
      };
    }),
    ...localSkills.map((skill) => ({
      skill,
      origin: localOrigins[skill.id] ?? "created",
        requirement: "Local only - not installed on the agent",
      status: localStatuses[skill.id] ?? "preview",
      localPreview: true,
    })),
  ], [configOverrides, effectiveInstalledSkills, localOrigins, localSkills, localStatuses]);

  const counts = React.useMemo(() => skillRows.reduce(
    (result, row) => {
      result[row.status] += 1;
      return result;
    },
    { active: 0, disabled: 0, "needs-setup": 0, blocked: 0, preview: 0 } as Record<SkillStatus, number>,
  ), [skillRows]);

  const skillFilterOptions = React.useMemo(() => {
    const originCounts = new Map<SkillListRow["origin"], number>();
    const categoryCounts = new Map<string, number>();
    skillRows.forEach((row) => {
      originCounts.set(row.origin, (originCounts.get(row.origin) ?? 0) + 1);
      categoryCounts.set(row.skill.category, (categoryCounts.get(row.skill.category) ?? 0) + 1);
    });
    const origins = Array.from(originCounts, ([origin, count]) => ({ id: `origin:${origin}`, label: SKILL_ORIGIN_LABELS[origin], count, group: "Source" }));
    const categories = Array.from(categoryCounts, ([category, count]) => ({ id: `category:${category}`, label: category, count, group: "Category" }));
    return [...origins.sort((a, b) => a.label.localeCompare(b.label)), ...categories.sort((a, b) => a.label.localeCompare(b.label))];
  }, [skillRows]);

  const filteredRows = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const selectedOrigins = selectedFilters.filter((id) => id.startsWith("origin:"));
    const selectedSkillCategories = selectedFilters.filter((id) => id.startsWith("category:"));
    return skillRows.filter((row) => {
      const { skill } = row;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (selectedOrigins.length > 0 && !selectedOrigins.includes(`origin:${row.origin}`)) return false;
      if (selectedSkillCategories.length > 0 && !selectedSkillCategories.includes(`category:${skill.category}`)) return false;
      if (!query) return true;
      return (
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.id.toLowerCase().includes(query) ||
        skill.category.toLowerCase().includes(query) ||
        skill.requiresEnv.some((env) => env.toLowerCase().includes(query)) ||
        skill.requiresBins.some((bin) => bin.toLowerCase().includes(query)) ||
        skill.os.some((os) => os.toLowerCase().includes(query))
      );
    });
  }, [searchQuery, selectedFilters, skillRows, statusFilter]);

  const selectedById = selectedSkillId ? skillRows.find((row) => row.skill.id === selectedSkillId) ?? null : null;
  const selectedByRequest = requestedSkillId && requestedSkillId !== dismissedRequestedSkillId
    ? skillRows.find((row) => row.skill.id === requestedSkillId) ?? null
    : null;
  const selectedRow = selectedById ?? selectedByRequest;
  const selectedConfig = selectedRow ? getSkillConfigEntry(selectedRow.skill.id, configOverrides) : { env: {} };
  const filterOptions = SKILL_STATUS_FILTERS.map((filter) => ({
    ...filter,
    count: filter.id === "all" ? skillRows.length : counts[filter.id],
  }));

  const resetFilters = () => {
    setStatusFilter("all");
    setSelectedFilters([]);
    setSearchQuery("");
  };

  const handleCreate = async (generated: SkillGeneratedOutput) => {
    if ([...effectiveInstalledSkills, ...localSkills].some((skill) => skill.id === generated.id)) throw new Error(`A skill named "${generated.id}" already exists.`);
    const skill = generatedSkillToAgentSkill(generated);
    setLocalSkills((current) => [skill, ...current.filter((item) => item.id !== skill.id)]);
    setLocalStatuses((current) => ({ ...current, [skill.id]: "preview" }));
    setLocalOrigins((current) => ({ ...current, [skill.id]: "created" }));
    resetFilters();
  };

  const handleImport = async (items: SkillImportItem[]) => {
    const imported = items.map(importItemToAgentSkill);
    const knownIds = new Set([...effectiveInstalledSkills, ...localSkills].map((skill) => skill.id));
    for (const skill of imported) {
      if (knownIds.has(skill.id)) throw new Error(`A skill named "${skill.id}" already exists.`);
      knownIds.add(skill.id);
    }
    setLocalSkills((current) => [...imported, ...current]);
    setLocalStatuses((current) => ({ ...current, ...Object.fromEntries(imported.map((skill) => [skill.id, "preview" as const])) }));
    setLocalOrigins((current) => ({ ...current, ...Object.fromEntries(imported.map((skill) => [skill.id, "imported" as const])) }));
    resetFilters();
  };

  const handleTest = async (skill: AgentSkill) => {
    try {
      await onTestSkill(skill);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : `Could not test ${skill.name}.`);
    }
  };

  const handleToggle = async (row: SkillListRow, enabled: boolean) => {
    if (togglingSkillId) return;
    if (row.localPreview) {
      setLocalStatuses((current) => ({ ...current, [row.skill.id]: enabled ? "active" : "disabled" }));
      toast.success(`${row.skill.name} ${enabled ? "active" : "disabled"} for this session.`);
      return;
    }
    setTogglingSkillId(row.skill.id);
    try {
      if (!onUpdateSkill) throw new Error("Skill configuration is unavailable for this agent.");
      const entry = getSkillConfigEntry(row.skill.id, configOverrides);
      await onUpdateSkill(row.skill.id, { enabled, env: entry.env ?? {} });
      setConfigOverrides((current) => ({ ...current, [row.skill.id]: { ...current[row.skill.id], enabled, env: entry.env } }));
      toast.success(`${row.skill.name} ${enabled ? "activated" : "disabled"}.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : `Could not ${enabled ? "activate" : "disable"} ${row.skill.name}.`);
    } finally {
      setTogglingSkillId(null);
    }
  };

  const handleContentSaved = (skillId: string, content: string) => {
    const update = (skill: AgentSkill) => {
      return applySkillDocument(skill, content);
    };
    setLocalSkills((current) => current.map((skill) => skill.id === skillId ? update(skill) : skill));
    const installed = effectiveInstalledSkills.find((skill) => skill.id === skillId);
    if (installed) setInstalledSkillEdits((current) => ({ ...current, [skillId]: update(installed) }));
  };

  const handleLocalDirectoryCreated = (skillId: string, path: string) => {
    setLocalSkills((current) => current.map((skill) => {
      if (skill.id !== skillId) return skill;
      const directories = skill.localDirectories ?? [];
      return directories.includes(path)
        ? skill
        : { ...skill, localDirectories: [...directories, path].sort() };
    }));
  };

  const persistLocalSkills = async (requestedSkills: AgentSkill[]) => {
    if (!onCreateSkill) throw new Error("Saving skills to this agent is unavailable.");
    const localById = new Map(localSkills.map((skill) => [skill.id, skill]));
    const pending = requestedSkills
      .filter((skill) => localById.has(skill.id))
      .map((skill) => ({ ...localById.get(skill.id)!, content: skill.content }));
    if (pending.length === 0) return;

    const outcomes = await Promise.allSettled(pending.map((skill) => onCreateSkill({
      id: skill.id,
      content: skill.content,
      directories: skill.localDirectories,
    })));
    const savedIds = new Set(pending.filter((_, index) => outcomes[index]?.status === "fulfilled").map((skill) => skill.id));
    if (savedIds.size > 0) {
      try {
        await onRefreshSkills?.();
      } catch {
        toast.error("The skills were saved, but the catalog could not be refreshed. Reload to see them.");
      }
      setLocalSkills((current) => current.filter((skill) => !savedIds.has(skill.id)));
      setLocalStatuses((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !savedIds.has(id))));
      setLocalOrigins((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !savedIds.has(id))));
    }

    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    if (failures.length > 0) {
      const firstMessage = failures[0]?.reason instanceof Error ? failures[0].reason.message : "A skill could not be saved.";
      throw new Error(savedIds.size > 0 ? `${savedIds.size} saved; ${failures.length} failed. ${firstMessage}` : firstMessage);
    }
  };

  const handleSaveContent = async (row: SkillListRow, content: string) => {
    if (!row.localPreview) {
      if (row.skill.resourceAccess !== "read-write" || !skillResourceOperations?.writeResource) {
        throw new Error("Editing skill instructions is unavailable for this agent.");
      }
      await skillResourceOperations.writeResource(row.skill.id, "SKILL.md", new TextEncoder().encode(content));
    }
    handleContentSaved(row.skill.id, content);
  };

  if (!connected) {
    const bootStatus = getAgentGatewayPanelBootStatus({
      connected,
      loading: false,
      loadingTitle: "Loading skills",
      loadingDetail: `Reading available skills for ${scopeLabel}.`,
      connectingDetail: "Opening the skills workspace.",
      waitingDetail: "Start the agent gateway to manage skills.",
    });
    return <div className="h-full min-h-0 bg-background"><AgentLoadingState bootStatus={bootStatus ?? undefined} /></div>;
  }

  if (selectedRow) {
    return (
      <SkillDetail
        key={selectedRow.skill.id}
        row={selectedRow}
        configEntry={selectedConfig}
        onBack={() => { setSelectedSkillId(null); if (requestedSkillId) setDismissedRequestedSkillId(requestedSkillId); }}
        onTest={() => { void handleTest(selectedRow.skill); }}
        onUpdateSkill={onUpdateSkill}
        onLoadDocument={onLoadSkillDocument ? () => onLoadSkillDocument(selectedRow.skill.id) : undefined}
        onSaveContent={(content) => handleSaveContent(selectedRow, content)}
        connected={connected}
        isDesktopViewport={isDesktopViewport}
        resourceOperations={skillResourceOperations}
        onSkillContentChanged={(content) => handleContentSaved(selectedRow.skill.id, content)}
        onLocalDirectoryCreated={(path) => handleLocalDirectoryCreated(selectedRow.skill.id, path)}
        onSaveToAgent={selectedRow.localPreview && onCreateSkill ? (content) => persistLocalSkills([{ ...selectedRow.skill, content }]) : undefined}
        onConfigured={(skillId, entry) => setConfigOverrides((current) => ({ ...current, [skillId]: entry }))}
      />
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-5 sm:py-5">
        <div className="space-y-4">
          <div className="flex flex-row gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-[19px] font-semibold leading-tight text-foreground">Skills</h2>
              <p className="mt-2 max-w-2xl text-[13px] leading-snug text-text-muted">Skills are instruction packs that teach your agent how and when to use tools.</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)} className="min-h-9 hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high"><Upload className="h-3.5 w-3.5" />Import</Button>
              <Button type="button" size="sm" onClick={() => setCreateOpen(true)} className="min-h-9"><Plus className="h-3.5 w-3.5" />Create Skill</Button>
            </div>
          </div>

          <label className="relative block">
            <span className="sr-only">Search skills</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input type="text" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search skills..." className="h-10 w-full rounded-xl border border-border bg-surface-low/35 pl-10 pr-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
          </label>

          <div className="flex flex-wrap items-center gap-1.5">
            {filterOptions.map((filter) => {
              const active = statusFilter === filter.id;
              return <button key={filter.id} type="button" onClick={() => setStatusFilter(filter.id)} className={`h-6 rounded-full px-2.5 text-[10px] font-semibold transition-colors ${active ? "bg-surface-high text-foreground" : "text-text-muted hover:bg-surface-low hover:text-foreground"}`}>{filter.label} ({filter.count})</button>;
            })}
            <div className="ml-auto flex items-center"><SkillCategoryFilter options={skillFilterOptions} selectedIds={selectedFilters} onSelectedIdsChange={setSelectedFilters} totalCount={skillRows.length} /></div>
          </div>

          {loading ? (
            <SkillsLoadingState className="rounded-2xl border border-border bg-surface-low/25" />
          ) : error ? (
            <div className="rounded-2xl border border-border bg-surface-low/25 px-5 py-10 text-center text-sm text-text-muted">{error}</div>
          ) : filteredRows.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredRows.map((row) => (
                <SkillCard
                  key={row.skill.id}
                  skill={skillCardForRow(row)}
                  control={row.status !== "preview" && (row.localPreview || onUpdateSkill) ? <span onClick={(event) => event.stopPropagation()}><Switch checked={row.status !== "disabled"} disabled={togglingSkillId !== null} onCheckedChange={(enabled) => void handleToggle(row, enabled)} aria-label={`${row.status !== "disabled" ? "Disable" : "Activate"} ${row.skill.name} skill`} /></span> : undefined}
                  actions={(
                    <div className="flex flex-nowrap justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
                      <Button type="button" variant="outline" size="sm" className="h-7 min-h-0 gap-1 px-2 text-[10px] hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high" onClick={(event) => { event.stopPropagation(); void handleTest(row.skill); }}><TestTube2 className="h-3 w-3" />Test</Button>
                      <Button type="button" variant="secondary" size="sm" className="h-7 min-h-0 gap-1 px-2 text-[10px] hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high" onClick={(event) => { event.stopPropagation(); setSelectedSkillId(row.skill.id); }}><Settings2 className="h-3 w-3" />{row.skill.editable ? "Configure" : "View details"}</Button>
                    </div>
                  )}
                />
              ))}
            </div>
          ) : (
            <SkillsEmptyState title={localSkills.length > 0 || effectiveInstalledSkills.length > 0 ? "No skills match your filters." : "No app skills found."} detail={localSkills.length > 0 || effectiveInstalledSkills.length > 0 ? "Try another status, category, or search term." : "Create or import a local preview to get started."} />
          )}
        </div>
      </div>

      <SkillsCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={handleCreate}
        notice="Review the draft locally, then save it to the agent or keep it as a browser-only preview."
        renderPreview={(content) => <SkillMarkdown content={content} />}
        confirmationDescription="Save it to the agent, start a related test in a new chat, or keep it as a browser-only preview."
        activateLabel="Save to agent"
        onGenerate={onGenerateSkill ? async (description, signal) => parseGeneratedSkillDraft(await onGenerateSkill(buildSkillGenerationPrompt(description), { signal, timeoutMs: 120_000, maxResponseChars: 128 * 1024 })) : undefined}
        onActivate={(generated) => persistLocalSkills([generatedSkillToAgentSkill(generated)])}
        onTest={(generated) => handleTest(generatedSkillToAgentSkill(generated))}
        onKeepPreview={(generated) => { setLocalStatuses((current) => ({ ...current, [generated.id]: "preview" })); toast.success(`${generated.name} kept as a local preview.`); }}
      />
      <SkillsImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
        renderPreview={(content) => <SkillMarkdown content={content} />}
        confirmationDescription="Save the imported skills to the agent, start a related test in a new chat, or keep them as browser-only previews."
        activateLabel="Save to agent"
        onActivate={(items) => persistLocalSkills(items.map(importItemToAgentSkill))}
        onTest={(items) => { const skill = items[0] ? importItemToAgentSkill(items[0]) : null; if (skill) return handleTest(skill); }}
        onKeepPreview={(items) => { const ids = items.map((item) => importItemToAgentSkill(item).id); setLocalStatuses((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, "preview" as const])) })); toast.success(`${items.length === 1 ? "Skill" : `${items.length} skills`} kept as local preview.`); }}
      />
    </div>
  );
}
