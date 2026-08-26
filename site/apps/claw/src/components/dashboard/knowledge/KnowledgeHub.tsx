"use client";

/*
 * DIRECTION: Match the Collections prototype topology exactly, adapted to Aurora's semantic
 * tokens, Figtree typography, shared controls, real Workspace data, and permission boundaries.
 */

import {
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import type { WorkspaceFile, WorkspacesAPI } from "@hypercli.com/sdk/workspaces";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Check,
  ChevronLeft,
  Download,
  FileText,
  Info,
  LibraryBig,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AlertDialogUI,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SlideOver,
  Textarea,
} from "@hypercli/shared-ui";

import { downloadFileBytes } from "@/lib/download-file";
import { collectionDeletionBlockedReason } from "@/lib/account-collection";
import { MarkdownContent } from "@/components/dashboard/chat/MarkdownContent";
import { useWorkspace } from "@/components/dashboard/WorkspaceContext";
import {
  describeKnowledgeHubError,
  knowledgeFileHealth,
  knowledgeFileStatusLabel,
  knowledgeWorkspaceName,
  knowledgeWorkspaceRef,
  useKnowledgeHubCatalog,
  type KnowledgeHubCollection,
} from "./useKnowledgeHubCatalog";

type CollectionTab = "overview" | "knowledge" | "agents" | "skills" | "integrations";
type SourceInspectorView = "preview" | "metadata";
type PreviewMode = "source" | "markdown";
type KnowledgeFileFilter = "all" | "failed";

function subscribeToHeaderControlsTarget(): () => void {
  return () => undefined;
}

export type KnowledgeHubAgent = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  state?: string | null;
  avatarUrl?: string | null;
};

export type KnowledgeHubSelectedCollection = {
  id: string;
  name: string;
  description: string | null;
  sourceCount: number | null;
  assignedAgentCount: number | null;
  processingCount: number | null;
  failedCount: number | null;
};

type KnowledgeHubProps = {
  agents?: KnowledgeHubAgent[];
  agentsLoading?: boolean;
  agentsError?: string | null;
  initialCollectionId?: string | null;
  onRefreshAgents?: () => Promise<unknown> | void;
  onNavigateCollection?: (collectionId: string | null) => void;
  onSelectedCollectionChange?: (collection: KnowledgeHubSelectedCollection | null) => void;
  headerControlsTargetId?: string;
  onRequestProductUse?: () => boolean;
};

