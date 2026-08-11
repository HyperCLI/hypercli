"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  Workspace,
  WorkspaceFile,
  WorkspaceGrant,
  WorkspacesAPI,
} from "@hypercli.com/sdk/workspaces";
import {
  collectionDeletionBlockedReason,
  collectionDisplayName,
} from "@/lib/account-collection";

export type KnowledgeHubCollection = {
  workspace: Workspace;
  files: WorkspaceFile[] | null;
  grants: WorkspaceGrant[] | null;
  agentIds: string[] | null;
  filesError: string | null;
  accessError: string | null;
};

type CollectionCreateInput = Parameters<WorkspacesAPI["create"]>[0];
type CollectionUpdateInput = Parameters<WorkspacesAPI["update"]>[1];
type FileUpdateInput = Parameters<WorkspacesAPI["updateFile"]>[2];

type KnowledgeHubCatalogOptions = {
  onCollectionsChanged?: () => Promise<unknown> | void;
  catalogSignal?: string;
};

const PROCESSING_STATES = new Set([
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

function errorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  return typeof error.statusCode === "number" ? error.statusCode : null;
}

class KnowledgeHubUserError extends Error {}

function knowledgeHubUserError(message: string): KnowledgeHubUserError {
  return new KnowledgeHubUserError(message);
}

export function describeKnowledgeHubError(error: unknown, fallback: string): string {
  if (error instanceof KnowledgeHubUserError) return error.message;
  if (errorStatusCode(error) === 403) return "You don't have permission to perform this action.";
  return fallback;
}

export function knowledgeWorkspaceName(workspace: Workspace): string {
  return collectionDisplayName(workspace);
}

export function knowledgeWorkspaceRef(workspace: Workspace): string {
  return workspace.slug || workspace.id;
}

export function knowledgeFileHealth(file: WorkspaceFile): "ready" | "processing" | "failed" {
  const states = [file.fileState, file.uploadStatus, file.processingState]
    .filter((state): state is string => Boolean(state))
    .map((state) => state.toLowerCase());
  if (states.some((state) => state.includes("fail") || state.includes("error"))) return "failed";
  if (states.some((state) => PROCESSING_STATES.has(state))) return "processing";
  if (states.some((state) => state === "processed" || state === "ready" || state === "finished")) return "ready";
  return "processing";
}

export function knowledgeFileStatusLabel(file: WorkspaceFile): string {
  const health = knowledgeFileHealth(file);
  if (health === "failed") return "Failed";
  if (health === "ready") return "Ready";
  const state = file.processingState || file.uploadStatus || file.fileState || "Processing";
  return state.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function grantIsActive(grant: WorkspaceGrant, now = Date.now()): boolean {
  if (grant.revokedAt) return false;
  if (!grant.expiresAt) return true;
  const expiresAt = Date.parse(grant.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt > now;
}

function agentIdsFromGrants(grants: WorkspaceGrant[]): string[] {
  const now = Date.now();
  return Array.from(new Set(grants
    .filter((grant) => grant.subjectType === "agent" && grantIsActive(grant, now))
    .map((grant) => grant.subjectId)));
}

async function hydrateCollection(
  client: WorkspacesAPI,
  workspace: Workspace,
): Promise<KnowledgeHubCollection> {
  const workspaceRef = knowledgeWorkspaceRef(workspace);
  const canReviewAccess = workspace.role?.toLowerCase() === "admin";
  const [filesResult, grantsResult] = await Promise.allSettled([
    client.listFiles(workspaceRef),
    canReviewAccess ? client.listGrants(workspaceRef) : Promise.resolve(null),
  ]);
  const files = filesResult.status === "fulfilled" ? filesResult.value : null;
  const grants = grantsResult.status === "fulfilled" ? grantsResult.value : null;

  return {
    workspace,
    files,
    grants,
    agentIds: grants ? agentIdsFromGrants(grants) : null,
    filesError: filesResult.status === "rejected"
      ? errorStatusCode(filesResult.reason) === 403
        ? "You don't have permission to view sources in this Collection."
        : "Sources couldn't be loaded. Refresh to retry."
      : null,
    accessError: grantsResult.status === "rejected"
      ? errorStatusCode(grantsResult.reason) === 403
        ? "You don't have permission to review Collection assignments."
        : "Collection assignments couldn't be loaded. Refresh to retry."
      : null,
  };
}

function upsertFile(files: WorkspaceFile[] | null, nextFile: WorkspaceFile): WorkspaceFile[] {
  const next = [...(files ?? [])];
  const index = next.findIndex((file) => file.id === nextFile.id || file.path === nextFile.path);
  if (index >= 0) next[index] = nextFile;
  else next.push(nextFile);
  return next;
}

function sortCollections(collections: KnowledgeHubCollection[]): KnowledgeHubCollection[] {
  return collections.sort((left, right) => (
    knowledgeWorkspaceName(left.workspace).localeCompare(knowledgeWorkspaceName(right.workspace))
  ));
}

export function useKnowledgeHubCatalog(
  client: WorkspacesAPI | null,
  { onCollectionsChanged, catalogSignal = "" }: KnowledgeHubCatalogOptions = {},
) {
  const [collections, setCollections] = useState<KnowledgeHubCollection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const mutationRevisionRef = useRef(0);
  const activeClientRef = useRef(client);
  const collectionsChangedRef = useRef(onCollectionsChanged);
  const refreshInFlightRef = useRef<{
    client: WorkspacesAPI;
    promise: Promise<boolean>;
  } | null>(null);

  useLayoutEffect(() => {
    activeClientRef.current = client;
    requestRef.current += 1;
    refreshInFlightRef.current = null;
  }, [client]);

  useLayoutEffect(() => {
    collectionsChangedRef.current = onCollectionsChanged;
  }, [onCollectionsChanged]);

  const notifyCollectionsChanged = useCallback(() => {
    try {
      void Promise.resolve(collectionsChangedRef.current?.()).catch(() => undefined);
    } catch {
      // The Knowledge Hub remains authoritative even if another dashboard view cannot refresh.
    }
  }, []);

  const refresh = useCallback((force = false): Promise<boolean> => {
    if (!client) {
      setCollections([]);
      setLoading(false);
      setError(null);
      return Promise.resolve(false);
    }

    const inFlight = refreshInFlightRef.current;
    if (!force && inFlight?.client === client) return inFlight.promise;
    const requestId = ++requestRef.current;
    const mutationRevision = mutationRevisionRef.current;
    setLoading(true);
    setError(null);
    const promise = (async () => {
      try {
        const listed = await client.list();
        const hydrated = await Promise.all(listed.map((workspace) => hydrateCollection(client, workspace)));
        if (
          requestId !== requestRef.current
          || activeClientRef.current !== client
          || mutationRevision !== mutationRevisionRef.current
        ) return false;
        startTransition(() => setCollections(sortCollections(hydrated)));
        return true;
      } catch (cause) {
        if (
          requestId !== requestRef.current
          || activeClientRef.current !== client
          || mutationRevision !== mutationRevisionRef.current
        ) return false;
        setError(describeKnowledgeHubError(cause, "Knowledge couldn't be loaded."));
        return false;
      } finally {
        if (requestId === requestRef.current && activeClientRef.current === client) setLoading(false);
      }
    })();
    refreshInFlightRef.current = { client, promise };
    void promise.finally(() => {
      if (refreshInFlightRef.current?.promise === promise) refreshInFlightRef.current = null;
    });
    return promise;
  }, [client]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(true), 0);
    return () => window.clearTimeout(timeout);
  }, [catalogSignal, refresh]);

  const createCollection = useCallback(async (input: CollectionCreateInput) => {
    if (!client) throw knowledgeHubUserError("Knowledge is not connected.");
    mutationRevisionRef.current += 1;
    try {
      const workspace = await client.create(input);
      const collection = await hydrateCollection(client, workspace);
      setCollections((current) => sortCollections([
        ...current.filter((item) => item.workspace.id !== workspace.id),
        collection,
      ]));
      notifyCollectionsChanged();
      return collection;
    } finally {
      mutationRevisionRef.current += 1;
    }
  }, [client, notifyCollectionsChanged]);

  const updateCollection = useCallback(async (
    collection: KnowledgeHubCollection,
    input: CollectionUpdateInput,
  ) => {
    if (!client) throw knowledgeHubUserError("Knowledge is not connected.");
    if (collection.workspace.role?.toLowerCase() !== "admin") {
      throw knowledgeHubUserError("Collection admin access is required to update these details.");
    }
    mutationRevisionRef.current += 1;
    try {
      const workspace = await client.update(knowledgeWorkspaceRef(collection.workspace), input);
      setCollections((current) => sortCollections(current.map((item) => (
        item.workspace.id === collection.workspace.id ? { ...item, workspace } : item
      ))));
      notifyCollectionsChanged();
      return { ...collection, workspace };
    } finally {
      mutationRevisionRef.current += 1;
    }
  }, [client, notifyCollectionsChanged]);

  const deleteCollection = useCallback(async (collection: KnowledgeHubCollection) => {
    if (!client) throw knowledgeHubUserError("Knowledge is not connected.");
    if (collection.workspace.role?.toLowerCase() !== "admin") {
      throw knowledgeHubUserError("Collection admin access is required to delete this Collection.");
    }
    const blockedReason = collectionDeletionBlockedReason(collection.workspace);
    if (blockedReason) throw knowledgeHubUserError(blockedReason);
    mutationRevisionRef.current += 1;
    try {
      await client.delete(knowledgeWorkspaceRef(collection.workspace));
      setCollections((current) => current.filter((item) => item.workspace.id !== collection.workspace.id));
      notifyCollectionsChanged();
    } finally {
      mutationRevisionRef.current += 1;
    }
  }, [client, notifyCollectionsChanged]);

  const uploadFiles = useCallback(async (
    collection: KnowledgeHubCollection,
    files: File[],
  ) => {
    if (!client) throw knowledgeHubUserError("Knowledge is not connected.");
    const role = collection.workspace.role?.toLowerCase();
    if (role !== "admin" && role !== "contributor") {
      throw knowledgeHubUserError("Contributor access is required to upload sources.");
    }

    mutationRevisionRef.current += 1;
    try {
      const results: PromiseSettledResult<WorkspaceFile>[] = [];
      for (const file of files) {
        results.push(await Promise.resolve(client.uploadFile(
          knowledgeWorkspaceRef(collection.workspace),
          file,
          { path: file.name, filename: file.name },
        )).then(
          (value) => ({ status: "fulfilled", value }) as PromiseFulfilledResult<WorkspaceFile>,
          (reason) => ({ status: "rejected", reason }) as PromiseRejectedResult,
        ));
      }

      const uploaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      setCollections((current) => current.map((item) => {
        if (item.workspace.id !== collection.workspace.id) return item;
        let nextFiles = item.files;
        for (const file of uploaded) nextFiles = upsertFile(nextFiles, file);
        return { ...item, files: nextFiles, filesError: null };
      }));
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) throw knowledgeHubUserError(`${failed} source${failed === 1 ? "" : "s"} couldn't be uploaded.`);
      return uploaded;
    } finally {
      mutationRevisionRef.current += 1;
    }
  }, [client]);

  const updateFile = useCallback(async (
    collection: KnowledgeHubCollection,
    file: WorkspaceFile,
    input: FileUpdateInput,
  ) => {
    if (!client) throw knowledgeHubUserError("Knowledge is not connected.");
    mutationRevisionRef.current += 1;
    try {
      const updated = await client.updateFile(
        knowledgeWorkspaceRef(collection.workspace),
        file.path,
        input,
      );
      setCollections((current) => current.map((item) => item.workspace.id === collection.workspace.id
        ? { ...item, files: upsertFile(item.files, updated), filesError: null }
        : item));
      return updated;
    } finally {
      mutationRevisionRef.current += 1;
    }
  }, [client]);

  const regenerateFile = useCallback(async (
    collection: KnowledgeHubCollection,
    file: WorkspaceFile,
  ) => {
    if (!client) throw knowledgeHubUserError("Knowledge is not connected.");
    mutationRevisionRef.current += 1;
    try {
      const updated = await client.regenerateFile(knowledgeWorkspaceRef(collection.workspace), file.path);
      setCollections((current) => current.map((item) => item.workspace.id === collection.workspace.id
        ? { ...item, files: upsertFile(item.files, updated), filesError: null }
        : item));
      return updated;
    } finally {
      mutationRevisionRef.current += 1;
    }
  }, [client]);

  const deleteFile = useCallback(async (
    collection: KnowledgeHubCollection,
    file: WorkspaceFile,
  ) => {
    if (!client) throw knowledgeHubUserError("Knowledge is not connected.");
    mutationRevisionRef.current += 1;
    try {
      await client.deleteFile(knowledgeWorkspaceRef(collection.workspace), file.path);
      setCollections((current) => current.map((item) => item.workspace.id === collection.workspace.id
        ? {
            ...item,
            files: (item.files ?? []).filter((currentFile) => currentFile.id !== file.id && currentFile.path !== file.path),
            filesError: null,
          }
        : item));
    } finally {
      mutationRevisionRef.current += 1;
    }
  }, [client]);

  const setAgentAccess = useCallback(async (
    collection: KnowledgeHubCollection,
    agentId: string,
    enabled: boolean,
  ) => {
    if (!client) throw knowledgeHubUserError("Knowledge is not connected.");
    if (collection.workspace.role?.toLowerCase() !== "admin" || !collection.grants) {
      throw knowledgeHubUserError("Collection admin access is required to change agent assignments.");
    }

    const currentGrants = collection.grants;
    const workspaceRef = knowledgeWorkspaceRef(collection.workspace);
    const activeGrants = currentGrants.filter((grant) => (
      grant.subjectType === "agent" && grant.subjectId === agentId && grantIsActive(grant)
    ));
    if (enabled && activeGrants.length > 0) return;
    if (!enabled && activeGrants.length === 0) return;

    mutationRevisionRef.current += 1;
    try {
      if (enabled) {
        const grant = await client.grant(workspaceRef, {
          subjectType: "agent",
          subjectId: agentId,
          role: "viewer",
        });
        setCollections((current) => current.map((item) => {
          if (item.workspace.id !== collection.workspace.id) return item;
          const grants = [...(item.grants ?? currentGrants), grant];
          return { ...item, grants, agentIds: agentIdsFromGrants(grants), accessError: null };
        }));
      } else {
        const results = await Promise.allSettled(activeGrants.map((grant) => client.revokeGrant(workspaceRef, grant.id)));
        const removedGrantIds = new Set(results.flatMap((result, index) => (
          result.status === "fulfilled" ? [activeGrants[index]!.id] : []
        )));
        const failed = results.filter((result) => result.status === "rejected").length;
        setCollections((current) => current.map((item) => {
          if (item.workspace.id !== collection.workspace.id) return item;
          const grants = (item.grants ?? currentGrants).filter((grant) => !removedGrantIds.has(grant.id));
          return { ...item, grants, agentIds: agentIdsFromGrants(grants), accessError: null };
        }));
        if (failed > 0) throw knowledgeHubUserError(`${failed} membership grant${failed === 1 ? "" : "s"} couldn't be removed.`);
      }
    } finally {
      mutationRevisionRef.current += 1;
    }
  }, [client]);

  return {
    collections,
    loading,
    refreshing: loading && collections.length > 0,
    error,
    refresh,
    createCollection,
    updateCollection,
    deleteCollection,
    uploadFiles,
    updateFile,
    regenerateFile,
    deleteFile,
    setAgentAccess,
  };
}
