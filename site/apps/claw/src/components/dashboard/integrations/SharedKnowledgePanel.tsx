"use client";

import React from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  HardDrive,
  Plus,
  Search,
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
  type: "file" | "folder";
  size?: string;
  children?: KnowledgeNode[];
};

type KnowledgeBase = {
  id: string;
  name: string;
  description: string;
  icon: string;
  agentIds: string[];
  contents: KnowledgeNode[];
};

const KNOWLEDGE_BASES: Array<Omit<KnowledgeBase, "agentIds">> = [
  {
    id: "product-docs",
    name: "Product Documentation",
    description: "Shared product specs, roadmaps, and feature documentation",
    icon: "📚",
    contents: [
      { id: "prd-agent-workspaces", name: "PRD - Agent Workspaces", type: "file", size: "245 KB" },
      { id: "q3-roadmap", name: "Q3 2026 Roadmap", type: "file", size: "128 KB" },
      {
        id: "feature-specifications",
        name: "Feature Specifications",
        type: "folder",
        children: [
          { id: "skill-creation-flow", name: "Skill Creation Flow.md", type: "file", size: "45 KB" },
          { id: "shared-knowledge-ui", name: "Shared Knowledge UI.md", type: "file", size: "38 KB" },
        ],
      },
    ],
  },
  {
    id: "brand-assets",
    name: "Brand Assets",
    description: "Logos, color palettes, typography, and brand guidelines",
    icon: "🎨",
    contents: [
      { id: "hyperclaw-logo", name: "hyperclaw-logo.svg", type: "file", size: "92 KB" },
      { id: "color-palette", name: "Color Palette.md", type: "file", size: "21 KB" },
      { id: "typography", name: "Typography.md", type: "file", size: "18 KB" },
    ],
  },
  {
    id: "api-docs",
    name: "API Documentation",
    description: "Internal API references, endpoints, and integration guides",
    icon: "🔌",
    contents: [
      { id: "openapi", name: "openapi.yaml", type: "file", size: "311 KB" },
      {
        id: "integration-guides",
        name: "Integration Guides",
        type: "folder",
        children: [
          { id: "github-oauth", name: "GitHub OAuth.md", type: "file", size: "54 KB" },
          { id: "webhooks", name: "Webhook Events.md", type: "file", size: "47 KB" },
        ],
      },
      { id: "postman", name: "HyperCLI.postman_collection.json", type: "file", size: "188 KB" },
    ],
  },
  {
    id: "runbooks",
    name: "Runbooks",
    description: "Operational procedures, incident response, and troubleshooting",
    icon: "📋",
    contents: [
      { id: "incident-response", name: "Incident Response.md", type: "file", size: "83 KB" },
      { id: "deployment-procedures", name: "Deployment Procedures.md", type: "file", size: "76 KB" },
      { id: "troubleshooting", name: "Troubleshooting Guide.md", type: "file", size: "64 KB" },
    ],
  },
];

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

function defaultAgentIdsForBase(baseId: string, agents: SharedKnowledgeAgent[]): string[] {
  const ids = agents.map((agent) => agent.id);
  if (baseId === "product-docs") return ids.slice(0, 2);
  if (baseId === "brand-assets") return ids.slice(0, 1);
  if (baseId === "api-docs") return ids.slice(1, 3).length > 0 ? ids.slice(1, 3) : ids.slice(0, 2);
  if (baseId === "runbooks") return ids.slice(0, 3);
  return [];
}

function buildKnowledgeBases(agents: SharedKnowledgeAgent[]): KnowledgeBase[] {
  return KNOWLEDGE_BASES.map((base) => ({
    ...base,
    agentIds: defaultAgentIdsForBase(base.id, agents),
  }));
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

function KnowledgeIcon({ icon }: { icon: string }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-low text-[17px] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
      <span aria-hidden="true">{icon}</span>
    </div>
  );
}

function AgentChip({ agent, selected, onClick }: { agent: SharedKnowledgeAgent; selected?: boolean; onClick?: () => void }) {
  const displayName = agentDisplayName(agent);
  const avatar = agentAvatar(displayName, agent.meta);
  const AvatarIcon = avatar.icon;
  const className = `inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors ${
    selected
      ? "border-primary/45 bg-primary/10 text-primary"
      : "border-border bg-background/45 text-text-secondary hover:border-border-strong hover:text-foreground"
  }`;
  const content = (
    <>
      <span className={`h-1.5 w-1.5 rounded-full ${agentStateDotClass(agent.state)}`} aria-hidden="true" />
      <AvatarIcon className="h-3 w-3" style={{ color: avatar.fgColor }} />
      <span>{displayName}</span>
      <span className="text-[10px] text-text-muted">{normalizeAgentState(agent.state)}</span>
      {selected && <Check className="h-3 w-3" />}
    </>
  );

  if (!onClick) {
    return <span className={className}>{content}</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={Boolean(selected)}
      className={className}
    >
      {content}
    </button>
  );
}

