"use client";

import React from "react";
import Link from "next/link";
import type {
  Workspace,
  WorkspaceAccessEntry,
  WorkspaceAccessSnapshot,
  WorkspaceGrant,
  WorkspacesAPI,
} from "@hypercli.com/sdk/workspaces";
import { BrowserHyperCLI } from "@hypercli.com/sdk/browser";
import {
  ConfirmDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@hypercli/shared-ui";
import {
  Bot,
  Check,
  HardDrive,
  Loader2,
  LockKeyhole,
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
import { TooltipHint } from "@/components/ClawTooltip";
import { AUTH_BASE_URL } from "@/lib/api";

type WorkspaceRole = "viewer" | "contributor" | "admin";
type GrantSubjectType = "user" | "agent";

export type MembersSectionAgent = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  handle?: string | null;
  pod_name?: string | null;
};

type MembersSectionProps = {
  compact?: boolean;
  agents?: MembersSectionAgent[];
  agentsLoading?: boolean;
};

type WorkspaceAccessState = {
  workspaceId: string | null;
  snapshot: WorkspaceAccessSnapshot | null;
  loading: boolean;
  error: string | null;
};

type CurrentUserProfile = {
  authUserId: string | null;
  subjectIds: string[];
  name: string | null;
  email: string | null;
};

const EMPTY_ACCESS_STATE: WorkspaceAccessState = {
  workspaceId: null,
  snapshot: null,
  loading: false,
  error: null,
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

function accountInitials(name: string, fallback?: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || fallback?.slice(0, 2) || "ME").toUpperCase();
}

function workspaceName(workspace: Workspace): string {
  return workspace.displayName?.trim() || workspace.name;
}

function roleValue(value: string | null | undefined): WorkspaceRole | null {
  return value === "viewer" || value === "contributor" || value === "admin" ? value : null;
}

function workspaceRole(workspace: Workspace | null): WorkspaceRole | null {
  return roleValue(workspace?.role);
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function rejectedReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "The Workspace service rejected the request.";
}

function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function agentName(agent: MembersSectionAgent): string {
  return agent.displayName?.trim() || agent.name?.trim() || agent.pod_name?.trim() || agent.id;
}

function subjectKey(subjectType: string, subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

function grantStatus(grant: WorkspaceGrant): "expired" | "revoked" {
  return grant.revokedAt ? "revoked" : "expired";
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
  const { getToken, user } = useAgentAuth();
  const {
    workspacesClient,
    selectedWorkspace,
    isLoading: loadingWorkspaces,
    error: connectionError,
    refreshSelectedWorkspaceAgents,
  } = useWorkspace();
  const selectedWorkspaceId = selectedWorkspace?.id ?? null;
  const [accessState, setAccessState] = React.useState<WorkspaceAccessState>(EMPTY_ACCESS_STATE);
  const [loadedUserProfile, setLoadedUserProfile] = React.useState<CurrentUserProfile | null>(null);
  const [busyWorkspaceId, setBusyWorkspaceId] = React.useState<string | null>(null);
  const [mutationError, setMutationError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [accessWorkspaceId, setAccessWorkspaceId] = React.useState<string | null>(null);
  const [subjectType, setSubjectType] = React.useState<GrantSubjectType>("user");
  const [subjectId, setSubjectId] = React.useState("");
  const [role, setRole] = React.useState<WorkspaceRole>("viewer");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [pendingRevokeEntry, setPendingRevokeEntry] = React.useState<WorkspaceAccessEntry | null>(null);
  const accessRequestRef = React.useRef(0);
  const selectedWorkspaceIdRef = React.useRef(selectedWorkspaceId);
  const workspacesClientRef = React.useRef<WorkspacesAPI | null>(workspacesClient);
  const accessTypeRef = React.useRef<HTMLButtonElement | null>(null);
  const accessTriggerRef = React.useRef<HTMLButtonElement | null>(null);

  const busy = busyWorkspaceId === selectedWorkspaceId;
  const accessOpen = Boolean(selectedWorkspaceId && accessWorkspaceId === selectedWorkspaceId);
  const accountAgentById = new Map(agents.map((agent) => [agent.id, agent]));
  const currentUserProfile = loadedUserProfile?.authUserId === (user?.id ?? null)
    ? loadedUserProfile
    : null;
  const currentAccountName = currentUserProfile?.name?.trim() || accountName(user);
  const currentAccountEmail = currentUserProfile?.email?.trim() || user?.email?.trim() || "";
  const currentSubjectIds = new Set(currentUserProfile?.subjectIds ?? []);

  React.useLayoutEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
    workspacesClientRef.current = workspacesClient;
    accessRequestRef.current += 1;
  }, [selectedWorkspaceId, workspacesClient]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      setAccessWorkspaceId(null);
      setSubjectType("user");
      setSubjectId("");
      setRole("viewer");
      setExpiresAt("");
      setPendingRevokeEntry(null);
      setMutationError(null);
      setQuery("");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [selectedWorkspaceId]);

  React.useEffect(() => {
    if (!accessOpen) return;
    const timeout = window.setTimeout(() => accessTypeRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [accessOpen]);

  React.useEffect(() => {
    if (!user) return;
    let active = true;
    const authUserId = user.id ?? null;

    void (async () => {
      try {
        const token = await getToken();
        const client = new BrowserHyperCLI({ apiUrl: AUTH_BASE_URL, token });
        const [auth, profile] = await Promise.all([client.user.authMe(), client.user.get()]);
        if (!active) return;
        setLoadedUserProfile({
          authUserId,
          subjectIds: Array.from(new Set([
            auth.userId,
            auth.orchestraUserId,
            profile.userId,
          ].filter((value): value is string => Boolean(value)))),
          name: profile.name,
          email: profile.email,
        });
      } catch {
        if (active) setLoadedUserProfile(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [getToken, user]);

  const loadWorkspaceAccess = React.useCallback(async (workspaceId: string) => {
    const client = workspacesClient;
    if (!client) return;
    const snapshotRequest = client.accessSnapshot(workspaceId);

    // A completed mutation still refreshes its target, but an old Workspace must never replace the current view.
    if (selectedWorkspaceIdRef.current !== workspaceId || workspacesClientRef.current !== client) {
      try {
        await snapshotRequest;
      } catch {
        // The target is no longer selected, so its reload has no visible state to update.
      }
      return;
    }

    const requestId = ++accessRequestRef.current;
    setMutationError(null);
    setAccessState((current) => ({
      workspaceId,
      snapshot: current.workspaceId === workspaceId ? current.snapshot : null,
      loading: true,
      error: null,
    }));

    try {
      const snapshot = await snapshotRequest;
      if (
        requestId !== accessRequestRef.current
        || selectedWorkspaceIdRef.current !== workspaceId
        || workspacesClientRef.current !== client
      ) return;
      setAccessState({ workspaceId, snapshot, loading: false, error: null });
    } catch (cause) {
      if (
        requestId !== accessRequestRef.current
        || selectedWorkspaceIdRef.current !== workspaceId
        || workspacesClientRef.current !== client
      ) return;
      setAccessState({
        workspaceId,
        snapshot: null,
        loading: false,
        error: describeError(cause, "Unable to load Workspace access."),
      });
    }
  }, [workspacesClient]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!selectedWorkspaceId || !workspacesClient) {
        accessRequestRef.current += 1;
        setAccessState(EMPTY_ACCESS_STATE);
        return;
      }
      void loadWorkspaceAccess(selectedWorkspaceId);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadWorkspaceAccess, selectedWorkspaceId, workspacesClient]);

  const reloadAfterMutation = React.useCallback(async (
    workspaceId: string,
    changedSubjectType: GrantSubjectType,
  ) => {
    const reloads: Promise<unknown>[] = [loadWorkspaceAccess(workspaceId)];
    if (changedSubjectType === "agent" && selectedWorkspaceIdRef.current === workspaceId) {
      reloads.push(refreshSelectedWorkspaceAgents());
    }
    await Promise.allSettled(reloads);
  }, [loadWorkspaceAccess, refreshSelectedWorkspaceAgents]);

  const refreshWorkspaceAccess = () => {
    if (!selectedWorkspaceId) return;
    void loadWorkspaceAccess(selectedWorkspaceId);
  };

  const accessIsCurrent = accessState.workspaceId === selectedWorkspaceId;
  const snapshot = accessIsCurrent ? accessState.snapshot : null;
  const loadingAccess = Boolean(
    selectedWorkspaceId
    && workspacesClient
    && (!accessIsCurrent || accessState.loading),
  );
  const accessError = accessIsCurrent ? accessState.error : null;
  const visibleError = connectionError || mutationError || accessError;
  const selectedRole = roleValue(snapshot?.currentRole) ?? workspaceRole(selectedWorkspace);
  const hasCurrentAccessOnly = snapshot?.visibility === "current-access-only";
  const hasFullDirectory = Boolean(
    snapshot?.visibility === "all-direct-access"
    && Array.isArray(snapshot.entries)
    && Array.isArray(snapshot.grants),
  );
  const canManageAccess = hasFullDirectory && selectedRole === "admin";
  const directory = hasFullDirectory
    ? snapshot!.entries!.filter((entry) => (
        entry.workspaceId === selectedWorkspaceId
        && (entry.subjectType === "user" || entry.subjectType === "agent")
      ))
    : [];
  const snapshotGrants = hasFullDirectory
    ? snapshot!.grants!.filter((grant) => grant.workspaceId === selectedWorkspaceId)
    : [];

  const subjectLabel = (subject: Pick<WorkspaceAccessEntry, "subjectType" | "subjectId" | "displayName" | "displaySlug">): string => {
    if (subject.subjectType === "agent") {
      const accountAgent = accountAgentById.get(subject.subjectId);
      if (accountAgent) return agentName(accountAgent);
    }
    const explicitName = subject.displayName?.trim();
    if (explicitName) return explicitName;
    if (subject.subjectType === "user" && currentSubjectIds.has(subject.subjectId)) return currentAccountName;
    return subject.displaySlug?.trim()
      || (subject.subjectType === "agent" ? "Workspace agent" : "Workspace member");
  };

  const subjectSecondaryLabel = (subject: Pick<WorkspaceAccessEntry, "subjectType" | "subjectId" | "displaySlug">): string => {
    const slug = subject.displaySlug?.trim();
    if (slug) return slug.startsWith("@") ? slug : `@${slug}`;
    if (subject.subjectType === "user" && currentSubjectIds.has(subject.subjectId) && currentAccountEmail) {
      return currentAccountEmail;
    }
    const accountAgent = subject.subjectType === "agent" ? accountAgentById.get(subject.subjectId) : null;
    if (accountAgent?.handle?.trim()) return `@${accountAgent.handle.trim().replace(/^@/, "")}`;
    return subject.subjectId;
  };

  const normalizedQuery = query.trim().toLowerCase();
  const displayedDirectory = directory.filter((entry) => {
    if (!normalizedQuery) return true;
    return [
      subjectLabel(entry),
      subjectSecondaryLabel(entry),
      entry.displayName || "",
      entry.displaySlug || "",
      entry.subjectId,
      entry.subjectType,
      entry.role,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const activePeople = directory.filter((entry) => entry.subjectType === "user").length;
  const activeAgents = directory.filter((entry) => entry.subjectType === "agent").length;
  const activeGrantIds = new Set(
    directory.flatMap((entry) => entry.grants.map((grant) => grant.id)),
  );
  const inactiveGrants = snapshotGrants.filter((grant) => !activeGrantIds.has(grant.id));
  const pendingCurrentRevoke = pendingRevokeEntry?.workspaceId === selectedWorkspaceId
    ? pendingRevokeEntry
    : null;

  const createGrant = async () => {
    const resolvedSubjectId = subjectId.trim();
    const targetWorkspaceId = selectedWorkspaceId;
    const targetSubjectType = subjectType;
    if (
      !workspacesClient
      || !targetWorkspaceId
      || accessWorkspaceId !== targetWorkspaceId
      || !canManageAccess
      || !resolvedSubjectId
      || busy
    ) return;
    setBusyWorkspaceId(targetWorkspaceId);
    setMutationError(null);
    try {
      await workspacesClient.grant(targetWorkspaceId, {
        subjectType: targetSubjectType,
        subjectId: resolvedSubjectId,
        role,
        expiresAt: localDateTimeToIso(expiresAt),
      });
      if (selectedWorkspaceIdRef.current === targetWorkspaceId) {
        setSubjectId("");
        setRole("viewer");
        setExpiresAt("");
        accessTriggerRef.current?.focus();
        setAccessWorkspaceId(null);
      }
      await reloadAfterMutation(targetWorkspaceId, targetSubjectType);
    } catch (cause) {
      if (selectedWorkspaceIdRef.current === targetWorkspaceId) {
        setMutationError(describeError(cause, "Unable to add Workspace access."));
      }
    } finally {
      setBusyWorkspaceId((current) => current === targetWorkspaceId ? null : current);
    }
  };

  const revokeEntry = async (entry: WorkspaceAccessEntry) => {
    const targetWorkspaceId = selectedWorkspaceId;
    if (
      !workspacesClient
      || !targetWorkspaceId
      || !canManageAccess
      || entry.workspaceId !== targetWorkspaceId
      || busy
    ) return;

    const label = subjectLabel(entry);
    setBusyWorkspaceId(targetWorkspaceId);
    setMutationError(null);
    try {
      const results = await Promise.allSettled(
        entry.grants.map((grant) => Promise.resolve().then(
          () => workspacesClient.revokeGrant(targetWorkspaceId, grant.id),
        )),
      );
      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      await reloadAfterMutation(targetWorkspaceId, entry.subjectType as GrantSubjectType);
      setPendingRevokeEntry(null);

      if (failures.length > 0 && selectedWorkspaceIdRef.current === targetWorkspaceId) {
        const reasons = Array.from(new Set(failures.map((failure) => rejectedReason(failure.reason)))).join(" ");
        const total = entry.grants.length;
        const failureMessage = failures.length === total
          ? `Unable to remove ${label}. All ${total} active access ${total === 1 ? "grant" : "grants"} failed. ${reasons}`
          : `Partially removed ${label}. ${failures.length} of ${total} active access grants failed. ${reasons}`;
        setMutationError(failureMessage);
      }
    } finally {
      setPendingRevokeEntry(null);
      setBusyWorkspaceId((current) => current === targetWorkspaceId ? null : current);
    }
  };

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
          {loadingWorkspaces || loadingAccess ? (
            <div role="status" className="flex flex-1 items-center justify-center gap-2 text-[12px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading Workspace access</div>
          ) : visibleError ? (
            <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-[12px] text-destructive">{visibleError}</div>
          ) : !selectedWorkspace ? (
            <div role="status" className="flex flex-1 flex-col items-center justify-center text-center"><HardDrive className="h-5 w-5 text-text-muted" /><p className="mt-2 text-[12px] font-medium text-foreground">No Workspaces yet</p><p className="mt-1 text-[11px] text-text-muted">Create one from the Workspace menu.</p></div>
          ) : hasCurrentAccessOnly ? (
            <div className="flex flex-1 flex-col justify-center">
              <div className="flex items-center gap-3 rounded-xl border border-border bg-background/35 px-4 py-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-[11px] font-semibold text-[var(--selection-accent)]">{accountInitials(currentAccountName, currentAccountEmail)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-foreground">{currentAccountName}</span><span className="mt-1 block truncate text-[11px] text-text-muted">{currentAccountEmail || "Signed-in account"}</span><span className="mt-1 block text-[10px] capitalize text-text-muted">{selectedRole || "viewer"} - Current access</span></span>
              </div>
              <p className="mt-3 text-center text-[11px] leading-relaxed text-text-muted">The full direct-access list is available to Workspace admins.</p>
            </div>
          ) : !hasFullDirectory ? (
            <div role="status" className="flex flex-1 items-center justify-center text-center text-[12px] text-text-muted">Workspace access is unavailable.</div>
          ) : directory.length === 0 ? (
            <div role="status" className="flex flex-1 items-center justify-center text-center text-[12px] text-text-muted">No active direct access entries.</div>
          ) : (
            <div className="space-y-2">
              {directory.slice(0, 4).map((entry) => (
                <div key={subjectKey(entry.subjectType, entry.subjectId)} className="flex items-center gap-3 rounded-xl border border-border bg-background/35 px-3.5 py-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-high text-text-secondary">{entry.subjectType === "agent" ? <Bot className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-foreground">{subjectLabel(entry)}</span><span className="block truncate text-[10px] capitalize text-text-muted">{entry.role}</span></span>
                </div>
              ))}
              {directory.length > 4 ? <p className="px-1 text-[11px] text-text-muted">+{directory.length - 4} more with access</p> : null}
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
            <h1 id="members-title" className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">Members</h1>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-text-muted">Review access for {selectedWorkspace ? workspaceName(selectedWorkspace) : "the selected Workspace"}. Workspace admins can manage the full direct-access list.</p>
          </div>
        </div>
        <TooltipHint label="Refresh Workspace access" disabled={!selectedWorkspace || loadingWorkspaces || loadingAccess || busy}>
          <button
            type="button"
            onClick={refreshWorkspaceAccess}
            disabled={!selectedWorkspace || loadingWorkspaces || loadingAccess || busy}
            aria-label="Refresh Workspace access"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingAccess ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </TooltipHint>
      </header>

      {visibleError ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[12px] text-destructive"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{visibleError}</div> : null}

      {loadingWorkspaces ? (
        <div role="status" className="flex min-h-44 items-center justify-center gap-2 rounded-2xl border border-border text-[12px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading available Workspaces</div>
      ) : connectionError && !selectedWorkspace ? null : !selectedWorkspace ? (
        <div role="status" className="rounded-2xl border border-dashed border-border px-5 py-12 text-center"><HardDrive className="mx-auto h-6 w-6 text-text-muted" /><p className="mt-3 text-[13px] font-medium text-foreground">No Workspaces available</p><p className="mt-1 text-[11px] text-text-muted">Create a Workspace from the sidebar to start managing shared access.</p></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard label="People" value={loadingAccess || !hasFullDirectory ? "-" : String(activePeople)} detail={hasFullDirectory ? "Active direct user access" : "Available to Workspace admins"} icon={UsersRound} accent />
            <SummaryCard label="Agents" value={loadingAccess || !hasFullDirectory ? "-" : String(activeAgents)} detail={hasFullDirectory ? "Active direct agent access" : "Available to Workspace admins"} icon={Bot} />
            <SummaryCard label="Your role" value={selectedRole ? selectedRole[0]!.toUpperCase() + selectedRole.slice(1) : "Unknown"} detail={canManageAccess ? "Can manage Workspace access" : "Your current Workspace access"} icon={ShieldCheck} />
          </div>

          {loadingAccess ? (
            <div role="status" className="flex min-h-44 items-center justify-center gap-2 rounded-2xl border border-border text-[12px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading Workspace access</div>
          ) : hasCurrentAccessOnly ? (
            <div className="overflow-hidden rounded-2xl border border-border bg-surface-low/20">
              <div className="border-b border-border px-5 py-4"><h2 className="text-[14px] font-semibold text-foreground">Your Workspace access</h2><p className="mt-0.5 text-[11px] text-text-muted">The full direct-access list is available to Workspace admins.</p></div>
              <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_130px_150px_110px] lg:items-center">
                <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-[11px] font-semibold text-[var(--selection-accent)]">{accountInitials(currentAccountName, currentAccountEmail)}</span><span className="min-w-0"><span className="block truncate text-[13px] font-medium text-foreground">{currentAccountName}</span>{currentAccountEmail ? <span className="mt-1 block truncate text-[11px] text-text-muted">{currentAccountEmail}</span> : null}</span></div>
                <div><span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.1)] px-2.5 py-1 text-[10px] font-medium text-[var(--selection-accent)]"><Check className="h-3 w-3" /> Active</span></div>
                <div className="text-[12px] capitalize text-text-secondary">{selectedRole || "viewer"}</div>
                <div className="text-[11px] text-text-muted">Current access</div>
              </div>
            </div>
          ) : !hasFullDirectory ? (
            <div role="status" className="rounded-2xl border border-dashed border-border px-5 py-12 text-center text-[12px] text-text-muted">Workspace access is unavailable.</div>
          ) : (
            <>
              {canManageAccess && accessOpen ? (
                <div id="workspace-access-form" aria-labelledby="workspace-access-form-title" className="grid gap-3 rounded-2xl border border-border bg-surface-low/25 p-4 md:grid-cols-[130px_minmax(0,1fr)_150px_190px_auto] md:items-end">
                  <span id="workspace-access-form-title" className="sr-only">Add Workspace access</span>
                  <div>
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Type</span>
                    <Select value={subjectType} onValueChange={(value) => { setSubjectType(value as GrantSubjectType); setSubjectId(""); }}>
                      <SelectTrigger ref={accessTypeRef} aria-label="Type" className="h-9 rounded-xl border-border bg-background text-[12px] shadow-none dark:bg-background dark:hover:bg-surface-low/60">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start">
                        <SelectItem value="user" className="text-[12px]">User</SelectItem>
                        <SelectItem value="agent" className="text-[12px]">Agent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">{subjectType === "agent" ? "Agent" : "User UUID"}</span>
                    {subjectType === "agent" && agents.length > 0 ? (
                      <Select value={subjectId} onValueChange={setSubjectId} disabled={agentsLoading}>
                        <SelectTrigger aria-label="Agent" className="h-9 rounded-xl border-border bg-background text-[12px] shadow-none dark:bg-background dark:hover:bg-surface-low/60">
                          <SelectValue placeholder="Select an agent" />
                        </SelectTrigger>
                        <SelectContent align="start">
                          {agents.map((agent) => <SelectItem key={agent.id} value={agent.id} className="text-[12px]">{agentName(agent)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <input aria-label={subjectType === "agent" ? "Agent" : "User UUID"} value={subjectId} onChange={(event) => setSubjectId(event.target.value)} placeholder={subjectType === "agent" ? "Agent ID" : "Resolved user UUID"} className="h-9 w-full rounded-xl border border-border bg-background px-3 text-[12px] text-foreground placeholder:text-text-muted" />
                    )}
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Role</span>
                    <Select value={role} onValueChange={(value) => setRole(value as WorkspaceRole)}>
                      <SelectTrigger aria-label="Role" className="h-9 rounded-xl border-border bg-background text-[12px] shadow-none dark:bg-background dark:hover:bg-surface-low/60">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start">
                        {ROLE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value} className="text-[12px]">{option.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <label><span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Expires (optional)</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="h-9 w-full rounded-xl border border-border bg-background px-3 text-[12px] text-foreground" /></label>
                  <div className="flex gap-2"><button type="button" onClick={() => { setAccessWorkspaceId(null); accessTriggerRef.current?.focus(); }} className="h-9 rounded-xl border border-border px-3 text-[12px] text-text-secondary hover:bg-surface-low">Cancel</button><button type="button" onClick={() => void createGrant()} disabled={!subjectId.trim() || busy} className="inline-flex h-9 items-center gap-2 rounded-xl bg-foreground px-3 text-[12px] font-semibold text-background disabled:opacity-45">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Add</button></div>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-2xl border border-border bg-surface-low/20">
                <div className="flex flex-col items-start gap-3 border-b border-border px-4 py-4 text-left sm:flex-row sm:items-center sm:px-5">
                  <div className="min-w-0 self-start text-left"><h2 className="text-[14px] font-semibold text-foreground">Workspace direct access</h2><p className="mt-0.5 text-[11px] text-text-muted">Active grouped people and agents for {workspaceName(selectedWorkspace)}.</p></div>
                  <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
                    <label className="relative block min-w-0 flex-1 sm:w-64"><span className="sr-only">Search members</span><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search access" className="h-9 w-full rounded-xl border border-border bg-background/45 pl-9 pr-3 text-[12px] text-foreground outline-none placeholder:text-text-muted focus:border-foreground/60" /></label>
                    {canManageAccess ? <button ref={accessTriggerRef} type="button" aria-expanded={accessOpen} aria-controls="workspace-access-form" onClick={() => {
                      if (accessOpen) {
                        setAccessWorkspaceId(null);
                        return;
                      }
                      setSubjectType("user");
                      setSubjectId("");
                      setRole("viewer");
                      setExpiresAt("");
                      setAccessWorkspaceId(selectedWorkspace.id);
                    }} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-border px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-surface-low"><Plus className="h-3.5 w-3.5" /> Add access</button> : null}
                  </div>
                </div>

                <div role="table" aria-label="Workspace direct access">
                  <div role="row" className="sr-only lg:not-sr-only lg:grid lg:grid-cols-[minmax(0,1.4fr)_150px_150px_110px] lg:gap-4 lg:border-b lg:border-border lg:bg-background/20 lg:px-5 lg:py-2.5"><span role="columnheader" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Principal</span><span role="columnheader" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Status</span><span role="columnheader" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Role</span><span role="columnheader" className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Action</span></div>
                  {displayedDirectory.length === 0 ? (
                    <div role="row"><div role="cell" aria-colspan={4} className="px-5 py-10 text-center text-[12px] text-text-muted">{query ? "No active people or agents match your search." : "No active direct access entries."}</div></div>
                  ) : displayedDirectory.map((entry) => {
                    const label = subjectLabel(entry);
                    return (
                      <div key={subjectKey(entry.subjectType, entry.subjectId)} role="row" className="grid gap-4 px-4 py-4 transition-colors hover:bg-surface-low/45 sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_150px_150px_110px] lg:items-center">
                        <div role="cell" className="flex min-w-0 items-center gap-3">
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${entry.subjectType === "user" ? "border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-[var(--selection-accent)]" : "border-border bg-background/45 text-text-secondary"}`}>{entry.subjectType === "agent" ? <Bot className="h-4 w-4" /> : <span className="text-[10px] font-semibold">{accountInitials(label, entry.subjectId)}</span>}</span>
                          <span className="min-w-0"><span className="block truncate text-[13px] font-medium text-foreground">{label}</span><span className="mt-1 block truncate text-[11px] text-text-muted">{subjectSecondaryLabel(entry)}</span></span>
                        </div>
                        <div role="cell"><span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.1)] px-2.5 py-1 text-[10px] font-medium text-[var(--selection-accent)]"><Check className="h-3 w-3" /> Active</span><span className="mt-1 block text-[10px] text-text-muted">{entry.grants.length} active {entry.grants.length === 1 ? "grant" : "grants"}</span></div>
                        <div role="cell" className="text-[12px] capitalize text-text-secondary">{entry.role}</div>
                        <div role="cell"><button type="button" aria-label={`Remove ${label}`} onClick={() => setPendingRevokeEntry(entry)} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Remove</button></div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {inactiveGrants.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-border bg-surface-low/20">
                  <div className="border-b border-border px-5 py-4"><h2 className="text-[14px] font-semibold text-foreground">Access history</h2><p className="mt-0.5 text-[11px] text-text-muted">Revoked and expired direct grants at the time this access view was captured.</p></div>
                  <div role="table" aria-label="Inactive Workspace access grants">
                    {inactiveGrants.map((grant) => {
                      const status = grantStatus(grant);
                      return (
                        <div key={grant.id} role="row" className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_120px_120px] sm:items-center">
                          <div role="cell" className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background/45 text-text-secondary">{grant.subjectType === "agent" ? <Bot className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}</span><span className="min-w-0"><span className="block truncate text-[12px] font-medium text-foreground">{subjectLabel(grant)}</span><span className="mt-1 block truncate font-mono text-[10px] text-text-muted">{grant.subjectId}</span></span></div>
                          <div role="cell"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium capitalize ${status === "expired" ? "bg-warning/10 text-warning" : "bg-surface-high text-text-muted"}`}><LockKeyhole className="h-3 w-3" />{status}</span></div>
                          <div role="cell" className="text-[12px] capitalize text-text-secondary">{grant.role}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(pendingCurrentRevoke)}
        title="Remove Workspace access"
        message={pendingCurrentRevoke ? `Remove all direct access for ${subjectLabel(pendingCurrentRevoke)} from ${selectedWorkspace ? workspaceName(selectedWorkspace) : "this Workspace"}?` : ""}
        confirmLabel="Remove access"
        danger
        loading={busy}
        onCancel={() => { if (!busy) setPendingRevokeEntry(null); }}
        onConfirm={() => {
          if (pendingCurrentRevoke) void revokeEntry(pendingCurrentRevoke);
          else setPendingRevokeEntry(null);
        }}
      />
    </section>
  );
}
