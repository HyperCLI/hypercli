"use client";

import * as React from "react";
import type {
  AgentSkillCreateRequest,
  AgentSkillProposalInspection,
  AgentSkillProposalSummary,
  AgentSkillRecoverRequest,
  AgentSkillRecoverResult,
  AgentSkillRecoveryCandidate,
} from "@hypercli.com/sdk/skills";
import { FileClock, FolderInput, Plus, Settings2, TestTube2, Upload } from "lucide-react";
import { Button, CatalogFilterButton, CatalogFilterGroup, CatalogHeader, RecoveryDetails, Switch, toast } from "@hypercli/shared-ui";
import {
  SkillCard,
  SkillsEmptyState,
} from "@hypercli/shared-ui/skills";

import { AgentLoadingState } from "../agents/page-helpers";
import { getAgentGatewayPanelBootStatus } from "../agents/chat-boot-stage";
import { SkillDetail } from "./SkillDetail";
import { SkillProposalDetail } from "./SkillProposalDetail";
import type { SkillResourceOperations } from "./SkillFilesPanel";
import { SkillMarkdown } from "./SkillMarkdown";
import { SkillsCreateModal } from "./SkillsCreateModal";
import { SkillsImportModal } from "./SkillsImportModal";
import { SkillsLoadingState } from "./SkillsLoadingState";
import { SkillsRecoveryModal } from "./SkillsRecoveryModal";
import { type SkillDraftRecord, type SkillDraftScope } from "./skill-draft-store";
import { useSkillDrafts } from "./useSkillDrafts";
import { buildSkillGenerationPrompt, parseGeneratedSkillDraft, skillSlugFromName, type SkillGeneratedOutput, type SkillImportItem } from "./skill-authoring";
import {
  formatSkillRequirement,
  getSkillConfigEntry,
  skillCardForRow,
  statusForSkill,
  type SkillConfigEntry,
  type SkillListRow,
} from "./skill-model";
import { applySkillDocument, parseSkillFile, type AgentSkill } from "./provider-skills";

const SKILL_ORIGIN_LABELS: Record<SkillListRow["origin"], string> = {
  "built-in": "Built-in",
  extension: "Extension",
  registry: "Registry",
  custom: "My skills",
  unknown: "Unknown",
  created: "My skills",
  imported: "My skills",
};

const MY_SKILL_ORIGINS = new Set<SkillListRow["origin"]>(["custom", "created", "imported"]);
const MY_SKILLS_FILTER_ID = "source:my-skills";
const HYPERCLI_SKILLS_FILTER_ID = "source:hypercli";
const SKILL_SOURCE_ORDER = new Map<string, number>([
  [MY_SKILLS_FILTER_ID, 0],
  [HYPERCLI_SKILLS_FILTER_ID, 1],
]);

function isHyperCliSkill(skill: Pick<AgentSkill, "id">): boolean {
  return skill.id === "hypercli" || skill.id.startsWith("hypercli-");
}

function skillSourceFilterId(row: SkillListRow): string {
  if (isHyperCliSkill(row.skill)) return HYPERCLI_SKILLS_FILTER_ID;
  return MY_SKILL_ORIGINS.has(row.origin) ? MY_SKILLS_FILTER_ID : `source:${row.origin}`;
}

function skillSourceFilterLabel(row: SkillListRow): string {
  return isHyperCliSkill(row.skill) ? "HyperCLI" : SKILL_ORIGIN_LABELS[row.origin];
}

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

function storedDraftToAgentSkill(draft: SkillDraftRecord): AgentSkill {
  const parsed = parseSkillFile(
    draft.id,
    `/local-preview/skills/${draft.id}/SKILL.md`,
    draft.content,
    draft.directories.map((path) => ({ name: path.split("/").filter(Boolean).pop() || path, path, type: "directory" as const })),
  );
  return {
    ...parsed,
    origin: draft.origin,
    editable: true,
    persistent: false,
    localPreview: true,
    localDirectories: draft.directories,
    contentLoaded: true,
    resourcesAvailable: true,
    resourceAccess: "read-only",
  };
}

