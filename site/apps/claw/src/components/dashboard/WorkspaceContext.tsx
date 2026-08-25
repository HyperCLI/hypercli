"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Workspace,
  WorkspaceAgentAssociation,
  WorkspacesAPI,
} from "@hypercli.com/sdk/workspaces";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createWorkspacesClient } from "@/lib/agent-client";
import { isDashboardReleaseSurfaceAvailable } from "@/lib/dashboard-release-boundary";
import {
  collectionDisplayName,
} from "@/lib/account-collection";

const WORKSPACE_SELECTION_STORAGE_PREFIX = "claw.selectedWorkspace.v1";
const EMPTY_WORKSPACES: Workspace[] = [];
const EMPTY_AGENT_IDS: readonly string[] = [];

type WorkspaceCreateInput = Parameters<WorkspacesAPI["create"]>[0];

type WorkspaceContextValue = {
  principalId: string | null;
  workspacesClient: WorkspacesAPI | null;
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  selectedWorkspace: Workspace | null;
  selectedWorkspaceAgentIds: readonly string[];
  isAgentRosterLoading: boolean;
  agentRosterError: string | null;
  isLoading: boolean;
  error: string | null;
  selectWorkspace: (workspaceId: string, workspace?: Workspace) => void;
  createWorkspace: (input: WorkspaceCreateInput) => Promise<Workspace>;
  refreshWorkspaces: (preferredWorkspaceId?: string | null) => Promise<boolean>;
  refreshSelectedWorkspaceAgents: () => Promise<boolean>;
  assignAgentToCollection: (agentId: string, collectionId: string) => Promise<void>;
  associateAgentWithSelectedWorkspace: (agentId: string) => Promise<void>;
};

type WorkspaceConnection = {
  principalId: string | null;
  tokenGetter: () => Promise<string>;
  client: WorkspacesAPI | null;
  error: string | null;
};

type WorkspaceCatalog = {
  client: WorkspacesAPI | null;
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
};

type WorkspaceSelection = {
  principalId: string | null;
  workspaceId: string | null;
};

type WorkspaceAgentRoster = {
  principalId: string | null;
  client: WorkspacesAPI | null;
  workspaceId: string | null;
  agentIds: readonly string[];
  loading: boolean;
  error: string | null;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function workspaceDisplayName(workspace: Workspace): string {
  return collectionDisplayName(workspace);
}

export function workspaceAgentCreationDisabledReason(
  workspace: Workspace | null,
  rosterError: string | null,
): string | null {
  if (!workspace) return "Select a Collection before launching an agent.";
  if (workspace.role !== "admin") return "Collection admin access is required to add agents.";
  if (rosterError) return "Collection agents could not be loaded. Refresh before launching an agent.";
  return null;
}

function selectionStorageKey(principalId: string): string {
  return `${WORKSPACE_SELECTION_STORAGE_PREFIX}:${encodeURIComponent(principalId)}`;
}

function readStoredSelection(principalId: string | null): string | null {
  if (!principalId || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(selectionStorageKey(principalId))?.trim() || null;
  } catch {
    return null;
  }
}

function writeStoredSelection(principalId: string | null, workspaceId: string | null): void {
  if (!principalId || typeof window === "undefined") return;
  try {
    const key = selectionStorageKey(principalId);
    if (workspaceId) window.localStorage.setItem(key, workspaceId);
    else window.localStorage.removeItem(key);
  } catch {
    // Selection remains available for the current page when storage is unavailable.
  }
}

function describeWorkspaceError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function workspaceErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  return typeof error.statusCode === "number" ? error.statusCode : null;
}

