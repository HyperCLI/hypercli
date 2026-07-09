"use client";

import React from "react";
import type { Workspace, WorkspaceFile, WorkspaceGrant, WorkspaceManifest, WorkspacesAPI } from "@hypercli.com/sdk/workspaces";
import { FileRow } from "@hypercli/shared-ui/files";
import type { FileEntry } from "@hypercli/shared-ui/files";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
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

export type SharedKnowledgeAgent = {
  id: string;
  name?: string | null;
  pod_name?: string | null;
  state?: string | null;
  meta?: AgentMeta | null;
};

type KnowledgeBase = {
  workspace: Workspace;
  agentIds: string[];
  files: WorkspaceFile[];
  grants: WorkspaceGrant[];
  manifest: WorkspaceManifest | null;
};

type WorkspaceFilePatch = Parameters<WorkspacesAPI["updateFile"]>[2];

type SharedKnowledgePanelProps = {
  agents?: SharedKnowledgeAgent[];
  workspaces?: WorkspacesAPI | null;
  ready?: boolean;
};

function agentDisplayName(agent: SharedKnowledgeAgent): string {
  return agent.name || agent.pod_name || agent.id;
}

function normalizeAgentState(state?: string | null): string {
  return state ? state.toLowerCase() : "unknown";
}

function agentStateDotClass(state?: string | null): string {
  if (state === "RUNNING") return "bg-success";
  if (state === "FAILED") return "bg-destructive";
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
  const files = base.files.length;
  const folders = new Set(base.files.flatMap((file) => {
    const parts = normalizeWorkspacePath(file.path).split("/").filter(Boolean);
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
  })).size;
  return `${files} file${files === 1 ? "" : "s"}${folders > 0 ? `, ${folders} folder${folders === 1 ? "" : "s"}` : ""}`;
}

function agentCountLabel(count: number): string {
  return `${count} agent${count === 1 ? "" : "s"}`;
}

function activeAgentGrant(grants: WorkspaceGrant[], agentId: string): WorkspaceGrant | null {
  return grants.find((grant) => grant.subjectType === "agent" && grant.subjectId === agentId && !grant.revokedAt) ?? null;
}

function normalizeWorkspacePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "").replace(/^\.\//, "");
}

function baseName(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  return normalized.split("/").filter(Boolean).at(-1) || normalized || "file";
}

function bytesToArrayBuffer(content: Uint8Array): ArrayBuffer {
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
}

async function fileToBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(new Uint8Array(result));
      else if (typeof result === "string") resolve(new TextEncoder().encode(result));
      else reject(new Error("Unable to read file."));
    };
    reader.readAsArrayBuffer(file);
  });
}

function markdownFileForPath(base: KnowledgeBase, path: string): Record<string, any> | null {
  const normalized = normalizeWorkspacePath(path);
  return base.manifest?.markdownFiles.find((markdownFile) => {
    if (!markdownFile || typeof markdownFile !== "object") return false;
    return normalizeWorkspacePath(String(markdownFile.path || "")) === normalized
      || String(markdownFile.file_id || "") === path
  }) ?? null;
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

function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function NewKnowledgeBaseModal({ agents, onClose, onCreate }: { agents: SharedKnowledgeAgent[]; onClose: () => void; onCreate: (name: string, description: string, agentIds: string[]) => void }) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [selectedAgentIds, setSelectedAgentIds] = React.useState<Set<string>>(() => new Set(agents.slice(0, 2).map((agent) => agent.id)));

  const canCreate = Boolean(name.trim());
  const handleCreate = () => {
    if (!canCreate) return;
    onCreate(name.trim(), description.trim(), Array.from(selectedAgentIds));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button type="button" aria-label="Close new workspace" onClick={onClose} className="absolute inset-0 cursor-default bg-background/75 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-labelledby="new-workspace-title" className="relative flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-low text-text-secondary">
              <HardDrive className="h-4 w-4" />
            </div>
            <div>
              <h2 id="new-workspace-title" className="text-[16px] font-semibold leading-tight text-foreground">New Workspace</h2>
              <p className="mt-1 text-[12px] leading-snug text-text-muted">Create a shared workspace for agent-accessible files.</p>
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground">
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
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g., Team Workspace" className="h-10 w-full rounded-xl border border-border bg-surface-low/40 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
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
                    onClick={() => setSelectedAgentIds((current) => {
                      const next = new Set(current);
                      if (next.has(agent.id)) next.delete(agent.id);
                      else next.add(agent.id);
                      return next;
                    })}
                  />
                );
              })}
              {agents.length === 0 && <p className="text-[12px] text-text-muted">No agents are available yet.</p>}
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-xl border border-border px-4 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground">
            Cancel
          </button>
          <button type="button" onClick={handleCreate} disabled={!canCreate} className="inline-flex h-9 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-45">
            <Plus className="h-4 w-4" />
            Create Workspace
          </button>
        </footer>
      </section>
    </div>
  );
}

