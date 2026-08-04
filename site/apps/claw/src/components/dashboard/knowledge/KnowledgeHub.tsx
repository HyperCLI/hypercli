"use client";

/*
 * THESIS: Knowledge is an operating catalog, not a settings page or a stack of summary cards.
 * OWN-WORLD: Claw's quiet bordered surfaces, dense roster navigation, and restrained green selection state.
 * STORY: Choose a Domain, inspect its sources, then verify or change its assigned agents.
 * FIRST VIEWPORT: The existing agent roster joins a three-pane Domain, source, and inspector workspace.
 * FORM: A responsive catalog browser derived from the approved three-pane topology and incumbent Claw shell.
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
} from "react";
import { createPortal } from "react-dom";
import type { WorkspaceFile, WorkspacesAPI } from "@hypercli.com/sdk/workspaces";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronLeft,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  LibraryBig,
  ListFilter,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
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
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Textarea,
} from "@hypercli/shared-ui";

import { downloadFileBytes } from "@/lib/download-file";
import { domainDeletionBlockedReason } from "@/lib/account-domain";
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

type MobilePane = "collections" | "sources" | "details";
type InspectorTab = "overview" | "source" | "access" | "settings";
type SourceInspectorView = "preview" | "metadata";
type PreviewMode = "source" | "markdown";
type DomainFilter = "all" | "ready" | "processing" | "attention" | "empty";

const DOMAIN_FILTER_OPTIONS: ReadonlyArray<readonly [DomainFilter, string]> = [
  ["all", "All Domains"],
  ["ready", "Ready"],
  ["processing", "Processing"],
  ["attention", "Needs attention"],
  ["empty", "Empty"],
];

const KNOWLEDGE_PANE_DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeToKnowledgePaneLayout(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const mediaQuery = window.matchMedia(KNOWLEDGE_PANE_DESKTOP_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getKnowledgePaneLayoutSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(KNOWLEDGE_PANE_DESKTOP_QUERY).matches;
}

function getKnowledgePaneLayoutServerSnapshot(): boolean {
  return false;
}

function subscribeToHeaderControlsTarget(): () => void {
  return () => undefined;
}

export type KnowledgeHubAgent = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  pod_name?: string | null;
  state?: string | null;
  avatarUrl?: string | null;
};

export type KnowledgeHubSelectedDomain = {
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
  initialDomainId?: string | null;
  onRefreshAgents?: () => Promise<unknown> | void;
  onSelectedDomainChange?: (domain: KnowledgeHubSelectedDomain | null) => void;
  headerControlsTargetId?: string;
};

function agentName(agent: KnowledgeHubAgent): string {
  return agent.displayName?.trim() || agent.name?.trim() || agent.pod_name || agent.id;
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

function formatKnowledgeDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
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

function collectionOwnFieldsMatch(collection: KnowledgeHubCollection, query: string): boolean {
  if (!query) return true;
  return [
    knowledgeWorkspaceName(collection.workspace),
    collection.workspace.slug,
    collection.workspace.description ?? "",
  ].join(" ").toLowerCase().includes(query);
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

function domainOperationalState(collection: KnowledgeHubCollection): Exclude<DomainFilter, "all"> | null {
  const counts = fileHealthCounts(collection);
  if (collection.filesError || counts.failed > 0) return "attention";
  if (collection.files === null) return null;
  if (counts.processing > 0) return "processing";
  if (collection.files.length === 0) return "empty";
  return "ready";
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
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, description: string) => Promise<void>;
}) {
  const nameInputId = useId();
  const descriptionInputId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const nameHintId = `${nameInputId}-hint`;
  const descriptionHintId = `${descriptionInputId}-hint`;

  function resetDraft() {
    setName("");
    setDescription("");
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
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(trimmedName, trimmedDescription);
      resetDraft();
      onOpenChange(false);
    } catch (cause) {
      setError(describeKnowledgeHubError(cause, "The Domain couldn't be created."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-xl overflow-hidden gap-0 rounded-2xl border-border p-0 sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-border px-5 py-5 pr-14 text-left sm:px-6">
            <DialogTitle className="text-xl tracking-[-0.02em]">Create a Domain</DialogTitle>
            <DialogDescription className="max-w-md leading-relaxed">
              Define one business area now. Add its sources and assigned agents after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
            <div>
              <label htmlFor={nameInputId} className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-foreground">
                <span>Domain name</span>
                <span aria-hidden="true" className="text-[10px] font-normal tabular-nums text-text-muted">{name.length}/120</span>
              </label>
              <Input
                id={nameInputId}
                autoFocus
                value={name}
                onChange={(event) => { setName(event.target.value); setError(null); }}
                placeholder="e.g. Customer support"
                maxLength={120}
                aria-describedby={nameHintId}
                aria-invalid={name.length > 0 && !trimmedName}
                className="h-11 rounded-xl border-border bg-input-background px-3.5 text-sm font-medium"
              />
              <p id={nameHintId} className="mt-2 text-[11px] leading-relaxed text-text-muted">Use the business-area name your team already recognizes.</p>
            </div>
            <div>
              <label htmlFor={descriptionInputId} className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-foreground">
                <span>Purpose and boundary</span>
                <span aria-hidden="true" className="text-[10px] font-normal tabular-nums text-text-muted">{description.length}/280</span>
              </label>
              <Textarea
                id={descriptionInputId}
                value={description}
                onChange={(event) => { setDescription(event.target.value); setError(null); }}
                placeholder="What belongs here, and what should stay outside this Domain?"
                rows={4}
                maxLength={280}
                aria-describedby={descriptionHintId}
                className="min-h-28 resize-y rounded-xl border-border bg-input-background px-3.5 py-3 text-sm leading-relaxed"
              />
              <p id={descriptionHintId} className="mt-2 text-[11px] leading-relaxed text-text-muted">A clear boundary helps collaborators choose the right sources and assignments.</p>
            </div>

            <section data-slot="domain-create-preview" aria-labelledby="domain-create-preview-heading" className="rounded-xl border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <h3 id="domain-create-preview-heading" className="text-[10px] font-semibold text-[var(--selection-accent)]">Domain list preview</h3>
                <span className="text-[9px] text-text-muted">Updates as you type</span>
              </div>
              <p className="mt-3 truncate text-sm font-semibold text-foreground">{trimmedName || "Untitled Domain"}</p>
              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-muted">{trimmedDescription || "Add a concise purpose so people know what knowledge belongs here."}</p>
              <p className="mt-3 text-[10px] text-text-muted">0 sources · 0 assigned agents</p>
            </section>
            {error ? <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p> : null}
          </div>
          <DialogFooter className="border-t border-border bg-surface-low/25 px-5 py-4 sm:items-center sm:justify-between sm:px-6">
            <p className="text-left text-[10px] leading-relaxed text-text-muted">No agents receive access automatically.</p>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => changeOpen(false)} disabled={submitting}>Cancel</Button>
              <Button type="submit" disabled={!trimmedName || submitting} className="min-w-32">
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {submitting ? "Creating" : "Create Domain"}
              </Button>
            </div>
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
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
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
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button type="button" onClick={onConfirm} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {busy ? "Deleting" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogUI>
  );
}

function CollectionOverview({
  collection,
  onOpenSources,
  onSelectFile,
  onOpenAccess,
  onOpenSettings,
}: {
  collection: KnowledgeHubCollection;
  onOpenSources: () => void;
  onSelectFile: (file: WorkspaceFile) => void;
  onOpenAccess: () => void;
  onOpenSettings: () => void;
}) {
  const counts = fileHealthCounts(collection);
  const sourceCount = collection.files?.length ?? null;
  const readyCount = collection.files?.filter((file) => knowledgeFileHealth(file) === "ready").length ?? null;
  const agentCount = collection.accessError ? null : collection.agentIds?.length ?? null;
  const description = collection.workspace.description?.trim();
  const overviewFiles = collection.files?.slice(0, 4) ?? [];

  let healthLabel = "Ready";
  let healthTitle = "Domain knowledge is ready";
  let healthDescription = `All ${sourceCount ?? 0} source${sourceCount === 1 ? "" : "s"} finished processing and can be reviewed.`;
  let healthClasses = "border-success/25 bg-success/10 text-success";
  let HealthIcon = AlertCircle;

  if (collection.filesError) {
    healthLabel = "Unavailable";
    healthTitle = "Source status is unavailable";
    healthDescription = "Refresh Knowledge to try loading this Domain again.";
    healthClasses = "border-warning/30 bg-warning/10 text-warning";
    HealthIcon = AlertCircle;
  } else if (sourceCount === null) {
    healthLabel = "Checking";
    healthTitle = "Checking Domain status";
    healthDescription = "Loading source health and processing details.";
    healthClasses = "border-border bg-surface-high text-text-secondary";
    HealthIcon = RefreshCw;
  } else if (counts.failed > 0) {
    healthLabel = "Needs attention";
    healthTitle = `${counts.failed} source${counts.failed === 1 ? " needs" : "s need"} attention`;
    healthDescription = "Review failed sources, then regenerate them after correcting the issue.";
    healthClasses = "border-destructive/30 bg-destructive/10 text-destructive";
    HealthIcon = AlertCircle;
  } else if (counts.processing > 0) {
    healthLabel = "Processing";
    healthTitle = `${counts.processing} source${counts.processing === 1 ? " is" : "s are"} processing`;
    healthDescription = "Agent-readable views will appear as each source finishes processing.";
    healthClasses = "border-warning/30 bg-warning/10 text-warning";
    HealthIcon = RefreshCw;
  } else if (sourceCount === 0) {
    healthLabel = "Empty";
    healthTitle = "Ready for your first source";
    healthDescription = "Upload a document to add reusable knowledge to this Domain.";
    healthClasses = "border-border bg-surface-high text-text-secondary";
  }

  const showHealthIcon = healthLabel !== "Ready" && healthLabel !== "Empty";

  const sourceSummary = collection.filesError
    ? "Source coverage is unavailable"
    : sourceCount === null
      ? "Loading source coverage"
      : sourceCount === 0
        ? "No sources have been added"
        : `${readyCount ?? 0} of ${sourceCount} source${sourceCount === 1 ? "" : "s"} ready for agents`;
  const accessSummary = collection.accessError
    ? "Assignment details are unavailable"
    : collection.agentIds === null
      ? "Assignment visibility is scoped"
      : agentCount === 0
        ? "No agents are assigned yet"
        : `${agentCount} agent${agentCount === 1 ? " has" : "s have"} access to this Domain`;

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
      <section data-slot="domain-overview-status" className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
        <div data-slot="domain-status" className="flex items-start gap-3 bg-surface-low/35 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {showHealthIcon ? (
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${healthClasses}`}>
                <HealthIcon className={`h-4 w-4 ${sourceCount === null && !collection.filesError ? "animate-spin" : ""}`} />
              </span>
            ) : null}
            <div className="min-w-0">
              <h3 className="text-sm font-semibold tracking-[-0.015em] text-foreground">{healthTitle}</h3>
              <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-text-muted">{healthDescription}</p>
            </div>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold ${healthClasses}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {healthLabel}
          </span>
        </div>

        <div
          data-slot="domain-overview-metrics"
          className="grid gap-px border-t border-border bg-border"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(8rem, 1fr))" }}
        >
          <div className="flex items-center gap-2.5 bg-background px-3.5 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]">
              <FileText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold leading-none tabular-nums text-foreground">{sourceCount?.toLocaleString() ?? "---"}</p>
              <p className="mt-1 text-[10px] font-medium text-text-muted">Sources</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 bg-background px-3.5 py-2.5">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${counts.processing > 0 ? "bg-warning/10 text-warning" : "bg-surface-high text-text-muted"}`}>
              <RefreshCw className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className={`text-base font-semibold leading-none tabular-nums ${counts.processing > 0 ? "text-warning" : "text-foreground"}`}>{sourceCount === null ? "---" : counts.processing.toLocaleString()}</p>
              <p className="mt-1 text-[10px] font-medium text-text-muted">Processing</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 bg-background px-3.5 py-2.5">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${counts.failed > 0 ? "bg-destructive/10 text-destructive" : "bg-surface-high text-text-muted"}`}>
              <AlertCircle className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className={`text-base font-semibold leading-none tabular-nums ${counts.failed > 0 ? "text-destructive" : "text-foreground"}`}>{sourceCount === null ? "---" : counts.failed.toLocaleString()}</p>
              <p className="mt-1 text-[10px] font-medium text-text-muted">Failed</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 bg-background px-3.5 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-high text-text-muted">
              <UsersRound className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold leading-none tabular-nums text-foreground">{agentCount?.toLocaleString() ?? (collection.agentIds === null && !collection.accessError ? "Scoped" : "---")}</p>
              <p className="mt-1 text-[10px] font-medium text-text-muted">Assigned agents</p>
            </div>
          </div>
        </div>
      </section>

      <div
        data-slot="domain-overview-layout"
        className="mt-5 grid gap-5"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 24rem), 1fr))" }}
      >
        <section className="overflow-hidden rounded-2xl border border-border bg-background">
          <header className="flex items-start justify-between gap-4 border-b border-border bg-surface-low/25 px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Source coverage</h3>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{sourceSummary}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onOpenSources} className="shrink-0">
              {sourceCount === 0 ? <Upload /> : <FolderOpen />}
              {sourceCount === 0 ? "Add sources" : "Open sources"}
            </Button>
          </header>
          {collection.filesError ? (
            <div role="alert" className="m-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-warning">{collection.filesError}</div>
          ) : collection.files === null ? (
            <div className="flex min-h-40 items-center justify-center" role="status" aria-label="Loading Domain sources"><Loader2 className="h-5 w-5 animate-spin text-text-muted" /></div>
          ) : overviewFiles.length > 0 ? (
            <div className="divide-y divide-border">
              {overviewFiles.map((file) => (
                <button
                  key={`${file.id}:${file.path}`}
                  type="button"
                  onClick={() => onSelectFile(file)}
                  aria-label={`Preview source: ${fileName(file)}`}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-low/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">{fileName(file)}</span>
                    <span className="mt-1 block truncate text-[10px] text-text-muted">{file.summary || file.path}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] text-text-secondary">
                    <span className={`h-1.5 w-1.5 rounded-full ${fileHealthClasses(file)}`} aria-hidden="true" />
                    {knowledgeFileStatusLabel(file)}
                  </span>
                </button>
              ))}
              {sourceCount !== null && sourceCount > overviewFiles.length ? (
                <button type="button" onClick={onOpenSources} className="w-full px-4 py-3 text-left text-[11px] font-medium text-[var(--selection-accent)] hover:bg-surface-low/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
                  View all {sourceCount} sources
                </button>
              ) : null}
            </div>
          ) : (
            <div className="px-5 py-10 text-center">
              <FileText className="mx-auto h-5 w-5 text-text-muted" />
              <h3 className="mt-3 text-xs font-semibold text-foreground">Build knowledge for this Domain</h3>
              <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-text-muted">Add source documents to create agent-readable knowledge for this business area.</p>
            </div>
          )}
        </section>

        <aside className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface-low/20">
          <section className="px-4 py-4 sm:px-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">Purpose</h3>
                <p className="mt-2 text-xs leading-relaxed text-text-muted">
                  {description || "No purpose has been added yet. Describe what belongs here so collaborators know when to use this Domain."}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={onOpenSettings} className="h-8 shrink-0 px-2.5 text-[11px]">
                <Settings2 /> Settings
              </Button>
            </div>
          </section>
          <section className="px-4 py-4 sm:px-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]">
                <UsersRound className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-foreground">Agent access</h3>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{accessSummary}</p>
                <button type="button" onClick={onOpenAccess} className="mt-3 text-[11px] font-medium text-[var(--selection-accent)] hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Review assignments
                </button>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function CollectionSettings({
  collection,
  busy,
  nameInputId,
  deleteBlockedReason,
  onSave,
  onDelete,
  onOpenAccess,
}: {
  collection: KnowledgeHubCollection;
  busy: boolean;
  nameInputId: string;
  deleteBlockedReason: string | null;
  onSave: (name: string, description: string) => Promise<void>;
  onDelete: () => void;
  onOpenAccess: () => void;
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
  const nameHintId = `${nameInputId}-hint`;
  const descriptionInputId = `${nameInputId}-description`;
  const descriptionHintId = `${descriptionInputId}-hint`;
  const sourceSummary = collection.filesError
    ? "Sources unavailable"
    : collection.files === null
      ? "Sources loading"
      : `${collection.files.length} source${collection.files.length === 1 ? "" : "s"}`;
  const assignmentSummary = collection.accessError
    ? "Assignments unavailable"
    : collection.agentIds === null
      ? "Assignment visibility scoped"
      : `${collection.agentIds.length} assigned agent${collection.agentIds.length === 1 ? "" : "s"}`;
  const editStateLabel = !canAdminister ? "Read only" : hasChanges ? "Unsaved changes" : "All changes saved";
  const editStateClasses = !canAdminister ? "text-text-muted" : hasChanges ? "text-warning" : "text-[var(--selection-accent)]";

  function discardChanges() {
    setName(initialName);
    setDescription(initialDescription);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedName || saving || !canAdminister || !hasChanges) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmedName, trimmedDescription);
    } catch (cause) {
      setError(describeKnowledgeHubError(cause, "Domain details couldn't be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-6xl px-4 pb-8 pt-5 sm:px-6 sm:pb-10 lg:px-8">
      <header data-slot="domain-settings-header" className="mb-5 border-b border-border pb-5 text-left">
        <div className="min-w-0 text-left">
          <h3 className="text-lg font-semibold tracking-[-0.02em] text-foreground">Domain configuration</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">Set a clear knowledge boundary, then review the account record and access rules behind it.</p>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-left">
          <p data-slot="domain-settings-state" className={`text-xs font-semibold ${editStateClasses}`}>{editStateLabel}</p>
          <p className="text-[10px] text-text-muted">{canAdminister ? "Published across the Knowledge Hub after you save." : "Domain admin access is required to edit."}</p>
        </div>
      </header>

      <div data-slot="domain-settings-layout" className="grid overflow-hidden rounded-2xl border border-border bg-background lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.75fr)]">
        <section aria-labelledby="domain-catalog-identity-heading" className="min-w-0">
          <header className="border-b border-border px-4 py-4 sm:px-6 sm:py-5">
            <h4 id="domain-catalog-identity-heading" className="text-sm font-semibold text-foreground">Catalog identity</h4>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-text-muted">Give collaborators a precise name and boundary before they add sources or assign agents.</p>
          </header>

          <div className="space-y-6 px-4 py-5 sm:px-6 sm:py-6">
            <div>
              <label className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-foreground" htmlFor={nameInputId}>
                <span>Domain name</span>
                <span aria-hidden="true" className="text-[10px] font-normal tabular-nums text-text-muted">{name.length}/120</span>
              </label>
              <Input
                id={nameInputId}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
                disabled={!canAdminister || busy}
                maxLength={120}
                aria-describedby={nameHintId}
                aria-invalid={!trimmedName}
                className="h-11 rounded-xl border-border bg-input-background px-3.5 text-sm font-medium"
              />
              <p id={nameHintId} className={`mt-2 text-[11px] leading-relaxed ${trimmedName ? "text-text-muted" : "text-destructive"}`}>
                {trimmedName ? "Use the business-area name people already recognize." : "A Domain name is required before you can save."}
              </p>
            </div>

            <div>
              <label className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-foreground" htmlFor={descriptionInputId}>
                <span>Purpose and boundary</span>
                <span aria-hidden="true" className="text-[10px] font-normal tabular-nums text-text-muted">{description.length}/280</span>
              </label>
              <Textarea
                id={descriptionInputId}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setError(null);
                }}
                disabled={!canAdminister || busy}
                rows={6}
                maxLength={280}
                aria-describedby={descriptionHintId}
                placeholder="What belongs here, and what should stay outside this Domain?"
                className="min-h-36 resize-y rounded-xl border-border bg-input-background px-3.5 py-3 text-sm leading-relaxed"
              />
              <p id={descriptionHintId} className="mt-2 text-[11px] leading-relaxed text-text-muted">Describe scope and intended use, not a full inventory of sources.</p>
            </div>
          </div>

          <section data-slot="domain-catalog-preview" aria-labelledby="domain-catalog-preview-heading" className="border-t border-border bg-surface-low/25 px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex items-center justify-between gap-3">
              <h4 id="domain-catalog-preview-heading" className="text-[10px] font-semibold text-text-secondary">Domain list preview</h4>
              <span className="text-[9px] text-text-muted">Updates as you type</span>
            </div>
            <div className="mt-3 rounded-xl border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-4 py-3.5">
              <p className="truncate text-sm font-semibold text-foreground">{trimmedName || "Untitled Domain"}</p>
              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-muted">{trimmedDescription || "No purpose has been added yet."}</p>
              <p className="mt-3 text-[10px] text-text-muted">{sourceSummary} · {assignmentSummary}</p>
            </div>
          </section>
        </section>

        <aside className="min-w-0 border-t border-border bg-surface-low/25 lg:border-l lg:border-t-0">
          <section aria-labelledby="domain-governance-record-heading" className="px-4 py-4 sm:px-5 sm:py-5">
            <h4 id="domain-governance-record-heading" className="text-sm font-semibold text-foreground">Governance record</h4>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">Stable account details that identify this Domain.</p>
            <dl data-slot="space-metadata" className="mt-4 divide-y divide-border border-y border-border text-xs">
              <div className="flex items-start justify-between gap-4 py-3">
                <dt className="text-text-muted">Domain path</dt>
                <dd className="max-w-[65%] break-all text-right font-mono text-[11px] font-medium text-text-secondary">{collection.workspace.slug || "Not available"}</dd>
              </div>
              <div className="flex items-start justify-between gap-4 py-3">
                <dt className="text-text-muted">Your permission</dt>
                <dd className="font-medium capitalize text-text-secondary">{collection.workspace.role || "Unknown"}</dd>
              </div>
              <div className="flex items-start justify-between gap-4 py-3">
                <dt className="text-text-muted">Created</dt>
                <dd className="font-medium text-text-secondary">
                  {collection.workspace.createdAt ? <time dateTime={collection.workspace.createdAt}>{formatKnowledgeDate(collection.workspace.createdAt)}</time> : "Not available"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4 py-3">
                <dt className="text-text-muted">Last updated</dt>
                <dd className="font-medium text-text-secondary">
                  {collection.workspace.updatedAt ? <time dateTime={collection.workspace.updatedAt}>{formatKnowledgeDate(collection.workspace.updatedAt)}</time> : "Not available"}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="domain-access-boundary-heading" className="border-t border-border px-4 py-4 sm:px-5 sm:py-5">
            <div className="flex items-start justify-between gap-4">
              <h4 id="domain-access-boundary-heading" className="text-xs font-semibold text-foreground">Access boundary</h4>
              <span className="text-right text-[10px] font-medium text-text-secondary">{assignmentSummary}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-muted">Assignment grants access. It does not prove that an agent synchronized or used a source.</p>
            <button type="button" onClick={onOpenAccess} className="mt-3 text-[11px] font-semibold text-[var(--selection-accent)] hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Review assigned agents</button>
          </section>

          <section data-slot="domain-lifecycle" aria-labelledby="domain-lifecycle-heading" className="border-t border-border px-4 py-4 sm:px-5 sm:py-5">
            <div className="flex items-start justify-between gap-4">
              <h4 id="domain-lifecycle-heading" className="text-xs font-semibold text-foreground">Lifecycle</h4>
              <span className="text-[10px] font-medium text-text-muted">{deleteBlockedReason ? "Protected" : canAdminister ? "Admin controlled" : "Admin only"}</span>
            </div>
            {deleteBlockedReason ? (
              <p className="mt-2 text-[11px] leading-relaxed text-text-muted">{deleteBlockedReason}</p>
            ) : canAdminister ? (
              <>
                <p className="mt-2 text-[11px] leading-relaxed text-text-muted">Deleting removes this Domain and all of its sources. Assigned agents lose future access.</p>
                <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={busy || saving} className="-ml-2 mt-3 justify-start text-destructive hover:text-destructive">Delete Domain</Button>
              </>
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-text-muted">A Domain admin controls deletion and other lifecycle changes.</p>
            )}
          </section>
        </aside>
      </div>

      {error ? (
        <div role="alert" className="mt-5 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs leading-relaxed text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      {canAdminister ? (
        <footer data-slot="space-actions" className="sticky bottom-0 z-10 mt-5 flex flex-col gap-3 border-t border-border bg-background py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-secondary">{hasChanges ? "Review and publish your updates" : "The published profile is current"}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-text-muted">{hasChanges ? "Saving updates the Domain wherever it appears in Knowledge Hub." : "Edit the profile when this business boundary changes."}</p>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={discardChanges} disabled={!hasChanges || busy || saving}>Discard changes</Button>
            <Button type="submit" disabled={!trimmedName || !hasChanges || busy || saving} className="min-w-36">
              {saving ? <Loader2 className="animate-spin" /> : null}
              {saving ? "Saving" : "Save changes"}
            </Button>
          </div>
        </footer>
      ) : (
        <div className="mt-5 border-t border-border py-4">
          <p className="text-xs font-semibold text-text-secondary">Read-only Domain</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">Domain admin access is required to change these details.</p>
        </div>
      )}
    </form>
  );
}

function FileDetails({
  collection,
  file,
  busy,
  onSave,
}: {
  collection: KnowledgeHubCollection;
  file: WorkspaceFile;
  busy: boolean;
  onSave: (input: { displayName: string; keywords: string[]; summary: string | null }) => Promise<void>;
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
        <footer className="mt-5 flex flex-col gap-3 rounded-2xl border border-border bg-surface-low/30 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${hasChanges ? "bg-warning" : "bg-success"}`} aria-hidden="true" />
            <div><p className="text-xs font-medium text-text-secondary">{hasChanges ? "Metadata has unsaved changes" : "Metadata is up to date"}</p><p className="mt-0.5 text-[10px] leading-relaxed text-text-muted">Changes affect how this source is labeled and discovered.</p></div>
          </div>
          <Button type="submit" disabled={!trimmedDisplayName || !hasChanges || busy || saving} className="min-w-36">
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
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
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
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
      <Avatar className={`h-10 w-10 shrink-0 border ${assigned ? "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)]" : "border-border bg-surface-high"}`}>
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
          aria-label={assigned ? `Remove ${name} from Domain` : `Assign ${name} to Domain`}
          disabled={actionDisabled}
          onClick={() => void onToggle(!assigned).catch(() => undefined)}
          className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50 ${assigned ? "border-transparent bg-transparent text-text-muted hover:border-destructive/25 hover:bg-destructive/10 hover:text-destructive" : "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)] hover:bg-[rgb(var(--selection-accent-rgb)_/_0.16)]"}`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : assigned ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
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
  const domainName = knowledgeWorkspaceName(collection.workspace);

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
            Domain admins can review all direct agent assignments. Your own access remains unchanged.
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
              Only assigned agents can access sources in {domainName}.
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
            Agent details are unavailable. Existing assignments are shown by identifier and cannot be changed until the roster reloads. {agentsError}
          </div>
        ) : null}
        {agentsLoading ? <span className="sr-only" role="status">Loading agents</span> : null}

        <div className="grid gap-px bg-border lg:grid-cols-2">
          <section data-lane="assigned" aria-labelledby="assigned-domain-agents-heading" className="min-h-72 bg-[rgb(var(--selection-accent-rgb)_/_0.045)]">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--selection-accent-border)] px-4 py-3.5 sm:px-5">
              <div>
                <h4 id="assigned-domain-agents-heading" className="text-[13px] font-semibold text-foreground">Inside this Domain</h4>
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
                      <span className="shrink-0 rounded-full border border-[var(--selection-accent-border)] px-2 py-1 text-[9px] font-medium text-[var(--selection-accent)]">Direct access</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-48 items-center justify-center px-4 py-8 text-center">
                  <div className="max-w-xs">
                    <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--selection-accent-border)] bg-background/70 text-[var(--selection-accent)]"><ShieldCheck className="h-4 w-4" /></span>
                    <h4 className="mt-3 text-[13px] font-semibold text-foreground">The boundary is empty</h4>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-muted">Assign an available agent to give it direct access to this Domain.</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section data-lane="available" aria-labelledby="available-domain-agents-heading" className="min-h-72 bg-background">
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
              <div>
                <h4 id="available-domain-agents-heading" className="text-[13px] font-semibold text-foreground">Available agents</h4>
                <p className="mt-0.5 text-[10px] text-text-muted">Outside this Domain</p>
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
                    <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{agents.length === 0 ? "Launch an agent before assigning it to this Domain." : "All visible agents are already inside this Domain boundary."}</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="flex items-start gap-2.5 border-t border-border bg-surface-low/25 px-5 py-3.5 text-[11px] leading-relaxed text-text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--selection-accent)]" />
          Assignment grants access to this Domain. It does not indicate that an agent has synchronized or used a source.
        </footer>
      </section>
    </div>
  );
}

export function KnowledgeHub({
  agents = [],
  agentsLoading = false,
  agentsError = null,
  initialDomainId = null,
  onRefreshAgents,
  onSelectedDomainChange,
  headerControlsTargetId,
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
    refreshing,
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
  const inspectorTabsId = useId();
  const domainNameInputId = useId();
  const collectionsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const sourcesHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const uploadsOptionRef = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [domainFilter, setDomainFilter] = useState<DomainFilter>("all");
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(initialDomainId);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [sourceInspectorView, setSourceInspectorView] = useState<SourceInspectorView>("preview");
  const [mobilePane, setMobilePane] = useState<MobilePane>(initialDomainId ? "details" : "collections");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingCollectionDelete, setPendingCollectionDelete] = useState<KnowledgeHubCollection | null>(null);
  const [pendingFileDelete, setPendingFileDelete] = useState<{ collection: KnowledgeHubCollection; file: WorkspaceFile } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const desktopPaneLayout = useSyncExternalStore(
    subscribeToKnowledgePaneLayout,
    getKnowledgePaneLayoutSnapshot,
    getKnowledgePaneLayoutServerSnapshot,
  );
  const headerControlsTarget = useSyncExternalStore(
    subscribeToHeaderControlsTarget,
    () => headerControlsTargetId ? document.getElementById(headerControlsTargetId) : null,
    () => null,
  );

  const hasProcessingFiles = collections.some((collection) => (
    collection.files?.some((file) => knowledgeFileHealth(file) === "processing")
  ));
  useEffect(() => {
    if (!hasProcessingFiles) return;
    const interval = window.setInterval(() => void refresh(), 8_000);
    return () => window.clearInterval(interval);
  }, [hasProcessingFiles, refresh]);

  const searchedCollections = collections.filter((collection) => collectionMatches(collection, deferredQuery));
  const domainFilterCounts: Record<DomainFilter, number> = {
    all: searchedCollections.length,
    ready: 0,
    processing: 0,
    attention: 0,
    empty: 0,
  };
  searchedCollections.forEach((collection) => {
    const state = domainOperationalState(collection);
    if (state) domainFilterCounts[state] += 1;
  });
  const visibleCollections = domainFilter === "all"
    ? searchedCollections
    : searchedCollections.filter((collection) => domainOperationalState(collection) === domainFilter);
  const selectedDomainFilterLabel = DOMAIN_FILTER_OPTIONS.find(([value]) => value === domainFilter)?.[1] ?? "All Domains";
  const selectedCollection = visibleCollections.find((collection) => collection.workspace.id === selectedCollectionId)
    ?? visibleCollections[0]
    ?? null;
  const visibleFiles = selectedCollection?.files
    ? [...selectedCollection.files]
        .filter((file) => collectionOwnFieldsMatch(selectedCollection, deferredQuery) || fileMatches(file, deferredQuery))
        .sort((left, right) => left.path.localeCompare(right.path))
    : [];
  const selectedFile = selectedCollection && selectedFilePath
    ? selectedCollection.files?.find((file) => file.path === selectedFilePath) ?? null
    : null;
  const selectedCollectionName = selectedCollection ? knowledgeWorkspaceName(selectedCollection.workspace) : null;
  const activeInspectorTab = inspectorTab === "source" && !selectedFile ? "overview" : inspectorTab;
  const inspectorTabOptions: ReadonlyArray<readonly [InspectorTab, string]> = selectedFile
    ? [["overview", "Overview"], ["source", "Source"], ["access", "Assigned agents"], ["settings", "Settings"]]
    : [["overview", "Overview"], ["access", "Assigned agents"], ["settings", "Settings"]];
  const showFileContext = Boolean(selectedFile && activeInspectorTab === "source");
  const availableInspectorTabs = inspectorTabOptions.map(([tab]) => tab);
  const pageError = actionError || catalogError || (workspacesClient ? null : workspaceConnectionError);
  const selectedBusy = Boolean(busyAction && selectedCollection && busyAction.includes(selectedCollection.workspace.id));
  const mobilePaneOptions: ReadonlyArray<readonly [MobilePane, string]> = sourcesOpen
    ? [["collections", "Domains"], ["sources", "Sources"], ["details", "Details"]]
    : [["collections", "Domains"], ["details", "Details"]];
  const controlsInSharedHeader = desktopPaneLayout && Boolean(headerControlsTarget);

  useEffect(() => {
    if (!selectedCollection || !selectedCollectionName) {
      onSelectedDomainChange?.(null);
      return;
    }
    const health = fileHealthCounts(selectedCollection);
    onSelectedDomainChange?.({
      id: selectedCollection.workspace.id,
      name: selectedCollectionName,
      description: selectedCollection.workspace.description,
      sourceCount: selectedCollection.files?.length ?? null,
      assignedAgentCount: selectedCollection.agentIds?.length ?? null,
      processingCount: selectedCollection.files ? health.processing : null,
      failedCount: selectedCollection.files ? health.failed : null,
    });
  }, [onSelectedDomainChange, selectedCollection, selectedCollectionName]);

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

  function showMobilePane(pane: MobilePane) {
    setMobilePane(pane);
    if (typeof window === "undefined" || typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 1023px)").matches) return;
    window.requestAnimationFrame(() => {
      const heading = pane === "collections"
        ? collectionsHeadingRef.current
        : pane === "sources"
          ? sourcesHeadingRef.current
          : detailsHeadingRef.current;
      heading?.focus();
    });
  }

  function openSources() {
    setSourcesOpen(true);
    showMobilePane("sources");
  }

  function closeSources() {
    setSourcesOpen(false);
    showMobilePane(selectedCollection ? "details" : "collections");
    if (desktopPaneLayout) window.requestAnimationFrame(() => uploadsOptionRef.current?.focus());
  }

  function handleInspectorTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, tab: InspectorTab) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = availableInspectorTabs.indexOf(tab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? availableInspectorTabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + availableInspectorTabs.length) % availableInspectorTabs.length;
    const nextTab = availableInspectorTabs[nextIndex]!;
    setInspectorTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`${inspectorTabsId}-${nextTab}`)?.focus());
  }

  function chooseCollection(collection: KnowledgeHubCollection) {
    setSelectedCollectionId(collection.workspace.id);
    setSelectedFilePath(null);
    setInspectorTab("overview");
    showMobilePane(sourcesOpen ? "sources" : "details");
  }

  function chooseFile(file: WorkspaceFile) {
    setSelectedFilePath(file.path);
    setSourceInspectorView("preview");
    setInspectorTab("source");
    showMobilePane("details");
  }

  function focusDomainNameInput(collection: KnowledgeHubCollection) {
    setSelectedCollectionId(collection.workspace.id);
    setSelectedFilePath(null);
    setInspectorTab("settings");
    showMobilePane("details");
    window.requestAnimationFrame(() => {
      const input = document.getElementById(domainNameInputId);
      if (!(input instanceof HTMLInputElement)) return;
      input.focus();
      input.select();
    });
  }

  async function handleCreate(name: string, description: string) {
    const collection = await runAction("create-collection", () => createCollection({
      name,
      description: description || undefined,
    }));
    setSelectedCollectionId(collection.workspace.id);
    setSelectedFilePath(null);
    setInspectorTab("overview");
    setSourcesOpen(false);
    showMobilePane("details");
  }

  async function handleUpload(files: File[]) {
    if (!selectedCollection || files.length === 0) return;
    const uploaded = await runAction(`upload:${selectedCollection.workspace.id}`, () => uploadFiles(selectedCollection, files));
    if (uploaded[0]) {
      setSelectedFilePath(uploaded[0].path);
      setSourceInspectorView("preview");
      setInspectorTab("source");
    }
  }

  async function downloadSource(collection: KnowledgeHubCollection, file: WorkspaceFile) {
    if (!workspacesClient) return;
    await runAction(`download:${collection.workspace.id}:${file.path}`, async () => {
      const result = await workspacesClient.downloadFileBytes(
        knowledgeWorkspaceRef(collection.workspace),
        file.path,
        {},
        { raw: true },
      );
      downloadFileBytes(result.name || fileName(file), result.content);
    });
  }

  async function toggleAgentAccess(collection: KnowledgeHubCollection, agentId: string, enabled: boolean) {
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

  function renderKnowledgeControls() {
    return (
      <div role="group" aria-label="Knowledge controls" className="flex w-full flex-wrap items-center justify-end gap-2">
        <label htmlFor={searchId} className="relative block min-w-[min(100%,15rem)] max-w-xl flex-[1_1_20rem]">
          <span className="sr-only">Search Domains and sources</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <Input
            id={searchId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Domains and sources"
            className="h-9 rounded-xl bg-input-background text-xs"
            style={{ paddingLeft: "2.25rem" }}
          />
        </label>
        <Button type="button" variant="outline" size="icon" onClick={() => {
          void refresh();
          void Promise.resolve().then(() => onRefreshAgents?.()).catch(() => undefined);
        }} disabled={!workspacesClient || refreshing} aria-label="Refresh Knowledge and agents" className="h-9 w-9 shrink-0 rounded-xl">
          {refreshing || agentsLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
        <Button type="button" onClick={() => setCreateOpen(true)} disabled={!workspacesClient || workspacesLoading} className="h-9 shrink-0 rounded-xl px-4">
          New Domain
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
        {controlsInSharedHeader && headerControlsTarget ? createPortal(renderKnowledgeControls(), headerControlsTarget) : null}
        <div className="shrink-0">
          {!controlsInSharedHeader ? (
            <div className="border-b border-border bg-background px-4 py-3 sm:px-5">
              {renderKnowledgeControls()}
            </div>
          ) : null}
          {pageError ? (
            <div role="alert" className="mx-4 my-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive sm:mx-5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{pageError}</span>
              {actionError ? (
                <button type="button" onClick={() => setActionError(null)} className="shrink-0 font-medium underline underline-offset-2">Dismiss</button>
              ) : null}
            </div>
          ) : null}
          <div
            className="mx-4 my-3 grid rounded-lg border border-border bg-surface-low/35 p-1 sm:mx-5"
            style={{
              display: desktopPaneLayout ? "none" : "grid",
              gridTemplateColumns: `repeat(${mobilePaneOptions.length}, minmax(0, 1fr))`,
            }}
            aria-label="Knowledge sections"
          >
            {mobilePaneOptions.map(([pane, label]) => (
              <button
                key={pane}
                type="button"
                onClick={() => showMobilePane(pane)}
                disabled={pane !== "collections" && !selectedCollection}
                aria-pressed={mobilePane === pane}
                className={`h-8 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 ${mobilePane === pane ? "bg-background text-foreground" : "text-text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <div
            data-slot="knowledge-pane-grid"
            className="grid h-full min-h-0"
            style={{ gridTemplateColumns: desktopPaneLayout
              ? sourcesOpen
                ? "220px 300px minmax(0, 1fr)"
                : "220px minmax(0, 1fr)"
              : "minmax(0, 1fr)" }}
          >
            <section
              data-pane="domains"
              data-active={mobilePane === "collections"}
              className="min-h-0 flex-col border-r border-border bg-surface-low/20"
              style={{ display: desktopPaneLayout || mobilePane === "collections" ? "flex" : "none" }}
              aria-labelledby="knowledge-collections-heading"
            >
              <div className="shrink-0 border-b border-border bg-surface-low/30 px-4 py-3.5">
                <div className="flex items-center gap-2.5">
                  <h2 ref={collectionsHeadingRef} id="knowledge-collections-heading" tabIndex={-1} className="min-w-0 flex-1 text-sm font-semibold tracking-[-0.015em] text-foreground outline-none">Domains</h2>
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-text-secondary">{visibleCollections.length}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={domainFilter === "all" ? "Filter Domains" : `Filter Domains: ${selectedDomainFilterLabel}`}
                        title={domainFilter === "all" ? "Filter Domains" : selectedDomainFilterLabel}
                        className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${domainFilter === "all" ? "border-border bg-background text-text-muted hover:text-foreground" : "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]"}`}
                      >
                        <ListFilter className="h-3.5 w-3.5" />
                        {domainFilter !== "all" ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={7} className="z-[80] w-52 rounded-xl border-border bg-popover p-1.5 shadow-xl">
                      <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">Domain state</DropdownMenuLabel>
                      <DropdownMenuRadioGroup value={domainFilter} onValueChange={(value) => setDomainFilter(value as DomainFilter)}>
                        {DOMAIN_FILTER_OPTIONS.map(([value, label], index) => (
                          <div key={value}>
                            {index === 1 ? <DropdownMenuSeparator className="my-1" /> : null}
                            <DropdownMenuRadioItem value={value} className="rounded-lg py-2 pl-8 pr-2 text-xs">
                              <span>{label}</span>
                              <span className="ml-auto tabular-nums text-text-muted">{domainFilterCounts[value]}</span>
                            </DropdownMenuRadioItem>
                          </div>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <p className="mt-2 text-[11px] leading-[1.45] text-text-muted">Organize knowledge by business area. Keep every agent focused.</p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto py-2">
                {loading && collections.length === 0 ? (
                  <div className="flex min-h-40 items-center justify-center" role="status" aria-label="Loading Domains">
                    <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
                  </div>
                ) : visibleCollections.length > 0 ? visibleCollections.map((collection) => {
                  const selected = collection.workspace.id === selectedCollection?.workspace.id;
                  const counts = fileHealthCounts(collection);
                  const domainName = knowledgeWorkspaceName(collection.workspace);
                  return (
                    <div
                      key={collection.workspace.id}
                      className={`group relative mx-2 my-1 overflow-hidden rounded-xl border transition-[background-color,border-color] ${selected ? "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)]" : "border-transparent hover:border-border hover:bg-background"}`}
                    >
                      <button
                        type="button"
                        onClick={() => chooseCollection(collection)}
                        aria-current={selected ? "page" : undefined}
                        className="relative w-full px-3 py-3 pr-11 text-left focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span className="block min-w-0">
                          <span className="block truncate text-xs font-semibold text-foreground">{domainName}</span>
                          <span className="mt-1 block line-clamp-2 text-[10px] leading-relaxed text-text-muted">{collection.workspace.description || "Add a short description"}</span>
                          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-text-muted">
                            <span>{collection.files === null ? "Sources unavailable" : `${collection.files.length} source${collection.files.length === 1 ? "" : "s"}`}</span>
                            {counts.failed > 0 ? <span className="text-destructive">{counts.failed} failed</span> : counts.processing > 0 ? <span className="text-warning">{counts.processing} processing</span> : collection.files ? <span>{collection.files.length === 0 ? "Empty" : "Ready"}</span> : null}
                            <span>{collection.accessError ? "Assignments unavailable" : collection.agentIds === null ? "Assignments scoped" : `${collection.agentIds.length} assigned agent${collection.agentIds.length === 1 ? "" : "s"}`}</span>
                          </span>
                        </span>
                      </button>
                      {collectionCanAdminister(collection) ? (
                        <button
                          type="button"
                          onClick={() => focusDomainNameInput(collection)}
                          aria-label={`Rename Domain: ${domainName}`}
                          title="Rename Domain"
                          className={`absolute right-2.5 top-2.5 z-20 flex h-7 w-7 items-center justify-center rounded-md border bg-background/85 transition-[color,background-color,opacity] hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-[var(--selection-accent-border)] text-[var(--selection-accent)] opacity-100" : "border-border text-text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  );
                }) : (
                  <div className="px-5 py-10 text-center">
                    {deferredQuery ? <Search className="mx-auto h-5 w-5 text-text-muted" /> : domainFilter !== "all" ? <ListFilter className="mx-auto h-5 w-5 text-text-muted" /> : <LibraryBig className="mx-auto h-5 w-5 text-text-muted" />}
                    <p className="mt-3 text-xs font-semibold text-foreground">
                      {deferredQuery
                        ? "No matching knowledge"
                        : domainFilter === "ready"
                          ? "No ready Domains"
                          : domainFilter === "processing"
                            ? "No Domains are processing"
                            : domainFilter === "attention"
                              ? "No Domains need attention"
                              : domainFilter === "empty"
                                ? "No empty Domains"
                                : "No Domains yet"}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                      {deferredQuery
                        ? "Try another name, path, summary, or keyword."
                        : domainFilter !== "all"
                          ? "Choose another filter to see more Domains."
                          : "Create a Domain to organize knowledge by business area."}
                    </p>
                  </div>
                )}
              </div>
              <div className="shrink-0 border-t border-border px-4 py-3">
                <p className="text-[10px] font-medium text-text-muted">Sources</p>
                <div className="mt-2 space-y-2 text-[11px]">
                  <button
                    ref={uploadsOptionRef}
                    type="button"
                    onClick={openSources}
                    disabled={!selectedCollection}
                    aria-label="Uploads"
                    aria-expanded={sourcesOpen}
                    aria-controls="knowledge-sources-pane"
                    className={`flex w-full items-center gap-2 rounded-md py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 ${sourcesOpen ? "text-[var(--selection-accent)]" : "text-text-secondary hover:text-foreground"}`}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Uploads
                    <span className="ml-auto text-text-muted">{sourcesOpen ? "Open" : "Available"}</span>
                  </button>
                  <div className="flex items-center gap-2 text-text-muted"><ExternalLink className="h-3.5 w-3.5" /> External connectors <Badge variant="outline" className="ml-auto h-5 rounded-full px-2 text-[8px]">Coming Soon</Badge></div>
                </div>
              </div>
            </section>

            <section
              id="knowledge-sources-pane"
              data-pane="sources"
              data-active={sourcesOpen && mobilePane === "sources"}
              className={`relative min-h-0 flex-col border-r border-border bg-background ${dragOver ? "bg-[rgb(var(--selection-accent-rgb)_/_0.04)]" : ""}`}
              style={{ display: sourcesOpen && (desktopPaneLayout || mobilePane === "sources") ? "flex" : "none" }}
              aria-labelledby="knowledge-sources-heading"
              onDragOver={(event) => {
                event.preventDefault();
                if (selectedCollection && collectionCanWrite(selectedCollection) && !busyAction) setDragOver(true);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget === event.target) setDragOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                if (event.dataTransfer.files.length) void handleUpload(Array.from(event.dataTransfer.files)).catch(() => undefined);
              }}
            >
              <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
                  <button type="button" onClick={() => showMobilePane("collections")} aria-label="Back to Domains" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-low hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ display: desktopPaneLayout ? "none" : "flex" }}>
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <h2
                    ref={sourcesHeadingRef}
                    id="knowledge-sources-heading"
                    tabIndex={-1}
                    aria-label={selectedCollectionName ? `Sources in ${selectedCollectionName}` : "Sources"}
                    className="truncate text-xs font-semibold text-foreground outline-none"
                  >
                    Sources
                  </h2>
                  <p className="mt-0.5 truncate text-[10px] text-text-muted">{selectedCollection ? `${visibleFiles.length} visible source${visibleFiles.length === 1 ? "" : "s"}` : "Choose a Domain"}</p>
                </div>
                {selectedCollection && collectionCanWrite(selectedCollection) ? (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById(uploadInputId)?.click()} disabled={selectedBusy} className="h-8 px-2.5 text-[11px]">
                      {busyAction?.startsWith("upload:") ? <Loader2 className="animate-spin" /> : <Upload />}
                      Upload
                    </Button>
                    <input
                      id={uploadInputId}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        event.currentTarget.value = "";
                        void handleUpload(files).catch(() => undefined);
                      }}
                    />
                  </>
                ) : null}
                <Button type="button" variant="ghost" size="icon" onClick={closeSources} aria-label="Close sources" className="h-8 w-8 shrink-0">
                  <X />
                </Button>
              </div>

              {dragOver ? (
                <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border border-dashed border-[var(--selection-accent-border)] bg-background/90">
                  <div className="text-center">
                    <Upload className="mx-auto h-5 w-5 text-[var(--selection-accent)]" />
                    <p className="mt-2 text-xs font-semibold text-foreground">Drop sources to upload</p>
                  </div>
                </div>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto">
                {!selectedCollection ? (
                  <div className="flex h-full min-h-64 items-center justify-center p-6 text-center">
                    <div className="max-w-xs">
                      <FolderOpen className="mx-auto h-5 w-5 text-text-muted" />
                      <p className="mt-3 text-xs font-semibold text-foreground">Choose a Domain</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-text-muted">Its uploaded sources and processing state will appear here.</p>
                    </div>
                  </div>
                ) : selectedCollection.filesError ? (
                  <div className="m-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-warning">{selectedCollection.filesError}</div>
                ) : visibleFiles.length > 0 ? (
                  <div className="divide-y divide-border">
                    {visibleFiles.map((file) => {
                      const selected = file.path === selectedFile?.path;
                      return (
                        <button
                          key={`${file.id}:${file.path}`}
                          type="button"
                          onClick={() => chooseFile(file)}
                          aria-current={selected ? "true" : undefined}
                          className={`group relative w-full px-4 py-3 text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected ? "bg-[rgb(var(--selection-accent-rgb)_/_0.07)]" : "hover:bg-surface-low/45"}`}
                        >
                          {selected ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-px bg-[var(--selection-accent)]" /> : null}
                          <div className="flex items-start gap-2.5">
                            <FileText className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-[var(--selection-accent)]" : "text-text-muted"}`} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-foreground">{fileName(file)}</span>
                              <span className="mt-1 block truncate text-[10px] text-text-muted">{file.path}</span>
                              {file.summary ? <span className="mt-1.5 line-clamp-2 block text-[10px] leading-relaxed text-text-muted">{file.summary}</span> : null}
                              <span className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
                                <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${fileHealthClasses(file)}`} aria-hidden="true" />{knowledgeFileStatusLabel(file)}</span>
                                {file.keywords.slice(0, 2).map((keyword) => <span key={keyword} className="rounded-full bg-surface-high px-1.5 py-0.5">{keyword}</span>)}
                              </span>
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-full min-h-64 items-center justify-center p-6 text-center">
                    <div className="max-w-xs">
                      {deferredQuery ? <Search className="mx-auto h-5 w-5 text-text-muted" /> : <Upload className="mx-auto h-5 w-5 text-text-muted" />}
                      <p className="mt-3 text-xs font-semibold text-foreground">{deferredQuery ? "No matching sources" : "No sources yet"}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{deferredQuery ? "Try another path, summary, or keyword." : collectionCanWrite(selectedCollection) ? "Upload documents to create agent-readable knowledge." : "This Domain has no visible sources."}</p>
                      {!deferredQuery && collectionCanWrite(selectedCollection) ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById(uploadInputId)?.click()} className="mt-4"><Upload /> Upload sources</Button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section
              data-pane="inspector"
              data-active={mobilePane === "details"}
              className="min-h-0 min-w-0 flex-col bg-background"
              style={{ display: desktopPaneLayout || mobilePane === "details" ? "flex" : "none" }}
              aria-labelledby="knowledge-inspector-heading"
            >
              {!showFileContext ? (
                <h2 ref={detailsHeadingRef} id="knowledge-inspector-heading" tabIndex={-1} className="sr-only outline-none">
                  {selectedCollectionName
                    ? activeInspectorTab === "overview"
                      ? `Overview of ${selectedCollectionName}`
                      : activeInspectorTab === "access"
                        ? `Assigned agents for ${selectedCollectionName}`
                        : `Settings for ${selectedCollectionName}`
                    : "Knowledge details"}
                </h2>
              ) : null}

              {selectedCollection ? (
                <>
                  <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-3">
                    <button type="button" onClick={() => showMobilePane(sourcesOpen ? "sources" : "collections")} aria-label={sourcesOpen ? "Back to sources" : "Back to Domains"} className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-low hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ display: desktopPaneLayout ? "none" : "flex" }}>
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <div role="tablist" aria-label="Knowledge details" className="flex min-w-0 items-center gap-1 overflow-x-auto">
                      {inspectorTabOptions.map(([tab, label]) => (
                         <button
                           key={tab}
                           id={`${inspectorTabsId}-${tab}`}
                           type="button"
                           role="tab"
                           aria-selected={activeInspectorTab === tab}
                           aria-controls={`${inspectorTabsId}-panel`}
                           tabIndex={activeInspectorTab === tab ? 0 : -1}
                           onClick={() => setInspectorTab(tab)}
                           onKeyDown={(event) => handleInspectorTabKeyDown(event, tab)}
                           className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeInspectorTab === tab ? "bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]" : "text-text-muted hover:bg-surface-low hover:text-foreground"}`}
                         >
                            {tab === "overview" ? <LibraryBig className="h-3.5 w-3.5" /> : tab === "source" ? <FileText className="h-3.5 w-3.5" /> : tab === "access" ? <UsersRound className="h-3.5 w-3.5" /> : <Settings2 className="h-3.5 w-3.5" />}
                            {label}
                            {tab === "access" && selectedCollection.agentIds !== null && !selectedCollection.accessError ? (
                              <span aria-hidden="true" className="inline-flex min-w-4 items-center justify-center rounded-full border border-current/20 bg-background/70 px-1 py-0.5 text-[8px] font-semibold tabular-nums">{selectedCollection.agentIds.length}</span>
                            ) : null}
                          </button>
                        ))}
                     </div>
                   </div>
                   {showFileContext && selectedFile ? (
                     <div data-slot="source-context-header" className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface-low/20 px-3 py-2.5 sm:px-4">
                       <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]">
                         <FileText className="h-4 w-4" />
                       </span>
                       <div className="min-w-[10rem] flex-[1_1_12rem]">
                         <h2
                           ref={detailsHeadingRef}
                           id="knowledge-inspector-heading"
                           tabIndex={-1}
                           aria-label={`${fileName(selectedFile)} in ${selectedCollectionName}`}
                           className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground outline-none"
                         >
                           {fileName(selectedFile)}
                         </h2>
                         <p className="mt-1 truncate text-[10px] text-text-muted">{selectedFile.path}</p>
                       </div>
                       <div role="group" aria-label="Source view" className="flex shrink-0 items-center rounded-lg border border-border bg-background p-0.5">
                         {(["preview", "metadata"] as const).map((view) => (
                           <button
                             key={view}
                             type="button"
                             aria-pressed={sourceInspectorView === view}
                             onClick={() => setSourceInspectorView(view)}
                             className={`h-7 rounded-md px-2.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sourceInspectorView === view ? "bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]" : "text-text-muted hover:text-foreground"}`}
                           >
                             {view === "preview" ? "Preview" : "Metadata"}
                           </button>
                         ))}
                       </div>
                       <div className="flex items-center gap-1">
                         <Button type="button" variant="ghost" size="icon" onClick={() => void downloadSource(selectedCollection, selectedFile).catch(() => undefined)} disabled={selectedBusy} aria-label="Download original source" className="h-8 w-8">
                           <Download />
                         </Button>
                         {collectionCanWrite(selectedCollection) ? (
                           <Button type="button" variant="ghost" size="icon" onClick={() => void runAction(`regenerate:${selectedCollection.workspace.id}:${selectedFile.path}`, () => regenerateFile(selectedCollection, selectedFile)).catch(() => undefined)} disabled={selectedBusy} aria-label="Regenerate agent view" className="h-8 w-8">
                             {busyAction?.startsWith("regenerate:") ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                           </Button>
                         ) : null}
                         {collectionCanWrite(selectedCollection) ? (
                           <Button type="button" variant="ghost" size="icon" onClick={() => setPendingFileDelete({ collection: selectedCollection, file: selectedFile })} disabled={selectedBusy} aria-label="Delete source" className="h-8 w-8 text-text-muted hover:text-destructive">
                             <Trash2 />
                           </Button>
                         ) : null}
                       </div>
                     </div>
                   ) : null}
                   <div
                      id={`${inspectorTabsId}-panel`}
                      role="tabpanel"
                      aria-labelledby={`${inspectorTabsId}-${activeInspectorTab}`}
                      tabIndex={0}
                      className="min-h-0 flex-1 overflow-y-auto outline-none"
                    >
                      {activeInspectorTab === "overview" ? (
                        <CollectionOverview
                          collection={selectedCollection}
                          onOpenSources={openSources}
                          onSelectFile={chooseFile}
                          onOpenAccess={() => setInspectorTab("access")}
                          onOpenSettings={() => setInspectorTab("settings")}
                        />
                      ) : activeInspectorTab === "source" && selectedFile ? (
                        sourceInspectorView === "metadata" ? (
                          <FileDetails
                            key={`${selectedFile.id}:${selectedFile.displayName}:${selectedFile.summary ?? ""}:${selectedFile.keywords.join("|")}`}
                            collection={selectedCollection}
                            file={selectedFile}
                            busy={selectedBusy}
                            onSave={async (input) => {
                              const updated = await runAction(`metadata:${selectedCollection.workspace.id}:${selectedFile.path}`, () => updateFile(selectedCollection, selectedFile, input));
                              setSelectedFilePath(updated.path);
                            }}
                          />
                        ) : (
                          <FilePreview client={workspacesClient} collection={selectedCollection} file={selectedFile} />
                        )
                    ) : activeInspectorTab === "settings" ? (
                      <CollectionSettings
                        key={`${selectedCollection.workspace.id}:${selectedCollection.workspace.updatedAt}:${selectedCollection.workspace.name}:${selectedCollection.workspace.description ?? ""}`}
                        collection={selectedCollection}
                        busy={selectedBusy}
                        nameInputId={domainNameInputId}
                        deleteBlockedReason={domainDeletionBlockedReason(selectedCollection.workspace)}
                        onSave={async (name, description) => {
                          await runAction(`collection:${selectedCollection.workspace.id}`, () => updateCollection(selectedCollection, { name, description }));
                        }}
                        onDelete={() => setPendingCollectionDelete(selectedCollection)}
                        onOpenAccess={() => setInspectorTab("access")}
                      />
                      ) : activeInspectorTab === "access" ? (
                      <AgentAccess
                        collection={selectedCollection}
                        agents={agents}
                        agentsLoading={agentsLoading}
                        agentsError={agentsError}
                        busyAgentId={busyAgentId}
                        onToggle={(agentId, enabled) => toggleAgentAccess(selectedCollection, agentId, enabled)}
                      />
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="flex h-full min-h-64 items-center justify-center p-6 text-center">
                  <div className="max-w-xs">
                    <MoreHorizontal className="mx-auto h-5 w-5 text-text-muted" />
                    <p className="mt-3 text-xs font-semibold text-foreground">Nothing selected</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-muted">Choose a Domain to review its sources, metadata, and assigned agents.</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      {createOpen ? (
        <CreateCollectionDialog open onOpenChange={setCreateOpen} onCreate={handleCreate} />
      ) : null}
      <DestructiveConfirmDialog
        open={Boolean(pendingCollectionDelete)}
        title="Delete Domain?"
        description={pendingCollectionDelete ? `Delete ${knowledgeWorkspaceName(pendingCollectionDelete.workspace)} and all of its sources? Assigned agents will lose access. Copies already available to a running agent may remain until it refreshes.` : ""}
        busy={Boolean(pendingCollectionDelete && busyAction === `delete:${pendingCollectionDelete.workspace.id}`)}
        onCancel={() => { if (!busyAction) setPendingCollectionDelete(null); }}
        onConfirm={() => {
          if (!pendingCollectionDelete) return;
          const collection = pendingCollectionDelete;
          void runAction(`delete:${collection.workspace.id}`, () => deleteCollection(collection))
            .then(() => {
              setPendingCollectionDelete(null);
              setSelectedCollectionId(null);
              setSelectedFilePath(null);
              showMobilePane("collections");
            })
            .catch(() => undefined);
        }}
      />
      <DestructiveConfirmDialog
        open={Boolean(pendingFileDelete)}
        title="Delete source?"
        description={pendingFileDelete ? `Remove ${fileName(pendingFileDelete.file)} from this Domain? A copy already available to a running agent may remain until it refreshes.` : ""}
        busy={Boolean(pendingFileDelete && busyAction === `delete-file:${pendingFileDelete.collection.workspace.id}:${pendingFileDelete.file.path}`)}
        onCancel={() => { if (!busyAction) setPendingFileDelete(null); }}
        onConfirm={() => {
          if (!pendingFileDelete) return;
          const pending = pendingFileDelete;
          void runAction(`delete-file:${pending.collection.workspace.id}:${pending.file.path}`, () => deleteFile(pending.collection, pending.file))
            .then(() => {
              setPendingFileDelete(null);
              setSelectedFilePath(null);
              setInspectorTab("overview");
            })
            .catch(() => undefined);
        }}
      />
    </div>
  );
}
