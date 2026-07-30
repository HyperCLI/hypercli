"use client";

/*
 * THESIS: Make agent-to-knowledge reach the home view's primary operating model, not a detached metric.
 * OWN-WORLD: One quiet, bordered field using the current surface, text, status, and selection tokens.
 * STORY: Scan the workspace, see which agents are online, then verify the knowledge each one can reach.
 * FIRST VIEWPORT: Workspace identity and actions lead into a metric rail and a joined agent/knowledge map.
 * FORM: A relational workspace atlas, extending the incumbent dashboard without changing its visual system.
 */

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useState,
} from "react";
import type {
  Workspace,
  WorkspaceFile,
  WorkspaceGrant,
  WorkspacesAPI,
} from "@hypercli.com/sdk/workspaces";
import {
  ArrowRight,
  Bot,
  FileText,
  FolderKanban,
  Library,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  UsersRound,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Progress } from "../ui/progress";
import { Skeleton } from "../ui/skeleton";
import { cn } from "../ui/utils";

type KnowledgeClient = Pick<WorkspacesAPI, "listFiles" | "listGrants">;

export type WorkspaceKnowledgeHomeAgent = {
  id: string;
  name: string;
  state: string;
  avatarUrl?: string | null;
};

export type WorkspaceKnowledgeHomeProps = {
  workspace: Workspace | null;
  workspaces: Workspace[];
  knowledgeClient: KnowledgeClient | null;
  agents: WorkspaceKnowledgeHomeAgent[];
  selectedWorkspaceAgentIds: readonly string[];
  agentsLoading?: boolean;
  agentsError?: string | null;
  workspacesLoading?: boolean;
  workspacesError?: string | null;
  agentCreationDisabledReason?: string | null;
  onOpenAgentLauncher?: () => void;
  onOpenMembers?: () => void;
  onOpenKnowledge?: (workspaceId?: string) => void;
  className?: string;
};

type KnowledgeSnapshot = {
  agentIds: string[] | null;
  fileCount: number | null;
  failedCount: number;
  processingCount: number;
  searchText: string;
};

const ACTIVE_AGENT_STATES = new Set(["active", "ready", "running"]);
const TRANSITIONAL_AGENT_STATES = new Set(["booting", "creating", "pending", "starting", "stopping"]);
const PROCESSING_FILE_STATES = new Set([
  "extracting",
  "generating",
  "indexing",
  "pending",
  "processing",
  "queued",
  "registered",
  "regenerating",
  "uploading",
]);