function workspaceGrantIsActive(grant: { revokedAt: string | null; expiresAt: string | null }): boolean {
  if (grant.revokedAt) return false;
  if (!grant.expiresAt) return true;
  const expiresAt = Date.parse(grant.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt > Date.now();
}

async function listWorkspaceAgentAssociations(
  client: WorkspacesAPI,
  workspace: Workspace,
): Promise<WorkspaceAgentAssociation[]> {
  try {
    return await client.listAgentAssociations(workspace.id);
  } catch (cause) {
    if (workspaceErrorStatus(cause) !== 404) throw cause;
    // Older Workspace services expose agent associations only through the admin grants catalog.
    if (workspace.role !== "admin") {
      throw new Error("Collection agent rosters for non-admin members require a Knowledge Hub service update.");
    }

    const grants = await client.listGrants(workspace.id);
    const seenAgentIds = new Set<string>();
    return grants.flatMap((grant) => {
      if (
        grant.subjectType !== "agent"
        || !workspaceGrantIsActive(grant)
        || seenAgentIds.has(grant.subjectId)
      ) return [];
      seenAgentIds.add(grant.subjectId);
      return [{
        workspaceId: workspace.id,
        agentId: grant.subjectId,
        role: grant.role,
        expiresAt: grant.expiresAt,
      }];
    });
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { getToken, isAuthenticated, isLoading: authLoading, user } = useAgentAuth();
  const principalId = user?.id ?? null;
  const [connection, setConnection] = useState<WorkspaceConnection>(() => ({
    principalId,
    tokenGetter: getToken,
    client: null,
    error: null,
  }));
  const [catalog, setCatalog] = useState<WorkspaceCatalog>({
    client: null,
    workspaces: EMPTY_WORKSPACES,
    loading: false,
    error: null,
  });
  const [selection, setSelection] = useState<WorkspaceSelection>({
    principalId,
    workspaceId: null,
  });
  const [agentRoster, setAgentRoster] = useState<WorkspaceAgentRoster>({
    principalId,
    client: null,
    workspaceId: null,
    agentIds: EMPTY_AGENT_IDS,
    loading: false,
    error: null,
  });
  const listRequestRef = useRef(0);
  const agentRosterRequestRef = useRef(0);
  // Collections (Knowledge Hub) are hidden for this release. While the surface
  // is unavailable, no reachable UI consumes Workspace state, so the provider
  // must not acquire a token, build a Workspaces client, list the catalog, or
  // load selected-Collection associations. The dormant implementation below is
  // preserved for re-enable; hidden mode short-circuits before any transport.
  const knowledgeHubAvailable = isDashboardReleaseSurfaceAvailable("knowledge-hub");
  const connectionIsCurrent = knowledgeHubAvailable && connection.principalId === principalId && connection.tokenGetter === getToken;
  const workspacesClient = knowledgeHubAvailable && !authLoading && isAuthenticated && principalId && connectionIsCurrent ? connection.client : null;
  const connectionError = knowledgeHubAvailable && !authLoading && isAuthenticated && principalId && connectionIsCurrent ? connection.error : null;
  const catalogIsCurrent = Boolean(workspacesClient && catalog.client === workspacesClient);
  const workspaces = catalogIsCurrent ? catalog.workspaces : EMPTY_WORKSPACES;
  const selectedWorkspaceId = selection.principalId === principalId
    && workspaces.some((workspace) => workspace.id === selection.workspaceId)
    ? selection.workspaceId
    : null;
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const activeConnectionRef = useRef({ principalId, client: workspacesClient });
  const activeAgentRosterScopeRef = useRef({ principalId, client: workspacesClient, workspaceId: selectedWorkspaceId });
  const agentRosterIsCurrent = Boolean(
    workspacesClient
    && selectedWorkspaceId
    && agentRoster.principalId === principalId
    && agentRoster.client === workspacesClient
    && agentRoster.workspaceId === selectedWorkspaceId,
  );
  const selectedWorkspaceAgentIds = agentRosterIsCurrent ? agentRoster.agentIds : EMPTY_AGENT_IDS;
  const isAgentRosterLoading = Boolean(
    workspacesClient
    && selectedWorkspaceId
    && (!agentRosterIsCurrent || agentRoster.loading),
  );
  const agentRosterError = agentRosterIsCurrent ? agentRoster.error : null;

  useLayoutEffect(() => {
    activeConnectionRef.current = { principalId, client: workspacesClient };
  }, [principalId, workspacesClient]);

  useLayoutEffect(() => {
    activeAgentRosterScopeRef.current = { principalId, client: workspacesClient, workspaceId: selectedWorkspaceId };
    agentRosterRequestRef.current += 1;
  }, [principalId, selectedWorkspaceId, workspacesClient]);

  useEffect(() => {
    let cancelled = false;
    if (!knowledgeHubAvailable || authLoading || !isAuthenticated || !principalId) return () => { cancelled = true; };

    const timeout = window.setTimeout(() => {
      setConnection({ principalId, tokenGetter: getToken, client: null, error: null });
      void (async () => {
        try {
          const token = await getToken();
          if (cancelled) return;
          setConnection({
            principalId,
            tokenGetter: getToken,
            client: createWorkspacesClient(token),
            error: null,
          });
        } catch (cause) {
          if (cancelled) return;
          setConnection({
            principalId,
            tokenGetter: getToken,
            client: null,
            error: describeWorkspaceError(cause, "Collection access is unavailable right now."),
          });
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [authLoading, getToken, isAuthenticated, knowledgeHubAvailable, principalId]);

  const refreshWorkspaces = useCallback(async (preferredWorkspaceId?: string | null) => {
    if (
      !workspacesClient
      || !principalId
      || activeConnectionRef.current.client !== workspacesClient
      || activeConnectionRef.current.principalId !== principalId
    ) return false;
    const requestId = ++listRequestRef.current;
    setCatalog((current) => ({
      client: workspacesClient,
      workspaces: current.client === workspacesClient ? current.workspaces : EMPTY_WORKSPACES,
      loading: true,
      error: null,
    }));

    try {
      const selectionPreference = preferredWorkspaceId;
      const listed = await workspacesClient.list();
      if (
        requestId !== listRequestRef.current
        || activeConnectionRef.current.client !== workspacesClient
        || activeConnectionRef.current.principalId !== principalId
      ) return false;
      setCatalog({ client: workspacesClient, workspaces: listed, loading: false, error: null });
      setSelection((current) => {
        const currentWorkspaceId = current.principalId === principalId ? current.workspaceId : null;
        const storedWorkspaceId = readStoredSelection(principalId);
        const nextWorkspaceId = [selectionPreference, currentWorkspaceId, storedWorkspaceId]
          .find((workspaceId): workspaceId is string => Boolean(
            workspaceId && listed.some((workspace) => workspace.id === workspaceId),
          )) ?? listed[0]?.id ?? null;
        writeStoredSelection(principalId, nextWorkspaceId);
        return { principalId, workspaceId: nextWorkspaceId };
      });
      return true;
    } catch (cause) {
      if (
        requestId !== listRequestRef.current
        || activeConnectionRef.current.client !== workspacesClient
        || activeConnectionRef.current.principalId !== principalId
      ) return false;
      setCatalog({
        client: workspacesClient,
        workspaces: EMPTY_WORKSPACES,
        loading: false,
        error: describeWorkspaceError(cause, "Unable to load Knowledge Hub."),
      });
      setSelection({ principalId, workspaceId: null });
      return false;
    }
  }, [principalId, workspacesClient]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!workspacesClient) {
        listRequestRef.current += 1;
        setCatalog({ client: null, workspaces: EMPTY_WORKSPACES, loading: false, error: null });
        return;
      }
      void refreshWorkspaces();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refreshWorkspaces, workspacesClient]);

  const refreshSelectedWorkspaceAgents = useCallback(async () => {
    const client = workspacesClient;
    const workspaceId = selectedWorkspaceId;
    const workspace = selectedWorkspace;
    const scope = activeAgentRosterScopeRef.current;
    if (
      !client
      || !workspaceId
      || !workspace
      || scope.principalId !== principalId
      || scope.client !== client
      || scope.workspaceId !== workspaceId
    ) return false;

    const requestId = ++agentRosterRequestRef.current;
    setAgentRoster((current) => ({
      principalId,
      client,
      workspaceId,
      agentIds: current.principalId === principalId
        && current.client === client
        && current.workspaceId === workspaceId
        ? current.agentIds
        : EMPTY_AGENT_IDS,
      loading: true,
      error: null,
    }));

    try {
      const associations = await listWorkspaceAgentAssociations(client, workspace);
      if (requestId !== agentRosterRequestRef.current || activeAgentRosterScopeRef.current !== scope) {
        return false;
      }
      setAgentRoster({
        principalId,
        client,
        workspaceId,
        agentIds: Array.from(new Set(associations.map((association) => association.agentId))),
        loading: false,
        error: null,
      });
      return true;
    } catch (cause) {
      if (requestId !== agentRosterRequestRef.current || activeAgentRosterScopeRef.current !== scope) {
        return false;
      }
      setAgentRoster({
        principalId,
        client,
        workspaceId,
        agentIds: EMPTY_AGENT_IDS,
        loading: false,
        error: describeWorkspaceError(cause, "Unable to load Collection agents."),
      });
      return false;
    }
  }, [principalId, selectedWorkspace, selectedWorkspaceId, workspacesClient]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!workspacesClient || !selectedWorkspaceId) {
        agentRosterRequestRef.current += 1;
        setAgentRoster({
          principalId,
          client: workspacesClient,
          workspaceId: selectedWorkspaceId,
          agentIds: EMPTY_AGENT_IDS,
          loading: false,
          error: null,
        });
        return;
      }
      void refreshSelectedWorkspaceAgents();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [principalId, refreshSelectedWorkspaceAgents, selectedWorkspaceId, workspacesClient]);

  const selectWorkspace = useCallback((workspaceId: string, discoveredWorkspace?: Workspace) => {
    if (!knowledgeHubAvailable) return;
    if (
      activeConnectionRef.current.client !== workspacesClient
      || activeConnectionRef.current.principalId !== principalId
    ) return;
    const existingWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!existingWorkspace && discoveredWorkspace?.id !== workspaceId) return;
    if (!existingWorkspace && discoveredWorkspace) {
      setCatalog((current) => {
        if (current.client !== workspacesClient || current.workspaces.some((workspace) => workspace.id === workspaceId)) {
          return current;
        }
        return { ...current, workspaces: [...current.workspaces, discoveredWorkspace] };
      });
    }
    writeStoredSelection(principalId, workspaceId);
    setSelection({ principalId, workspaceId });
  }, [knowledgeHubAvailable, principalId, workspaces, workspacesClient]);

  const createWorkspace = useCallback(async (input: WorkspaceCreateInput) => {
    if (!workspacesClient) throw new Error("Collections are not available in this release.");
    const created = await workspacesClient.create(input);
    if (
      activeConnectionRef.current.client !== workspacesClient
      || activeConnectionRef.current.principalId !== principalId
    ) throw new Error("The signed-in account changed before Collection creation finished.");
    const refreshed = await refreshWorkspaces(created.id);
    if (!refreshed) {
      setCatalog((current) => current.client === workspacesClient ? {
        ...current,
        workspaces: [...current.workspaces.filter((workspace) => workspace.id !== created.id), created],
        loading: false,
      } : current);
      writeStoredSelection(principalId, created.id);
      setSelection({ principalId, workspaceId: created.id });
    }
    return created;
  }, [principalId, refreshWorkspaces, workspacesClient]);

  const assignAgentToCollection = useCallback(async (agentId: string, collectionId: string) => {
    if (!knowledgeHubAvailable) throw new Error("Collections are not available in this release.");
    const capturedPrincipalId = principalId;
    const client = workspacesClient;
    const workspace = workspaces.find((candidate) => candidate.id === collectionId);
    if (
      !capturedPrincipalId
      || !client
      || !workspace
      || activeConnectionRef.current.principalId !== capturedPrincipalId
      || activeConnectionRef.current.client !== client
    ) throw new Error("Collections are not available in this release.");
    if (workspace.role !== "admin") {
      throw new Error("Collection admin access is required to assign agents.");
    }

    await client.grant(workspace.id, {
      subjectType: "agent",
      subjectId: agentId,
      role: "viewer",
    });
    if (
      activeConnectionRef.current.principalId !== capturedPrincipalId
      || activeConnectionRef.current.client !== client
    ) {
      throw new Error("The signed-in account changed before the Collection assignment finished.");
    }
    if (selectedWorkspaceId === workspace.id) {
      const refreshed = await refreshSelectedWorkspaceAgents();
      if (!refreshed) {
        throw new Error("The agent was assigned to the Collection, but its agent list could not be refreshed.");
      }
    }
  }, [knowledgeHubAvailable, principalId, refreshSelectedWorkspaceAgents, selectedWorkspaceId, workspaces, workspacesClient]);

  const associateAgentWithSelectedWorkspace = useCallback(async (agentId: string) => {
    if (!selectedWorkspaceId) throw new Error("Collections are not available in this release.");
    await assignAgentToCollection(agentId, selectedWorkspaceId);
  }, [assignAgentToCollection, selectedWorkspaceId]);

  const isLoading = authLoading || Boolean(
    isAuthenticated && knowledgeHubAvailable && (
      !connectionIsCurrent
      || (!workspacesClient && !connectionError)
      || (workspacesClient && (!catalogIsCurrent || catalog.loading))
    ),
  );
  const value = useMemo<WorkspaceContextValue>(() => ({
    principalId,
    workspacesClient,
    workspaces,
    selectedWorkspaceId,
    selectedWorkspace,
    selectedWorkspaceAgentIds,
    isAgentRosterLoading,
    agentRosterError,
    isLoading,
    error: connectionError || (catalogIsCurrent ? catalog.error : null),
    selectWorkspace,
    createWorkspace,
    refreshWorkspaces,
    refreshSelectedWorkspaceAgents,
    assignAgentToCollection,
    associateAgentWithSelectedWorkspace,
  }), [
    agentRosterError,
    assignAgentToCollection,
    associateAgentWithSelectedWorkspace,
    catalog.error,
    catalogIsCurrent,
    connectionError,
    createWorkspace,
    isAgentRosterLoading,
    isLoading,
    principalId,
    refreshSelectedWorkspaceAgents,
    refreshWorkspaces,
    selectWorkspace,
    selectedWorkspace,
    selectedWorkspaceAgentIds,
    selectedWorkspaceId,
    workspaces,
    workspacesClient,
  ]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return context;
}
