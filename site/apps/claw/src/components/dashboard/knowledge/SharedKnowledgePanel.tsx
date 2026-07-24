"use client";

import React from "react";
import type { Workspace, WorkspaceFile, WorkspaceGrant, WorkspacesAPI } from "@hypercli.com/sdk/workspaces";
import { FileRow } from "@hypercli/shared-ui/files";
import type { FileEntry } from "@hypercli/shared-ui/files";
import { ConfirmDialog } from "@hypercli/shared-ui";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  HardDrive,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { AgentMeta } from "@/lib/avatar";
import { agentAvatar } from "@/lib/avatar";
import { MarkdownContent } from "@/components/dashboard/chat/MarkdownContent";
import { useWorkspace } from "@/components/dashboard/WorkspaceContext";
import { downloadFileBytes } from "@/lib/download-file";
import { TooltipHint } from "@/components/ClawTooltip";

export type SharedKnowledgeAgent = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  pod_name?: string | null;
  state?: string | null;
  meta?: AgentMeta | null;
};

type KnowledgeBase = {
  workspace: Workspace;
  agentIds: string[];
  files: WorkspaceFile[];
  grants: WorkspaceGrant[];
  filesError: string | null;
  grantsError: string | null;
};

type WorkspaceFilePatch = Parameters<WorkspacesAPI["updateFile"]>[2];

type SharedKnowledgePanelProps = {
  agents?: SharedKnowledgeAgent[];
  agentsLoading?: boolean;
  agentsError?: string | null;
  connectionError?: string | null;
  preferredAgentId?: string | null;
  workspaces?: WorkspacesAPI | null;
  availableWorkspaces?: Workspace[];
  selectedWorkspaceId?: string | null;
  onSelectWorkspace?: (workspaceId: string, workspace?: Workspace) => void;
  onWorkspacesChanged?: (preferredWorkspaceId?: string | null) => Promise<unknown> | void;
  ready?: boolean;
};

type PendingPathDelete = {
  base: KnowledgeBase;
  path: string;
  recursive: boolean;
  count: number;
};

function agentDisplayName(agent: SharedKnowledgeAgent): string {
  return agent.displayName?.trim() || agent.name || agent.pod_name || agent.id;
}

function normalizeAgentState(state?: string | null): string {
  return state ? state.toLowerCase().replaceAll("_", " ") : "unknown";
}

function agentStateDotClass(state?: string | null): string {
  if (state === "RUNNING") return "bg-success";
  if (state === "FAILED" || state === "RESTORE_FAILED" || state === "SYNC_FAILED") return "bg-destructive";
  if (state === "STOPPED") return "bg-text-muted";
  return "bg-warning";
}

function assignedAgentsForBase(base: KnowledgeBase, agentById: Map<string, SharedKnowledgeAgent>): SharedKnowledgeAgent[] {
  return base.agentIds.flatMap((agentId) => {
    const agent = agentById.get(agentId);
    return agent ? [agent] : [];
  });
}

function contentCountLabel(base: KnowledgeBase): string {
  if (base.filesError) return "Files unavailable";
  const files = base.files.length;
  const folders = new Set(base.files.flatMap((file) => {
    const parts = normalizeWorkspacePath(file.path).split("/").filter(Boolean);
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
  })).size;
  return `${files} file${files === 1 ? "" : "s"}${folders > 0 ? `, ${folders} folder${folders === 1 ? "" : "s"}` : ""}`;
}

function processingCount(base: KnowledgeBase): number {
  return base.files.filter((file) => {
    const state = `${file.fileState} ${file.processingState || ""}`.toLowerCase();
    return !state.includes("processed") && !state.includes("finished") && !state.includes("deleted");
  }).length;
}

function failedFileCount(base: KnowledgeBase): number {
  return base.files.filter((file) => `${file.fileState} ${file.processingState || ""}`.toLowerCase().includes("failed")).length;
}

function agentCountLabel(count: number): string {
  return `${count} agent${count === 1 ? "" : "s"}`;
}

function grantIsActive(grant: WorkspaceGrant): boolean {
  if (grant.revokedAt) return false;
  if (!grant.expiresAt) return true;
  const expiresAt = Date.parse(grant.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt > Date.now();
}

function workspaceCanWrite(workspace: Workspace): boolean {
  return workspace.role === "contributor" || workspace.role === "admin";
}

function workspaceCanAdminister(workspace: Workspace): boolean {
  return workspace.role === "admin";
}

function activeAgentGrants(grants: WorkspaceGrant[], agentId: string): WorkspaceGrant[] {
  return grants.filter((grant) => grant.subjectType === "agent" && grant.subjectId === agentId && grantIsActive(grant));
}

function withWorkspaceGrants(base: KnowledgeBase, grants: WorkspaceGrant[]): KnowledgeBase {
  return {
    ...base,
    grants,
    agentIds: Array.from(new Set(grants
      .filter((grant) => grant.subjectType === "agent" && grantIsActive(grant))
      .map((grant) => grant.subjectId))),
  };
}

function normalizeWorkspacePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "").replace(/^\.\//, "");
}

function baseName(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  return normalized.split("/").filter(Boolean).at(-1) || normalized || "file";
}

function errorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  return typeof error.statusCode === "number" ? error.statusCode : null;
}

function describeError(error: unknown, fallback: string): string {
  if (errorStatusCode(error) === 403) return "You don't have permission to perform this action.";
  return error instanceof Error ? error.message : fallback;
}