function workspaceName(workspace: Workspace): string {
  return workspace.displayName?.trim() || workspace.name;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

function titleizeState(value: string): string {
  const normalized = value.trim().replace(/[-_]+/g, " ");
  return normalized ? normalized.replace(/\b\w/g, (character) => character.toUpperCase()) : "Unknown";
}

function agentStateTone(state: string): string {
  const normalized = state.toLowerCase();
  if (ACTIVE_AGENT_STATES.has(normalized)) return "bg-success";
  if (TRANSITIONAL_AGENT_STATES.has(normalized)) return "bg-warning";
  if (normalized.includes("fail") || normalized.includes("error")) return "bg-destructive";
  return "bg-text-muted";
}

function fileIsFailed(file: WorkspaceFile): boolean {
  const state = `${file.fileState} ${file.uploadStatus ?? ""} ${file.processingState ?? ""}`.toLowerCase();
  return state.includes("failed") || state.includes("error");
}

function fileIsProcessing(file: WorkspaceFile): boolean {
  if (fileIsFailed(file)) return false;
  return [file.fileState, file.uploadStatus, file.processingState]
    .some((state) => state ? PROCESSING_FILE_STATES.has(state.toLowerCase()) : false);
}

function grantIsActive(grant: WorkspaceGrant, now: number): boolean {
  if (grant.revokedAt) return false;
  if (!grant.expiresAt) return true;
  const expiresAt = Date.parse(grant.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt > now;
}

function AgentAvatar({ agent, className }: { agent: WorkspaceKnowledgeHomeAgent; className?: string }) {
  return (
    <Avatar className={cn("border border-border bg-surface-high", className)} title={agent.name}>
      {agent.avatarUrl ? <AvatarImage src={agent.avatarUrl} alt={`${agent.name} avatar`} className="object-cover" /> : null}
      <AvatarFallback className="bg-surface-high text-[10px] font-semibold text-text-secondary">
        {initials(agent.name)}
      </AvatarFallback>
    </Avatar>
  );
}

function SummaryItem({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5">
      <div className="flex items-baseline gap-2">
        <span className="text-[22px] font-semibold tracking-[-0.03em] text-foreground">{value}</span>
        <span className="text-[12px] font-medium text-text-secondary">{label}</span>
      </div>
      <p className="mt-1 truncate text-[11px] text-text-muted">{detail}</p>
    </div>
  );
}

function KnowledgeRowsSkeleton() {
  return (
    <div aria-label="Loading shared knowledge" role="status">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-3 border-t border-border px-4 py-4 sm:px-5">
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-full max-w-sm" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

export function WorkspaceKnowledgeHome({
  workspace,
  workspaces,
  knowledgeClient,
  agents,
  selectedWorkspaceAgentIds,
  agentsLoading = false,
  agentsError = null,
  workspacesLoading = false,
  workspacesError = null,
  agentCreationDisabledReason = null,
  onOpenAgentLauncher,
  onOpenMembers,
  onOpenKnowledge,
  className,
}: WorkspaceKnowledgeHomeProps) {
  const titleId = useId();
  const searchId = useId();
  const creationDisabledId = useId();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [snapshots, setSnapshots] = useState<Record<string, KnowledgeSnapshot>>({});
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!knowledgeClient || workspaces.length === 0) {
      const resetTimer = window.setTimeout(() => {
        if (cancelled) return;
        setSnapshots({});
        setSnapshotsLoading(false);
        setSnapshotError(null);
      }, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(resetTimer);
      };
    }

    const loadTimer = window.setTimeout(() => {
      if (cancelled) return;
      setSnapshotsLoading(true);
      setSnapshotError(null);

      void Promise.all(workspaces.map(async (collection) => {
        const workspaceRef = collection.slug || collection.id;
        const [filesResult, grantsResult] = await Promise.allSettled([
          knowledgeClient.listFiles(workspaceRef),
          collection.role?.toLowerCase() === "admin"
            ? knowledgeClient.listGrants(workspaceRef)
            : Promise.resolve(null),
        ]);
        const files = filesResult.status === "fulfilled" ? filesResult.value : null;
        const grants = grantsResult.status === "fulfilled" ? grantsResult.value : null;
        const now = Date.now();
        const agentIds = grants
          ? Array.from(new Set(grants.filter((grant) => grant.subjectType === "agent" && grantIsActive(grant, now)).map((grant) => grant.subjectId)))
          : null;

        return [collection.id, {
          agentIds,
          fileCount: files?.length ?? null,
          failedCount: files?.filter(fileIsFailed).length ?? 0,
          processingCount: files?.filter(fileIsProcessing).length ?? 0,
          searchText: files?.map((file) => [
            file.displayName,
            file.path,
            file.summary ?? "",
            file.keywords.join(" "),
          ].join(" ")).join(" ").toLowerCase() ?? "",
        }] as const;
      })).then((entries) => {
        if (cancelled) return;
        startTransition(() => setSnapshots(Object.fromEntries(entries)));
        const hasReadableSnapshot = entries.some(([, snapshot]) => snapshot.fileCount !== null || snapshot.agentIds !== null);
        if (!hasReadableSnapshot && entries.length > 0) {
          setSnapshotError("Knowledge details could not be loaded. Refresh to try again.");
        }
      }).catch(() => {
        if (!cancelled) setSnapshotError("Knowledge details could not be loaded. Refresh to try again.");
      }).finally(() => {
        if (!cancelled) setSnapshotsLoading(false);
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(loadTimer);
    };
  }, [knowledgeClient, refreshVersion, workspaces]);

  const selectedAgentIdSet = new Set(selectedWorkspaceAgentIds);
  const selectedAgents = agents.filter((agent) => selectedAgentIdSet.has(agent.id));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const filteredWorkspaces = workspaces.filter((collection) => {
    if (!deferredQuery) return true;
    return `${workspaceName(collection)} ${collection.description ?? ""} ${collection.slug} ${snapshots[collection.id]?.searchText ?? ""}`.toLowerCase().includes(deferredQuery);
  });
  const sortedWorkspaces = [...filteredWorkspaces].sort((left, right) => {
    if (left.id === workspace?.id) return -1;
    if (right.id === workspace?.id) return 1;
    return workspaceName(left).localeCompare(workspaceName(right));
  });

  const knownSnapshots = workspaces.flatMap((collection) => snapshots[collection.id] ? [snapshots[collection.id]!] : []);
  const knownFileSnapshots = knownSnapshots.filter((snapshot) => snapshot.fileCount !== null);
  const totalFiles = knownFileSnapshots.reduce((total, snapshot) => total + (snapshot.fileCount ?? 0), 0);
  const processingFiles = knownSnapshots.reduce((total, snapshot) => total + snapshot.processingCount, 0);
  const fileDetailsComplete = !snapshotsLoading && workspaces.length > 0 && workspaces.every((collection) => snapshots[collection.id]?.fileCount != null);
  const assignmentCount = knownSnapshots.reduce((total, snapshot) => total + (snapshot.agentIds?.length ?? 0), 0);
  const collectionsByAgent = new Map<string, number>();
  knownSnapshots.forEach((snapshot) => {
    snapshot.agentIds?.forEach((agentId) => collectionsByAgent.set(agentId, (collectionsByAgent.get(agentId) ?? 0) + 1));
  });
  const coveredSelectedAgents = selectedAgents.filter((agent) => (collectionsByAgent.get(agent.id) ?? 0) > 0).length;
  const coverage = selectedAgents.length > 0 ? Math.round((coveredSelectedAgents / selectedAgents.length) * 100) : 0;
  const accessDetailsAvailable = knownSnapshots.some((snapshot) => snapshot.agentIds !== null);
  const accessDetailsComplete = !snapshotsLoading && workspaces.length > 0 && workspaces.every((collection) => snapshots[collection.id]?.agentIds != null);
  const agentsUnavailable = Boolean(agentsError);
  const activeAgents = selectedAgents.filter((agent) => ACTIVE_AGENT_STATES.has(agent.state.toLowerCase())).length;
  const activeWorkspaceName = workspace ? workspaceName(workspace) : "Choose a Workspace";
  const workspaceInitial = activeWorkspaceName.trim()[0]?.toUpperCase() ?? "W";
  const knowledgeIsLoading = workspacesLoading || (snapshotsLoading && knownSnapshots.length === 0);
  const coverageAvailable = !agentsLoading && accessDetailsComplete && !agentsUnavailable && selectedAgents.length > 0;
  const coverageLabel = coverageAvailable ? `${coverage}%` : !agentsLoading && accessDetailsAvailable && !agentsUnavailable ? "Partial" : "---";
  let knowledgeReachDetail = `${coveredSelectedAgents} of ${selectedAgents.length} Workspace agents can reach at least one collection.`;
  if (agentsLoading) knowledgeReachDetail = "Loading agent knowledge reach.";
  else if (agentsUnavailable) knowledgeReachDetail = "Agent data is unavailable. Refresh before reviewing knowledge reach.";
  else if (!accessDetailsAvailable) knowledgeReachDetail = "Open Shared resources to review agent access.";
  else if (!accessDetailsComplete) knowledgeReachDetail = `${assignmentCount} visible access link${assignmentCount === 1 ? "" : "s"}; some collection access is scoped.`;
  else if (selectedAgents.length === 0) knowledgeReachDetail = "Add an agent to connect this Workspace to shared knowledge.";

  return (
    <section aria-labelledby={titleId} className={cn("h-full overflow-y-auto bg-background text-foreground", className)}>
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-7 lg:px-8">
        <header className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-xl font-semibold text-[var(--selection-accent)]">
              {workspaceInitial}
            </div>
            <div className="min-w-0 pt-0.5">
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] font-medium text-text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--selection-accent)]" />
                  Workspace map
                </span>
                {workspace?.role ? <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] capitalize text-text-secondary">{workspace.role}</Badge> : null}
              </div>
              <h1 id={titleId} className="truncate text-[26px] font-semibold leading-tight tracking-[-0.035em] text-foreground">{activeWorkspaceName}</h1>
              <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-text-secondary">
                {workspace
                  ? "Agents and the shared knowledge they can reach, together in one operating view."
                  : "Select a Workspace to see its agents alongside the knowledge available to them."}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Button type="button" variant="outline" size="sm" onClick={onOpenMembers} disabled={!onOpenMembers} className="min-h-9">
                <UsersRound /> Members
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onOpenAgentLauncher}
                disabled={!onOpenAgentLauncher || Boolean(agentCreationDisabledReason)}
                aria-describedby={agentCreationDisabledReason ? creationDisabledId : undefined}
                title={agentCreationDisabledReason ?? "New agent"}
                className="min-h-9"
              >
                <Plus /> New agent
              </Button>
            </div>
            {agentCreationDisabledReason ? (
              <p id={creationDisabledId} className="max-w-sm text-[11px] leading-relaxed text-warning lg:text-right">{agentCreationDisabledReason}</p>
            ) : null}
          </div>
        </header>

        <section aria-label="Workspace summary" className="mt-6 grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-surface-low/45 sm:grid-cols-4 sm:divide-x sm:divide-border">
          <SummaryItem label="agents" value={agentsLoading || agentsUnavailable ? "---" : selectedAgents.length.toLocaleString()} detail={agentsLoading ? "Loading roster" : agentsUnavailable ? "Roster unavailable" : `${activeAgents} active now`} />
          <SummaryItem label="collections" value={workspacesLoading ? "---" : workspaces.length.toLocaleString()} detail="Shared across the account" />
          <SummaryItem
            label="files"
            value={knowledgeIsLoading || knownFileSnapshots.length === 0 ? "---" : `${totalFiles.toLocaleString()}${fileDetailsComplete ? "" : "+"}`}
            detail={!fileDetailsComplete && knownFileSnapshots.length > 0 ? "Visible knowledge files" : processingFiles > 0 ? `${processingFiles} processing` : "Available to reference"}
          />
          <SummaryItem
            label="connections"
            value={knowledgeIsLoading || !accessDetailsAvailable ? "---" : `${assignmentCount.toLocaleString()}${accessDetailsComplete ? "" : "+"}`}
            detail={accessDetailsComplete ? "Agent-to-knowledge links" : "Visible access links"}
          />
        </section>

        <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface-low/35" aria-label="Workspace agents and shared knowledge">
          <div className="grid lg:grid-cols-[minmax(250px,0.72fr)_minmax(0,1.65fr)]">
            <aside className="border-b border-border lg:border-b-0 lg:border-r" aria-labelledby="alt-home-agents-heading">
              <div className="flex min-h-[73px] items-center justify-between gap-3 px-4 py-4 sm:px-5">
                <div>
                  <h2 id="alt-home-agents-heading" className="text-sm font-semibold text-foreground">Agent team</h2>
                  <p className="mt-1 text-[11px] text-text-muted">Knowledge reach by agent</p>
                </div>
                <Badge variant="secondary" className="rounded-full px-2.5">{agentsLoading || agentsUnavailable ? "---" : selectedAgents.length}</Badge>
              </div>

              <div className="border-t border-border">
                {agentsLoading ? (
                  <div className="space-y-3 p-4 sm:p-5" role="status" aria-label="Loading workspace agents">
                    {[0, 1, 2].map((index) => <Skeleton key={index} className="h-12 w-full rounded-xl" />)}
                  </div>
                ) : agentsError ? (
                  <div className="px-5 py-10 text-center" role="alert">
                    <Bot className="mx-auto h-5 w-5 text-warning" />
                    <p className="mt-3 text-[13px] font-semibold text-foreground">Agent roster unavailable</p>
                    <p className="mx-auto mt-1 max-w-[30ch] text-[11px] leading-relaxed text-text-muted">Refresh the page before changing this Workspace&apos;s agent access.</p>
                  </div>
                ) : selectedAgents.length > 0 ? (
                  <div className="divide-y divide-border">
                    {selectedAgents.map((agent) => {
                      const collectionCount = collectionsByAgent.get(agent.id) ?? 0;
                      return (
                        <div key={agent.id} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                          <div className="relative shrink-0">
                            <AgentAvatar agent={agent} className="h-9 w-9" />
                            <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-low", agentStateTone(agent.state))} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold text-foreground">{agent.name}</p>
                            <p className="mt-0.5 text-[11px] text-text-muted">{titleizeState(agent.state)}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[12px] font-semibold text-text-secondary">
                              {!accessDetailsAvailable ? "---" : accessDetailsComplete ? collectionCount : collectionCount > 0 ? `${collectionCount}+` : "Partial"}
                            </p>
                            <p className="mt-0.5 text-[10px] text-text-muted">
                              {accessDetailsComplete ? (collectionCount === 1 ? "collection" : "collections") : "known reach"}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-5 py-10 text-center">
                    <Bot className="mx-auto h-5 w-5 text-text-muted" />
                    <p className="mt-3 text-[13px] font-semibold text-foreground">No agents in this Workspace</p>
                    <p className="mx-auto mt-1 max-w-[28ch] text-[11px] leading-relaxed text-text-muted">Add an agent to start building a shared knowledge network.</p>
                    <Button type="button" variant="outline" size="sm" onClick={onOpenAgentLauncher} disabled={!onOpenAgentLauncher || Boolean(agentCreationDisabledReason)} aria-describedby={agentCreationDisabledReason ? creationDisabledId : undefined} className="mt-4">
                      <Plus /> Add agent
                    </Button>
                  </div>
                )}
              </div>
            </aside>

            <div className="min-w-0" aria-labelledby="alt-home-knowledge-heading">
              <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                <div>
                  <h2 id="alt-home-knowledge-heading" className="text-sm font-semibold text-foreground">Shared knowledge</h2>
                  <p className="mt-1 text-[11px] text-text-muted">Collections, files, and assigned agents</p>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="relative min-w-0 flex-1 sm:w-56">
                    <label htmlFor={searchId} className="sr-only">Search shared knowledge</label>
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                    <Input id={searchId} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search knowledge" className="h-8 rounded-lg border-border bg-background/60 pl-8 text-[12px]" />
                  </div>
                  <Button type="button" variant="outline" size="icon" onClick={() => setRefreshVersion((version) => version + 1)} disabled={!knowledgeClient || snapshotsLoading} className="h-8 w-8 rounded-lg" aria-label="Refresh knowledge details">
                    {snapshotsLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => onOpenKnowledge?.()} disabled={!onOpenKnowledge} className="hidden h-8 sm:inline-flex">
                    Manage <ArrowRight />
                  </Button>
                </div>
              </div>

              {snapshotError ? (
                <div role="alert" className="mx-4 mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning sm:mx-5">
                  {snapshotError}
                </div>
              ) : null}

              <div className="border-t border-border">
                {knowledgeIsLoading ? (
                  <KnowledgeRowsSkeleton />
                ) : workspacesError && sortedWorkspaces.length === 0 ? (
                  <div className="px-5 py-12 text-center" role="alert">
                    <FolderKanban className="mx-auto h-5 w-5 text-warning" />
                    <p className="mt-3 text-[13px] font-semibold text-foreground">Shared knowledge unavailable</p>
                    <p className="mx-auto mt-1 max-w-[34ch] text-[11px] leading-relaxed text-text-muted">Refresh the page to reconnect this Workspace&apos;s knowledge.</p>
                  </div>
                ) : sortedWorkspaces.length > 0 ? (
                  <div className="divide-y divide-border">
                    {sortedWorkspaces.map((collection) => {
                      const snapshot = snapshots[collection.id];
                      const assignedAgents = (snapshot?.agentIds ?? []).map((agentId) => agentById.get(agentId)).filter((agent): agent is WorkspaceKnowledgeHomeAgent => Boolean(agent));
                      const unknownAgentCount = Math.max(0, (snapshot?.agentIds?.length ?? 0) - assignedAgents.length);
                      const selected = collection.id === workspace?.id;
                      const statusLabel = snapshot?.failedCount
                        ? `${snapshot.failedCount} failed`
                        : snapshot?.processingCount
                          ? `${snapshot.processingCount} processing`
                          : snapshot?.fileCount === null || snapshot?.fileCount === undefined
                            ? "Details unavailable"
                            : "Ready";
                      const statusClass = snapshot?.failedCount
                        ? "text-destructive"
                        : snapshot?.processingCount
                          ? "text-warning"
                          : "text-text-muted";

                      return (
                        <Button
                          key={collection.id}
                          type="button"
                          variant="ghost"
                          onClick={() => onOpenKnowledge?.(collection.id)}
                          disabled={!onOpenKnowledge}
                          aria-label={`Open ${workspaceName(collection)} in Shared resources`}
                          className={cn(
                            "group relative h-auto w-full justify-start whitespace-normal rounded-none px-4 py-4 text-left hover:bg-surface-high/60 hover:text-foreground sm:px-5",
                            selected && "bg-[rgb(var(--selection-accent-rgb)_/_0.07)]",
                          )}
                        >
                          {selected ? <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-[var(--selection-accent)]" /> : null}
                          <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                            <div className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-text-secondary",
                              selected && "border-[rgb(var(--selection-accent-rgb)_/_0.28)] text-[var(--selection-accent)]",
                            )}>
                              <Library className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <h3 className="truncate text-[13px] font-semibold text-foreground">{workspaceName(collection)}</h3>
                                {selected ? <Badge variant="active" className="h-5 rounded-full px-2 text-[9px]">Current</Badge> : null}
                              </div>
                              <p className="mt-1 line-clamp-1 text-[11px] leading-relaxed text-text-muted">{collection.description || collection.slug}</p>
                              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                                <span className="inline-flex items-center gap-1 text-[10px] text-text-muted">
                                  <FileText className="h-3 w-3" />
                                  {snapshot?.fileCount == null ? "--- files" : `${snapshot.fileCount.toLocaleString()} ${snapshot.fileCount === 1 ? "file" : "files"}`}
                                </span>
                                <span className={cn("text-[10px]", statusClass)}>{statusLabel}</span>
                                <div className="flex min-w-0 items-center gap-2">
                                  {snapshot?.agentIds === null || snapshot?.agentIds === undefined ? (
                                    <span className="text-[10px] text-text-muted">Access scoped</span>
                                  ) : snapshot.agentIds.length === 0 ? (
                                    <span className="text-[10px] text-text-muted">No agents assigned</span>
                                  ) : (
                                    <>
                                      <div className="flex -space-x-1.5" aria-label={`${snapshot.agentIds.length} assigned agents`}>
                                        {assignedAgents.slice(0, 4).map((agent) => <AgentAvatar key={agent.id} agent={agent} className="h-5 w-5 border-background" />)}
                                        {unknownAgentCount > 0 ? (
                                          <Avatar className="h-5 w-5 border border-background">
                                            <AvatarFallback className="bg-surface-high text-[8px] font-semibold text-text-muted">+{unknownAgentCount}</AvatarFallback>
                                          </Avatar>
                                        ) : null}
                                      </div>
                                      <span className="text-[10px] text-text-muted">{snapshot.agentIds.length} assigned</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="col-start-2 flex shrink-0 items-center gap-3 justify-self-end sm:col-start-auto sm:justify-self-auto">
                              {collection.role ? <Badge variant="outline" className="h-5 rounded-full px-2 text-[9px] capitalize text-text-muted">{collection.role}</Badge> : null}
                              <ArrowRight className="h-3.5 w-3.5 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                            </div>
                          </div>
                        </Button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-5 py-12 text-center">
                    {deferredQuery ? <Search className="mx-auto h-5 w-5 text-text-muted" /> : <FolderKanban className="mx-auto h-5 w-5 text-text-muted" />}
                    <p className="mt-3 text-[13px] font-semibold text-foreground">{deferredQuery ? "No matching knowledge" : "No shared knowledge yet"}</p>
                    <p className="mx-auto mt-1 max-w-[34ch] text-[11px] leading-relaxed text-text-muted">
                      {deferredQuery ? "Try another name, file topic, or collection." : "Create a collection to give agents durable context across conversations."}
                    </p>
                    {!deferredQuery ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => onOpenKnowledge?.()} disabled={!onOpenKnowledge} className="mt-4">
                        <Plus /> Create shared knowledge
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="grid gap-4 border-t border-border bg-background/35 px-4 py-4 sm:px-5 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.7fr)_auto] md:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <FolderKanban className="h-3.5 w-3.5 text-[var(--selection-accent)]" />
                    <h3 className="text-[12px] font-semibold text-foreground">Knowledge reach</h3>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{knowledgeReachDetail}</p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-text-muted">
                    <span>Workspace coverage</span>
                    <span>{coverageLabel}</span>
                  </div>
                  {coverageAvailable ? (
                    <Progress value={coverage} aria-label="Workspace knowledge coverage" className="h-1.5 bg-surface-high [&_[data-slot=progress-indicator]]:bg-[var(--selection-accent)]" />
                  ) : (
                    <div aria-hidden className="h-1.5 rounded-full bg-surface-high" />
                  )}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => onOpenKnowledge?.()} disabled={!onOpenKnowledge} className="justify-self-start md:justify-self-end">
                  Review access <ArrowRight />
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