function EditKnowledgeBaseModal({ base, onClose, onSave }: { base: KnowledgeBase; onClose: () => void; onSave: (name: string, description: string) => void }) {
  const [name, setName] = React.useState(base.workspace.name);
  const [description, setDescription] = React.useState(base.workspace.description || "");
  const canSave = Boolean(name.trim());

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button type="button" aria-label="Close edit workspace" onClick={onClose} className="absolute inset-0 cursor-default bg-background/75 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-labelledby="edit-workspace-title" className="relative flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-low text-text-secondary">
              <Pencil className="h-4 w-4" />
            </div>
            <div>
              <h2 id="edit-workspace-title" className="text-[16px] font-semibold leading-tight text-foreground">Edit Workspace</h2>
              <p className="mt-1 text-[12px] leading-snug text-text-muted">Update workspace name and description.</p>
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
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-xl border border-border px-4 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground">
            Cancel
          </button>
          <button type="button" onClick={() => { if (canSave) onSave(name.trim(), description.trim()); }} disabled={!canSave} className="inline-flex h-9 items-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-45">
            Save
          </button>
        </footer>
      </section>
    </div>
  );
}

function FileMetadataForm({
  file,
  busy,
  onSave,
}: {
  file: WorkspaceFile;
  busy?: boolean;
  onSave: (path: string, patch: WorkspaceFilePatch) => Promise<void>;
}) {
  const [displayName, setDisplayName] = React.useState(file.displayName || "");
  const [keywords, setKeywords] = React.useState(keywordsInput(file.keywords));
  const [summary, setSummary] = React.useState(file.summary || "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canSave = Boolean(displayName.trim()) && !busy && !saving;
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
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none transition-colors focus:border-primary/50" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">Keywords</span>
            <input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="pricing, retention, onboarding" className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">Summary</span>
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} className="min-h-[76px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-primary/50" />
          </label>
          {error && <p className="text-[12px] text-destructive">{error}</p>}
        </div>
        <div className="min-w-0 rounded-lg border border-border bg-background/60 p-3">
          <p className="truncate text-[12px] font-medium text-foreground">{file.path}</p>
          <dl className="mt-3 space-y-2 text-[11px] text-text-muted">
            <div className="flex justify-between gap-3"><dt>Status</dt><dd className="text-text-secondary">{file.processingState || file.fileState}</dd></div>
            <div className="flex justify-between gap-3"><dt>Size</dt><dd className="text-text-secondary">{formatBytes(undefined)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Version</dt><dd className="max-w-[120px] truncate text-text-secondary">{file.currentVersionId || "None"}</dd></div>
          </dl>
          <button type="button" onClick={() => void handleSave()} disabled={!canSave} className="mt-4 inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-3 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-45">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save Metadata
          </button>
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
  onUploadFile,
  onDeletePath,
  onUpdateFile,
  onRegenerateFile,
}: {
  base: KnowledgeBase;
  workspaces: WorkspacesAPI | null;
  busy?: boolean;
  onUploadFile: (path: string, content: Uint8Array) => Promise<void>;
  onDeletePath: (path: string, options?: { recursive?: boolean }) => Promise<void>;
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
  const selectedMarkdownFile = selectedPath ? markdownFileForPath(base, selectedPath) : null;

  React.useEffect(() => {
    if (!selectedFile || !workspaces || tab === "metadata") return;
    let cancelled = false;
    setLoadingView(true);
    setViewError(null);
    setRawPreview(null);
    setMarkdown(null);
    void (async () => {
      try {
        if (tab === "raw") {
          const result = await workspaces.downloadFileBytes(base.workspace.slug, selectedFile.path);
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
    for (const file of files) {
      const path = currentPath ? `${currentPath}/${file.name}` : file.name;
      await onUploadFile(path, await fileToBytes(file));
    }
  }, [currentPath, onUploadFile]);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    if (!event.dataTransfer.files.length || busy) return;
    void uploadFiles(event.dataTransfer.files);
  };

  const goUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split("/").filter(Boolean);
    setCurrentPath(parts.slice(0, -1).join("/"));
    setSelectedPath(null);
  };

  return (
    <div
      className={`relative grid h-[520px] overflow-hidden rounded-xl border bg-background lg:grid-cols-[minmax(240px,34%)_minmax(0,1fr)] ${dragOver ? "border-primary/60 bg-primary/5" : "border-border"}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) setDragOver(true);
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
            Drop files to upload to {currentPath || "this workspace"}
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <button type="button" onClick={goUp} disabled={!currentPath} className="h-7 rounded-lg border border-border px-2 text-[11px] text-text-secondary transition-colors hover:bg-surface-low disabled:opacity-40">
            Up
          </button>
          <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">{currentPath || base.workspace.slug}</p>
          <button type="button" title="Upload files" onClick={() => inputRef.current?.click()} disabled={busy} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-[11px] text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-45">
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
                  }
                }}
                onToggle={(item) => {
                  setCurrentPath(normalizeWorkspacePath(item.path));
                  setSelectedPath(null);
                }}
                onDelete={(item) => void onDeletePath(item.path, item.type === "directory" ? { recursive: true } : undefined)}
                onCopyPath={(item) => void navigator.clipboard?.writeText(item.path)}
              />
            ))
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-col">
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
              <button type="button" onClick={() => void onRegenerateFile(selectedFile.path)} disabled={busy} className="inline-flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-[12px] font-semibold text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-45">
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {tab === "metadata" ? (
                <FileMetadataForm key={`${selectedFile.id}:${selectedFile.displayName}:${selectedFile.summary || ""}:${selectedFile.keywords.join("|")}`} file={selectedFile} busy={busy} onSave={onUpdateFile} />
              ) : loadingView ? (
                <div className="flex h-full items-center justify-center text-text-muted">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : viewError ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{viewError}</div>
              ) : tab === "raw" ? (
                rawPreview?.binary ? (
                  <div className="rounded-xl border border-border bg-surface-low/20 p-4 text-[12px] text-text-muted">
                    Binary source file. Use download from the file actions menu to inspect it locally.
                  </div>
                ) : (
                  <pre className="min-h-full whitespace-pre-wrap rounded-xl border border-border bg-surface-low/20 p-4 text-[12px] leading-relaxed text-foreground">{rawPreview?.text || ""}</pre>
                )
              ) : selectedMarkdownFile ? (
                <pre className="min-h-full whitespace-pre-wrap rounded-xl border border-border bg-surface-low/20 p-4 text-[12px] leading-relaxed text-foreground">{markdown || ""}</pre>
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
  onUploadFile,
  onDeletePath,
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
  onUploadFile: (path: string, content: Uint8Array) => Promise<void>;
  onDeletePath: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  onUpdateFile: (path: string, patch: WorkspaceFilePatch) => Promise<void>;
  onRegenerateFile: (path: string) => Promise<void>;
}) {
  const assignedAgents = assignedAgentsForBase(base, agentById);

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
          <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted"><Bot className="h-3 w-3" />{agentCountLabel(assignedAgents.length)}</span>
          <button type="button" aria-label={`Edit ${base.workspace.name}`} onClick={onEdit} disabled={busy} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-50">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label={`Delete ${base.workspace.name}`} onClick={onDeleteWorkspace} disabled={busy} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-destructive disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
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

          <WorkspaceFilesView
            base={base}
            workspaces={workspaces}
            busy={busy}
            onUploadFile={onUploadFile}
            onDeletePath={onDeletePath}
            onUpdateFile={onUpdateFile}
            onRegenerateFile={onRegenerateFile}
          />

          <div className="mt-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-muted">Assigned Agents</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {assignedAgents.map((agent) => <AgentChip key={agent.id} agent={agent} />)}
              {assignedAgents.length === 0 && <span className="text-[12px] text-text-muted">No agents assigned.</span>}
              <button type="button" onClick={onToggleAssignment} disabled={agents.length === 0 || busy} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45">
                <Plus className="h-3 w-3" /> Assign Agent
              </button>
            </div>
            {assignmentOpen && (
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

export function SharedKnowledgePanel({ agents = [], workspaces = null, ready = Boolean(workspaces) }: SharedKnowledgePanelProps) {
  const [knowledgeBases, setKnowledgeBases] = React.useState<KnowledgeBase[]>([]);
  const [query, setQuery] = React.useState("");
  const [expandedBaseId, setExpandedBaseId] = React.useState<string | null>(null);
  const [assignmentBaseId, setAssignmentBaseId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingBaseId, setEditingBaseId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busyBaseId, setBusyBaseId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const agentById = React.useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  const loadWorkspaces = React.useCallback(async () => {
    if (!workspaces || !ready) {
      setKnowledgeBases([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const searchTerm = query.trim();
      const listed = searchTerm ? await workspaces.search(searchTerm) : await workspaces.list();
      const hydrated = await Promise.all(listed.map(async (workspace) => {
        const [files, grants, manifest] = await Promise.all([
          workspaces.listFiles(workspace.slug).catch(() => [] as WorkspaceFile[]),
          workspaces.listGrants(workspace.slug).catch(() => [] as WorkspaceGrant[]),
          workspaces.manifest(workspace.slug).catch(() => null as WorkspaceManifest | null),
        ]);
        const agentIds = Array.from(new Set(grants
          .filter((grant) => grant.subjectType === "agent" && !grant.revokedAt)
          .map((grant) => grant.subjectId)));
        return {
          workspace,
          files,
          grants,
          agentIds,
          manifest,
        };
      }));
      setKnowledgeBases(hydrated);
      setExpandedBaseId((current) => current && hydrated.some((base) => base.workspace.id === current) ? current : hydrated[0]?.workspace.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load workspaces.");
      setKnowledgeBases([]);
    } finally {
      setLoading(false);
    }
  }, [query, ready, workspaces]);

  React.useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  const createBase = async (name: string, description: string, agentIds: string[]) => {
    if (!workspaces) return;
    setLoading(true);
    setError(null);
    try {
      const workspace = await workspaces.create({ name, description: description || undefined });
      for (const agentId of agentIds) {
        await workspaces.grant(workspace.slug, { subjectType: "agent", subjectId: agentId, role: "viewer" });
      }
      await loadWorkspaces();
      setExpandedBaseId(workspace.id);
      setAssignmentBaseId(null);
      setQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create workspace.");
    } finally {
      setLoading(false);
    }
  };

  const updateBase = async (base: KnowledgeBase, name: string, description: string) => {
    if (!workspaces) return;
    setBusyBaseId(base.workspace.id);
    setError(null);
    try {
      const updated = await workspaces.update(base.workspace.slug, { name, description });
      setEditingBaseId(null);
      await loadWorkspaces();
      setExpandedBaseId(updated.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update workspace.");
    } finally {
      setBusyBaseId(null);
    }
  };

  const deleteBase = async (base: KnowledgeBase) => {
    if (!workspaces) return;
    setBusyBaseId(base.workspace.id);
    setError(null);
    try {
      await workspaces.delete(base.workspace.slug);
      await loadWorkspaces();
      setAssignmentBaseId((current) => current === base.workspace.id ? null : current);
      setExpandedBaseId((current) => current === base.workspace.id ? null : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete workspace.");
    } finally {
      setBusyBaseId(null);
    }
  };

  const toggleAssignedAgent = async (base: KnowledgeBase, agentId: string) => {
    if (!workspaces) return;
    setBusyBaseId(base.workspace.id);
    setError(null);
    try {
      const grant = activeAgentGrant(base.grants, agentId);
      if (grant) {
        await workspaces.revokeGrant(base.workspace.slug, grant.id);
      } else {
        await workspaces.grant(base.workspace.slug, { subjectType: "agent", subjectId: agentId, role: "viewer" });
      }
      await loadWorkspaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update agent assignment.");
    } finally {
      setBusyBaseId(null);
    }
  };

  const uploadFileContent = async (base: KnowledgeBase, path: string, content: Uint8Array) => {
    if (!workspaces) return;
    setBusyBaseId(base.workspace.id);
    setError(null);
    try {
      const normalizedPath = normalizeWorkspacePath(path);
      const filename = baseName(normalizedPath);
      const body = bytesToArrayBuffer(content);
      const blob = typeof File !== "undefined"
        ? new File([body], filename, { type: "application/octet-stream" })
        : new Blob([body], { type: "application/octet-stream" });
      await workspaces.uploadFile(base.workspace.slug, blob, { path: normalizedPath, filename });
      await loadWorkspaces();
      setExpandedBaseId(base.workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload file.");
    } finally {
      setBusyBaseId(null);
    }
  };

  const deleteFilePath = async (base: KnowledgeBase, path: string, options?: { recursive?: boolean }) => {
    if (!workspaces) return;
    setBusyBaseId(base.workspace.id);
    setError(null);
    try {
      const normalizedPath = normalizeWorkspacePath(path);
      const targets = options?.recursive
        ? base.files.filter((file) => normalizeWorkspacePath(file.path).startsWith(`${normalizedPath}/`))
        : [workspaceFileByPath(base, normalizedPath)].filter((file): file is WorkspaceFile => Boolean(file));
      for (const file of targets) {
        await workspaces.deleteFile(base.workspace.slug, file.path);
      }
      await loadWorkspaces();
      setExpandedBaseId(base.workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete file.");
    } finally {
      setBusyBaseId(null);
    }
  };

  const updateFileFields = async (base: KnowledgeBase, path: string, patch: WorkspaceFilePatch) => {
    if (!workspaces) return;
    setBusyBaseId(base.workspace.id);
    setError(null);
    try {
      await workspaces.updateFile(base.workspace.slug, normalizeWorkspacePath(path), patch);
      await loadWorkspaces();
      setExpandedBaseId(base.workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update file metadata.");
      throw err;
    } finally {
      setBusyBaseId(null);
    }
  };

  const regenerateFile = async (base: KnowledgeBase, path: string) => {
    if (!workspaces) return;
    setBusyBaseId(base.workspace.id);
    setError(null);
    try {
      await workspaces.regenerateFile(base.workspace.slug, normalizeWorkspacePath(path));
      await loadWorkspaces();
      setExpandedBaseId(base.workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to queue file regeneration.");
    } finally {
      setBusyBaseId(null);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="w-full px-5 py-5">
        <div className="mb-7 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[20px] font-semibold leading-tight text-foreground">Workspaces</h2>
              <p className="mt-1 text-[13px] leading-snug text-text-muted">Shared workspace files that agents can access during conversations.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => void loadWorkspaces()} disabled={!workspaces || loading} aria-label="Refresh workspaces" className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
              <button type="button" onClick={() => setCreateOpen(true)} disabled={!workspaces || loading} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-45">
                <Plus className="h-4 w-4" /> New Workspace
              </button>
            </div>
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspaces..." className="h-10 w-full rounded-xl border border-border bg-surface-low/35 pl-10 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
          </label>
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {!workspaces && (
            <div className="rounded-2xl border border-dashed border-border bg-surface-low/25 px-5 py-10 text-center">
              <HardDrive className="mx-auto mb-2 h-5 w-5 text-text-muted" />
              <p className="text-[13px] font-semibold text-foreground">Workspaces are not connected.</p>
              <p className="mt-1 text-[11px] text-text-muted">Sign in again if the workspace client is unavailable.</p>
            </div>
          )}
          {workspaces && loading && knowledgeBases.length === 0 && (
            <div className="rounded-2xl border border-border bg-surface-low/25 px-5 py-10 text-center">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-text-muted" />
              <p className="text-[13px] font-semibold text-foreground">Loading workspaces</p>
            </div>
          )}
          {workspaces && !loading && knowledgeBases.map((base) => (
            <KnowledgeBaseCard
              key={base.workspace.id}
              base={base}
              agents={agents}
              agentById={agentById}
              workspaces={workspaces}
              expanded={expandedBaseId === base.workspace.id}
              assignmentOpen={assignmentBaseId === base.workspace.id}
              busy={busyBaseId === base.workspace.id}
              onToggle={() => setExpandedBaseId((current) => current === base.workspace.id ? null : base.workspace.id)}
              onToggleAssignment={() => setAssignmentBaseId((current) => current === base.workspace.id ? null : base.workspace.id)}
              onToggleAgent={(agentId) => void toggleAssignedAgent(base, agentId)}
              onEdit={() => setEditingBaseId(base.workspace.id)}
              onDeleteWorkspace={() => void deleteBase(base)}
              onUploadFile={(path, content) => uploadFileContent(base, path, content)}
              onDeletePath={(path, options) => deleteFilePath(base, path, options)}
              onUpdateFile={(path, patch) => updateFileFields(base, path, patch)}
              onRegenerateFile={(path) => regenerateFile(base, path)}
            />
          ))}
          {workspaces && !loading && knowledgeBases.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-surface-low/25 px-5 py-10 text-center">
              <HardDrive className="mx-auto mb-2 h-5 w-5 text-text-muted" />
              <p className="text-[13px] font-semibold text-foreground">No workspaces found.</p>
              <p className="mt-1 text-[11px] text-text-muted">Create one to start sharing files with agents.</p>
            </div>
          )}
        </div>
      </div>

      {createOpen && <NewKnowledgeBaseModal agents={agents} onClose={() => setCreateOpen(false)} onCreate={(name, description, agentIds) => void createBase(name, description, agentIds)} />}
      {editingBaseId && (() => {
        const base = knowledgeBases.find((item) => item.workspace.id === editingBaseId);
        return base ? (
          <EditKnowledgeBaseModal
            base={base}
            onClose={() => setEditingBaseId(null)}
            onSave={(name, description) => void updateBase(base, name, description)}
          />
        ) : null;
      })()}
    </div>
  );
}