export interface SkillsPanelProps {
  agentName?: string | null;
  draftScope: SkillDraftScope;
  connected: boolean;
  isDesktopViewport?: boolean;
  installedSkills: AgentSkill[];
  loading: boolean;
  error: string | null;
  recoveryCandidates?: AgentSkillRecoveryCandidate[];
  recoveryError?: string | null;
  requestedSkillId?: string | null;
  onUpdateSkill?: (skillId: string, update: { enabled?: boolean; env?: Record<string, string> }) => Promise<void>;
  onLoadSkillDocument?: (skillId: string) => Promise<unknown>;
  skillResourceOperations?: SkillResourceOperations;
  onCreateSkill?: (request: AgentSkillCreateRequest) => Promise<unknown>;
  onRefreshSkills?: () => Promise<AgentSkill[]>;
  onRecoverSkill?: (request: AgentSkillRecoverRequest) => Promise<AgentSkillRecoverResult>;
  onGenerateSkill?: (prompt: string, options: { signal: AbortSignal; timeoutMs: number; maxResponseChars: number }) => Promise<string>;
  onTestSkill: (skill: AgentSkill) => Promise<void> | void;
  onRequestProductUse?: () => boolean;
  skillProposals?: AgentSkillProposalSummary[];
  skillProposalsLoading?: boolean;
  skillProposalsError?: string | null;
  canInspectSkillProposals?: boolean;
  canApplySkillProposals?: boolean;
  canRejectSkillProposals?: boolean;
  onInspectSkillProposal?: (proposalId: string) => Promise<AgentSkillProposalInspection>;
  onApplySkillProposal?: (proposalId: string, expectedRevision?: string) => Promise<unknown>;
  onRejectSkillProposal?: (proposalId: string, expectedRevision?: string) => Promise<unknown>;
  onRefreshSkillProposals?: () => Promise<unknown>;
}