function agentName(agent: KnowledgeHubAgent): string {
  return agent.displayName?.trim() || agent.name?.trim() || agent.id;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

function titleize(value: string | null | undefined): string {
  const normalized = value?.trim().replaceAll("_", " ").replaceAll("-", " ") || "Unknown";
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function agentStateClass(state?: string | null): string {
  const normalized = state?.toLowerCase() || "unknown";
  if (normalized === "running" || normalized === "ready" || normalized === "active") return "bg-success";
  if (normalized.includes("fail") || normalized.includes("error")) return "bg-destructive";
  if (["pending", "restoring", "starting", "stopping", "syncing"].includes(normalized)) return "bg-warning";
  return "bg-text-muted";
}

function collectionCanWrite(collection: KnowledgeHubCollection): boolean {
  const role = collection.workspace.role?.toLowerCase();
  return role === "admin" || role === "contributor";
}

function collectionCanAdminister(collection: KnowledgeHubCollection): boolean {
  return collection.workspace.role?.toLowerCase() === "admin";
}

function collectionMatches(collection: KnowledgeHubCollection, query: string): boolean {
  if (!query) return true;
  const workspaceText = [
    knowledgeWorkspaceName(collection.workspace),
    collection.workspace.slug,
    collection.workspace.description ?? "",
  ].join(" ").toLowerCase();
  if (workspaceText.includes(query)) return true;
  return collection.files?.some((file) => fileMatches(file, query)) ?? false;
}

function fileMatches(file: WorkspaceFile, query: string): boolean {
  if (!query) return true;
  return [file.displayName, file.path, file.summary ?? "", file.keywords.join(" ")]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function fileName(file: WorkspaceFile): string {
  return file.displayName?.trim() || file.path.split("/").filter(Boolean).at(-1) || file.path;
}

function fileHealthCounts(collection: KnowledgeHubCollection) {
  const files = collection.files ?? [];
  return {
    failed: files.filter((file) => knowledgeFileHealth(file) === "failed").length,
    processing: files.filter((file) => knowledgeFileHealth(file) === "processing").length,
  };
}

function fileHealthClasses(file: WorkspaceFile): string {
  const health = knowledgeFileHealth(file);
  if (health === "failed") return "bg-destructive";
  if (health === "processing") return "bg-warning";
  return "bg-success";
}

function textPreview(bytes: Uint8Array): { text: string; binary: boolean } {
  const sample = bytes.slice(0, Math.min(bytes.length, 256 * 1024));
  const text = new TextDecoder("utf-8", { fatal: false }).decode(sample);
  const controlCharacters = text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)?.length ?? 0;
  return { text, binary: controlCharacters > 8 };
}

function parseKeywords(value: string): string[] {
  const seen = new Set<string>();
  return value.split(",").flatMap((entry) => {
    const keyword = entry.trim();
    const normalized = keyword.toLowerCase();
    if (!keyword || seen.has(normalized)) return [];
    seen.add(normalized);
    return [keyword];
  });
}

function CreateCollectionDialog({
  open,
  onOpenChange,
  agents,
  agentsLoading,
  agentsError,
  onCreate,
  onRequestProductUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: KnowledgeHubAgent[];
  agentsLoading: boolean;
  agentsError: string | null;
  onCreate: (name: string, description: string, agentIds: string[]) => Promise<void>;
  onRequestProductUse?: () => boolean;
}) {
  const nameInputId = useId();
  const descriptionInputId = useId();
  const agentSearchId = useId();
  const agentPickerId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentQuery, setAgentQuery] = useState("");
  const deferredAgentQuery = useDeferredValue(agentQuery.trim().toLowerCase());
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();
  const visibleAgents = agents.filter((agent) => {
    if (!deferredAgentQuery) return true;
    return `${agentName(agent)} ${agent.id} ${agent.state ?? ""}`.toLowerCase().includes(deferredAgentQuery);
  });
  const selectedAgents = selectedAgentIds.flatMap((agentId) => {
    const agent = agents.find((candidate) => candidate.id === agentId);
    return agent ? [agent] : [];
  });

  function resetDraft() {
    setName("");
    setDescription("");
    setAgentQuery("");
    setSelectedAgentIds([]);
    setError(null);
  }

  function changeOpen(nextOpen: boolean) {
    if (submitting) return;
    if (!nextOpen) resetDraft();
    onOpenChange(nextOpen);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedName || submitting) return;
    if (onRequestProductUse && !onRequestProductUse()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(trimmedName, description.trim(), selectedAgentIds);
      resetDraft();
      onOpenChange(false);
    } catch (cause) {
      setError(describeKnowledgeHubError(cause, "The Collection couldn't be created."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[min(47.5rem,calc(100dvh-2rem))] max-w-[40rem] overflow-hidden gap-0 rounded-2xl border-border p-0 motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none max-md:inset-0 max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none sm:max-w-[40rem]">
        <form onSubmit={submit} className="flex h-full min-h-0 flex-col overflow-hidden">
          <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-14 text-left sm:px-7 sm:py-6">
            <DialogTitle className="text-xl tracking-[-0.02em]">Create collection</DialogTitle>
            <DialogDescription className="max-w-md leading-relaxed">
              Create a reusable set of knowledge and capabilities for your agents.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            <div>
              <label htmlFor={nameInputId} className="mb-2 block text-xs font-semibold text-foreground">
                Name <span className="text-destructive" aria-hidden="true">*</span>
              </label>
              <Input
                id={nameInputId}
                autoFocus
                value={name}
                onChange={(event) => { setName(event.target.value); setError(null); }}
                placeholder="e.g. Sales enablement"
                maxLength={120}
                required
                aria-invalid={name.length > 0 && !trimmedName}
                className="h-10 rounded-lg border-border bg-input-background px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor={descriptionInputId} className="mb-2 block text-xs font-semibold text-foreground">Description</label>
              <Textarea
                id={descriptionInputId}
                value={description}
                onChange={(event) => { setDescription(event.target.value); setError(null); }}
                placeholder="What should agents use this Collection for?"
                rows={5}
                maxLength={280}
                className="min-h-32 resize-y rounded-lg border-border bg-input-background px-3 py-2.5 text-sm leading-relaxed"
              />
            </div>

            <section aria-labelledby={`${agentPickerId}-heading`} className="rounded-xl border border-border bg-surface-low/25 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 id={`${agentPickerId}-heading`} className="text-sm font-semibold text-foreground">Assign agents <span className="font-normal text-text-muted">(optional)</span></h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-text-muted">Assigned agents can use everything added to this Collection. You can change this later.</p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{selectedAgentIds.length} selected</span>
              </div>

              {selectedAgents.length > 0 ? (
                <div className="mt-3 flex items-center -space-x-2" aria-label={`${selectedAgents.length} selected ${selectedAgents.length === 1 ? "agent" : "agents"}`}>
                  {selectedAgents.slice(0, 5).map((agent) => {
                    const label = agentName(agent);
                    return (
                      <Avatar key={agent.id} title={label} className="h-7 w-7 border-2 border-background bg-surface-high">
                        {agent.avatarUrl ? <AvatarImage src={agent.avatarUrl} alt="" /> : null}
                        <AvatarFallback className="text-[8px] font-semibold text-text-secondary">{initials(label)}</AvatarFallback>
                      </Avatar>
                    );
                  })}
                  {selectedAgents.length > 5 ? <span className="relative flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-background bg-surface-high px-1 text-[8px] font-semibold text-text-secondary">+{selectedAgents.length - 5}</span> : null}
                </div>
              ) : null}

              <label htmlFor={agentSearchId} className="relative mt-4 block">
                <span className="sr-only">Search agents</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                <Input
                  id={agentSearchId}
                  value={agentQuery}
                  onChange={(event) => setAgentQuery(event.target.value)}
                  placeholder="Search agents"
                  disabled={agentsLoading || Boolean(agentsError)}
                  className="h-10 rounded-lg border-border bg-background pl-9 text-xs"
                />
              </label>

              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border bg-background" aria-live="polite">
                {agentsLoading ? (
                  <div className="flex min-h-28 items-center justify-center" role="status"><Loader2 className="h-4 w-4 animate-spin text-text-muted motion-reduce:animate-none" /><span className="sr-only">Loading agents</span></div>
                ) : agentsError ? (
                  <p role="status" className="px-4 py-8 text-center text-xs leading-relaxed text-text-muted">Agents are unavailable right now. You can assign them after creating the Collection.</p>
                ) : visibleAgents.length > 0 ? visibleAgents.map((agent, index) => {
                  const label = agentName(agent);
                  const checkboxId = `${agentPickerId}-${index}`;
                  const selected = selectedAgentIds.includes(agent.id);
                  return (
                    <label key={agent.id} htmlFor={checkboxId} className={`flex min-h-16 items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-surface-low/40 ${selected ? "bg-[var(--selection-accent-soft)]" : ""}`}>
                      <Checkbox
                        id={checkboxId}
                        checked={selected}
                        onCheckedChange={(checked) => {
                          setSelectedAgentIds((current) => checked
                            ? [...current, agent.id]
                            : current.filter((agentId) => agentId !== agent.id));
                        }}
                        aria-label={`Assign ${label}`}
                        className="order-last shrink-0"
                      />
                      <Avatar className="h-9 w-9 shrink-0 rounded-lg border border-border bg-surface-high">
                        {agent.avatarUrl ? <AvatarImage src={agent.avatarUrl} alt="" /> : null}
                        <AvatarFallback className="text-[9px] font-semibold text-text-secondary">{initials(label)}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-xs font-semibold text-foreground">{label}</strong>
                        <span className="mt-1 flex items-center gap-1.5 text-[10px] text-text-muted"><span className={`h-1.5 w-1.5 rounded-full ${agentStateClass(agent.state)}`} aria-hidden="true" />{titleize(agent.state)}</span>
                      </span>
                    </label>
                  );
                }) : (
                  <div className="px-4 py-8 text-center"><Search className="mx-auto h-4 w-4 text-text-muted" /><p className="mt-2 text-xs font-semibold text-foreground">No matching agents</p><p className="mt-1 text-[11px] text-text-muted">Try another name or clear the search.</p></div>
                )}
              </div>
            </section>
            {error ? <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p> : null}
          </div>
          <DialogFooter className="shrink-0 !flex-row justify-end border-t border-border bg-surface-low/25 px-5 py-4 sm:px-7">
            <Button type="button" variant="ghost" onClick={() => changeOpen(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={!trimmedName || submitting} className="min-w-36">
              {submitting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
              {submitting ? "Creating" : "Create collection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DestructiveConfirmDialog({
  open,
  title,
  description,
  busy,
  error = null,
  confirmLabel = "Delete",
  busyLabel = "Deleting",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  error?: string | null;
  confirmLabel?: string;
  busyLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogUI open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onCancel(); }}>
      <AlertDialogContent
        className="rounded-2xl border-border bg-card sm:max-w-md"
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="leading-relaxed text-text-secondary">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button type="button" onClick={onConfirm} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : confirmLabel === "Remove" ? <X /> : <Trash2 />}
            {busy ? busyLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogUI>
  );
}

function CollectionOverview({
  collection,
  agents,
  onOpenSources,
  onSelectFile,
  onOpenAccess,
}: {
  collection: KnowledgeHubCollection;
  agents: KnowledgeHubAgent[];
  onOpenSources: () => void;
  onSelectFile: (file: WorkspaceFile) => void;
  onOpenAccess: () => void;
}) {
  const counts = fileHealthCounts(collection);
  const canWrite = collectionCanWrite(collection);
  const sourceCount = collection.files?.length ?? null;
  const readyCount = collection.files?.filter((file) => knowledgeFileHealth(file) === "ready").length ?? null;
  const agentCount = collection.accessError ? null : collection.agentIds?.length ?? null;
  const firstRun = sourceCount === 0 && agentCount === 0;
  const overviewFiles = collection.files?.slice(0, 3) ?? [];
  const assignedRows = (collection.agentIds ?? []).slice(0, 4).map((agentId) => ({
    id: agentId,
    agent: agents.find((candidate) => candidate.id === agentId) ?? null,
  }));
  const sourceValue = sourceCount === null ? "---" : sourceCount.toLocaleString();
  const agentValue = collection.agentIds === null && !collection.accessError ? "Scoped" : agentCount?.toLocaleString() ?? "---";

  return (
    <div className="mx-auto w-full max-w-[92rem] space-y-5 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-low/25 px-3.5 py-3 text-xs leading-relaxed text-text-secondary">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
        <p>Assigned agents can access this Collection&apos;s knowledge in addition to their own workspace. Shared skills and integrations are coming soon.</p>
      </div>

      {firstRun ? (
        <section data-slot="collection-first-run" className="rounded-xl border border-border bg-background p-4 sm:p-6">
          <header className="mb-5">
            <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Build your Collection</h2>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-text-muted">Add shared knowledge and capabilities, then choose which agents should receive them.</p>
          </header>
          <div className="grid gap-3 md:grid-cols-2">
            <button type="button" onClick={onOpenSources} className="group flex min-h-40 flex-col rounded-lg border border-border bg-surface-low/20 p-4 text-left transition-colors hover:border-[var(--selection-accent-border)] hover:bg-surface-low/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex items-center justify-between gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-text-secondary"><FileText className="h-4 w-4" /></span><span className="text-[10px] font-medium text-[var(--selection-accent)]">Recommended</span></span>
              <strong className="mt-4 text-sm font-semibold text-foreground">Add knowledge</strong>
              <span className="mt-1.5 text-[11px] leading-relaxed text-text-muted">Upload documents and reference files agents can search and use.</span>
              <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[11px] font-semibold text-text-secondary group-hover:text-foreground">Upload files <ArrowRight className="h-3 w-3" /></span>
            </button>
            <article className="flex min-h-40 flex-col rounded-lg border border-border bg-surface-low/20 p-4">
              <span className="flex items-center justify-between gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-text-muted"><Sparkles className="h-4 w-4" /></span><span className="rounded-full border border-border px-2 py-1 text-[9px] font-medium text-text-muted">Coming soon</span></span>
              <h3 className="mt-4 text-sm font-semibold text-foreground">Add skills</h3>
              <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">Share reusable instructions for specialized agent tasks.</p>
              <span className="mt-auto pt-4 text-[11px] font-semibold text-text-muted">Not available yet</span>
            </article>
            <article className="flex min-h-40 flex-col rounded-lg border border-border bg-surface-low/20 p-4">
              <span className="flex items-center justify-between gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-text-muted"><Link2 className="h-4 w-4" /></span><span className="rounded-full border border-border px-2 py-1 text-[9px] font-medium text-text-muted">Coming soon</span></span>
              <h3 className="mt-4 text-sm font-semibold text-foreground">Add integrations</h3>
              <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">Connect shared services and external tools to this Collection.</p>
              <span className="mt-auto pt-4 text-[11px] font-semibold text-text-muted">Not available yet</span>
            </article>
            <button type="button" onClick={onOpenAccess} className="group flex min-h-40 flex-col rounded-lg border border-border bg-surface-low/20 p-4 text-left transition-colors hover:border-[var(--selection-accent-border)] hover:bg-surface-low/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex items-center justify-between gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-text-secondary"><UsersRound className="h-4 w-4" /></span><span className="text-[10px] font-medium text-text-muted">Required to share</span></span>
              <strong className="mt-4 text-sm font-semibold text-foreground">Assign agents</strong>
              <span className="mt-1.5 text-[11px] leading-relaxed text-text-muted">Choose which agents receive direct access to this Collection.</span>
              <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[11px] font-semibold text-text-secondary group-hover:text-foreground">Choose agents <ArrowRight className="h-3 w-3" /></span>
            </button>
          </div>
        </section>
      ) : (
        <div className="space-y-3">
          {counts.failed > 0 ? (
            <div className="flex flex-col gap-3 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 sm:!flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><div><p className="text-xs font-semibold text-foreground">Some knowledge needs attention</p><p className="mt-1 text-[11px] leading-relaxed text-text-muted">{counts.failed} {counts.failed === 1 ? "source could not" : "sources could not"} be processed.</p></div></div>
              <Button type="button" variant="ghost" size="sm" onClick={onOpenSources} className="shrink-0 self-start sm:self-auto">Review knowledge <ArrowRight /></Button>
            </div>
          ) : null}
          {counts.processing > 0 ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-low/25 px-4 py-3 sm:!flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" /><div><p className="text-xs font-semibold text-foreground">Some knowledge is still processing</p><p className="mt-1 text-[11px] leading-relaxed text-text-muted">Each source becomes available when processing finishes.</p></div></div>
              <Button type="button" variant="ghost" size="sm" onClick={onOpenSources} className="shrink-0 self-start sm:self-auto">View knowledge <ArrowRight /></Button>
            </div>
          ) : null}
          {sourceCount !== null && sourceCount > 0 && agentCount === 0 ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-low/25 px-4 py-3 sm:!flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold text-foreground">This Collection is not shared with any agents yet</p><p className="mt-1 text-[11px] leading-relaxed text-text-muted">Assign agents to make its knowledge available to them.</p></div><Button type="button" variant="ghost" size="sm" onClick={onOpenAccess} className="self-start sm:self-auto">Assign agents <ArrowRight /></Button></div>
          ) : null}
          {agentCount !== null && agentCount > 0 && sourceCount === 0 ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-low/25 px-4 py-3 sm:!flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold text-foreground">There is no knowledge to share yet</p><p className="mt-1 text-[11px] leading-relaxed text-text-muted">Upload a source for assigned agents to access.</p></div><Button type="button" variant="ghost" size="sm" onClick={onOpenSources} className="self-start sm:self-auto">Add knowledge <ArrowRight /></Button></div>
          ) : null}

          {(sourceCount !== null && sourceCount < 3) || agentCount === 0 ? (
            <section className="rounded-xl border border-border bg-background p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-foreground">Set up your collection</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-low/20 p-3"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${sourceCount && sourceCount > 0 ? "bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]" : "bg-surface-high text-text-muted"}`}>{sourceCount && sourceCount > 0 ? <Check className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}</span><span className="min-w-0 flex-1"><strong className="block text-xs font-semibold text-foreground">Add knowledge</strong><span className="mt-0.5 block text-[10px] text-text-muted">{sourceCount && sourceCount > 0 ? "Complete" : canWrite ? "Recommended" : "Contributor access required"}</span></span>{sourceCount === 0 && canWrite ? <button type="button" onClick={onOpenSources} className="text-[10px] font-semibold text-[var(--selection-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Upload</button> : null}</div>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-low/20 p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-high text-text-muted"><Sparkles className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><strong className="block text-xs font-semibold text-foreground">Add capabilities</strong><span className="mt-0.5 block text-[10px] text-text-muted">Coming soon</span></span></div>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-low/20 p-3"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${agentCount && agentCount > 0 ? "bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]" : "bg-surface-high text-text-muted"}`}>{agentCount && agentCount > 0 ? <Check className="h-3.5 w-3.5" /> : <UsersRound className="h-3.5 w-3.5" />}</span><span className="min-w-0 flex-1"><strong className="block text-xs font-semibold text-foreground">Assign agents</strong><span className="mt-0.5 block text-[10px] text-text-muted">{agentCount && agentCount > 0 ? "Complete" : "Required to share"}</span></span>{agentCount === 0 ? <button type="button" onClick={onOpenAccess} className="text-[10px] font-semibold text-[var(--selection-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Choose</button> : null}</div>
              </div>
            </section>
          ) : null}
        </div>
      )}

      <section aria-label="Collection summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Knowledge", icon: FileText, value: sourceValue, foot: sourceCount === null ? "Status unavailable" : `${readyCount ?? 0} ready · ${counts.processing} processing` },
          { label: "Agents", icon: UsersRound, value: agentValue, foot: collection.accessError ? "Assignments unavailable" : "Assigned agents" },
          { label: "Skills", icon: Sparkles, value: "Coming soon", foot: "Not available" },
          { label: "Integrations", icon: Link2, value: "Coming soon", foot: "Not available" },
        ].map((summary) => (
          <article key={summary.label} className="rounded-xl border border-border bg-background p-4">
            <div className="flex items-center justify-between gap-3 text-xs text-text-muted"><span>{summary.label}</span><summary.icon className="h-4 w-4" /></div>
            <p className={`mt-3 font-semibold tracking-[-0.025em] text-foreground ${typeof summary.value === "string" && summary.value === "Coming soon" ? "text-sm" : "text-2xl tabular-nums"}`}>{summary.value}</p>
            <p className="mt-1 text-[10px] text-text-muted">{summary.foot}</p>
          </article>
        ))}
      </section>

      <div data-slot="collection-overview-layout" className="grid gap-3 xl:grid-cols-[1.15fr_.85fr]">
        <section className="min-w-0 rounded-xl border border-border bg-background p-4 sm:p-5">
          <header className="flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold text-foreground">Assigned agents</h2><p className="mt-1 text-[11px] text-text-muted">Direct access to this Collection</p></div>{collectionCanAdminister(collection) ? <Button type="button" variant="ghost" size="sm" onClick={onOpenAccess}>Manage agents <ArrowRight /></Button> : null}</header>
          <div className="mt-4 divide-y divide-border">
            {collection.accessError ? <p className="py-6 text-center text-xs text-text-muted">Assignment details are unavailable.</p> : collection.agentIds === null ? <p className="py-6 text-center text-xs text-text-muted">Assignment visibility is scoped.</p> : assignedRows.length > 0 ? assignedRows.map(({ id, agent }) => {
              const label = agent ? agentName(agent) : id;
              return <div key={id} className="flex min-h-12 items-center gap-3 py-2"><Avatar className="h-8 w-8 rounded-lg border border-border bg-surface-high">{agent?.avatarUrl ? <AvatarImage src={agent.avatarUrl} alt="" /> : null}<AvatarFallback className="text-[8px] font-semibold text-text-secondary">{initials(label)}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><strong className="block truncate text-xs font-medium text-foreground">{label}</strong><span className="mt-0.5 block truncate text-[10px] text-text-muted">{agent ? agent.id : "Outside the visible roster"}</span></span>{agent ? <span className="inline-flex items-center gap-1.5 text-[10px] text-text-muted"><span className={`h-1.5 w-1.5 rounded-full ${agentStateClass(agent.state)}`} aria-hidden="true" />{titleize(agent.state)}</span> : null}</div>;
            }) : <div className="py-8 text-center"><UsersRound className="mx-auto h-4 w-4 text-text-muted" /><p className="mt-2 text-xs font-semibold text-foreground">No agents assigned yet</p><button type="button" onClick={onOpenAccess} className="mt-2 text-[11px] font-semibold text-[var(--selection-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Assign agents</button></div>}
          </div>
        </section>

        <section className="min-w-0 rounded-xl border border-border bg-background p-4 sm:p-5">
          <header><h2 className="text-sm font-semibold text-foreground">Shared capabilities</h2><p className="mt-1 text-[11px] text-text-muted">Skills and integrations shared through this Collection</p></header>
          <div className="flex min-h-40 items-center justify-center text-center"><div className="max-w-sm"><span className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-low text-text-muted"><Sparkles className="h-4 w-4" /></span><span className="mt-3 inline-flex rounded-full border border-border px-2.5 py-1 text-[9px] font-medium text-text-muted">Coming soon</span><p className="mt-2 text-xs leading-relaxed text-text-muted">Shared skills and integrations are not available yet. No capability data is shown for this Collection.</p></div></div>
        </section>

        <section className="min-w-0 rounded-xl border border-border bg-background p-4 sm:p-5">
          <header><h2 className="text-sm font-semibold text-foreground">Knowledge health</h2><p className="mt-1 text-[11px] text-text-muted">Current processing state</p></header>
          {collection.filesError || sourceCount === null ? <p className="py-10 text-center text-xs text-text-muted">Knowledge health is unavailable.</p> : <div className="mt-4 grid grid-cols-3 gap-2">{[{ label: "Ready", value: readyCount ?? 0 }, { label: "Processing", value: counts.processing }, { label: "Failed", value: counts.failed }].map((item) => <div key={item.label} className="rounded-lg bg-surface-low/35 p-3"><p className="text-[10px] text-text-muted">{item.label}</p><p className="mt-2 text-xl font-semibold tabular-nums text-foreground">{item.value}</p></div>)}</div>}
        </section>

        <section className="min-w-0 rounded-xl border border-border bg-background p-4 sm:p-5">
          <header className="flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold text-foreground">Recent knowledge</h2><p className="mt-1 text-[11px] text-text-muted">Available source records; added dates are not reported</p></div>{sourceCount && sourceCount > overviewFiles.length ? <Button type="button" variant="ghost" size="sm" onClick={onOpenSources}>View all</Button> : null}</header>
          <div className="mt-4 divide-y divide-border">
            {collection.filesError ? <p className="py-6 text-center text-xs text-text-muted">Source records are unavailable.</p> : collection.files === null ? <div className="flex min-h-28 items-center justify-center" role="status"><Loader2 className="h-4 w-4 animate-spin text-text-muted motion-reduce:animate-none" /><span className="sr-only">Loading source records</span></div> : overviewFiles.length > 0 ? overviewFiles.map((file) => <button key={`${file.id}:${file.path}`} type="button" onClick={() => onSelectFile(file)} className="flex w-full items-center gap-3 py-2.5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-low text-text-muted"><FileText className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><strong className="block truncate text-xs font-medium text-foreground">{fileName(file)}</strong><span className="mt-0.5 block truncate text-[10px] text-text-muted">Added date not available</span></span><span className="inline-flex items-center gap-1.5 text-[10px] text-text-muted"><span className={`h-1.5 w-1.5 rounded-full ${fileHealthClasses(file)}`} aria-hidden="true" />{knowledgeFileStatusLabel(file)}</span></button>) : <div className="py-8 text-center"><FileText className="mx-auto h-4 w-4 text-text-muted" /><p className="mt-2 text-xs font-semibold text-foreground">No knowledge yet</p>{canWrite ? <button type="button" onClick={onOpenSources} className="mt-2 text-[11px] font-semibold text-[var(--selection-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Add knowledge</button> : <p className="mt-2 text-[11px] text-text-muted">Contributor access is required to add knowledge.</p>}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function CollectionSettings({
  open,
  onOpenChange,
  collection,
  busy,
  nameInputId,
  onSave,
  onRequestProductUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: KnowledgeHubCollection;
  busy: boolean;
  nameInputId: string;
  onSave: (name: string, description: string) => Promise<void>;
  onRequestProductUse?: () => boolean;
}) {
  const initialName = knowledgeWorkspaceName(collection.workspace);
  const initialDescription = collection.workspace.description?.trim() ?? "";
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAdminister = collectionCanAdminister(collection);
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const hasChanges = trimmedName !== initialName || trimmedDescription !== initialDescription;
  const descriptionInputId = `${nameInputId}-description`;

  function resetDraft() {
    setName(initialName);
    setDescription(initialDescription);
    setError(null);
  }

  function changeOpen(nextOpen: boolean) {
    if ((saving || busy) && !nextOpen) return;
    if (!nextOpen) resetDraft();
    onOpenChange(nextOpen);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedName || saving || !canAdminister || !hasChanges) return;
    if (onRequestProductUse && !onRequestProductUse()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmedName, trimmedDescription);
      onOpenChange(false);
    } catch (cause) {
      setError(describeKnowledgeHubError(cause, "Collection details couldn't be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[37.5rem] overflow-hidden gap-0 rounded-2xl border-border p-0 motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none max-md:inset-0 max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none sm:max-w-[37.5rem]">
        <form onSubmit={submit} className="flex h-full min-h-0 flex-col overflow-hidden">
          <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-14 text-left sm:px-6">
            <DialogTitle className="text-xl tracking-[-0.02em]">Edit details</DialogTitle>
            <DialogDescription className="leading-relaxed">Update the name and description for this Collection.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            <div>
              <label className="mb-2 block text-xs font-semibold text-foreground" htmlFor={nameInputId}>
                Name <span className="text-destructive" aria-hidden="true">*</span>
              </label>
              <Input
                id={nameInputId}
                autoFocus
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
                disabled={!canAdminister || busy}
                maxLength={120}
                required
                aria-invalid={!trimmedName}
                className="h-10 rounded-lg border-border bg-input-background px-3 text-sm"
              />
              {!trimmedName ? <p className="mt-1.5 text-[11px] leading-relaxed text-destructive">A Collection name is required.</p> : null}
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold text-foreground" htmlFor={descriptionInputId}>Description</label>
              <Textarea
                id={descriptionInputId}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setError(null);
                }}
                disabled={!canAdminister || busy}
                rows={3}
                maxLength={280}
                placeholder="What should agents use this Collection for?"
                className="min-h-20 resize-y rounded-lg border-border bg-input-background px-3 py-2.5 text-sm leading-relaxed"
              />
            </div>

            {error ? <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs leading-relaxed text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div> : null}
          </div>

          <DialogFooter className="shrink-0 !flex-row justify-end border-t border-border bg-surface-low/25 px-5 py-4 sm:px-6">
            <Button type="button" variant="ghost" onClick={() => changeOpen(false)} disabled={saving || busy}>Cancel</Button>
            <Button type="submit" disabled={!canAdminister || !trimmedName || !hasChanges || busy || saving} className="min-w-32">
              {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
              {saving ? "Saving" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FileDetails({
  collection,
  file,
  busy,
  onSave,
  onRequestProductUse,
}: {
  collection: KnowledgeHubCollection;
  file: WorkspaceFile;
  busy: boolean;
  onSave: (input: { displayName: string; keywords: string[]; summary: string | null }) => Promise<void>;
  onRequestProductUse?: () => boolean;
}) {
  const initialDisplayName = fileName(file);
  const initialKeywords = parseKeywords(file.keywords.join(","));
  const initialSummary = file.summary?.trim() ?? "";
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [keywords, setKeywords] = useState(initialKeywords);
  const [keywordInput, setKeywordInput] = useState("");
  const [summary, setSummary] = useState(initialSummary);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canWrite = collectionCanWrite(collection);
  const trimmedDisplayName = displayName.trim();
  const trimmedSummary = summary.trim();
  const submittedKeywords = parseKeywords([...keywords, keywordInput].join(","));
  const hasChanges = trimmedDisplayName !== initialDisplayName
    || trimmedSummary !== initialSummary
    || submittedKeywords.join("\u0000") !== initialKeywords.join("\u0000");
  const summaryWordCount = trimmedSummary ? trimmedSummary.split(/\s+/).length : 0;

  function addKeywords(value: string) {
    const additions = parseKeywords(value);
    if (additions.length === 0) return;
    setKeywords((current) => parseKeywords([...current, ...additions].join(",")));
    setKeywordInput("");
    setError(null);
  }

  function changeKeywordInput(value: string) {
    const entries = value.split(",");
    if (entries.length === 1) {
      setKeywordInput(value);
      return;
    }
    addKeywords(entries.slice(0, -1).join(","));
    setKeywordInput(entries.at(-1)?.trimStart() ?? "");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedDisplayName || !hasChanges || saving || busy || !canWrite) return;
    if (onRequestProductUse && !onRequestProductUse()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        displayName: trimmedDisplayName,
        keywords: submittedKeywords,
        summary: trimmedSummary || null,
      });
    } catch (cause) {
      setError(describeKnowledgeHubError(cause, "Source details couldn't be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-[-0.015em] text-foreground">Source metadata</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">Shape how agents recognize this source and when it appears in knowledge discovery.</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${!canWrite ? "border-border bg-surface-high text-text-muted" : hasChanges ? "border-warning/30 bg-warning/10 text-warning" : "border-success/25 bg-success/10 text-success"}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {!canWrite ? "Read only" : hasChanges ? "Unsaved" : "Up to date"}
        </span>
      </header>

      <div data-slot="source-metadata-layout" className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 23rem), 1fr))" }}>
        <section className="overflow-hidden rounded-2xl border border-border bg-background">
          <header className="flex items-start gap-3 border-b border-border bg-surface-low/25 px-4 py-4 sm:px-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-text-secondary"><Pencil className="h-4 w-4" /></span>
            <div>
              <h4 className="text-sm font-semibold text-foreground">Agent-facing identity</h4>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">Name the source clearly and explain what it contributes.</p>
            </div>
          </header>
          <div className="space-y-5 p-4 sm:p-5">
            <label className="block">
              <span className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-text-secondary">
                <span>Display name</span>
                <span aria-hidden="true" className="text-[10px] font-normal tabular-nums text-text-muted">{displayName.length} characters</span>
              </span>
              <Input
                value={displayName}
                onChange={(event) => { setDisplayName(event.target.value); setError(null); }}
                disabled={!canWrite || busy}
                className="h-11 rounded-xl border-border bg-input-background px-3.5 text-sm font-medium"
              />
            </label>
            <label className="block">
              <span className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-text-secondary">
                <span>Agent summary</span>
                <span aria-hidden="true" className="text-[10px] font-normal tabular-nums text-text-muted">{summaryWordCount} word{summaryWordCount === 1 ? "" : "s"}</span>
              </span>
              <Textarea
                value={summary}
                onChange={(event) => { setSummary(event.target.value); setError(null); }}
                disabled={!canWrite || busy}
                rows={7}
                placeholder="Explain what this source contains and when an agent should use it."
                className="min-h-40 resize-y rounded-xl border-border bg-input-background px-3.5 py-3 text-sm leading-relaxed"
              />
              <span className="mt-2 block text-[11px] leading-relaxed text-text-muted">Focus on scope and intended use, not a full document abstract.</span>
            </label>
          </div>
          <div className="border-t border-border bg-surface-low/20 px-4 py-4 sm:px-5">
            <p className="text-[10px] font-medium text-text-muted">Agent-facing preview</p>
            <p className="mt-2 truncate text-[13px] font-semibold text-foreground">{trimmedDisplayName || "Untitled source"}</p>
            <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-text-muted">{trimmedSummary || "No summary yet. Agents will rely on the source name and discovery keywords."}</p>
          </div>
        </section>

        <aside className="overflow-hidden rounded-2xl border border-border bg-surface-low/20">
          <header className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-text-secondary"><Search className="h-4 w-4" /></span>
            <div>
              <h4 className="text-sm font-semibold text-foreground">Discovery signals</h4>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">Add concise terms agents may use when looking for this source.</p>
            </div>
          </header>
          <div className="p-4 sm:p-5">
            <div className="flex min-h-10 flex-wrap gap-2" aria-label="Source keywords">
              {keywords.length > 0 ? keywords.map((keyword) => canWrite ? (
                <button
                  key={keyword}
                  type="button"
                  onClick={() => { setKeywords((current) => current.filter((entry) => entry !== keyword)); setError(null); }}
                  disabled={busy}
                  aria-label={`Remove keyword ${keyword}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-2.5 py-1 text-[10px] font-medium text-[var(--selection-accent)] transition-colors hover:bg-[rgb(var(--selection-accent-rgb)_/_0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <span className="truncate">{keyword}</span><X className="h-3 w-3 shrink-0" />
                </button>
              ) : (
                <span key={keyword} className="inline-flex max-w-full items-center rounded-full border border-border bg-background px-2.5 py-1 text-[10px] text-text-secondary"><span className="truncate">{keyword}</span></span>
              )) : <span className="text-[11px] leading-relaxed text-text-muted">No discovery keywords yet.</span>}
            </div>
            {canWrite ? (
              <div className="mt-4 flex items-center gap-2">
                <Input
                  value={keywordInput}
                  onChange={(event) => changeKeywordInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== ",") return;
                    event.preventDefault();
                    addKeywords(keywordInput);
                  }}
                  disabled={busy}
                  aria-label="Add keyword"
                  placeholder="Add a discovery term"
                  className="h-9 rounded-xl border-border bg-background text-xs"
                />
                <Button type="button" variant="outline" size="icon" onClick={() => addKeywords(keywordInput)} disabled={!keywordInput.trim() || busy} aria-label="Add keyword" className="h-9 w-9 rounded-xl">
                  <Plus />
                </Button>
              </div>
            ) : null}
            <p className="mt-2 text-[10px] leading-relaxed text-text-muted">Press Enter or type a comma to add each keyword.</p>
          </div>
          <div className="border-t border-border bg-background/55 px-4 py-4 sm:px-5">
            <h4 className="text-xs font-semibold text-foreground">Source record</h4>
            <dl className="mt-3 divide-y divide-border text-[11px]">
              <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0"><dt className="text-text-muted">Path</dt><dd className="max-w-[70%] break-all text-right font-mono text-[10px] text-text-secondary">{file.path}</dd></div>
              <div className="flex items-start justify-between gap-4 py-2.5"><dt className="text-text-muted">Processing</dt><dd className="inline-flex items-center gap-1.5 font-medium text-text-secondary"><span className={`h-1.5 w-1.5 rounded-full ${fileHealthClasses(file)}`} aria-hidden="true" />{knowledgeFileStatusLabel(file)}</dd></div>
              <div className="flex items-start justify-between gap-4 py-2.5 last:pb-0"><dt className="text-text-muted">Version</dt><dd className="max-w-[70%] truncate text-right font-mono text-[10px] text-text-secondary" title={file.currentVersionId ?? undefined}>{file.currentVersionId || "Not available"}</dd></div>
            </dl>
          </div>
        </aside>
      </div>

      {error ? (
        <div role="alert" className="mt-5 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs leading-relaxed text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>
      ) : null}
      {canWrite ? (
        <footer className="mt-5 flex flex-col gap-3 rounded-2xl border border-border bg-surface-low/30 px-4 py-3.5 sm:!flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${hasChanges ? "bg-warning" : "bg-success"}`} aria-hidden="true" />
            <div><p className="text-xs font-medium text-text-secondary">{hasChanges ? "Metadata has unsaved changes" : "Metadata is up to date"}</p><p className="mt-0.5 text-[10px] leading-relaxed text-text-muted">Changes affect how this source is labeled and discovered.</p></div>
          </div>
          <Button type="submit" disabled={!trimmedDisplayName || !hasChanges || busy || saving} className="min-w-36">
            {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Check />}
            {saving ? "Saving" : "Save metadata"}
          </Button>
        </footer>
      ) : (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-border bg-surface-low/30 px-4 py-4"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" /><p className="text-xs leading-relaxed text-text-muted">Contributor access is required to edit source metadata.</p></div>
      )}
    </form>
  );
}

function FilePreview({
  client,
  collection,
  file,
}: {
  client: WorkspacesAPI | null;
  collection: KnowledgeHubCollection;
  file: WorkspaceFile;
}) {
  const [mode, setMode] = useState<PreviewMode>("markdown");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<{ text: string; binary: boolean } | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const markdownReady = knowledgeFileHealth(file) === "ready";

  useEffect(() => {
    let cancelled = false;
    if (!client || (mode === "markdown" && !markdownReady)) return () => { cancelled = true; };
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      setSource(null);
      setMarkdown(null);
      void (async () => {
        try {
          if (mode === "source") {
            const result = await client.downloadFileBytes(
              knowledgeWorkspaceRef(collection.workspace),
              file.path,
              {},
              { raw: true },
            );
            if (!cancelled) setSource(textPreview(result.content));
          } else {
            const result = await client.markdownFile(knowledgeWorkspaceRef(collection.workspace), file.path);
            if (!cancelled) setMarkdown(result.markdown);
          }
        } catch (cause) {
          if (!cancelled) setError(describeKnowledgeHubError(cause, "The preview couldn't be loaded."));
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [client, collection.workspace, file.currentVersionId, file.path, markdownReady, mode]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={() => setMode("markdown")}
          aria-pressed={mode === "markdown"}
          className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === "markdown" ? "bg-surface-high text-foreground" : "text-text-muted hover:text-foreground"}`}
        >
          Agent view
        </button>
        <button
          type="button"
          onClick={() => setMode("source")}
          aria-pressed={mode === "source"}
          className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === "source" ? "bg-surface-high text-foreground" : "text-text-muted hover:text-foreground"}`}
        >
          Original
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {mode === "markdown" && !markdownReady ? (
          <div className="mx-auto mt-8 max-w-md rounded-xl border border-border bg-surface-low/30 px-5 py-6 text-center">
            <RefreshCw className="mx-auto h-5 w-5 text-text-muted" />
            <p className="mt-3 text-sm font-semibold text-foreground">Agent view is not ready</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              Current state: {knowledgeFileStatusLabel(file)}. Refresh or regenerate this source after processing finishes.
            </p>
          </div>
        ) : loading ? (
          <div className="flex h-full min-h-48 items-center justify-center" role="status" aria-label="Loading source preview">
            <Loader2 className="h-5 w-5 animate-spin text-text-muted motion-reduce:animate-none" />
          </div>
        ) : error ? (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs leading-relaxed text-destructive">
            {error}
          </div>
        ) : mode === "source" ? (
          source?.binary ? (
            <div className="rounded-xl border border-border bg-surface-low/30 px-4 py-4 text-xs leading-relaxed text-text-muted">
              This source is binary. Download the original file to inspect it.
            </div>
          ) : (
            <pre className="min-h-full whitespace-pre-wrap break-words rounded-xl border border-border bg-surface-low/30 p-4 text-xs leading-relaxed text-foreground">{source?.text ?? ""}</pre>
          )
        ) : markdown !== null ? (
          <div className="mx-auto max-w-3xl rounded-xl border border-border bg-surface-low/20 p-4 sm:p-6">
            <MarkdownContent content={markdown} className="text-[13px] leading-relaxed text-foreground" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AgentAccessRow({
  agent,
  assigned,
  busy,
  canManage,
  actionDisabled,
  onToggle,
}: {
  agent: KnowledgeHubAgent;
  assigned: boolean;
  busy: boolean;
  canManage: boolean;
  actionDisabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
}) {
  const name = agentName(agent);

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${assigned ? "border-[var(--selection-accent-border)] bg-background/80" : "border-border bg-surface-low/20 hover:bg-surface-low/45"}`}>
      <Avatar className={`h-10 w-10 shrink-0 rounded-lg border ${assigned ? "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)]" : "border-border bg-surface-high"}`}>
        {agent.avatarUrl ? <AvatarImage src={agent.avatarUrl} alt={`${name} avatar`} /> : null}
        <AvatarFallback className={`text-[10px] font-semibold ${assigned ? "text-[var(--selection-accent)]" : "text-text-secondary"}`}>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground">{name}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[10px] text-text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${agentStateClass(agent.state)}`} aria-hidden="true" />
          {titleize(agent.state)}
          <span aria-hidden="true">·</span>
          {assigned ? "Direct access" : "Not assigned"}
        </p>
      </div>
      {canManage ? (
        <button
          type="button"
          aria-pressed={assigned}
          aria-label={assigned ? `Remove ${name} from Collection` : `Assign ${name} to Collection`}
          disabled={actionDisabled}
          onClick={() => void onToggle(!assigned).catch(() => undefined)}
          className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50 ${assigned ? "border-transparent bg-transparent text-text-muted hover:border-destructive/25 hover:bg-destructive/10 hover:text-destructive" : "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)] hover:bg-[rgb(var(--selection-accent-rgb)_/_0.16)]"}`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : assigned ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {assigned ? "Remove" : "Assign"}
        </button>
      ) : (
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium ${assigned ? "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]" : "border-border bg-background text-text-muted"}`}>
          {assigned ? "Has access" : "Not assigned"}
        </span>
      )}
    </div>
  );
}

function AgentAccessSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1].map((index) => (
        <div key={index} className="flex animate-pulse items-center gap-3 rounded-xl border border-border bg-background/60 px-3.5 py-3 motion-reduce:animate-none">
          <span className="h-10 w-10 shrink-0 rounded-full bg-surface-high" />
          <span className="min-w-0 flex-1 space-y-2"><span className="block h-3 w-2/3 rounded bg-surface-high" /><span className="block h-2 w-1/3 rounded bg-surface-high" /></span>
          <span className="h-8 w-16 rounded-lg bg-surface-high" />
        </div>
      ))}
    </div>
  );
}

function AgentAccess({
  collection,
  agents,
  agentsLoading,
  agentsError,
  busyAgentId,
  onToggle,
}: {
  collection: KnowledgeHubCollection;
  agents: KnowledgeHubAgent[];
  agentsLoading: boolean;
  agentsError: string | null;
  busyAgentId: string | null;
  onToggle: (agentId: string, enabled: boolean) => Promise<void>;
}) {
  const canAdminister = collectionCanAdminister(collection);
  const assignedIds = new Set(collection.agentIds ?? []);
  const knownIds = new Set(agents.map((agent) => agent.id));
  const unknownAssignedIds = (collection.agentIds ?? []).filter((agentId) => !knownIds.has(agentId));
  const assignedAgents = agentsError ? [] : agents.filter((agent) => assignedIds.has(agent.id));
  const availableAgents = agentsError ? [] : agents.filter((agent) => !assignedIds.has(agent.id));
  const assignedIdentifiers = agentsError ? collection.agentIds ?? [] : unknownAssignedIds;
  const collectionName = knowledgeWorkspaceName(collection.workspace);

  if (collection.accessError) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-5 py-5 text-warning">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold">Agent access is unavailable</h3>
            <p className="mt-1 text-xs leading-relaxed">{collection.accessError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (collection.agentIds === null) {
    return (
      <div className="mx-auto flex h-full min-h-72 w-full max-w-5xl items-center justify-center p-6 text-center">
        <div className="max-w-md rounded-2xl border border-border bg-surface-low/25 px-7 py-8">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-text-muted"><ShieldCheck className="h-5 w-5" /></span>
          <h3 className="mt-4 text-base font-semibold text-foreground">Agent assignments are scoped</h3>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">
            Collection admins can review all direct agent assignments. Your own access remains unchanged.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
      <section data-slot="agent-access-boundary" className="overflow-hidden rounded-2xl border border-border bg-background">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-surface-low/30 px-5 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-[var(--selection-accent)]" />
              <h3 className="text-base font-semibold tracking-[-0.015em] text-foreground">Agent access boundary</h3>
            </div>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-text-muted">
              Only assigned agents can access sources in {collectionName}.
            </p>
          </div>
          <div className="flex shrink-0 items-center rounded-full border border-border bg-background px-1 py-1 text-[10px] text-text-muted">
            <span className="px-2.5 py-1"><strong className="mr-1 text-xs font-semibold tabular-nums text-foreground">{collection.agentIds.length}</strong> assigned</span>
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            <span className="px-2.5 py-1"><strong className="mr-1 text-xs font-semibold tabular-nums text-foreground">{agentsError ? "---" : availableAgents.length}</strong> available</span>
          </div>
        </header>

        {agentsError ? (
          <div role="status" className="flex items-start gap-2 border-b border-warning/25 bg-warning/10 px-5 py-3 text-xs leading-relaxed text-warning">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Agent details are unavailable. Existing assignments are shown by identifier{canAdminister ? " and can still be removed" : ""}. {agentsError}
          </div>
        ) : null}
        {agentsLoading ? <span className="sr-only" role="status">Loading agents</span> : null}

        <div className="grid gap-px bg-border lg:grid-cols-2">
          <section data-lane="assigned" aria-labelledby="assigned-collection-agents-heading" className="min-h-72 bg-[rgb(var(--selection-accent-rgb)_/_0.045)]">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--selection-accent-border)] px-4 py-3.5 sm:px-5">
              <div>
                <h4 id="assigned-collection-agents-heading" className="text-[13px] font-semibold text-foreground">Inside this Collection</h4>
                <p className="mt-0.5 text-[10px] text-text-muted">Direct access granted</p>
              </div>
              <span className="rounded-full border border-[var(--selection-accent-border)] bg-background/80 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--selection-accent)]">{collection.agentIds.length}</span>
            </header>
            <div className="p-3 sm:p-4">
              {agentsLoading ? (
                <AgentAccessSkeleton />
              ) : assignedAgents.length > 0 || assignedIdentifiers.length > 0 ? (
                <div className="space-y-2">
                  {assignedAgents.map((agent) => (
                    <AgentAccessRow
                      key={agent.id}
                      agent={agent}
                      assigned
                      busy={busyAgentId === agent.id}
                      canManage={canAdminister && !agentsError}
                      actionDisabled={Boolean(busyAgentId)}
                      onToggle={(enabled) => onToggle(agent.id, enabled)}
                    />
                  ))}
                  {assignedIdentifiers.map((agentId) => (
                    <div key={agentId} className="flex items-center gap-3 rounded-xl border border-[var(--selection-accent-border)] bg-background/80 px-3.5 py-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]"><ShieldCheck className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-foreground" title={agentId}>{agentId}</span><span className="mt-1 block text-[10px] text-text-muted">Outside the visible roster</span></span>
                      {canAdminister ? (
                        <button
                          type="button"
                          aria-label={`Remove ${agentId} from Collection`}
                          disabled={Boolean(busyAgentId)}
                          onClick={() => { void onToggle(agentId, false).catch(() => undefined); }}
                          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent px-2.5 text-[11px] font-medium text-text-muted transition-colors hover:border-destructive/25 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
                        >
                          {busyAgentId === agentId ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <X className="h-3.5 w-3.5" />}
                          Remove
                        </button>
                      ) : <span className="shrink-0 rounded-full border border-[var(--selection-accent-border)] px-2 py-1 text-[9px] font-medium text-[var(--selection-accent)]">Direct access</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-48 items-center justify-center px-4 py-8 text-center">
                  <div className="max-w-xs">
                    <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--selection-accent-border)] bg-background/70 text-[var(--selection-accent)]"><ShieldCheck className="h-4 w-4" /></span>
                    <h4 className="mt-3 text-[13px] font-semibold text-foreground">The boundary is empty</h4>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-muted">Assign an available agent to give it direct access to this Collection.</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section data-lane="available" aria-labelledby="available-collection-agents-heading" className="min-h-72 bg-background">
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
              <div>
                <h4 id="available-collection-agents-heading" className="text-[13px] font-semibold text-foreground">Available agents</h4>
                <p className="mt-0.5 text-[10px] text-text-muted">Outside this Collection</p>
              </div>
              <span className="rounded-full border border-border bg-surface-low px-2 py-0.5 text-[10px] font-semibold tabular-nums text-text-secondary">{agentsError ? "---" : availableAgents.length}</span>
            </header>
            <div className="p-3 sm:p-4">
              {agentsLoading ? (
                <AgentAccessSkeleton />
              ) : agentsError ? (
                <div className="flex min-h-48 items-center justify-center px-4 py-8 text-center">
                  <div className="max-w-xs"><AlertCircle className="mx-auto h-5 w-5 text-warning" /><h4 className="mt-3 text-[13px] font-semibold text-foreground">Roster unavailable</h4><p className="mt-1 text-[11px] leading-relaxed text-text-muted">Refresh Knowledge to load agents that can be assigned.</p></div>
                </div>
              ) : availableAgents.length > 0 ? (
                <div className="space-y-2">
                  {availableAgents.map((agent) => (
                    <AgentAccessRow
                      key={agent.id}
                      agent={agent}
                      assigned={false}
                      busy={busyAgentId === agent.id}
                      canManage={canAdminister}
                      actionDisabled={Boolean(busyAgentId)}
                      onToggle={(enabled) => onToggle(agent.id, enabled)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-48 items-center justify-center px-4 py-8 text-center">
                  <div className="max-w-xs">
                    <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-low text-text-muted"><Bot className="h-4 w-4" /></span>
                    <h4 className="mt-3 text-[13px] font-semibold text-foreground">{agents.length === 0 ? "No agents available" : "Every agent is assigned"}</h4>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{agents.length === 0 ? "Launch an agent before assigning it to this Collection." : "All visible agents are already inside this Collection boundary."}</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="flex items-start gap-2.5 border-t border-border bg-surface-low/25 px-5 py-3.5 text-[11px] leading-relaxed text-text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--selection-accent)]" />
          Assignment grants access to this Collection. It does not indicate that an agent has synchronized or used a source.
        </footer>
      </section>
    </div>
  );
}

function CollectionAgents({
  collection,
  agents,
  agentsLoading,
  agentsError,
  busyAgentId,
  onManage,
  onRemove,
}: {
  collection: KnowledgeHubCollection;
  agents: KnowledgeHubAgent[];
  agentsLoading: boolean;
  agentsError: string | null;
  busyAgentId: string | null;
  onManage: () => void;
  onRemove: (agentId: string, label: string) => void;
}) {
  const canAdminister = collectionCanAdminister(collection);
  const assignedIds = collection.agentIds ?? [];
  const assignedRows = assignedIds.map((agentId) => ({
    id: agentId,
    agent: agentsError ? null : agents.find((candidate) => candidate.id === agentId) ?? null,
  }));

  return (
    <div className="mx-auto w-full max-w-[92rem] px-4 pb-10 pt-6 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-col items-start gap-4 sm:!flex-row sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Assigned agents</h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-text-muted">These agents have direct access to everything in this Collection.</p>
        </div>
        {canAdminister && !collection.accessError && collection.agentIds !== null ? <Button type="button" onClick={onManage}><UsersRound /> Manage agents</Button> : null}
      </header>

      {collection.accessError ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-5 py-5 text-warning"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><div><h3 className="text-sm font-semibold">Agent access is unavailable</h3><p className="mt-1 text-xs leading-relaxed">{collection.accessError}</p></div></div>
      ) : collection.agentIds === null ? (
        <section className="flex min-h-[26rem] items-center justify-center rounded-xl border border-border bg-surface-low/15 px-6 py-12 text-center"><div className="max-w-md"><span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-text-muted"><ShieldCheck className="h-5 w-5" /></span><h3 className="mt-4 text-lg font-semibold tracking-[-0.02em] text-foreground">Agent assignments are scoped</h3><p className="mt-2 text-xs leading-relaxed text-text-muted">Collection admins can review all direct assignments. Your own access remains unchanged.</p></div></section>
      ) : assignedRows.length > 0 ? (
        <section aria-label="Assigned agents list" className="overflow-hidden rounded-xl border border-border bg-background">
          {agentsError ? <div role="status" className="flex items-start gap-2 border-b border-warning/25 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-warning"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Agent details are unavailable. Existing assignments remain visible by identifier{canAdminister ? " and can still be removed" : ""}.</div> : null}
          {agentsLoading ? <span className="sr-only" role="status">Loading agent details</span> : null}
          <div className="hidden min-h-11 grid-cols-[minmax(18rem,1fr)_10rem_8rem] items-center gap-4 border-b border-border bg-surface-low/35 px-5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted lg:grid"><span>Agent</span><span>Status</span><span className="sr-only">Actions</span></div>
          <div className="divide-y divide-border">
            {assignedRows.map(({ id, agent }) => {
              const label = agent ? agentName(agent) : id;
              return (
                <article key={id} className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(18rem,1fr)_10rem_8rem] lg:gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-9 w-9 shrink-0 rounded-lg border border-border bg-surface-high">
                      {agent?.avatarUrl ? <AvatarImage src={agent.avatarUrl} alt="" /> : null}
                      <AvatarFallback className="text-[9px] font-semibold text-text-secondary">{initials(label)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0"><strong className="block truncate text-xs font-semibold text-foreground">{label}</strong><span className="mt-1 block truncate text-[10px] text-text-muted">{agent ? agent.id : agentsLoading ? "Agent details loading" : agentsError ? "Agent details unavailable" : "Outside the visible roster"}</span></span>
                  </div>
                  <div className="col-start-1 row-start-2 pl-12 text-[10px] text-text-muted lg:col-start-2 lg:row-start-1 lg:pl-0">
                    {agent ? <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${agentStateClass(agent.state)}`} aria-hidden="true" />{titleize(agent.state)}</span> : <span>{agentsLoading ? "Loading" : agentsError ? "Unavailable" : "Roster unknown"}</span>}
                  </div>
                  <div className="col-start-2 row-span-2 row-start-1 flex justify-end lg:col-start-3 lg:row-span-1">
                    {canAdminister ? <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${label} from Collection`} disabled={Boolean(busyAgentId)} onClick={() => onRemove(id, label)} className="text-text-muted hover:text-destructive">{busyAgentId === id ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null} Remove</Button> : <span className="text-[10px] text-text-muted">Direct access</span>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="flex min-h-[28rem] items-center justify-center rounded-xl border border-border bg-surface-low/15 px-6 py-12 text-center">
          <div className="max-w-lg">
            <div className="relative mx-auto h-20 w-32" aria-hidden="true"><span className="absolute left-1/2 top-5 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-xl border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]"><LibraryBig className="h-5 w-5" /></span><span className="absolute left-3 top-9 h-px w-10 bg-border" /><span className="absolute right-3 top-9 h-px w-10 bg-border" /><span className="absolute left-0 top-6 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-text-muted"><Bot className="h-3.5 w-3.5" /></span><span className="absolute right-0 top-6 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-text-muted"><Bot className="h-3.5 w-3.5" /></span></div>
            <h3 className="mt-2 text-xl font-semibold tracking-[-0.025em] text-foreground">Share this Collection with agents</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">Assigned agents receive direct access to this Collection&apos;s knowledge in addition to their own workspace.</p>
            {canAdminister ? <Button type="button" onClick={onManage} className="mt-5">Assign agents <ArrowRight /></Button> : <p className="mt-4 text-xs text-text-muted">Collection admin access is required to assign agents.</p>}
            <p className="mt-4 text-[11px] text-text-muted"><Info className="mr-1 inline h-3 w-3" />An agent can belong to more than one Collection.</p>
          </div>
        </section>
      )}
    </div>
  );
}

function CollectionsIndex({
  collections,
  visibleCollections,
  loading,
  query,
  searchId,
  agents,
  createDisabled,
  onQueryChange,
  onSelectCollection,
  onEditCollection,
  onDeleteCollection,
  onOpenKnowledge,
  onCreateCollection,
  headingRef,
}: {
  collections: KnowledgeHubCollection[];
  visibleCollections: KnowledgeHubCollection[];
  loading: boolean;
  query: string;
  searchId: string;
  agents: KnowledgeHubAgent[];
  createDisabled: boolean;
  onQueryChange: (query: string) => void;
  onSelectCollection: (collection: KnowledgeHubCollection) => void;
  onEditCollection: (collection: KnowledgeHubCollection) => void;
  onDeleteCollection: (collection: KnowledgeHubCollection) => void;
  onOpenKnowledge: (collection: KnowledgeHubCollection, failedOnly: boolean) => void;
  onCreateCollection: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="mx-auto w-full max-w-[92rem] px-4 pb-10 pt-7 sm:px-6 sm:pt-8 lg:px-8">
      <header className="mb-7 flex flex-col gap-5 sm:!flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-semibold tracking-[-0.04em] text-foreground outline-none">Collections</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">Each Collection brings together shared knowledge and the agents assigned to it. Skills and integrations are coming soon.</p>
        </div>
        <Button type="button" onClick={onCreateCollection} disabled={createDisabled} className="shrink-0 self-start">New collection <Plus /></Button>
      </header>

      {loading || collections.length > 0 || query ? (
        <div className="mb-3 flex flex-col gap-3 sm:!flex-row sm:items-center sm:justify-between">
          <label htmlFor={searchId} className="relative block w-full sm:max-w-xs">
            <span className="sr-only">Search Collections and sources</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <Input id={searchId} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search Collections" className="h-9 rounded-lg bg-input-background pl-9 text-xs" />
          </label>
          <span className="text-xs tabular-nums text-text-muted">{visibleCollections.length} {visibleCollections.length === 1 ? "Collection" : "Collections"}</span>
        </div>
      ) : null}

      {loading && collections.length === 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-background" role="status" aria-label="Loading Collections">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex min-h-20 animate-pulse items-center gap-4 border-b border-border px-4 last:border-b-0 motion-reduce:animate-none sm:px-5">
              <span className="h-10 w-10 shrink-0 rounded-xl bg-surface-high" />
              <span className="min-w-0 flex-1 space-y-2"><span className="block h-3 w-1/3 rounded bg-surface-high" /><span className="block h-2.5 w-2/3 rounded bg-surface-high" /></span>
              <span className="hidden h-3 w-20 rounded bg-surface-high sm:block" />
            </div>
          ))}
        </div>
      ) : visibleCollections.length > 0 ? (
        <section aria-label="Collections catalog" className="rounded-xl border border-border bg-background max-md:border-0 max-md:bg-transparent">
          <div className="hidden min-h-11 grid-cols-[minmax(17rem,2fr)_minmax(10rem,.85fr)_minmax(11rem,1fr)_minmax(10rem,.9fr)_2.5rem] items-center gap-4 border-b border-border bg-surface-low/35 px-5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted xl:grid">
            <span>Collection</span><span>Resources</span><span>Assigned agents</span><span>Exceptions</span><span className="sr-only">Actions</span>
          </div>
          <div className="md:divide-y md:divide-border max-md:space-y-3">
            {visibleCollections.map((collection) => {
              const counts = fileHealthCounts(collection);
              const sourceCount = collection.files?.length ?? null;
              const assignedAgents = (collection.agentIds ?? []).map((agentId) => ({ id: agentId, agent: agents.find((candidate) => candidate.id === agentId) ?? null }));
              const canAdminister = collectionCanAdminister(collection);
              const deleteBlockedReason = collectionDeletionBlockedReason(collection.workspace);
              const collectionName = knowledgeWorkspaceName(collection.workspace);

              return (
                <article key={collection.workspace.id} className="group relative grid min-h-[11.75rem] grid-cols-[minmax(0,1fr)_2.5rem] content-between gap-x-3 gap-y-4 rounded-xl border border-border bg-background px-4 py-4 transition-colors hover:bg-surface-low/25 md:min-h-28 md:rounded-none md:border-0 md:px-5 xl:min-h-20 xl:grid-cols-[minmax(17rem,2fr)_minmax(10rem,.85fr)_minmax(11rem,1fr)_minmax(10rem,.9fr)_2.5rem] xl:items-center xl:content-normal xl:gap-4">
                  <button type="button" onClick={() => onSelectCollection(collection)} className="flex min-w-0 items-start gap-3 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:pr-0">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-high text-text-secondary"><LibraryBig className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm font-semibold text-foreground">{collectionName}</strong>
                      <span className="mt-1 line-clamp-1 block text-[11px] leading-relaxed text-text-muted">{collection.workspace.description || "No description yet."}</span>
                    </span>
                  </button>

                  <div className="col-span-2 grid grid-cols-2 gap-x-4 gap-y-3 pt-1 text-[11px] sm:grid-cols-3 md:pl-[3.25rem] xl:contents xl:pt-0 xl:pl-0">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="col-span-2 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:col-span-1 xl:col-span-1" aria-label={`Show resource breakdown for ${collectionName}`}>
                           <span className="block font-medium tabular-nums text-foreground">{sourceCount === null ? "Unavailable" : `${sourceCount} ${sourceCount === 1 ? "resource" : "resources"}`}</span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" sideOffset={7} className="z-[80] w-60 rounded-xl border-border p-3">
                        <p className="text-xs font-semibold text-foreground">Resource breakdown</p>
                        <div className="mt-3 space-y-2.5 text-[11px]"><div className="flex items-center justify-between gap-4"><span className="text-text-muted">Knowledge</span><span className="font-medium text-foreground">{sourceCount === null ? "Unavailable" : `${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`}</span></div><div className="flex items-center justify-between gap-4"><span className="text-text-muted">Skills</span><span className="font-medium text-text-secondary">Coming soon</span></div><div className="flex items-center justify-between gap-4"><span className="text-text-muted">Integrations</span><span className="font-medium text-text-secondary">Coming soon</span></div></div>
                      </PopoverContent>
                    </Popover>
                    <div className="min-w-0">
                      {collection.accessError ? <span className="text-warning">Unavailable</span> : collection.agentIds === null ? <span className="text-text-muted">Scoped</span> : collection.agentIds.length === 0 ? <span className="text-text-muted">No agents</span> : (
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-2" aria-hidden="true">
                            {assignedAgents.slice(0, 3).map(({ id, agent }) => {
                              const name = agent ? agentName(agent) : id;
                              return <Avatar key={id} className="h-7 w-7 border-2 border-background bg-surface-high">{agent?.avatarUrl ? <AvatarImage src={agent.avatarUrl} alt="" /> : null}<AvatarFallback className="text-[8px] font-semibold text-text-secondary">{initials(name)}</AvatarFallback></Avatar>;
                            })}
                          </div>
                          <span className="truncate text-text-secondary">{collection.agentIds.length} {collection.agentIds.length === 1 ? "agent" : "agents"}</span>
                        </div>
                      )}
                    </div>
                    <div className="col-span-1 min-w-0 text-right sm:text-left xl:col-span-1">
                      {collection.filesError ? <span className="inline-flex items-center gap-1.5 text-warning"><AlertCircle className="h-3.5 w-3.5" /> Status unavailable</span> : counts.failed > 0 ? (
                        <button type="button" onClick={() => onOpenKnowledge(collection, true)} className="inline-flex items-center gap-1.5 font-medium text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><AlertCircle className="h-3.5 w-3.5" />{counts.failed} {counts.failed === 1 ? "issue" : "issues"}</button>
                      ) : counts.processing > 0 ? (
                        <button type="button" onClick={() => onOpenKnowledge(collection, false)} className="inline-flex items-center gap-1.5 font-medium text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><RefreshCw className="h-3.5 w-3.5" />{counts.processing} processing</button>
                      ) : <span className="sr-only">No exceptions</span>}
                    </div>
                  </div>

                  <div className="col-start-2 row-start-1 flex justify-end xl:col-start-5 xl:row-start-auto">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" aria-label={`More actions for ${collectionName}`} className="h-8 w-8"><MoreHorizontal /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="z-[80] w-48 rounded-xl border-border">
                        <DropdownMenuItem onSelect={() => onSelectCollection(collection)}>Open Collection</DropdownMenuItem>
                        {canAdminister ? <DropdownMenuItem onSelect={() => onEditCollection(collection)}><Pencil /> Edit details</DropdownMenuItem> : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={!canAdminister || Boolean(deleteBlockedReason)} onSelect={() => onDeleteCollection(collection)} className="text-destructive focus:text-destructive"><Trash2 />{deleteBlockedReason ? "Protected Collection" : "Delete Collection"}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="flex min-h-[35rem] items-center justify-center px-2 py-16 text-center sm:px-6 sm:py-[4.5rem]">
          <div className="max-w-4xl">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-text-muted">{query ? <Search className="h-5 w-5" /> : <LibraryBig className="h-5 w-5" />}</span>
            <h2 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-foreground">{query ? "No Collections found" : "Create a shared foundation for your agents"}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-text-muted">{query ? "Try a different search or clear the current query." : "A Collection brings shared knowledge, skills, and integrations together and makes them available to every agent you assign."}</p>
            {!query ? (
              <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:!flex-row" aria-label="Knowledge, skills, and integrations flow into a Collection and become available to assigned agents">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-low px-3 text-xs font-medium text-text-secondary"><FileText className="h-3.5 w-3.5" /> Knowledge</span>
                  <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-low px-3 text-xs font-medium text-text-secondary"><Sparkles className="h-3.5 w-3.5" /> Skills</span>
                  <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-low px-3 text-xs font-medium text-text-secondary"><Link2 className="h-3.5 w-3.5" /> Integrations</span>
                </div>
                <ArrowRight className="h-4 w-4 rotate-90 text-text-muted sm:rotate-0" aria-hidden="true" />
                <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-strong bg-surface-high px-3 text-xs font-semibold text-foreground"><LibraryBig className="h-3.5 w-3.5" /> Collection</span>
                <ArrowRight className="h-4 w-4 rotate-90 text-text-muted sm:rotate-0" aria-hidden="true" />
                <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-low px-3 text-xs font-medium text-text-secondary">
                  <UsersRound className="h-3.5 w-3.5" /> Assigned agents
                  {agents.length > 0 ? <span className="ml-1 flex -space-x-1.5" aria-hidden="true">{agents.slice(0, 3).map((agent) => <span key={agent.id} className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-surface-high text-[6px] font-semibold text-text-secondary">{initials(agentName(agent))}</span>)}</span> : null}
                </span>
              </div>
            ) : null}
            {!query ? <p className="mx-auto mt-6 max-w-xl text-[11px] leading-relaxed text-text-muted">Assign agents now or later. They will automatically receive resources added to this Collection.</p> : null}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {query ? <Button type="button" variant="outline" onClick={() => onQueryChange("")}>Clear search</Button> : <Button type="button" onClick={onCreateCollection} disabled={createDisabled}>Create your first collection <Plus /></Button>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function CollectionKnowledge({
  collection,
  files,
  query,
  filter,
  fileInputId,
  busy,
  dragOver,
  onQueryChange,
  onFilterChange,
  onUpload,
  onDragOverChange,
  onSelectFile,
  onDownload,
  onRegenerate,
  onDelete,
  onRetryAll,
}: {
  collection: KnowledgeHubCollection;
  files: WorkspaceFile[];
  query: string;
  filter: KnowledgeFileFilter;
  fileInputId: string;
  busy: boolean;
  dragOver: boolean;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: KnowledgeFileFilter) => void;
  onUpload: (files: File[]) => void;
  onDragOverChange: (active: boolean) => void;
  onSelectFile: (file: WorkspaceFile) => void;
  onDownload: (file: WorkspaceFile) => void;
  onRegenerate: (file: WorkspaceFile) => void;
  onDelete: (file: WorkspaceFile) => void;
  onRetryAll: () => void;
}) {
  const canWrite = collectionCanWrite(collection);
  const allFiles = collection.files ?? [];
  const failedCount = allFiles.filter((file) => knowledgeFileHealth(file) === "failed").length;

  function chooseFiles(fileList: FileList | null) {
    const nextFiles = Array.from(fileList ?? []);
    if (nextFiles.length > 0) onUpload(nextFiles);
  }

  return (
    <div
      className={`relative mx-auto w-full max-w-[92rem] px-4 pb-10 pt-5 sm:px-6 lg:px-8 ${dragOver ? "bg-[rgb(var(--selection-accent-rgb)_/_0.035)]" : ""}`}
      onDragOver={(event) => { event.preventDefault(); if (canWrite && !busy) onDragOverChange(true); }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) onDragOverChange(false); }}
      onDrop={(event) => { event.preventDefault(); onDragOverChange(false); if (canWrite && !busy) chooseFiles(event.dataTransfer.files); }}
    >
      {dragOver ? (
        <div className="pointer-events-none absolute inset-4 z-30 flex items-center justify-center rounded-2xl border border-dashed border-[var(--selection-accent-border)] bg-background/95">
          <div className="text-center"><Upload className="mx-auto h-5 w-5 text-[var(--selection-accent)]" /><p className="mt-2 text-sm font-semibold text-foreground">Drop sources to upload</p></div>
        </div>
      ) : null}

      <header className="mb-5 flex flex-col gap-4 lg:!flex-row lg:items-start lg:justify-between">
        <div><h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Knowledge</h2><p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-text-muted">Add the files and reference material assigned agents should use for context.</p></div>
        <div className="flex w-full items-center gap-2 lg:w-auto">
          <label className="relative block min-w-0 flex-1 lg:w-72">
            <span className="sr-only">Search sources</span><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search files and folders" className="h-9 rounded-lg bg-input-background pl-9 text-xs" />
          </label>
          {canWrite ? <Button type="button" onClick={() => document.getElementById(fileInputId)?.click()} disabled={busy}><Upload /> Upload files</Button> : null}
        </div>
        {canWrite ? <input id={fileInputId} type="file" multiple disabled={busy} className="hidden" onChange={(event) => { chooseFiles(event.target.files); event.currentTarget.value = ""; }} /> : null}
      </header>

      {failedCount > 0 ? (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-destructive sm:!flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="text-xs font-semibold">{failedCount} {failedCount === 1 ? "source needs" : "sources need"} attention</p><p className="mt-0.5 text-[11px] leading-relaxed">Regenerate failed sources after correcting password, encoding, or format issues.</p></div></div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {canWrite ? <Button type="button" variant="ghost" size="sm" onClick={onRetryAll} disabled={busy} className="text-destructive hover:text-destructive"><RefreshCw /> Retry all</Button> : null}
            <Button type="button" variant="ghost" size="sm" onClick={() => onFilterChange(filter === "failed" ? "all" : "failed")} className="text-destructive hover:text-destructive">{filter === "failed" ? "Show all files" : "View failed files"}</Button>
          </div>
        </div>
      ) : null}

      {filter === "failed" ? <div className="mb-3 flex items-center justify-between gap-3 text-[11px]"><span className="inline-flex items-center gap-1.5 text-destructive"><AlertCircle className="h-3.5 w-3.5" />Showing failed files</span><button type="button" onClick={() => onFilterChange("all")} className="font-medium text-text-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Show all files</button></div> : null}

      {collection.filesError ? (
        <div role="alert" className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-warning">{collection.filesError}</div>
      ) : collection.files === null ? (
        <div className="flex min-h-72 items-center justify-center" role="status" aria-label="Loading Collection sources"><Loader2 className="h-5 w-5 animate-spin text-text-muted motion-reduce:animate-none" /></div>
      ) : allFiles.length === 0 ? (
        <button type="button" disabled={!canWrite || busy} onClick={() => document.getElementById(fileInputId)?.click()} className="flex min-h-[28rem] w-full items-center justify-center rounded-xl border border-dashed border-border bg-surface-low/15 px-6 py-12 text-center transition-colors hover:border-[var(--selection-accent-border)] hover:bg-[var(--selection-accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:border-border disabled:hover:bg-surface-low/15">
          <span className="max-w-lg"><span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-text-muted"><Upload className="h-5 w-5" /></span><strong className="mt-4 block text-xl font-semibold tracking-[-0.025em] text-foreground">Add knowledge your agents can rely on</strong><span className="mx-auto mt-2 block max-w-md text-sm leading-relaxed text-text-muted">{canWrite ? "Upload company documents, processes, playbooks, and reference files. Assigned agents can access them when processing is complete." : "This Collection has no visible sources. Contributor access is required to upload knowledge."}</span>{canWrite ? <span className="mx-auto mt-5 flex min-h-16 max-w-sm items-center justify-center gap-2 rounded-lg border border-dashed border-border text-xs font-semibold text-text-secondary"><Upload className="h-4 w-4" />Drop files here or browse</span> : null}<span className="mx-auto mt-4 block max-w-md text-[11px] leading-relaxed text-text-muted">Try sales playbooks, brand guidelines, product documentation, or internal procedures.</span></span>
        </button>
      ) : files.length === 0 ? (
        <div className="flex min-h-80 items-center justify-center rounded-xl border border-border bg-surface-low/15 p-8 text-center"><div><Search className="mx-auto h-5 w-5 text-text-muted" /><h3 className="mt-3 text-lg font-semibold tracking-[-0.02em] text-foreground">No results found</h3><p className="mt-1.5 text-xs text-text-muted">Try a different search term or clear the active filter.</p><Button type="button" variant="outline" size="sm" onClick={() => { onQueryChange(""); onFilterChange("all"); }} className="mt-4">Clear filters</Button></div></div>
      ) : (
        <section aria-label="Collection knowledge" className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="hidden min-h-11 grid-cols-[minmax(16rem,1fr)_10rem_9rem_10rem] items-center gap-4 border-b border-border bg-surface-low/35 px-5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted xl:grid"><span>Name</span><span>Status</span><span>Added</span><span className="text-right">Actions</span></div>
          <div className="divide-y divide-border">
            {files.map((file) => {
              const health = knowledgeFileHealth(file);
              return (
                <article key={`${file.id}:${file.path}`} className="relative grid min-h-24 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 bg-background px-4 py-3.5 transition-colors hover:bg-surface-low/25 sm:px-5 xl:min-h-20 xl:grid-cols-[minmax(16rem,1fr)_10rem_9rem_10rem] xl:items-center xl:gap-4">
                  <button type="button" onClick={() => onSelectFile(file)} className="flex min-w-0 items-start gap-3 pr-8 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:pr-28 xl:pr-0"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-low text-text-secondary"><FileText className="h-4 w-4" /></span><span className="min-w-0"><strong className="block truncate text-xs font-semibold text-foreground">{fileName(file)}</strong><span className="mt-1 block truncate font-mono text-[10px] text-text-muted">{file.path}</span>{file.summary ? <span className="mt-1.5 line-clamp-1 block text-[10px] leading-relaxed text-text-muted">{file.summary}</span> : null}</span></button>
                  <div className="col-start-1 row-start-2 pl-12 text-[10px] xl:col-start-2 xl:row-start-1 xl:pl-0"><span className={`inline-flex items-center gap-1.5 font-medium ${health === "failed" ? "text-destructive" : health === "processing" ? "text-warning" : "text-text-secondary"}`}><span className={`h-1.5 w-1.5 rounded-full ${fileHealthClasses(file)}`} aria-hidden="true" />{knowledgeFileStatusLabel(file)}</span>{health === "failed" && canWrite ? <button type="button" onClick={() => onRegenerate(file)} disabled={busy} className="ml-2 underline underline-offset-2">Retry</button> : null}</div>
                  <div className="col-start-2 row-start-2 text-right text-[10px] text-text-muted xl:col-start-3 xl:row-start-1 xl:text-left">Not available</div>
                  <div className="absolute right-3 top-3 flex items-center justify-end gap-1 xl:static">
                    <Button type="button" variant="ghost" size="sm" onClick={() => onSelectFile(file)} className="hidden h-8 px-2.5 text-[11px] sm:inline-flex">Details</Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`More actions for ${fileName(file)}`} className="h-8 w-8"><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="z-[80] w-48 rounded-xl border-border">
                        <DropdownMenuItem onSelect={() => onSelectFile(file)}><FileText /> View details</DropdownMenuItem>
                        <DropdownMenuItem disabled={busy} onSelect={() => onDownload(file)}><Download /> Download original</DropdownMenuItem>
                        {canWrite ? <DropdownMenuItem disabled={busy} onSelect={() => onRegenerate(file)}><RefreshCw /> Regenerate agent view</DropdownMenuItem> : null}
                        {canWrite ? <><DropdownMenuSeparator /><DropdownMenuItem disabled={busy} onSelect={() => onDelete(file)} className="text-destructive focus:text-destructive"><Trash2 /> Delete source</DropdownMenuItem></> : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {!collection.filesError && allFiles.length > 0 && files.length > 0 ? <div className="mt-3 text-right text-[11px] tabular-nums text-text-muted">{files.length} {files.length === 1 ? "item" : "items"}</div> : null}
    </div>
  );
}

function CollectionSkills() {
  return (
    <div className="mx-auto w-full max-w-[92rem] px-4 pb-10 pt-6 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-col gap-4 sm:!flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Skills</h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-text-muted">Shared instruction packs that will teach assigned agents how and when to use tools.</p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-muted"><Info className="h-3.5 w-3.5 shrink-0" />Assigned agents will receive these skills in addition to their own when this capability becomes available.</p>
        </div>
        <Button type="button" disabled><Plus /> Add skills</Button>
      </header>

      <section className="flex min-h-[30rem] items-center justify-center rounded-xl border border-border bg-surface-low/15 px-6 py-12 text-center">
        <div className="max-w-lg">
          <div className="relative mx-auto h-24 w-32" aria-hidden="true"><span className="absolute left-6 top-8 h-10 w-16 -rotate-6 rounded-lg border border-border bg-surface-high/70" /><span className="absolute left-8 top-6 h-10 w-16 rotate-2 rounded-lg border border-border bg-surface-high" /><span className="absolute left-10 top-4 flex h-10 w-16 rotate-6 items-center justify-center rounded-lg border border-border bg-background text-text-muted"><Sparkles className="h-4 w-4" /></span></div>
          <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium text-text-muted">Coming soon</span>
          <h3 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-foreground">Shared skills are coming soon</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">Collection-level skills are not available yet. No skill catalog, setup state, or assignments are shown here.</p>
          <p className="mx-auto mt-4 max-w-md text-[11px] leading-relaxed text-text-muted">When available, skills will supplement each assigned agent&apos;s individual instructions.</p>
        </div>
      </section>
    </div>
  );
}

function CollectionIntegrations() {
  return (
    <div className="mx-auto w-full max-w-[92rem] px-4 pb-10 pt-6 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-col gap-4 lg:!flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Integrations</h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-text-muted">Connect services that assigned agents will be able to use through this Collection.</p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-muted"><Info className="h-3.5 w-3.5 shrink-0" />Adding an integration may give assigned agents access to external data or actions.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:!flex-row lg:w-auto">
          <label className="relative block min-w-0 flex-1 sm:w-64">
            <span className="sr-only">Search shared integrations</span><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <Input disabled placeholder="Search shared integrations" className="h-9 rounded-lg bg-input-background pl-9 text-xs" />
          </label>
          <Button type="button" disabled><Plus /> Add integrations</Button>
        </div>
      </header>

      <section className="flex min-h-[30rem] items-center justify-center rounded-xl border border-border bg-surface-low/15 px-6 py-12 text-center">
        <div className="max-w-lg">
          <div className="relative mx-auto h-24 w-36" aria-hidden="true"><span className="absolute left-4 top-10 h-px w-24 -rotate-12 bg-border" /><span className="absolute left-4 top-10 h-px w-24 rotate-12 bg-border" /><span className="absolute left-0 top-7 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-text-muted"><Link2 className="h-4 w-4" /></span><span className="absolute right-0 top-1 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-text-muted"><LibraryBig className="h-4 w-4" /></span><span className="absolute bottom-1 right-0 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-text-muted"><Bot className="h-4 w-4" /></span></div>
          <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium text-text-muted">Coming soon</span>
          <h3 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-foreground">Shared integrations are coming soon</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">Collection-level integrations are not available yet. No connection catalog or status data is shown here.</p>
          <p className="mx-auto mt-4 max-w-md text-[11px] leading-relaxed text-text-muted">Connections will remain unavailable until shared Collection integrations are ready.</p>
        </div>
      </section>
    </div>
  );
}

export function KnowledgeHub({
  agents = [],
  agentsLoading = false,
  agentsError = null,
  initialCollectionId = null,
  onRefreshAgents,
  onNavigateCollection,
  onSelectedCollectionChange,
  headerControlsTargetId,
  onRequestProductUse,
}: KnowledgeHubProps) {
  const {
    workspacesClient,
    workspaces = [],
    selectedWorkspaceId,
    isLoading: workspacesLoading,
    error: workspaceConnectionError,
    refreshWorkspaces,
    refreshSelectedWorkspaceAgents,
  } = useWorkspace();
  const workspaceCatalogSignal = workspaces.map((workspace) => workspace.id).sort().join(":");
  const {
    collections,
    loading,
    initialized: catalogInitialized,
    error: catalogError,
    refresh,
    createCollection,
    updateCollection,
    deleteCollection,
    uploadFiles,
    updateFile,
    regenerateFile,
    deleteFile,
    setAgentAccess,
  } = useKnowledgeHubCatalog(workspacesClient, {
    onCollectionsChanged: () => refreshWorkspaces(),
    catalogSignal: workspaceCatalogSignal,
  });
  const searchId = useId();
  const uploadInputId = useId();
  const detailTabsId = useId();
  const collectionNameInputId = useId();
  const indexHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [fileQuery, setFileQuery] = useState("");
  const deferredFileQuery = useDeferredValue(fileQuery.trim().toLowerCase());
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(initialCollectionId);
  const selectedCollectionIdRef = useRef<string | null>(initialCollectionId);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const selectedFilePathRef = useRef<string | null>(null);
  const selectedFileIdentityRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<CollectionTab>("overview");
  const [fileFilter, setFileFilter] = useState<KnowledgeFileFilter>("all");
  const [sourceInspectorView, setSourceInspectorView] = useState<SourceInspectorView>("preview");
  const [createOpen, setCreateOpen] = useState(false);
  const [manageAgentsOpen, setManageAgentsOpen] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [pendingCollectionDelete, setPendingCollectionDelete] = useState<KnowledgeHubCollection | null>(null);
  const [pendingFileDelete, setPendingFileDelete] = useState<{ collection: KnowledgeHubCollection; file: WorkspaceFile } | null>(null);
  const [pendingAgentRemoval, setPendingAgentRemoval] = useState<{ collection: KnowledgeHubCollection; agentId: string; label: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sourceActionError, setSourceActionError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const headerControlsTarget = useSyncExternalStore(
    subscribeToHeaderControlsTarget,
    () => headerControlsTargetId ? document.getElementById(headerControlsTargetId) : null,
    () => null,
  );

  useEffect(() => {
    if (selectedCollectionIdRef.current === initialCollectionId) return;
    const timeout = window.setTimeout(() => {
      selectedCollectionIdRef.current = initialCollectionId;
      setSelectedCollectionId(initialCollectionId);
      selectedFilePathRef.current = null;
      selectedFileIdentityRef.current = null;
      setSelectedFilePath(null);
      setActiveTab("overview");
      setFileQuery("");
      setFileFilter("all");
      setManageAgentsOpen(false);
      setEditingCollectionId(null);
      setPendingCollectionDelete(null);
      setPendingFileDelete(null);
      setPendingAgentRemoval(null);
      window.setTimeout(() => (initialCollectionId ? detailHeadingRef : indexHeadingRef).current?.focus(), 0);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initialCollectionId]);

  const hasProcessingFiles = collections.some((collection) => (
    collection.files?.some((file) => knowledgeFileHealth(file) === "processing")
  ));
  useEffect(() => {
    if (!hasProcessingFiles) return;
    const interval = window.setInterval(() => void refresh(), 8_000);
    return () => window.clearInterval(interval);
  }, [hasProcessingFiles, refresh]);

  const searchedCollections = collections.filter((collection) => collectionMatches(collection, deferredQuery));
  const visibleCollections = searchedCollections;
  const selectedCollection = selectedCollectionId
    ? collections.find((collection) => collection.workspace.id === selectedCollectionId) ?? null
    : null;
  const visibleFiles = selectedCollection?.files
    ? [...selectedCollection.files]
        .filter((file) => (!deferredFileQuery || fileMatches(file, deferredFileQuery)) && (fileFilter === "all" || knowledgeFileHealth(file) === "failed"))
        .sort((left, right) => left.path.localeCompare(right.path))
    : [];
  const selectedFile = selectedCollection && selectedFilePath
    ? selectedCollection.files?.find((file) => file.path === selectedFilePath) ?? null
    : null;
  const editingCollection = editingCollectionId
    ? collections.find((collection) => collection.workspace.id === editingCollectionId) ?? null
    : null;
  const selectedCollectionName = selectedCollection ? knowledgeWorkspaceName(selectedCollection.workspace) : null;
  const detailTabOptions: ReadonlyArray<readonly [CollectionTab, string, number | "---" | undefined]> = [
    ["overview", "Overview", undefined],
    ["knowledge", "Knowledge", selectedCollection?.files?.length ?? "---"],
    ["agents", "Agents", selectedCollection?.agentIds?.length ?? "---"],
    ["skills", "Skills", undefined],
    ["integrations", "Integrations", undefined],
  ];
  const availableDetailTabs = detailTabOptions.map(([tab]) => tab);
  const pageError = actionError || catalogError || (workspacesClient ? null : workspaceConnectionError);
  const selectedBusy = Boolean(busyAction && selectedCollection && busyAction.includes(selectedCollection.workspace.id));
  const controlsInSharedHeader = Boolean(headerControlsTarget);
  const catalogLoading = !catalogInitialized || loading || workspacesLoading || (!workspacesClient && !workspaceConnectionError);
  const requestedCollectionLoadError = catalogError || workspaceConnectionError;
  const requestedCollectionLoading = Boolean(
    selectedCollectionId
    && !selectedCollection
    && !catalogError
    && !workspaceConnectionError
    && (!catalogInitialized || loading || workspacesLoading || !workspacesClient),
  );
  const selectedCanWrite = selectedCollection ? collectionCanWrite(selectedCollection) : false;
  const selectedCanAdminister = selectedCollection ? collectionCanAdminister(selectedCollection) : false;
  const selectedDeleteBlockedReason = selectedCollection
    ? collectionDeletionBlockedReason(selectedCollection.workspace)
    : null;

  useEffect(() => {
    if (!selectedCollection || !selectedCollectionName) {
      onSelectedCollectionChange?.(null);
      return;
    }
    const health = fileHealthCounts(selectedCollection);
    onSelectedCollectionChange?.({
      id: selectedCollection.workspace.id,
      name: selectedCollectionName,
      description: selectedCollection.workspace.description,
      sourceCount: selectedCollection.files?.length ?? null,
      assignedAgentCount: selectedCollection.agentIds?.length ?? null,
      processingCount: selectedCollection.files ? health.processing : null,
      failedCount: selectedCollection.files ? health.failed : null,
    });
  }, [onSelectedCollectionChange, selectedCollection, selectedCollectionName]);

  async function runAction<T>(key: string, action: () => Promise<T>): Promise<T> {
    setBusyAction(key);
    setActionError(null);
    try {
      return await action();
    } catch (cause) {
      setActionError(describeKnowledgeHubError(cause, "The action couldn't be completed."));
      throw cause;
    } finally {
      setBusyAction((current) => current === key ? null : current);
    }
  }

  async function runSourceAction<T>(key: string, action: () => Promise<T>, fallback: string): Promise<T> {
    const inspectedPath = selectedFilePathRef.current;
    const inspectedIdentity = selectedFileIdentityRef.current;
    setBusyAction(key);
    setSourceActionError(null);
    if (!inspectedPath) setActionError(null);
    try {
      return await action();
    } catch (cause) {
      const message = describeKnowledgeHubError(cause, fallback);
      if (inspectedPath && inspectedIdentity && selectedFileIdentityRef.current === inspectedIdentity) setSourceActionError(message);
      else setActionError(message);
      throw cause;
    } finally {
      setBusyAction((current) => current === key ? null : current);
    }
  }

  function activateDetailTab(tab: CollectionTab, moveFocus = false) {
    setActiveTab(tab);
    if (moveFocus) window.requestAnimationFrame(() => document.getElementById(`${detailTabsId}-${tab}`)?.focus());
  }

  function changeSelectedFilePath(path: string | null) {
    selectedFilePathRef.current = path;
    selectedFileIdentityRef.current = path && selectedCollectionIdRef.current
      ? `${selectedCollectionIdRef.current}:${path}`
      : null;
    setSelectedFilePath(path);
  }

  function handleDetailTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, tab: CollectionTab) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = availableDetailTabs.indexOf(tab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? availableDetailTabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + availableDetailTabs.length) % availableDetailTabs.length;
    const nextTab = availableDetailTabs[nextIndex]!;
    activateDetailTab(nextTab, true);
  }

  function chooseCollection(collection: KnowledgeHubCollection) {
    selectedCollectionIdRef.current = collection.workspace.id;
    setSelectedCollectionId(collection.workspace.id);
    changeSelectedFilePath(null);
    setActiveTab("overview");
    setFileQuery("");
    setFileFilter("all");
    setManageAgentsOpen(false);
    setEditingCollectionId(null);
    setPendingCollectionDelete(null);
    setPendingFileDelete(null);
    setPendingAgentRemoval(null);
    onNavigateCollection?.(collection.workspace.id);
    window.setTimeout(() => detailHeadingRef.current?.focus(), 0);
  }

  function showCollectionIndex() {
    selectedCollectionIdRef.current = null;
    setSelectedCollectionId(null);
    changeSelectedFilePath(null);
    setActiveTab("overview");
    setFileQuery("");
    setFileFilter("all");
    setManageAgentsOpen(false);
    setEditingCollectionId(null);
    setPendingCollectionDelete(null);
    setPendingFileDelete(null);
    setPendingAgentRemoval(null);
    onNavigateCollection?.(null);
    window.setTimeout(() => indexHeadingRef.current?.focus(), 0);
  }

  function openCollectionKnowledge(collection: KnowledgeHubCollection, failedOnly = false) {
    selectedCollectionIdRef.current = collection.workspace.id;
    setSelectedCollectionId(collection.workspace.id);
    changeSelectedFilePath(null);
    setActiveTab("knowledge");
    setFileQuery("");
    setFileFilter(failedOnly ? "failed" : "all");
    setPendingCollectionDelete(null);
    setPendingFileDelete(null);
    setPendingAgentRemoval(null);
    onNavigateCollection?.(collection.workspace.id);
    window.setTimeout(() => detailHeadingRef.current?.focus(), 0);
  }

  function chooseFile(file: WorkspaceFile) {
    setSourceActionError(null);
    changeSelectedFilePath(file.path);
    setSourceInspectorView("preview");
  }

  function requestCollectionDelete(collection: KnowledgeHubCollection) {
    if (busyAction) return;
    setActionError(null);
    setEditingCollectionId(null);
    setPendingCollectionDelete(collection);
  }

  function requestFileDelete(collection: KnowledgeHubCollection, file: WorkspaceFile) {
    if (busyAction) return;
    setActionError(null);
    setPendingFileDelete({ collection, file });
  }

  function requestAgentRemoval(collection: KnowledgeHubCollection, agentId: string, label: string) {
    if (busyAgentId) return;
    setActionError(null);
    setPendingAgentRemoval({ collection, agentId, label });
  }

  function openCollectionEditor(collection: KnowledgeHubCollection) {
    setActionError(null);
    setEditingCollectionId(collection.workspace.id);
  }

  function openAgentManager(collection: KnowledgeHubCollection) {
    changeSelectedFilePath(null);
    if (selectedCollectionIdRef.current !== collection.workspace.id) {
      selectedCollectionIdRef.current = collection.workspace.id;
      setSelectedCollectionId(collection.workspace.id);
      setActiveTab("agents");
      setFileQuery("");
      setFileFilter("all");
      onNavigateCollection?.(collection.workspace.id);
    }
    setEditingCollectionId(null);
    setManageAgentsOpen(true);
  }

  function openUploadPicker() {
    if (busyAction) return;
    if (onRequestProductUse && !onRequestProductUse()) return;
    setActiveTab("knowledge");
    window.requestAnimationFrame(() => document.getElementById(uploadInputId)?.click());
  }

  async function handleCreate(name: string, description: string, agentIds: string[]) {
    if (onRequestProductUse && !onRequestProductUse()) return;
    const collection = await runAction("create-collection", () => createCollection({
      name,
      description: description || undefined,
    }));
    selectedCollectionIdRef.current = collection.workspace.id;
    setSelectedCollectionId(collection.workspace.id);
    changeSelectedFilePath(null);
    setActiveTab("overview");
    setFileQuery("");
    setFileFilter("all");
    onNavigateCollection?.(collection.workspace.id);

    if (agentIds.length > 0) {
      const results = await Promise.allSettled(agentIds.map((agentId) => setAgentAccess(collection, agentId, true)));
      const assignmentFailures = results.filter((result) => result.status === "rejected").length;
      if (assignmentFailures > 0) {
        const assignedCount = agentIds.length - assignmentFailures;
        setActionError(
          `Collection created. ${assignedCount} of ${agentIds.length} selected ${agentIds.length === 1 ? "agent was" : "agents were"} assigned; ${assignmentFailures} ${assignmentFailures === 1 ? "assignment" : "assignments"} could not be completed. Refresh, then open Manage agents to retry only the missing assignments.`,
        );
      }
    }
    window.setTimeout(() => detailHeadingRef.current?.focus(), 0);
  }

  async function handleUpload(files: File[]) {
    if (!selectedCollection || files.length === 0 || busyAction) return;
    if (onRequestProductUse && !onRequestProductUse()) return;
    const uploaded = await runAction(`upload:${selectedCollection.workspace.id}`, () => uploadFiles(selectedCollection, files));
    if (uploaded[0]) {
      changeSelectedFilePath(uploaded[0].path);
      setSourceInspectorView("preview");
    }
  }

  async function downloadSource(collection: KnowledgeHubCollection, file: WorkspaceFile) {
    if (!workspacesClient) return;
    await runSourceAction(`download:${collection.workspace.id}:${file.path}`, async () => {
      const result = await workspacesClient.downloadFileBytes(
        knowledgeWorkspaceRef(collection.workspace),
        file.path,
        {},
        { raw: true },
      );
      downloadFileBytes(result.name || fileName(file), result.content);
    }, "The original source couldn't be downloaded.");
  }

  async function toggleAgentAccess(collection: KnowledgeHubCollection, agentId: string, enabled: boolean) {
    if (enabled && onRequestProductUse && !onRequestProductUse()) return;
    setBusyAgentId(agentId);
    setActionError(null);
    try {
      await setAgentAccess(collection, agentId, enabled);
      if (selectedWorkspaceId === collection.workspace.id) await refreshSelectedWorkspaceAgents();
    } catch (cause) {
      setActionError(describeKnowledgeHubError(cause, "Agent assignment couldn't be changed."));
      throw cause;
    } finally {
      setBusyAgentId(null);
    }
  }

  async function retryFailedSources(collection: KnowledgeHubCollection) {
    const failedFiles = collection.files?.filter((file) => knowledgeFileHealth(file) === "failed") ?? [];
    if (failedFiles.length === 0) return;
    if (onRequestProductUse && !onRequestProductUse()) return;
    const key = `retry-all:${collection.workspace.id}`;
    setBusyAction(key);
    setActionError(null);
    try {
      const results = await Promise.allSettled(failedFiles.map((file) => regenerateFile(collection, file)));
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) setActionError(`${failed} ${failed === 1 ? "source" : "sources"} couldn't be regenerated. Review the failed items and try again.`);
    } finally {
      setBusyAction((current) => current === key ? null : current);
    }
  }

  function refreshKnowledgeAndAgents() {
    void refresh();
    void Promise.resolve().then(() => onRefreshAgents?.()).catch(() => undefined);
  }

  function renderKnowledgeControls() {
    return (
      <div role="group" aria-label="Knowledge controls" className="flex items-center justify-end">
        <Button type="button" variant="ghost" size="icon" onClick={refreshKnowledgeAndAgents} disabled={!workspacesClient || loading} aria-label="Refresh Knowledge and agents" className="h-9 w-9 shrink-0 rounded-xl text-text-muted">
          {loading || agentsLoading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
      {controlsInSharedHeader && headerControlsTarget ? createPortal(renderKnowledgeControls(), headerControlsTarget) : null}
      <div className="shrink-0">
        {pageError ? (
          <div role="alert" className="mx-4 my-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive sm:mx-5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{pageError}</span>
            {actionError ? (
              <button type="button" onClick={() => setActionError(null)} className="shrink-0 font-medium underline underline-offset-2">Dismiss</button>
            ) : null}
          </div>
        ) : null}
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {!selectedCollectionId ? (
          <CollectionsIndex
            collections={collections}
            visibleCollections={visibleCollections}
            loading={catalogLoading}
            query={query}
            searchId={searchId}
            agents={agents}
            createDisabled={!workspacesClient || workspacesLoading}
            onQueryChange={setQuery}
            onSelectCollection={chooseCollection}
            onEditCollection={openCollectionEditor}
            onDeleteCollection={requestCollectionDelete}
            onOpenKnowledge={openCollectionKnowledge}
            onCreateCollection={() => {
              if (onRequestProductUse && !onRequestProductUse()) return;
              setCreateOpen(true);
            }}
            headingRef={indexHeadingRef}
          />
        ) : selectedCollection ? (
          <div className="flex min-h-full flex-col">
            <header className="shrink-0 border-b border-border bg-background">
              <div className="mx-auto w-full max-w-[92rem] px-4 pt-5 sm:px-6 sm:pt-6 lg:px-8">
                <nav aria-label="Collection breadcrumb">
                  <ol className="flex min-w-0 items-center gap-2 text-[11px] text-text-muted">
                    <li>
                      <button type="button" onClick={showCollectionIndex} className="font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        Collections
                      </button>
                    </li>
                    <li aria-hidden="true"><ChevronLeft className="h-3 w-3 rotate-180" /></li>
                    <li aria-current="page" className="min-w-0 truncate text-text-secondary">{selectedCollectionName}</li>
                  </ol>
                </nav>

                <div className="flex flex-col gap-5 pb-6 pt-5 sm:!flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3.5">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-high text-text-secondary"><LibraryBig className="h-5 w-5" /></span>
                    <div className="min-w-0 pt-0.5">
                      <h1 ref={detailHeadingRef} tabIndex={-1} className="break-words text-2xl font-semibold tracking-[-0.035em] text-foreground outline-none sm:text-3xl">{selectedCollectionName}</h1>
                      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-text-muted">
                        {selectedCollection.workspace.description?.trim() || "No description yet."}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {selectedCanWrite || selectedCanAdminister ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" disabled={Boolean(busyAction || busyAgentId)}><Plus /> Add to collection</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="z-[80] w-60 rounded-xl border-border">
                          {selectedCanWrite ? <DropdownMenuItem onSelect={openUploadPicker}><Upload /> Upload knowledge</DropdownMenuItem> : null}
                          <DropdownMenuItem disabled><Sparkles /> Add skills <span className="ml-auto text-[10px] text-text-muted">Coming soon</span></DropdownMenuItem>
                          <DropdownMenuItem disabled><Link2 /> Add integrations <span className="ml-auto text-[10px] text-text-muted">Coming soon</span></DropdownMenuItem>
                          {selectedCanAdminister ? <DropdownMenuItem onSelect={() => openAgentManager(selectedCollection)}><UsersRound /> Assign agents</DropdownMenuItem> : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                    {selectedCanAdminister ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="outline" size="icon" disabled={Boolean(busyAction)} aria-label={`More actions for ${selectedCollectionName}`}><MoreHorizontal /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="z-[80] w-52 rounded-xl border-border">
                          <DropdownMenuItem onSelect={() => openCollectionEditor(selectedCollection)}><Pencil /> Edit details</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={Boolean(selectedDeleteBlockedReason)}
                            title={selectedDeleteBlockedReason ?? undefined}
                            onSelect={() => requestCollectionDelete(selectedCollection)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 /> Delete Collection
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </div>

                <div role="tablist" aria-label={`${selectedCollectionName} sections`} aria-orientation="horizontal" className="flex min-w-0 gap-5 overflow-x-auto sm:gap-7">
                  {detailTabOptions.map(([tab, label, count]) => (
                    <button
                      key={tab}
                      id={`${detailTabsId}-${tab}`}
                      type="button"
                      role="tab"
                      aria-label={label}
                      aria-selected={activeTab === tab}
                      aria-controls={`${detailTabsId}-panel`}
                      tabIndex={activeTab === tab ? 0 : -1}
                      onClick={() => setActiveTab(tab)}
                      onKeyDown={(event) => handleDetailTabKeyDown(event, tab)}
                      className={`relative -mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-0 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${activeTab === tab ? "border-[var(--selection-accent)] text-foreground" : "border-transparent text-text-muted hover:text-foreground"}`}
                    >
                      {label}
                      {count !== undefined ? <span aria-hidden="true" className="ml-1.5 text-[10px] font-medium tabular-nums text-text-muted">{count}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            </header>

            <div
              id={`${detailTabsId}-panel`}
              role="tabpanel"
              aria-labelledby={`${detailTabsId}-${activeTab}`}
              tabIndex={0}
              className="min-h-0 flex-1 outline-none"
            >
              {activeTab === "overview" ? (
                <CollectionOverview
                  collection={selectedCollection}
                  agents={agents}
                  onOpenSources={() => activateDetailTab("knowledge", true)}
                  onSelectFile={chooseFile}
                  onOpenAccess={() => openAgentManager(selectedCollection)}
                />
              ) : activeTab === "knowledge" ? (
                <CollectionKnowledge
                  collection={selectedCollection}
                  files={visibleFiles}
                  query={fileQuery}
                  filter={fileFilter}
                  fileInputId={uploadInputId}
                  busy={selectedBusy}
                  dragOver={dragOver}
                  onQueryChange={setFileQuery}
                  onFilterChange={setFileFilter}
                  onUpload={(files) => { void handleUpload(files).catch(() => undefined); }}
                  onDragOverChange={setDragOver}
                  onSelectFile={chooseFile}
                  onDownload={(file) => { void downloadSource(selectedCollection, file).catch(() => undefined); }}
                  onRegenerate={(file) => {
                    if (onRequestProductUse && !onRequestProductUse()) return;
                    void runAction(`regenerate:${selectedCollection.workspace.id}:${file.path}`, () => regenerateFile(selectedCollection, file)).catch(() => undefined);
                  }}
                  onDelete={(file) => requestFileDelete(selectedCollection, file)}
                  onRetryAll={() => { void retryFailedSources(selectedCollection); }}
                />
              ) : activeTab === "agents" ? (
                <CollectionAgents
                  collection={selectedCollection}
                  agents={agents}
                  agentsLoading={agentsLoading}
                  agentsError={agentsError}
                  busyAgentId={busyAgentId}
                  onManage={() => openAgentManager(selectedCollection)}
                   onRemove={(agentId, label) => requestAgentRemoval(selectedCollection, agentId, label)}
                />
              ) : activeTab === "skills" ? <CollectionSkills /> : <CollectionIntegrations />}
            </div>
          </div>
        ) : requestedCollectionLoading ? (
          <div className="flex min-h-full items-center justify-center px-6 py-12" role="status" aria-label="Loading requested Collection">
            <div className="text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-text-muted motion-reduce:animate-none" />
              <p className="mt-3 text-sm font-semibold text-foreground">Loading Collection</p>
              <p className="mt-1 text-xs text-text-muted">Checking the latest account catalog.</p>
            </div>
          </div>
        ) : (
          <section className="flex min-h-full items-center justify-center px-6 py-12 text-center" aria-labelledby="collection-unavailable-heading">
            <div className="max-w-md">
              <AlertCircle className="mx-auto h-5 w-5 text-warning" />
              <h1 id="collection-unavailable-heading" className="mt-4 text-xl font-semibold tracking-[-0.025em] text-foreground">{requestedCollectionLoadError ? "Collection couldn't be loaded" : "Collection unavailable"}</h1>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">{requestedCollectionLoadError ? "The Collection catalog is unavailable right now. Refresh to try again." : "This Collection could not be found or is no longer available to your account."}</p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Button type="button" variant="outline" onClick={showCollectionIndex}><ChevronLeft /> Back to Collections</Button>
                <Button type="button" variant="ghost" onClick={() => { void refresh(); }} disabled={!workspacesClient || loading}><RefreshCw /> Refresh</Button>
              </div>
            </div>
          </section>
        )}
      </main>

      {selectedCollection && selectedFile ? (
        <SlideOver
          open
          onClose={() => { changeSelectedFilePath(null); setSourceActionError(null); }}
          title={fileName(selectedFile)}
          description={`${selectedCollectionName} · ${selectedFile.path}`}
          icon={FileText}
          className="w-full motion-reduce:transition-none motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none sm:max-w-2xl lg:max-w-4xl"
          bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-low/20 px-3 py-2.5 sm:px-4">
            <div role="group" aria-label="Source details view" className="flex items-center rounded-lg border border-border bg-background p-0.5">
              {(["preview", "metadata"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={sourceInspectorView === view}
                  onClick={() => setSourceInspectorView(view)}
                  className={`h-8 rounded-md px-3 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sourceInspectorView === view ? "bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]" : "text-text-muted hover:text-foreground"}`}
                >
                  {view === "preview" ? "Preview" : "Metadata"}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Source actions" className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon" onClick={() => { void downloadSource(selectedCollection, selectedFile).catch(() => undefined); }} disabled={selectedBusy} aria-label="Download original source" className="h-8 w-8">
                <Download />
              </Button>
              {selectedCanWrite ? (
                <Button type="button" variant="ghost" size="icon" onClick={() => {
                  if (onRequestProductUse && !onRequestProductUse()) return;
                  void runSourceAction(`regenerate:${selectedCollection.workspace.id}:${selectedFile.path}`, () => regenerateFile(selectedCollection, selectedFile), "The agent view couldn't be regenerated.").catch(() => undefined);
                }} disabled={selectedBusy} aria-label="Regenerate agent view" className="h-8 w-8">
                  {busyAction?.startsWith("regenerate:") ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}
                </Button>
              ) : null}
              {selectedCanWrite ? (
                <Button type="button" variant="ghost" size="icon" onClick={() => requestFileDelete(selectedCollection, selectedFile)} disabled={selectedBusy} aria-label="Delete source" className="h-8 w-8 text-text-muted hover:text-destructive">
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          </div>
          {sourceActionError ? <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-destructive/25 bg-destructive/10 px-4 py-3 text-xs leading-relaxed text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{sourceActionError}</span></div> : null}
          <div className="min-h-0 flex-1 overflow-hidden">
            {sourceInspectorView === "metadata" ? (
              <div className="h-full overflow-y-auto">
                <FileDetails
                  key={`${selectedFile.id}:${selectedFile.displayName}:${selectedFile.summary ?? ""}:${selectedFile.keywords.join("|")}`}
                  collection={selectedCollection}
                  file={selectedFile}
                  busy={selectedBusy}
                  onRequestProductUse={onRequestProductUse}
                  onSave={async (input) => {
                    const updated = await runAction(`metadata:${selectedCollection.workspace.id}:${selectedFile.path}`, () => updateFile(selectedCollection, selectedFile, input));
                    changeSelectedFilePath(updated.path);
                  }}
                />
              </div>
            ) : (
              <FilePreview client={workspacesClient} collection={selectedCollection} file={selectedFile} />
            )}
          </div>
        </SlideOver>
      ) : null}

      {selectedCollection && manageAgentsOpen ? (
        <SlideOver
          open
          onClose={() => setManageAgentsOpen(false)}
          title="Manage agents"
          description={`Assign or remove agents for ${selectedCollectionName}. Changes take effect immediately.`}
          icon={UsersRound}
          className="w-full motion-reduce:transition-none motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none sm:max-w-2xl lg:max-w-4xl"
          bodyClassName="p-0"
        >
          {actionError ? <div role="alert" className="flex items-start gap-2 border-b border-destructive/25 bg-destructive/10 px-4 py-3 text-xs leading-relaxed text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{actionError}</span><button type="button" onClick={() => setActionError(null)} className="shrink-0 font-medium underline underline-offset-2">Dismiss</button></div> : null}
          <AgentAccess
            collection={selectedCollection}
            agents={agents}
            agentsLoading={agentsLoading}
            agentsError={agentsError}
            busyAgentId={busyAgentId}
            onToggle={(agentId, enabled) => toggleAgentAccess(selectedCollection, agentId, enabled)}
          />
        </SlideOver>
      ) : null}

      {editingCollection ? (
        <CollectionSettings
          key={`${editingCollection.workspace.id}:${editingCollection.workspace.updatedAt}:${editingCollection.workspace.name}:${editingCollection.workspace.description ?? ""}`}
          open
          onOpenChange={(open) => { if (!open) setEditingCollectionId(null); }}
          collection={editingCollection}
          busy={Boolean(busyAction?.includes(editingCollection.workspace.id))}
          nameInputId={collectionNameInputId}
          onRequestProductUse={onRequestProductUse}
          onSave={async (name, description) => {
            await runAction(`collection:${editingCollection.workspace.id}`, () => updateCollection(editingCollection, { name, description }));
          }}
        />
      ) : null}

      {createOpen ? (
        <CreateCollectionDialog
          open
          onOpenChange={setCreateOpen}
          agents={agents}
          agentsLoading={agentsLoading}
          agentsError={agentsError}
          onRequestProductUse={onRequestProductUse}
          onCreate={handleCreate}
        />
      ) : null}
      <DestructiveConfirmDialog
        open={Boolean(pendingAgentRemoval)}
        title={pendingAgentRemoval ? `Remove ${pendingAgentRemoval.label}?` : "Remove agent?"}
        description={pendingAgentRemoval ? `This agent will lose direct access to ${knowledgeWorkspaceName(pendingAgentRemoval.collection.workspace)}. Its own workspace and capabilities will not be affected.` : ""}
        busy={Boolean(pendingAgentRemoval && busyAgentId === pendingAgentRemoval.agentId)}
        error={pendingAgentRemoval ? actionError : null}
        confirmLabel="Remove"
        busyLabel="Removing"
        onCancel={() => { if (!busyAgentId) setPendingAgentRemoval(null); }}
        onConfirm={() => {
          if (!pendingAgentRemoval) return;
          const pending = pendingAgentRemoval;
          void toggleAgentAccess(pending.collection, pending.agentId, false)
            .then(() => setPendingAgentRemoval(null))
            .catch(() => undefined);
        }}
      />
      <DestructiveConfirmDialog
        open={Boolean(pendingCollectionDelete)}
        title="Delete Collection?"
        description={pendingCollectionDelete ? `Delete ${knowledgeWorkspaceName(pendingCollectionDelete.workspace)} and all of its sources? Assigned agents will lose access. Copies already available to a running agent may remain until it refreshes.` : ""}
        busy={Boolean(pendingCollectionDelete && busyAction === `delete:${pendingCollectionDelete.workspace.id}`)}
        error={pendingCollectionDelete ? actionError : null}
        onCancel={() => {
          if (!pendingCollectionDelete || busyAction !== `delete:${pendingCollectionDelete.workspace.id}`) setPendingCollectionDelete(null);
        }}
        onConfirm={() => {
          if (!pendingCollectionDelete || busyAction) return;
          const collection = pendingCollectionDelete;
          void runAction(`delete:${collection.workspace.id}`, () => deleteCollection(collection))
            .then(() => {
              setPendingCollectionDelete(null);
              showCollectionIndex();
            })
            .catch(() => undefined);
        }}
      />
      <DestructiveConfirmDialog
        open={Boolean(pendingFileDelete)}
        title="Delete source?"
        description={pendingFileDelete ? `Remove ${fileName(pendingFileDelete.file)} from this Collection? A copy already available to a running agent may remain until it refreshes.` : ""}
        busy={Boolean(pendingFileDelete && busyAction === `delete-file:${pendingFileDelete.collection.workspace.id}:${pendingFileDelete.file.path}`)}
        error={pendingFileDelete ? actionError : null}
        onCancel={() => {
          if (!pendingFileDelete || busyAction !== `delete-file:${pendingFileDelete.collection.workspace.id}:${pendingFileDelete.file.path}`) setPendingFileDelete(null);
        }}
        onConfirm={() => {
          if (!pendingFileDelete || busyAction) return;
          const pending = pendingFileDelete;
          void runAction(`delete-file:${pending.collection.workspace.id}:${pending.file.path}`, () => deleteFile(pending.collection, pending.file))
            .then(() => {
              setPendingFileDelete(null);
              changeSelectedFilePath(null);
              setActiveTab("knowledge");
            })
            .catch(() => undefined);
        }}
      />
    </div>
  );
}