function KnowledgeTreeNode({ node, depth, expandedFolders, onToggleFolder }: { node: KnowledgeNode; depth: number; expandedFolders: Set<string>; onToggleFolder: (id: string) => void }) {
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
        {node.size && <span className="shrink-0 pr-2 text-[10px] font-medium text-text-muted">{node.size}</span>}
      </button>
      {isFolder && expanded && node.children?.map((child) => (
        <KnowledgeTreeNode key={child.id} node={child} depth={depth + 1} expandedFolders={expandedFolders} onToggleFolder={onToggleFolder} />
      ))}
    </div>
  );
}

function NewKnowledgeBaseModal({ agents, onClose, onCreate }: { agents: SharedKnowledgeAgent[]; onClose: () => void; onCreate: (base: KnowledgeBase) => void }) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [selectedAgentIds, setSelectedAgentIds] = React.useState<Set<string>>(() => new Set(agents.slice(0, 2).map((agent) => agent.id)));

  const canCreate = Boolean(name.trim());
  const handleCreate = () => {
    if (!canCreate) return;
    const trimmedName = name.trim();
    onCreate({
      id: trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `knowledge-${Date.now()}`,
      name: trimmedName,
      description: description.trim() || "Shared knowledge repository for this agent workspace",
      icon: "📚",
      agentIds: Array.from(selectedAgentIds),
      contents: [],
    });
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
              <p className="mt-1 text-[12px] leading-snug text-text-muted">Create a shared knowledge repository for your agents</p>
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-5">
            <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-low text-[18px]" aria-hidden="true">📚</div>
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g., Product Documentation"
                className="h-10 w-full rounded-xl border border-border bg-surface-low/40 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50"
              />
            </label>

            <div />
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">Description</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                maxLength={280}
                placeholder="What knowledge will this base contain?"
                className="min-h-[98px] w-full resize-none rounded-xl border border-border bg-surface-low/40 px-3 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50"
              />
              <span className="mt-1 block text-right text-[11px] text-text-muted">{description.length} chars</span>
            </label>
          </div>

          <div className="mt-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-muted">Assign Agents</h3>
            <p className="mt-2 text-[12px] text-text-muted">Select which agents can access this knowledge base</p>
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
              {agents.length === 0 && (
                <p className="text-[12px] text-text-muted">No agents are available yet. Create an agent to assign this knowledge base.</p>
              )}
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

function KnowledgeBaseCard({
  base,
  agents,
  agentById,
  expanded,
  assignmentOpen,
  expandedFolders,
  onToggle,
  onToggleAssignment,
  onToggleAgent,
  onToggleFolder,
}: {
  base: KnowledgeBase;
  agents: SharedKnowledgeAgent[];
  agentById: Map<string, SharedKnowledgeAgent>;
  expanded: boolean;
  assignmentOpen: boolean;
  expandedFolders: Set<string>;
  onToggle: () => void;
  onToggleAssignment: () => void;
  onToggleAgent: (agentId: string) => void;
  onToggleFolder: (id: string) => void;
}) {
  const assignedAgents = assignedAgentsForBase(base, agentById);
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-background/70 transition-colors hover:border-border-strong">
      <div className="grid w-full gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-center gap-3 text-left">
          <KnowledgeIcon icon={base.icon} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold leading-tight text-foreground">{base.name}</h3>
            <p className="mt-1 truncate text-[12px] leading-snug text-text-muted">{base.description}</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-start gap-3 pl-[52px] sm:justify-end sm:pl-0">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted"><HardDrive className="h-3 w-3" />{contentCountLabel(base)}</span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted"><Bot className="h-3 w-3" />{agentCountLabel(assignedAgents.length)}</span>
          <button type="button" aria-label={`Open ${base.name}`} onClick={onToggle} className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-foreground">
            Open <ChevronRight className="h-3 w-3" />
          </button>
          <button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${base.name}`} onClick={onToggle} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-low hover:text-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-muted">Contents</h4>
            <div className="flex items-center gap-2">
              <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-foreground">
                <Upload className="h-3 w-3" /> Upload
              </button>
              <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-foreground">
                <Plus className="h-3 w-3" /> New Folder
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface-low/25 px-2 py-2">
            {base.contents.length > 0 ? base.contents.map((node) => (
              <KnowledgeTreeNode key={node.id} node={node} depth={0} expandedFolders={expandedFolders} onToggleFolder={onToggleFolder} />
            )) : <p className="px-2 py-4 text-[12px] text-text-muted">No files yet. Upload content or create a folder to start this knowledge base.</p>}
          </div>

          <div className="mt-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-muted">Assigned Agents</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {assignedAgents.map((agent) => <AgentChip key={agent.id} agent={agent} />)}
              {assignedAgents.length === 0 && <span className="text-[12px] text-text-muted">No agents assigned.</span>}
              <button type="button" onClick={onToggleAssignment} disabled={agents.length === 0} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45">
                <Plus className="h-3 w-3" /> Assign Agent
              </button>
            </div>
            {assignmentOpen && (
              <div className="mt-3 rounded-xl border border-border bg-surface-low/25 p-3">
                <p className="text-[12px] text-text-muted">Choose which available agents can access this knowledge base.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {agents.map((agent) => (
                    <AgentChip
                      key={agent.id}
                      agent={agent}
                      selected={base.agentIds.includes(agent.id)}
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

export function SharedKnowledgePanel({ agents = [] }: { agents?: SharedKnowledgeAgent[] }) {
  const [knowledgeBases, setKnowledgeBases] = React.useState(() => buildKnowledgeBases(agents));
  const [query, setQuery] = React.useState("");
  const [expandedBaseId, setExpandedBaseId] = React.useState("product-docs");
  const [assignmentBaseId, setAssignmentBaseId] = React.useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = React.useState(false);

  const agentById = React.useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  const filteredBases = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return knowledgeBases;
    return knowledgeBases.filter((base) => `${base.name} ${base.description}`.toLowerCase().includes(normalized));
  }, [knowledgeBases, query]);

  const toggleFolder = (id: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = (base: KnowledgeBase) => {
    setKnowledgeBases((current) => [base, ...current.filter((item) => item.id !== base.id)]);
    setExpandedBaseId(base.id);
    setAssignmentBaseId(null);
    setQuery("");
  };

  const toggleAssignedAgent = (baseId: string, agentId: string) => {
    setKnowledgeBases((current) => current.map((base) => {
      if (base.id !== baseId) return base;
      const assigned = base.agentIds.includes(agentId);
      return {
        ...base,
        agentIds: assigned ? base.agentIds.filter((id) => id !== agentId) : [...base.agentIds, agentId],
      };
    }));
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="w-full px-5 py-5">
        <div className="mb-7 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[20px] font-semibold leading-tight text-foreground">Shared Knowledge</h2>
              <p className="mt-1 text-[13px] leading-snug text-text-muted">Knowledge bases that agents can access and reference during conversations.</p>
            </div>
            <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90">
              <Plus className="h-4 w-4" /> New Knowledge Base
            </button>
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search knowledge bases..."
              className="h-10 w-full rounded-xl border border-border bg-surface-low/35 pl-10 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-primary/50"
            />
          </label>
        </div>

        <div className="space-y-3">
          {filteredBases.map((base) => (
            <KnowledgeBaseCard
              key={base.id}
              base={base}
              agents={agents}
              agentById={agentById}
              expanded={expandedBaseId === base.id}
              assignmentOpen={assignmentBaseId === base.id}
              expandedFolders={expandedFolders}
              onToggle={() => setExpandedBaseId((current) => current === base.id ? "" : base.id)}
              onToggleAssignment={() => setAssignmentBaseId((current) => current === base.id ? null : base.id)}
              onToggleAgent={(agentId) => toggleAssignedAgent(base.id, agentId)}
              onToggleFolder={toggleFolder}
            />
          ))}
          {filteredBases.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-surface-low/25 px-5 py-10 text-center">
              <HardDrive className="mx-auto mb-2 h-5 w-5 text-text-muted" />
              <p className="text-[13px] font-semibold text-foreground">No knowledge bases match this search.</p>
              <p className="mt-1 text-[11px] text-text-muted">Try another term or create a new knowledge base.</p>
            </div>
          )}
        </div>
      </div>

      {createOpen && <NewKnowledgeBaseModal agents={agents} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />}
    </div>
  );
}