export function SkillsPanel({
  agentName,
  draftScope,
  connected,
  isDesktopViewport = true,
  installedSkills,
  loading,
  error,
  recoveryCandidates = [],
  recoveryError,
  requestedSkillId,
  onUpdateSkill,
  onLoadSkillDocument,
  skillResourceOperations,
  onCreateSkill,
  onRefreshSkills,
  onRecoverSkill,
  onGenerateSkill,
  onTestSkill,
  onRequestProductUse,
  skillProposals = [],
  skillProposalsLoading = false,
  skillProposalsError,
  canInspectSkillProposals = false,
  canApplySkillProposals = false,
  canRejectSkillProposals = false,
  onInspectSkillProposal,
  onApplySkillProposal,
  onRejectSkillProposal,
  onRefreshSkillProposals,
}: SkillsPanelProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedFilters, setSelectedFilters] = React.useState<string[]>([MY_SKILLS_FILTER_ID]);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [recoveryCandidateId, setRecoveryCandidateId] = React.useState<string | null>(null);
  const [dismissedRecoveryCandidateIds, setDismissedRecoveryCandidateIds] = React.useState<string[]>([]);
  const [selectedSkillId, setSelectedSkillId] = React.useState<string | null>(null);
  const [selectedProposalId, setSelectedProposalId] = React.useState<string | null>(null);
  const [dismissedRequestedSkillId, setDismissedRequestedSkillId] = React.useState<string | null>(null);
  const [configOverrides, setConfigOverrides] = React.useState<Record<string, SkillConfigEntry>>({});
  const [togglingSkillId, setTogglingSkillId] = React.useState<string | null>(null);
  const [installedSkillEdits, setInstalledSkillEdits] = React.useState<Record<string, AgentSkill>>({});
  const skillDrafts = useSkillDrafts(draftScope);
  const localSkills = React.useMemo(() => skillDrafts.drafts.map(storedDraftToAgentSkill), [skillDrafts.drafts]);
  const scopeLabel = agentName?.trim() || "this agent";
  const allowProductUse = () => onRequestProductUse?.() ?? true;
  const visibleRecoveryCandidates = recoveryCandidates.filter((candidate) => !dismissedRecoveryCandidateIds.includes(candidate.id));
  const recoveryCandidate = visibleRecoveryCandidates.find((candidate) => candidate.id === recoveryCandidateId) ?? null;

  const effectiveInstalledSkills = React.useMemo(
    () => installedSkills.map((skill) => installedSkillEdits[skill.id] ?? skill),
    [installedSkillEdits, installedSkills],
  );
  const visibleInstalledSkills = React.useMemo(
    () => effectiveInstalledSkills.filter((skill) => (
      skill.origin !== "built-in" || isHyperCliSkill(skill)
    )),
    [effectiveInstalledSkills],
  );

  const skillRows = React.useMemo<SkillListRow[]>(() => [
    ...visibleInstalledSkills.map((skill) => {
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
      origin: skill.origin === "imported" ? "imported" as const : "created" as const,
      requirement: "Local only - not installed on the agent",
      status: "preview" as const,
      localPreview: true,
    })),
  ], [configOverrides, localSkills, visibleInstalledSkills]);

  const skillFilterOptions = React.useMemo(() => {
    const sourceCounts = new Map<string, { label: string; count: number }>([
      [MY_SKILLS_FILTER_ID, { label: "My skills", count: skillProposals.length }],
    ]);
    const categoryCounts = new Map<string, number>();
    skillRows.forEach((row) => {
      const id = skillSourceFilterId(row);
      const current = sourceCounts.get(id);
      sourceCounts.set(id, { label: skillSourceFilterLabel(row), count: (current?.count ?? 0) + 1 });
      categoryCounts.set(row.skill.category, (categoryCounts.get(row.skill.category) ?? 0) + 1);
    });
    const sources = Array.from(sourceCounts, ([id, option]) => ({ id, ...option, group: "Source" }));
    const categories = Array.from(categoryCounts, ([category, count]) => ({ id: `category:${category}`, label: category, count, group: "Category" }));
    return [
      ...sources.sort((a, b) => (SKILL_SOURCE_ORDER.get(a.id) ?? 2) - (SKILL_SOURCE_ORDER.get(b.id) ?? 2) || a.label.localeCompare(b.label)),
      ...categories.sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [skillProposals.length, skillRows]);

  const filteredRows = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const selectedSources = selectedFilters.filter((id) => id.startsWith("source:"));
    const selectedSkillCategories = selectedFilters.filter((id) => id.startsWith("category:"));
    return skillRows.filter((row) => {
      const { skill } = row;
      if (selectedSources.length > 0 && !selectedSources.includes(skillSourceFilterId(row))) return false;
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
  }, [searchQuery, selectedFilters, skillRows]);
  const filteredProposals = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const selectedSources = selectedFilters.filter((id) => id.startsWith("source:"));
    const selectedSkillCategories = selectedFilters.filter((id) => id.startsWith("category:"));
    if (selectedSources.length > 0 && !selectedSources.includes(MY_SKILLS_FILTER_ID)) return [];
    if (selectedSkillCategories.length > 0) return [];
    if (!query) return skillProposals;
    return skillProposals.filter((proposal) => (
      proposal.skillName.toLowerCase().includes(query) ||
      proposal.description.toLowerCase().includes(query) ||
      proposal.id.toLowerCase().includes(query)
    ));
  }, [searchQuery, selectedFilters, skillProposals]);
  const hasMySkills = skillProposals.length > 0 || skillRows.some((row) => skillSourceFilterId(row) === MY_SKILLS_FILTER_ID);
  const showFirstSkillInvitation = !hasMySkills
    && selectedFilters.length === 1
    && selectedFilters[0] === MY_SKILLS_FILTER_ID
    && searchQuery.trim().length === 0;

  const selectedById = selectedSkillId ? skillRows.find((row) => row.skill.id === selectedSkillId) ?? null : null;
  const selectedByRequest = requestedSkillId && requestedSkillId !== dismissedRequestedSkillId
    ? skillRows.find((row) => row.skill.id === requestedSkillId) ?? null
    : null;
  const selectedRow = selectedById ?? selectedByRequest;
  const selectedProposal = selectedProposalId
    ? skillProposals.find((proposal) => proposal.id === selectedProposalId) ?? null
    : null;
  const selectedConfig = selectedRow ? getSkillConfigEntry(selectedRow.skill.id, configOverrides) : { env: {} };
  const resetFilters = () => {
    setSelectedFilters([MY_SKILLS_FILTER_ID]);
    setSearchQuery("");
  };

  const handleCreate = async (generated: SkillGeneratedOutput) => {
    if ([...effectiveInstalledSkills, ...localSkills].some((skill) => skill.id === generated.id)) throw new Error(`A skill named "${generated.id}" already exists.`);
    const skill = generatedSkillToAgentSkill(generated);
    await skillDrafts.save({ id: skill.id, origin: "created", content: skill.content, directories: skill.localDirectories ?? [] });
    resetFilters();
  };

  const handleImport = async (items: SkillImportItem[]) => {
    const imported = items.map(importItemToAgentSkill);
    const knownIds = new Set([...effectiveInstalledSkills, ...localSkills].map((skill) => skill.id));
    for (const skill of imported) {
      if (knownIds.has(skill.id)) throw new Error(`A skill named "${skill.id}" already exists.`);
      knownIds.add(skill.id);
    }
    for (const skill of imported) {
      await skillDrafts.save({ id: skill.id, origin: "imported", content: skill.content, directories: skill.localDirectories ?? [] });
    }
    resetFilters();
  };

  const handleTest = async (skill: AgentSkill) => {
    if (!allowProductUse()) return false;
    try {
      await onTestSkill(skill);
      return true;
    } catch {
      toast.warning(`The ${skill.name} test did not start. Check the agent connection and try again.`);
      return false;
    }
  };

  const handleToggle = async (row: SkillListRow, enabled: boolean) => {
    if (togglingSkillId) return;
    if (row.localPreview) {
      toast.info("Save this draft to the agent before changing whether it is active.");
      return;
    }
    if (enabled && !allowProductUse()) return;
    setTogglingSkillId(row.skill.id);
    try {
      if (!onUpdateSkill) throw new Error("Skill configuration is unavailable for this agent.");
      const entry = getSkillConfigEntry(row.skill.id, configOverrides);
      await onUpdateSkill(row.skill.id, { enabled, env: entry.env ?? {} });
      setConfigOverrides((current) => ({ ...current, [row.skill.id]: { ...current[row.skill.id], enabled, env: entry.env } }));
      toast.success(`${row.skill.name} ${enabled ? "activated" : "disabled"}.`);
    } catch {
      toast.warning(`${row.skill.name} was not ${enabled ? "activated" : "disabled"}. Reconnect the agent and try again.`);
    } finally {
      setTogglingSkillId(null);
    }
  };

  const handleContentSaved = async (skillId: string, content: string) => {
    const update = (skill: AgentSkill) => {
      return applySkillDocument(skill, content);
    };
    const local = localSkills.find((skill) => skill.id === skillId);
    if (local) await skillDrafts.save({ id: local.id, origin: local.origin === "imported" ? "imported" : "created", content, directories: local.localDirectories ?? [] });
    const installed = effectiveInstalledSkills.find((skill) => skill.id === skillId);
    if (installed) setInstalledSkillEdits((current) => ({ ...current, [skillId]: update(installed) }));
  };

  const handleLocalDirectoryCreated = async (skillId: string, path: string) => {
    const local = localSkills.find((skill) => skill.id === skillId);
    if (!local) return;
    const directories = local.localDirectories ?? [];
    if (directories.includes(path)) return;
    await skillDrafts.save({ id: local.id, origin: local.origin === "imported" ? "imported" : "created", content: local.content, directories: [...directories, path] });
  };

  const persistLocalSkills = async (requestedSkills: AgentSkill[]) => {
    if (!onCreateSkill) throw new Error("Saving skills to this agent is unavailable.");
    if (!allowProductUse()) return false;
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
        toast.warning("The skills were saved. Refresh Skills to see the latest catalog.");
      }
      for (const id of savedIds) await skillDrafts.discard(id);
    }

    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    if (failures.length > 0) {
      throw new Error(savedIds.size > 0
        ? `${savedIds.size} saved; ${failures.length} remain as local drafts. Reconnect the agent and try again.`
        : "The skills remain as local drafts. Reconnect the agent and try saving again.");
    }
    return true;
  };

  const handleSaveContent = async (row: SkillListRow, content: string) => {
    if (!row.localPreview) {
      if (!allowProductUse()) return;
      if (row.skill.resourceAccess !== "read-write" || !skillResourceOperations?.writeResource) {
        throw new Error("Editing skill instructions is unavailable for this agent.");
      }
      await skillResourceOperations.writeResource(row.skill.id, "SKILL.md", new TextEncoder().encode(content));
    }
    await handleContentSaved(row.skill.id, content);
  };

  const handleRecoverSkill = async (request: AgentSkillRecoverRequest) => {
    if (!onRecoverSkill) throw new Error("Organizing workspace skills is unavailable for this agent.");
    if (!allowProductUse()) throw new Error("Start your free trial to organize workspace skills.");
    const result = await onRecoverSkill(request);
    setDismissedRecoveryCandidateIds((current) => [...new Set([...current, request.candidateId])]);
    toast.success(`${result.skillId} moved to Skills.`);
    try {
      await onRefreshSkills?.();
    } catch {
      toast.warning("The skill was moved. Refresh Skills to see it in the catalog.");
    }
    return result;
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
        onRequestProductUse={onRequestProductUse}
         onSkillContentChanged={(content) => { void handleContentSaved(selectedRow.skill.id, content); }}
         onLocalDirectoryCreated={(path) => { void handleLocalDirectoryCreated(selectedRow.skill.id, path); }}
         onSaveToAgent={selectedRow.localPreview && onCreateSkill ? (content) => persistLocalSkills([{ ...selectedRow.skill, content }]) : undefined}
         onDiscardDraft={selectedRow.localPreview ? async () => { await skillDrafts.discard(selectedRow.skill.id); setSelectedSkillId(null); } : undefined}
        onConfigured={(skillId, entry) => setConfigOverrides((current) => ({ ...current, [skillId]: entry }))}
      />
    );
  }

  if (selectedProposal && canInspectSkillProposals && onInspectSkillProposal) {
    return (
      <SkillProposalDetail
        proposal={selectedProposal}
        canApply={canApplySkillProposals}
        canReject={canRejectSkillProposals}
        onBack={() => setSelectedProposalId(null)}
        onInspect={onInspectSkillProposal}
        onApply={onApplySkillProposal}
        onReject={onRejectSkillProposal}
        onApproved={async () => { await onRefreshSkills?.(); }}
        onRequestProductUse={onRequestProductUse}
      />
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <CatalogHeader
        title="Skills"
        description="Add capabilities your agent can use."
        actions={(
          <>
            <Button type="button" variant="outline" onClick={() => setImportOpen(true)} className="h-10 rounded-xl px-4 hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high">
              Import skill
              <Upload className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" onClick={() => setCreateOpen(true)} className="h-10 rounded-xl px-4">
              Create skill
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        )}
        filters={(
          <CatalogFilterGroup label="Filter skills">
            {skillFilterOptions.map((filter) => {
              const pressed = selectedFilters.includes(filter.id);
              return (
                <CatalogFilterButton
                  key={filter.id}
                  pressed={pressed}
                  aria-label={`${filter.label} (${filter.count})`}
                  onClick={() => setSelectedFilters((current) => current.includes(filter.id) ? current.filter((id) => id !== filter.id) : [...current, filter.id])}
                >
                  {filter.label}
                </CatalogFilterButton>
              );
            })}
            <CatalogFilterButton
              pressed={selectedFilters.length === 0}
              aria-label={`All skills (${skillRows.length + skillProposals.length})`}
              onClick={() => setSelectedFilters([])}
            >
              All
            </CatalogFilterButton>
          </CatalogFilterGroup>
        )}
        searchValue={searchQuery}
        searchLabel="Search skills"
        searchPlaceholder="Search skills..."
        onSearchValueChange={setSearchQuery}
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-5">
        <div className="space-y-4">
          {visibleRecoveryCandidates.length > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 sm:flex-row sm:items-center">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-warning/25 bg-background/65"><FolderInput className="h-4 w-4 text-warning" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">Unorganized workspace skill found</p>
                <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">Review SKILL.md and nearby files before moving them into Skills.</p>
              </div>
              <Button type="button" size="sm" onClick={() => setRecoveryCandidateId(visibleRecoveryCandidates[0]!.id)} className="shrink-0">Review files</Button>
            </div>
          )}
          {recoveryError && (
            <div className="rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              <p role="status">Workspace skill files could not be checked. Refresh Skills to try again.</p>
              <RecoveryDetails label="Technical details" technicalDetails={recoveryError} className="mt-2 text-left" />
            </div>
          )}
          {skillProposalsError && (
            <div className="rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              <p role="status">Pending skill reviews could not be loaded. Installed skills are still available.</p>
              <RecoveryDetails label="Technical details" technicalDetails={skillProposalsError} className="mt-2 text-left" />
              {onRefreshSkillProposals ? <Button type="button" variant="outline" size="sm" onClick={() => void onRefreshSkillProposals().catch(() => undefined)} className="mt-3">Retry pending reviews</Button> : null}
            </div>
          )}
          {skillProposalsLoading && !loading && <p role="status" className="text-[11px] text-text-muted">Checking for pending skill reviews...</p>}

          {loading ? (
            <SkillsLoadingState className="rounded-2xl border border-border bg-surface-low/25" />
          ) : error || skillDrafts.error ? (
            <div className="rounded-2xl border border-border bg-surface-low/25 px-5 py-10 text-center text-sm text-text-muted">
              <p role="alert" className="text-foreground">Skills are not available yet. Reconnect the agent or allow browser storage, then try again.</p>
              <RecoveryDetails label="Technical details" technicalDetails={error || undefined} className="mx-auto mt-3 max-w-xl text-left" />
              {onRefreshSkills ? <Button type="button" variant="outline" size="sm" onClick={() => void onRefreshSkills().catch(() => undefined)} className="mt-4">Refresh Skills</Button> : null}
            </div>
          ) : showFirstSkillInvitation ? (
            <section data-slot="skills-first-use" className="flex min-h-[min(520px,58dvh)] items-center justify-center px-3 py-12 text-center sm:px-8 sm:py-16">
              <div className="w-full max-w-2xl">
                <h3 className="mx-auto max-w-[19ch] text-balance text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] text-foreground sm:text-[38px]">
                  Teach it the way you like things done.
                </h3>
                <p className="mx-auto mt-4 max-w-[60ch] text-[13px] leading-5 text-text-secondary sm:text-[14px] sm:leading-6">
                  Start with one task you repeat or one standard you care about. We&apos;ll help turn that know-how into a reusable skill you can refine anytime.
                </p>
                <div className="mt-7 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
                  <Button type="button" size="sm" onClick={() => setCreateOpen(true)} className="min-h-9 justify-center px-4">
                    Create my first skill
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)} className="min-h-9 justify-center px-4 hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high">
                    Import one I already have
                  </Button>
                </div>
                <p className="mx-auto mt-5 max-w-lg text-[10px] leading-relaxed text-text-muted">
                  Not sure where to begin? Try meeting follow-ups, a review checklist, or a weekly update. Preview and test it before saving.
                </p>
              </div>
            </section>
          ) : filteredRows.length > 0 || filteredProposals.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredProposals.map((proposal) => (
                <article key={proposal.id} data-testid={`skill-proposal-${proposal.id}`} className="flex min-h-44 flex-col rounded-2xl border border-warning/30 bg-warning/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-warning/25 bg-warning/10"><FileClock className="h-4 w-4 text-warning" aria-hidden="true" /></span>
                    <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">Pending review</span>
                  </div>
                  <div className="mt-3 min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-foreground">{proposal.skillName}</h3>
                    <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-text-secondary">{proposal.description}</p>
                  </div>
                  <div className="mt-3 flex justify-end border-t border-warning/15 pt-3">
                    <Button type="button" variant="secondary" size="sm" disabled={!canInspectSkillProposals} onClick={() => setSelectedProposalId(proposal.id)} className="h-7 min-h-0 px-2 text-[10px]">Review proposal</Button>
                  </div>
                </article>
              ))}
              {filteredRows.map((row) => (
                <SkillCard
                  key={row.skill.id}
                  skill={skillCardForRow(row)}
                  showMetadata={false}
                  statusPosition="footer"
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
            <SkillsEmptyState title={localSkills.length > 0 || visibleInstalledSkills.length > 0 ? "No skills match your filters." : "No app skills found."} detail={localSkills.length > 0 || visibleInstalledSkills.length > 0 ? "Try another source, category, or search term." : "Create or import a local preview to get started."} />
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
        onGenerate={onGenerateSkill ? async (description, signal) => {
          if (!allowProductUse()) throw new Error("Start your free trial to generate a skill.");
          return parseGeneratedSkillDraft(await onGenerateSkill(buildSkillGenerationPrompt(description), { signal, timeoutMs: 120_000, maxResponseChars: 128 * 1024 }));
        } : undefined}
        onActivate={(generated) => persistLocalSkills([generatedSkillToAgentSkill(generated)])}
        onTest={(generated) => handleTest(generatedSkillToAgentSkill(generated))}
        onKeepPreview={(generated) => { toast.success(`${generated.name} kept as a local draft.`); }}
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
        onKeepPreview={(items) => { toast.success(`${items.length === 1 ? "Skill" : `${items.length} skills`} kept as ${items.length === 1 ? "a local draft" : "local drafts"}.`); }}
      />
      {recoveryCandidate && <SkillsRecoveryModal key={recoveryCandidate.id} candidate={recoveryCandidate} onClose={() => setRecoveryCandidateId(null)} onRecover={handleRecoverSkill} onRequestProductUse={onRequestProductUse} />}
    </div>
  );
}