function workspaceFileEntries(base: KnowledgeBase, prefix = ""): FileEntry[] {
  const normalizedPrefix = normalizeWorkspacePath(prefix);
  const directories = new Map<string, FileEntry>();
  const files: FileEntry[] = [];

  for (const file of base.files) {
    const path = normalizeWorkspacePath(file.path);
    if (!path) continue;
    if (normalizedPrefix && path !== normalizedPrefix && !path.startsWith(`${normalizedPrefix}/`)) continue;
    const relative = normalizedPrefix ? path.slice(normalizedPrefix.length).replace(/^\/+/, "") : path;
    if (!relative) continue;
    const [firstSegment, ...rest] = relative.split("/");
    if (rest.length > 0) {
      const dirPath = normalizedPrefix ? `${normalizedPrefix}/${firstSegment}` : firstSegment;
      if (!directories.has(dirPath)) {
        directories.set(dirPath, { name: firstSegment, path: dirPath, type: "directory", source: "s3" });
      }
      continue;
    }
    files.push({
      name: file.displayName || baseName(path),
      path,
      type: "file",
      versionId: file.currentVersionId ?? undefined,
      source: "s3",
    });
  }

  return [
    ...Array.from(directories.values()).sort((a, b) => a.name.localeCompare(b.name)),
    ...files.sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

function workspaceFileByPath(base: KnowledgeBase, path: string): WorkspaceFile | null {
  const normalized = normalizeWorkspacePath(path);
  return base.files.find((file) => normalizeWorkspacePath(file.path) === normalized || file.id === path) ?? null;
}

function keywordsInput(keywords?: string[]): string {
  return (keywords || []).join(", ");
}

function parseKeywords(value: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of value.split(",")) {
    const keyword = raw.trim();
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords;
}

function AgentChip({ agent, selected, disabled, onClick }: { agent: SharedKnowledgeAgent; selected?: boolean; disabled?: boolean; onClick?: () => void }) {
  const displayName = agentDisplayName(agent);
  const avatar = agentAvatar(displayName, agent.meta);
  const AvatarIcon = avatar.icon;
  const className = `inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors ${
    selected
      ? "border-primary/45 bg-primary/10 text-primary"
      : "border-border bg-background/45 text-text-secondary hover:border-border-strong hover:text-foreground"
  } ${disabled ? "cursor-not-allowed opacity-55" : ""}`;
  const content = (
    <>
      <span className={`h-1.5 w-1.5 rounded-full ${agentStateDotClass(agent.state)}`} aria-hidden="true" />
      <AvatarIcon className="h-3 w-3" style={{ color: avatar.fgColor }} />
      <span>{displayName}</span>
      <span className="text-[10px] text-text-muted">{normalizeAgentState(agent.state)}</span>
      {selected && <Check className="h-3 w-3" />}
    </>
  );

  if (!onClick) return <span className={className}>{content}</span>;

  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={Boolean(selected)} className={className}>
      {content}
    </button>
  );
}

function NewKnowledgeBaseModal({
  agents,
  agentsLoading,
  defaultAgentId,
  onClose,
  onCreate,
}: {
  agents: SharedKnowledgeAgent[];
  agentsLoading?: boolean;
  defaultAgentId?: string | null;
  onClose: () => void;
  onCreate: (name: string, description: string, agentIds: string[]) => Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [selectedAgentIds, setSelectedAgentIds] = React.useState<Set<string>>(() => new Set(
    defaultAgentId && agents.some((agent) => agent.id === defaultAgentId) ? [defaultAgentId] : [],
  ));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canCreate = Boolean(name.trim()) && !submitting && !agentsLoading;
  const handleCreate = async () => {
    if (!canCreate) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name.trim(), description.trim(), Array.from(selectedAgentIds));
      onClose();
    } catch (err) {
      setError(describeError(err, "Unable to create shared knowledge."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button type="button" aria-label="Close new shared knowledge" onClick={submitting ? undefined : onClose} className="absolute inset-0 cursor-default bg-background/75 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-labelledby="new-workspace-title" className="relative flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-low text-text-secondary">
              <HardDrive className="h-4 w-4" />
            </div>
            <div>
              <h2 id="new-workspace-title" className="text-[16px] font-semibold leading-tight text-foreground">New shared knowledge</h2>
              <p className="mt-1 text-[12px] leading-snug text-text-muted">Create shared knowledge that agents can access during conversations.</p>
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} disabled={submitting} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-45">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-5">
            <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-low text-text-secondary" aria-hidden="true">
              <HardDrive className="h-4 w-4" />
            </div>
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g., Team knowledge" className="h-10 w-full rounded-xl border border-border bg-surface-low/40 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
            </label>

            <div />
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">Description</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={280} placeholder="What should agents find here?" className="min-h-[98px] w-full resize-none rounded-xl border border-border bg-surface-low/40 px-3 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
              <span className="mt-1 block text-right text-[11px] text-text-muted">{description.length} chars</span>
            </label>
          </div>

          <div className="mt-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">Assign Agents</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {agents.map((agent) => {
                const selected = selectedAgentIds.has(agent.id);
                return (
                  <AgentChip
                    key={agent.id}
                    agent={agent}
                    selected={selected}
                    disabled={submitting}
                    onClick={() => {
                      setSelectedAgentIds((current) => {
                        const next = new Set(current);
                        if (next.has(agent.id)) next.delete(agent.id);
                        else next.add(agent.id);
                        return next;
                      });
                    }}
                  />
                );
              })}
              {agents.length === 0 && <p className="text-[12px] text-text-muted">{agentsLoading ? "Loading agents..." : "No agents are available yet."}</p>}
            </div>
          </div>
          {error && <p role="alert" className="mt-4 text-[12px] text-destructive">{error}</p>}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} disabled={submitting} className="h-9 rounded-xl border border-border px-4 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-45">
            Cancel
          </button>
          <button type="button" onClick={() => void handleCreate()} disabled={!canCreate} className="inline-flex h-9 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-45">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {submitting ? "Creating..." : "Create shared knowledge"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function EditKnowledgeBaseModal({ base, onClose, onSave }: { base: KnowledgeBase; onClose: () => void; onSave: (name: string, description: string) => Promise<void> }) {
  const [name, setName] = React.useState(base.workspace.name);
  const [description, setDescription] = React.useState(base.workspace.description || "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const canSave = Boolean(name.trim()) && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), description.trim());
      onClose();
    } catch (err) {
      setError(describeError(err, "Unable to update shared knowledge."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button type="button" aria-label="Close edit shared knowledge" onClick={saving ? undefined : onClose} className="absolute inset-0 cursor-default bg-background/75 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-labelledby="edit-workspace-title" className="relative flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-low text-text-secondary">
              <Pencil className="h-4 w-4" />
            </div>
            <div>
              <h2 id="edit-workspace-title" className="text-[16px] font-semibold leading-tight text-foreground">Edit shared knowledge</h2>
              <p className="mt-1 text-[12px] leading-snug text-text-muted">Update the shared knowledge name and description.</p>
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-surface-low/40 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
          </label>
          <label className="mt-5 block">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={280} className="min-h-[98px] w-full resize-none rounded-xl border border-border bg-surface-low/40 px-3 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
          </label>
          {error && <p role="alert" className="mt-4 text-[12px] text-destructive">{error}</p>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="h-9 rounded-xl border border-border px-4 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-45">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={!canSave} className="inline-flex h-9 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-45">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving..." : "Save"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function FileMetadataForm({
  file,
  busy,
  readOnly = false,
  onSave,
}: {
  file: WorkspaceFile;
  busy?: boolean;
  readOnly?: boolean;
  onSave: (path: string, patch: WorkspaceFilePatch) => Promise<void>;
}) {
  const [displayName, setDisplayName] = React.useState(file.displayName || "");
  const [keywords, setKeywords] = React.useState(keywordsInput(file.keywords));
  const [summary, setSummary] = React.useState(file.summary || "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canSave = Boolean(displayName.trim()) && !busy && !saving && !readOnly;
  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(file.path, {
        displayName: displayName.trim(),
        keywords: parseKeywords(keywords),
        summary: summary.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update file metadata.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-3 rounded-xl border border-border bg-surface-low/20 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">Display Name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={readOnly} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none transition-colors focus:border-primary/50 disabled:cursor-default disabled:opacity-70" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">Keywords</span>
            <input value={keywords} onChange={(event) => setKeywords(event.target.value)} disabled={readOnly} placeholder="pricing, retention, onboarding" className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50 disabled:cursor-default disabled:opacity-70" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">Summary</span>
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} disabled={readOnly} rows={3} className="min-h-[76px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-primary/50 disabled:cursor-default disabled:opacity-70" />
          </label>
          {error && <p className="text-[12px] text-destructive">{error}</p>}
        </div>
        <div className="min-w-0 rounded-lg border border-border bg-background/60 p-3">
          <p className="truncate text-[12px] font-medium text-foreground">{file.path}</p>
          <dl className="mt-3 space-y-2 text-[11px] text-text-muted">
            <div className="flex justify-between gap-3"><dt>Status</dt><dd className="text-text-secondary">{file.processingState || file.fileState}</dd></div>
            <div className="flex justify-between gap-3"><dt>Version</dt><dd className="max-w-[120px] truncate text-text-secondary">{file.currentVersionId || "None"}</dd></div>
          </dl>
          {readOnly ? (
            <p className="mt-4 text-[11px] leading-relaxed text-text-muted">Contributor access is required to edit metadata.</p>
          ) : (
            <button type="button" onClick={() => void handleSave()} disabled={!canSave} className="mt-4 inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-3 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-45">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save Metadata
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

type WorkspaceFileTab = "raw" | "metadata" | "markdown";

function textPreviewFromBytes(bytes: Uint8Array): { text: string; binary: boolean } {
  const sample = bytes.slice(0, Math.min(bytes.length, 256 * 1024));
  const text = new TextDecoder("utf-8", { fatal: false }).decode(sample);
  const controlChars = text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)?.length ?? 0;
  return { text, binary: controlChars > 8 };
}

function WorkspaceFilesView({
  base,
  workspaces,
  busy,
  canWrite,
  onUploadFiles,
  onRequestDeletePath,
  onUpdateFile,
  onRegenerateFile,
}: {
  base: KnowledgeBase;
  workspaces: WorkspacesAPI | null;
  busy?: boolean;
  canWrite: boolean;
  onUploadFiles: (files: Array<{ path: string; file: File }>) => Promise<void>;
  onRequestDeletePath: (path: string, options?: { recursive?: boolean }) => void;
  onUpdateFile: (path: string, patch: WorkspaceFilePatch) => Promise<void>;
  onRegenerateFile: (path: string) => Promise<void>;
}) {
  const [currentPath, setCurrentPath] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<WorkspaceFileTab>("metadata");
  const [loadingView, setLoadingView] = React.useState(false);
  const [viewError, setViewError] = React.useState<string | null>(null);
  const [rawPreview, setRawPreview] = React.useState<{ text: string; binary: boolean } | null>(null);
  const [markdown, setMarkdown] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const entries = React.useMemo(() => workspaceFileEntries(base, currentPath), [base, currentPath]);
  const selectedFile = selectedPath ? workspaceFileByPath(base, selectedPath) : null;

  React.useEffect(() => {
    if (!selectedFile || !workspaces || tab === "metadata") return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoadingView(true);
      setViewError(null);
      setRawPreview(null);
      setMarkdown(null);
      try {
        if (tab === "raw") {
          const result = await workspaces.downloadFileBytes(base.workspace.slug, selectedFile.path, {}, { raw: true });
          if (!cancelled) setRawPreview(textPreviewFromBytes(result.content));
          return;
        }
        const result = await workspaces.markdownFile(base.workspace.slug, selectedFile.path);
        if (!cancelled) setMarkdown(result.markdown);
      } catch (err) {
        if (!cancelled) setViewError(err instanceof Error ? err.message : "Unable to load file view.");
      } finally {
        if (!cancelled) setLoadingView(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base.workspace.slug, selectedFile, tab, workspaces]);

  const uploadFiles = React.useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setViewError(null);
    try {
      await onUploadFiles(files.map((file) => ({
        path: currentPath ? `${currentPath}/${file.name}` : file.name,
        file,
      })));
    } catch (err) {
      setViewError(describeError(err, "Unable to upload files."));
    }
  }, [currentPath, onUploadFiles]);

  const downloadFile = React.useCallback(async (path: string) => {
    if (!workspaces) return;
    setViewError(null);
    try {
      const result = await workspaces.downloadFileBytes(base.workspace.slug, path, {}, { raw: true });
      downloadFileBytes(result.name || baseName(path), result.content);
    } catch (err) {
      setViewError(describeError(err, "Unable to download file."));
    }
  }, [base.workspace.slug, workspaces]);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    if (!event.dataTransfer.files.length || busy || !canWrite) return;
    void uploadFiles(event.dataTransfer.files);
  };

  const goUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split("/").filter(Boolean);
    setCurrentPath(parts.slice(0, -1).join("/"));
    setSelectedPath(null);
    setViewError(null);
  };

  return (
    <div
      className={`relative grid min-h-[620px] overflow-hidden rounded-xl border bg-background lg:h-[560px] lg:min-h-0 lg:grid-cols-[minmax(240px,34%)_minmax(0,1fr)] ${dragOver ? "border-primary/60 bg-primary/5" : "border-border"}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy && canWrite) setDragOver(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget === event.target) setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
          <div className="rounded-xl border border-primary/40 bg-background px-4 py-3 text-[13px] font-medium text-foreground shadow-xl">
            {currentPath ? `Drop files to upload to ${currentPath}` : "Drop files here to upload"}
          </div>
        </div>
      )}
      <div className="flex min-h-[250px] max-h-[320px] flex-col border-b border-border lg:max-h-none lg:min-h-0 lg:border-b-0 lg:border-r">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <button type="button" onClick={goUp} disabled={!currentPath} className="h-7 rounded-lg border border-border px-2 text-[11px] text-text-secondary transition-colors hover:bg-surface-low disabled:opacity-40">
            Up
          </button>
          <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">{currentPath || base.workspace.slug}</p>
          {canWrite ? (
            <>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-[11px] text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-45">
                <Plus className="h-3 w-3" />
                Upload
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) void uploadFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
            </>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {entries.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-[12px] text-text-muted">
              Drop files here
            </div>
          ) : (
            entries.map((entry) => (
              <FileRow
                key={entry.path}
                entry={entry}
                searchQuery=""
                onOpen={(item) => {
                  if (item.type === "file") {
                    setSelectedPath(item.path);
                    setTab("metadata");
                    setViewError(null);
                  }
                }}
                onToggle={(item) => {
                  setCurrentPath(normalizeWorkspacePath(item.path));
                  setSelectedPath(null);
                  setViewError(null);
                }}
                onDelete={canWrite ? (item) => onRequestDeletePath(item.path, item.type === "directory" ? { recursive: true } : undefined) : undefined}
                onDownload={(item) => { void downloadFile(item.path); }}
                onCopyPath={(item) => void navigator.clipboard?.writeText(item.path)}
              />
            ))
          )}
        </div>
      </div>
      <div className="flex min-h-[360px] flex-col lg:min-h-0">
        {viewError && (
          <div role="alert" className="m-3 mb-0 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            {viewError}
          </div>
        )}
        {selectedFile ? (
          <>
            <div className="flex min-h-[44px] shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <FileText className="h-4 w-4 text-text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-foreground">{selectedFile.displayName || baseName(selectedFile.path)}</p>
                <p className="truncate text-[10px] text-text-muted">{selectedFile.path}</p>
              </div>
              <div className="flex rounded-lg border border-border bg-surface-low p-0.5">
                {(["raw", "metadata", "markdown"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTab(value)}
                    className={`h-7 rounded-md px-2.5 text-[11px] font-medium capitalize transition-colors ${tab === value ? "bg-background text-foreground" : "text-text-muted hover:text-foreground"}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <TooltipHint label="Download source" disabled={busy}>
                <button type="button" aria-label="Download source" onClick={() => void downloadFile(selectedFile.path)} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-45">
                  <Download className="h-3.5 w-3.5" />
                </button>
              </TooltipHint>
              {canWrite ? (
                <button type="button" onClick={() => { setViewError(null); void onRegenerateFile(selectedFile.path).catch((err) => setViewError(describeError(err, "Unable to regenerate file."))); }} disabled={busy} className="inline-flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-[12px] font-semibold text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-45">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate
                </button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {tab === "metadata" ? (
                <FileMetadataForm key={`${selectedFile.id}:${selectedFile.displayName}:${selectedFile.summary || ""}:${selectedFile.keywords.join("|")}`} file={selectedFile} busy={busy} readOnly={!canWrite} onSave={onUpdateFile} />
              ) : loadingView ? (
                <div className="flex h-full items-center justify-center text-text-muted">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : viewError ? (
                null
              ) : tab === "raw" ? (
                rawPreview?.binary ? (
                  <div className="rounded-xl border border-border bg-surface-low/20 p-4 text-[12px] text-text-muted">
                    Binary source file. Use download from the file actions menu to inspect it locally.
                  </div>
                ) : (
                  <pre className="min-h-full whitespace-pre-wrap rounded-xl border border-border bg-surface-low/20 p-4 text-[12px] leading-relaxed text-foreground">{rawPreview?.text || ""}</pre>
                )
              ) : markdown !== null ? (
                <div className="min-h-full rounded-xl border border-border bg-surface-low/20 p-4">
                  <MarkdownContent content={markdown} className="text-[13px] leading-relaxed text-foreground" />
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-surface-low/20 p-4 text-[12px] text-text-muted">
                  Markdown is not ready yet. Current state: {selectedFile.processingState || selectedFile.fileState}.
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-5 text-center text-[12px] text-text-muted">
            Select a file to view raw contents, edit metadata, or inspect generated Markdown.
          </div>
        )}
      </div>
    </div>
  );
}

function KnowledgeBaseCard({
  base,
  agents,
  agentById,
  workspaces,
  expanded,
  assignmentOpen,
  busy,
  onToggle,
  onToggleAssignment,
  onToggleAgent,
  onEdit,
  onDeleteWorkspace,
  onUploadFiles,
  onRequestDeletePath,
  onUpdateFile,
  onRegenerateFile,
}: {
  base: KnowledgeBase;
  agents: SharedKnowledgeAgent[];
  agentById: Map<string, SharedKnowledgeAgent>;
  workspaces: WorkspacesAPI | null;
  expanded: boolean;
  assignmentOpen: boolean;
  busy?: boolean;
  onToggle: () => void;
  onToggleAssignment: () => void;
  onToggleAgent: (agentId: string) => void;
  onEdit: () => void;
  onDeleteWorkspace: () => void;
  onUploadFiles: (files: Array<{ path: string; file: File }>) => Promise<void>;
  onRequestDeletePath: (path: string, options?: { recursive?: boolean }) => void;
  onUpdateFile: (path: string, patch: WorkspaceFilePatch) => Promise<void>;
  onRegenerateFile: (path: string) => Promise<void>;
}) {
  const assignedAgents = assignedAgentsForBase(base, agentById);
  const unknownAgentCount = Math.max(0, base.agentIds.length - assignedAgents.length);
  const processing = processingCount(base);
  const failed = failedFileCount(base);
  const canWrite = workspaceCanWrite(base.workspace);
  const canAdminister = workspaceCanAdminister(base.workspace);

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-background/70 transition-colors hover:border-border-strong">
      <div className="grid w-full gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-center gap-3 text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-low text-text-secondary shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
            <HardDrive className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold leading-tight text-foreground">{base.workspace.name}</h3>
            <p className="mt-1 truncate text-[12px] leading-snug text-text-muted">{base.workspace.description || base.workspace.slug}</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-start gap-3 pl-[52px] sm:justify-end sm:pl-0">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted"><HardDrive className="h-3 w-3" />{contentCountLabel(base)}</span>
          {!base.filesError && processing > 0 && <span className={`text-[11px] ${failed > 0 ? "text-destructive" : "text-warning"}`}>{failed > 0 ? `${failed} failed` : `${processing} processing`}</span>}
          <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted"><Bot className="h-3 w-3" />{base.grantsError ? "Access unavailable" : agentCountLabel(base.agentIds.length)}</span>
          {base.workspace.role ? <span className="rounded-full border border-border px-2 py-0.5 text-[10px] capitalize text-text-muted">{base.workspace.role}</span> : null}
          {canAdminister ? (
            <>
              <button type="button" aria-label={`Edit ${base.workspace.name}`} onClick={onEdit} disabled={busy} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-50">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label={`Delete ${base.workspace.name}`} onClick={onDeleteWorkspace} disabled={busy} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-destructive disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
          <button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${base.workspace.name}`} onClick={onToggle} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-4">
          <div className="mb-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-muted">Contents</h4>
          </div>

          {base.filesError ? (
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-3 text-[12px] text-warning">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{base.filesError}</span>
            </div>
          ) : (
            <WorkspaceFilesView
              base={base}
              workspaces={workspaces}
              busy={busy}
              canWrite={canWrite}
              onUploadFiles={onUploadFiles}
              onRequestDeletePath={onRequestDeletePath}
              onUpdateFile={onUpdateFile}
              onRegenerateFile={onRegenerateFile}
            />
          )}

          <div className="mt-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-muted">Assigned Agents</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {assignedAgents.map((agent) => <AgentChip key={agent.id} agent={agent} />)}
              {unknownAgentCount > 0 && <span className="inline-flex h-7 items-center rounded-full border border-border bg-surface-low px-2.5 text-[11px] text-text-muted">{agentCountLabel(unknownAgentCount)} not visible</span>}
              {!base.grantsError && base.agentIds.length === 0 && <span className="text-[12px] text-text-muted">No agents assigned.</span>}
               {canAdminister ? (
                 <button type="button" onClick={onToggleAssignment} disabled={Boolean(base.grantsError) || agents.length === 0 || busy} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45">
                   <Plus className="h-3 w-3" /> Assign Agent
                 </button>
               ) : null}
            </div>
            {base.grantsError && (
              <div className="mt-2 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{base.grantsError}</span>
              </div>
            )}
             {canAdminister && assignmentOpen && (
              <div className="mt-3 rounded-xl border border-border bg-surface-low/25 p-3">
                <div className="flex flex-wrap gap-2">
                  {agents.map((agent) => (
                    <AgentChip
                      key={agent.id}
                      agent={agent}
                      selected={base.agentIds.includes(agent.id)}
                      disabled={busy}
                      onClick={() => onToggleAgent(agent.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export function SharedKnowledgePanel({
  agents = [],
  agentsLoading = false,
  agentsError = null,
  connectionError = null,
  preferredAgentId = null,
  workspaces = null,
  availableWorkspaces,
  selectedWorkspaceId = null,
  onSelectWorkspace,
  onWorkspacesChanged,
  ready = Boolean(workspaces),
}: SharedKnowledgePanelProps) {
  const {
    selectedWorkspaceId: globallySelectedWorkspaceId,
    refreshSelectedWorkspaceAgents,
  } = useWorkspace();
  const [knowledgeBases, setKnowledgeBases] = React.useState<KnowledgeBase[]>([]);
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [expandedBaseId, setExpandedBaseId] = React.useState<string | null>(null);
  const [assignmentBaseId, setAssignmentBaseId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingBaseId, setEditingBaseId] = React.useState<string | null>(null);
  const [pendingDeleteBase, setPendingDeleteBase] = React.useState<KnowledgeBase | null>(null);
  const [pendingPathDelete, setPendingPathDelete] = React.useState<PendingPathDelete | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busyBaseCounts, setBusyBaseCounts] = React.useState<Map<string, number>>(() => new Map());
  const [error, setError] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const loadRequestRef = React.useRef(0);
  const selectedWorkspaceIdRef = React.useRef(selectedWorkspaceId);
  const globallySelectedWorkspaceIdRef = React.useRef(globallySelectedWorkspaceId);
  const debouncedQueryRef = React.useRef(debouncedQuery);

  const agentById = React.useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const setBaseBusy = React.useCallback((baseId: string, busy: boolean) => {
    setBusyBaseCounts((current) => {
      const next = new Map(current);
      const count = next.get(baseId) ?? 0;
      if (busy) next.set(baseId, count + 1);
      else if (count <= 1) next.delete(baseId);
      else next.set(baseId, count - 1);
      return next;
    });
  }, []);

  React.useLayoutEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
  }, [selectedWorkspaceId]);

  React.useLayoutEffect(() => {
    globallySelectedWorkspaceIdRef.current = globallySelectedWorkspaceId;
  }, [globallySelectedWorkspaceId]);

  React.useLayoutEffect(() => {
    debouncedQueryRef.current = debouncedQuery;
  }, [debouncedQuery]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const loadWorkspaces = React.useCallback(async (searchTerm: string) => {
    const requestId = ++loadRequestRef.current;
    if (!workspaces || !ready) {
      setKnowledgeBases([]);
      setLoading(false);
      setLoadError(null);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const listed = searchTerm
        ? await workspaces.search(searchTerm)
        : availableWorkspaces ?? await workspaces.list();
      const hydrated = await Promise.all(listed.map(async (workspace): Promise<KnowledgeBase> => {
        const canAdminister = workspaceCanAdminister(workspace);
        const agentAccess = canAdminister
          ? workspaces.listGrants(workspace.slug).then((grants) => ({
              grants,
              agentIds: Array.from(new Set(grants
                .filter((grant) => grant.subjectType === "agent" && grantIsActive(grant))
                .map((grant) => grant.subjectId))),
            }))
          : workspaces.listAgents(workspace.slug).then((associations) => ({
              grants: [] as WorkspaceGrant[],
              agentIds: Array.from(new Set(associations.map((association) => association.agentId))),
            }));
        const [filesResult, agentAccessResult] = await Promise.allSettled([
          workspaces.listFiles(workspace.slug),
          agentAccess,
        ]);
        const files = filesResult.status === "fulfilled" ? filesResult.value : [];
        const grants = agentAccessResult.status === "fulfilled" ? agentAccessResult.value.grants : [];
        const filesError = filesResult.status === "rejected"
          ? errorStatusCode(filesResult.reason) === 403
            ? "You don't have permission to view files in this collection."
            : "Files couldn't be loaded. Refresh to retry."
          : null;
        const grantsError = agentAccessResult.status === "rejected"
            ? errorStatusCode(agentAccessResult.reason) === 403
              ? "You don't have permission to view or change agent access."
              : errorStatusCode(agentAccessResult.reason) === 404
                ? "Agent assignments require a workspace service update."
                : "Agent access couldn't be loaded. Refresh to retry."
            : null;
        const agentIds = agentAccessResult.status === "fulfilled" ? agentAccessResult.value.agentIds : [];
        return { workspace, files, grants, agentIds, filesError, grantsError };
      }));

      if (requestId !== loadRequestRef.current) return;
      React.startTransition(() => {
        setKnowledgeBases(hydrated);
        setExpandedBaseId((current) => {
          const activeWorkspaceId = selectedWorkspaceIdRef.current;
          if (activeWorkspaceId && hydrated.some((base) => base.workspace.id === activeWorkspaceId)) {
            return activeWorkspaceId;
          }
          return current && hydrated.some((base) => base.workspace.id === current) ? current : null;
        });
        setAssignmentBaseId((current) => current && hydrated.some((base) => base.workspace.id === current) ? current : null);
      });
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      setLoadError(describeError(err, "Unable to load shared knowledge."));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [availableWorkspaces, ready, workspaces]);

  const loadWorkspacesRef = React.useRef(loadWorkspaces);
  React.useLayoutEffect(() => {
    loadWorkspacesRef.current = loadWorkspaces;
  }, [loadWorkspaces]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => void loadWorkspaces(debouncedQuery), 0);
    return () => window.clearTimeout(timeout);
  }, [debouncedQuery, loadWorkspaces]);

  React.useEffect(() => {
    if (!selectedWorkspaceId) return;
    const timeout = window.setTimeout(() => setExpandedBaseId(selectedWorkspaceId), 0);
    return () => window.clearTimeout(timeout);
  }, [selectedWorkspaceId]);

  const createBase = async (name: string, description: string, agentIds: string[]) => {
    if (!workspaces) throw new Error("Shared knowledge is not connected.");
    setError(null);
    try {
      const workspace = await workspaces.create({ name, description: description || undefined });
      const grantResults = await Promise.allSettled(agentIds.map((agentId) => (
        workspaces.grant(workspace.slug, { subjectType: "agent", subjectId: agentId, role: "viewer" })
      )));
      const grants = grantResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failedGrants = grantResults.filter((result) => result.status === "rejected").length;
      setKnowledgeBases((current) => [
        ...current.filter((base) => base.workspace.id !== workspace.id),
        {
          workspace,
          files: [],
          grants,
          agentIds: Array.from(new Set(grants.map((grant) => grant.subjectId))),
          filesError: null,
          grantsError: null,
        },
      ]);
      setQuery("");
      setDebouncedQuery("");
      if (onWorkspacesChanged) await onWorkspacesChanged(workspace.id);
      else await loadWorkspacesRef.current("");
      onSelectWorkspace?.(workspace.id, workspace);
      setExpandedBaseId(workspace.id);
      setAssignmentBaseId(null);
      if (failedGrants > 0) {
        setError(`Shared knowledge was created, but ${failedGrants} agent assignment${failedGrants === 1 ? "" : "s"} failed.`);
      }
    } catch (err) {
      setError(describeError(err, "Unable to create shared knowledge."));
      throw err;
    }
  };

  const updateBase = async (base: KnowledgeBase, name: string, description: string) => {
    if (!workspaces) throw new Error("Shared knowledge is not connected.");
    if (!workspaceCanAdminister(base.workspace)) throw new Error("Admin access is required to update this Workspace.");
    setBaseBusy(base.workspace.id, true);
    setError(null);
    try {
      const updated = await workspaces.update(base.workspace.slug, { name, description });
      setKnowledgeBases((current) => current.map((item) => (
        item.workspace.id === base.workspace.id ? { ...item, workspace: updated } : item
      )));
      if (onWorkspacesChanged) await onWorkspacesChanged();
      else await loadWorkspacesRef.current(debouncedQueryRef.current);
      if (selectedWorkspaceIdRef.current === updated.id) setExpandedBaseId(updated.id);
    } catch (err) {
      setError(describeError(err, "Unable to update shared knowledge."));
      throw err;
    } finally {
      setBaseBusy(base.workspace.id, false);
    }
  };

  const deleteBase = async (base: KnowledgeBase) => {
    if (!workspaces) throw new Error("Shared knowledge is not connected.");
    if (!workspaceCanAdminister(base.workspace)) throw new Error("Admin access is required to delete this Workspace.");
    setBaseBusy(base.workspace.id, true);
    setError(null);
    try {
      await workspaces.delete(base.workspace.slug);
      setKnowledgeBases((current) => current.filter((item) => item.workspace.id !== base.workspace.id));
      setAssignmentBaseId((current) => current === base.workspace.id ? null : current);
      setExpandedBaseId((current) => current === base.workspace.id ? null : current);
      if (onWorkspacesChanged) await onWorkspacesChanged();
      else await loadWorkspacesRef.current(debouncedQueryRef.current);
    } catch (err) {
      setError(describeError(err, "Unable to delete shared knowledge."));
      throw err;
    } finally {
      setBaseBusy(base.workspace.id, false);
    }
  };

  const toggleAssignedAgent = async (base: KnowledgeBase, agentId: string) => {
    if (!workspaces) return;
    if (!workspaceCanAdminister(base.workspace)) return;
    setBaseBusy(base.workspace.id, true);
    setError(null);
    try {
      const grants = activeAgentGrants(base.grants, agentId);
      if (grants.length > 0) {
        const results = await Promise.allSettled(
          grants.map((grant) => workspaces.revokeGrant(base.workspace.slug, grant.id)),
        );
        const revokedGrantIds = new Set(results.flatMap((result, index) => (
          result.status === "fulfilled" ? [grants[index]!.id] : []
        )));
        setKnowledgeBases((current) => current.map((item) => (
          item.workspace.id === base.workspace.id
            ? withWorkspaceGrants(item, item.grants.filter((grant) => !revokedGrantIds.has(grant.id)))
            : item
        )));
        if (revokedGrantIds.size > 0 && globallySelectedWorkspaceIdRef.current === base.workspace.id) {
          await refreshSelectedWorkspaceAgents();
        }
        await loadWorkspacesRef.current(debouncedQueryRef.current);
        if (selectedWorkspaceIdRef.current === base.workspace.id) setExpandedBaseId(base.workspace.id);
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failures.length > 0) {
          const permissionFailure = failures.find((result) => errorStatusCode(result.reason) === 403);
          if (permissionFailure) throw permissionFailure.reason;
          throw new Error(`${failures.length} agent access grant${failures.length === 1 ? "" : "s"} could not be removed.`);
        }
      } else {
        const grant = await workspaces.grant(base.workspace.slug, { subjectType: "agent", subjectId: agentId, role: "viewer" });
        setKnowledgeBases((current) => current.map((item) => (
          item.workspace.id === base.workspace.id
            ? withWorkspaceGrants(item, [...item.grants.filter((existing) => existing.id !== grant.id), grant])
            : item
        )));
        if (globallySelectedWorkspaceIdRef.current === base.workspace.id) {
          await refreshSelectedWorkspaceAgents();
        }
        await loadWorkspacesRef.current(debouncedQueryRef.current);
        if (selectedWorkspaceIdRef.current === base.workspace.id) setExpandedBaseId(base.workspace.id);
      }
    } catch (err) {
      setError(describeError(err, "Unable to update agent assignment."));
    } finally {
      setBaseBusy(base.workspace.id, false);
    }
  };

  const uploadFiles = async (base: KnowledgeBase, uploads: Array<{ path: string; file: File }>) => {
    if (!workspaces) throw new Error("Shared knowledge is not connected.");
    if (!workspaceCanWrite(base.workspace)) throw new Error("Contributor access is required to upload files.");
    setBaseBusy(base.workspace.id, true);
    setError(null);
    try {
      const results: PromiseSettledResult<WorkspaceFile>[] = [];
      for (const upload of uploads) {
        const normalizedPath = normalizeWorkspacePath(upload.path);
        results.push(await Promise.resolve(workspaces.uploadFile(base.workspace.slug, upload.file, {
          path: normalizedPath,
          filename: baseName(normalizedPath),
        })).then(
          (value) => ({ status: "fulfilled", value }) as PromiseFulfilledResult<WorkspaceFile>,
          (reason) => ({ status: "rejected", reason }) as PromiseRejectedResult,
        ));
      }
      const uploadedFiles = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      setKnowledgeBases((current) => current.map((item) => {
        if (item.workspace.id !== base.workspace.id) return item;
        const files = [...item.files];
        for (const uploaded of uploadedFiles) {
          const index = files.findIndex((file) => file.id === uploaded.id || file.path === uploaded.path);
          if (index >= 0) files[index] = uploaded;
          else files.push(uploaded);
        }
        return { ...item, files };
      }));
      await loadWorkspacesRef.current(debouncedQueryRef.current);
      if (selectedWorkspaceIdRef.current === base.workspace.id) setExpandedBaseId(base.workspace.id);
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) throw new Error(`${failed} file${failed === 1 ? "" : "s"} could not be uploaded.`);
    } catch (err) {
      setError(describeError(err, "Unable to upload files."));
      throw err;
    } finally {
      setBaseBusy(base.workspace.id, false);
    }
  };

  const deleteFilePath = async (base: KnowledgeBase, path: string, options?: { recursive?: boolean }) => {
    if (!workspaces) throw new Error("Shared knowledge is not connected.");
    if (!workspaceCanWrite(base.workspace)) throw new Error("Contributor access is required to delete files.");
    setBaseBusy(base.workspace.id, true);
    setError(null);
    try {
      const normalizedPath = normalizeWorkspacePath(path);
      const targets = options?.recursive
        ? base.files.filter((file) => normalizeWorkspacePath(file.path).startsWith(`${normalizedPath}/`))
        : [workspaceFileByPath(base, normalizedPath)].filter((file): file is WorkspaceFile => Boolean(file));
      if (targets.length === 0) throw new Error("No files were found at this path.");
      const results = await Promise.allSettled(targets.map((file) => workspaces.deleteFile(base.workspace.slug, file.path)));
      const deletedPaths = new Set(results.flatMap((result, index) => (
        result.status === "fulfilled" ? [targets[index]!.path] : []
      )));
      setKnowledgeBases((current) => current.map((item) => (
        item.workspace.id === base.workspace.id
          ? { ...item, files: item.files.filter((file) => !deletedPaths.has(file.path)) }
          : item
      )));
      await loadWorkspacesRef.current(debouncedQueryRef.current);
      if (selectedWorkspaceIdRef.current === base.workspace.id) setExpandedBaseId(base.workspace.id);
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) throw new Error(`${failed} file${failed === 1 ? "" : "s"} could not be deleted.`);
    } catch (err) {
      setError(describeError(err, "Unable to delete file."));
      throw err;
    } finally {
      setBaseBusy(base.workspace.id, false);
    }
  };

  const requestPathDelete = (base: KnowledgeBase, path: string, options?: { recursive?: boolean }) => {
    const normalizedPath = normalizeWorkspacePath(path);
    const recursive = Boolean(options?.recursive);
    const count = recursive
      ? base.files.filter((file) => normalizeWorkspacePath(file.path).startsWith(`${normalizedPath}/`)).length
      : workspaceFileByPath(base, normalizedPath) ? 1 : 0;
    setPendingPathDelete({ base, path: normalizedPath, recursive, count });
  };

  const updateFileFields = async (base: KnowledgeBase, path: string, patch: WorkspaceFilePatch) => {
    if (!workspaces) throw new Error("Shared knowledge is not connected.");
    if (!workspaceCanWrite(base.workspace)) throw new Error("Contributor access is required to update file metadata.");
    setBaseBusy(base.workspace.id, true);
    setError(null);
    try {
      const updated = await workspaces.updateFile(base.workspace.slug, normalizeWorkspacePath(path), patch);
      setKnowledgeBases((current) => current.map((item) => (
        item.workspace.id === base.workspace.id
          ? { ...item, files: item.files.map((file) => file.id === updated.id || file.path === updated.path ? updated : file) }
          : item
      )));
      await loadWorkspacesRef.current(debouncedQueryRef.current);
      if (selectedWorkspaceIdRef.current === base.workspace.id) setExpandedBaseId(base.workspace.id);
    } catch (err) {
      setError(describeError(err, "Unable to update file metadata."));
      throw err;
    } finally {
      setBaseBusy(base.workspace.id, false);
    }
  };

  const regenerateFile = async (base: KnowledgeBase, path: string) => {
    if (!workspaces) throw new Error("Shared knowledge is not connected.");
    if (!workspaceCanWrite(base.workspace)) throw new Error("Contributor access is required to regenerate files.");
    setBaseBusy(base.workspace.id, true);
    setError(null);
    try {
      const updated = await workspaces.regenerateFile(base.workspace.slug, normalizeWorkspacePath(path));
      setKnowledgeBases((current) => current.map((item) => (
        item.workspace.id === base.workspace.id
          ? { ...item, files: item.files.map((file) => file.id === updated.id || file.path === updated.path ? updated : file) }
          : item
      )));
      await loadWorkspacesRef.current(debouncedQueryRef.current);
      if (selectedWorkspaceIdRef.current === base.workspace.id) setExpandedBaseId(base.workspace.id);
    } catch (err) {
      setError(describeError(err, "Unable to queue file regeneration."));
      throw err;
    } finally {
      setBaseBusy(base.workspace.id, false);
    }
  };

  const editingBase = editingBaseId ? knowledgeBases.find((base) => base.workspace.id === editingBaseId) ?? null : null;
  const pendingBaseDeleteBusy = Boolean(
    pendingDeleteBase && busyBaseCounts.has(pendingDeleteBase.workspace.id),
  );
  const pendingPathDeleteBusy = Boolean(
    pendingPathDelete && busyBaseCounts.has(pendingPathDelete.base.workspace.id),
  );

  return (
    <div className="min-h-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1200px]">
        <div className="mb-7 space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold leading-tight text-foreground">Shared knowledge</h1>
              <p className="mt-1 text-[13px] leading-snug text-text-muted">Durable files and generated Markdown that agents can reference across conversations.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => {
                if (onWorkspacesChanged) void onWorkspacesChanged();
                else void loadWorkspacesRef.current(debouncedQueryRef.current);
                void refreshSelectedWorkspaceAgents();
              }} disabled={!workspaces || !ready || loading} aria-label="Refresh shared knowledge" className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
              <button type="button" onClick={() => setCreateOpen(true)} disabled={!workspaces || !ready || agentsLoading} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-45">
                <Plus className="h-4 w-4" /> New shared knowledge
              </button>
            </div>
          </div>
          <label className="relative block">
            <span className="sr-only">Search shared knowledge</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, files, and metadata..." className="h-10 w-full rounded-xl border border-border bg-surface-low/35 pl-10 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
          </label>
          {(error || loadError || (workspaces ? connectionError : null)) && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error || loadError || connectionError}</span>
            </div>
          )}
          {agentsError && (
            <div role="status" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Collections are available, but agent assignments can&apos;t be changed right now. {agentsError}</span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {!workspaces && (
            <div className="rounded-2xl border border-dashed border-border bg-surface-low/25 px-5 py-10 text-center">
              <HardDrive className="mx-auto mb-2 h-5 w-5 text-text-muted" />
              <p className="text-[13px] font-semibold text-foreground">Shared knowledge is not connected.</p>
              <p className="mt-1 text-[11px] text-text-muted">{connectionError || "Sign in again if shared knowledge is unavailable."}</p>
            </div>
          )}
          {workspaces && (!ready || loading) && knowledgeBases.length === 0 && (
            <div className="rounded-2xl border border-border bg-surface-low/25 px-5 py-10 text-center" role="status">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-text-muted" />
              <p className="text-[13px] font-semibold text-foreground">Loading shared knowledge</p>
            </div>
          )}
          {workspaces && ready && knowledgeBases.map((base) => (
            <KnowledgeBaseCard
              key={base.workspace.id}
              base={base}
              agents={agents}
              agentById={agentById}
              workspaces={workspaces}
              expanded={expandedBaseId === base.workspace.id}
              assignmentOpen={assignmentBaseId === base.workspace.id}
              busy={busyBaseCounts.has(base.workspace.id)}
              onToggle={() => {
                const expanding = expandedBaseId !== base.workspace.id;
                setExpandedBaseId(expanding ? base.workspace.id : null);
                if (expanding) onSelectWorkspace?.(base.workspace.id, base.workspace);
              }}
              onToggleAssignment={() => setAssignmentBaseId((current) => current === base.workspace.id ? null : base.workspace.id)}
              onToggleAgent={(agentId) => void toggleAssignedAgent(base, agentId)}
              onEdit={() => setEditingBaseId(base.workspace.id)}
              onDeleteWorkspace={() => setPendingDeleteBase(base)}
              onUploadFiles={(uploads) => uploadFiles(base, uploads)}
              onRequestDeletePath={(path, options) => requestPathDelete(base, path, options)}
              onUpdateFile={(path, patch) => updateFileFields(base, path, patch)}
              onRegenerateFile={(path) => regenerateFile(base, path)}
            />
          ))}
          {workspaces && ready && !loading && !connectionError && knowledgeBases.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-surface-low/25 px-5 py-10 text-center">
              <HardDrive className="mx-auto mb-2 h-5 w-5 text-text-muted" />
              <p className="text-[13px] font-semibold text-foreground">No shared knowledge found.</p>
              <p className="mt-1 text-[11px] text-text-muted">{debouncedQuery ? "Try a different search." : "Create shared knowledge to start sharing files with agents."}</p>
            </div>
          )}
        </div>
      </div>

      {createOpen && (
        <NewKnowledgeBaseModal
          agents={agents}
          agentsLoading={agentsLoading}
          defaultAgentId={preferredAgentId}
          onClose={() => setCreateOpen(false)}
          onCreate={createBase}
        />
      )}
      {editingBase && (
        <EditKnowledgeBaseModal
          base={editingBase}
          onClose={() => setEditingBaseId(null)}
          onSave={(name, description) => updateBase(editingBase, name, description)}
        />
      )}
      <ConfirmDialog
        open={Boolean(pendingDeleteBase)}
        title="Delete shared knowledge?"
        message={pendingDeleteBase ? `Delete ${pendingDeleteBase.workspace.name} and all of its files? Agents will lose access immediately.` : ""}
        confirmLabel="Delete"
        danger
        loading={pendingBaseDeleteBusy}
        onCancel={() => {
          if (!pendingBaseDeleteBusy) setPendingDeleteBase(null);
        }}
        onConfirm={() => {
          if (!pendingDeleteBase) return;
          void deleteBase(pendingDeleteBase).then(() => setPendingDeleteBase(null)).catch(() => undefined);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingPathDelete)}
        title={pendingPathDelete?.recursive ? "Delete folder contents?" : "Delete file?"}
        message={pendingPathDelete
          ? pendingPathDelete.recursive
            ? `Delete ${pendingPathDelete.count} file${pendingPathDelete.count === 1 ? "" : "s"} inside ${pendingPathDelete.path}? This can't be undone.`
            : `Delete ${pendingPathDelete.path}? Agents will lose access immediately.`
          : ""}
        confirmLabel="Delete"
        danger
        loading={pendingPathDeleteBusy}
        onCancel={() => {
          if (!pendingPathDeleteBusy) setPendingPathDelete(null);
        }}
        onConfirm={() => {
          if (!pendingPathDelete) return;
          void deleteFilePath(pendingPathDelete.base, pendingPathDelete.path, { recursive: pendingPathDelete.recursive })
            .then(() => setPendingPathDelete(null))
            .catch(() => undefined);
        }}
      />
    </div>
  );
}
