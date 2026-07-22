"use client";

import React from "react";
import Link from "next/link";
import type { Workspace, WorkspaceGrant } from "@hypercli.com/sdk/workspaces";
import { ConfirmDialog } from "@hypercli/shared-ui";
import {
  Bot,
  Check,
  HardDrive,
  Loader2,
  LockKeyhole,
  Mail,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { useWorkspace } from "@/components/dashboard/WorkspaceContext";

type WorkspaceRole = "viewer" | "contributor" | "admin";
type GrantSubjectType = "user" | "agent";

export type MembersSectionAgent = {
  id: string;
  name?: string | null;
  pod_name?: string | null;
};

type MembersSectionProps = {
  compact?: boolean;
  agents?: MembersSectionAgent[];
  agentsLoading?: boolean;
};

const ROLE_OPTIONS: Array<{ value: WorkspaceRole; label: string }> = [
  { value: "viewer", label: "Viewer" },
  { value: "contributor", label: "Contributor" },
  { value: "admin", label: "Admin" },
];

function accountName(user: ReturnType<typeof useAgentAuth>["user"]): string {
  const explicitName = user?.fullName?.trim() || user?.name?.trim() || user?.username?.trim();
  if (explicitName) return explicitName;
  return user?.email?.split("@")[0]?.trim() || "Your account";
}

function accountInitials(name: string, email?: string): string {
  const parts = name === "Your account" ? [] : name.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || email?.slice(0, 2) || "YO").toUpperCase();
}

function workspaceName(workspace: Workspace): string {
  return workspace.displayName?.trim() || workspace.name;
}

function workspaceRole(workspace: Workspace | null): WorkspaceRole | null {
  return workspace?.role === "viewer" || workspace?.role === "contributor" || workspace?.role === "admin"
    ? workspace.role
    : null;
}

function grantIsActive(grant: WorkspaceGrant): boolean {
  if (grant.revokedAt) return false;
  if (!grant.expiresAt) return true;
  const expiresAt = Date.parse(grant.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt > Date.now();
}

function grantStatus(grant: WorkspaceGrant): "active" | "expired" | "revoked" {
  if (grant.revokedAt) return "revoked";
  return grantIsActive(grant) ? "active" : "expired";
}

function agentName(agent: MembersSectionAgent): string {
  return agent.name || agent.pod_name || agent.id;
}

function describeError(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 403) {
    return "You don't have permission to manage this Workspace.";
  }
  return error instanceof Error ? error.message : fallback;
}

function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof UsersRound;
  accent?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-low/35 p-4">
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">{label}</p>
          <p className={`mt-2 text-2xl font-semibold tracking-tight ${accent ? "text-[var(--selection-accent)]" : "text-foreground"}`}>{value}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{detail}</p>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${accent ? "border-[rgb(var(--selection-accent-rgb)_/_0.25)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]" : "border-border bg-background/40 text-text-secondary"}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

