"use client";

import React from "react";
import type { Workspace, WorkspaceFile, WorkspaceGrant, WorkspacesAPI } from "@hypercli.com/sdk/workspaces";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  HardDrive,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
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

type KnowledgeNode = {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  status?: string | null;
  children?: KnowledgeNode[];
};

type KnowledgeBase = {
  workspace: Workspace;
  agentIds: string[];
  files: WorkspaceFile[];
  grants: WorkspaceGrant[];
  contents: KnowledgeNode[];
};

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

function countFiles(nodes: KnowledgeNode[]): number {
  return nodes.reduce((count, node) => count + (node.type === "file" ? 1 : countFiles(node.children ?? [])), 0);
}

function countFolders(nodes: KnowledgeNode[]): number {
  return nodes.reduce((count, node) => count + (node.type === "folder" ? 1 + countFolders(node.children ?? []) : 0), 0);
}

function contentCountLabel(base: KnowledgeBase): string {
  const files = countFiles(base.contents);
  const folders = countFolders(base.contents);
  return `${files} file${files === 1 ? "" : "s"}${folders > 0 ? `, ${folders} folder${folders === 1 ? "" : "s"}` : ""}`;
}

function agentCountLabel(count: number): string {
  return `${count} agent${count === 1 ? "" : "s"}`;
}

function fileStatusLabel(file: WorkspaceFile): string {
  const status = file.projectionStatus || file.uploadStatus || file.fileState;
  return status ? status.replace(/_/g, " ") : "";
}

function buildKnowledgeTree(files: WorkspaceFile[]): KnowledgeNode[] {
  const roots: KnowledgeNode[] = [];
  const folders = new Map<string, KnowledgeNode>();

  const getFolder = (path: string, name: string): KnowledgeNode => {
    const existing = folders.get(path);
    if (existing) return existing;
    const node: KnowledgeNode = { id: `folder:${path}`, name, path, type: "folder", children: [] };
    folders.set(path, node);
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (parentPath) {
      getFolder(parentPath, parentPath.slice(parentPath.lastIndexOf("/") + 1)).children?.push(node);
    } else {
      roots.push(node);
    }
    return node;
  };

  for (const file of files) {
    const normalized = file.path.replace(/^\/+/, "");
    const parts = normalized.split("/").filter(Boolean);
    const name = file.displayName || parts.at(-1) || normalized;
    const parentParts = parts.slice(0, -1);
    const node: KnowledgeNode = {
      id: `file:${file.id}`,
      name,
      path: file.path,
      type: "file",
      status: fileStatusLabel(file),
    };
    if (parentParts.length === 0) {
      roots.push(node);
      continue;
    }
    const parentPath = parentParts.join("/");
    getFolder(parentPath, parentParts.at(-1) || parentPath).children?.push(node);
  }

  const sortNodes = (nodes: KnowledgeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sortNodes(node.children ?? []));
  };
  sortNodes(roots);
  return roots;
}