export function MembersSection({ compact = false, agents = [], agentsLoading = false }: MembersSectionProps) {
  const { user } = useAgentAuth();
  const {
    workspacesClient,
    selectedWorkspace,
    isLoading: loadingWorkspaces,
    error: connectionError,
    refreshSelectedWorkspaceAgents,
  } = useWorkspace();
  const principalId = user?.id ?? null;
  const [grants, setGrants] = React.useState<WorkspaceGrant[]>([]);
  const [loadingGrants, setLoadingGrants] = React.useState(false);
  const [busyWorkspaceId, setBusyWorkspaceId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [accessWorkspaceId, setAccessWorkspaceId] = React.useState<string | null>(null);
  const [subjectType, setSubjectType] = React.useState<GrantSubjectType>("user");
  const [subjectId, setSubjectId] = React.useState("");
  const [role, setRole] = React.useState<WorkspaceRole>("viewer");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [pendingRevokeGrant, setPendingRevokeGrant] = React.useState<WorkspaceGrant | null>(null);
  const grantsRequestRef = React.useRef(0);
  const selectedWorkspaceIdRef = React.useRef(selectedWorkspace?.id ?? null);
  const accessTypeRef = React.useRef<HTMLSelectElement | null>(null);
  const accessTriggerRef = React.useRef<HTMLButtonElement | null>(null);

  const selectedRole = workspaceRole(selectedWorkspace);
  const canManageAccess = selectedRole === "admin";
  const busy = busyWorkspaceId === selectedWorkspace?.id;
  const accessOpen = Boolean(selectedWorkspace && accessWorkspaceId === selectedWorkspace.id);
  const agentById = React.useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const currentAccountName = accountName(user);
  const currentAccountEmail = user?.email?.trim() || "";

  React.useLayoutEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspace?.id ?? null;
  }, [selectedWorkspace?.id]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      setAccessWorkspaceId(null);
      setSubjectType("user");
      setSubjectId("");
      setRole("viewer");
      setExpiresAt("");
      setPendingRevokeGrant(null);
      setQuery("");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [selectedWorkspace?.id]);

  React.useEffect(() => {
    if (!accessOpen) return;
    const timeout = window.setTimeout(() => accessTypeRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [accessOpen]);

  const loadGrants = React.useCallback(async (workspace: Workspace | null) => {
    setError(null);
    if (
      !workspacesClient
      || !workspace
      || workspace.id !== selectedWorkspaceIdRef.current
      || workspaceRole(workspace) !== "admin"
    ) {
      setGrants([]);
      setLoadingGrants(false);
      return;
    }
    const requestId = ++grantsRequestRef.current;
    setLoadingGrants(true);
    setError(null);
    try {
      const listed = await workspacesClient.listGrants(workspace.id);
      if (requestId !== grantsRequestRef.current || workspace.id !== selectedWorkspaceIdRef.current) return;
      setGrants(listed);
    } catch (cause) {
      if (requestId !== grantsRequestRef.current || workspace.id !== selectedWorkspaceIdRef.current) return;
      setGrants([]);
      setError(describeError(cause, "Unable to load Workspace access."));
    } finally {
      if (requestId === grantsRequestRef.current && workspace.id === selectedWorkspaceIdRef.current) {
        setLoadingGrants(false);
      }
    }
  }, [workspacesClient]);

  const refreshWorkspaceAccess = () => {
    if (!selectedWorkspace) return;
    void loadGrants(selectedWorkspace);
    void refreshSelectedWorkspaceAgents();
  };

  React.useEffect(() => {
    const timeout = window.setTimeout(() => { void loadGrants(selectedWorkspace); }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadGrants, selectedWorkspace]);

  const createGrant = async () => {
    const resolvedSubjectId = subjectId.trim();
    const targetWorkspace = selectedWorkspace;
    const targetSubjectType = subjectType;
    if (!workspacesClient || !targetWorkspace || accessWorkspaceId !== targetWorkspace.id || !canManageAccess || !resolvedSubjectId || busy) return;
    setBusyWorkspaceId(targetWorkspace.id);
    setError(null);
    try {
      await workspacesClient.grant(targetWorkspace.id, {
        subjectType: targetSubjectType,
        subjectId: resolvedSubjectId,
        role,
        expiresAt: localDateTimeToIso(expiresAt),
      });
      if (selectedWorkspaceIdRef.current === targetWorkspace.id) {
        setSubjectId("");
        setRole("viewer");
        setExpiresAt("");
        accessTriggerRef.current?.focus();
        setAccessWorkspaceId(null);
        await loadGrants(targetWorkspace);
        if (targetSubjectType === "agent") await refreshSelectedWorkspaceAgents();
      }
    } catch (cause) {
      if (selectedWorkspaceIdRef.current === targetWorkspace.id) {
        setError(describeError(cause, "Unable to add Workspace access."));
      }
    } finally {
      setBusyWorkspaceId((current) => current === targetWorkspace.id ? null : current);
    }
  };

  const updateGrantRole = async (grant: WorkspaceGrant, nextRole: WorkspaceRole) => {
    const targetWorkspace = selectedWorkspace;
    if (!workspacesClient || !targetWorkspace || grant.workspaceId !== targetWorkspace.id || grant.isOwner || !grantIsActive(grant)) return;
    setBusyWorkspaceId(targetWorkspace.id);
    setError(null);
    try {
      const updated = await workspacesClient.updateGrant(targetWorkspace.id, grant.id, { role: nextRole });
      if (selectedWorkspaceIdRef.current === targetWorkspace.id) {
        setGrants((current) => current.map((item) => item.id === updated.id ? updated : item));
      }
    } catch (cause) {
      if (selectedWorkspaceIdRef.current === targetWorkspace.id) {
        setError(describeError(cause, "Unable to update Workspace access."));
      }
    } finally {
      setBusyWorkspaceId((current) => current === targetWorkspace.id ? null : current);
    }
  };

  const revokeGrant = async (grant: WorkspaceGrant) => {
    const targetWorkspace = selectedWorkspace;
    if (!workspacesClient || !targetWorkspace || grant.workspaceId !== targetWorkspace.id || grant.isOwner || !grantIsActive(grant)) return;
    setBusyWorkspaceId(targetWorkspace.id);
    setError(null);
    try {
      await workspacesClient.revokeGrant(targetWorkspace.id, grant.id);
      setPendingRevokeGrant((current) => current?.id === grant.id ? null : current);
      if (selectedWorkspaceIdRef.current === targetWorkspace.id) {
        await loadGrants(targetWorkspace);
        if (grant.subjectType === "agent") await refreshSelectedWorkspaceAgents();
      }
    } catch (cause) {
      if (selectedWorkspaceIdRef.current === targetWorkspace.id) {
        setError(describeError(cause, "Unable to remove Workspace access."));
      }
    } finally {
      setBusyWorkspaceId((current) => current === targetWorkspace.id ? null : current);
    }
  };

  const grantLabel = (grant: WorkspaceGrant): string => {
    if (grant.subjectType === "user" && grant.subjectId === principalId) return currentAccountName;
    if (grant.subjectType === "agent") {
      const agent = agentById.get(grant.subjectId);
      if (agent) return agentName(agent);
    }
    return grant.displayName?.trim() || (grant.subjectType === "agent" ? "Agent access" : "Workspace member");
  };

  const normalizedQuery = query.trim().toLowerCase();
  const selectedWorkspaceGrants = grants.filter((grant) => grant.workspaceId === selectedWorkspace?.id);
  const displayedGrants = selectedWorkspaceGrants.filter((grant) => {
    if (!normalizedQuery) return true;
    return [grantLabel(grant), grant.subjectId, grant.subjectType, grant.role, grantStatus(grant)]
      .some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const activeGrants = selectedWorkspaceGrants.filter(grantIsActive);
  const activePeople = activeGrants.filter((grant) => grant.subjectType === "user").length;
  const activeAgents = activeGrants.filter((grant) => grant.subjectType === "agent").length;
  const pendingCurrentRevoke = pendingRevokeGrant?.workspaceId === selectedWorkspace?.id
    ? pendingRevokeGrant
    : null;

  if (compact) {
    return (
      <section className="flex min-h-[356px] flex-col overflow-hidden rounded-lg border border-border bg-surface-low">
        <div className="flex min-h-[70px] items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Members</h2>
            <p className="mt-0.5 truncate text-[11px] text-text-muted">{selectedWorkspace ? workspaceName(selectedWorkspace) : "Workspace access"}</p>
          </div>
          <Link href="/dashboard/agents?section=members" className="shrink-0 text-[11px] font-medium text-text-muted transition-colors hover:text-foreground">Manage</Link>
        </div>
        <div className="flex flex-1 flex-col px-5 py-5">
          {loadingWorkspaces || loadingGrants ? (
            <div role="status" className="flex flex-1 items-center justify-center gap-2 text-[12px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading Workspace access</div>
          ) : connectionError || error ? (
            <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-[12px] text-destructive">{connectionError || error}</div>
          ) : !selectedWorkspace ? (
            <div role="status" className="flex flex-1 flex-col items-center justify-center text-center"><HardDrive className="h-5 w-5 text-text-muted" /><p className="mt-2 text-[12px] font-medium text-foreground">No Workspaces yet</p><p className="mt-1 text-[11px] text-text-muted">Create one from the Workspace menu.</p></div>
          ) : selectedRole !== "admin" ? (
            <div className="flex flex-1 items-center gap-3 rounded-xl border border-border bg-background/35 px-4 py-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-[11px] font-semibold text-[var(--selection-accent)]">{accountInitials(currentAccountName, currentAccountEmail)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-foreground">{currentAccountName}</span><span className="mt-1 block truncate text-[11px] text-text-muted">{currentAccountEmail || `${selectedRole} access`}</span><span className="mt-1 block text-[10px] capitalize text-text-muted">{selectedRole} access</span></span>
            </div>
          ) : activeGrants.length === 0 ? (
            <div role="status" className="flex flex-1 items-center justify-center text-[12px] text-text-muted">No active access grants.</div>
          ) : (
            <div className="space-y-2">
              {activeGrants.slice(0, 4).map((grant) => (
                <div key={grant.id} className="flex items-center gap-3 rounded-xl border border-border bg-background/35 px-3.5 py-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-high text-text-secondary">{grant.subjectType === "agent" ? <Bot className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-foreground">{grantLabel(grant)}</span><span className="block truncate text-[10px] capitalize text-text-muted">{grant.role}{grant.isOwner ? " · Owner" : ""}</span></span>
                </div>
              ))}
              {activeGrants.length > 4 ? <p className="px-1 text-[11px] text-text-muted">+{activeGrants.length - 4} more with access</p> : null}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="members-title" className="mx-auto w-full max-w-[1120px] space-y-6 pb-10">
      <header className="flex items-start justify-between gap-4 border-b border-border pb-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]"><UsersRound className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Workspace administration</p>
            <h1 id="members-title" className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-foreground">Members</h1>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-text-muted">Manage direct user and agent access for {selectedWorkspace ? workspaceName(selectedWorkspace) : "the selected Workspace"}. Switch Workspaces from the sidebar.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={refreshWorkspaceAccess}
          disabled={!selectedWorkspace || loadingWorkspaces || loadingGrants || busy}
          aria-label="Refresh Workspace access"
          title="Refresh Workspace access"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingGrants ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </header>

      {connectionError || error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[12px] text-destructive"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{connectionError || error}</div> : null}

      {loadingWorkspaces ? <div role="status" className="flex min-h-44 items-center justify-center gap-2 rounded-2xl border border-border text-[12px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading available Workspaces</div> : connectionError && !selectedWorkspace ? null : !selectedWorkspace ? <div role="status" className="rounded-2xl border border-dashed border-border px-5 py-12 text-center"><HardDrive className="mx-auto h-6 w-6 text-text-muted" /><p className="mt-3 text-[13px] font-medium text-foreground">No Workspaces available</p><p className="mt-1 text-[11px] text-text-muted">Create a Workspace from the sidebar to start managing shared access.</p></div> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard label="People" value={loadingGrants ? "-" : canManageAccess ? String(activePeople) : "1"} detail={canManageAccess ? "Active user grants" : "Your visible access"} icon={UsersRound} accent />
            <SummaryCard label="Agents" value={loadingGrants ? "-" : canManageAccess ? String(activeAgents) : "-"} detail={canManageAccess ? "Agents with direct access" : "Admin access required"} icon={Bot} />
            <SummaryCard label="Your role" value={selectedRole ? selectedRole[0]!.toUpperCase() + selectedRole.slice(1) : "Unknown"} detail={canManageAccess ? "Can manage Workspace access" : "Read-only member directory"} icon={ShieldCheck} />
          </div>

          {!canManageAccess ? <div className="flex items-start gap-3 rounded-2xl border border-[rgb(var(--selection-accent-rgb)_/_0.2)] bg-[rgb(var(--selection-accent-rgb)_/_0.06)] px-4 py-3.5"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--selection-accent)]" /><div><p className="text-[12px] font-semibold text-foreground">Workspace access is read-only</p><p className="mt-1 text-[11px] leading-relaxed text-text-muted">Only Workspace admins can view and change all user or agent grants. Your current role is {selectedRole || "viewer"}.</p></div></div> : null}

          {canManageAccess && accessOpen ? (
            <div id="workspace-access-form" aria-labelledby="workspace-access-form-title" className="grid gap-3 rounded-2xl border border-border bg-surface-low/25 p-4 md:grid-cols-[130px_minmax(0,1fr)_150px_190px_auto] md:items-end">
              <span id="workspace-access-form-title" className="sr-only">Add Workspace access</span>
              <label><span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Type</span><select ref={accessTypeRef} value={subjectType} onChange={(event) => { setSubjectType(event.target.value as GrantSubjectType); setSubjectId(""); }} className="h-9 w-full rounded-xl border border-border bg-background px-3 text-[12px] text-foreground"><option value="user">User</option><option value="agent">Agent</option></select></label>
              <label><span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">{subjectType === "agent" ? "Agent" : "User UUID"}</span>{subjectType === "agent" && agents.length > 0 ? <select aria-label="Agent" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} disabled={agentsLoading} className="h-9 w-full rounded-xl border border-border bg-background px-3 text-[12px] text-foreground"><option value="">Select an agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agentName(agent)}</option>)}</select> : <input value={subjectId} onChange={(event) => setSubjectId(event.target.value)} placeholder={subjectType === "agent" ? "Agent ID" : "Resolved user UUID"} className="h-9 w-full rounded-xl border border-border bg-background px-3 text-[12px] text-foreground placeholder:text-text-muted" />}</label>
              <label><span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Role</span><select value={role} onChange={(event) => setRole(event.target.value as WorkspaceRole)} className="h-9 w-full rounded-xl border border-border bg-background px-3 text-[12px] text-foreground">{ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label><span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Expires (optional)</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="h-9 w-full rounded-xl border border-border bg-background px-3 text-[12px] text-foreground" /></label>
              <div className="flex gap-2"><button type="button" onClick={() => { setAccessWorkspaceId(null); accessTriggerRef.current?.focus(); }} className="h-9 rounded-xl border border-border px-3 text-[12px] text-text-secondary hover:bg-surface-low">Cancel</button><button type="button" onClick={() => void createGrant()} disabled={!subjectId.trim() || busy} className="inline-flex h-9 items-center gap-2 rounded-xl bg-foreground px-3 text-[12px] font-semibold text-background disabled:opacity-45">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Add</button></div>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-border bg-surface-low/20">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div><h2 className="text-[14px] font-semibold text-foreground">Workspace access</h2><p className="mt-0.5 text-[11px] text-text-muted">Direct grants for {workspaceName(selectedWorkspace)}.</p></div>
              <div className="flex w-full gap-2 sm:w-auto"><label className="relative block min-w-0 flex-1 sm:w-64"><span className="sr-only">Search members</span><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search access" disabled={loadingGrants} className="h-9 w-full rounded-xl border border-border bg-background/45 pl-9 pr-3 text-[12px] text-foreground outline-none placeholder:text-text-muted focus:border-foreground/60 disabled:opacity-55" /></label>{canManageAccess ? <button ref={accessTriggerRef} type="button" aria-expanded={accessOpen} aria-controls="workspace-access-form" onClick={() => {
                if (accessOpen) {
                  setAccessWorkspaceId(null);
                  return;
                }
                setSubjectType("user");
                setSubjectId("");
                setRole("viewer");
                setExpiresAt("");
                setAccessWorkspaceId(selectedWorkspace.id);
              }} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-border px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-surface-low"><Plus className="h-3.5 w-3.5" /> Add access</button> : null}</div>
            </div>

            <div role="table" aria-label="Workspace access grants">
              <div role="row" className="sr-only lg:not-sr-only lg:grid lg:grid-cols-[minmax(0,1.4fr)_130px_150px_100px] lg:gap-4 lg:border-b lg:border-border lg:bg-background/20 lg:px-5 lg:py-2.5"><span role="columnheader" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Principal</span><span role="columnheader" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Status</span><span role="columnheader" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Role</span><span role="columnheader" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Action</span></div>
              {loadingGrants ? <div role="row"><div role="cell" aria-colspan={4} className="flex items-center gap-2 px-5 py-8 text-[12px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading Workspace grants</div></div> : !canManageAccess ? <div role="row" className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_130px_150px_100px] lg:items-center"><div role="cell" className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-[11px] font-semibold text-[var(--selection-accent)]">{accountInitials(currentAccountName, currentAccountEmail)}</span><span className="min-w-0"><span className="block truncate text-[13px] font-medium text-foreground">{currentAccountName}</span>{currentAccountEmail ? <span className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-text-muted"><Mail className="h-3 w-3" />{currentAccountEmail}</span> : null}</span></div><div role="cell"><span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.1)] px-2.5 py-1 text-[10px] font-medium text-[var(--selection-accent)]"><Check className="h-3 w-3" /> Active</span></div><div role="cell" className="text-[12px] capitalize text-text-secondary">{selectedRole}</div><div role="cell" className="text-[11px] text-text-muted">Current access</div></div> : displayedGrants.length === 0 ? <div role="row"><div role="cell" aria-colspan={4} className="px-5 py-10 text-center text-[12px] text-text-muted">{query ? "No access grants match your search." : "No access grants found."}</div></div> : displayedGrants.map((grant) => {
                const status = grantStatus(grant);
                const label = grantLabel(grant);
                const active = status === "active";
                return <div key={grant.id} role="row" className="grid gap-4 px-4 py-4 transition-colors hover:bg-surface-low/45 sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_130px_150px_100px] lg:items-center"><div role="cell" className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background/45 text-text-secondary">{grant.subjectType === "agent" ? <Bot className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}</span><span className="min-w-0"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-[13px] font-medium text-foreground">{label}</span>{grant.isOwner ? <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-text-muted">Owner</span> : null}</span><span className="mt-1 block truncate font-mono text-[10px] text-text-muted">{grant.subjectId}</span></span></div><div role="cell"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium capitalize ${status === "active" ? "bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]" : status === "expired" ? "bg-warning/10 text-warning" : "bg-surface-high text-text-muted"}`}>{status === "active" ? <Check className="h-3 w-3" /> : <LockKeyhole className="h-3 w-3" />}{status}</span></div><div role="cell"><select aria-label={`Role for ${label}`} value={grant.role} onChange={(event) => void updateGrantRole(grant, event.target.value as WorkspaceRole)} disabled={grant.isOwner || !active || busy} className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[11px] capitalize text-foreground disabled:opacity-55">{ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div role="cell">{grant.isOwner ? <span className="text-[11px] text-text-muted">Protected</span> : active ? <button type="button" aria-label={`Remove ${label}`} onClick={() => setPendingRevokeGrant(grant)} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-45"><Trash2 className="h-3.5 w-3.5" /></button> : <span className="text-[11px] text-text-muted">History</span>}</div></div>;
              })}
            </div>
          </div>
        </>
      )}
      <ConfirmDialog
        open={Boolean(pendingCurrentRevoke)}
        title="Remove Workspace access"
        message={pendingCurrentRevoke ? `Remove ${grantLabel(pendingCurrentRevoke)} from ${selectedWorkspace ? workspaceName(selectedWorkspace) : "this Workspace"}?` : ""}
        confirmLabel="Remove access"
        danger
        loading={busy}
        onCancel={() => { if (!busy) setPendingRevokeGrant(null); }}
        onConfirm={() => {
          if (pendingCurrentRevoke) void revokeGrant(pendingCurrentRevoke);
          else setPendingRevokeGrant(null);
        }}
      />
    </section>
  );
}