function activeAgentGrant(grants: WorkspaceGrant[], agentId: string): WorkspaceGrant | null {
  return grants.find((grant) => grant.subjectType === "agent" && grant.subjectId === agentId && !grant.revokedAt) ?? null;
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

function KnowledgeTreeNode({
  node,
  depth,
  expandedFolders,
  onToggleFolder,
}: {
  node: KnowledgeNode;
  depth: number;
  expandedFolders: Set<string>;
  onToggleFolder: (id: string) => void;
}) {
  const expanded = expandedFolders.has(node.id);
  const isFolder = node.type === "folder";
  const Icon = isFolder ? Folder : FileText;
  return (
    <div>
      <button
        type="button"
        onClick={() => isFolder && onToggleFolder(node.id)}
        className="group flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-foreground transition-colors hover:bg-surface-low/55"
        style={{ paddingLeft: `${8 + depth * 18}px` }}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted">
          {isFolder ? (expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
        </span>
        <Icon className={`h-4 w-4 shrink-0 ${isFolder && expanded ? "text-warning" : "text-text-secondary"}`} />
        <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        {node.status && <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-muted">{node.status}</span>}
      </button>
      {isFolder && expanded && node.children?.map((child) => (
        <KnowledgeTreeNode key={child.id} node={child} depth={depth + 1} expandedFolders={expandedFolders} onToggleFolder={onToggleFolder} />
      ))}
    </div>
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
      <button type="button" aria-label="Close new knowledge base" onClick={onClose} className="absolute inset-0 cursor-default bg-background/75 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-labelledby="new-knowledge-title" className="relative flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-low text-text-secondary">
              <HardDrive className="h-4 w-4" />
            </div>
            <div>
              <h2 id="new-knowledge-title" className="text-[16px] font-semibold leading-tight text-foreground">New Knowledge Base</h2>
              <p className="mt-1 text-[12px] leading-snug text-text-muted">Create a workspace-backed knowledge base.</p>
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
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g., Team Knowledge" className="h-10 w-full rounded-xl border border-border bg-surface-low/40 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
            </label>

            <div />
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">Description</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={280} placeholder="What knowledge will this base contain?" className="min-h-[98px] w-full resize-none rounded-xl border border-border bg-surface-low/40 px-3 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
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
            Create Knowledge Base
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
      <button type="button" aria-label="Close edit knowledge base" onClick={onClose} className="absolute inset-0 cursor-default bg-background/75 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-labelledby="edit-knowledge-title" className="relative flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-low text-text-secondary">
              <Pencil className="h-4 w-4" />
            </div>
            <div>
              <h2 id="edit-knowledge-title" className="text-[16px] font-semibold leading-tight text-foreground">Edit Knowledge Base</h2>
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

function KnowledgeBaseCard({
  base,
  agents,
  agentById,
  expanded,
  assignmentOpen,
  expandedFolders,
  busy,
  onToggle,
  onToggleAssignment,
  onToggleAgent,
  onToggleFolder,
  onEdit,
  onDeleteWorkspace,
  onUpload,
  onDeleteFile,
}: {
  base: KnowledgeBase;
  agents: SharedKnowledgeAgent[];
  agentById: Map<string, SharedKnowledgeAgent>;
  expanded: boolean;
  assignmentOpen: boolean;
  expandedFolders: Set<string>;
  busy?: boolean;
  onToggle: () => void;
  onToggleAssignment: () => void;
  onToggleAgent: (agentId: string) => void;
  onToggleFolder: (id: string) => void;
  onEdit: () => void;
  onDeleteWorkspace: () => void;
  onUpload: (file: File) => void;
  onDeleteFile: (file: WorkspaceFile) => void;
}) {
  const assignedAgents = assignedAgentsForBase(base, agentById);
  const fileInputId = `workspace-upload-${base.workspace.id}`;
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-muted">Contents</h4>
            <div className="flex items-center gap-2">
              <input
                id={fileInputId}
                type="file"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) onUpload(file);
                }}
              />
              <label htmlFor={fileInputId} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-foreground">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Upload
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface-low/25 px-2 py-2">
            {base.contents.length > 0 ? base.contents.map((node) => (
              <KnowledgeTreeNode key={node.id} node={node} depth={0} expandedFolders={expandedFolders} onToggleFolder={onToggleFolder} />
            )) : <p className="px-2 py-4 text-[12px] text-text-muted">No files yet.</p>}
          </div>

          {base.files.length > 0 && (
            <div className="mt-3 space-y-1">
              {base.files.map((file) => (
                <div key={file.id} className="flex min-h-8 items-center gap-2 rounded-lg px-2 text-[12px] text-text-secondary hover:bg-surface-low/45">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{file.path}</span>
                  <button type="button" aria-label={`Delete ${file.path}`} onClick={() => onDeleteFile(file)} className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-low hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

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
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(new Set());
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
        const [files, grants] = await Promise.all([
          workspaces.listFiles(workspace.slug).catch(() => [] as WorkspaceFile[]),
          workspaces.listGrants(workspace.slug).catch(() => [] as WorkspaceGrant[]),
        ]);
        const agentIds = Array.from(new Set(grants
          .filter((grant) => grant.subjectType === "agent" && !grant.revokedAt)
          .map((grant) => grant.subjectId)));
        return {
          workspace,
          files,
          grants,
          agentIds,
          contents: buildKnowledgeTree(files),
        };
      }));
      setKnowledgeBases(hydrated);
      setExpandedBaseId((current) => current && hydrated.some((base) => base.workspace.id === current) ? current : hydrated[0]?.workspace.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load shared knowledge.");
      setKnowledgeBases([]);
    } finally {
      setLoading(false);
    }
  }, [query, ready, workspaces]);

  React.useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  const toggleFolder = (id: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
      setError(err instanceof Error ? err.message : "Unable to create knowledge base.");
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
      setError(err instanceof Error ? err.message : "Unable to update knowledge base.");
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
      setError(err instanceof Error ? err.message : "Unable to delete knowledge base.");
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

  const uploadFile = async (base: KnowledgeBase, file: File) => {
    if (!workspaces) return;
    setBusyBaseId(base.workspace.id);
    setError(null);
    try {
      await workspaces.uploadFile(base.workspace.slug, file, { path: file.name, filename: file.name });
      await loadWorkspaces();
      setExpandedBaseId(base.workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload file.");
    } finally {
      setBusyBaseId(null);
    }
  };

  const deleteFile = async (base: KnowledgeBase, file: WorkspaceFile) => {
    if (!workspaces) return;
    setBusyBaseId(base.workspace.id);
    setError(null);
    try {
      await workspaces.deleteFile(base.workspace.slug, file.path);
      await loadWorkspaces();
      setExpandedBaseId(base.workspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete file.");
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
              <h2 className="text-[20px] font-semibold leading-tight text-foreground">Shared Knowledge</h2>
              <p className="mt-1 text-[13px] leading-snug text-text-muted">Workspace knowledge bases that agents can access during conversations.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => void loadWorkspaces()} disabled={!workspaces || loading} aria-label="Refresh shared knowledge" className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground disabled:opacity-50">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
              <button type="button" onClick={() => setCreateOpen(true)} disabled={!workspaces || loading} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-45">
                <Plus className="h-4 w-4" /> New Knowledge Base
              </button>
            </div>
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search knowledge bases..." className="h-10 w-full rounded-xl border border-border bg-surface-low/35 pl-10 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50" />
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
              <p className="text-[13px] font-semibold text-foreground">Shared knowledge is not connected.</p>
              <p className="mt-1 text-[11px] text-text-muted">Sign in again if the workspace client is unavailable.</p>
            </div>
          )}
          {workspaces && loading && knowledgeBases.length === 0 && (
            <div className="rounded-2xl border border-border bg-surface-low/25 px-5 py-10 text-center">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-text-muted" />
              <p className="text-[13px] font-semibold text-foreground">Loading shared knowledge</p>
            </div>
          )}
          {workspaces && !loading && knowledgeBases.map((base) => (
            <KnowledgeBaseCard
              key={base.workspace.id}
              base={base}
              agents={agents}
              agentById={agentById}
              expanded={expandedBaseId === base.workspace.id}
              assignmentOpen={assignmentBaseId === base.workspace.id}
              expandedFolders={expandedFolders}
              busy={busyBaseId === base.workspace.id}
              onToggle={() => setExpandedBaseId((current) => current === base.workspace.id ? null : base.workspace.id)}
              onToggleAssignment={() => setAssignmentBaseId((current) => current === base.workspace.id ? null : base.workspace.id)}
              onToggleAgent={(agentId) => void toggleAssignedAgent(base, agentId)}
              onToggleFolder={toggleFolder}
              onEdit={() => setEditingBaseId(base.workspace.id)}
              onDeleteWorkspace={() => void deleteBase(base)}
              onUpload={(file) => void uploadFile(base, file)}
              onDeleteFile={(file) => void deleteFile(base, file)}
            />
          ))}
          {workspaces && !loading && knowledgeBases.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-surface-low/25 px-5 py-10 text-center">
              <HardDrive className="mx-auto mb-2 h-5 w-5 text-text-muted" />
              <p className="text-[13px] font-semibold text-foreground">No knowledge bases found.</p>
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
